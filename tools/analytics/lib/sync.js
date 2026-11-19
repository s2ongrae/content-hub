'use strict';
/**
 * tools/analytics/lib/sync.js — 수집 → 정규화 → 시트 적재 페이로드
 *
 * 흐름
 *   ① GitHub Actions(무료 크론)가 이 모듈로 유튜브·인스타를 읽는다(키는 Actions Secrets 에만).
 *   ② 행을 Analytics_Daily 스키마로 정규화하고 (소스·외부ID·표면·시점·수집일) 중복을 제거한다.
 *   ③ GAS 웹앱의 ingest_analytics 로 50건씩 보낸다(토큰은 요청 본문에만).
 *   ④ GAS 가 같은 중복 키를 다시 걸러 시트에 적고, 필요하면 Metrics 에도 한 줄 비춘다.
 *
 * 키가 하나도 없으면 아무 네트워크도 타지 않고 dry-run 계획만 돌려준다 — 설정 전에도 안전하게 돌려 볼 수 있다.
 */

const { fetchJson, AnalyticsError } = require('./http');
const { collectYoutube, collectYoutubeAnalytics } = require('./youtube');
const { collectInstagram, tokenNotice } = require('./instagram');
const {
  normalizeYoutubeVideo, normalizeYoutubeChannel, normalizeInstagramMedia, dedupeKey, kstDate
} = require('./normalize');
const { estimateRevenue, performanceScore, mediansByChannel } = require('./estimate');
const { createLinker } = require('./ids');

const GAS_MAX_ITEMS = 50;   // GAS 쓰기 락(1.8초)과 부딪히지 않게 작게 보낸다(제미니 구현 리뷰 반영)

function flattenTracks(config) {
  const tracks = (config && config.tracks) || {};
  const out = [];
  Object.keys(tracks).forEach((key) => {
    const t = tracks[key] || {};
    out.push({
      track: key,
      brand: t.brand || '',
      youtube_channel_id: (t.youtube && t.youtube.channel_id) || '',
      monetized: !!(t.youtube && t.youtube.monetized),
      ig_user_id: (t.instagram && t.instagram.ig_user_id) || ''
    });
  });
  return out;
}

function linkOf(config, externalId, fallbackBrand) {
  const links = (config && config.links) || {};
  const hit = links[String(externalId || '')];
  if (hit && typeof hit === 'object') {
    return { brand: hit.brand || fallbackBrand || '', content_id: String(hit.content_id || '') };
  }
  return { brand: fallbackBrand || '', content_id: '' };
}

/** 수집 전 계획 — 무엇을 몇 번 부를지, 무엇이 빠졌는지. */
function buildPlan(config, env) {
  const e = env || {};
  const tracks = flattenTracks(config);
  const ytChannels = tracks.filter((t) => t.youtube_channel_id && !/^REPLACE/.test(t.youtube_channel_id));
  const igUsers = tracks.filter((t) => t.ig_user_id && !/^REPLACE/.test(t.ig_user_id));
  const windowDays = Number((config && config.collect && config.collect.window_days) || 45);
  return {
    window_days: windowDays,
    youtube: {
      configured: !!(e.youtubeApiKey && ytChannels.length),
      channels: ytChannels.length,
      calls_per_run: ytChannels.length ? ytChannels.length * 2 + ytChannels.length : 0,
      units_per_run: ytChannels.length ? ytChannels.length * 2 + ytChannels.length : 0,
      analytics_api: !!(e.youtubeOAuthToken && ytChannels.some((t) => t.monetized)),
      missing: [
        e.youtubeApiKey ? '' : 'YOUTUBE_API_KEY',
        ytChannels.length ? '' : 'tracks[].youtube.channel_id'
      ].filter(Boolean)
    },
    instagram: {
      configured: !!(e.igAccessToken && igUsers.length),
      accounts: igUsers.length,
      calls_per_run: e.igAccessToken && igUsers.length ? igUsers.length * 2 : 0,
      missing: [
        e.igAccessToken ? '' : 'IG_ACCESS_TOKEN',
        igUsers.length ? '' : 'tracks[].instagram.ig_user_id'
      ].filter(Boolean)
    },
    gas: {
      configured: !!(e.gasUrl && e.gasToken),
      missing: [e.gasUrl ? '' : 'GAS_WEBAPP_URL', e.gasToken ? '' : 'GAS_API_TOKEN'].filter(Boolean)
    }
  };
}

/**
 * 실제 수집. 키가 하나도 없으면 mode='dry-run' 으로 끝난다(네트워크 호출 0).
 * @param {{config:object, env:object, fetchImpl?:Function, now?:Date, sources?:string[]}} opts
 */
