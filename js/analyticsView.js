/**
 * js/analyticsView.js — 성과분석 화면의 '자동 수집' 구역 (유튜브·인스타)
 *
 * 왜 따로 두나
 *  · 기존 성과분석(#/perf)은 사람이 D+1·D+7에 숫자를 넣는 화면이다(블로그·클립·당근).
 *  · 유튜브·인스타는 API로 자동 수집되므로 읽기 경로·표시가 다르다 → 이 파일만 따로 둔다.
 *  · perfView.js 수정은 '이 패널을 한 번 부르는' 두 줄뿐이다(블로그 영역 무접촉).
 *
 * 데이터: GAS list_analytics (gas/Analytics.gs → Analytics_Daily 시트)
 *  · 서버가 아직 그 액션을 모르면(재배포 전) 화면은 그대로 그리고 '서버 준비 중'만 조용히 알린다.
 *  · 수익은 실제 값만 보여 준다 — YouTube 가 보고한 수익(YPP)과 사람이 확정한 협찬·제휴액.
 *    출처가 없는 금액은 세지 않고, 조회수로 다시 계산한 추정치는 만들지 않는다. 인스타는 정산 개념이 없다.
 *  · 노출·시청시간·평균 시청률은 YouTube Analytics(OAuth)가 줄 때만 채워진다 → 0이면 '수집 안 됨'이다.
 *    화면은 이 값을 '있는 그대로' 넘기고, 없는 값을 추정해 채우지 않는다(js/perfDiagnosis.js 가 판단).
 */

import { isTrackRow } from './trackChannels.js?v=20261123c';

const CH_LABEL = { shorts: '쇼츠', longform: '롱폼', channel: '채널', reels: '릴스', feed: '피드' };
const SOURCE_LABEL = { youtube: '유튜브', instagram: '인스타' };
const REVENUE_LABEL = { ypp: 'YouTube 보고 수익', confirmed: '확정 협찬·제휴' };
const WINDOW_DAYS = 7;
const STALE_MS = 60 * 1000;

/* 브랜드별 캐시 — 화면을 다시 그려도 매번 서버를 부르지 않는다(60초). */
const cache = { brand: '', rows: [], error: null, at: 0, summary: null, loading: false };

export function invalidateAnalytics() {
  cache.at = 0;
}

function kstDay(offsetDays) {
  const kst = new Date(Date.now() + 9 * 3600 * 1000 + (offsetDays || 0) * 86400000);
  return kst.toISOString().slice(0, 10);
}

export async function loadAnalytics(api, brand, opts) {
  if (!api || !api.configured) {
    cache.brand = brand;
    cache.error = 'ERR_NO_CONFIG';
    cache.rows = [];
    cache.at = Date.now();
    return cache;
  }
  if (cache.loading) return cache;
  cache.loading = true;
  try {
    const res = await api.post('list_analytics', {
      brand: brand || 'ALL',
      from: kstDay(-30),
      to: kstDay(0)
    });
    const data = (res && res.data) || {};
    cache.brand = brand;
    /* 이미 쌓인 행이라도 그 트랙이 운영하지 않는 표면(트랙 B 의 인스타 피드 등)은 화면에서 뺀다 */
    cache.rows = (data.rows || []).map(normalizeRow).filter((r) => isTrackRow(r, brand));
    cache.summary = data.summary || null;
    cache.error = null;
  } catch (err) {
    cache.brand = brand;
    cache.rows = cache.rows || [];
    cache.error = (err && err.code) || 'ERR_UNKNOWN';
  } finally {
    cache.at = Date.now();
    cache.loading = false;
  }
  return cache;
}

/** 캐시가 신선하면(기본 60초) 그대로, 아니면 다시 읽는다 — 채널 목록·상세 화면이 같이 쓴다. */
export async function getAnalytics(api, brand, maxAgeMs) {
  const limit = maxAgeMs == null ? STALE_MS : maxAgeMs;
  if (cache.brand === brand && cache.at && Date.now() - cache.at < limit) return cache;
  return loadAnalytics(api, brand);
}

/** 이미 도는 불러오기가 끝날 때까지 기다린다(최대 8초). 그 뒤 cache 를 그대로 돌려준다. */
export function waitAnalytics(maxMs) {
  const limit = Number(maxMs) || 8000;
  const t0 = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      if (!cache.loading || Date.now() - t0 > limit) { resolve(cache); return; }
      setTimeout(tick, 150);
    };
    tick();
  });
}

