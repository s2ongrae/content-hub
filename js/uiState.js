/**
 * js/uiState.js — 화면 공통 '기다림 · 실패' 안내 (2026-11-26)
 *
 * 왜 한 곳에 모으나
 *  - 같은 실패가 화면마다 다른 말로 나왔다. 어떤 곳은 `ERR_NETWORK` 코드를 그대로,
 *    어떤 곳은 자기만의 표(friendlyError · errorText · blogErrorText · 인라인 분기)로 바꿨다.
 *  - 로딩 표시도 '불러오는 중…' · '읽는 중…' · '확인 중…' 이 제각각이라 같은 동작이 다르게 보였다.
 *  - 버튼을 잠그고(disabled + '저장 중…') 손으로 풀던 곳들이 실패 뒤 원래 글자를 잃기도 했다.
 *
 * 규칙
 *  - 사용자에게 코드(ERR_XXX)를 보여 주지 않는다. 코드는 title 툴팁과 console 에만 남긴다.
 *  - 서버가 사유를 준 입력 오류는 서버 문장을 그대로 쓴다(사람이 고칠 수 있는 말이라서).
 *  - [다시 시도]는 눌러서 결과가 달라질 수 있는 실패에만 붙인다.
 *    미배포(재배포 필요) · 입력 오류 · 권한 오류는 다시 눌러도 같으므로 안내만 한다.
 *  - DOM 은 만들지 않는다(h 를 인자로 받는다). 브라우저 없이 시험할 수 있게.
 */

/* ────────────────────────── 코드 분류 ────────────────────────── */

/** 서버(GAS)에 그 기능이 아직 배포되지 않았을 때 오는 코드들 — 재시도가 아니라 재배포 안내. */
export const DEPLOY_GAP_CODES = [
  'ERR_NOT_IMPLEMENTED', 'ERR_UNKNOWN_ACTION', 'ERR_INVALID_ACTION',
  'ERR_ACTION_NOT_ALLOWED', 'ERR_SERVER_CONFIG'
];

/** 다시 눌러 볼 가치가 있는 코드들(잠깐의 혼잡·연결 문제). */
const RETRYABLE_CODES = [
  'ERR_BUSY', 'ERR_RATE_LIMITED', 'ERR_QUOTA_EXCEEDED',
  'ERR_NETWORK', 'ERR_OFFLINE', 'ERR_TIMEOUT',
  'ERR_BAD_RESPONSE', 'ERR_INTERNAL', 'ERR_UNEXPECTED'
];

/** 사람이 고쳐야 하는 입력 오류 — 서버가 준 사유를 그대로 보여 준다. */
const INPUT_CODES = ['ERR_VALIDATION_FAILED', 'ERR_INVALID_BRAND', 'ERR_PAYLOAD_TOO_LARGE', 'BAD_REQUEST'];

const CONFIG_CODES = ['ERR_NO_CONFIG', 'ERR_UNAUTHORIZED', 'ERR_AUTH_FAILED', 'ERR_INVALID_TOKEN', 'ERR_GET_TOKEN_FORBIDDEN', 'ERR_SCOPE_NOT_ALLOWED'];

/* ────────────────────────── 코드 → 문장 ────────────────────────── */

/**
 * 사용자에게 보여 줄 문장. 문장이 없으면 아래 규칙(입력·미배포·일반)으로 만든다.
 * 여기에 없는 코드도 코드가 그대로 노출되지 않는다 — friendlyError 가 마지막에 막는다.
 */
