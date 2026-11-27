/**
 * js/postView.js — 콘텐츠 상세(#/post?source=…&id=…[&cid=…])
 *
 * 보여 주는 것
 *  · 지표 카드 3개 · 순수 SVG 추이 차트(외부 라이브러리 없음) · 체크포인트(D1/D7/D14/D30/LATEST)
 *  · 같은 소재의 트랙 채널 비교 — 트랙 채널셋 안의 칸만, 일부러 건너뛴(SKIPPED) 채널은 넣지 않는다.
 *    클립·당근은 지표 API 가 없어 '게시 완료(지표 없음)', 아직이면 상태 라벨.
 *  · 빈값(수집 전 '⏳ 수집 대기 중')·미연결(content_id 없음) 안내 문구
 *
 * 데이터: GAS get_post_detail (gas/PostDetail.gs). 서버가 아직 모르면 배포 안내만 보여 준다.
 * 딥링크·새로고침·뒤로가기는 해시 라우터(app.js)가 그대로 처리한다 — 이 화면은 주소만 읽는다.
 * 렌더링은 createElement/textContent 만 쓴다(CSP — HTML 문자열을 끼워 넣지 않는다).
 */

import { postHref } from './channelView.js?v=20261127c';
import { CHANNEL_LABEL, DONE_STATES, NO_METRIC_CHANNELS, trackChannelsOf } from './trackChannels.js?v=20261123c';
import { loadingPanel, errorPanel, isDeployGap } from './uiState.js?v=20261126a';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SOURCES = ['youtube', 'instagram', 'blog'];
const CP_LABEL = { D1: 'D+1', D7: 'D+7', D14: 'D+14', D30: 'D+30', LATEST: '최근' };
const SOURCE_LABEL = { youtube: '유튜브', instagram: '인스타', blog: '블로그' };

const nf = (n) => (Number(n) || 0).toLocaleString('ko-KR');

/** 해시(#/post?source=…&id=…&cid=…)에서 값을 읽는다. 올바르지 않으면 null. */
export function parsePostHash(hash) {
  const q = String(hash || '').split('?')[1] || '';
  const p = new URLSearchParams(q);
  const source = (p.get('source') || '').trim();
  const id = (p.get('id') || '').trim();
  const cid = (p.get('cid') || '').trim();
  if (SOURCES.indexOf(source) < 0 || !id || id.length > 64) return null;
  if (!/^[A-Za-z0-9_.-]+$/.test(id)) return null;
  if (cid && !/^[A-Za-z0-9_.-]{1,64}$/.test(cid)) return null;
  return { source, id, cid };
}

/** 칸 상태 → 화면 말 (PUBLISHING 은 '올리는 중'으로 지연이 보이게) */
export function statusText(status, channelLabelFn) {
  if (status === 'PUBLISHING') return '올리는 중';
  if (channelLabelFn) return channelLabelFn(status);
  if (!status) return '아직';
  if (DONE_STATES.indexOf(status) >= 0) return '올림';
  if (status === 'FAILED' || status === 'PARTIAL_FAIL') return '실패';
  return '대기';
}

function fmtDuration(sec) {
  const s = Number(sec) || 0;
  if (!s) return '';
  return s >= 60 ? Math.floor(s / 60) + '분 ' + (s % 60 ? (s % 60) + '초' : '') : s + '초';
}

/* ───────────── 순수 SVG 추이 차트 ───────────── */

function svgEl(name, attrs) {
  const el = document.createElementNS(SVG_NS, name);
  Object.keys(attrs || {}).forEach((k) => el.setAttribute(k, String(attrs[k])));
  return el;
}

