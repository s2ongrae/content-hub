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

/* ────────────────────────── 상수 ────────────────────────── */

const BRANDS = {
  daejeon_youth: { name: '대전 청년', emoji: '🍺', channels: '블로그 · 쇼츠 · 인스타(릴스·피드) · 클립' },
  ppiyak_kimmary: { name: '삐약 김메리', emoji: '🐱', channels: '쇼츠 · 인스타(릴스·피드)' }
};

/* 화면에 보이는 말은 쉬운 한국어로. 시트·GAS 코드값(DRAFT·PUBLISHED·LINKED …)은 그대로 둔다. */
const STATUS_LABEL = {
  DRAFT: '초안', GENERATING: '작성 중', REVIEW: '확인 중', READY: '올릴 준비',
  PUBLISHING: '올리는 중', PUBLISHED: '일부 올라감', LINKED: '발행 끝',
  NEEDS_HUMAN: '확인 필요', PARTIAL_FAIL: '일부 실패',
  PENDING: '대기', UPLOADED: '올림', DONE: '완료', SKIPPED: '건너뜀', FAILED: '실패'
};
const statusLabel = (s) => STATUS_LABEL[s] || s || '-';

const COLUMNS = [
  { key: 'draft', title: '글감 · 초안', statuses: ['DRAFT', 'GENERATING'], hint: '메모만 적어 둔 단계' },
  { key: 'review', title: '내용 확인', statuses: ['REVIEW'], hint: '글·대본 읽어 보는 단계' },
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
  quick: null
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

function chanDots(item) {
  const wrap = h('span', { class: 'cc-chans' });
  const map = [
    ['블로그', 'blog_status', '블'],
    ['쇼츠', 'shorts_status', '숏'],
    ['인스타 릴스', 'reels_status', '릴'],
    ['인스타 피드', 'ig_feed_status', '피'],
    ['클립', 'clip_status', '클']
  ];
  map.forEach(([label, key, short]) => {
    const st = item[key];
    const on = st === 'DONE' || st === 'UPLOADED' || st === 'PUBLISHED' || st === 'LINKED';
    wrap.appendChild(h('span', { class: 'ch' + (st ? '' : ' off'), title: label + ': ' + (st || '기록 없음') },
      h('i', { class: 'chan-dot ' + (on ? 'on' : st === 'SKIPPED' ? 'skip' : '') }), short));
  });
  if (item.quality_score) wrap.appendChild(h('span', { class: 'score', text: item.quality_score + '점' }));
  return wrap;
}

/* ────────────────────────── 부트 ────────────────────────── */

async function boot() {
  try {
    wireChrome();
    state.route = (location.hash.replace(/^#\/?/, '') || 'board').split('?')[0];
    applyBrand(loadConfig().activeBrand || 'daejeon_youth', { silent: true });
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
    renderRoute();
  });
  wireSettings();
}

/* ────────────────────────── 브랜드 ────────────────────────── */

function applyBrand(brand, opts = {}) {
  if (!BRANDS[brand]) brand = 'daejeon_youth';
  state.brand = brand;
  api.setBrand(brand);
  document.documentElement.dataset.brand = brand;
  document.querySelectorAll('[data-brand-btn]').forEach((btn) => {
    btn.setAttribute('aria-selected', btn.dataset.brandBtn === brand ? 'true' : 'false');
  });
  state.search = '';
  state.reviewId = null;
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
    updateApproveBadge();
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
  document.querySelectorAll('[data-route]').forEach((tab) => {
    if (tab.dataset.route === route) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  });
  const main = $('#main');
  clear(main);
  const view = {
    board: renderBoard,
    approve: renderApprove,
    capture: renderCapture,
    review: renderReview,
    series: (main) => renderSeriesView(main, { h, state, toast, friendlyError }),
    knowhow: renderKnowHow,
    ops: renderOps
  }[route] || renderBoard;
  view(main);
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

  function paintBoard() {
    clear(boardHost);
    const q = state.search.trim().toLowerCase();
    COLUMNS.forEach((col) => {
      let items = state.contents.filter((c) => col.statuses.indexOf(c.status) >= 0);
      if (q) {
        items = items.filter((c) => `${c.place_name} ${c.blog_title || ''} ${c.target_keywords || ''}`.toLowerCase().indexOf(q) >= 0);
      }
      const colEl = h('section', { class: 'col' + (col.alert && items.length ? ' alert' : '') + (items.length ? '' : ' is-empty') },
        h('div', { class: 'col-head' },
          h('h2', { text: col.title }),
          h('span', { class: 'n', text: String(items.length) })),
        h('p', { class: 'hint', style: 'font-size:11px;color:var(--tx-3);margin:-2px 2px 4px',
          text: col.key === 'publishing' && state.brand === 'ppiyak_kimmary'
            ? '쇼츠·릴스는 올라감 — 발행 끝으로 넘기면 정리돼요'
            : col.hint }));
      if (!items.length) colEl.appendChild(h('div', { class: 'empty', text: '없음' }));
      items.forEach((item) => colEl.appendChild(contentCard(item)));
      boardHost.appendChild(colEl);
    });
  }
}

function contentCard(item) {
  return h('button', { class: 'ccard', type: 'button', onclick: () => openDetail(item.content_id) },
    h('div', { class: 'cc-top' },
      badge(item.status),
      h('span', { class: 'cc-id', text: item.content_id }),
      h('span', { class: 'spacer' }),
      item.growth_tag && item.growth_tag !== 'NONE' ? h('span', { class: 'badge DRAFT', text: item.growth_tag }) : null),
    h('div', { class: 'cc-title', text: item.blog_title || item.place_name || '(제목 없음)' }),
    h('div', { class: 'cc-meta' },
      item.region_dong ? h('span', { text: item.region_dong }) : null,
      item.category ? h('span', { text: item.category }) : null,
      h('span', { text: 'v' + (item.version || 1) })),
    chanDots(item),
    h('div', { class: 'cc-meta', style: 'margin-top:6px' }, h('span', { text: '수정 ' + relTime(item.updated_at) })));
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
      ? '삐약 김메리: 쇼츠·릴스만 올리면 끝이에요. 블로그·클립은 자동으로 건너뜁니다.'
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

async function openDetail(contentId) {
  const dlg = $('#detail-dialog');
  const body = $('#detail-body');
  $('#detail-title').textContent = contentId;
  clear(body);
  body.appendChild(h('div', { class: 'loading-skeleton' },
    h('div', { class: 'sk-line w40' }), h('div', { class: 'sk-card' })));
  // 메타 저장 뒤 다시 열 때: 이미 열려 있으면 showModal 이 예외를 던지는 브라우저가 있다
  if (dlg.open) dlg.close();
  dlg.showModal();

  try {
    const res = await api.getContentDetail(contentId);
    const d = res.data || {};
    const m = d.meta || {};
    clear(body);
    body.appendChild(h('div', { class: 'row', style: 'margin-bottom:10px' }, badge(d.status), h('span', { class: 'cc-id', text: 'v' + d.version })));
    body.appendChild(h('dl', { class: 'kv' },
      h('dt', { text: '가게·주제' }), h('dd', { text: m.place_name || '-' }),
      h('dt', { text: '제목' }), h('dd', { text: m.blog_title || '(미정)' }),
      h('dt', { text: '지역·분류' }), h('dd', { text: [m.region_dong, m.category].filter(Boolean).join(' · ') || '-' }),
      h('dt', { text: '키워드' }), h('dd', { text: m.target_keywords || '-' }),
      h('dt', { text: '품질 점수' }), h('dd', { text: m.quality_score ? m.quality_score + '점' : '아직 없음' }),
      h('dt', { text: '채널' }), h('dd', { text: [['블로그', m.blog_status], ['쇼츠', m.shorts_status], ['릴스', m.reels_status], ['피드', m.ig_feed_status], ['클립', m.clip_status]].map(([n, v]) => `${n} ${v ? statusLabel(v) : '아직 없음'}`).join(' · ') }),
      h('dt', { text: '수정' }), h('dd', { text: `${relTime(m.updated_at)} · ${m.updated_by || '-'}` })));

    // 채널별 발행 링크 — 시트에 기록된 실제 URL 을 그대로 보여 준다
    const channels = [
      ['블로그', 'blog_status', 'blog_url'],
      ['쇼츠', 'shorts_status', 'shorts_url'],
      ['인스타 릴스', 'reels_status', 'reels_url'],
      ['인스타 피드', 'ig_feed_status', 'ig_feed_url'],
      ['클립', 'clip_status', 'clip_url']
    ].filter(([, , k]) => m[k]);
    if (channels.length) {
      body.appendChild(h('h3', { style: 'margin:14px 0 6px;font-size:13px', text: '채널 링크' }));
      const dl = h('dl', { class: 'kv' });
      channels.forEach(([label, stKey, urlKey]) => {
        dl.appendChild(h('dt', { text: label }));
        dl.appendChild(h('dd', null,
          h('span', { class: 'badge ' + (m[stKey] || 'PENDING'), title: m[stKey] || 'PENDING', text: statusLabel(m[stKey]) }), ' ',
          h('a', { href: m[urlKey], target: '_blank', rel: 'noopener noreferrer', text: m[urlKey] })));
      });
      body.appendChild(dl);
    }

    if (d.payload) {
      body.appendChild(h('h3', { style: 'margin:14px 0 6px;font-size:13px', text: '원고·대본 파일 미리보기' }));
      body.appendChild(h('pre', { class: 'json', text: JSON.stringify(d.payload, null, 2).slice(0, 2400) }));
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
      const raw = String(scoreInput.value).trim();
      const score = raw === '' ? '' : Number(raw);
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
        openDetail(contentId);
      } catch (err) {
        metaNote.textContent = friendlyError(err);
        toast(friendlyError(err), 'err');
        metaSave.disabled = false;
        metaSave.textContent = label;
      }
    });
    body.appendChild(h('section', { class: 'meta-edit' },
      h('h3', { text: '정보 채우기' }),
      h('label', { class: 'field' },
        h('span', { class: 'field-label', text: '타깃 키워드 (쉼표로 구분)' }), kwInput),
      h('label', { class: 'field' },
        h('span', { class: 'field-label', text: '품질 점수 (0~100)' }), scoreInput),
      h('div', { class: 'row' }, metaSave, metaNote)));

    if (d.internal_links && d.internal_links.length) {
      body.appendChild(h('h3', { style: 'margin:14px 0 6px;font-size:13px', text: '같은 주제 지난 글 (본문에 링크로 걸면 좋아요)' }));
      const wrap = h('div', { class: 'list' });
      d.internal_links.forEach((l) => wrap.appendChild(h('div', { class: 'lrow' },
        h('div', { class: 'l-main' },
          h('div', { class: 'l-title', text: l.title || l.content_id }),
          h('div', { class: 'l-sub', text: l.blog_url || '링크 없음' })))));
      body.appendChild(wrap);
    }

    if (d.active_rules && d.active_rules.length) {
      body.appendChild(h('p', { class: 'hint', style: 'margin-top:12px',
        text: '적용 중인 노하우: ' + d.active_rules.map((r) => `${r.rule_id} ${r.version_tag || ''}`).join(', ') }));
    }

    const actions = h('div', { class: 'row end', style: 'margin-top:16px' });
    if (d.status === 'PUBLISHED') {
      // 발행은 됐지만 마지막 칸으로 정리되지 않은 카드(가져온 기록 등)를 사람이 한 번에 넘긴다
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
      actions.appendChild(h('button', { class: 'btn sm primary', type: 'button', title: '검수 기록을 남기고 발행 준비 칸으로 넘깁니다', text: '확인 완료', onclick: async (e) => {
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
      } }));
    }
    body.appendChild(actions);
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
