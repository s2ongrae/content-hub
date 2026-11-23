/**
 * frontend/js/app.js — Content Hub OS M1 화면
 *
 * 해시 라우터(#/board #/approve #/capture #/review #/knowhow #/ops),
 * 브랜드 스위처(대전 청년 ↔ 삐약 김메리), 보드·검수·취재·노하우·운영 패널.
 * 렌더링은 전부 textContent/createElement 만 쓴다(innerHTML 금지, XSS 차단).
 */

import { api, ApiError, loadConfig, saveConfig, clearToken } from './api.js';
import { QuickApproveView } from './quickApprove.js';
import { renderSeriesView } from './seriesView.js';
import { renderPerfView, loadMetrics, kstToday } from './perfView.js?v=20261123a';
import { renderPostView } from './postView.js?v=20261123a';
import { trackChannelsOf } from './trackChannels.js?v=20261123a';
import { renderLintView } from './lintView.js?v=20261123a';
import { loadDaangnSeed } from './daangnView.js?v=20261123a';
import { getAnalytics } from './analyticsView.js?v=20261123a';
import { channelRows, cardTotals, compact, daangnWarnings, daangnGoal } from './cardPerf.js?v=20261123a';
import { renderCreateView } from './create-view.js?v=20261123a';
import { renderCreateStudio } from './createStudio.js?v=20261123a';
import { renderBlogView, loadBlogStats } from './blogView.js?v=20261123a';
import { draftSection, draftPreview } from './draftView.js?v=20261123a';
import { produceSection } from './produceView.js?v=20261123a';

/* ────────────────────────── 상수 ────────────────────────── */

const BRANDS = {
  daejeon_youth: { name: '대전 청년', emoji: '🍺', channels: '블로그 · 쇼츠 · 인스타(릴스·피드) · 클립 · 당근' },
  ppiyak_kimmary: { name: '삐약 김메리', emoji: '🐱', channels: '쇼츠 · 릴스 · 클립' }
};

/* 화면에 보이는 말은 쉬운 한국어로. 시트·GAS 코드값(DRAFT·PUBLISHED·LINKED …)은 그대로 둔다. */
const STATUS_LABEL = {
  DRAFT: '초안', DRAFTING: '작성 중', GENERATING: '작성 중', EDITING: '수정 중',
  REVIEW: '확인 중', READY: '올릴 준비',
  PUBLISHING: '올리는 중', PUBLISHED: '일부 올라감', LINKED: '발행 끝',
  NEEDS_HUMAN: '확인 필요', PARTIAL_FAIL: '일부 실패',
  PENDING: '대기', UPLOADED: '올림', DONE: '완료', SKIPPED: '건너뜀', FAILED: '실패'
};
const statusLabel = (s) => STATUS_LABEL[s] || s || '-';

const COLUMNS = [
  { key: 'draft', title: '글감 · 초안', statuses: ['DRAFT', 'DRAFTING', 'GENERATING'], hint: '글감만 있거나 본문을 쓰는 중' },
  { key: 'review', title: '내용 확인', statuses: ['REVIEW', 'EDITING'], hint: '글·대본 읽고 고치는 단계' },
  { key: 'ready', title: '올릴 준비', statuses: ['READY'], hint: '확인 끝, 곧 올라갈 차례' },
  { key: 'publishing', title: '일부만 올라감', statuses: ['PUBLISHING', 'PUBLISHED'], hint: '블로그↔숏폼 서로 연결 대기' },
  { key: 'linked', title: '발행 끝', statuses: ['LINKED'], hint: '업로드·연결 모두 완료' },
  { key: 'human', title: '내가 봐야 함', statuses: ['NEEDS_HUMAN', 'PARTIAL_FAIL'], hint: '로그인·인증·오류를 직접 풀어요', alert: true }
];

const CHECKLIST = [
  { id: 'banned', label: '금지어·상투적 표현 없음 ("결론적으로", "다양한 매력을 지닌" 등)', w: 10 },
  { id: 'weak', label: '솔직한 단점 1개 이상 (현실 자폭 감성)', w: 10 },
  { id: 'aeo', label: 'AEO 30초 팩트표 또는 FAQ 포함', w: 12 },
  { id: 'media', label: '사진 5장 · 영상 1개 이상', w: 10 },
  { id: 'keyword', label: '타깃 키워드 5~7회 자연 반복', w: 10 },
  { id: 'link', label: '지도 · 내부링크 삽입', w: 8 },
  { id: 'fact', label: '가격 · 영업시간 등 팩트 확인(영수증/방문)', w: 12 },
  { id: 'ai', label: 'AI 문체 흔적 없음(문장 길이 균일·과장 없음)', w: 10 },
  { id: 'disclosure', label: '협찬 · 광고 표기(해당 시)', w: 8 },
  { id: 'human', label: '내가 직접 읽고 판단했다 (human_reviewed)', w: 10 }
];

const KNOWNOW_KEY = 'contenthub.knowhow.v1';

/* ────────────────────────── 상태 ────────────────────────── */

const state = {
  route: 'board',
  brand: 'daejeon_youth',
  contents: [],
  health: null,
  sysHealth: null,
  connError: null,
  search: '',
  reviewId: null,
  checklist: {},
  loading: false,
  quick: null,
  metrics: [],
  metricsError: null,
  metricsAt: null,
  analytics: [],
  analyticsError: null,
  blogPosts: null,
  blogAt: 0,
  daangnSeed: null
};

/* ────────────────────────── DOM 헬퍼 ────────────────────────── */

const $ = (sel) => document.querySelector(sel);

function h(tag, attrs, ...kids) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'style') node.setAttribute('style', v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) node.setAttribute(k, '');
      else node.setAttribute(k, String(v));
    }
  }
  kids.flat(4).forEach((k) => {
    if (k == null || k === false) return;
    node.append(k.nodeType ? k : document.createTextNode(String(k)));
  });
  return node;
}

function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

function toast(message, kind = '') {
  const host = $('#toasts');
  const t = h('div', { class: 'toast ' + kind }, h('span', { text: kind === 'ok' ? '✓' : kind === 'err' ? '!' : '·' }),
    h('span', { text: message }));
  host.appendChild(t);
  const kill = () => { t.classList.add('out'); setTimeout(() => t.remove(), 200); };
  setTimeout(kill, kind === 'err' ? 6000 : 3600);
  t.addEventListener('click', kill);
}

function relTime(iso) {
  if (!iso) return '';
  const t = new Date(String(iso).replace(' ', 'T')).getTime();
  if (!t || Number.isNaN(t)) return String(iso);
  const diff = Date.now() - t;
  const min = Math.round(diff / 60000);
  if (min < 1) return '방금';
  if (min < 60) return min + '분 전';
  if (min < 1440) return Math.floor(min / 60) + '시간 전';
  if (min < 2880) return '어제';
  if (min < 43200) return Math.floor(min / 1440) + '일 전';
  return String(iso).slice(0, 10);
}

function badge(status) {
  const code = status || 'DRAFT';
  return h('span', { class: 'badge ' + code, title: code, text: statusLabel(code) });
}

/* ────────────────────────── 채널 정의·아이콘 ──────────────────────────
   카드와 상세가 같은 정의를 쓴다. 순서 고정(블로그·쇼츠·릴스·피드·클립).
   채널색은 아이콘 선·테두리·틴트에만 쓰고 글자는 --tx로 둔다(작은 글씨 대비 확보). */

const SVG_NS = 'http://www.w3.org/2000/svg';

const CHANNELS = [
  { key: 'blog', label: '블로그', st: 'blog_status', url: 'blog_url' },
  { key: 'shorts', label: '쇼츠', st: 'shorts_status', url: 'shorts_url' },
  { key: 'reels', label: '릴스', st: 'reels_status', url: 'reels_url' },
  { key: 'feed', label: '피드', st: 'ig_feed_status', url: 'ig_feed_url' },
  { key: 'clip', label: '클립', st: 'clip_status', url: 'clip_url' },
  /* 5번째 발행 채널 — 대전 청년만. 메리 트랙은 daangn_status=SKIPPED 고정으로 제외한다. */
  { key: 'daangn', label: '당근', st: 'daangn_status', url: 'daangn_url' }
];

const DONE_STATES = ['UPLOADED', 'DONE', 'PUBLISHED', 'LINKED'];
const channelDone = (v) => DONE_STATES.indexOf(v) >= 0;
const channelLabel = (v) => {
  if (!v) return '아직';
  if (channelDone(v)) return '올림';
  if (v === 'SKIPPED') return '건너뜀';
  if (v === 'FAILED' || v === 'PARTIAL_FAIL') return '실패';
  return '대기';
};
const channelState = (v) => {
  if (!v) return 'none';
  if (channelDone(v)) return 'done';
  if (v === 'SKIPPED') return 'skip';
  if (v === 'FAILED' || v === 'PARTIAL_FAIL') return 'fail';
  return 'none';
};

/* 트랙별 대상 채널 — 김메리는 블로그·인스타 피드 사진·당근을 쓰지 않는다(쇼츠·릴스·클립 3개가 올라가면 그 소재는 끝).
   대전 청년은 6칸(당근 포함). 기준은 js/trackChannels.js(= seeds/track_channels.json 사본). */
const brandChannels = (brand) => {
  const set = trackChannelsOf(brand);
  return CHANNELS.filter((c) => set.indexOf(c.key) >= 0);
};

/* 그 카드가 실제로 올리는 채널 — 일부러 건너뛴 채널은 분모에서 뺀다(1/5가 아니라 1/1로 보이게) */
const liveChannels = (item) => {
  const all = brandChannels(item.brand || state.brand);
  const live = all.filter((c) => channelState(item[c.st]) !== 'skip');
  return live.length ? live : all;
};

const CH_ICONS = {
  blog: ['M2.6 2.3h6.8v7.4H2.6z', 'M4.2 4.7h3.6', 'M4.2 6.4h3.6'],
  shorts: ['M2.5 3.1h7v5.8h-7z', 'M5.2 4.7l2.2 1.3-2.2 1.3z'],
  reels: ['M2.3 2.5h7.4v7H2.3z', 'M2.3 4.6h7.4', 'M4.3 2.5l.9 2.1', 'M6.9 2.5l.9 2.1'],
  feed: ['M2.4 2.4h3v3h-3z', 'M6.6 2.4h3v3h-3z', 'M2.4 6.6h3v3h-3z', 'M6.6 6.6h3v3h-3z'],
  clip: ['M7.1 1.9L3.3 6.5h2.5l-.7 3.6 3.8-4.7H6.3z'],
  daangn: ['M6 10.6L2.9 5.4h6.2z', 'M4.6 3.4c.4-.9 1.2-1.5 1.9-1.4', 'M7.4 3.4c-.4-.9-1.2-1.5-1.9-1.4']
};

function channelIcon(key, size = 12) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 12 12');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.25');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  (CH_ICONS[key] || []).forEach((d) => {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  });
  return svg;
}

function channelChip(item, c) {
  const raw = item[c.st];
  const st = channelState(raw);
  const chip = h('span', {
    class: 'chip', 'data-ch': c.key, 'data-state': st,
    title: c.label + ': ' + (raw ? channelLabel(raw) : '기록 없음')
  }, channelIcon(c.key), h('span', { text: st === 'skip' ? '—' : c.label }));
  if (st === 'done') chip.appendChild(h('span', { class: 'ck', text: '✓' }));
  return chip;
}

function renderChannelRow(item) {
  const row = h('div', { class: 'chrow' });
  brandChannels(item.brand || state.brand).forEach((c) => row.appendChild(channelChip(item, c)));
  const targets = liveChannels(item);
  const done = targets.filter((c) => channelDone(item[c.st])).length;
  row.appendChild(h('span', { class: 'cc-frac', text: done + '/' + targets.length }));
  return row;
}

/* ────────────────────────── 부트 ────────────────────────── */

