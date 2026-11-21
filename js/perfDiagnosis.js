/**
 * js/perfDiagnosis.js — #/perf '쇼츠 3지표 진단' 카드 (2026-11-21)
 *
 * 무엇을 하나
 *  · 유튜브 쇼츠 영상마다 세 지표를 한 카드에 세우고, 어느 구간에서 새는지 한 줄로 처방한다.
 *      ① 조회 — 재생 시작 수(유튜브 Data API 실측)
 *      ② 평균 시청률 % — 유튜브가 준 평균 시청률, 또는 (평균 시청 지속 초 ÷ 영상 길이) 로 계산
 *      ③ 반응률 % — (좋아요 + 댓글 + 공유) ÷ 조회 (실측)
 *  · 판정은 '우리 채널 안 비교'로 한다 — 같은 표면(쇼츠)의 중위수와 견준다. 외부 업체가 말하는
 *    완주율 65%/50% 같은 수치는 쓰지 않는다(우리 데이터로 검증 전까지 기준이 아니다).
 *
 * 하지 않는 것 (중요)
 *  · 노출수·계속 시청(넘김 비율)·재시청은 YouTube Data API v3 로 오지 않는다 → **추정해서 채우지 않는다.**
 *    없는 지표는 '미수집'으로 두고, 화면에 무엇이 없는지 적는다.
 *  · 2026-08-24 부터 조회수가 '재생 시작' 기준으로 바뀌었다 → 그 이전 영상은 기준 배지를 달고
 *    중위수·비교에서 뺀다(옛 영상과 새 영상을 그대로 비교하면 부풀려진다).
 *
 * 데이터
 *  · 자동 수집분: js/analyticsView.js 캐시(GAS list_analytics → Analytics_Daily)
 *  · 영상 길이·발행일: Media_Meta(GAS list_media_meta)
 *  · 평균 시청 지속(초): 사람이 유튜브 스튜디오를 보고 넣는다(Metrics.avg_dwell_sec, 카드 단위).
 *    카드에 쇼츠가 한 편일 때만 그 값을 그 영상의 것으로 본다(여러 편이면 어느 영상인지 알 수 없다).
 *
 * 화면은 createElement/textContent 만 쓴다(CSP — HTML 문자열 금지).
 */

import { getAnalytics, waitAnalytics } from './analyticsView.js?v=20261121r';
import { currentRows } from './channelView.js?v=20261121r';

/* ───────────── 기준값(우리 기준) ───────────── */

export const VIEW_ERA_DATE = '2026-08-24';  // 조회수 집계 기준이 바뀐 날(공식 변경)
export const MIN_AGE_DAYS = 3;              // 발행 3일 전엔 판단하지 않는다
export const MEDIAN_MIN = 3;               // 중위수 비교는 표본 3편부터
export const LOW_RETENTION_RATIO = 0.8;     // 중위수의 80% 미만 = 낮음
export const LOW_REACTION_RATIO = 0.7;      // 중위수의 70% 미만 = 낮음
export const LOW_VIEW_RATIO = 0.7;
export const MAX_CARDS = 8;

const RETENTION_SOURCE_LABEL = {
  collected: '유튜브 보고값',
  watch_time: '시청시간÷조회÷길이',
  dwell: '시청 지속÷길이(입력)'
};

const BOTTLENECK_LABEL = {
  no_data: '집계 전',
  old_era: '기준 이전',
  wait: '판단 보류',
  measure: '측정 필요',
  insufficient: '표본 부족',
  early: '첫 장면 병목',
  ending: '엔딩 병목',
  reach: '노출·첫 장면',
  keep: '유지'
};

