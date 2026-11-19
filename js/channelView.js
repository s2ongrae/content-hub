/**
 * js/channelView.js — 성과분석(#/perf)의 [유튜브] [인스타] 서브탭: 채널 목록·카드
 *
 * 하는 일
 *  · 트랙 채널셋 안의 표면만 보여 준다(트랙 A: 쇼츠 / 릴스·피드, 트랙 B: 쇼츠 / 릴스). 롱폼·채널 요약 행은 이 목록에 없다.
 *  · 현재값은 checkpoint='LATEST' 행만, 같은 영상은 가장 최근 수집 한 줄만 센다 — 누적값이라 여러 날을 더하면 중복 합산이 된다.
 *  · 카드의 '최고 반응' 줄·영상 줄을 누르면 #/post?source=…&id=… (상세, js/postView.js)로 간다.
 *  · 제목은 GAS list_media_meta 로 읽는다. 서버가 아직 모르면(재배포 전) 카드 이름·영상 ID 로 대신한다.
 *
 * 렌더링은 createElement/textContent 만 쓴다(CSP — HTML 문자열을 끼워 넣지 않는다).
 * 외부 썸네일은 CSP(img-src 'self' data:)가 막아서 그리지 않는다 — 제목·숫자만.
 */

import { getAnalytics } from './analyticsView.js?v=20261119o';
import { trackChannelsOf, CHANNEL_LABEL } from './trackChannels.js?v=20261119o';

/* 소스별로 이 화면이 다루는 표면 */
const SOURCE_SURFACES = { youtube: ['shorts'], instagram: ['reels', 'feed'] };
const SOURCE_LABEL = { youtube: '유튜브', instagram: '인스타' };
const META_MAX_IDS = 200;
const META_TTL_MS = 5 * 60 * 1000;

const metaCache = { youtube: { at: 0, map: {} }, instagram: { at: 0, map: {} } };

const nf = (n) => (Number(n) || 0).toLocaleString('ko-KR');

/** #/post 주소 — 딥링크·새로고침·뒤로가기는 해시 라우터가 그대로 처리한다. */
export function postHref(source, id, contentId) {
  const q = ['source=' + encodeURIComponent(source), 'id=' + encodeURIComponent(id)];
  if (contentId) q.push('cid=' + encodeURIComponent(contentId));
  return '#/post?' + q.join('&');
}

/**
 * 목록에 쓸 '현재' 행 — 소스·트랙 채널셋만, 같은 영상은 최근 수집 한 줄.
 *  · 보통은 checkpoint='LATEST' 행을 쓴다.
 *  · 발행 D+1·7·14·30일째는 수집기가 LATEST 대신 D1/D7/D14/D30 행을 쓴다 → 그날은 LATEST 가 없다.
 *    그때 영상이 목록에서 하루 사라지지 않도록 가장 최근 수집일(collected_date/collected_at) 행으로 폴백한다.
 * (화면 없이도 시험할 수 있게 순수 함수로 둔다)
 */
export function currentRows(rows, source, brand) {
  const surfaces = (SOURCE_SURFACES[source] || []).filter((s) => trackChannelsOf(brand).indexOf(s) >= 0);
  const newestOf = (a, b) => {
    const da = String(a.collected_date || a.collected_at || '');
    const db = String(b.collected_date || b.collected_at || '');
    if (db !== da) return db > da ? b : a;
    const ta = String(a.collected_at || '');
    const tb = String(b.collected_at || '');
    if (tb !== ta) return tb > ta ? b : a;
    return (b.views > a.views) ? b : a;
  };
  const best = new Map();      // external_id → LATEST 중 최신
  const fallback = new Map();  // external_id → LATEST 가 없을 때 쓸 최신 체크포인트 행
  (rows || []).forEach((r) => {
    if (!r || r.source !== source || !r.external_id) return;
    if (surfaces.indexOf(r.channel) < 0) return;
    if (r.checkpoint === 'LATEST') {
      const prev = best.get(r.external_id);
      best.set(r.external_id, prev ? newestOf(prev, r) : r);
      return;
    }
    if (r.checkpoint === 'channel') return;
    const prev = fallback.get(r.external_id);
    fallback.set(r.external_id, prev ? newestOf(prev, r) : r);
  });
  const out = [];
  const seen = new Set();
  best.forEach((r, id) => { out.push(r); seen.add(id); });
  fallback.forEach((r, id) => { if (!seen.has(id)) out.push(r); });
  return out;
}