async function boot() {
  try {
    wireChrome();
    state.route = (location.hash.replace(/^#\/?/, '') || 'board').split('?')[0];
    applyBrand(loadConfig().activeBrand || 'daejeon_youth', { silent: true });
    loadDaangnSeed().then((s) => { state.daangnSeed = s; });
    await refresh();
    renderRoute();
    loadHealth();
  } catch (err) {
    // 화면이 비어 버리면 원인을 알 수 없으니, 실패는 화면에 남긴다
    const main = $('#main');
    if (!main) return;
    clear(main);
    main.appendChild(h('div', { class: 'panel' },
      h('h3', null, '화면을 그리지 못했습니다'),
      h('p', { class: 'hint', text: friendlyError(err) }),
      h('div', { class: 'row', style: 'margin-top:12px' },
        h('button', { class: 'btn sm', type: 'button', text: '설정 열기', onclick: openSettings }),
        h('button', { class: 'btn sm primary', type: 'button', text: '새로고침', onclick: () => location.reload() }))));
    console.error('[contenthub] boot failed', err);
  }
}

/* ── 폰 하단 5칸 + 더보기 시트(2026-11-21) ──
   하단에 없는 6개 화면은 더보기 시트로 연다. 시트가 없으면(옛 HTML) 아무 일도 하지 않는다. */
const MORE_ROUTES = ['blog', 'review', 'lint', 'series', 'knowhow', 'ops'];

function closeMoreSheet() {
  const sheet = document.getElementById('more-sheet');
  if (sheet && sheet.open) sheet.close();
}

function wireChrome() {
  document.querySelectorAll('[data-brand-btn]').forEach((btn) => {
    btn.addEventListener('click', () => applyBrand(btn.dataset.brandBtn));
  });
  document.querySelectorAll('[data-route]').forEach((btn) => {
    btn.addEventListener('click', () => { location.hash = '#/' + btn.dataset.route; });
  });
  $('#btn-refresh').addEventListener('click', async () => {
    $('#btn-refresh').textContent = '…';
    await refresh();
    renderRoute();
    loadHealth();
    $('#btn-refresh').textContent = '⟳';
    toast('새로고침 완료');
  });
  $('#btn-approve-badge').addEventListener('click', () => { location.hash = '#/approve'; });
  $('#btn-settings').addEventListener('click', openSettings);
  document.querySelectorAll('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => { const d = document.getElementById(btn.dataset.close); if (d) d.close(); });
  });
  window.addEventListener('hashchange', () => {
    const next = (location.hash.replace(/^#\/?/, '') || 'board').split('?')[0];
    if (state.quick && next !== 'approve') { state.quick.unmount(); state.quick = null; }
    state.route = next;
    closeMoreSheet();
    renderRoute();
  });
  /* 더보기 시트 — 열기·바깥 클릭 닫기·항목 선택 시 닫기 */
  const moreBtn = $('#btn-more');
  const moreSheet = document.getElementById('more-sheet');
  if (moreBtn && moreSheet) {
    moreBtn.addEventListener('click', () => {
      if (typeof moreSheet.showModal === 'function') moreSheet.showModal();
    });
    moreSheet.addEventListener('click', (ev) => { if (ev.target === moreSheet) closeMoreSheet(); });
    moreSheet.querySelectorAll('[data-route]').forEach((btn) => {
      btn.addEventListener('click', () => closeMoreSheet());
    });
  }
  /* 사이드바 접기 — 상태를 이 기기에 기억한다 */
  const sidebar = document.getElementById('sidebar');
  const railBtn = $('#btn-rail');
  if (sidebar) {
    /* 접힘일 때는 제목을 툴팁으로만 보여 주므로, 접기 버튼의 이름도 '펼치기'로 바꿔 둔다 */
    const syncRail = () => {
      if (!railBtn) return;
      const rail = sidebar.classList.contains('is-rail');
      const label = rail ? '사이드바 펼치기' : '사이드바 접기';
      railBtn.setAttribute('aria-label', label);
      railBtn.setAttribute('title', label);
      railBtn.setAttribute('aria-expanded', rail ? 'false' : 'true');
    };
    try { if (localStorage.getItem('ch_sidebar_rail') === '1') sidebar.classList.add('is-rail'); } catch (e) {}
    syncRail();
    if (railBtn) {
      railBtn.addEventListener('click', () => {
        const rail = sidebar.classList.toggle('is-rail');
        try { localStorage.setItem('ch_sidebar_rail', rail ? '1' : '0'); } catch (e) {}
        syncRail();
      });
    }
  }
  /* PC 폭이 되면 시트는 닫는다 */
  window.addEventListener('resize', () => { if (window.innerWidth >= 900) closeMoreSheet(); });
  wireSettings();
}

/* ────────────────────────── 브랜드 ────────────────────────── */

function applyBrand(brand, opts = {}) {
  if (!BRANDS[brand]) brand = 'daejeon_youth';
  state.brand = brand;
  api.setBrand(brand);
  document.documentElement.dataset.brand = brand;
  // 안드로이드 상단바 색도 트랙에 맞춘다(핑크 시절 네이비가 남아 있던 문제)
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) themeMeta.setAttribute('content', brand === 'ppiyak_kimmary' ? '#141210' : '#0b1220');
  document.querySelectorAll('[data-brand-btn]').forEach((btn) => {
    btn.setAttribute('aria-selected', btn.dataset.brandBtn === brand ? 'true' : 'false');
  });
  state.search = '';
  state.reviewId = null;
  /* 트랙 B(삐약 김메리)에는 블로그·피드가 없다 — 그 화면을 보던 중이면 영상 스튜디오로 즉시 옮긴다(설계 §9) */
  if (!opts.silent && brand === 'ppiyak_kimmary') {
    const sub = String(state.route || '').split('/');
    if (sub[0] === 'create' && sub[1] && ['blog', 'feed'].indexOf(sub[1]) >= 0) {
      toast('반려동물 채널은 영상만 지원해 영상 스튜디오로 이동했어요', '');
      location.hash = '#/create/video';
    }
  }
  if (!opts.silent) {
    refresh().then(() => { renderRoute(); loadHealth(); });
  }
}

/* ────────────────────────── 데이터 ────────────────────────── */

async function refresh() {
  state.loading = true;
  try {
    const res = await api.listContents({ brand: state.brand, limit: 200, page: 1 });
    state.contents = (res.data && res.data.items) || [];
    state.connError = null;
  } catch (err) {
    state.contents = [];
    // 미설정은 장애가 아니다 — 화면 안내(설정 패널·배너)로만 알리고 빨간 오류로 띄우지 않는다
    if (err instanceof ApiError && err.code === 'ERR_NO_CONFIG') {
      state.connError = null;
    } else {
      state.connError = err;
      toast(friendlyError(err), 'err');
    }
  } finally {
    state.loading = false;
    // 성과 숫자는 별도 호출 — 실패해도 화면은 그대로 그린다(조용한 안내는 성과 화면에서)
    await loadMetrics(state, api);
    // 자동 수집분도 함께 읽는다 — 보드 카드 뱃지·카드 상세의 채널 타일이 같은 값을 쓴다(60초 캐시).
    // 보드 첫 화면을 이 호출로 붙잡지 않도록 기다리지 않고, 도착하면 보드만 다시 그린다.
    const brandAt = state.brand;
    getAnalytics(api, state.brand).then((cache) => {
      if (brandAt !== state.brand) return;
      state.analytics = (cache && cache.rows) || [];
      state.analyticsError = (cache && cache.error) || null;
      if (state.route === 'board') renderRoute();
    }).catch((e) => {
      state.analytics = state.analytics || [];
      state.analyticsError = (e && e.code) || 'ERR_UNKNOWN';
    });
    updateApproveBadge();

    // 블로그 글별 조회·공감·댓글도 읽어 둔다 — 블로그만 올린 카드도 '종합 성과'가 비지 않게.
    // #/blog 와 같은 로더(state.blog)를 쓴다. 메리 트랙은 블로그를 안 쓰므로 부르지 않는다.
    if (state.brand === 'daejeon_youth' && api.configured && (!state.blog || state.blogBrand !== state.brand)) {
      loadBlogStats(state, api).then(() => {
        if (state.route === 'board') renderRoute();
      }).catch(() => { /* 블로그 통계가 없으면 타일이 '입력' 안내를 한다 */ });
    }

    renderBanners();
    updateConnDot();
  }
}

async function loadHealth() {
  try {
    const res = await api.health();
    state.health = res.data || {};
    state.connError = null;
  } catch (err) {
    state.health = null;
    if (!(err instanceof ApiError && err.code === 'ERR_NO_CONFIG')) state.connError = err;
  }
  if (state.health) {
    try {
      const sys = await api.getSystemHealth();
      state.sysHealth = sys.data || {};
    } catch (e) { state.sysHealth = null; }
  }
  updateConnDot();
  renderBanners();
}

function updateApproveBadge() {
  const n = state.contents.filter((c) => c.status === 'REVIEW').length;
  const pill = $('#btn-approve-badge');
  $('#approve-count').textContent = String(n);
  pill.hidden = n === 0;
}

function updateConnDot() {
  const dot = $('#conn-dot');
  const mode = api.mode;
  if (state.connError) {
    dot.className = 'conn-dot off';
    dot.title = '연결 실패 — ⚙︎ 설정에서 주소·토큰을 확인하세요';
    return;
  }
  dot.className = 'conn-dot ' + (mode === 'live' ? 'live' : 'off');
  dot.title = mode === 'live' ? 'GAS 실서버 연결됨' : '연결 설정 필요 — ⚙︎ 설정에서 GAS URL과 API 토큰을 연결하세요';
}

function renderBanners() {
  const host = $('#banners');
  clear(host);
  const mode = api.mode;

  if (mode === 'unconfigured') {
    host.appendChild(banner('info', '⚙︎', '연결 설정이 필요합니다.',
      '설정에서 GAS URL과 API 토큰을 연결하세요.',
      h('button', { class: 'ghost-btn sm', type: 'button', onclick: openSettings, text: '설정 열기' })));
  }

  if (state.connError) {
    host.appendChild(banner('danger', '⚠️', '서버 응답을 받지 못했습니다.',
      friendlyError(state.connError)));
  }

  const needsHuman = state.contents.filter((c) => c.status === 'NEEDS_HUMAN').length
    + (state.sysHealth && state.sysHealth.needs_human ? state.sysHealth.needs_human.count : 0);
  if (state.contents.filter((c) => c.status === 'NEEDS_HUMAN').length) {
    host.appendChild(banner('danger', '🙋', `사람 대기 ${state.contents.filter((c) => c.status === 'NEEDS_HUMAN').length}건`,
      '캡차·2FA·로그인 만료는 자동으로 처리하지 않습니다. 직접 처리한 뒤 보드에서 상태를 바꾸세요.'));
  }

  const b = state.health && state.health.backup;
  if (b && (b.backup_stale || b.last_failure_at)) {
    host.appendChild(banner('warn', '💾', '백업 확인 필요',
      b.last_failure_at
        ? `최근 백업 실패: ${b.last_failure_msg || '(사유 미기록)'} · ${relTime(b.last_failure_at)}`
        : `마지막 성공 백업이 ${b.backup_stale_days == null ? '없습니다' : b.backup_stale_days + '일 전'}`,
      h('button', { class: 'ghost-btn sm', type: 'button', onclick: () => { location.hash = '#/ops'; }, text: '운영' })));
  }

  if (state.health && state.health.quota_degraded) {
    host.appendChild(banner('warn', '⏱', '사용량 보호 작동 중', '구글 무료 한도의 80%를 넘어 잠시 저장이 멈춥니다. 보기만 됩니다.'));
  }
}

function banner(kind, ico, title, body, action) {
  return h('div', { class: 'banner ' + kind },
    h('span', { class: 'b-ico', text: ico }),
    h('div', null, h('strong', { text: title + ' ' }), h('span', { text: body })),
    action || null);
}

function friendlyError(err) {
  if (!err) return '';
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'ERR_NO_CONFIG': return 'GAS URL/토큰이 설정되지 않았습니다. ⚙︎ → 연결에서 입력하세요.';
      case 'ERR_UNAUTHORIZED': return '토큰이 맞지 않습니다. 시트 메뉴 → 2. API 토큰 확인에서 다시 복사하세요.';
      case 'ERR_BAD_RESPONSE': return 'GAS가 JSON이 아닌 응답을 보냈습니다. 배포 액세스가 "모든 사용자"인지 확인하세요.';
      case 'ERR_NETWORK': return '네트워크에 연결되지 않았거나 GAS 주소가 잘못됐습니다.';
      case 'ERR_TIMEOUT': return '서버 응답이 너무 느립니다. 잠시 후 다시 시도하세요.';
      case 'ERR_QUOTA_EXCEEDED': return '구글 사용량 한도를 넘었어요 — 60초 뒤 다시 시도해 주세요.';
      default: return `${err.code || 'ERR'} · ${err.message || ''}`;
    }
  }
  return err.message || String(err);
}

/* ────────────────────────── 라우터 ────────────────────────── */