export const ERROR_SENTENCE = {
  /* 연결 설정 */
  ERR_NO_CONFIG: 'GAS 웹앱 주소와 API 토큰이 아직 연결되지 않았어요. ⚙︎ → 연결에서 넣어 주세요.',
  ERR_UNAUTHORIZED: '토큰이 맞지 않아요. 시트 메뉴 → 2. API 토큰 확인에서 다시 복사해 주세요.',
  ERR_AUTH_FAILED: '토큰이 맞지 않아요. 시트 메뉴 → 2. API 토큰 확인에서 다시 복사해 주세요.',
  ERR_INVALID_TOKEN: '토큰이 만료됐어요. 시트 메뉴 → 2. API 토큰 확인에서 새 토큰을 복사해 주세요.',
  ERR_GET_TOKEN_FORBIDDEN: '토큰은 주소창이 아니라 요청 본문으로만 보낼 수 있어요.',
  ERR_SCOPE_NOT_ALLOWED: '이 토큰에는 그 작업 권한이 없어요. 시트 메뉴에서 토큰 권한을 확인해 주세요.',

  /* 연결·시간 */
  ERR_NETWORK: '인터넷 연결이 끊겼거나 GAS 주소가 잘못됐어요. 연결을 확인한 뒤 다시 시도해 주세요.',
  ERR_OFFLINE: '지금은 오프라인이에요. 인터넷이 붙으면 다시 시도해 주세요.',
  ERR_TIMEOUT: '서버 응답이 시간 안에 오지 않았어요. 잠시 뒤 다시 시도해 주세요.',
  ERR_BAD_RESPONSE: '서버가 화면이 읽을 수 없는 응답을 보냈어요. 배포 액세스가 "모든 사용자"인지 확인해 주세요.',

  /* 잠깐 기다리면 풀리는 것 */
  ERR_BUSY: '다른 작업이 처리 중이에요. 1초쯤 뒤 다시 시도해 주세요.',
  ERR_RATE_LIMITED: '요청이 너무 잦았어요. 잠시 뒤 다시 시도해 주세요.',
  ERR_QUOTA_EXCEEDED: '구글 사용량 한도를 넘었어요 — 60초 뒤에 다시 시도해 주세요.',
  ERR_INTERNAL: '서버가 처리하다 멈췄어요. 잠시 뒤 다시 시도해 주세요.',
  ERR_UNEXPECTED: '서버가 처리하다 멈췄어요. 잠시 뒤 다시 시도해 주세요.',

  /* 상태·계약 */
  ERR_VERSION_CONFLICT: '다른 곳에서 먼저 수정됐어요. 새로고침한 뒤 다시 시도해 주세요.',
  ERR_NOT_FOUND: '찾는 항목이 없어요. 목록을 새로고침해 주세요.',
  ERR_TOS_REVIEW_REQUIRED: '검수 기록이 먼저 필요해요. 검수 화면에서 체크리스트를 끝내 주세요.',
  ERR_LINK_INCOMPLETE: '아직 기록이 없는 채널이 있어요 — 링크를 넣거나 [그래도 넘기기]를 눌러 주세요.',
  ERR_SENSITIVE_FIELD: '민감한 칸은 이 화면에서 고칠 수 없어요. 시트에서 직접 바꿔 주세요.',

  /* 노트북 오더 큐 */
  ERR_QUEUE_TYPE_UNKNOWN: '노트북 큐가 아직 이 주문을 몰라요 — 큐를 새로 배포한 뒤 다시 보내 주세요.',
  ERR_QUEUE_UNREACHABLE: '노트북에 닿지 못했어요. 집 노트북이 켜져 있는지 확인해 주세요.',
  ERR_QUEUE_TIMEOUT: '노트북이 제때 답하지 않았어요. 큐가 켜져 있는지 확인한 뒤 다시 보내 주세요.',
  ERR_QUEUE_REJECTED: '노트북이 이 주문을 거절했어요. 포털 오더함에서 사유를 확인해 주세요.',

  /* 네이버·수집 */
  ERR_BLOG_UNREACHABLE: '네이버가 잠깐 응답하지 않았어요. 조금 뒤 다시 눌러 주세요.',
  ERR_BLOG_FORMAT: '네이버 화면 형식이 바뀐 것 같아요 — 개발 쪽 확인이 필요해요.',
  ERR_BLOG_SKIPPED: '이 브랜드는 블로그를 쓰지 않아요.',
  ERR_NO_NAVER_KEY: '네이버 검색 API 키가 필요해요. 관리 탭에서 키를 넣어 주세요.',
  ERR_NAVER_UNREACHABLE: '네이버가 잠깐 응답하지 않았어요. 조금 뒤 다시 시도해 주세요.',
  ERR_NAVER_BAD_RESPONSE: '네이버가 예상과 다른 응답을 보냈어요. 조금 뒤 다시 시도해 주세요.',
  ERR_INSIGHT_BUDGET: '오늘 데이터랩 호출 한도를 다 썼어요. 내일 다시 시도해 주세요.',
  ERR_GEMINI_BUDGET: '오늘 무료 AI 호출 한도를 다 썼어요. 내일 다시 시도해 주세요.',
  ERR_BGM_UNREACHABLE: '음원 사이트가 잠깐 응답하지 않았어요. 조금 뒤 다시 찾아 주세요.',

  /* 상품 링크 */
  ERR_PRODUCT_FETCH: '상품 정보를 가져오지 못했어요. 링크를 확인하거나 아래 칸에 직접 적어 주세요.',
  ERR_PRODUCT_DUPLICATE: '이미 만든 상품이에요. 아래에서 그 카드를 이어서 쓰면 됩니다.',
  ERR_PRODUCT_BLOCKED: '이 주소는 상품 페이지로 열 수 없어요(로그인·차단 페이지). 직접 적어 주세요.',

  /* 백업·운영 */
  ERR_BACKUP_STALE: '마지막 성공 백업이 오래됐어요. 관리 탭에서 지금 백업해 주세요.',
  ERR_NO_FOLDER: '드라이브 폴더를 찾지 못했어요. 관리 탭에서 폴더를 다시 만들어 주세요.',
  ERR_BRIEF_SCHEMA_MISMATCH: '브리프 형식이 서버가 아는 것과 달라요. 관리 탭에서 형식을 맞춰 주세요.',
  ERR_MODEL_NOT_ALLOWED: '허용되지 않은 모델이에요. 관리 탭에서 모델을 확인해 주세요.'
};