function normalizeRow(r) {
  const n = (v) => (v == null || v === '' || Number.isNaN(Number(v))) ? 0 : Number(v);
  return {
    brand: String(r.brand || ''),
    source: String(r.source || ''),
    channel: String(r.channel || ''),
    external_id: String(r.external_id || ''),
    content_id: String(r.content_id || ''),
    checkpoint: String(r.checkpoint || ''),
    collected_at: String(r.collected_at || ''),
    collected_date: String(r.collected_date || r.collected_at || '').slice(0, 10),
    published_at: String(r.published_at || ''),
    views: n(r.views),
    impressions: n(r.impressions),
    reach: n(r.reach),
    likes: n(r.likes),
    comments: n(r.comments),
    shares: n(r.shares),
    saves: n(r.saves),
    watch_time_sec: n(r.watch_time_sec),
    avg_view_pct: n(r.avg_view_pct),
    subscribers: n(r.subscribers),
    revenue_krw: n(r.revenue_krw),
    revenue_source: String(r.revenue_source || ''),
    score: n(r.score),
    note: String(r.note || '')
  };
}

/* ───────────── 계산(화면 없이도 시험 가능) ───────────── */

/** 같은 소재·표면은 가장 최근(같은 시각이면 더 큰) 값 하나만 센다 — 누적 조회를 두 번 더하지 않는다. */
export function latestRows(rows) {
  const best = new Map();
  (rows || []).forEach((r) => {
    if (!r || !r.external_id) return;
    const key = r.source + '|' + r.external_id + '|' + r.channel;
    const prev = best.get(key);
    if (!prev) { best.set(key, r); return; }
    if (String(r.collected_at) > String(prev.collected_at)) { best.set(key, r); return; }
    if (String(r.collected_at) === String(prev.collected_at) && r.views > prev.views) best.set(key, r);
  });
  return Array.from(best.values());
}

/**
 * 이번 주 '늘어난' 수 — 누적값의 차이로 센다.
 *   같은 소재의 최신 누적 조회 − 기간 시작 전 마지막 누적 조회. 기간 안에 처음 보인 소재는 누적값 전체.
 *   (누적값을 그대로 더하면 옛 영상이 매주 통째로 다시 세어져 주간 성과가 부풀려진다 — 제미니 리뷰 반영)
 */
export function weekGrowth(rows, since) {
  const groups = new Map();
  (rows || []).forEach((r) => {
    if (!r || !r.external_id || r.channel === 'channel') return;
    const key = r.source + '|' + r.external_id + '|' + r.channel;
    const list = groups.get(key) || [];
    list.push(r);
    groups.set(key, list);
  });
  const out = { views: 0, reach: 0, items: 0 };
  groups.forEach((list) => {
    list.sort((a, b) => String(a.collected_at).localeCompare(String(b.collected_at)));
    const latest = list[list.length - 1];
    if (!latest || latest.collected_date < since) return;
    let base = null;
    for (let i = list.length - 2; i >= 0; i--) {
      if (list[i].collected_date < since) { base = list[i]; break; }
    }
    out.views += Math.max(0, latest.views - (base ? base.views : 0));
    out.reach += Math.max(0, latest.reach - (base ? base.reach : 0));
    out.items += 1;
  });
  return out;
}

/**
 * 요약 — 이번 주(최근 7일) 늘어난 조회·도달, 실제 수익, 표면별 표.
 * @param {Array} rows list_analytics rows
 */
export function summarizeRows(rows, opts) {
  const o = opts || {};
  const since = o.since || kstDay(-(WINDOW_DAYS - 1));
  const latest = latestRows(rows).filter((r) => r.channel !== 'channel');
  const channelRows = (rows || []).filter((r) => r && r.channel === 'channel');
  const sum = (list, key) => list.reduce((acc, r) => acc + (Number(r[key]) || 0), 0);

  const sources = {};
  Object.keys(SOURCE_LABEL).forEach((src) => {
    const list = (rows || []).filter((r) => r.source === src);
    const last = list.reduce((m, r) => (String(r.collected_at) > m ? String(r.collected_at) : m), '');
    sources[src] = { rows: list.length, last: last };
  });

  const channels = ['shorts', 'longform', 'reels', 'feed'].map((ch) => {
    const list = latest.filter((r) => r.channel === ch);
    const growth = weekGrowth((rows || []).filter((r) => r.channel === ch), since);
    return {
      channel: ch,
      label: CH_LABEL[ch] || ch,
      count: list.length,
      views: sum(list, 'views'),
      reach: sum(list, 'reach'),
      saves: sum(list, 'saves'),
      interactions: sum(list, 'likes') + sum(list, 'comments'),
      revenue: sum(list, 'revenue_krw'),
      weekViews: growth.views
    };
  }).filter((c) => c.count > 0);

  /* 수익은 출처가 있는 실제 값만 센다(출처 없는 금액은 화면에 올리지 않는다). */
  const revenueRows = latest.filter((r) => r.revenue_krw > 0 && !!REVENUE_LABEL[r.revenue_source]);
  const revenueKrw = sum(revenueRows, 'revenue_krw');
  const revenueSources = [];
  revenueRows.forEach((r) => { if (revenueSources.indexOf(r.revenue_source) < 0) revenueSources.push(r.revenue_source); });
  const ytGrowth = weekGrowth((rows || []).filter((r) => r.source === 'youtube'), since);
  const igGrowth = weekGrowth((rows || []).filter((r) => r.source === 'instagram'), since);

  return {
    since: since,
    latest: latest,
    sources: sources,
    channels: channels,
    subscribers: sum(channelRows, 'subscribers'),
    youtubeWeekViews: ytGrowth.views,
    instagramWeekReach: igGrowth.reach,
    weekItems: ytGrowth.items + igGrowth.items,
    revenueKrw: revenueKrw,
    revenueSources: revenueSources,
    unmapped: latest.filter((r) => /UNMAPPED/.test(r.note || '')).length,
    hasAny: latest.length > 0
  };
}