/** points: [{label:'YYYY-MM-DD', value:number}] — 두 점 이상일 때만 선을 그린다. */
export function trendChart(points, opts) {
  const o = opts || {};
  const W = 520, H = 210, L = 54, R = 14, T = 14, B = 30;
  const svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'trend-svg', role: 'img', preserveAspectRatio: 'xMidYMid meet' });
  svg.setAttribute('aria-label', (o.title || '추이') + ' — 점 ' + points.length + '개');
  const title = svgEl('title');
  title.textContent = (o.title || '추이') + (points.length ? ' · ' + points[0].label + ' ~ ' + points[points.length - 1].label : '');
  svg.appendChild(title);

  const max = Math.max.apply(null, points.map((p) => p.value).concat([1]));
  const x = (i) => L + (points.length <= 1 ? 0 : (i / (points.length - 1)) * (W - L - R));
  const y = (v) => T + (1 - v / max) * (H - T - B);

  [0, 0.5, 1].forEach((t) => {
    const yy = T + (1 - t) * (H - T - B);
    svg.appendChild(svgEl('line', { x1: L, x2: W - R, y1: yy, y2: yy, class: 'trend-grid' }));
    const tx = svgEl('text', { x: L - 6, y: yy + 4, class: 'trend-axis', 'text-anchor': 'end' });
    tx.textContent = nf(Math.round(max * t));
    svg.appendChild(tx);
  });
  if (points.length) {
    const first = svgEl('text', { x: L, y: H - 8, class: 'trend-axis', 'text-anchor': 'start' });
    first.textContent = points[0].label.slice(5);
    svg.appendChild(first);
    if (points.length > 1) {
      const last = svgEl('text', { x: W - R, y: H - 8, class: 'trend-axis', 'text-anchor': 'end' });
      last.textContent = points[points.length - 1].label.slice(5);
      svg.appendChild(last);
    }
  }
  if (points.length > 1) {
    svg.appendChild(svgEl('polyline', {
      class: 'trend-line', fill: 'none',
      points: points.map((p, i) => x(i).toFixed(1) + ',' + y(p.value).toFixed(1)).join(' ')
    }));
  }
  points.forEach((p, i) => {
    const dot = svgEl('circle', { cx: x(i).toFixed(1), cy: y(p.value).toFixed(1), r: points.length > 30 ? 2 : 3.5, class: 'trend-dot' });
    const t = svgEl('title');
    t.textContent = p.label + ' · ' + nf(p.value);
    dot.appendChild(t);
    svg.appendChild(dot);
  });
  return svg;
}

/* ───────────── 지표 카드 3개 ───────────── */

function metricCards(d) {
  const cur = (d.checkpoints && d.checkpoints.LATEST) || d.latest || null;
  const none = !d.collected || !cur;
  const v = (n) => (none ? '—' : nf(n));
  if (d.source === 'blog') {
    const b = d.blog || {};
    const waiting = !d.collected;
    return [
      { k: '조회(누적)', v: waiting ? '—' : nf(b.views_total), s: waiting ? '' : '수집한 날의 합계' },
      { k: '최근 7일 조회', v: waiting ? '—' : nf(b.views_7d), s: '' },
      { k: '공감 · 댓글', v: b.sympathy_cnt == null ? '—' : nf(b.sympathy_cnt) + ' · ' + nf(b.comment_cnt), s: '' }
    ];
  }
  if (d.channel === 'feed') {
    return [
      { k: '도달', v: v(cur && cur.reach), s: '' },
      { k: '좋아요 · 댓글', v: none ? '—' : nf(cur.likes) + ' · ' + nf(cur.comments), s: '' },
      { k: '저장 · 공유', v: none ? '—' : nf(cur.saves) + ' · ' + nf(cur.shares), s: '' }
    ];
  }
  if (d.source === 'instagram') {
    return [
      { k: '조회', v: v(cur && cur.views), s: '' },
      { k: '도달', v: v(cur && cur.reach), s: '' },
      { k: '저장 · 공유', v: none ? '—' : nf(cur.saves) + ' · ' + nf(cur.shares), s: '' }
    ];
  }
  return [
    { k: '조회', v: v(cur && cur.views), s: '' },
    { k: '좋아요 · 댓글', v: none ? '—' : nf(cur.likes) + ' · ' + nf(cur.comments), s: '' },
    { k: '평균 시청률', v: none || !cur.avg_view_pct ? '—' : Math.round(cur.avg_view_pct) + '%', s: cur && cur.avg_view_pct ? '' : '수집 전' }
  ];
}

