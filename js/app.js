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

const COLUMNS = [
  { key: 'draft', title: '입력 · 생성', statuses: ['DRAFT', 'GENERATING'], hint: '취재 등록만 된 상태' },
  { key: 'review', title: '검수 대기', statuses: ['REVIEW'], hint: '원고 · 대본 확인' },
  { key: 'ready', title: '발행 준비', statuses: ['READY'], hint: '업로드 대기' },
  { key: 'publishing', title: '발행 중', statuses: ['PUBLISHING', 'PUBLISHED'], hint: '링크 역삽입 대기' },
  { key: 'linked', title: '완료', statuses: ['LINKED'], hint: '발행 · 링크 완료' },
  { key: 'human', title: '사람 대기', statuses: ['NEEDS_HUMAN', 'PARTIAL_FAIL'], hint: '캡차 · 2FA · 실패 격리', alert: true }
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
  return h('span', { class: 'badge ' + (status || 'DRAFT'), text: status || 'DRAFT' });
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
    host.appendChild(banner('warn', '⏱', '쿼터 서킷 작동 중', 'GAS 쿼터가 80%를 넘어 쓰기가 잠시 제한됩니다. 읽기만 가능합니다.'));
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
      case 'ERR_QUOTA_EXCEEDED': return 'GAS 쿼터 초과 — 60초 뒤에 다시 시도하세요.';
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
    h('button', { class: 'btn sm primary', type: 'button', onclick: () => { location.hash = '#/capture'; }, text: '＋ 취재 등록' })
  ));

  const search = h('input', {
    type: 'search', placeholder: '상호 · 제목 · 키워드 검색', value: state.search,
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
      h('h3', null, '아직 콘텐츠가 0건입니다'),
      h('p', { class: 'hint', text: '운영 → 콜드스타트 온보딩을 한 번 돌리면 훅 · 포맷 · 키워드가 시드되고 2주 캘린더 10건(DRAFT)이 자동으로 생깁니다.' }),
      h('div', { class: 'row', style: 'margin-top:10px' },
        h('button', { class: 'btn sm', type: 'button', text: '운영 열기', onclick: () => { location.hash = '#/ops'; } }),
        h('button', { class: 'btn sm primary', type: 'button', text: '＋ 취재 등록', onclick: () => { location.hash = '#/capture'; } }))));
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
        h('p', { class: 'hint', style: 'font-size:11px;color:var(--tx-3);margin:-2px 2px 4px', text: col.hint }));
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
  main.appendChild(pageHead('10초 승인', `${brand.name} · 검수 대기 원고를 폰에서 바로 승인`));
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
  main.appendChild(pageHead('취재 등록', `${brand.name} · 30초 안에 DRAFT 콘텐츠 만들기`));

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

  add('place_name', '상호 · 주제', { req: true, placeholder: '예: 미미삼겹 유성점 / 화장실 물 마시는 메리' });
  const grid = h('div', { class: 'form-grid two' });
  form.appendChild(grid);
  const gridField = (key, label, placeholder) => {
    fields[key] = h('input', { type: 'text', placeholder, autocomplete: 'off' });
    grid.appendChild(h('label', { class: 'field' }, h('span', { class: 'field-label', text: label }), fields[key]));
  };
  gridField('region_dong', '지역(동)', '예: 봉명동');
  gridField('category', '분류', '예: 한식 · 고기');
  gridField('cluster_id', '클러스터', '예: 유성 삼겹살 (내부링크 묶음)');
  gridField('target_keywords', '타깃 키워드', '쉼표로 구분');
  gridField('naver_place_url', '네이버 플레이스 URL', 'https://map.naver.com/...');
  gridField('media_drive_url', '사진 · 영상 폴더', 'Drive 폴더 URL');

  const receipt = h('input', { type: 'checkbox' });
  const partial = h('input', { type: 'checkbox' });
  form.appendChild(h('div', { class: 'row', style: 'margin:4px 0 12px;gap:16px' },
    h('label', { class: 'switch' }, receipt, h('span', { text: '영수증 · 방문 인증 있음' })),
    h('label', { class: 'switch' }, partial, h('span', { text: '숏폼 부분 발행 허용' }))));

  const submit = h('button', { class: 'btn primary block', type: 'submit', text: 'DRAFT 만들기' });
  form.appendChild(submit);

  const result = h('div', { hidden: true });
  form.appendChild(result);

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const place = fields.place_name.value.trim();
    if (!place) { fields.place_name.focus(); toast('상호 · 주제는 필수입니다', 'err'); return; }
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
        h('strong', { text: '✓ ' + d.content_id + ' 생성 완료' }),
        h('p', { class: 'hint', text: '상태 DRAFT · ' + (d.pipeline_mode === 'ONE_STAGE_SHORTFORM' ? '1단계 완결(숏폼 업로드 → LINKED)' : '2단계 순환(숏폼 3종 → 블로그 → 역삽입)') }),
        h('p', { class: 'hint', text: '사진 · 원고는 다음 단계에서 payload 로 붙습니다.' })));
      form.reset();
      await refresh();
      toast('DRAFT 생성 완료 · ' + d.content_id, 'ok');
    } catch (err) {
      result.hidden = false;
      clear(result);
      result.appendChild(h('div', { class: 'result err', text: friendlyError(err) }));
    } finally {
      submit.disabled = false;
      submit.textContent = 'DRAFT 만들기';
    }
  });

  main.appendChild(form);

  main.appendChild(h('div', { class: 'panel' },
    h('h3', null, '이 브랜드의 파이프라인'),
    h('p', { class: 'hint', text: state.brand === 'ppiyak_kimmary'
      ? '삐약 김메리: 쇼츠 · 릴스 업로드가 끝나면 바로 LINKED. 블로그 · 클립은 자동 SKIPPED.'
      : '대전 청년: 숏폼 3종(쇼츠 · 릴스 · 클립) 업로드 → 블로그 발행(숏폼 임베드) → 숏폼 고정댓글에 블로그 URL 역삽입 → LINKED.' })));
}

