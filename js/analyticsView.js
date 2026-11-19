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
 *  · 수익은 '추정'이면 반드시 라벨을 붙인다. 인스타는 조회 정산이 없어 예상 수익을 숨긴다.
 */

const CH_LABEL = { shorts: '쇼츠', longform: '롱폼', channel: '채널', reels: '릴스', feed: '피드' };
const SOURCE_LABEL = { youtube: '유튜브', instagram: '인스타' };
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
    cache.rows = (data.rows || []).map(normalizeRow);
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

function normalizeRow(r) {
  const n = (v) => (v == null || v === '' || Number.isNaN(Number(v))) ? 0 : Number(v);
  const flag = (v) => v === true || v === 'TRUE' || v === 'true';
  return {
    source: String(r.source || ''),
    channel: String(r.channel || ''),
    external_id: String(r.external_id || ''),
    content_id: String(r.content_id || ''),
    checkpoint: String(r.checkpoint || ''),
    collected_at: String(r.collected_at || ''),
    collected_date: String(r.collected_date || r.collected_at || '').slice(0, 10),
    views: n(r.views),
    reach: n(r.reach),
    likes: n(r.likes),
    comments: n(r.comments),
    shares: n(r.shares),
    saves: n(r.saves),
    subscribers: n(r.subscribers),
    revenue_krw: n(r.revenue_krw),
    revenue_estimated: flag(r.revenue_estimated),
    rpm_assumed: n(r.rpm_assumed),
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
 * 요약 — 이번 주(최근 7일) 늘어난 조회·도달, 예상 수익, 표면별 표.
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

  const revenueRows = latest.filter((r) => r.revenue_krw > 0);
  const estRevenue = sum(revenueRows, 'revenue_krw');
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
    estRevenue: estRevenue,
    revenueIsEstimate: revenueRows.some((r) => r.revenue_estimated),
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

  /* 첫 진입·60초 지났으면 한 번 불러오고 다시 그린다(무한 루프 방지: loading 플래그). */
  const stale = cache.brand !== brand || (Date.now() - cache.at) > STALE_MS;
  if (stale && !cache.loading) {
    panel.appendChild(h('p', { class: 'hint', text: '자동 수집분을 불러오는 중…' }));
    loadAnalytics(api, brand).then(() => {
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

  /* ② 큰 숫자 3개 — 수익은 '추정' 라벨 고정 */
  panel.appendChild(h('div', { class: 'kpi-grid' },
    kpi(h, '유튜브 이번 주 조회 ↑', nf(s.youtubeWeekViews), '회 · 지난주 마지막 수집 대비 늘어난 수'),
    kpi(h, '인스타 이번 주 도달 ↑', nf(s.instagramWeekReach), '명 · 지난주 마지막 수집 대비 늘어난 수'),
    kpi(h, s.revenueIsEstimate ? '예상 수익 (추정)' : '누적 수익', won(s.estRevenue),
      s.revenueIsEstimate ? '가정 RPM 기준 · 실제 정산 아님' : '확정 금액')));

  /* ③ 표면별 최근 값 */
  const list = h('div', { class: 'an-list' });
  s.channels.forEach((c) => {
    const bits = [c.views ? '조회 ' + nf(c.views) : '', c.reach ? '도달 ' + nf(c.reach) : '',
      c.saves ? '저장 ' + nf(c.saves) : '', c.interactions ? '반응 ' + nf(c.interactions) : ''].filter(Boolean).join(' · ');
    list.appendChild(h('div', { class: 'an-row' },
      h('span', { class: 'an-ch', text: c.label }),
      h('span', { class: 'an-main', text: bits || '수집된 지표 없음' }),
      h('span', { class: 'an-profit', text: c.revenue ? won(c.revenue) + ' (추정)' : '—' })));
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
    ['유튜브 수익(선택)', '수익창출이 시작된 뒤에만 — OAuth 로 YouTube Analytics API(yt-analytics.readonly) 동의 후 YOUTUBE_OAUTH_TOKEN. 수익화 전이면 부르지 않습니다(403).'],
    ['인스타그램', 'Meta for Developers → 비즈니스 앱 → Instagram Graph API + instagram_manage_insights → 장기 토큰(60일) 발급 → Secrets 에 IG_ACCESS_TOKEN·IG_TOKEN_EXPIRES_AT.'],
    ['시트 적재', 'Apps Script 속성에 GAS_WEBAPP_URL·GAS_API_TOKEN 을 넣고, 저장소 Secrets 에 같은 이름으로 등록.'],
    ['채널·계정 ID', 'tools/analytics/config.json 의 tracks 에 채널 ID·인스타 계정 ID, links 에 영상 ID ↔ 카드 ID 를 적습니다.']
  ];
  const ul = h('ul', { class: 'an-steps' });
  steps.forEach(([k, v]) => ul.appendChild(h('li', null, h('b', { text: k + ' · ' }), v)));
  box.appendChild(ul);
  box.appendChild(h('p', { class: 'hint', text: '키·토큰은 GitHub Actions Secrets 와 Apps Script 속성에만 둡니다. 이 화면·저장소 파일에는 남지 않습니다.' }));
  return box;
}