/* ───────────── 채널 비교 ───────────── */

function compareMetrics(e) {
  const m = e.metrics || {};
  if (e.channel === 'blog') return [['조회', nf(m.views)], ['7일', nf(m.views_7d)]];
  if (e.channel === 'shorts') return [['조회', nf(m.views)], ['좋아요', nf(m.likes)]];
  if (e.channel === 'reels') return [['조회', nf(m.views)], ['도달', nf(m.reach)]];
  if (e.channel === 'feed') return [['도달', nf(m.reach)], ['저장', nf(m.saves)]];
  return [];
}

function comparePanel(ctx, d) {
  const { h } = ctx;
  const allowed = d.track_channels && d.track_channels.length ? d.track_channels : trackChannelsOf(d.brand);
  const entries = (d.compare || []).filter((e) => allowed.indexOf(e.channel) >= 0 && e.status !== 'SKIPPED');
  const done = entries.filter((e) => DONE_STATES.indexOf(e.status) >= 0).length;

  const panel = h('div', { class: 'panel' },
    h('h3', null, '같은 소재의 채널별 성과',
      entries.length ? h('span', { class: 'tag', text: '게시 ' + done + '/' + entries.length + (done === entries.length ? ' 완료' : '') }) : null));

  if (!d.linked) {
    panel.appendChild(h('div', { class: 'empty', text: d.content_missing
      ? '이 주소의 카드를 찾지 못했어요. 카드가 지워졌거나 주소가 오래됐을 수 있어요.'
      : '아직 허브 카드와 연결되지 않은 게시물이에요. 수집 설정의 links 에 이 영상 ID → 카드 ID 를 넣으면 같은 소재의 다른 채널과 나란히 볼 수 있어요.' }));
    return panel;
  }
  if (!entries.length) {
    panel.appendChild(h('div', { class: 'empty', text: '비교할 채널이 없어요.' }));
    return panel;
  }

  const grid = h('div', { class: 'cmp-grid' });
  entries.forEach((e) => {
    const isDone = DONE_STATES.indexOf(e.status) >= 0;
    const noApi = NO_METRIC_CHANNELS.indexOf(e.channel) >= 0 || e.has_metrics_api === false;
    const canOpen = !noApi && e.external_id && e.collected && e.source
      && !(e.source === d.source && e.external_id === d.external_id);
    const card = h(canOpen ? 'a' : 'div', Object.assign({ class: 'cmp-card', 'data-ch': e.channel, 'data-state': isDone ? 'done' : 'wait' },
      canOpen ? { href: postHref(e.source, e.external_id, d.content_id) } : {}));
    card.appendChild(h('div', { class: 'cmp-head' },
      ctx.channelIcon ? ctx.channelIcon(e.channel, 13) : null,
      h('b', { text: CHANNEL_LABEL[e.channel] || e.channel }),
      h('span', { class: 'cmp-status' + (isDone ? ' done' : ''), text: statusText(e.status, ctx.channelLabel) })));
    const body = h('div', { class: 'cmp-body' });
    if (noApi) {
      body.appendChild(h('span', { class: 'cmp-note', text: isDone ? '게시 완료(지표 없음)' : statusText(e.status, ctx.channelLabel) }));
    } else if (e.collected && e.metrics) {
      compareMetrics(e).forEach(([k, val]) => {
        body.appendChild(h('span', { class: 'cmp-m' }, h('em', { text: k }), h('strong', { text: val })));
      });
    } else {
      body.appendChild(h('span', { class: 'cmp-note', text: isDone ? '⏳ 수집 대기 중' : statusText(e.status, ctx.channelLabel) }));
    }
    card.appendChild(body);
    grid.appendChild(card);
  });
  panel.appendChild(grid);
  return panel;
}

