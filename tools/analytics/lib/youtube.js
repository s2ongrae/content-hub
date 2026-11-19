'use strict';
/**
 * tools/analytics/lib/youtube.js — YouTube 데이터 수집
 *
 * 키 하나(YouTube Data API v3)로 공개 지표만 모은다. 수익·노출·시청지속은 Analytics API(OAuth)라
 * 기본 경로에서는 부르지 않고, 토큰이 있고 채널이 수익화된 경우에만 선택적으로 붙는다.
 *
 * 쿼터 설계(일 10,000 unit, 기본 1회 실행)
 *  · channels.list   (part=statistics,contentDetails)  … 채널 1개당 1 unit
 *  · playlistItems.list (업로드 재생목록 최근 50개)      … 채널 1개당 1 unit
 *  · videos.list    (part=snippet,statistics,contentDetails, 50개 묶음) … 50개당 1 unit
 *  → 채널 2개 · 영상 100개 기준 하루 6 unit. 한 달 돌려도 180 unit.
 *
 * 수익화 전 채널에서 Analytics API 의 estimatedRevenue / monetizedPlayback 은 403 이 난다.
 * 이때는 배치를 멈추지 않고 MONETIZATION_NOT_ENABLED 로 표시해 건너뛴다(수익은 0원·출처 없음으로 남는다).
 * 수익은 YouTube 가 보고한 값만 싣는다 — 우리가 조회수로 다시 계산하지 않는다.
 */

const { fetchJson, AnalyticsError } = require('./http');

const API_BASE = 'https://www.googleapis.com/youtube/v3';
const JSON_HEADERS = { Accept: 'application/json' };

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function channelsUrl(ids) {
  return API_BASE + '/channels?part=statistics,contentDetails&id=' + encodeURIComponent(ids.join(',')) + '&maxResults=50';
}

function playlistItemsUrl(playlistId, pageToken) {
  const q = '?part=contentDetails&playlistId=' + encodeURIComponent(playlistId) + '&maxResults=50';
  return API_BASE + '/playlistItems' + q + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
}

function videosUrl(ids) {
  return API_BASE + '/videos?part=snippet,statistics,contentDetails&id=' + encodeURIComponent(ids.join(',')) + '&maxResults=50';
}

/** ISO8601 기간(PT1M3S, PT45S) → 초 */
function parseDurationSec(iso) {
  const m = String(iso || '').match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);
  if (!m) return 0;
  const [, d, h, mi, s] = m;
  return (Number(d) || 0) * 86400 + (Number(h) || 0) * 3600 + (Number(mi) || 0) * 60 + Math.round(Number(s) || 0);
}

function parseChannels(json) {
  const items = (json && json.items) || [];
  return items.map((it) => ({
    channel_id: String(it.id || ''),
    title: String((it.snippet && it.snippet.title) || ''),
    subscribers: toNum(it.statistics && it.statistics.subscriberCount),
    total_views: toNum(it.statistics && it.statistics.viewCount),
    video_count: toNum(it.statistics && it.statistics.videoCount),
    uploads_playlist: String((it.contentDetails && it.contentDetails.relatedPlaylists && it.contentDetails.relatedPlaylists.uploads) || '')
  }));
}

function parsePlaylistItems(json) {
  return (((json && json.items) || [])).map((it) => ({
    video_id: String((it.contentDetails && it.contentDetails.videoId) || (it.snippet && it.snippet.resourceId && it.snippet.resourceId.videoId) || ''),
    published_at: String((it.contentDetails && it.contentDetails.videoPublishedAt) || '')
  })).filter((v) => v.video_id);
}

function parseVideos(json) {
  return (((json && json.items) || [])).map((it) => {
    const st = it.statistics || {};
    const sn = it.snippet || {};
    const dur = parseDurationSec(it.contentDetails && it.contentDetails.duration);
    return {
      video_id: String(it.id || ''),
      title: String(sn.title || ''),
      published_at: String(sn.publishedAt || ''),
      duration_sec: dur,
      views: toNum(st.viewCount),
      likes: toNum(st.likeCount),
      comments: toNum(st.commentCount),
      live_state: String(sn.liveBroadcastContent || 'none')
    };
  }).filter((v) => v.video_id);
}