function normalizeErr(err) {
  if (err == null) return { code: '', message: '', status: 0, details: {} };
  if (typeof err === 'string') return { code: String(err).toUpperCase(), message: '', status: 0, details: {} };
  return {
    code: String(err.code || '').toUpperCase(),
    message: String(err.message || '').trim(),
    status: Number(err.status) || 0,
    details: err.details || {}
  };
}

export function isDeployGap(codeOrErr) {
  const { code } = normalizeErr(codeOrErr);
  return DEPLOY_GAP_CODES.indexOf(code) >= 0;
}

/** 다시 눌러 볼 가치가 있는가 — 5xx·잠깐의 혼잡·연결 문제만. */
export function isRetryable(codeOrErr) {
  const { code, status } = normalizeErr(codeOrErr);
  if (!code) return false;
  if (RETRYABLE_CODES.indexOf(code) >= 0) return true;
  if (/^ERR_HTTP_5\d\d$/.test(code)) return true;
  return status >= 500;
}

function titleOf(code) {
  if (DEPLOY_GAP_CODES.indexOf(code) >= 0) return '서버 업데이트가 필요해요';
  if (CONFIG_CODES.indexOf(code) >= 0) return '연결을 확인해 주세요';
  if (INPUT_CODES.indexOf(code) >= 0) return '입력을 확인해 주세요';
  if (code === 'ERR_TIMEOUT' || code === 'ERR_NETWORK' || code === 'ERR_OFFLINE' || code === 'ERR_BAD_RESPONSE') return '연결이 잠깐 끊겼어요';
  if (code === 'ERR_BUSY' || code === 'ERR_RATE_LIMITED' || code === 'ERR_QUOTA_EXCEEDED') return '지금은 잠시 기다려 주세요';
  if (code === 'ERR_VERSION_CONFLICT') return '최신 상태로 다시 맞춰요';
  return '처리하지 못했어요';
}

/**
 * 실패 하나 → { code, title, text, retryable, deployGap }.
 * err 는 ApiError·Error·코드 문자열 모두 받는다(화면 상태에는 코드만 남는 곳이 많다).
 */
export function errorInfo(err) {
  const { code, message } = normalizeErr(err);
  const deployGap = DEPLOY_GAP_CODES.indexOf(code) >= 0;
  let text = ERROR_SENTENCE[code] || '';

  if (!text && deployGap) {
    text = '이 기능이 서버(Apps Script)에 아직 올라가지 않았어요. 해당 .gs 를 붙여 넣고 새 버전으로 배포하면 켜집니다.';
  }
  if (!text && INPUT_CODES.indexOf(code) >= 0) text = message || '입력값을 다시 확인해 주세요.';
  if (!text && message) text = message;                       // 서버가 준 사유가 있으면 그 말을 쓴다
  if (!text) text = '알 수 없는 오류가 났어요. 잠시 뒤 다시 시도해 주세요.';

  return { code, title: titleOf(code), text, retryable: isRetryable(code), deployGap };
}