/* ───────────── 본체 ───────────── */

function back(ctx, source) {
  const { h, state } = ctx;
  const target = source === 'blog' ? '#/blog' : '#/perf';
  return h('a', {
    class: 'btn sm', href: target, text: source === 'blog' ? '← 내 블로그' : '← 성과분석',
    onclick: () => { if (source !== 'blog') state.perfTab = source; }
  });
}

function infoPanel(ctx, title, text) {
  return ctx.h('div', { class: 'panel' }, ctx.h('h3', null, title), ctx.h('p', { class: 'hint', text }));
}

export async function renderPostView(main, ctx) {
  const { h, state, api, pageHead } = ctx;
  const hashAtStart = location.hash;
  const q = parsePostHash(hashAtStart);

  if (!q) {
    main.appendChild(pageHead('콘텐츠 상세', '', h('a', { class: 'btn sm', href: '#/perf', text: '← 성과분석' })));
    main.appendChild(infoPanel(ctx, '주소가 올바르지 않아요', '성과분석 화면에서 영상을 눌러 들어와 주세요.'));
    return;
  }

  main.appendChild(pageHead('콘텐츠 상세', SOURCE_LABEL[q.source], back(ctx, q.source)));
  if (api.mode === 'unconfigured' || !api.configured) {
    main.appendChild(infoPanel(ctx, '⚙︎ 연결이 필요해요', 'GAS URL과 API 토큰을 연결하면 상세 숫자를 읽어 옵니다.'));
    return;
  }

  const host = h('div');
  main.appendChild(host);
  host.appendChild(loadingPanel(h, '상세 숫자를 불러오는 중이에요…'));

  let d;
  try {
    const res = await api.post('get_post_detail', { source: q.source, external_id: q.id, content_id: q.cid, brand: 'ALL' });
    d = res && res.data;
  } catch (err) {
    if (location.hash !== hashAtStart) return;
    while (host.firstChild) host.removeChild(host.firstChild);
    host.appendChild(errorPanel(h, err, {
      title: '상세를 열지 못했어요',
      text: (err && err.code === 'ERR_NOT_FOUND') ? '이 트랙에서 운영하지 않는 채널의 게시물이에요.'
        : (err && err.code === 'ERR_BLOG_SKIPPED') ? '이 트랙은 블로그를 운영하지 않아요.' : '',
      hint: isDeployGap(err) ? 'gas/PostDetail.gs 를 붙여 넣고 새 버전으로 배포하면 이 화면이 열립니다.' : '연결이 돌아오면 다시 눌러 보세요.',
      onRetry: () => { if (ctx.renderRoute) ctx.renderRoute(); }
    }));
    return;
  }
  if (location.hash !== hashAtStart) return;               // 그 사이 다른 화면·다른 게시물로 이동했다
  while (host.firstChild) host.removeChild(host.firstChild);
  if (!d) { host.appendChild(infoPanel(ctx, '상세를 열지 못했어요', '서버가 빈 응답을 보냈어요.')); return; }

  /* ① 제목 */
  const meta = d.meta || {};
  const card = d.linked ? (state.contents || []).filter((c) => c.content_id === d.content_id)[0] : null;
  const title = meta.title || (card && (card.blog_title || card.place_name)) || (SOURCE_LABEL[d.source] + ' ' + d.external_id.slice(0, 11));
  const bits = [CHANNEL_LABEL[d.channel] || SOURCE_LABEL[d.source]];
  if (meta.published_at) bits.push(String(meta.published_at).slice(0, 10) + ' 발행');
  if (meta.duration_sec) bits.push(fmtDuration(meta.duration_sec));
  host.appendChild(h('div', { class: 'panel post-head' },
    h('h2', { class: 'post-title', text: title }),
    h('div', { class: 'post-sub', text: bits.join(' · ') }),
    meta.url ? h('a', { class: 'post-link', href: meta.url, target: '_blank', rel: 'noopener noreferrer', text: '원문 열기 ↗' }) : null));

  if (!d.collected) {
    host.appendChild(h('div', { class: 'panel' },
      h('p', { class: 'wait-note', text: '⏳ 수집 대기 중' }),
      h('p', { class: 'hint', text: '아직 이 게시물의 숫자가 모이지 않았어요. 자동 수집(매일 아침)이 한 번 돌고 나면 여기에 채워집니다.' })));
  }

  /* ② 지표 카드 3개 */
  const kpis = h('div', { class: 'kpi-grid' });
  metricCards(d).forEach((m) => kpis.appendChild(h('div', { class: 'kpi' },
    h('div', { class: 'kpi-k', text: m.k }),
    h('div', { class: 'kpi-v', text: m.v }),
    m.s ? h('div', { class: 'kpi-s', text: m.s }) : null)));
  host.appendChild(kpis);

  /* ③ 추이 */
  const points = (d.daily || []).map((p) => ({ label: String(p.collected_date || '').slice(0, 10), value: Number(p.views) || 0 }))
    .filter((p) => p.label);
  const trend = h('div', { class: 'panel' },
    h('h3', null, d.source === 'blog' ? '일별 조회 추이' : '조회 추이(누적)', h('span', { class: 'tag', text: points.length + '일' })));
  if (points.length >= 2) {
    trend.appendChild(trendChart(points, { title: d.source === 'blog' ? '일별 조회' : '누적 조회' }));
  } else if (points.length === 1) {
    trend.appendChild(h('div', { class: 'empty', text: '수집이 하루 쌓였어요 — 이틀 이상 쌓이면 추이를 그려 드려요.' }));
  } else {
    trend.appendChild(h('div', { class: 'empty', text: '⏳ 수집 대기 중 — 아직 그릴 숫자가 없어요.' }));
  }
  if (d.source !== 'blog') {
    const cps = ['D1', 'D7', 'D14', 'D30', 'LATEST'].filter((k) => d.checkpoints && d.checkpoints[k]);
    if (cps.length) {
      const row = h('div', { class: 'cp-row' });
      cps.forEach((k) => row.appendChild(h('span', { class: 'cp-chip' },
        h('em', { text: CP_LABEL[k] }), h('strong', { text: nf(d.checkpoints[k].views) }))));
      trend.appendChild(row);
      trend.appendChild(h('p', { class: 'hint', text: '발행 후 D+1·7·14·30일째 값(조회)과 가장 최근 값입니다. 아직 지나지 않은 시점은 보이지 않아요.' }));
    }
  }
  host.appendChild(trend);

  /* ④ 블로그 전용: 검색어·유입 */
  if (d.source === 'blog' && d.blog) {
    const kw = d.blog.keywords_7d || [];
    const inflow = d.blog.inflow_7d || [];
    const p = h('div', { class: 'panel' }, h('h3', null, '검색어 · 유입 경로(최근 7일)'));
    if (!kw.length && !inflow.length) {
      p.appendChild(h('div', { class: 'empty', text: '⏳ 수집 대기 중 — 네이버 통계가 들어오면 채워져요.' }));
    } else {
      const two = h('div', { class: 'two-col' });
      const colOf = (label, items, key) => {
        const c = h('div', null, h('div', { class: 'kpi-k', text: label }));
        items.slice(0, 8).forEach((it) => c.appendChild(h('div', { class: 'kv' },
          h('span', { text: it[key] }), h('strong', { text: nf(it.count) + (it.pct != null ? ' · ' + it.pct + '%' : '') }))));
        return c;
      };
      two.appendChild(colOf('검색어', kw, 'keyword'));
      two.appendChild(colOf('유입 경로', inflow, 'channel'));
      p.appendChild(two);
    }
    p.appendChild(h('p', { class: 'hint', style: 'margin-top:8px', text: d.blog.scope_note || '' }));
    host.appendChild(p);
  }

  /* ⑤ 트랙 채널 비교 */
  host.appendChild(comparePanel(ctx, d));
}