async function runSync(opts) {
  const o = opts || {};
  const config = o.config || {};
  const env = o.env || {};
  const now = o.now ? new Date(o.now) : new Date();
  const sources = o.sources && o.sources.length ? o.sources : ['youtube', 'instagram'];
  const plan = buildPlan(config, env);
  const tracks = flattenTracks(config);
  const linker = createLinker(config);

  const notices = [];
  const errors = [];
  const rows = [];
  let mode = 'live';

  if (!plan.youtube.configured && !plan.instagram.configured) {
    mode = 'dry-run';
    notices.push({ level: 'info', code: 'DRY_RUN', message: 'API 키가 아직 없어서 아무것도 부르지 않았습니다 — 계획만 보여 드립니다.' });
  }
  if (plan.instagram.configured && env.igTokenExpiresAt) {
    const n = tokenNotice(env.igTokenExpiresAt, now);
    notices.push({ level: n.level === 'ok' ? 'info' : 'warn', code: 'IG_TOKEN_' + n.level.toUpperCase(), message: n.message });
  }

  /* ── 유튜브 ── */
  if (mode === 'live' && sources.indexOf('youtube') >= 0) {
    if (!plan.youtube.configured) {
      notices.push({ level: 'warn', code: 'YT_SKIPPED', message: '유튜브 키 또는 채널 ID 가 없어 유튜브만 건너뜁니다.' });
    } else {
      try {
        const ytChannels = tracks.filter((t) => t.youtube_channel_id && !/^REPLACE/.test(t.youtube_channel_id))
          .map((t) => ({ brand: t.brand, label: t.track, channel_id: t.youtube_channel_id }));
        const yt = await collectYoutube({
          apiKey: env.youtubeApiKey,
          channels: ytChannels,
          fetchImpl: o.fetchImpl,
          now,
          windowDays: plan.window_days,
          shortMaxSec: (config.collect && config.collect.shorts_max_sec) || 180
        });
        yt.channels.forEach((ch) => {
          const t = tracks.find((x) => x.youtube_channel_id === ch.channel_id);
          rows.push(normalizeYoutubeChannel(ch, { brand: t && t.brand, now }));
        });
        yt.videos.forEach((v) => {
          const link = linker(v.video_id, { fallbackBrand: v.brand });
          rows.push(normalizeYoutubeVideo(v, { link, now }));
        });
        notices.push({ level: 'info', code: 'YT_OK', message: '유튜브 영상 ' + yt.videos.length + '건 · 호출 ' + yt.quota.calls + '회(약 ' + yt.quota.units + ' unit)' });
      } catch (err) {
        errors.push({ source: 'youtube', code: (err && err.code) || 'ERR_YOUTUBE', message: (err && err.message) || '유튜브 수집 실패', reason: (err && err.details && err.details.reason) || '' });
      }
    }
    const monetizedTracks = tracks.filter((t) => t.monetized && t.youtube_channel_id);
    if (env.youtubeOAuthToken && monetizedTracks.length) {
      for (const t of monetizedTracks) {
        const res = await collectYoutubeAnalytics({
          channelId: t.youtube_channel_id,
          accessToken: env.youtubeOAuthToken,
          startDate: shiftDate(now, -7),
          endDate: kstDate(now),
          fetchImpl: o.fetchImpl
        });
        if (res.status === 'SKIPPED') {
          notices.push({ level: 'warn', code: 'YT_ANALYTICS_SKIPPED', message: '수익화 전 채널이라 Analytics API 수익 지표를 건너뜁니다(' + t.track + ').' });
        } else if (res.status === 'ERROR') {
          errors.push({ source: 'youtube-analytics', code: res.reason, message: 'Analytics API 호출 실패', reason: res.reason });
        }
      }
    }
  }

  /* ── 인스타 ── */
  if (mode === 'live' && sources.indexOf('instagram') >= 0) {
    if (!plan.instagram.configured) {
      notices.push({ level: 'warn', code: 'IG_SKIPPED', message: '인스타 토큰 또는 계정 ID 가 없어 인스타만 건너뜁니다.' });
    } else {
      for (const t of tracks.filter((x) => x.ig_user_id && !/^REPLACE/.test(x.ig_user_id))) {
        try {
          const ig = await collectInstagram({
            igUserId: t.ig_user_id,
            token: env.igAccessToken,
            fetchImpl: o.fetchImpl,
            now,
            windowDays: plan.window_days
          });
          ig.media.forEach((m) => {
            const link = linker(m.external_id, { permalink: m.permalink, fallbackBrand: t.brand });
            rows.push(normalizeInstagramMedia(m, { link, now }));
          });
          notices.push({ level: 'info', code: 'IG_OK', message: '인스타 ' + t.track + ' ' + ig.media.length + '건' + (ig.insightsErrors.length ? ' (인사이트 실패 ' + ig.insightsErrors.length + '건)' : '') });
          ig.insightsErrors.forEach((e) => errors.push({ source: 'instagram', code: e.code, message: '미디어 인사이트 실패: ' + e.external_id, reason: e.reason }));
        } catch (err) {
          errors.push({ source: 'instagram', code: (err && err.code) || 'ERR_INSTAGRAM', message: (err && err.message) || '인스타 수집 실패', reason: (err && err.details && err.details.reason) || '' });
        }
      }
    }
  }

  const deduped = dedupe(rows);
  const enriched = applyRevenueAndScore(deduped, config);

  return {
    mode,
    ran_at: new Date(now.getTime()).toISOString(),
    collected_date: kstDate(now),
    plan,
    rows: enriched,
    stats: {
      rows: enriched.length,
      unmapped: enriched.filter((r) => /UNMAPPED/.test(r.note || '')).length,
      youtube: enriched.filter((r) => r.source === 'youtube').length,
      instagram: enriched.filter((r) => r.source === 'instagram').length
    },
    notices,
    errors
  };
}

