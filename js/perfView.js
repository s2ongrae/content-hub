/**
 * js/perfView.js — 성과분석 화면(#/perf)
 *
 * 큰 숫자 3개(이번 주 유효조회 · 당월 누적 리워드 · 당근 달성률) + '오늘 입력할 숫자' 입력함
 * + D+7 승자(🏆)·D+14 리프레시(🔄) 배지 + 최근 기록.
 *
 * 서브탭 [전체 | 유튜브 | 인스타]: 전체는 아래 기존 화면, 유튜브·인스타는 js/channelView.js(채널 목록·상세 드릴다운).
 * 입력 채널(수동 입력함·오늘 입력할 숫자)은 그 카드 트랙의 채널셋만 보인다(js/trackChannels.js).
 *
 * 데이터: GAS list_metrics / record_metrics (Metrics 시트). 서버가 아직 그 액션을 모르면
 * (= GAS 재배포 전) 화면은 그대로 그리고 숫자 입력만 조용히 막는다 — 빨간 오류로 겁주지 않는다.
 *
 * 계산 규칙
 *  · 조회·유효시청은 누적값이다 → 같은 (카드 · 채널) 안에서는 기간 내 최댓값만 센다(두 번 세지 않음).
 *  · 승자: D+7 값이 같은 채널의 D+7 중위수 2배 이상.
 *  · 리프레시: D+14 검색유입이 D+7의 70% 이하로 떨어짐.
 */

import { renderAnalyticsPanel } from './analyticsView.js?v=20261119o';
import { renderChannelView } from './channelView.js?v=20261119o';
import { trackChannelsOf } from './trackChannels.js?v=20261119o';

const PERF_CHANNELS = ['blog', 'shorts', 'reels', 'clip', 'daangn'];
const CH_LABEL = { blog: '블로그', shorts: '쇼츠', reels: '릴스', clip: '클립', daangn: '당근' };
const CHECKPOINTS = ['D1', 'D7', 'D14', 'D30'];
const DUE_DAYS = [1, 7, 14];

const FIELDS = {
  blog: [{ k: 'views', label: '조회', min: 0 }, { k: 'search_inflow_pct', label: '검색유입 %', min: 0, max: 100 }],
  shorts: [{ k: 'views', label: '조회', min: 0 }, { k: 'avg_dwell_sec', label: '시청지속 초', min: 0 }],
  reels: [{ k: 'views', label: '조회', min: 0 }, { k: 'saves', label: '저장', min: 0 }],
  clip: [{ k: 'views', label: '조회', min: 0 }],
  daangn: [{ k: 'valid_views', label: '유효시청', min: 0 }, { k: 'likes_comments', label: '좋아요', min: 0 }, { k: 'reward_krw', label: '기본보상 원', min: 0 }]
};

let loading = false;

/* ───────────── 날짜(한국) ───────────── */

export function kstToday() {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  return kst.toISOString().slice(0, 10);
}

function kstMonth() { return kstToday().slice(0, 7); }

function daysSince(dateStr) {
  const raw = String(dateStr || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const a = Date.parse(raw + 'T00:00:00+09:00');
  const b = Date.parse(kstToday() + 'T00:00:00+09:00');
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

function mondayOfThisWeek() {
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  const dow = now.getUTCDay();                       // 0=일
  const back = (dow + 6) % 7;                        // 월요일까지
  const mon = new Date(now.getTime() - back * 86400000);
  return mon.toISOString().slice(0, 10);
}

function monthStartShift(months) {
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months, 1));
  return d.toISOString().slice(0, 10);
}

/* ───────────── 데이터 ───────────── */