const nf = (n) => (Number(n) || 0).toLocaleString('ko-KR');
const won = (n) => nf(Math.round(Number(n) || 0)) + '원';

/* ───────────── 화면 ───────────── */

export function renderAnalyticsPanel(main, ctx) {
  const { h, state, api, banner, relTime } = ctx;
  const brand = state.brand;

  const panel = h('div', { class: 'panel an-panel' },
    h('h3', null, '📡 자동 수집 — 유튜브·인스타',
      h('span', { class: 'tag', text: 'API' })));

  if (!api || !api.configured) {
    panel.appendChild(h('div', { class: 'empty', text: '시트 서버를 연결하면 자동 수집분이 여기에 쌓입니다(⚙︎ → 연결).' }));
    panel.appendChild(guidePanel(h));
    main.appendChild(panel);
    return panel;
  }

  /* 첫 진입·60초 지났으면 한 번 불러오고 다시 그린다(무한 루프 방지: loading 플래그).
     2026-11-21: 다른 화면(앱 새로고침·진단 카드)이 이미 불러오는 중일 때도 '0건'을 그리지 않고
     그 불러오기가 끝나기를 기다렸다가 다시 그린다 — 같은 화면에서 숫자와 0건이 같이 보이던 것을 막는다. */
  const stale = cache.brand !== brand || (Date.now() - cache.at) > STALE_MS;
  if (stale) {
    panel.appendChild(h('p', { class: 'hint', text: '자동 수집분을 불러오는 중…' }));
    const done = cache.loading ? waitAnalytics() : loadAnalytics(api, brand);
    done.then(() => {
      if (typeof ctx.renderRoute === 'function') ctx.renderRoute();
    });
    panel.appendChild(guidePanel(h));
    main.appendChild(panel);
    return panel;
  }

  const err = cache.error;
  if (err && err !== 'ERR_NO_CONFIG') {
    const missing = err === 'ERR_INVALID_ACTION' || err === 'ERR_NOT_IMPLEMENTED' || err === 'ERR_UNKNOWN_ACTION' || err === 'ERR_SERVER_CONFIG';
    const msg = missing
      ? '자동 수집 저장소가 아직 서버에 없습니다 — Apps Script에 gas/Analytics.gs 를 올리고 재배포하면 이 구역이 살아납니다.'
      : '자동 수집분을 읽지 못했습니다(' + err + '). 잠시 뒤 새로고침해 보세요.';
    panel.appendChild(banner ? banner('info', 'ⓘ', '자동 수집 준비 중', msg) : h('p', { class: 'hint', text: msg }));
    panel.appendChild(guidePanel(h));
    main.appendChild(panel);
    return panel;
  }

  const s = summarizeRows(cache.rows || []);
  const sub = cache.summary || {};

  /* ① 동기화 상태 */
  const chips = h('div', { class: 'an-chips' });
  Object.keys(SOURCE_LABEL).forEach((src) => {
    const info = (s.sources && s.sources[src]) || { rows: 0, last: '' };
    const state2 = info.rows ? (relTime(info.last) + ' 동기화') : '아직 없음';
    chips.appendChild(h('span', { class: 'an-chip' + (info.rows ? ' on' : '') },
      h('b', { text: SOURCE_LABEL[src] }),
      h('em', { text: state2 }),
      h('span', { class: 'an-chip-n', text: info.rows + '건' })));
  });
  panel.appendChild(chips);

  if (!s.hasAny) {
    panel.appendChild(h('div', { class: 'empty', text: '아직 수집된 숫자가 없습니다. 첫 자동 수집이 돌면 여기에 쌓입니다.' }));
    panel.appendChild(guidePanel(h));
    main.appendChild(panel);
    return panel;
  }

  /* ② 큰 숫자 3개 — 수익은 실제 데이터가 있을 때만 카드로 올린다 */
  const revenueCard = s.revenueKrw > 0
    ? kpi(h, '수익 (실데이터)', won(s.revenueKrw),
      s.revenueSources.map((src) => REVENUE_LABEL[src]).join(' · ') + ' · 실제 정산·확정 금액')
    : kpi(h, '구독자', nf(s.subscribers) + '명', '유튜브가 알려 준 실제 값');
  panel.appendChild(h('div', { class: 'kpi-grid' },
    kpi(h, '유튜브 이번 주 조회 ↑', nf(s.youtubeWeekViews), '회 · 지난주 마지막 수집 대비 늘어난 수'),
    kpi(h, '인스타 이번 주 도달 ↑', nf(s.instagramWeekReach), '명 · 지난주 마지막 수집 대비 늘어난 수'),
    revenueCard));

  /* ③ 표면별 최근 값 */
  const list = h('div', { class: 'an-list' });
  s.channels.forEach((c) => {
    const bits = [c.views ? '조회 ' + nf(c.views) : '', c.reach ? '도달 ' + nf(c.reach) : '',
      c.saves ? '저장 ' + nf(c.saves) : '', c.interactions ? '반응 ' + nf(c.interactions) : ''].filter(Boolean).join(' · ');
    list.appendChild(h('div', { class: 'an-row' },
      h('span', { class: 'an-ch', text: c.label }),
      h('span', { class: 'an-main', text: bits || '수집된 지표 없음' }),
      h('span', { class: 'an-profit', text: c.revenue ? won(c.revenue) : '—' })));
  });
  s.latest
    .filter((r) => !CH_LABEL[r.channel])
    .forEach((r) => list.appendChild(h('div', { class: 'an-row' },
      h('span', { class: 'an-ch', text: r.channel || r.source }),
      h('span', { class: 'an-main', text: '조회 ' + nf(r.views) }),
      h('span', { class: 'an-profit', text: '—' }))));
  panel.appendChild(list);

  panel.appendChild(h('p', { class: 'hint', style: 'margin-top:8px',
    text: (s.unmapped ? '⚠️ 카드와 연결되지 않은 소재 ' + s.unmapped + '건 — tools/analytics/config.json 의 links 에 영상·미디어 ID 를 넣으면 카드별로 붙습니다. ' : '')
      + (s.subscribers ? '구독자 ' + nf(s.subscribers) + '명 · ' : '')
      + '블로그·클립·당근은 자동 수집이 없어 아래에서 직접 넣습니다.' }));

  panel.appendChild(guidePanel(h));
  main.appendChild(panel);
  return panel;
}