const PRESCRIPTION = {
  no_data: '조회가 아직 0입니다 — 다음 자동 수집이 돌면 여기에 잡힙니다.',
  old_era: '8/24 이전 영상입니다 — 조회수 집계 기준이 달라 새 영상과 직접 비교하지 않습니다.',
  measure: '유튜브 스튜디오 → 콘텐츠 → 이 영상의 평균 시청 지속(초)을 넣으면 첫 장면·엔딩 병목이 갈립니다.',
  insufficient: '첫 측정값입니다 — 다음 편은 첫 장면만 바꿔 같은 기준으로 3편을 쌓으면 병목이 갈립니다.',
  early: '첫 1~2초에서 끊깁니다 — 첫 장면을 움직이는 컷 + 화면 글자 질문으로 바꾸세요(소리 끄고 보는 사람이 많습니다).',
  ending: '끝까지 보는데 반응이 없습니다 — 마지막 2초에 저장·공유를 부르는 한 줄을 넣고, 엔딩을 시작 장면으로 이어 루프를 만드세요.',
  reach: '반응은 좋은데 조회가 적습니다 — 이 포맷은 유지하고 발행 시간대와 첫 장면 제목만 바꿔 3편 시험하세요.',
  keep: '세 지표 모두 우리 중위수 이상입니다 — 이 구성을 템플릿으로 고정하세요.',
  wait: '발행 사흘 안입니다 — 첫 48시간은 숫자가 계속 오르니 D+3 뒤에 판단합니다.'
};

const ORDER = { measure: 0, early: 1, ending: 1, reach: 1, insufficient: 2, keep: 3, wait: 4, old_era: 5, no_data: 6 };

/* ───────────── 작은 도구 ───────────── */

const num = (v) => (v == null || v === '' || Number.isNaN(Number(v))) ? 0 : Number(v);
const nf = (n) => (Number(n) || 0).toLocaleString('ko-KR');
const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;

export function kstToday() {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  return kst.toISOString().slice(0, 10);
}

/** 발행일 → 지난 날 수(정수). 모르면 null. */
export function dayAge(publishedAt, today) {
  const day = String(publishedAt || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const a = Date.parse(day + 'T00:00:00+09:00');
  const b = Date.parse(String(today || kstToday()).slice(0, 10) + 'T00:00:00+09:00');
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((b - a) / 86400000));
}