export async function loadMetrics(state, api, opts = {}) {
  if (!api || !api.configured) {
    state.metrics = [];
    state.metricsError = 'ERR_NO_CONFIG';
    return state.metrics;
  }
  if (loading) return state.metrics;
  loading = true;
  try {
    const res = await api.listMetrics({
      brand: state.brand,
      from: monthStartShift(-1),
      to: kstToday()
    });
    const rows = (res.data && (res.data.rows || res.data.items)) || [];
    state.metrics = rows.map(normalizeRow);
    state.metricsError = null;
    state.metricsAt = new Date().toISOString();
  } catch (err) {
    state.metrics = state.metrics || [];
    state.metricsError = (err && err.code) || 'ERR_UNKNOWN';
    if (!opts.quiet) { /* 화면에서 조용히 안내한다 */ }
  } finally {
    loading = false;
  }
  return state.metrics;
}

function normalizeRow(r) {
  const num = (v) => (v === '' || v == null || Number.isNaN(Number(v))) ? 0 : Number(v);
  return {
    metric_id: r.metric_id || '',
    brand: r.brand || '',
    content_id: String(r.content_id || ''),
    channel: String(r.channel || ''),
    snapshot: String(r.snapshot || r.checkpoint || ''),
    views: num(r.views),
    valid_views: num(r.valid_views),
    avg_dwell_sec: num(r.avg_dwell_sec),
    search_inflow_pct: num(r.search_inflow_pct),
    likes_comments: num(r.likes_comments),
    saves: num(r.saves),
    reward_krw: num(r.reward_krw),
    measured_at: String(r.measured_at || r.recorded_at || '')
  };
}

/* ───────────── 계산 ───────────── */

function valueOf(row) {
  const v = row.channel === 'daangn' ? row.valid_views : row.views;
  return Number(v) || 0;
}

/** 같은 (카드·채널) 안에서는 기간 내 최댓값 하나만 센다. */
function sumDistinct(rows) {
  const best = new Map();
  rows.forEach((r) => {
    const key = r.content_id + '|' + r.channel;
    if (!best.has(key) || valueOf(r) > valueOf(best.get(key))) best.set(key, r);
  });
  let total = 0;
  best.forEach((r) => { total += valueOf(r); });
  return total;
}

function median(values) {
  const list = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!list.length) return 0;
  const mid = Math.floor(list.length / 2);
  return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
}

/** 카드별 배지: 🏆 D+7 승자 패턴 / 🔄 D+14 리프레시 */
export function computeBadges(rows) {
  const out = new Map();
  const push = (id, badge) => {
    const cur = out.get(id) || [];
    if (!cur.some((b) => b.kind === badge.kind && b.channel === badge.channel)) cur.push(badge);
    out.set(id, cur);
  };

  const d7 = rows.filter((r) => r.snapshot === 'D7' && valueOf(r) > 0);
  const byChannel = new Map();
  d7.forEach((r) => {
    const list = byChannel.get(r.channel) || [];
    list.push(r);
    byChannel.set(r.channel, list);
  });
  byChannel.forEach((list, ch) => {
    const med = median(list.map(valueOf));
    if (!med) return;
    list.forEach((r) => {
      if (valueOf(r) >= med * 2) {
        push(r.content_id, { kind: 'winner', channel: ch, text: '🏆 D+7 ' + (CH_LABEL[ch] || ch) + ' ' + Math.round(valueOf(r) / med * 10) / 10 + '배' });
      }
    });
  });

  ['blog', 'reels', 'shorts'].forEach((ch) => {
    const d14 = rows.filter((r) => r.channel === ch && r.snapshot === 'D14' && r.search_inflow_pct > 0);
    d14.forEach((r) => {
      const prev = rows.filter((x) => x.channel === ch && x.content_id === r.content_id && x.snapshot === 'D7' && x.search_inflow_pct > 0)[0];
      if (prev && r.search_inflow_pct <= prev.search_inflow_pct * 0.7) {
        push(r.content_id, { kind: 'refresh', channel: ch, text: '🔄 ' + (CH_LABEL[ch] || ch) + ' 검색유입 −' + Math.round((1 - r.search_inflow_pct / prev.search_inflow_pct) * 100) + '%' });
      }
    });
  });

  return out;
}