/** 표면별 합계 */
export function summarizeBySurface(rows) {
  const out = {};
  rows.forEach((r) => {
    const s = out[r.channel] = out[r.channel] || { count: 0, views: 0, likes: 0, comments: 0, reach: 0, saves: 0, top: null };
    s.count += 1;
    s.views += r.views; s.likes += r.likes; s.comments += r.comments; s.reach += r.reach; s.saves += r.saves;
    const score = r.channel === 'feed' ? r.reach : r.views;
    const topScore = s.top ? (r.channel === 'feed' ? s.top.reach : s.top.views) : -1;
    if (score > topScore) s.top = r;
  });
  return out;
}

async function loadMeta(api, source, rows) {
  const entry = metaCache[source];
  if (!entry) return {};
  const fresh = Date.now() - entry.at < META_TTL_MS;
  const need = rows.filter((r) => !entry.map[r.external_id]).length;
  if (fresh && !need) return entry.map;
  const ids = rows.slice().sort((a, b) => b.views - a.views).slice(0, META_MAX_IDS).map((r) => r.external_id);
  if (!ids.length) return entry.map;
  try {
    const res = await api.post('list_media_meta', { source, ids });
    const items = (res && res.data && res.data.items) || [];
    items.forEach((m) => { entry.map[m.external_id] = m; });
    entry.at = Date.now();
  } catch (err) {
    /* 서버가 아직 이 액션을 모르거나 느리면 제목 없이 그린다 */
    entry.at = Date.now();
  }
  return entry.map;
}

function contentName(state, contentId) {
  if (!contentId) return '';
  const c = (state.contents || []).filter((x) => x.content_id === contentId)[0];
  return c ? (c.blog_title || c.place_name || '') : '';
}

function titleOf(state, row, meta) {
  const m = meta && meta[row.external_id];
  if (m && m.title) return m.title;
  return contentName(state, row.content_id) || ('영상 ' + row.external_id.slice(0, 8));
}

function metricsLine(r) {
  const parts = [];
  if (r.channel === 'feed') {
    parts.push('도달 ' + nf(r.reach));
    parts.push('저장 ' + nf(r.saves));
  } else {
    parts.push('조회 ' + nf(r.views));
    parts.push(r.channel === 'reels' ? '저장 ' + nf(r.saves) : '좋아요 ' + nf(r.likes));
  }
  return parts.join(' · ');
}