function renderRoute() {
  const route = state.route || 'board';
  /* 하위 라우트(#/create/blog) — 앞 조각이 화면, 뒤 조각이 그 화면의 선택값이다 */
  const seg = String(route).split('/');
  const routeRoot = seg[0] || 'board';
  const routeSub = seg[1] || '';
  /* 상세(#/post)는 따로 탭이 없다 — 들어온 곳(성과분석·내 블로그) 탭을 켜 둔다 */
  const tabRoute = routeRoot === 'post' ? (/[?&]source=blog(&|$)/.test(location.hash) ? 'blog' : 'perf') : routeRoot;
  document.querySelectorAll('[data-route]').forEach((tab) => {
    if (tab.dataset.route === tabRoute) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  });
  /* 하단 5칸에 없는 화면이면 [더보기]를 켜 둔다(시트에서 들어온 화면) */
  const moreTab = $('#btn-more');
  if (moreTab) moreTab.classList.toggle('is-active', MORE_ROUTES.indexOf(tabRoute) >= 0);
  const main = $('#main');
  clear(main);
  const ctx = { h, state, api, toast, friendlyError, banner, pageHead, relTime, BRANDS, brandChannels, channelLabel, channelState, channelIcon, CHANNELS, renderRoute, openDetail };
  const view = {
    board: renderBoard,
    approve: renderApprove,
    /* ＋ 만들기 = 제작 스튜디오. #/create/legacy 는 예전 채널 조립기(지우지 않고 남긴다) */
    create: (main) => (routeSub === 'legacy' ? renderCreateView(main, ctx) : renderCreateStudio(main, ctx, { format: routeSub })),
    capture: renderCapture,
    review: renderReview,
    perf: (main) => renderPerfView(main, ctx),
    post: (main) => renderPostView(main, ctx),
    blog: (main) => renderBlogView(main, ctx),
    lint: (main) => renderLintView(main, ctx) || null,
    series: (main) => renderSeriesView(main, { h, state, toast, friendlyError }),
    knowhow: renderKnowHow,
    ops: renderOps
  }[routeRoot] || renderBoard;
  const maybe = view(main);
  if (maybe && typeof maybe.catch === 'function') maybe.catch((err) => toast(friendlyError(err), 'err'));
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

function pageHead(title, sub, actions) {
  return h('div', { class: 'page-head' },
    h('div', null, h('h1', { text: title }), sub ? h('p', { class: 'sub', text: sub }) : null),
    h('div', { class: 'head-actions' }, actions || null));
}

/* ────────────────────────── 보드 ────────────────────────── */

function renderBoard(main) {
  const brand = BRANDS[state.brand];
  main.appendChild(pageHead(
    `${brand.emoji} ${brand.name}`,
    brand.channels + ' · ' + state.contents.length + '건',
    h('button', { class: 'btn sm primary', type: 'button', title: '가게·아이디어를 적어 새 카드를 만듭니다', onclick: () => { location.hash = '#/capture'; }, text: '＋ 글감 추가' })
  ));

  const search = h('input', {
    type: 'search', placeholder: '가게·제목·키워드로 찾기', value: state.search,
    oninput: (e) => { state.search = e.target.value; paintBoard(); }
  });
  main.appendChild(h('div', { class: 'panel', style: 'padding:10px' }, search));

  if (api.mode === 'unconfigured' && !state.connError) {
    main.appendChild(h('div', { class: 'panel setup-guide' },
      h('h3', null, '⚙︎ 설정에서 GAS URL과 API 토큰을 연결하세요'),
      h('p', { class: 'hint', text: '연결하면 실제 콘텐츠허브 시트를 읽어 보드를 그립니다. Web App URL(/exec)과 API 토큰은 ⚙︎ 설정에서 넣을 수 있습니다.' }),
      h('div', { class: 'row', style: 'margin-top:10px' },
        h('button', { class: 'btn sm primary', type: 'button', text: '설정 열기', onclick: openSettings }))));
    return;
  }

  if (!state.contents.length && !state.connError) {
    main.appendChild(h('div', { class: 'panel' },
      h('h3', null, '아직 카드가 없어요'),
      h('p', { class: 'hint', text: '관리 → 초기 세팅을 한 번 돌리면 첫 문장 형식·키워드가 채워지고 2주치 초안 10건이 생깁니다.' }),
      h('div', { class: 'row', style: 'margin-top:10px' },
        h('button', { class: 'btn sm', type: 'button', text: '관리 열기', onclick: () => { location.hash = '#/ops'; } }),
        h('button', { class: 'btn sm primary', type: 'button', text: '＋ 글감 추가', onclick: () => { location.hash = '#/capture'; } }))));
    return;
  }

  const boardHost = h('div', { class: 'board', id: 'board' });
  main.appendChild(boardHost);
  paintBoard();
  /* 초안류 카드의 본문 첫 줄은 상세(payload)에만 있다 — 읽어 오면 그 카드만 다시 그린다 */
  loadDrafts(state.contents).then((n) => { if (n) paintBoard(); });

  function paintBoard() {
    const q = state.search.trim().toLowerCase();
    const existingCols = boardHost.querySelectorAll('.col');
    const existingMap = new Map();
    existingCols.forEach((el) => {
      const h2 = el.querySelector('h2');
      if (h2) existingMap.set(h2.textContent, el);
    });

    COLUMNS.forEach((col) => {
      let items = state.contents.filter((c) => col.statuses.indexOf(c.status) >= 0);
      if (q) {
        items = items.filter((c) => `${c.place_name} ${c.blog_title || ''} ${c.target_keywords || ''}`.toLowerCase().indexOf(q) >= 0);
      }

      let colEl = existingMap.get(col.title);
      if (!colEl) {
        colEl = h('section', { class: 'col' + (col.alert && items.length ? ' alert' : '') + (items.length ? '' : ' is-empty') },
          h('div', { class: 'col-head' },
            h('h2', { text: col.title }),
            h('span', { class: 'n', text: String(items.length) })),
          h('p', { class: 'hint', style: 'font-size:11px;color:var(--tx-3);margin:-2px 2px 4px',
          text: col.key === 'publishing' && state.brand === 'ppiyak_kimmary'
            ? '쇼츠·릴스·클립은 올라감 — 발행 끝으로 넘기면 정리돼요'
            : col.hint }));
        boardHost.appendChild(colEl);
      } else {
        colEl.className = 'col' + (col.alert && items.length ? ' alert' : '') + (items.length ? '' : ' is-empty');
        const countEl = colEl.querySelector('.n');
        if (countEl) countEl.textContent = String(items.length);
      }

      const cardsHost = colEl.querySelector('.col-cards') || (() => {
        const host = h('div', { class: 'col-cards' });
        const hint = colEl.querySelector('p.hint');
        if (hint) hint.insertAdjacentElement('afterend', host);
        else colEl.appendChild(host);
        return host;
      })();
      clear(cardsHost);
      items.forEach((item) => cardsHost.appendChild(contentCard(item)));
      const emptyEl = colEl.querySelector('.empty');
      if (items.length === 0 && !emptyEl) {
        colEl.appendChild(h('div', { class: 'empty', text: '없음' }));
      } else if (items.length > 0 && emptyEl) {
        emptyEl.remove();
      }
    });
  }
}

/* ── 작성본 미리보기 캐시 ────────────────────────────────────────
   list_contents 는 제목·상태만 준다. 초안·확인 중 카드의 '무슨 내용인지'는
   get_content_detail 의 payload 에만 있어서, 그 카드들만 따로 읽어 카드에 첫 줄을 붙인다.
   (초안 칸이 3~4장이라 호출도 3~4번 — 목록 전체를 읽지는 않는다.) */
const DRAFTISH = ['DRAFT', 'DRAFTING', 'GENERATING', 'REVIEW', 'EDITING'];
const draftCache = new Map();   // content_id → {text, empty, chars} | 'loading'

function draftLine(item) {
  if (DRAFTISH.indexOf(item.status) < 0) return null;
  const c = draftCache.get(item.content_id);
  if (c === 'loading' || c == null) return h('p', { class: 'cc-excerpt waiting', text: '작성본 확인 중…' });
  if (c.empty) return h('p', { class: 'cc-excerpt none', text: c.titleOnly ? '제목만 있고 본문은 비어 있어요 — 눌러서 붙여넣기' : '본문 아직 없어요 — 눌러서 붙여넣기' });
  return h('p', { class: 'cc-excerpt', text: c.text });
}

/** 초안류 카드의 본문을 읽어 캐시에 넣는다. 새로 읽은 장수를 돌려준다. */
async function loadDrafts(items) {
  const targets = items
    .filter((it) => DRAFTISH.indexOf(it.status) >= 0 && !draftCache.has(it.content_id))
    .slice(0, 8);
  if (!targets.length) return 0;
  targets.forEach((it) => draftCache.set(it.content_id, 'loading'));
  let got = 0;
  await Promise.all(targets.map(async (it) => {
    try {
      const res = await api.getContentDetail(it.content_id);
      const d = res.data || {};
      draftCache.set(it.content_id, draftPreview(d.payload));
      got++;
    } catch (e) {
      draftCache.delete(it.content_id);   // 실패한 카드는 다음 새로고침에 다시 시도
    }
  }));
  return got;
}

function contentCard(item) {
  return h('button', { class: 'ccard', type: 'button', onclick: () => openDetail(item.content_id) },
    h('div', { class: 'cc-top' },
      badge(item.status),
      h('span', { class: 'cc-id', text: item.content_id }),
      h('span', { class: 'spacer' }),
      item.growth_tag && item.growth_tag !== 'NONE' ? h('span', { class: 'badge DRAFT', text: item.growth_tag }) : null,
      item.quality_score ? h('span', { class: 'cc-score', text: item.quality_score + '점' }) : null),
    h('div', { class: 'cc-title', text: item.blog_title || item.place_name || '(제목 없음)' }),
    draftLine(item),
    renderChannelRow(item),
    perfBadge(item),
    h('div', { class: 'cc-meta3' },
      item.region_dong ? h('span', { text: item.region_dong }) : null,
      item.category ? h('span', { text: item.category }) : null,
      h('span', { text: 'v' + (item.version || 1) }),
      h('span', { text: '수정 ' + relTime(item.updated_at) })));
}

/** 블로그 글별 통계(글 번호·조회·공감·댓글) — #/blog 로더가 채운 state.blog 를 그대로 쓴다 */
function blogPostsOf() {
  if (state.blog && state.blogBrand === state.brand && Array.isArray(state.blog.posts)) return state.blog.posts;
  return state.blogPosts || [];
}

/** 보드 카드의 미니 성과 뱃지 — 발행이 시작된 카드에만(제미나이 확정 2026-11-19). */
function perfBadge(item) {
  const status = String(item.status || '');
  if (status !== 'PUBLISHED' && status !== 'LINKED') return null;
  let totals;
  try {
    const rows = channelRows(item, state.metrics, state.analytics, item.brand || state.brand, { blogPosts: blogPostsOf() });
    totals = cardTotals(rows, item, item.brand || state.brand, state.analytics);
  } catch (e) {
    return null;
  }
  if (!totals || (!totals.views && !totals.reactions)) return null;
  const el = h('div', { class: 'cc-perf' });
  if (totals.views) el.appendChild(h('span', { class: 'ccp', title: '조회·도달·유효시청 합', text: '👁 ' + compact(totals.views) }));
  if (totals.reactions) el.appendChild(h('span', { class: 'ccp', title: '좋아요·댓글·저장·공유 합', text: '❤️ ' + compact(totals.reactions) }));
  return el.children.length ? el : null;
}

/* ────────────────────────── 승인 ────────────────────────── */

function renderApprove(main) {
  const brand = BRANDS[state.brand];
  main.appendChild(pageHead('빠른 승인', `${brand.name} · 검수할 원고를 폰에서 읽고 한 번에 승인`));
  const host = h('div', { id: 'quick-approve' });
  main.appendChild(host);
  if (state.quick) state.quick.unmount();
  state.quick = new QuickApproveView(host, {
    toast,
    onChanged: () => { refresh().then(() => { if (state.route === 'approve') return; }); }
  });
  state.quick.mount().then(() => {
    // 승인 후 카드 목록과 보드가 어긋나지 않게 배경 동기화
    refresh();
  }).catch((err) => toast(friendlyError(err), 'err'));
}

/* ────────────────────────── 취재 등록 ────────────────────────── */

function renderCapture(main) {
  const brand = BRANDS[state.brand];
  main.appendChild(pageHead('글감 적기', `${brand.name} · 다녀온 곳·아이디어만 적으면 30초에 카드가 생깁니다`));

  const form = h('form', { class: 'panel' });
  const fields = {};

  const add = (key, label, opts = {}) => {
    fields[key] = h(opts.tag || 'input', {
      type: opts.type || 'text',
      placeholder: opts.placeholder || '',
      autocomplete: 'off',
      spellcheck: 'false'
    });
    form.appendChild(h('label', { class: 'field' }, h('span', { class: 'field-label', text: label + (opts.req ? ' *' : '') }), fields[key]));
  };

  add('place_name', '가게 이름 · 주제', { req: true, placeholder: '예: 미미삼겹 유성점 / 화장실 물 마시는 메리' });
  const grid = h('div', { class: 'form-grid two' });
  form.appendChild(grid);
  const gridField = (key, label, placeholder) => {
    fields[key] = h('input', { type: 'text', placeholder, autocomplete: 'off' });
    grid.appendChild(h('label', { class: 'field' }, h('span', { class: 'field-label', text: label }), fields[key]));
  };
  gridField('region_dong', '동네', '예: 봉명동');
  gridField('category', '종류', '예: 한식 · 고기');
  gridField('cluster_id', '주제 묶음', '예: 유성 삼겹살 (같이 묶을 글)');
  gridField('target_keywords', '노릴 검색어', '쉼표로 구분 · 예: 봉명동 고기집, 봉명동 야장');
  gridField('naver_place_url', '네이버 지도 링크', 'https://map.naver.com/...');
  gridField('media_drive_url', '사진·영상 폴더 링크', '드라이브 폴더 URL');

  const receipt = h('input', { type: 'checkbox' });
  const partial = h('input', { type: 'checkbox' });
  form.appendChild(h('div', { class: 'row', style: 'margin:4px 0 12px;gap:16px' },
    h('label', { class: 'switch' }, receipt, h('span', { text: '영수증·방문 사진 있음' })),
    h('label', { class: 'switch' }, partial, h('span', { text: '숏폼만 먼저 올려도 됨' }))));

  const submit = h('button', { class: 'btn primary block', type: 'submit', title: '저장하면 현황 보드의 아이디어·초안 칸에 카드가 생깁니다', text: '초안 카드 만들기' });
  form.appendChild(submit);

  const result = h('div', { hidden: true });
  form.appendChild(result);

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const place = fields.place_name.value.trim();
    if (!place) { fields.place_name.focus(); toast('가게 이름이나 주제는 꼭 적어 주세요', 'err'); return; }
    submit.disabled = true;
    submit.textContent = '만드는 중…';
    try {
      const res = await api.createContent({
        brand: state.brand,
        place_name: place,
        region_dong: fields.region_dong.value.trim(),
        category: fields.category.value.trim(),
        cluster_id: fields.cluster_id.value.trim(),
        target_keywords: fields.target_keywords.value.trim(),
        naver_place_url: fields.naver_place_url.value.trim(),
        media_drive_url: fields.media_drive_url.value.trim(),
        receipt_verified: receipt.checked,
        allow_partial_shortform: partial.checked
      });
      const d = res.data || {};
      result.hidden = false;
      clear(result);
      result.appendChild(h('div', { class: 'result ok' },
        h('strong', { text: '✓ 카드가 생겼어요 · ' + d.content_id }),
        h('p', { class: 'hint', text: d.pipeline_mode === 'ONE_STAGE_SHORTFORM'
          ? '이 브랜드는 쇼츠·릴스만 올리면 끝입니다(블로그·클립은 건너뜀).'
          : '올리는 순서: 쇼츠·릴스·클립 → 블로그(영상 넣기) → 숏폼 고정댓글에 블로그 링크 달기' }),
        h('p', { class: 'hint', text: '사진과 원고는 다음 단계에서 이 카드에 붙습니다.' })));
      form.reset();
      await refresh();
      toast('카드를 만들었어요 · ' + d.content_id, 'ok');
    } catch (err) {
      result.hidden = false;
      clear(result);
      result.appendChild(h('div', { class: 'result err', text: friendlyError(err) }));
    } finally {
      submit.disabled = false;
      submit.textContent = '초안 카드 만들기';
    }
  });

  main.appendChild(form);

  main.appendChild(h('div', { class: 'panel' },
    h('h3', null, '이 브랜드는 이렇게 올려요'),
    h('p', { class: 'hint', text: state.brand === 'ppiyak_kimmary'
      ? '삐약 김메리: 쇼츠·릴스·클립을 올리면 끝이에요. 블로그는 자동으로 건너뜁니다.'
      : '대전 청년: ① 쇼츠 · 릴스 · 클립을 먼저 올리고 ② 블로그에 그 영상을 넣고 ③ 숏폼 맨 위 고정댓글에 블로그 주소를 답니다.' })));
}