/** 이번 달 당근 트래커 값 (daangnView daangnMonth 와 같은 규칙) */
function daangnMonthLocal(rows, month) {
  const per = new Map();
  rows.filter((r) => r.channel === 'daangn' && r.measured_at.slice(0, 7) === month).forEach((r) => {
    if (!r.content_id) return;
    const prev = per.get(r.content_id) || { valid: 0, reward: 0 };
    per.set(r.content_id, {
      valid: Math.max(prev.valid, r.valid_views),
      reward: Math.max(prev.reward, r.reward_krw)
    });
  });
  let valid = 0;
  let reward = 0;
  per.forEach((v) => { valid += v.valid; reward += v.reward; });
  return { stories: per.size, valid, reward };
}

const nf = (n) => (Number(n) || 0).toLocaleString('ko-KR');

/* ───────────── 화면 ───────────── */

export function renderPerfView(main, ctx) {
  const { h, state, api, pageHead, toast, friendlyError, banner } = ctx;
  const name = (id) => {
    const c = (state.contents || []).filter((x) => x.content_id === id)[0];
    return c ? (c.blog_title || c.place_name || id) : id;
  };

  main.appendChild(pageHead('📈 성과분석',
    trackChannelsOf(state.brand).indexOf('daangn') >= 0
      ? '이번 주 유효조회 · 당월 리워드 · 당근 달성률 — 숫자는 여기서 바로 넣습니다'
      : '이번 주 유효조회 — 숫자는 여기서 바로 넣습니다',
    h('button', {
      class: 'btn sm', type: 'button', text: '↻ 새로고침',
      onclick: async (e) => {
        e.target.disabled = true;
        await loadMetrics(state, api);
        ctx.renderRoute();
      }
    })));

  if (api.mode === 'unconfigured') {
    main.appendChild(h('div', { class: 'panel' },
      h('h3', null, '⚙︎ 연결하면 성과 숫자가 쌓입니다'),
      h('p', { class: 'hint', text: 'GAS URL과 API 토큰을 연결하면 시트의 Metrics 행을 읽어 여기에 그립니다. 연결 전에는 숫자를 저장할 수 없습니다.' })));
    return;
  }

  /* 서브탭 — 전체(아래 기존 화면) · 유튜브 · 인스타(채널 목록). 하단 탭 개수는 그대로 둔다. */
  const tab = state.perfTab === 'youtube' || state.perfTab === 'instagram' ? state.perfTab : 'all';
  main.appendChild(perfTabs(h, ctx, tab));
  if (tab !== 'all') return renderChannelView(main, ctx, tab);

  /* 이 트랙이 운영하지 않는 채널의 옛 행은 KPI·최근 기록 어디에도 남기지 않는다 */
  const trackSet = trackChannelsOf(state.brand);
  const rows = (state.metrics || []).filter((r) => trackSet.indexOf(r.channel) >= 0);
  const hasDaangn = trackSet.indexOf('daangn') >= 0;
  const month = kstMonth();
  const week = mondayOfThisWeek();
  const monthRows = rows.filter((r) => r.measured_at.slice(0, 7) === month);
  const weekRows = rows.filter((r) => r.measured_at.slice(0, 10) >= week);
  const weekViews = sumDistinct(weekRows);

  /* ① 큰 숫자 3개 */
  const dg = daangnMonthLocal(rows, month);
  const storyGoal = 5;
  const viewGoal = 2000;
  const achievedPct = Math.round(Math.min(100, Math.min(dg.stories / storyGoal, dg.valid / viewGoal) * 100));

  /* 당근 KPI 2개는 당근을 운영하는 트랙(A)에만 — 트랙 B 에는 '미운영' 칸을 남기지 않는다 */
  const kpis = h('div', { class: 'kpi-grid' },
    kpi(h, '이번 주 유효조회', nf(weekViews), '회 · ' + week + '부터'),
    hasDaangn ? kpi(h, '당월 누적 리워드', nf(dg.reward), '원 · ' + month + ' 당근 확정분') : null,
    hasDaangn ? kpi(h, '당근 달성률', String(achievedPct), '% · 스토리 ' + dg.stories + '/' + storyGoal + ' · ' + nf(dg.valid) + '/' + nf(viewGoal)) : null);
  main.appendChild(kpis);

  const status = state.metricsError;
  if (status && status !== 'ERR_NO_CONFIG') {
    const msg = (status === 'ERR_NOT_IMPLEMENTED' || status === 'ERR_UNKNOWN_ACTION' || status === 'ERR_NOT_FOUND')
      ? '성과 기록 API가 아직 서버에 없습니다 — GAS를 재배포하면 이 화면에서 숫자를 저장할 수 있습니다. 지금은 화면만 보입니다.'
      : '성과 숫자를 읽지 못했습니다(' + status + '). 잠시 뒤 새로고침해 보세요.';
    const b = banner ? banner('info', 'ⓘ', '성과 기록 준비 중', msg) : h('div', { class: 'panel' }, h('p', { class: 'hint', text: msg }));
    main.appendChild(b);
  }

  /* ①-2 유튜브·인스타 자동 수집 (js/analyticsView.js) — 블로그·클립 영역은 건드리지 않는다 */
  renderAnalyticsPanel(main, ctx);

  /* ② 오늘 입력할 숫자 */
  main.appendChild(dueSection(h, { state, api, rows, name, onSaved: () => ctx.renderRoute(), toast, friendlyError }));

  /* ③ 최근 기록 + 배지 */
  const badges = computeBadges(rows);
  const recent = rows.slice().sort((a, b) => String(b.measured_at).localeCompare(String(a.measured_at))).slice(0, 12);
  const recPanel = h('div', { class: 'panel' },
    h('h3', null, '최근 기록', h('span', { class: 'tag', text: String(rows.length) })));
  if (!recent.length) {
    recPanel.appendChild(h('div', { class: 'empty', text: '아직 기록이 없어요. 오늘 숫자를 넣으면 여기에 쌓입니다.' }));
  } else {
    const list = h('div', { class: 'list' });
    recent.forEach((r) => {
      const cardBadges = badges.get(r.content_id) || [];
      const bits = FIELD_LABELS(r);
      list.appendChild(h('div', { class: 'lrow' },
        h('div', { class: 'l-main' },
          h('div', { class: 'l-title', text: name(r.content_id) }),
          h('div', { class: 'l-sub', text: [CH_LABEL[r.channel] || r.channel, r.snapshot, r.measured_at.slice(0, 10)].filter(Boolean).join(' · ') }),
          bits ? h('div', { class: 'l-sub', style: 'color:var(--tx-2)', text: bits }) : null),
        h('div', { class: 'l-side' },
          cardBadges.length ? h('span', { class: 'perf-badge', text: cardBadges[0].text }) : null)));
    });
    recPanel.appendChild(list);
  }
  recPanel.appendChild(h('p', { class: 'hint', style: 'margin-top:10px',
    text: '🏆 D+7 값이 같은 채널 중위수의 2배 이상 = 승자 패턴 · 🔄 D+14 검색유입이 D+7의 70% 이하 = 리프레시' }));
  main.appendChild(recPanel);

  /* ④ 숫자 직접 넣기 */
  main.appendChild(manualForm(h, { state, api, toast, onSaved: () => ctx.renderRoute(), friendlyError }));
}