export async function renderChannelView(main, ctx, source) {
  const { h, state, api, banner } = ctx;
  const brand = state.brand;
  const surfaces = (SOURCE_SURFACES[source] || []).filter((s) => trackChannelsOf(brand).indexOf(s) >= 0);
  const host = h('div');
  main.appendChild(host);

  if (!surfaces.length) {
    host.appendChild(h('div', { class: 'panel' },
      h('h3', null, SOURCE_LABEL[source] + ' 채널 없음'),
      h('p', { class: 'hint', text: '이 브랜드는 ' + SOURCE_LABEL[source] + ' 채널을 운영하지 않습니다.' })));
    return;
  }

  host.appendChild(h('div', { class: 'panel' }, h('p', { class: 'hint', text: '불러오는 중…' })));
  const cache = await getAnalytics(api, brand);
  if (!host.isConnected) return;                 // 그 사이 다른 화면으로 넘어갔다
  while (host.firstChild) host.removeChild(host.firstChild);

  if (cache.error === 'ERR_NO_CONFIG') {
    host.appendChild(h('div', { class: 'panel' }, h('p', { class: 'hint', text: 'GAS 를 연결하면 자동 수집 숫자가 여기에 보입니다.' })));
    return;
  }
  if (cache.error) {
    const msg = (cache.error === 'ERR_UNKNOWN_ACTION' || cache.error === 'ERR_NOT_IMPLEMENTED')
      ? '자동 수집 읽기 기능이 서버에 아직 없습니다 — GAS 를 재배포하면 보입니다.'
      : '자동 수집 숫자를 읽지 못했습니다(' + cache.error + '). 잠시 뒤 새로고침해 보세요.';
    host.appendChild(banner ? banner('info', 'ⓘ', '수집분 준비 중', msg) : h('div', { class: 'panel' }, h('p', { class: 'hint', text: msg })));
    return;
  }

  const rows = currentRows(cache.rows, source, brand);
  const sums = summarizeBySurface(rows);
  const meta = rows.length ? await loadMeta(api, source, rows) : {};
  if (!host.isConnected) return;

  /* ① 채널 카드 */
  const grid = h('div', { class: 'ch-grid' });
  surfaces.forEach((ch) => {
    const s = sums[ch];
    const card = s && s.top
      ? h('a', { class: 'ch-card', href: postHref(source, s.top.external_id, s.top.content_id), 'data-ch': ch,
        'aria-label': CHANNEL_LABEL[ch] + ' 채널 — 가장 반응 좋은 영상 보기' })
      : h('div', { class: 'ch-card is-empty', 'data-ch': ch });
    card.appendChild(h('div', { class: 'ch-card-head' },
      ctx.channelIcon ? ctx.channelIcon(ch, 14) : null,
      h('b', { text: SOURCE_LABEL[source] + ' ' + CHANNEL_LABEL[ch] }),
      h('span', { class: 'tag', text: s ? s.count + '개' : '0개' })));
    if (!s) {
      card.appendChild(h('div', { class: 'ch-empty', text: '⏳ 수집 대기 중' }));
    } else {
      const big = ch === 'feed' ? s.reach : s.views;
      card.appendChild(h('div', { class: 'ch-big' },
        h('span', { class: 'ch-big-v', text: nf(big) }),
        h('span', { class: 'ch-big-k', text: ch === 'feed' ? '도달 합계' : '조회 합계' })));
      card.appendChild(h('div', { class: 'ch-sub', text: ch === 'feed'
        ? '좋아요 ' + nf(s.likes) + ' · 저장 ' + nf(s.saves)
        : (ch === 'reels' ? '저장 ' + nf(s.saves) + ' · ' : '') + '좋아요 ' + nf(s.likes) + ' · 댓글 ' + nf(s.comments) }));
      card.appendChild(h('div', { class: 'ch-top', text: '최고 반응 · ' + titleOf(state, s.top, meta) + ' →' }));
    }
    grid.appendChild(card);
  });
  host.appendChild(grid);

  /* ② 영상 목록 */
  const panel = h('div', { class: 'panel' },
    h('h3', null, SOURCE_LABEL[source] + ' 게시물', h('span', { class: 'tag', text: String(rows.length) })));
  if (!rows.length) {
    panel.appendChild(h('div', { class: 'empty', text: '⏳ 수집 대기 중 — 자동 수집이 한 번 돌고 나면 여기에 쌓입니다.' }));
  } else {
    const list = h('div', { class: 'list' });
    rows.slice().sort((a, b) => (b.channel === 'feed' ? b.reach : b.views) - (a.channel === 'feed' ? a.reach : a.views)).forEach((r) => {
      const linked = contentName(state, r.content_id);
      list.appendChild(h('a', { class: 'lrow', href: postHref(source, r.external_id, r.content_id) },
        h('div', { class: 'l-main' },
          h('div', { class: 'l-title', text: titleOf(state, r, meta) }),
          h('div', { class: 'l-sub', text: [CHANNEL_LABEL[r.channel], metricsLine(r), r.content_id ? (linked || r.content_id) : '카드 미연결'].filter(Boolean).join(' · ') })),
        h('div', { class: 'l-side' }, h('span', { class: 'l-go', 'aria-hidden': 'true', text: '›' }))));
    });
    panel.appendChild(list);
  }
  panel.appendChild(h('p', { class: 'hint', style: 'margin-top:10px',
    text: '같은 영상은 가장 최근에 수집한 값 하나만 셉니다(누적값을 날마다 더하지 않아요). 숫자는 매일 아침 자동으로 갱신됩니다.' }));
  host.appendChild(panel);
}