/* ────────────────────────── 검수 ────────────────────────── */

function renderReview(main) {
  const brand = BRANDS[state.brand];
  const reviewing = state.contents.filter((c) => c.status === 'REVIEW');
  main.appendChild(pageHead('원고 검수', `${brand.name} · 검수할 원고 ${reviewing.length}건`,
    h('button', { class: 'btn sm', type: 'button', title: '폰에서 카드 한 장씩 읽고 승인합니다', onclick: () => { location.hash = '#/approve'; }, text: '빠른 승인' })));

  if (!reviewing.length) {
    main.appendChild(h('div', { class: 'empty', text: '지금 검수할 원고가 없어요.' }));
    return;
  }

  const list = h('div', { class: 'panel' }, h('h3', null, '검수할 원고'));
  reviewing.forEach((item) => {
    list.appendChild(h('button', {
      class: 'lrow', type: 'button',
      onclick: () => { state.reviewId = item.content_id; renderRoute(); }
    },
    h('div', { class: 'l-main' },
      h('div', { class: 'l-title', text: item.blog_title || item.place_name }),
      h('div', { class: 'l-sub', text: [item.content_id, item.region_dong, '수정 ' + relTime(item.updated_at)].filter(Boolean).join(' · ') })),
    h('div', { class: 'l-side' },
      item.quality_score ? h('span', { class: 'score', text: item.quality_score + '점' }) : null,
      h('span', { class: 'badge REVIEW', text: item.status }))));
  });
  main.appendChild(list);

  const current = reviewing.find((c) => c.content_id === state.reviewId) || reviewing[0];
  state.reviewId = current.content_id;
  main.appendChild(reviewPanel(current));
}

function reviewPanel(item) {
  const panel = h('div', { class: 'panel' });
  panel.appendChild(h('h3', null,
    h('span', { text: item.place_name || item.content_id }),
    h('span', { class: 'tag', text: item.content_id })));

  panel.appendChild(h('dl', { class: 'kv', style: 'margin-bottom:12px' },
    h('dt', { text: '제목' }), h('dd', { text: item.blog_title || '(미정)' }),
    h('dt', { text: '키워드' }), h('dd', { text: item.target_keywords || '-' }),
    h('dt', { text: '주제 묶음' }), h('dd', { text: item.cluster_id || '-' }),
    h('dt', { text: '채널' }), h('dd', { text: `블로그 ${item.blog_status} · 숏폼 ${item.shorts_status} · 릴스 ${item.reels_status} · 클립 ${item.clip_status}` })));

  const scoreEl = h('strong', { text: '0' });
  const bar = h('i');
  const wrap = h('div', { style: 'margin-bottom:10px' },
    h('div', { class: 'row', style: 'margin-bottom:6px' },
      h('span', { class: 'field-label', style: 'margin:0', text: 'F2 발행 전 체크리스트' }),
      h('span', { class: 'spacer' }),
      scoreEl, h('span', { class: 'field-label', style: 'margin:0', text: '/ 100' })),
    h('div', { class: 'scorebar' }, bar));

  const itemsHost = h('div');
  const checked = state.checklist[item.content_id] || (state.checklist[item.content_id] = {});
  CHECKLIST.forEach((c) => {
    const box = h('input', { type: 'checkbox' });
    box.checked = !!checked[c.id];
    if (c.id === 'human') box.checked = checked[c.id] !== false;
    box.addEventListener('change', () => {
      checked[c.id] = box.checked;
      recalc();
    });
    itemsHost.appendChild(h('label', { class: 'check-item' }, box,
      h('span', { class: 'ci-label', text: c.label }), h('span', { class: 'ci-weight', text: '+' + c.w })));
  });

  function calc() {
    return CHECKLIST.reduce((sum, c) => {
      if (c.id === 'human') return sum + (checked.human !== false ? c.w : 0);
      return sum + (checked[c.id] ? c.w : 0);
    }, 0);
  }
  function recalc() {
    const s = calc();
    scoreEl.textContent = String(s);
    scoreEl.style.color = s >= 80 ? 'var(--ok)' : 'var(--warn)';
    bar.style.width = Math.min(100, s) + '%';
  }

  const approveBtn = h('button', { class: 'btn primary', type: 'button', text: '80점 이상 → READY' });
  const rejectBtn = h('button', { class: 'ghost-btn danger', type: 'button', text: '반려' });

  approveBtn.addEventListener('click', async () => {
    const score = calc();
    if (score < 80) { toast('80점 미만입니다. 체크리스트를 더 확인하세요.', 'err'); return; }
    approveBtn.disabled = true;
    approveBtn.textContent = '넘기는 중…';
    try {
      await api.recordChecklist({
        content_id: item.content_id,
        brand: item.brand,
        target_channel: item.blog_status === 'SKIPPED' ? 'youtube_shorts' : 'naver_blog',
        total_score: score,
        human_reviewed: true,
        reviewer: 'web-admin',
        items: CHECKLIST.reduce((o, c) => { o[c.id] = !!checked[c.id]; return o; }, {})
      });
      await api.updateContent({
        content_id: item.content_id,
        expected_version: item.version,
        status: 'READY',
        target_channel: item.blog_status === 'SKIPPED' ? 'youtube_shorts' : 'naver_blog'
      });
      toast('발행 준비로 넘겼어요 · ' + score + '점', 'ok');
      state.reviewId = null;
      await refresh();
      renderRoute();
    } catch (err) {
      toast(friendlyError(err), 'err');
    } finally {
      approveBtn.disabled = false;
      approveBtn.textContent = '80점 이상 → READY';
    }
  });

  rejectBtn.addEventListener('click', async () => {
    const reason = prompt('반려 사유') || '대표님 반려';
    rejectBtn.disabled = true;
    try {
      await api.quickReject(item.content_id, reason);
      toast('반려 기록 완료', 'ok');
      state.reviewId = null;
      await refresh();
      renderRoute();
    } catch (err) {
      toast(friendlyError(err), 'err');
    } finally {
      rejectBtn.disabled = false;
    }
  });

  panel.appendChild(wrap);
  panel.appendChild(itemsHost);
  panel.appendChild(h('div', { class: 'row end', style: 'margin-top:14px' }, rejectBtn, approveBtn));
  panel.appendChild(h('p', { class: 'hint', style: 'margin-top:10px',
    text: '넘길 수 있는 기준: 체크 80점 이상 + 내가 직접 읽고 확인. 통과하지 못하면 서버가 막습니다.' }));

  recalc();
  return panel;
}

/* ────────────────────────── 노하우 · 벤치마크 ────────────────────────── */

function readKnowhow() {
  try { return JSON.parse(localStorage.getItem(KNOWNOW_KEY)) || []; } catch (e) { return []; }
}
function writeKnowhow(list) {
  localStorage.setItem(KNOWNOW_KEY, JSON.stringify(list.slice(0, 200)));
}

function renderKnowHow(main) {
  main.appendChild(pageHead('잘 된 글 노하우', '잘 된 글·영상의 비결을 적어 두면 다음 원고에 씁니다'));

  const form = h('form', { class: 'panel' });
  const title = h('input', { type: 'text', placeholder: '예: 첫 3초에 결론부터', autocomplete: 'off' });
  const url = h('input', { type: 'url', placeholder: 'https:// (원문 링크, 선택)', autocomplete: 'off' });
  const tags = h('input', { type: 'text', placeholder: '태그: 첫 문장, 자막, 썸네일', autocomplete: 'off' });
  const memo = h('textarea', { placeholder: '왜 먹혔는지 / 무엇을 따라 할지 한두 줄' });

  form.appendChild(h('h3', null, '규칙 추가'));
  form.appendChild(h('label', { class: 'field' }, h('span', { class: 'field-label', text: '제목 *' }), title));
  const g = h('div', { class: 'form-grid two' });
  g.appendChild(h('label', { class: 'field' }, h('span', { class: 'field-label', text: '원문 링크' }), url));
  g.appendChild(h('label', { class: 'field' }, h('span', { class: 'field-label', text: '태그' }), tags));
  form.appendChild(g);
  form.appendChild(h('label', { class: 'field' }, h('span', { class: 'field-label', text: '메모' }), memo));
  form.appendChild(h('button', { class: 'btn primary', type: 'submit', text: '수집함에 넣기' }));

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const t = title.value.trim();
    if (!t) { title.focus(); return; }
    const list = readKnowhow();
    list.unshift({
      id: 'KH-' + Date.now(),
      brand: state.brand,
      title: t,
      url: url.value.trim(),
      tags: tags.value.split(',').map((s) => s.trim()).filter(Boolean),
      memo: memo.value.trim(),
      at: new Date().toISOString()
    });
    writeKnowhow(list);
    form.reset();
    renderRoute();
    toast('수집함에 넣었습니다', 'ok');
  });
  main.appendChild(form);

  const list = readKnowhow();
  const panel = h('div', { class: 'panel' },
    h('h3', null, '수집한 규칙', h('span', { class: 'tag', text: String(list.length) })),
    h('p', { class: 'hint', text: 'M1에서는 이 브라우저에만 저장됩니다. 아래 "내보내기"로 JSON을 받아 두면 M3에서 Benchmarks · Prompt_Rules로 옮길 수 있습니다.' }));

  if (!list.length) {
    panel.appendChild(h('div', { class: 'empty', text: '아직 없습니다. 잘 된 글 하나를 골라 "왜 먹혔는지"부터 적어 보세요.' }));
  } else {
    const wrap = h('div', { class: 'list' });
    list.forEach((k) => {
      wrap.appendChild(h('div', { class: 'lrow' },
        h('div', { class: 'l-main' },
          h('div', { class: 'l-title', text: k.title }),
          h('div', { class: 'l-sub', text: [BRANDS[k.brand] ? BRANDS[k.brand].name : k.brand, k.tags.join(' · '), relTime(k.at)].filter(Boolean).join(' · ') }),
          k.memo ? h('div', { class: 'l-sub', style: 'white-space:normal;color:var(--tx-2)', text: k.memo }) : null),
        h('div', { class: 'l-side' },
          h('button', { class: 'ghost-btn sm', type: 'button', text: '삭제', onclick: () => {
            writeKnowhow(readKnowhow().filter((x) => x.id !== k.id));
            renderRoute();
          } }))));
    });
    panel.appendChild(wrap);
  }

  panel.appendChild(h('div', { class: 'row', style: 'margin-top:12px' },
    h('button', { class: 'ghost-btn', type: 'button', text: '⬇ JSON 내보내기', onclick: () => exportKnowhow() })));
  main.appendChild(panel);
}