/** [전체 | 유튜브 | 인스타] + [블로그 통계 →] 칩(블로그를 운영하지 않는 트랙 B 에서는 숨김) */
function perfTabs(h, ctx, active) {
  const { state } = ctx;
  const list = h('div', { class: 'subtabs', role: 'tablist', 'aria-label': '성과 보기' });
  [['all', '전체'], ['youtube', '유튜브'], ['instagram', '인스타']].forEach(([key, label]) => {
    list.appendChild(h('button', {
      type: 'button', role: 'tab', class: 'subtab' + (key === active ? ' on' : ''),
      'aria-selected': key === active ? 'true' : 'false', text: label,
      onclick: () => { state.perfTab = key; ctx.renderRoute(); }
    }));
  });
  const row = h('div', { class: 'subtabs-row' }, list);
  if (trackChannelsOf(state.brand).indexOf('blog') >= 0) {
    row.appendChild(h('a', { class: 'chip-link', href: '#/blog', text: '블로그 통계 →' }));
  }
  return row;
}

function kpi(h, label, value, sub) {
  return h('div', { class: 'kpi' },
    h('div', { class: 'kpi-k', text: label }),
    h('div', { class: 'kpi-v', text: value }),
    sub ? h('div', { class: 'kpi-s', text: sub }) : null);
}