/* ────────────────────────── 검수 ────────────────────────── */

function renderReview(main) {
  const brand = BRANDS[state.brand];
  const reviewing = state.contents.filter((c) => c.status === 'REVIEW');
  main.appendChild(pageHead('원고 검수', `${brand.name} · 검수 대기 ${reviewing.length}건`,
    h('button', { class: 'btn sm', type: 'button', onclick: () => { location.hash = '#/approve'; }, text: '10초 승인' })));

  if (!reviewing.length) {
    main.appendChild(h('div', { class: 'empty', text: '검수할 원고가 없습니다.' }));
    return;
  }

  const list = h('div', { class: 'panel' }, h('h3', null, '검수 대기 목록'));
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
    h('dt', { text: '클러스터' }), h('dd', { text: item.cluster_id || '-' }),
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
    approveBtn.textContent = '승격 중…';
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
      toast('READY 승격 완료 · ' + score + '점', 'ok');
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
    text: '승격 기준: 체크 80점 이상 + 사람이 직접 확인(human_reviewed). 통과하지 않으면 서버가 ERR_TOS_REVIEW_REQUIRED 로 막습니다.' }));

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
  main.appendChild(pageHead('노하우 수집함', '잘 된 글·영상의 규칙을 모아 다음 원고에 반영'));

  const form = h('form', { class: 'panel' });
  const title = h('input', { type: 'text', placeholder: '예: 3초 훅 — 첫 컷에 결론 먼저', autocomplete: 'off' });
  const url = h('input', { type: 'url', placeholder: 'https:// (원문 링크, 선택)', autocomplete: 'off' });
  const tags = h('input', { type: 'text', placeholder: '태그: 훅, 자막, 썸네일', autocomplete: 'off' });
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
  main.appendChild(pageHead('운영 · 백업 · 보안', '헬스체크 · 수동 백업 · 무결성 · 복구 · 토큰 회전'));

  /* 연결 상태 */
  const cfg = loadConfig();
  const connPanel = h('div', { class: 'panel' },
    h('h3', null, '연결', h('span', { class: 'tag', text: mode === 'live' ? 'LIVE' : '미설정' })),
    h('dl', { class: 'kv' },
      h('dt', { text: 'Web App' }), h('dd', { text: cfg.baseUrl ? maskUrl(cfg.baseUrl) : '(없음)' }),
      h('dt', { text: '토큰' }), h('dd', { text: cfg.token ? '설정됨 · ' + cfg.token.length + '자' : '(없음)' }),
      h('dt', { text: '브랜드' }), h('dd', { text: BRANDS[state.brand].name })));
  connPanel.appendChild(h('div', { class: 'row', style: 'margin-top:12px' },
    h('button', { class: 'btn sm', type: 'button', text: '연결 테스트', onclick: (e) => runAction(e.target, async () => {
      const res = await api.health();
      return `시트 ${res.data.sheets_total}개 · 브랜드 ${(res.data.brands || []).length}개 · 폴더 ${res.data.drive_folders_ready ? 'OK' : '없음'} · 토큰 ${res.data.token_set ? 'SET' : '없음'}`;
    }) }),
    h('button', { class: 'ghost-btn sm', type: 'button', text: '설정 열기', onclick: openSettings })));

  const log = h('pre', { class: 'json', style: 'margin-top:12px', text: '결과가 여기에 남습니다.' });
  connPanel.appendChild(log);
  main.appendChild(connPanel);

  /* 헬스 */
  const healthPanel = h('div', { class: 'panel' },
    h('h3', null, '헬스체크'),
    h('p', { class: 'hint', text: 'health · get_system_health 를 읽어 지금 상태를 보여줍니다.' }));
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
      { k: '마지막 백업', v: b && b.last_backup_at ? relTime(b.last_backup_at) : '없음', cls: b && b.backup_stale ? 'bad' : b ? 'good' : '', sub: b && b.last_backup_tier ? b.last_backup_tier : '' },
      { k: '일일 호출', v: hd ? hd.daily_calls : '—', sub: 'GAS 쿼터 대비' },
      { k: '사람 대기', v: sh ? sh.needs_human.count : state.contents.filter((c) => c.status === 'NEEDS_HUMAN').length, cls: (sh && sh.needs_human.count) ? 'bad' : '', sub: '캡차 · 2FA' },
      { k: '무결성 이슈', v: sh ? sh.open_integrity_issues.count : '—', cls: sh && sh.open_integrity_issues.count ? 'bad' : 'good', sub: '미해결' },
      { k: '쿼터 서킷', v: hd && hd.quota_degraded ? '작동' : '정상', cls: hd && hd.quota_degraded ? 'bad' : 'good' },
      { k: '미완료 Ops', v: sh ? sh.pending_ops : '—', sub: 'Ops_Queue' }
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
    h('button', { class: 'btn sm', type: 'button', text: '헬스 다시 읽기', onclick: async (e) => {
      e.target.disabled = true;
      await loadHealth();
      fillStats();
      e.target.disabled = false;
    } })));
  main.appendChild(healthPanel);

  /* 백업 · 복구 */
  const backupPanel = h('div', { class: 'panel' },
    h('h3', null, '백업 · 무결성 · 복구'),
    h('p', { class: 'hint', text: '자동: 매일 03:00 · 주 일 03:30 · 월 1일 04:00 (KST). 보존 일 14 · 주 8 · 월 6.' }));

  backupPanel.appendChild(h('div', { class: 'row', style: 'margin-top:10px' },
    h('button', { class: 'btn sm', type: 'button', text: '지금 백업', onclick: (e) => runAction(e.target, async () => {
      const res = await api.backupNow('MANUAL');
      const d = res.data || {};
      await loadHealth();
      return `백업 ${d.partial ? '이어하기 필요' : '완료'} · 파일 ${d.copied || 0}개 · ${d.snapshot || ''}`;
    }) }),
    h('button', { class: 'btn sm', type: 'button', text: '무결성 점검', onclick: (e) => runAction(e.target, async () => {
      const res = await api.integrityCheck();
      const d = res.data || {};
      return `이슈 ${d.total_issues != null ? d.total_issues : '?'}건 (CRITICAL ${d.critical || 0} · WARN ${d.warn || 0})`;
    }) })));

  const restoreRow = h('div', { class: 'row', style: 'margin-top:10px;align-items:flex-end;gap:8px' });
  const dateInput = h('input', { type: 'date', 'aria-label': '복구 스냅샷 날짜', style: 'max-width:170px' });
  restoreRow.appendChild(h('label', { class: 'field', style: 'margin:0' },
    h('span', { class: 'field-label', text: '복구할 스냅샷 날짜' }), dateInput));
  restoreRow.appendChild(h('button', { class: 'ghost-btn danger', type: 'button', text: '스냅샷에서 복구', onclick: (e) => {
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
      return `복구 완료 · ${d.restored_sheet || ''} · payload 재매핑 ${d.payloads_remapped || 0}건`;
    });
  } }));
  backupPanel.appendChild(restoreRow);

  backupPanel.appendChild(h('div', { class: 'row', style: 'margin-top:10px' },
    h('button', { class: 'btn sm', type: 'button', text: '콜드스타트 온보딩', onclick: (e) => runAction(e.target, async () => {
      const res = await api.runColdstart(false);
      const d = res.data || {};
      // GAS 는 { created: { hooks, formats, places, keywords, contents } } 로 돌려준다.
      // (예전 응답처럼 플랫 필드로 오는 경우도 같이 받아 준다 — 표시가 [object Object] 로 깨지지 않게)
      const c = (d.created && typeof d.created === 'object') ? d.created : d;
      const num = (v) => Number(v) || 0;
      await refresh();
      return d.skipped
        ? `건너뜀 — ${d.reason || d.note || '이미 데이터 있음'}`
        : `시드 완료 · 캘린더 ${num(c.contents != null ? c.contents : c.created)}건`
          + ` (훅 ${num(c.hooks)} · 포맷 ${num(c.formats)} · 플레이스 ${num(c.places)} · 키워드 ${num(c.keywords)})`;
    }) })));

  backupPanel.appendChild(log);
  main.appendChild(backupPanel);

  /* 보안 */
  const secPanel = h('div', { class: 'panel' },
    h('h3', null, '보안'),
    h('p', { class: 'hint', text: '토큰은 ScriptProperties에만 있고, 회전하면 이전 토큰이 즉시 무효가 됩니다. 새 토큰은 1회만 표시됩니다.' }));
  const tokenOut = h('div', { hidden: true });
  secPanel.appendChild(h('div', { class: 'row', style: 'margin-top:10px' },
    h('button', { class: 'ghost-btn danger', type: 'button', text: '토큰 회전', onclick: async (e) => {
      if (!confirm('토큰을 회전하면 이전 토큰은 즉시 무효가 됩니다. 이 기기 설정도 새 토큰으로 바꿔야 합니다. 계속할까요?')) return;
      e.target.disabled = true;
      try {
        const res = await api.rotateToken();
        const tok = res.data && res.data.new_token;
        tokenOut.hidden = false;
        clear(tokenOut);
        tokenOut.appendChild(h('div', { class: 'result ok' },
          h('strong', { text: '새 토큰 (1회만 표시)' }),
          h('p', { style: 'font-family:var(--mono);word-break:break-all;margin:6px 0', text: tok || '' }),
          h('p', { class: 'hint', text: '지금 복사해 ⚙︎ → API 토큰에 붙여넣고 저장하세요. 이 화면을 닫으면 다시 볼 수 없습니다.' })));
      } catch (err) {
        tokenOut.hidden = false;
        clear(tokenOut);
        tokenOut.appendChild(h('div', { class: 'result err', text: friendlyError(err) }));
      } finally {
        e.target.disabled = false;
      }
    } }),
    h('button', { class: 'ghost-btn sm', type: 'button', text: '토큰 삭제', onclick: () => {
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
  dlg.showModal();

  try {
    const res = await api.getContentDetail(contentId);
    const d = res.data || {};
    const m = d.meta || {};
    clear(body);
    body.appendChild(h('div', { class: 'row', style: 'margin-bottom:10px' }, badge(d.status), h('span', { class: 'cc-id', text: 'v' + d.version })));
    body.appendChild(h('dl', { class: 'kv' },
      h('dt', { text: '상호·주제' }), h('dd', { text: m.place_name || '-' }),
      h('dt', { text: '제목' }), h('dd', { text: m.blog_title || '(미정)' }),
      h('dt', { text: '지역·분류' }), h('dd', { text: [m.region_dong, m.category].filter(Boolean).join(' · ') || '-' }),
      h('dt', { text: '키워드' }), h('dd', { text: m.target_keywords || '-' }),
      h('dt', { text: '품질점수' }), h('dd', { text: m.quality_score ? m.quality_score + '점' : '미채점' }),
      h('dt', { text: '채널' }), h('dd', { text: `블로그 ${m.blog_status || '-'} · 쇼츠 ${m.shorts_status || '-'} · 인스타 릴스 ${m.reels_status || '-'} · 인스타 피드 ${m.ig_feed_status || '-'} · 클립 ${m.clip_status || '-'}` }),
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
          h('span', { class: 'badge ' + (m[stKey] || 'PENDING'), text: m[stKey] || '-' }), ' ',
          h('a', { href: m[urlKey], target: '_blank', rel: 'noopener noreferrer', text: m[urlKey] })));
      });
      body.appendChild(dl);
    }

    if (d.payload) {
      body.appendChild(h('h3', { style: 'margin:14px 0 6px;font-size:13px', text: 'payload 미리보기' }));
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
      h('h3', { text: '메타 보정' }),
      h('label', { class: 'field' },
        h('span', { class: 'field-label', text: '타깃 키워드 (쉼표로 구분)' }), kwInput),
      h('label', { class: 'field' },
        h('span', { class: 'field-label', text: '품질 점수 (0~100)' }), scoreInput),
      h('div', { class: 'row' }, metaSave, metaNote)));

    if (d.internal_links && d.internal_links.length) {
      body.appendChild(h('h3', { style: 'margin:14px 0 6px;font-size:13px', text: '내부링크 후보 (같은 클러스터)' }));
      const wrap = h('div', { class: 'list' });
      d.internal_links.forEach((l) => wrap.appendChild(h('div', { class: 'lrow' },
        h('div', { class: 'l-main' },
          h('div', { class: 'l-title', text: l.title || l.content_id }),
          h('div', { class: 'l-sub', text: l.blog_url || '링크 없음' })))));
      body.appendChild(wrap);
    }

    if (d.active_rules && d.active_rules.length) {
      body.appendChild(h('p', { class: 'hint', style: 'margin-top:12px',
        text: '적용 규칙: ' + d.active_rules.map((r) => `${r.rule_id} ${r.version_tag || ''}`).join(', ') }));
    }

    const actions = h('div', { class: 'row end', style: 'margin-top:16px' });
    if (d.status === 'REVIEW') {
      actions.appendChild(h('button', { class: 'btn sm', type: 'button', text: '검수 화면으로', onclick: () => {
        state.reviewId = contentId; dlg.close(); location.hash = '#/review';
      } }));
      actions.appendChild(h('button', { class: 'btn sm primary', type: 'button', text: '✅ 바로 승인', onclick: async (e) => {
        e.target.disabled = true;
        try {
          await api.quickApprove(contentId, { channel: m.blog_status === 'SKIPPED' ? 'youtube_shorts' : 'naver_blog' });
          toast('READY 승격 완료', 'ok');
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
      setConnResult('err', 'URL 형식이 아닙니다. 예: https://script.google.com/macros/s/AKfy…/exec');
      return;
    }
    saveConfig({ baseUrl: url, token });
    api.reload();
    setConnResult('ok', '저장했습니다. 이 브라우저(localStorage)에만 보관됩니다.');
    refresh().then(() => { renderRoute(); loadHealth(); });
    toast('설정 저장 완료', 'ok');
  });

  $('#btn-test').addEventListener('click', async (e) => {
    const url = $('#in-gas-url').value.trim();
    const token = $('#in-token').value.trim();
    if (!url || !token) {
      setConnResult('err', 'URL과 토큰을 모두 넣어야 테스트할 수 있습니다.');
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
        `시트 ${d.sheets_total}개 (누락 ${(d.sheets_missing || []).length})`,
        `브랜드 ${(d.brands || []).join(', ') || '-'}`,
        `payload 폴더 ${d.drive_folders_ready ? '준비됨' : '없음'}`,
        `토큰 ${d.token_set ? 'SET' : '없음'}`,
        d.backup && d.backup.last_backup_at ? `마지막 백업 ${relTime(d.backup.last_backup_at)}` : '백업 기록 없음'
      ].join('\n'));
      toast('GAS 연결 성공', 'ok');
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