/** 화면·토스트에 쓸 한 문장. 코드는 절대 문장에 섞지 않는다. */
export function friendlyError(err) {
  if (err == null || err === '') return '';
  return errorInfo(err).text;
}

/** 스튜디오 카드처럼 좁은 곳에 쓰는 짧은 한 줄(설계 §6의 실패 3종). */
export function shortErrorText(codeOrErr) {
  const { code } = normalizeErr(codeOrErr);
  if (code === 'ERR_TIMEOUT' || code === 'TIMEOUT' || code === 'ERR_QUEUE_TIMEOUT') return '⏳ 시간 초과 — 입력값은 안전하니 [다시 시도]를 눌러주세요';
  if (code === 'ERR_VERSION_CONFLICT') return '🔄 동시 수정이 감지돼 최신본과 병합 후 재저장합니다';
  return '⚠️ 연결 또는 형식 오류 — [관리 탭] 상태를 확인해 주세요';
}

/* ────────────────────────── 화면 조각 ────────────────────────── */

/** 코드는 화면에 쓰지 않고 툴팁으로만 남긴다(문의할 때 개발자가 찾을 수 있게). */
function codeAttrs(info) {
  return info.code ? { title: '오류 코드: ' + info.code } : {};
}

/**
 * 기다리는 중 — 화면마다 다르던 '불러오는 중…' 을 한 모양으로.
 * h(tag, attrs, ...kids) 는 각 화면이 쓰는 createElement 도우미.
 */
export function loadingPanel(h, text, opts = {}) {
  const kids = [];
  if (opts.skeleton !== false) {
    kids.push(h('div', { class: 'loading-skeleton', 'aria-hidden': 'true' },
      h('div', { class: 'sk-line w40' }), h('div', { class: 'sk-card' })));
  }
  kids.push(h('p', { class: 'hint', text: text || '불러오는 중이에요…' }));
  return h('div', { class: 'panel state-panel', role: 'status', 'aria-live': 'polite', 'aria-busy': 'true' }, ...kids);
}

/**
 * 실패 — 제목 · 사유 · (필요하면) [다시 시도].
 * opts: { title, text, hint, onRetry, retryText, extra }
 * onRetry 는 재시도 가치가 있는 실패에서만 그려진다(forceRetry 로 강제 가능).
 */
export function errorPanel(h, err, opts = {}) {
  const info = errorInfo(err);
  const title = opts.title || info.title || '불러오지 못했어요';
  const kids = [
    h('h3', codeAttrs(info), title),
    h('p', { class: 'hint', text: opts.text || info.text })
  ];
  if (opts.hint) kids.push(h('p', { class: 'hint', text: opts.hint }));
  const canRetry = opts.onRetry && (info.retryable || opts.forceRetry);
  if (canRetry || opts.extra) {
    kids.push(h('div', { class: 'row', style: 'margin-top:10px' },
      canRetry ? h('button', { class: 'btn sm primary', type: 'button', text: opts.retryText || '다시 시도', onclick: opts.onRetry }) : null,
      opts.extra || null));
  }
  return h('div', { class: 'panel state-panel', role: 'alert' }, ...kids);
}

/**
 * 버튼 잠금 — 누르는 동안 disabled + 다른 글자, 끝나면(성공·실패 모두) 원래대로.
 * 예전에는 화면마다 finally 를 손으로 썼고, 일부는 실패 뒤 '저장' 같은 다른 글자로 돌아갔다.
 * 반환값은 fn 의 약속 그대로(실패는 다시 던진다 — 화면이 자기 catch 로 안내한다).
 */
export function withBusy(btn, busyText, fn) {
  if (!btn) return Promise.resolve().then(fn);
  const label = btn.textContent;
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  if (busyText) btn.textContent = busyText;
  const restore = () => {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    btn.textContent = label;
  };
  let run;
  try { run = fn(); } catch (e) { restore(); return Promise.reject(e); }
  return Promise.resolve(run).then(
    (v) => { restore(); return v; },
    (e) => { restore(); throw e; }
  );
}