function FIELD_LABELS(r) {
  const parts = [];
  if (r.channel === 'daangn') {
    if (r.valid_views) parts.push('유효 ' + nf(r.valid_views));
    if (r.likes_comments) parts.push('좋아요 ' + nf(r.likes_comments));
    if (r.reward_krw) parts.push(nf(r.reward_krw) + '원');
    return parts.join(' · ');
  }
  if (r.views) parts.push('조회 ' + nf(r.views));
  if (r.search_inflow_pct) parts.push('검색유입 ' + r.search_inflow_pct + '%');
  if (r.saves) parts.push('저장 ' + nf(r.saves));
  if (r.avg_dwell_sec) parts.push('시청지속 ' + r.avg_dwell_sec + '초');
  return parts.join(' · ');
}

/** 그 카드가 실제로 올리는 채널 — 트랙 채널셋 ∩ 숫자를 넣을 수 있는 채널(트랙 A 5칸, 트랙 B 쇼츠·릴스·클립 3칸) */
export function channelsOf(item, fallbackBrand) {
  const set = trackChannelsOf((item && item.brand) || fallbackBrand);
  return PERF_CHANNELS.filter((c) => set.indexOf(c) >= 0);
}

function hasRow(rows, contentId, channel, snapshot) {
  return rows.some((r) => r.content_id === contentId && r.channel === channel && r.snapshot === snapshot);
}

function dueSection(h, opts) {
  const { state, api, rows, name, toast, onSaved, friendlyError } = opts;
  const host = h('div');

  const due = [];
  (state.contents || []).forEach((c) => {
    if (['PUBLISHED', 'LINKED'].indexOf(c.status) < 0) return;
    const d = daysSince(c.updated_at);
    if (d == null || DUE_DAYS.indexOf(d) < 0) return;
    const snap = 'D' + d;
    const channels = channelsOf(c, state.brand).filter((ch) => !hasRow(rows, c.content_id, ch, snap));
    if (channels.length) due.push({ item: c, snapshot: snap, channels, days: d });
  });

  const panel = h('div', { class: 'panel' },
    h('h3', null, '오늘 입력할 숫자', h('span', { class: 'tag', text: due.length ? due.length + '건' : '없음' })));
  panel.appendChild(h('p', { class: 'hint', text: '발행일(카드 최근 수정일)에서 D+1·D+7·D+14가 된 카드만 모았습니다. 채널마다 그 줄만 넣으면 됩니다.' }));

  if (!due.length) {
    panel.appendChild(h('div', { class: 'empty', text: '오늘은 D+1·D+7·D+14가 걸린 카드가 없어요. 아래에서 직접 넣을 수 있습니다.' }));
  } else {
    due.forEach((d) => {
      panel.appendChild(h('div', { class: 'due-card' },
        h('div', { class: 'due-head' },
          h('b', { text: name(d.item.content_id) }),
          h('span', { class: 'due-chip', text: d.snapshot })),
        h('div', { class: 'due-sub', text: String(d.item.updated_at || '').slice(0, 10) + ' 발행 기준 · ' + d.channels.length + '개 채널' })));
      d.channels.forEach((ch) => {
        panel.appendChild(metricRow(h, {
          contentId: d.item.content_id, channel: ch, snapshot: d.snapshot,
          api, toast, friendlyError, onSaved
        }));
      });
    });
  }
  host.appendChild(panel);
  return host;
}