function kpi(h, label, value, sub) {
  return h('div', { class: 'kpi' },
    h('div', { class: 'kpi-k', text: label }),
    h('div', { class: 'kpi-v', text: value }),
    sub ? h('div', { class: 'kpi-s', text: sub }) : null);
}

/** 1회 연결 안내 — 실제 ID·키는 여기 적지 않는다(공개 저장소). */
function guidePanel(h) {
  const box = h('details', { class: 'an-guide' },
    h('summary', null, '🔑 자동 수집 연결 방법 (처음 한 번만)'));
  const steps = [
    ['유튜브', 'Google Cloud Console → YouTube Data API v3 사용 설정 → API 키 발급 → GitHub 저장소 Secrets 에 YOUTUBE_API_KEY 로 저장.'],
    ['유튜브 수익', '수익창출이 시작된 뒤에만 — OAuth 로 YouTube Analytics API(yt-analytics.readonly) 동의 후 YOUTUBE_OAUTH_TOKEN. YouTube 가 보고한 값만 싣고, 조회수로 다시 계산하지 않습니다.'],
    ['인스타그램', 'Meta for Developers → 비즈니스 앱 → Instagram Graph API + instagram_manage_insights → 장기 토큰(60일) 발급 → Secrets 에 IG_ACCESS_TOKEN·IG_TOKEN_EXPIRES_AT.'],
    ['시트 적재', 'Apps Script 속성에 GAS_WEBAPP_URL·GAS_API_TOKEN 을 넣고, 저장소 Secrets 에 같은 이름으로 등록.'],
    ['채널·계정 ID', 'tools/analytics/config.json 의 tracks 에 채널 ID·인스타 계정 ID, links 에 영상 ID ↔ 카드 ID, revenue.confirmed 에 확정 협찬액을 적습니다.'],
  ];
  const ul = h('ul', { class: 'an-steps' });
  steps.forEach(([k, v]) => ul.appendChild(h('li', null, h('b', { text: k + ' · ' }), v)));
  box.appendChild(ul);
  box.appendChild(h('p', { class: 'hint', text: '키·토큰은 GitHub Actions Secrets 와 Apps Script 속성에만 둡니다. 이 화면·저장소 파일에는 남지 않습니다.' }));
  return box;
}