function dedupe(rows) {
  const seen = new Map();
  (rows || []).forEach((r) => {
    const k = dedupeKey(r);
    if (!seen.has(k)) seen.set(k, r);
  });
  return Array.from(seen.values());
}

/** 행마다 예상 수익·성과 점수를 붙인다(점수는 같은 표면 중위수 기준). */
function applyRevenueAndScore(rows, config) {
  const medians = mediansByChannel(rows);
  const rpmTable = (config && config.revenue && config.revenue.rpm_krw) || null;
  const monetizedByBrand = {};
  flattenTracks(config).forEach((t) => { monetizedByBrand[t.brand] = t.monetized; });
  return (rows || []).map((r) => {
    const est = estimateRevenue({
      source: r.source,
      channel: r.channel,
      views: r.views,
      monetized: !!monetizedByBrand[r.brand],
      rpmTable
    });
    return Object.assign({}, r, {
      revenue_krw: est.krw,
      revenue_estimated: est.estimated,
      rpm_assumed: est.rpm,
      score: performanceScore(r, { medianViews: medians[r.channel] || 0 }),
      note: [r.note, est.reason === 'OK' ? '' : est.reason].filter(Boolean).join(',')
    });
  });
}

/** GAS ingest_analytics 페이로드 — 50건씩, 멱등키는 (수집일·순번)으로 고정. */
function toGasPayload(rows, opts) {
  const o = opts || {};
  const size = o.chunkSize || GAS_MAX_ITEMS;
  const dateStr = o.date || kstDate(o.now);
  const chunks = [];
  for (let i = 0; i < (rows || []).length; i += size) {
    chunks.push({
      idempotency_key: 'AND-' + String(dateStr).replace(/-/g, '') + '-' + String(chunks.length + 1).padStart(3, '0'),
      items: rows.slice(i, i + size)
    });
  }
  return chunks;
}

/** GAS 웹앱으로 순서대로 보낸다(실패한 묶음은 다음 실행이 다시 보낸다 — 시트가 중복을 거른다). */
async function pushToGas(payloads, opts) {
  const o = opts || {};
  if (!o.url || !o.token) throw new AnalyticsError('ERR_NO_GAS_CONFIG', 'GAS_WEBAPP_URL · GAS_API_TOKEN 이 없습니다.');
  const out = [];
  for (const p of payloads) {
    try {
      const res = await fetchJson(o.url, {
        method: 'POST',
        fetchImpl: o.fetchImpl,
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'ingest_analytics',
          auth_token: o.token,
          client_id: o.clientId || 'analytics-cron',
          brand: 'ALL',
          idempotency_key: p.idempotency_key,
          payload: { items: p.items }
        }),
        secrets: [o.token]
      });
      out.push({ key: p.idempotency_key, ok: !!(res.body && res.body.ok), body: res.body });
    } catch (err) {
      out.push({ key: p.idempotency_key, ok: false, error: { code: err.code, message: err.message } });
    }
  }
  return out;
}

function shiftDate(now, days) {
  return kstDate(new Date(new Date(now).getTime() + days * 86400000));
}

module.exports = { flattenTracks, linkOf, buildPlan, runSync, dedupe, applyRevenueAndScore, toGasPayload, pushToGas, GAS_MAX_ITEMS };