function exportKnowhow() {
  const list = readKnowhow();
  if (!list.length) { toast('내보낼 규칙이 없습니다', 'err'); return; }
  const payload = {
    exported_at: new Date().toISOString(),
    brand: state.brand,
    note: 'M3 ingest_benchmark 입력 형식에 맞춘 초안. source_type=MANUAL_NOTE',
    items: list.filter((k) => k.brand === state.brand).map((k) => ({
      brand: k.brand,
      source_type: 'MANUAL_NOTE',
      source_url: k.url,
      source_title: k.title,
      raw_content: k.memo,
      tags: k.tags,
      collected_at: k.at
    }))
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `knowhow_${state.brand}_${new Date().toISOString().slice(0, 10)}.json` });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast('JSON 파일로 내보냈습니다', 'ok');
}

/* ────────────────────────── 운영 ────────────────────────── */

function renderOps(main) {
  const mode = api.mode;
  main.appendChild(pageHead('관리 · 점검', '연결 상태 · 백업 · 시트 점검 · 되돌리기'));

  /* 연결 상태 */
  const cfg = loadConfig();
  const connPanel = h('div', { class: 'panel' },
    h('h3', null, '연결', h('span', { class: 'tag', text: mode === 'live' ? 'LIVE' : '미설정' })),
    h('dl', { class: 'kv' },
      h('dt', { text: '서버 주소' }), h('dd', { text: cfg.baseUrl ? maskUrl(cfg.baseUrl) : '(없음)' }),
      h('dt', { text: '연결 열쇠' }), h('dd', { text: cfg.token ? '설정됨 · ' + cfg.token.length + '자' : '(없음)' }),
      h('dt', { text: '브랜드' }), h('dd', { text: BRANDS[state.brand].name })));
  connPanel.appendChild(h('div', { class: 'row', style: 'margin-top:12px' },
    h('button', { class: 'btn sm', type: 'button', title: '주소와 연결 열쇠가 맞는지 확인합니다', text: '연결 확인', onclick: (e) => runAction(e.target, async () => {
      const res = await api.health();
      return `시트 ${res.data.sheets_total}개 · 브랜드 ${(res.data.brands || []).length}개 · 원고 폴더 ${res.data.drive_folders_ready ? '준비됨' : '없음'} · 연결 열쇠 ${res.data.token_set ? '설정됨' : '없음'}`;
    }) }),
    h('button', { class: 'ghost-btn sm', type: 'button', text: '설정 열기', onclick: openSettings })));

  const log = h('pre', { class: 'json', style: 'margin-top:12px', text: '결과가 여기에 남습니다.' });
  connPanel.appendChild(log);
  main.appendChild(connPanel);

  /* 헬스 */
  const healthPanel = h('div', { class: 'panel' },
    h('h3', null, '상태 확인'),
    h('p', { class: 'hint', text: '구글 시트 서버에 지금 상태를 물어봅니다.' }));
  const stats = h('div', { class: 'stat-grid', style: 'margin-top:10px' });
  healthPanel.appendChild(stats);
  const fillStats = () => {
    clear(stats);
    const hd = state.health;
    const sh = state.sysHealth;
    const b = hd && hd.backup;
    const cells = [
      { k: '시트', v: hd ? hd.sheets_total : '—', sub: hd && hd.sheets_missing && hd.sheets_missing.length ? '누락 ' + hd.sheets_missing.length : '' },
      { k: '브랜드', v: hd ? (hd.brands || []).length : '—', sub: '대전청년 · 메리' },
      { k: '마지막 백업', v: b && b.last_backup_at ? relTime(b.last_backup_at) : '없음', cls: b && b.backup_stale ? 'bad' : b ? 'good' : '', sub: b && b.last_backup_tier ? ({ MANUAL: '수동', DAILY: '자동(매일)', WEEKLY: '자동(주간)', MONTHLY: '자동(월간)' }[b.last_backup_tier] || '') : '' },
      { k: '오늘 서버 호출', v: hd ? hd.daily_calls : '—', sub: '구글 한도 대비' },
      { k: '내가 봐야 함', v: sh ? sh.needs_human.count : state.contents.filter((c) => c.status === 'NEEDS_HUMAN').length, cls: (sh && sh.needs_human.count) ? 'bad' : '', sub: '로그인·인증' },
      { k: '점검에서 걸린 것', v: sh ? sh.open_integrity_issues.count : '—', cls: sh && sh.open_integrity_issues.count ? 'bad' : 'good', sub: '아직 안 고침' },
      { k: '사용량 보호', v: hd && hd.quota_degraded ? '잠깐 멈춤' : '정상', cls: hd && hd.quota_degraded ? 'bad' : 'good' },
      { k: '남은 작업', v: sh ? sh.pending_ops : '—', sub: '다시 시도 대기' }
    ];
    cells.forEach((c) => {
      stats.appendChild(h('div', { class: 'stat ' + (c.cls || '') },
        h('div', { class: 'k', text: c.k }),
        h('div', { class: 'v', text: String(c.v) }),
        c.sub ? h('div', { class: 'k', text: c.sub }) : null));
    });
  };
  fillStats();
  healthPanel.appendChild(h('div', { class: 'row', style: 'margin-top:10px' },
    h('button', { class: 'btn sm', type: 'button', text: '상태 다시 확인', onclick: async (e) => {
      e.target.disabled = true;
      await loadHealth();
      fillStats();
      e.target.disabled = false;
    } })));
  main.appendChild(healthPanel);

  /* 백업 · 복구 */
  const backupPanel = h('div', { class: 'panel' },
    h('h3', null, '백업 · 시트 점검 · 되돌리기'),
    h('p', { class: 'hint', text: '자동: 매일 03:00 · 주 일 03:30 · 월 1일 04:00 (KST). 보존 일 14 · 주 8 · 월 6.' }));

  backupPanel.appendChild(h('div', { class: 'row', style: 'margin-top:10px' },
    h('button', { class: 'btn sm', type: 'button', title: '지금 시트와 원고를 통째로 복사해 둡니다', text: '지금 백업', onclick: (e) => runAction(e.target, async () => {
      const res = await api.backupNow('MANUAL');
      const d = res.data || {};
      await loadHealth();
      return `백업 ${d.partial ? '중간에 멈춤(이어서 함)' : '완료'} · 파일 ${d.copied || 0}개`;
    }) }),
    h('button', { class: 'btn sm', type: 'button', title: '시트·파일이 어긋난 곳이 없는지 봅니다', text: '시트 상태 점검', onclick: (e) => runAction(e.target, async () => {
      const res = await api.integrityCheck();
      const d = res.data || {};
      return `걸린 것 ${d.total_issues != null ? d.total_issues : '?'}건 (심각 ${d.critical || 0} · 주의 ${d.warn || 0})`;
    }) })));

  const restoreRow = h('div', { class: 'row', style: 'margin-top:10px;align-items:flex-end;gap:8px' });
  const dateInput = h('input', { type: 'date', 'aria-label': '되돌릴 백업 날짜', style: 'max-width:170px' });
  restoreRow.appendChild(h('label', { class: 'field', style: 'margin:0' },
    h('span', { class: 'field-label', text: '되돌릴 백업 날짜' }), dateInput));
  restoreRow.appendChild(h('button', { class: 'ghost-btn danger', type: 'button', title: '고른 날짜의 백업본으로 되돌립니다(원본은 사본으로 남습니다)', text: '백업 시점으로 되돌리기', onclick: (e) => {
    const digits = dateInput.value.replace(/-/g, '');
    if (!digits) { toast('날짜를 고르세요', 'err'); return; }
    const ok = confirm(`RESTORE_${digits}\n\n${digits} 스냅샷으로 복구합니다.\n· 원본 시트는 덮어쓰지 않고 사본(RESTORED_…)을 만듭니다\n· 복구 직전 안전 스냅샷을 한 번 더 뜹니다\n\n계속할까요?`);
    if (!ok) return;
    if (prompt('확인을 위해 RESTORE_' + digits + ' 를 그대로 입력하세요') !== 'RESTORE_' + digits) {
      toast('확인 문구가 달라 취소했습니다', 'err');
      return;
    }
    runAction(e.target, async () => {
      const res = await api.restoreSnapshot(digits);
      const d = res.data || {};
      return `되돌리기 완료 · ${d.restored_sheet || ''} · 원고 파일 다시 연결 ${d.payloads_remapped || 0}개`;
    });
  } }));
  backupPanel.appendChild(restoreRow);

  backupPanel.appendChild(h('div', { class: 'row', style: 'margin-top:10px' },
    h('button', { class: 'btn sm', type: 'button', title: '처음 한 번, 첫 문장 형식·키워드·2주 초안을 채웁니다', text: '초기 세팅', onclick: (e) => runAction(e.target, async () => {
      const res = await api.runColdstart(false);
      const d = res.data || {};
      // GAS 는 { created: { hooks, formats, places, keywords, contents } } 로 돌려준다.
      // (예전 응답처럼 플랫 필드로 오는 경우도 같이 받아 준다 — 표시가 [object Object] 로 깨지지 않게)
      const c = (d.created && typeof d.created === 'object') ? d.created : d;
      const num = (v) => Number(v) || 0;
      await refresh();
      return d.skipped
        ? `건너뜀 — ${d.reason || d.note || '이미 데이터 있음'}`
        : `초기 세팅 완료 · 초안 ${num(c.contents != null ? c.contents : c.created)}건`
          + ` (첫 문장 ${num(c.hooks)} · 형식 ${num(c.formats)} · 가게 ${num(c.places)} · 키워드 ${num(c.keywords)})`;
    }) })));

  backupPanel.appendChild(log);
  main.appendChild(backupPanel);

  /* 보안 */
  const secPanel = h('div', { class: 'panel' },
    h('h3', null, '연결 보안'),
    h('p', { class: 'hint', text: '연결 열쇠는 구글 서버에만 보관됩니다. 새로 만들면 예전 열쇠는 바로 쓸 수 없게 됩니다(새 열쇠는 한 번만 보입니다).' }));
  const tokenOut = h('div', { hidden: true });
  secPanel.appendChild(h('div', { class: 'row', style: 'margin-top:10px' },
    h('button', { class: 'ghost-btn danger', type: 'button', title: '연결 열쇠를 새로 발급합니다', text: '연결 열쇠 바꾸기', onclick: async (e) => {
      if (!confirm('연결 열쇠를 새로 만들면 예전 열쇠는 바로 쓸 수 없습니다.\n이 기기 설정에도 새 열쇠를 넣어야 합니다. 계속할까요?')) return;
      e.target.disabled = true;
      try {
        const res = await api.rotateToken();
        const tok = res.data && res.data.new_token;
        tokenOut.hidden = false;
        clear(tokenOut);
        tokenOut.appendChild(h('div', { class: 'result ok' },
          h('strong', { text: '새 연결 열쇠 (한 번만 보입니다)' }),
          h('p', { style: 'font-family:var(--mono);word-break:break-all;margin:6px 0', text: tok || '' }),
          h('p', { class: 'hint', text: '지금 복사해 ⚙︎ → 연결 열쇠에 붙여넣고 저장하세요. 이 화면을 닫으면 다시 볼 수 없습니다.' })));
      } catch (err) {
        tokenOut.hidden = false;
        clear(tokenOut);
        tokenOut.appendChild(h('div', { class: 'result err', text: friendlyError(err) }));
      } finally {
        e.target.disabled = false;
      }
    } }),
    h('button', { class: 'ghost-btn sm', type: 'button', text: '연결 열쇠 지우기', onclick: () => {
      clearToken(); api.reload(); setConnResult('err', '토큰을 삭제했습니다. 다시 연결하세요.');
      toast('토큰 삭제됨', 'ok');
      renderRoute();
    } })));
  secPanel.appendChild(tokenOut);
  main.appendChild(secPanel);

  async function runAction(btn, fn) {
    if (!btn) return;
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = '실행 중…';
    log.textContent = '실행 중… (백업·복구는 2분까지 걸릴 수 있습니다)';
    try {
      const msg = await fn();
      log.textContent = `[${new Date().toLocaleTimeString('ko-KR')}] ✓ ${msg}`;
      toast(msg, 'ok');
    } catch (err) {
      const msg = friendlyError(err);
      log.textContent = `[${new Date().toLocaleTimeString('ko-KR')}] ✕ ${msg}`;
      toast(msg, 'err');
    } finally {
      btn.disabled = false;
      btn.textContent = label;
      renderBanners();
    }
  }
}