/** 한 줄 = 한 채널의 숫자 + 저장 */
function metricRow(h, cfg) {
  const { contentId, channel, snapshot, toast, friendlyError, onSaved } = cfg;
  const fields = FIELDS[channel] || FIELDS.clip;
  const inputs = {};
  const row = h('div', { class: 'mrow' },
    h('span', { class: 'mch', text: CH_LABEL[channel] || channel }));
  fields.forEach((f) => {
    const input = h('input', {
      type: 'number', inputmode: 'decimal', min: String(f.min == null ? 0 : f.min),
      max: f.max != null ? String(f.max) : null, placeholder: f.label,
      'aria-label': (CH_LABEL[channel] || channel) + ' ' + f.label
    });
    inputs[f.k] = input;
    row.appendChild(h('label', { class: 'mfield' }, h('span', { text: f.label }), input));
  });
  const btn = h('button', { class: 'btn sm primary', type: 'button', text: '저장' });
  btn.addEventListener('click', async () => {
    const values = {};
    let filled = 0;
    let bad = null;
    fields.forEach((f) => {
      const raw = String(inputs[f.k].value).trim();
      if (raw === '') return;
      const num = Number(raw);
      if (Number.isNaN(num) || num < 0) { bad = f.label; return; }
      values[f.k] = num;
      filled += 1;
    });
    if (bad) { toast(bad + ' 값이 올바르지 않습니다', 'err'); return; }
    if (!filled) { toast('숫자를 하나 이상 넣어 주세요', 'err'); return; }
    btn.disabled = true;
    btn.textContent = '저장 중…';
    try {
      await cfg.api.recordMetrics({
        items: [Object.assign({
          content_id: contentId, channel, snapshot, measured_at: kstToday()
        }, values)]
      });
      toast('저장 완료 · ' + (CH_LABEL[channel] || channel) + ' ' + snapshot, 'ok');
      if (onSaved) onSaved();
    } catch (err) {
      toast(friendlyError(err), 'err');
      btn.disabled = false;
      btn.textContent = '저장';
    }
  });
  row.appendChild(btn);
  return row;
}

/** 과거 기록 채우기용 직접 입력 */
function manualForm(h, ctx) {
  const { state, toast, friendlyError, onSaved } = ctx;
  const panel = h('div', { class: 'panel' }, h('h3', null, '숫자 직접 넣기'));
  const items = (state.contents || []);
  if (!items.length) {
    panel.appendChild(h('div', { class: 'empty', text: '카드가 없습니다.' }));
    return panel;
  }

  const sel = h('select', { class: 'field-select' });
  items.forEach((c) => sel.appendChild(h('option', { value: c.content_id, text: (c.place_name || c.content_id) + ' · ' + c.content_id })));

  const ch = h('select', { class: 'field-select' });
  /* 카드를 바꾸면 그 카드 트랙의 채널만 남긴다(선택값이 아직 유효하면 유지) */
  function fillChannels() {
    const item = items.filter((x) => x.content_id === sel.value)[0];
    const keep = ch.value;
    while (ch.firstChild) ch.removeChild(ch.firstChild);
    const list = channelsOf(item, state.brand);
    list.forEach((k) => ch.appendChild(h('option', { value: k, text: CH_LABEL[k] })));
    if (list.indexOf(keep) >= 0) ch.value = keep;
  }

  const snap = h('select', { class: 'field-select' });
  CHECKPOINTS.forEach((k) => snap.appendChild(h('option', { value: k, text: k })));

  panel.appendChild(h('div', { class: 'form-grid three' },
    h('label', { class: 'field' }, h('span', { class: 'field-label', text: '카드' }), sel),
    h('label', { class: 'field' }, h('span', { class: 'field-label', text: '채널' }), ch),
    h('label', { class: 'field' }, h('span', { class: 'field-label', text: '시점' }), snap)));

  const host = h('div');
  panel.appendChild(host);

  function paint() {
    while (host.firstChild) host.removeChild(host.firstChild);
    host.appendChild(metricRow(h, {
      contentId: sel.value, channel: ch.value, snapshot: snap.value,
      toast, friendlyError, onSaved, api: ctx.api
    }));
  }
  sel.addEventListener('change', () => { fillChannels(); paint(); });
  ch.addEventListener('change', paint);
  fillChannels();
  paint();
  return panel;
}