/** 쇼츠/롱폼 구분 — 2024년 이후 쇼츠 상한은 3분(180초)이라 기본값을 180으로 둔다. */
function classifySurface(durationSec, shortMaxSec) {
  const limit = Number.isFinite(shortMaxSec) ? shortMaxSec : 180;
  return Number(durationSec) > 0 && Number(durationSec) <= limit ? 'shorts' : 'longform';
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 채널 목록(설정) → 수집 결과.
 * @param {{apiKey:string, channels:Array<{brand:string,label?:string,channel_id:string}>, fetchImpl?:Function,
 *          now?:Date, windowDays?:number, shortMaxSec?:number, pages?:number}} opts
 * @returns {Promise<{channels:Array, videos:Array, quota:{calls:number, units:number}}>}
 */
async function collectYoutube(opts) {
  const o = opts || {};
  if (!o.apiKey) throw new AnalyticsError('ERR_NO_API_KEY', 'YOUTUBE_API_KEY 가 없습니다.');
  const channels = (o.channels || []).filter((c) => c && c.channel_id);
  if (!channels.length) throw new AnalyticsError('ERR_NO_CHANNEL', '수집할 유튜브 채널이 설정에 없습니다.');
  const now = o.now ? new Date(o.now) : new Date();
  const windowDays = Number.isFinite(o.windowDays) ? o.windowDays : 45;
  const pages = Math.max(1, Math.min(4, Number.isFinite(o.pages) ? o.pages : 1));
  const secrets = [o.apiKey];

  let calls = 0;
  const urlOpts = { fetchImpl: o.fetchImpl, headers: JSON_HEADERS, secrets };

  const chRes = await fetchJson(channelsUrl(channels.map((c) => c.channel_id)) + '&key=' + encodeURIComponent(o.apiKey), urlOpts);
  calls += chRes.calls;
  const parsedChannels = parseChannels(chRes.body);
  const byId = new Map(parsedChannels.map((c) => [c.channel_id, c]));

  const wanted = [];
  for (const cfg of channels) {
    const found = byId.get(cfg.channel_id);
    if (!found) continue;
    let pageToken = '';
    for (let p = 0; p < pages; p++) {
      const res = await fetchJson(playlistItemsUrl(found.uploads_playlist, pageToken) + '&key=' + encodeURIComponent(o.apiKey), urlOpts);
      calls += res.calls;
      const items = parsePlaylistItems(res.body);
      items.forEach((it) => {
        if (withinWindow(it.published_at, now, windowDays)) wanted.push(Object.assign({ brand: cfg.brand, label: cfg.label || '', channel_id: cfg.channel_id }, it));
      });
      pageToken = String((res.body && res.body.nextPageToken) || '');
      if (!pageToken || !items.length) break;
    }
  }

  const uniq = new Map();
  wanted.forEach((w) => { if (!uniq.has(w.video_id)) uniq.set(w.video_id, w); });
  const ids = Array.from(uniq.keys());

  const videos = [];
  for (const ids50 of chunk(ids, 50)) {
    const res = await fetchJson(videosUrl(ids50) + '&key=' + encodeURIComponent(o.apiKey), urlOpts);
    calls += res.calls;
    parseVideos(res.body).forEach((v) => {
      const meta = uniq.get(v.video_id) || {};
      videos.push(Object.assign({}, v, {
        brand: meta.brand || '',
        label: meta.label || '',
        channel_id: meta.channel_id || '',
        surface: classifySurface(v.duration_sec, o.shortMaxSec)
      }));
    });
  }

  return {
    channels: parsedChannels,
    videos,
    quota: { calls, units: calls }
  };
}

function withinWindow(iso, now, days) {
  const t = Date.parse(iso);
  if (!t || Number.isNaN(t)) return false;
  return (now.getTime() - t) <= days * 86400000 && t <= now.getTime() + 86400000;
}

/**
 * (선택) YouTube Analytics API — 시청지속·시청시간·채널 보고 수익.
 * 수익화 전 채널은 403(monetization not enabled) → 배치를 멈추지 않고 건너뛴다.
 * 통화는 currency 로 고정해 받는다(기본 KRW) — 환율로 다시 계산하지 않는다.
 * @returns {Promise<{status:'OK'|'SKIPPED'|'ERROR', reason:string, rows:Array}>
 */
async function collectYoutubeAnalytics(opts) {
  const o = opts || {};
  const base = 'https://youtubeanalytics.googleapis.com/v2/reports';
  const params = [
    'ids=channel==' + encodeURIComponent(o.channelId || 'MINE'),
    'startDate=' + encodeURIComponent(o.startDate),
    'endDate=' + encodeURIComponent(o.endDate),
    'metrics=' + encodeURIComponent(o.metrics || 'views,estimatedMinutesWatched,averageViewPercentage'),
    'currency=' + encodeURIComponent(o.currency || 'KRW'),
    'dimensions=video',
    'maxResults=200'
  ].join('&');
  try {
    const res = await fetchJson(base + '?' + params, {
      fetchImpl: o.fetchImpl,
      headers: Object.assign({}, JSON_HEADERS, { Authorization: 'Bearer ' + (o.accessToken || '') }),
      secrets: [o.accessToken]
    });
    const rows = ((res.body && res.body.rows) || []).map((r) => {
      const dims = (res.body.columnHeaders || []).map((h) => h.name);
      const obj = {};
      dims.forEach((name, i) => { obj[name] = r[i]; });
      return obj;
    });
    return { status: 'OK', reason: '', rows };
  } catch (err) {
    if (err && err.details && Number(err.details.status) === 403) {
      return { status: 'SKIPPED', reason: 'MONETIZATION_NOT_ENABLED', rows: [] };
    }
    return { status: 'ERROR', reason: (err && err.code) || 'ERR_ANALYTICS', rows: [] };
  }
}

module.exports = {
  collectYoutube,
  collectYoutubeAnalytics,
  parseChannels,
  parsePlaylistItems,
  parseVideos,
  parseDurationSec,
  classifySurface,
  chunk,
  channelsUrl,
  playlistItemsUrl,
  videosUrl
};