function maskUrl(u) {
  try {
    const url = new URL(u);
    const parts = url.pathname.split('/').filter(Boolean);
    const id = parts[parts.length - 2] || '';
    return url.host + '/…/' + (id ? id.slice(0, 6) + '…' : '') + '/exec';
  } catch (e) {
    return api.baseUrl ? api.baseUrl.slice(0, 24) + '…' : '(없음)';
  }
}

/* ────────────────────────── 상세 시트 ────────────────────────── */

/* ────────────────────────── 카드 분석 계산 ──────────────────────────
   시트에 지금 있는 값만 쓴다. 판단할 수 없는 항목은 '확인 못 함'으로 둔다(추측 금지).
   액션 제안은 LLM 없이 조건문으로만 만든다. */

function ageDays(iso) {
  if (!iso) return null;
  const t = new Date(String(iso).replace(' ', 'T')).getTime();
  if (!t || Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

function findHook(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const keys = ['hook_text', 'hook', 'cover_text', 'first_line', 'subtitle_first', 'first_two_seconds'];
  for (let i = 0; i < keys.length; i += 1) {
    const v = payload[keys[i]];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  const script = payload.script || payload.shots || payload.scenes;
  if (Array.isArray(script) && script.length) {
    const first = script[0] || {};
    const cand = first.subtitle || first.text || first.line || first.caption;
    if (typeof cand === 'string' && cand.trim()) return cand.trim();
  }
  return null;
}

function gateRows(m, payload) {
  const rows = [];
  const raw = m.quality_score;
  const score = (raw === '' || raw == null) ? null : Number(raw);
  if (score == null) rows.push({ k: '품질 점수 80점', v: 'na', t: '아직 안 매김' });
  else if (score >= 80) rows.push({ k: '품질 점수 80점', v: 'ok', t: score + '점 · 통과' });
  else rows.push({ k: '품질 점수 80점', v: 'no', t: score + '점 · 미달' });

  const contentKeys = (payload && typeof payload === 'object' && !payload._error)
    ? Object.keys(payload).filter((k) => k !== 'version' && k !== 'updated_at')
    : [];
  const hasPayload = contentKeys.length > 0;
  if (!hasPayload) return { rows, note: '대본·원고 파일이 없어 나머지 점검은 할 수 없어요(발행 기록만 있는 카드예요).' };

  const hook = findHook(payload);
  if (hook == null) rows.push({ k: '첫 2초 훅 12자 이내', v: 'na', t: '확인 못 함' });
  else if (hook.length <= 12) rows.push({ k: '첫 2초 훅 12자 이내', v: 'ok', t: hook.length + '자' });
  else rows.push({ k: '첫 2초 훅 12자 이내', v: 'no', t: hook.length + '자 · 길어요' });

  const introRaw = payload.intro_seconds != null ? payload.intro_seconds : payload.hook_start_seconds;
  const intro = introRaw == null ? null : Number(introRaw);
  if (intro == null || Number.isNaN(intro)) rows.push({ k: '인트로 0초(인사·로고 없이 시작)', v: 'na', t: '확인 못 함' });
  else if (intro === 0) rows.push({ k: '인트로 0초(인사·로고 없이 시작)', v: 'ok', t: '0초' });
  else rows.push({ k: '인트로 0초(인사·로고 없이 시작)', v: 'no', t: intro + '초' });

  /* 팩트 슬롯은 사람이 채우는 대본 속 `[ ]`만 센다.
     payload 문서에 구조적으로 들어가는 internal_links(연결 글 목록)의 빈 배열 `[]`는
     슬롯이 아니므로 스캔 대상에서 뺀다(위양성 방지). */
  let scanText = '';
  try {
    scanText = JSON.stringify(payload, (k, v) => (k === 'internal_links' ? undefined : v)) || '';
  } catch (e) { scanText = ''; }
  const slots = (scanText.match(/\[\s*\]/g) || []).length;
  if (slots === 0) rows.push({ k: '팩트 슬롯 [ ] 안 남음', v: 'ok', t: '남은 자리 없음' });
  else rows.push({ k: '팩트 슬롯 [ ] 안 남음', v: 'no', t: slots + '곳 남음' });

  return { rows, note: '' };
}

function analysisOf(m, payload) {
  const targets = liveChannels(m);
  const done = targets.filter((c) => channelDone(m[c.st]));
  const failed = targets.filter((c) => channelState(m[c.st]) === 'fail');
  const pending = targets.filter((c) => !channelDone(m[c.st]) && channelState(m[c.st]) !== 'fail' && channelState(m[c.st]) !== 'skip');
  const raw = m.quality_score;
  const score = (raw === '' || raw == null) ? null : Number(raw);
  const days = ageDays(m.updated_at);
  const acts = [];
  const add = (text, opts) => { acts.push(Object.assign({ text }, opts || {})); };

  if (m.status === 'NEEDS_HUMAN' || m.status === 'PARTIAL_FAIL') {
    add('직접 풀어야 해요 — 로그인·인증·오류를 확인하세요', { urgent: true, tab: 'src', cta: '원인 보기' });
  }
  if (failed.length) {
    add(failed.map((c) => c.label).join('·') + ' 올리기가 실패했어요 — 다시 올려 주세요', { urgent: true, tab: 'src', cta: '상태 보기' });
  }
  if (m.status === 'PUBLISHED' && pending.length) {
    add('아직 안 올린 채널: ' + pending.map((c) => c.label).join('·'), { tab: 'src', cta: '보기' });
  }
  if (score == null) {
    add('품질 점수가 비어 있어요 — 80점 이상이어야 "올릴 준비"로 갑니다', { tab: 'src', cta: '점수 넣기' });
  } else if (score < 80) {
    add('품질 점수 ' + score + '점 — 80점 이상이어야 "올릴 준비"로 갑니다', { tab: 'src', cta: '고치기' });
  }
  if (!String(m.target_keywords || '').trim()) {
    add('검색 키워드가 비었어요', { tab: 'src', cta: '키워드 넣기' });
  }
  if ((m.status === 'DRAFT' || m.status === 'REVIEW') && days != null && days >= 7) {
    add(days + '일째 그대로예요 — 오늘 10분만 손보면 끝나요');
  }
  if (!pending.length && !failed.length && m.status !== 'LINKED') {
    add('채널은 다 됐어요 — "발행 끝"으로 넘기면 보드가 정리됩니다', { cta: '정리하기', action: 'link' });
  }
  if (!acts.length) add('지금 손댈 것은 없어요');

  return {
    targets, done, pending, failed, score, days,
    actions: acts.slice(0, 2),
    more: Math.max(0, acts.length - 2)
  };
}

function goDetailTab(key) {
  const btn = document.querySelector('#detail-tabs [data-tab="' + key + '"]');
  if (btn) btn.click();
}

function analysisSection(contentId, d, m, payload, dlg) {
  const wrap = h('div', { class: 'ana' });
  const info = analysisOf(m, payload);
  const brand = m.brand || state.brand;
  const rows = channelRows(m, state.metrics, state.analytics, brand, { blogPosts: blogPostsOf() });
  const totals = cardTotals(rows, m, brand, state.analytics);
  const published = ['PUBLISHED', 'LINKED', 'PARTIAL_FAIL'].indexOf(String(m.status || '')) >= 0;
  const showPerf = published && totals.hasAny;

  /* ① 종합 성과 — 발행이 시작돼 숫자가 있는 카드에만(발행 전이면 다음 할 일이 먼저) */

  /* ② 채널 타일 — 상태·링크·성과를 한 칸으로 합쳤다(기존 '채널별 현황' 목록은 삭제) */
  const tileCtx = { d, m, contentId, dlg, toast, rows, published };
  const tileBox = h('section', { class: 'perf-sec' },
    h('div', { class: 'ana-h' }, h('span', { text: '채널별 성과' }),
      h('span', { class: 'n', text: totals.done + '/' + totals.total })));
  const grid = h('div', { class: 'cht-grid' });
  rows.forEach((r) => grid.appendChild(channelTile(r, tileCtx)));
  tileBox.appendChild(grid);
  if (showPerf) {
    const isB = trackChannelsOf(brand).indexOf('daangn') < 0;
    tileBox.appendChild(h('p', { class: 'perf-note', text: isB
      ? '※ 쇼츠·릴스는 매일 아침 자동으로 갱신됩니다. 클립은 조회수를 직접 넣습니다.'
      : '※ 릴스는 조회, 피드는 도달, 당근은 유효시청 기준으로 합산했습니다. 쇼츠·릴스·피드는 매일 아침 자동으로 갱신됩니다.' }));
  }

  /* ③ 다음 할 일 */
  const acts = h('div', { class: 'ana-acts' });
  info.actions.forEach((a) => {
    const row = h('div', { class: 'ana-act' + (a.urgent ? ' urgent' : '') },
      h('span', { class: 'ai', 'aria-hidden': 'true', text: a.urgent ? '!' : '→' }),
      h('span', { text: a.text }));
    if (a.action === 'link') {
      row.appendChild(h('button', {
        class: 'go', type: 'button', text: a.cta || '정리하기',
        onclick: async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          const label = btn.textContent;
          btn.textContent = '정리 중…';
          try {
            await api.updateContent({ content_id: contentId, expected_version: d.version, status: 'LINKED' },
              api.createAction('link'));
            toast('발행 끝으로 옮겼어요', 'ok');
            dlg.close();
            await refresh();
            renderRoute();
          } catch (err) {
            toast(friendlyError(err), 'err');
            btn.disabled = false;
            btn.textContent = label;
          }
        }
      }));
    } else if (a.tab === 'src') {
      row.appendChild(h('button', {
        class: 'go', type: 'button', text: a.cta || '보기',
        onclick: () => goDetailTab('src')
      }));
    }
    acts.appendChild(row);
  });
  const actsSec = h('section', null,
    h('div', { class: 'ana-h' }, h('span', { text: '다음 할 일' })),
    acts,
    info.more ? h('p', { class: 'ana-note', style: 'margin-top:6px', text: '그 밖에 할 일 ' + info.more + '개' }) : null);

  /* 순서: 발행분은 종합 성과 → 채널 타일 → 다음 할 일, 발행 전 카드는 다음 할 일 → 준비 상태 타일 (제미나이 확정) */
  if (showPerf) {
    wrap.appendChild(perfSummary(totals, m));
    wrap.appendChild(tileBox);
    wrap.appendChild(actsSec);
  } else {
    wrap.appendChild(actsSec);
    wrap.appendChild(tileBox);
  }

  /* ④ 당근 자동 경고 — 통과하면 아무것도 안 보인다(사람이 체크하지 않는다) */
  const warn = daangnWarnings(payload, {});
  if (warn.length) {
    wrap.appendChild(h('section', { class: 'perf-warn' },
      h('div', { class: 'ana-h' }, h('span', { text: '당근 올리기 전 자동 확인' })),
      h('ul', null, ...warn.map((w) => h('li', { text: w.text })))));
  }

  /* ⑤ 품질 점검 — 검수에 필요한 값은 남기되 접어 둔다 */
  const g = gateRows(m, payload);
  const gateWrap = h('div', { class: 'gate' });
  g.rows.forEach((r) => gateWrap.appendChild(h('div', { class: 'gate-row' },
    h('span', { text: r.k }),
    h('span', { class: 'gv ' + r.v, text: r.t }))));
  wrap.appendChild(h('details', { class: 'ana-gate' },
    h('summary', { text: '품질 점검' }),
    gateWrap,
    g.note ? h('p', { class: 'ana-note', style: 'margin-top:7px', text: g.note }) : null));

  wrap.appendChild(detailActionButtons(contentId, d, m, dlg));
  return wrap;
}

/** 종합 성과 요약 — 큰 숫자 4칸 + 채널 비중 막대 */
function perfSummary(totals, m, brand) {
  const hasDaangn = trackChannelsOf(brand || (m && m.brand) || state.brand).indexOf('daangn') >= 0;
  const cell = (k, v, s) => h('div', { class: 'pf-k' },
    h('span', { class: 'pf-l', text: k }), h('b', { class: 'pf-v', text: v }),
    s ? h('span', { class: 'pf-s', text: s }) : null);
  const sec = h('section', { class: 'perf-sum' },
    h('div', { class: 'ana-h' }, h('span', { text: '종합 성과' }),
      h('span', { class: 'tag', text: totals.done + '/' + totals.total + ' 채널 발행' })));
  sec.appendChild(h('div', { class: 'pf-grid' },
    cell('총 조회', compact(totals.views), '조회·도달·유효시청'),
    cell('총 반응', compact(totals.reactions), '좋아요·댓글·저장·공유'),
    hasDaangn
      ? cell('확정 보상', totals.reward ? Number(totals.reward).toLocaleString('ko-KR') + '원' : '—', '당근 기본보상')
      : cell('댓글', totals.comments ? compact(totals.comments) : '—', '자동 수집'),
    cell('게시 완료', totals.done + ' / ' + totals.total, '채널')));

  const bar = h('div', { class: 'pf-bar', role: 'img', 'aria-label': '채널 비중' });
  totals.share.forEach((s) => {
    bar.appendChild(h('i', { 'data-ch': s.channel, style: 'width:' + Math.max(2, s.pct) + '%',
      title: s.label + ' ' + s.pct + '%' }));
  });
  sec.appendChild(bar);
  if (totals.share.length) {
    const legend = h('div', { class: 'pf-legend' });
    totals.share.forEach((s) => legend.appendChild(h('span', { class: 'pf-lg' },
      h('i', { 'data-ch': s.channel }), h('em', { text: s.label }), h('b', { text: s.pct + '%' }))));
    sec.appendChild(legend);
  }
  return sec;
}

/** 채널 타일 한 칸 — 채널명·상태·대표 숫자·보조(또는 입력) 세 줄까지 */
function channelTile(r, ctx) {
  const st = channelState(r.status);
  const done = st === 'done';
  const tile = h('div', { class: 'cht', 'data-ch': r.channel, 'data-state': st });
  const head = h('div', { class: 'cht-h' },
    channelIcon(r.channel, 14),
    h('b', { text: r.label }),
    h('span', { class: 'spacer' }),
    h('span', { class: 'cht-st' + (done ? ' done' : ''), text: r.status ? channelLabel(r.status) : '아직' }));
  tile.appendChild(head);

  if (r.collected && r.value != null) {
    tile.appendChild(h('div', { class: 'cht-big' },
      h('span', { class: 'v', text: Number(r.value).toLocaleString('ko-KR') }),
      h('span', { class: 'k', text: r.valueLabel }),
      trendEl(r)));
    if (r.sub) tile.appendChild(h('div', { class: 'cht-sub', text: r.sub }));
  } else if (done) {
    const msg = r.noApi && r.channel === 'daangn'
      ? '숫자를 넣으면 여기에 쌓입니다'
      : (r.channel === 'clip' ? '조회수를 넣어 주세요' : (state.analyticsError && state.analyticsError !== 'ERR_NO_CONFIG'
        ? '⚠️ 수집 오류 — 관리 탭에서 토큰 확인'
        : '⏳ 수집 대기 (매일 아침 반영)'));
    tile.appendChild(h('div', { class: 'cht-empty', text: msg }));
  } else if (st === 'fail') {
    tile.appendChild(h('div', { class: 'cht-empty bad', text: '올리기 실패 — 다시 올려 주세요' }));
  } else {
    tile.appendChild(h('div', { class: 'cht-empty', text: '아직 안 올림' }));
    if (r.url) {
      tile.appendChild(h('a', { class: 'cht-link', href: r.url, target: '_blank', rel: 'noopener noreferrer', text: '열기 ↗' }));
    }
  }

  /* 올렸다고 표시됐는데 자동 수집에 안 잡히면 = 영상이 카드에 연결되지 않은 것 */
  if (done && !r.collected && !r.noApi && !r.url) {
    tile.appendChild(h('div', { class: 'cht-empty', text: '🔗 영상 미연결 — 주소를 넣어 주세요' }));
  }

  /* 링크 있는 발행분은 타일 머리에 바로가기 */
  if (r.url && (done || r.collected)) {
    tile.appendChild(h('a', { class: 'cht-link', href: r.url, target: '_blank', rel: 'noopener noreferrer', text: '바로가기 ↗' }));
  }

  /* 수동 입력이 필요한 채널 — 블로그(조회·검색유입) · 클립(조회) · 당근(유효시청·좋아요·보상 + 링크) */
  if (r.channel === 'blog' && done) {
    tile.appendChild(numInputRow(ctx, r, [{ key: 'views', label: '조회' }, { key: 'search_inflow_pct', label: '검색유입 %' }]));
  }
  if (r.channel === 'clip' && done) {
    tile.appendChild(numInputRow(ctx, r, [{ key: 'views', label: '조회' }]));
  }
  if (r.channel === 'daangn') {
    tile.appendChild(daangnLinkRow(ctx, r));
    tile.appendChild(numInputRow(ctx, r, [
      { key: 'valid_views', label: '유효시청' },
      { key: 'likes_comments', label: '좋아요' },
      { key: 'reward_krw', label: '보상(원)' }
    ]));
    const goal = daangnGoal(state.metrics, kstToday().slice(0, 7),
      state.daangnSeed && state.daangnSeed.eligibility);
    tile.appendChild(h('div', { class: 'cht-goal',
      text: '이번 달 ' + goal.stories + '/' + goal.storyGoal + '편 · '
        + Number(goal.valid).toLocaleString('ko-KR') + '/' + Number(goal.viewGoal).toLocaleString('ko-KR') + '회' }));
  }
  return tile;
}

function trendEl(r) {
  if (r.trend == null) return null;
  if (r.trend === 0) return h('span', { class: 'trend flat', text: '—' });
  const up = r.trend > 0;
  const text = r.trendKind === 'diff'
    ? (up ? '↑ ' : '↓ ') + Math.abs(r.trend).toLocaleString('ko-KR')
    : (up ? '↑ ' : '↓ ') + Math.abs(r.trend) + '%';
  return h('span', { class: 'trend' + (up ? '' : ' down'),
    title: r.trendKind === 'diff' ? '직전 입력 대비' : '직전 수집 대비', text });
}

/** 숫자 인라인 입력 — 저장하면 Metrics 에 한 줄 쌓인다 */
function numInputRow(ctx, r, fields) {
  const { d, contentId, dlg, toast } = ctx;
  const row = h('div', { class: 'cht-in' });
  const inputs = {};
  fields.forEach((f) => {
    /* 이전에 넣은 값이 있으면 채워 둔다 — 빈칸으로 저장해 0이 덮어쓰는 일을 막는다 */
    const prev = (r.last && r.last[f.key] != null) ? r.last[f.key]
      : ((f.key === 'views' || fields.length === 1) && r.value != null ? r.value : '');
    const inp = h('input', { type: 'text', inputmode: 'numeric', placeholder: f.label, 'aria-label': r.label + ' ' + f.label,
      value: prev === '' || prev == null ? '' : String(prev) });
    inputs[f.key] = inp;
    row.appendChild(h('label', { class: 'cht-if' }, h('span', { text: f.label }), inp));
  });
  const btn = h('button', { class: 'btn xs', type: 'button', text: '저장' });
  row.appendChild(btn);
  btn.addEventListener('click', async () => {
    const items = {};
    for (const f of fields) {
      const raw = String(inputs[f.key].value || '').replace(/[,\s]/g, '');
      const n = raw === '' ? 0 : Number(raw);
      if (!Number.isFinite(n) || n < 0) {
        toast(f.label + '은(는) 0 이상의 숫자로 넣어 주세요', 'err');
        inputs[f.key].focus();
        return;
      }
      items[f.key] = n;
    }
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = '저장 중…';
    try {
      await api.recordMetrics({
        items: [Object.assign({ content_id: contentId, channel: r.channel, snapshot: 'LATEST', measured_at: kstToday() }, items)]
      }, api.createAction('metrics'));
      toast(r.label + ' 숫자를 저장했어요', 'ok');
      dlg.close();
      await refresh();
      renderRoute();
      openDetail(contentId, 'ana');
    } catch (err) {
      toast(friendlyError(err), 'err');
      btn.disabled = false;
      btn.textContent = label;
    }
  });
  return row;
}

/** 당근 스토리 공유 링크 — 붙여넣으면 '올림'으로 바꾼다(앱 전용이라 웹 확인은 불가) */
function daangnLinkRow(ctx, r) {
  const { d, contentId, dlg, toast } = ctx;
  const input = h('input', { type: 'text', inputmode: 'url', autocomplete: 'off', spellcheck: 'false',
    placeholder: '공유 링크 붙여넣기', value: r.url || '', 'aria-label': '당근 스토리 공유 링크' });
  const btn = h('button', { class: 'btn xs', type: 'button', text: r.url ? '변경' : '저장' });
  const row = h('div', { class: 'cht-in' }, h('label', { class: 'cht-if wide' }, h('span', { text: '스토리 링크' }), input), btn);
  btn.addEventListener('click', async () => {
    const url = String(input.value || '').trim();
    if (!/^(https?:\/\/|daangn:\/\/)\S{4,500}$/i.test(url)) {
      toast('당근 앱에서 복사한 공유 링크를 붙여넣어 주세요', 'err');
      input.focus();
      return;
    }
    btn.disabled = true;
    btn.textContent = '저장 중…';
    try {
      const patch = { content_id: contentId, expected_version: d.version, daangn_url: url };
      if (!r.status || r.status === 'PENDING') patch.daangn_status = 'UPLOADED';
      await api.updateContent(patch, api.createAction('daangn'));
      toast('당근 스토리 링크를 저장했어요', 'ok');
      dlg.close();
      await refresh();
      renderRoute();
      openDetail(contentId, 'ana');
    } catch (err) {
      toast(friendlyError(err), 'err');
      btn.disabled = false;
      btn.textContent = '저장';
    }
  });
  return row;
}

function sourceSection(contentId, d, m, payload, dlg) {
  const wrap = h('div');

  wrap.appendChild(h('dl', { class: 'kv' },
    h('dt', { text: '가게·주제' }), h('dd', { text: m.place_name || '-' }),
    h('dt', { text: '제목' }), h('dd', { text: m.blog_title || '(미정)' }),
    h('dt', { text: '지역·분류' }), h('dd', { text: [m.region_dong, m.category].filter(Boolean).join(' · ') || '-' }),
    h('dt', { text: '키워드' }), h('dd', { text: m.target_keywords || '-' }),
    h('dt', { text: '품질 점수' }), h('dd', { text: m.quality_score ? m.quality_score + '점' : '아직 없음' }),
    h('dt', { text: '채널' }), h('dd', { text: brandChannels(m.brand || state.brand).map((c) => c.label + ' ' + (m[c.st] ? channelLabel(m[c.st]) : '아직 없음')).join(' · ') }),
    h('dt', { text: '수정' }), h('dd', { text: relTime(m.updated_at) + ' · ' + (m.updated_by || '-') })));

  const links = brandChannels(m.brand || state.brand).filter((c) => m[c.url]);
  if (links.length) {
    wrap.appendChild(h('h3', { style: 'margin:14px 0 6px;font-size:13px', text: '채널 링크' }));
    const dl = h('dl', { class: 'kv' });
    links.forEach((c) => {
      dl.appendChild(h('dt', { text: c.label }));
      dl.appendChild(h('dd', null,
        h('span', { class: 'badge ' + (m[c.st] || 'PENDING'), title: m[c.st] || 'PENDING', text: statusLabel(m[c.st]) }), ' ',
        h('a', { href: m[c.url], target: '_blank', rel: 'noopener noreferrer', text: m[c.url] })));
    });
    wrap.appendChild(dl);
  }

  /* 블로그 원고는 JSON 덩어리보다 글로 먼저 읽혀야 한다.
     GAS get_content_detail 이 payload 파일(payload.blog.body)을 그대로 돌려주므로,
     body 가 있는 카드만 본문 전문을 그대로 펼쳐 보여 준다(없는 카드는 예전 화면 그대로). */
  const blogDoc = (payload && typeof payload.blog === 'object' && payload.blog) ? payload.blog : null;
  const blogBody = (blogDoc && typeof blogDoc.body === 'string') ? blogDoc.body : '';
  if (blogBody.trim()) {
    wrap.appendChild(h('details', { open: true, style: 'margin-top:14px' },
      h('summary', { style: 'font-size:13px;font-weight:700;cursor:pointer',
        text: '블로그 원고 본문 · ' + Array.from(blogBody.trim()).length + '자' }),
      blogDoc.title ? h('div', { style: 'margin-top:8px;font-size:13px;font-weight:700', text: blogDoc.title }) : null,
      h('pre', {
        style: 'margin-top:8px;max-height:440px;overflow:auto;white-space:pre-wrap;word-break:break-word;'
          + 'background:var(--bg-soft);border:1px solid var(--line);border-radius:12px;padding:12px 14px;'
          + 'font:inherit;font-size:13.5px;line-height:1.8;color:var(--tx)',
        text: blogBody
      })));
  }

  if (payload) {
    const det = h('details', { style: 'margin-top:14px' },
      h('summary', { style: 'font-size:13px;font-weight:700;cursor:pointer', text: '원고·대본 파일 원문 보기 (JSON)' }),
      h('pre', { class: 'json', style: 'margin-top:8px;max-height:320px;overflow:auto', text: JSON.stringify(payload, null, 2) }));
    wrap.appendChild(det);
  }

  /* 메타 보정 — 발행 기록만 가져온 행은 키워드·품질점수가 비어 있다.
     여기서 채우면 보드 뱃지·검색이 실제 데이터로 동작한다(시트에 저장). */
  const kwInput = h('input', {
    type: 'text', value: m.target_keywords || '', autocomplete: 'off',
    placeholder: '예: 대전 봉명동 맛집, 봉명동 야장'
  });
  const scoreInput = h('input', {
    type: 'number', min: '0', max: '100', inputmode: 'numeric', value: m.quality_score || '',
    placeholder: '0~100'
  });
  const metaNote = h('span', { class: 'hint', text: '' });
  const metaSave = h('button', { class: 'btn sm primary', type: 'button', text: '저장' });
  metaSave.addEventListener('click', async () => {
    const rawScore = String(scoreInput.value).trim();
    const score = rawScore === '' ? '' : Number(rawScore);
    if (score !== '' && (Number.isNaN(score) || score < 0 || score > 100)) {
      toast('품질 점수는 0~100 사이 숫자로 넣어 주세요', 'err');
      scoreInput.focus();
      return;
    }
    const label = metaSave.textContent;
    metaSave.disabled = true;
    metaSave.textContent = '저장 중…';
    metaNote.textContent = '';
    try {
      const action = api.createAction('meta');
      await api.updateContent({
        content_id: contentId,
        expected_version: d.version,
        target_keywords: String(kwInput.value).trim(),
        quality_score: score
      }, action);
      toast('메타 저장 완료', 'ok');
      await refresh();
      renderRoute();
      openDetail(contentId, 'src');
    } catch (err) {
      metaNote.textContent = friendlyError(err);
      toast(friendlyError(err), 'err');
      metaSave.disabled = false;
      metaSave.textContent = label;
    }
  });
  wrap.appendChild(h('section', { class: 'meta-edit' },
    h('h3', { text: '정보 채우기' }),
    h('label', { class: 'field' },
      h('span', { class: 'field-label', text: '타깃 키워드 (쉼표로 구분)' }), kwInput),
    h('label', { class: 'field' },
      h('span', { class: 'field-label', text: '품질 점수 (0~100)' }), scoreInput),
    h('div', { class: 'row' }, metaSave, metaNote)));

  if (d.internal_links && d.internal_links.length) {
    wrap.appendChild(h('h3', { style: 'margin:14px 0 6px;font-size:13px', text: '같은 주제 지난 글 (본문에 링크로 걸면 좋아요)' }));
    const list = h('div', { class: 'list' });
    d.internal_links.forEach((l) => list.appendChild(h('div', { class: 'lrow' },
      h('div', { class: 'l-main' },
        h('div', { class: 'l-title', text: l.title || l.content_id }),
        h('div', { class: 'l-sub', text: l.blog_url || '링크 없음' })))));
    wrap.appendChild(list);
  }

  if (d.active_rules && d.active_rules.length) {
    wrap.appendChild(h('p', { class: 'hint', style: 'margin-top:12px',
      text: '적용 중인 노하우: ' + d.active_rules.map((r) => r.rule_id + ' ' + (r.version_tag || '')).join(', ') }));
  }

  wrap.appendChild(detailActionButtons(contentId, d, m, dlg));
  return wrap;
}

function detailActionButtons(contentId, d, m, dlg) {
  const actions = h('div', { class: 'row end', style: 'margin-top:16px' });
  if (d.status === 'PUBLISHED') {
    actions.appendChild(h('button', {
      class: 'btn sm primary', type: 'button',
      title: '모든 채널 업로드·연결이 끝났으면 마지막 칸으로 옮깁니다',
      text: '발행 끝으로 넘기기',
      onclick: async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        const label = btn.textContent;
        btn.textContent = '넘기는 중…';
        try {
          await api.updateContent({ content_id: contentId, expected_version: d.version, status: 'LINKED' },
            api.createAction('link'));
          toast('발행 끝으로 옮겼어요', 'ok');
          dlg.close();
          await refresh();
          renderRoute();
        } catch (err) {
          toast(friendlyError(err), 'err');
          btn.disabled = false;
          btn.textContent = label;
        }
      }
    }));
  }
  if (d.status === 'REVIEW') {
    actions.appendChild(h('button', { class: 'btn sm', type: 'button', text: '점검하러 가기', onclick: () => {
      state.reviewId = contentId; dlg.close(); location.hash = '#/review';
    } }));
    actions.appendChild(h('button', {
      class: 'btn sm primary', type: 'button',
      title: '검수 기록을 남기고 발행 준비 칸으로 넘깁니다', text: '확인 완료',
      onclick: async (e) => {
        e.target.disabled = true;
        try {
          await api.quickApprove(contentId, { channel: m.blog_status === 'SKIPPED' ? 'youtube_shorts' : 'naver_blog' });
          toast('발행 준비로 넘겼어요', 'ok');
          state.reviewId = null;
          dlg.close();
          await refresh();
          renderRoute();
        } catch (err) {
          toast(friendlyError(err), 'err');
          e.target.disabled = false;
        }
      }
    }));
  }
  return actions;
}

async function openDetail(contentId, opts = {}) {
  const dlg = $('#detail-dialog');
  const body = $('#detail-body');
  const tabBar = $('#detail-tabs');
  $('#detail-title').textContent = contentId;
  clear(body);
  if (tabBar) clear(tabBar);
  body.appendChild(h('div', { class: 'loading-skeleton' },
    h('div', { class: 'sk-line w40' }), h('div', { class: 'sk-card' })));
  // 메타 저장 뒤 다시 열 때: 이미 열려 있으면 showModal 이 예외를 던지는 브라우저가 있다
  if (dlg.open) dlg.close();
  dlg.showModal();

  try {
    const res = await api.getContentDetail(contentId);
    const d = res.data || {};
    const m = d.meta || {};
    const payload = d.payload || null;
    /* 발행 전 카드는 '작성본'이 먼저 보여야 한다 — 이 카드가 무슨 내용인지가 첫 질문이니까 */
    const wantDraft = DRAFTISH.indexOf(String(d.status || m.status || '')) >= 0;
    let tab = opts === 'src' ? 'src' : opts === 'ana' ? 'ana' : opts === 'produce' ? 'produce' : (wantDraft ? 'draft' : 'ana');

    const paintTabs = () => {
      if (!tabBar) return;
      clear(tabBar);
      [['draft', '작성본'], ['produce', '제작'], ['ana', '분석'], ['src', '원문·메타']].forEach((pair) => {
        tabBar.appendChild(h('button', {
          class: 'sheet-tab', type: 'button', role: 'tab', 'data-tab': pair[0],
          'aria-selected': pair[0] === tab ? 'true' : 'false',
          onclick: () => { tab = pair[0]; paintTabs(); paintBody(); }
        }, h('span', { text: pair[1] })));
      });
    };

    const paintBody = () => {
      clear(body);
      body.appendChild(h('div', { class: 'row', style: 'margin-bottom:10px' },
        badge(d.status), h('span', { class: 'cc-id', text: 'v' + d.version })));
      if (tab === 'draft') {
        body.appendChild(draftSection({
          h,
          detail: d,
          meta: m,
          toast,
          allowed: brandChannels(m.brand || state.brand).map((c) => (c.key === 'feed' ? 'ig_feed' : c.key)),
          onChanged: () => {
            draftCache.delete(contentId);
            refresh().then(() => { if (state.route === 'board') renderRoute(); });
          }
        }));
      } else if (tab === 'produce') {
        body.appendChild(produceSection({
          h,
          detail: d,
          meta: m,
          brand: m.brand || state.brand,
          toast,
          onNavigate: (hash) => { if (dlg.open) dlg.close(); location.hash = hash; }
        }));
      } else if (tab === 'ana') {
        body.appendChild(analysisSection(contentId, d, m, payload, dlg));
      } else {
        body.appendChild(sourceSection(contentId, d, m, payload, dlg));
      }
    };

    paintTabs();
    paintBody();
    /* 자동 수집분이 아직 없으면 한 번 읽어 와서 성과 탭만 다시 그린다(카드를 열 때마다 기다리지 않게) */
    if (!(state.analytics || []).length && api.configured) {
      getAnalytics(api, state.brand).then((cache) => {
        state.analytics = (cache && cache.rows) || [];
        state.analyticsError = (cache && cache.error) || null;
        if (dlg.open && tab === 'ana') paintBody();
      }).catch(() => { /* 수집 실패는 타일이 스스로 안내한다 */ });
    }
    /* 블로그 글별 통계도 아직이면 한 번 읽어 와서 다시 그린다 */
    if (state.brand === 'daejeon_youth' && !blogPostsOf().length && api.configured) {
      loadBlogStats(state, api).then(() => {
        if (dlg.open && tab === 'ana') paintBody();
      }).catch(() => {});
    }
  } catch (err) {
    clear(body);
    body.appendChild(h('div', { class: 'result err', text: friendlyError(err) }));
  }
}

/* ────────────────────────── 설정 ────────────────────────── */

function openSettings() {
  const cfg = loadConfig();
  $('#in-gas-url').value = cfg.baseUrl || '';
  $('#in-token').value = cfg.token || '';
  $('#in-token').type = 'password';
  $('#btn-toggle-token').textContent = '보기';
  const r = $('#conn-result');
  r.hidden = true;
  r.className = 'result';
  r.textContent = '';
  $('#settings-dialog').showModal();
}

function setConnResult(kind, text) {
  const r = $('#conn-result');
  r.hidden = false;
  r.className = 'result ' + (kind || '');
  r.textContent = text;
}

function wireSettings() {
  $('#btn-toggle-token').addEventListener('click', (e) => {
    const input = $('#in-token');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    e.target.textContent = show ? '숨기기' : '보기';
  });

  $('#btn-save-cfg').addEventListener('click', () => {
    const url = $('#in-gas-url').value.trim();
    const token = $('#in-token').value.trim();
    if (url && !/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec/.test(url)) {
      setConnResult('err', '주소 형식이 아니에요. 예: https://script.google.com/macros/s/AKfy…/exec');
      return;
    }
    saveConfig({ baseUrl: url, token });
    api.reload();
    setConnResult('ok', '저장했어요. 이 브라우저에만 보관됩니다.');
    refresh().then(() => { renderRoute(); loadHealth(); });
    toast('설정 저장 완료', 'ok');
  });

  $('#btn-test').addEventListener('click', async (e) => {
    const url = $('#in-gas-url').value.trim();
    const token = $('#in-token').value.trim();
    if (!url || !token) {
      setConnResult('err', '주소와 연결 열쇠를 모두 넣어야 확인할 수 있어요.');
      return;
    }
    saveConfig({ baseUrl: url, token });
    api.reload();
    e.target.disabled = true;
    setConnResult('', '연결 확인 중…');
    try {
      const res = await api.health();
      const d = res.data || {};
      setConnResult('ok', [
        '✓ 연결 성공',
        `시트 ${d.sheets_total}개 (빠진 것 ${(d.sheets_missing || []).length})`,
        `브랜드 ${(d.brands || []).join(', ') || '-'}`,
        `원고 저장 폴더 ${d.drive_folders_ready ? '준비됨' : '없음'}`,
        `연결 열쇠 ${d.token_set ? '설정됨' : '없음'}`,
        d.backup && d.backup.last_backup_at ? `마지막 백업 ${relTime(d.backup.last_backup_at)}` : '백업 기록 없음'
      ].join('\n'));
      toast('연결됐어요', 'ok');
      await refresh();
      renderRoute();
      loadHealth();
    } catch (err) {
      setConnResult('err', '✕ ' + friendlyError(err));
    } finally {
      e.target.disabled = false;
    }
  });

  $('#btn-clear-token').addEventListener('click', () => {
    clearToken();
    api.reload();
    $('#in-token').value = '';
    setConnResult('err', '토큰을 삭제했습니다.');
    toast('토큰 삭제됨', 'ok');
    renderBanners();
    updateConnDot();
  });
}

/* ────────────────────────── 시작 ────────────────────────── */

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