/** 'current' | 'old' | 'unknown' — 8/24 조회수 기준 변경 전후를 가른다. */
export function eraOf(publishedAt) {
  const day = String(publishedAt || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return 'unknown';
  return day < VIEW_ERA_DATE ? 'old' : 'current';
}

/** 중위수 + 표본 수. 값이 없으면 {value:null, n:0}. */
export function medianInfo(values) {
  const list = (values || []).filter((v) => v != null && Number.isFinite(Number(v))).map(Number).sort((a, b) => a - b);
  if (!list.length) return { value: null, n: 0 };
  const mid = Math.floor(list.length / 2);
  return { value: list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2, n: list.length };
}

/* ───────────── 지표 계산 ───────────── */

/** 반응률 % — (좋아요 + 댓글 + 공유) ÷ 조회 × 100. 조회가 0이면 null(0%로 속이지 않는다). */
export function reactionPct(row) {
  const views = num(row && row.views);
  if (views <= 0) return null;
  const react = num(row.likes) + num(row.comments) + num(row.shares);
  return react / views * 100;
}

/**
 * 평균 시청률 % — 실제로 있는 값만 쓴다.
 *   ① 유튜브가 준 평균 시청률(avg_view_pct)
 *   ② 시청시간 ÷ 조회 ÷ 길이  (시청시간이 수집된 경우)
 *   ③ 사람이 넣은 평균 시청 지속 초 ÷ 길이 (카드에 쇼츠가 한 편일 때만)
 * 길이를 모르면 계산하지 않는다(null).
 */
export function retentionOf(row, ctx) {
  const c = ctx || {};
  const r = row || {};
  const meta = (c.metaById || {})[r.external_id] || {};
  const duration = num(r.duration_sec || meta.duration_sec);
  const direct = num(r.avg_view_pct);
  if (direct > 0) return { pct: Math.min(100, direct), source: 'collected', durationSec: duration };

  if (duration > 0) {
    const views = num(r.views);
    const watch = num(r.watch_time_sec);
    if (views > 0 && watch > 0) {
      return { pct: Math.min(100, (watch / views) / duration * 100), source: 'watch_time', durationSec: duration };
    }
    const cid = String(r.content_id || '');
    const dwell = cid ? num((c.dwellByContent || {})[cid]) : 0;
    const sameCardVideos = cid ? num((c.shortsCountByContent || {})[cid]) : 0;
    if (dwell > 0 && sameCardVideos === 1) {
      return { pct: Math.min(100, dwell / duration * 100), source: 'dwell', durationSec: duration, dwellSec: dwell };
    }
  }
  return null;
}

/* ───────────── 진단 ───────────── */

/** 평균 시청 비율(%) → 평균 시청 지속(초). 둘 다 실제 값이라 이 변환은 추정이 아니다. 잘못된 값이면 0. */
export function dwellSecFromPct(pct, durationSec) {
  const p = Number(pct);
  const d = Number(durationSec);
  if (!(p > 0) || !(d > 0) || p > 100) return 0;
  return Math.round((p / 100) * d * 10) / 10;
}

function prescribe(v, basis) {
  const lowReaction = basis.reaction.value != null && v.reaction_pct != null
    && v.reaction_pct < basis.reaction.value * LOW_REACTION_RATIO;

  if (!v.views) return { bottleneck: 'no_data', prescription: PRESCRIPTION.no_data, detail: '' };
  if (v.era === 'old') return { bottleneck: 'old_era', prescription: PRESCRIPTION.old_era, detail: '조회 ' + nf(v.views) };
  if (v.age_days != null && v.age_days < MIN_AGE_DAYS) {
    return { bottleneck: 'wait', prescription: PRESCRIPTION.wait, detail: 'D+' + v.age_days };
  }

  if (v.retention_pct == null) {
    if (v.dwell_sec > 0 && !v.duration_sec) {
      return {
        bottleneck: 'measure',
        prescription: '시청 지속 ' + round1(v.dwell_sec) + '초는 저장했습니다 — 영상 길이가 들어오면 %로 환산됩니다(Media_Meta 갱신).',
        detail: '반응률 ' + (v.reaction_pct == null ? '—' : round1(v.reaction_pct) + '%')
      };
    }
    const extra = lowReaction
      ? ' 반응률도 우리 중위수의 ' + Math.round(v.reaction_pct / basis.reaction.value * 100) + '%로 낮습니다 — 첫 장면 글자 질문을 같이 바꿔 보세요.'
      : '';
    return {
      bottleneck: 'measure',
      prescription: PRESCRIPTION.measure + extra,
      detail: '반응률 ' + (v.reaction_pct == null ? '—' : round1(v.reaction_pct) + '%')
    };
  }

  if (basis.retention.n < MEDIAN_MIN) {
    return {
      bottleneck: 'insufficient',
      prescription: PRESCRIPTION.insufficient,
      detail: '시청률 ' + round1(v.retention_pct) + '% · 표본 ' + basis.retention.n + '/' + MEDIAN_MIN + '편'
    };
  }

  const lowRet = v.retention_pct < basis.retention.value * LOW_RETENTION_RATIO;
  if (lowRet) {
    return {
      bottleneck: 'early',
      prescription: PRESCRIPTION.early,
      detail: '시청률 ' + round1(v.retention_pct) + '% · 중위 ' + round1(basis.retention.value) + '%'
    };
  }
  if (lowReaction) {
    return {
      bottleneck: 'ending',
      prescription: PRESCRIPTION.ending,
      detail: '반응률 ' + round1(v.reaction_pct) + '% · 중위 ' + round1(basis.reaction.value) + '%'
    };
  }
  if (basis.views.value != null && v.views < basis.views.value * LOW_VIEW_RATIO) {
    return {
      bottleneck: 'reach',
      prescription: PRESCRIPTION.reach,
      detail: '조회 ' + nf(v.views) + ' · 중위 ' + nf(Math.round(basis.views.value))
    };
  }
  return { bottleneck: 'keep', prescription: PRESCRIPTION.keep, detail: '시청률 ' + round1(v.retention_pct) + '% · 반응률 ' + round1(v.reaction_pct) + '%' };
}

/**
 * 영상 목록 → 진단 카드 데이터.
 * @param {Array} videos 최신 수집 행(currentRows 결과) — 유튜브 쇼츠만
 * @param {{today?:string, metaById?:object, dwellByContent?:object, shortsCountByContent?:object}} ctx
 * @returns {{items:Array, basis:object, today:string}}
 */
export function diagnoseVideos(videos, ctx) {
  const c = ctx || {};
  const today = String(c.today || '').slice(0, 10) || kstToday();
  const metaById = c.metaById || {};

  const items = (videos || []).map((row) => {
    const meta = metaById[row.external_id] || {};
    const publishedAt = String(row.published_at || meta.published_at || '').slice(0, 10);
    const retention = retentionOf(row, c);
    return {
      external_id: String(row.external_id || ''),
      content_id: String(row.content_id || ''),
      channel: String(row.channel || 'shorts'),
      published_at: publishedAt,
      age_days: dayAge(publishedAt, today),
      era: eraOf(publishedAt),
      duration_sec: num(row.duration_sec || meta.duration_sec),
      views: num(row.views),
      likes: num(row.likes),
      comments: num(row.comments),
      shares: num(row.shares),
      reactions: num(row.likes) + num(row.comments) + num(row.shares),
      reaction_pct: reactionPct(row),
      retention_pct: retention ? retention.pct : null,
      retention_source: retention ? retention.source : '',
      retention_dwell: retention && retention.dwellSec ? retention.dwellSec : 0,
      /* 카드에 넣은 평균 시청 지속(초) — 길이를 몰라도 입력은 되게 따로 남긴다. */
      dwell_sec: (String(row.content_id || '') && num((c.shortsCountByContent || {})[String(row.content_id || '')]) === 1)
        ? num((c.dwellByContent || {})[String(row.content_id || '')]) : 0
    };
  });

  /* 옛 기준(8/24 이전) 영상은 비교 기준에서 뺀다 — 부풀려진 조회로 중위수를 흔들지 않게. */
  const comparable = items.filter((v) => v.era !== 'old');
  const basis = {
    reaction: medianInfo(comparable.filter((v) => v.reaction_pct != null).map((v) => v.reaction_pct)),
    retention: medianInfo(comparable.filter((v) => v.retention_pct != null).map((v) => v.retention_pct)),
    views: medianInfo(comparable.filter((v) => v.views > 0).map((v) => v.views))
  };

  const out = items.map((v) => {
    const d = prescribe(v, basis);
    return Object.assign({}, v, {
      bottleneck: d.bottleneck,
      label: BOTTLENECK_LABEL[d.bottleneck] || d.bottleneck,
      prescription: d.prescription,
      detail: d.detail
    });
  });

  out.sort((a, b) => {
    const oa = ORDER[a.bottleneck] == null ? 9 : ORDER[a.bottleneck];
    const ob = ORDER[b.bottleneck] == null ? 9 : ORDER[b.bottleneck];
    if (oa !== ob) return oa - ob;
    return b.views - a.views;
  });

  return { items: out, basis, today };
}

/* ───────────── 화면 ───────────── */

const metaCache = { at: 0, map: {}, loading: false, failedAt: 0 };
const META_TTL_MS = 5 * 60 * 1000;
const META_RETRY_MS = 30 * 1000;   // 실패하면 30초 뒤 다시 시도(성공 전 5분을 비우지 않게)
const MAX_META_IDS = 200;

/** 자동 수집 캐시가 '지금 불러오는 중'이면 끝날 때까지 조금 기다린다(다른 패널이 같이 부른다). */
async function readyAnalytics(api, brand) {
  const cache = await getAnalytics(api, brand);
  if (cache && cache.loading) await waitAnalytics();
  return cache;
}

async function loadMeta(api, videos) {
  if (!videos.length) return metaCache.map;
  const failedRecently = metaCache.failedAt && (Date.now() - metaCache.failedAt) < META_RETRY_MS;
  if (failedRecently) return metaCache.map;      // 방금 실패 — 30초 뒤 다시
  const ttlExpired = Date.now() - metaCache.at >= META_TTL_MS;
  /* 모자란 영상만 더 받는다 — 트랙을 바꿔도 다른 채널 영상이 비지 않게(2026-11-21 실측). */
  const wanted = videos.map((r) => r.external_id).filter(Boolean);
  const missing = wanted.filter((id) => !metaCache.map[id]);
  const ids = (ttlExpired ? wanted : missing).slice(0, MAX_META_IDS);
  if (!ids.length) return metaCache.map;
  /* 다른 그리기가 이미 부르는 중이면 끝날 때까지 기다린다 — 빈 지도로 먼저 그리면 제목·길이가 빠진 카드가 남는다. */
  if (metaCache.loading) {
    const t0 = Date.now();
    while (metaCache.loading && Date.now() - t0 < 8000) await new Promise((r) => setTimeout(r, 120));
    return metaCache.map;
  }
  metaCache.loading = true;
  try {
    const res = await api.post('list_media_meta', { source: 'youtube', ids });
    const list = (res && res.data && res.data.items) || [];
    list.forEach((m) => {
      if (!m || !m.external_id) return;
      /* 같은 영상 줄이 둘이면 빈칸을 채워 합진다 — 나중 줄이 제목만 있고 길이·발행일이 빈 경우가 있다. */
      const prev = metaCache.map[m.external_id] || {};
      metaCache.map[m.external_id] = {
        external_id: m.external_id,
        channel: m.channel || prev.channel || '',
        title: m.title || prev.title || '',
        published_at: m.published_at || prev.published_at || '',
        duration_sec: Number(m.duration_sec) || Number(prev.duration_sec) || 0
      };
    });
    metaCache.at = Date.now();
    metaCache.failedAt = 0;
  } catch (err) {
    metaCache.failedAt = Date.now();   // 제목·길이 없이 그리고, 다음 그리기에서 다시 시도
  } finally {
    metaCache.loading = false;
  }
  return metaCache.map;
}

/** Metrics 행 → {contentId: 평균 시청 지속 초}. 같은 카드는 가장 최근 기록을 쓴다. */
export function dwellByContent(rows) {
  const out = {};
  const stamp = {};
  (rows || []).forEach((r) => {
    if (!r || r.channel !== 'shorts') return;
    const cid = String(r.content_id || '');
    const dwell = num(r.avg_dwell_sec);
    if (!cid || dwell <= 0) return;
    const at = String(r.measured_at || '');
    if (!(cid in out) || at >= String(stamp[cid] || '')) { out[cid] = dwell; stamp[cid] = at; }
  });
  return out;
}

/** 카드별 쇼츠 영상 수 — 한 카드에 여러 편이면 카드 단위 입력을 붙이지 않는다. */
export function shortsCountByContent(videos) {
  const out = {};
  (videos || []).forEach((r) => {
    const cid = String((r && r.content_id) || '');
    if (!cid) return;
    out[cid] = (out[cid] || 0) + 1;
  });
  return out;
}

function contentName(state, contentId) {
  if (!contentId) return '';
  const c = (state.contents || []).filter((x) => x.content_id === contentId)[0];
  return c ? (c.blog_title || c.place_name || '') : '';
}

export const PANEL_TITLE = '🎯 쇼츠 3지표 진단';
export const PANEL_NOTE = '노출수·계속 시청(넘김)·재시청은 YouTube Data API에 없어 이 카드가 추정하지 않습니다. '
  + '8/24 이전 영상은 조회수 기준이 달라 비교에서 뺍니다.';

/**
 * #/perf 안에 진단 패널을 붙인다. 자동 수집분을 기다리는 동안 자리(host)만 잡아 두고 채운다.
 * @param {HTMLElement} host 이미 main 에 붙은 빈 컨테이너
 */
export function renderDiagnosisPanel(host, ctx, metricsRows) {
  const { h, state, api } = ctx;
  const brand = state.brand;

  const paint = (items, basis) => {
    while (host.firstChild) host.removeChild(host.firstChild);

    const measured = items.filter((v) => v.retention_pct != null || v.dwell_sec > 0).length;
    const panel = h('div', { class: 'panel dxp' },
      h('h3', null, PANEL_TITLE, h('span', { class: 'tag', text: '실측' })),
      h('p', { class: 'hint', text: '① 조회(재생 시작) ② 평균 시청률 ③ 반응률 — 유튜브가 준 값과 내가 넣은 값으로만 판정합니다.' }));

    if (!items.length) {
      panel.appendChild(h('div', { class: 'empty', text: '아직 수집된 쇼츠가 없습니다 — 자동 수집이 한 번 돌면 영상별로 여기에 그립니다.' }));
      panel.appendChild(h('p', { class: 'hint', style: 'margin-top:8px', text: PANEL_NOTE }));
      host.appendChild(panel);
      return;
    }

    const parts = ['쇼츠 ' + items.length + '편'];
    parts.push('시청 지속 입력 ' + measured + '편');
    if (basis.reaction.value != null) parts.push('반응률 중위 ' + round1(basis.reaction.value) + '%');
    if (basis.retention.value != null) parts.push('시청률 중위 ' + round1(basis.retention.value) + '%');
    panel.appendChild(h('p', { class: 'dx-sum', style: 'font-size:11.5px;color:var(--tx-3);margin:2px 0 8px', text: parts.join(' · ') }));

    items.slice(0, MAX_CARDS).forEach((v) => {
      panel.appendChild(videoCard(h, ctx, v, basis, host));
    });
    if (items.length > MAX_CARDS) {
      panel.appendChild(h('p', { class: 'hint', text: '최근 ' + MAX_CARDS + '편만 보입니다(나머지 ' + (items.length - MAX_CARDS) + '편은 유튜브 탭에서).' }));
    }
    panel.appendChild(h('p', { class: 'hint', style: 'margin-top:10px', text: PANEL_NOTE }));
    host.appendChild(panel);
  };

  const hostPanel = (text) => {
    while (host.firstChild) host.removeChild(host.firstChild);
    host.appendChild(h('div', { class: 'panel dxp' },
      h('h3', null, PANEL_TITLE, h('span', { class: 'tag', text: '실측' })),
      h('p', { class: 'hint', text: text })));
  };

  if (!api || !api.configured) {
    hostPanel('시트 서버를 연결하면 쇼츠별 세 지표를 여기에 세웁니다.');
    return;
  }

  hostPanel('쇼츠 지표를 불러오는 중…');

  readyAnalytics(api, brand).then(async (cache) => {
    if (!host.isConnected) return;
    if (!cache || cache.error) {
      const missing = cache && (cache.error === 'ERR_UNKNOWN_ACTION' || cache.error === 'ERR_NOT_IMPLEMENTED');
      hostPanel(missing ? '자동 수집 읽기 기능이 서버에 아직 없습니다 — GAS 재배포 뒤에 보입니다.'
        : '자동 수집 숫자를 읽지 못했습니다(' + ((cache && cache.error) || 'ERR_UNKNOWN') + ').');
      return;
    }
    const videos = currentRows(cache.rows || [], 'youtube', brand);
    const metaById = await loadMeta(api, videos);
    if (!host.isConnected) return;

    const rows = (metricsRows || []).length ? metricsRows : (state.metrics || []);
    const result = diagnoseVideos(videos, {
      today: kstToday(),
      metaById: metaById,
      dwellByContent: dwellByContent(rows),
      shortsCountByContent: shortsCountByContent(videos)
    });

    /* 렌더 직전에 제목·카드 이름을 붙인다(계산은 순수하게 둔다). */
    result.items.forEach((v) => {
      const meta = metaById[v.external_id] || {};
      v.title = String(meta.title || contentName(state, v.content_id) || ('영상 ' + String(v.external_id).slice(0, 8)));
    });
    paint(result.items, result.basis);
  }).catch(() => {
    if (host.isConnected) hostPanel('쇼츠 지표를 읽지 못했습니다. 잠시 뒤 새로고침해 보세요.');
  });
}

function videoCard(h, ctx, v, basis, host) {
  const { api, state, toast, friendlyError } = ctx;
  const card = h('div', { class: 'dx-card', style: 'border:1px solid var(--line);border-radius:12px;padding:10px;margin-top:8px' });

  const head = h('div', { style: 'display:flex;align-items:baseline;gap:6px;justify-content:space-between' },
    h('b', { style: 'font-size:12.5px;font-weight:750;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0', text: v.title || v.external_id }),
    h('span', { style: 'font-size:10.5px;color:var(--tx-3);white-space:nowrap;font-variant-numeric:tabular-nums',
      text: [v.age_days != null ? 'D+' + v.age_days : '발행일 미상', v.duration_sec ? v.duration_sec + '초' : ''].filter(Boolean).join(' · ') }));
  card.appendChild(head);

  const tiles = h('div', { style: 'display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin-top:8px' });
  const tile = (label, value, sub, dim) => h('div', { style: 'background:rgba(148,163,184,.10);border-radius:9px;padding:7px 8px;min-width:0' },
    h('div', { style: 'font-size:10px;font-weight:700;color:var(--tx-3);white-space:nowrap', text: label }),
    h('div', { style: 'font-size:15px;font-weight:820;margin-top:2px;font-variant-numeric:tabular-nums;' + (dim ? 'color:var(--tx-3)' : ''), text: value }),
    h('div', { style: 'font-size:9.5px;color:var(--tx-3);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap', text: sub || '' }));

  tiles.appendChild(tile('① 조회', nf(v.views), v.era === 'old' ? '8/24 이전 기준' : '재생 시작', false));
  tiles.appendChild(tile('② 평균 시청률',
    v.retention_pct == null ? '미수집' : round1(v.retention_pct) + '%',
    v.retention_pct != null ? (RETENTION_SOURCE_LABEL[v.retention_source] || '')
      : (v.dwell_sec ? '입력 ' + round1(v.dwell_sec) + '초 · 길이 대기' : '스튜디오에서 입력'),
    v.retention_pct == null));
  tiles.appendChild(tile('③ 반응률',
    v.reaction_pct == null ? '—' : round1(v.reaction_pct) + '%',
    '좋아요 ' + nf(v.likes) + ' · 댓글 ' + nf(v.comments) + (v.shares ? ' · 공유 ' + nf(v.shares) : ''),
    v.reaction_pct == null));
  card.appendChild(tiles);

  const verdict = h('div', { style: 'margin-top:8px;font-size:11.5px;line-height:1.45;color:var(--tx-2)' },
    h('b', { style: 'display:inline-block;color:var(--tx);margin-right:7px', text: v.label }),
    h('span', { text: v.prescription }));
  card.appendChild(verdict);
  if (v.detail) {
    card.appendChild(h('div', { style: 'margin-top:3px;font-size:10.5px;color:var(--tx-3);font-variant-numeric:tabular-nums', text: v.detail }));
  }

  /* 2지표가 비었으면 여기서 바로 넣는다 — 유튜브 스튜디오의 '평균 시청 지속(초)' 또는 '평균 시청 비율(%)'. */
  if (v.retention_pct == null && v.content_id) {
    const hasDur = v.duration_sec > 0;
    const input = h('input', {
      type: 'number', inputmode: 'decimal', min: '0', step: '0.1', placeholder: '지속(초)',
      'aria-label': (v.title || v.external_id) + ' 평균 시청 지속 초',
      style: 'width:76px;padding:5px 7px;border-radius:8px;border:1px solid var(--line);background:transparent;color:var(--tx);font-size:12px'
    });
    const pctInput = hasDur ? h('input', {
      type: 'number', inputmode: 'decimal', min: '0', max: '100', step: '0.1', placeholder: '비율(%)',
      'aria-label': (v.title || v.external_id) + ' 평균 시청 비율 %',
      style: 'width:76px;padding:5px 7px;border-radius:8px;border:1px solid var(--line);background:transparent;color:var(--tx);font-size:12px'
    }) : null;
    const btn = h('button', { class: 'btn sm primary', type: 'button', text: '넣기' });
    btn.addEventListener('click', async () => {
      const rawSec = String(input.value).trim();
      const rawPct = pctInput ? String(pctInput.value).trim() : '';
      const pct = rawPct === '' ? 0 : Number(rawPct);
      /* 비율을 넣었으면 길이로 초를 만든다 — 둘 다 실제 값이라 추정이 아니다(초로 저장해 두면 다른 화면과 같은 칸을 쓴다). */
      const sec = rawPct !== '' ? dwellSecFromPct(pct, v.duration_sec) : Number(rawSec);
      if (rawPct !== '' && !sec) { toast('평균 시청 비율은 0~100 사이로 넣어 주세요', 'err'); return; }
      if (rawPct === '' && (rawSec === '' || Number.isNaN(sec) || sec <= 0 || sec > 3600)) {
        toast('시청 지속(초)은 1~3600, 비율(%)은 0~100 사이로 넣어 주세요', 'err');
        return;
      }
      btn.disabled = true;
      btn.textContent = '저장 중…';
      try {
        await api.recordMetrics({
          items: [{
            content_id: v.content_id, channel: 'shorts', snapshot: 'LATEST',
            avg_dwell_sec: sec, measured_at: kstToday()
          }]
        });
        /* 방금 넣은 값을 화면 상태에도 반영한다(다음 새로고침 전까지). */
        state.metrics = (state.metrics || []).concat([{
          content_id: v.content_id, channel: 'shorts', snapshot: 'LATEST',
          avg_dwell_sec: sec, views: 0, valid_views: 0, search_inflow_pct: 0,
          likes_comments: 0, saves: 0, reward_krw: 0, measured_at: kstToday()
        }]);
        toast('저장 완료 · 평균 시청 지속 ' + sec + '초', 'ok');
        if (host && host.isConnected) renderDiagnosisPanel(host, ctx, state.metrics);
      } catch (err) {
        toast(friendlyError ? friendlyError(err) : '저장하지 못했습니다', 'err');
        btn.disabled = false;
        btn.textContent = '넣기';
      }
    });
    card.appendChild(h('div', { style: 'display:flex;gap:6px;align-items:center;margin-top:8px;flex-wrap:wrap' },
      h('span', { style: 'font-size:10.5px;color:var(--tx-3);white-space:nowrap', text: hasDur ? '길이 ' + v.duration_sec + '초' : '길이 미상' }),
      input, pctInput, btn));
  } else if (v.retention_pct == null && !v.content_id) {
    card.appendChild(h('p', { class: 'hint', style: 'margin-top:6px', text: '카드와 연결되지 않은 영상입니다 — tools/analytics/config.json 의 links 에 영상 ID를 넣으면 입력할 수 있습니다.' }));
  }

  return card;
}
