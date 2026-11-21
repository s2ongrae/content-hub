/**
 * gas/Auth.gs  —  인증 · 화이트리스트 · 멱등성 · 감사 · 보안 가드
 * Content Hub OS (daejeon_youth / ppiyak_kimmary)
 *
 * 확정 원칙 (PRD v2 §(j))
 *  - 토큰은 PropertiesService에만 존재. 시트·로그·URL 쿼리에 남기지 않는다.
 *  - 락은 tryLock(1800ms)만. 실패하면 즉시 ERR_BUSY(429 성격)로 돌려준다.
 *  - 감사 로그는 Channel_Logs 16컬럼(멱등키·response_digest·server_ms 포함).
 *  - 요청 본문 512KB 상한, 민감정보 키(비번·쿠키·OTP·카드·주민) 재귀 차단.
 *  - 쿼터 예외 발생 시 5분간 쓰기 차단(읽기 전용 강등).
 */

/** 액션 화이트리스트 — 여기 없는 action은 무조건 거부 */
const ACTION_WHITELIST = {
  // 코어 파이프라인 (M1에서 실제 구현)
  health:               { mode: 'READ',  allowDegraded: true,  m1: true },
  list_contents:        { mode: 'READ',  allowDegraded: true,  m1: true },
  get_content_detail:   { mode: 'READ',  allowDegraded: true,  m1: true },
  create_content:       { mode: 'WRITE', allowDegraded: false, m1: true },
  update_content:       { mode: 'WRITE', allowDegraded: false, m1: true },
  record_checklist:     { mode: 'WRITE', allowDegraded: false, m1: true },   // 모바일 10초 승인용
  list_metrics:         { mode: 'READ',  allowDegraded: true,  m1: true },   // 성과분석(#/perf) 읽기
  record_metrics:       { mode: 'WRITE', allowDegraded: false, m1: true },   // 성과 숫자 입력
  // 유튜브·인스타 자동 수집 (2026-11-19, gas/Analytics.gs) — 블로그 API 작업과 파일 분리
  list_analytics:       { mode: 'READ',  allowDegraded: true,  m1: true },   // 자동 수집분 읽기
  ingest_analytics:     { mode: 'WRITE', allowDegraded: false, m1: true },   // 수집기 적재(50건 묶음)
  // 채널 목록·콘텐츠 상세 드릴다운 (2026-11-19, gas/PostDetail.gs) — Media_Meta 만 새로 쓰고 나머지는 읽기
  get_post_detail:      { mode: 'READ',  allowDegraded: true,  m1: true },
  upsert_media_meta:    { mode: 'WRITE', allowDegraded: false, m1: true },   // 수집기가 제목·썸네일·길이를 올린다
  list_media_meta:      { mode: 'READ',  allowDegraded: true,  m1: true },
  // 운영 · 백업 · 보안 (M1에서 실제 구현)
  get_system_health:    { mode: 'READ',  allowDegraded: true,  m1: true },
  // 장시간 액션은 라우터 락을 잡지 않는다(30초 예산·전역 블로킹 방지). 내부 단계가 자체 락을 쓴다.
  backup_now:           { mode: 'WRITE', allowDegraded: false, m1: true, longRunning: true },
  integrity_check:      { mode: 'WRITE', allowDegraded: false, m1: true, longRunning: true },
  restore_from_snapshot:{ mode: 'WRITE', allowDegraded: false, m1: true, longRunning: true },
  rotate_token:         { mode: 'WRITE', allowDegraded: true,  m1: true },
  run_coldstart_onboarding: { mode: 'WRITE', allowDegraded: false, m1: true },  // 콜드스타트 위저드
  // 원스톱 만들기 화면 (2026-11-18, O4) — 드라이브 폴더 읽기 · 노트북 오더 프록시
  //   hub_order 는 바깥 큐를 최대 30초 기다린다 → 라우터 락을 잡지 않는다(longRunning).
  list_drive_media:     { mode: 'READ',  allowDegraded: true,  m1: true },
  hub_order:            { mode: 'WRITE', allowDegraded: false, m1: true, longRunning: true },
  // 오더 진행 상태(읽기 전용) — 큐 queue_list 를 한 번 부른다(외부 호출 → 라우터 락 없음)
  hub_order_status:     { mode: 'READ',  allowDegraded: true,  m1: true, longRunning: true },
  // 영상 올리기 (2026-11-20, gas/Upload.gs) — 브라우저가 2MB 조각으로 드라이브에 올리고, 노트북이 받아 간다.
  //   조각마다 감사 행을 남기면 시트가 수백 줄 불어난다 → noAudit(오류는 그대로 기록). 외부(드라이브) 호출이라 라우터 락 없음.
  upload_video_chunk:   { mode: 'WRITE', allowDegraded: false, m1: true, longRunning: true, noAudit: true },
  upload_video_delete:  { mode: 'WRITE', allowDegraded: false, m1: true, longRunning: true },
  asset_put:            { mode: 'WRITE', allowDegraded: false, m1: true, longRunning: true, noAudit: true },   // 자막·결과 보고(짧은 글) 저장
  asset_get:            { mode: 'READ',  allowDegraded: true,  m1: true, longRunning: true },
  upload_video_list:    { mode: 'READ',  allowDegraded: true,  m1: true, longRunning: true },
  upload_video_fetch:   { mode: 'READ',  allowDegraded: true,  m1: true, longRunning: true },
  // 내 블로그 보기 (2026-11-19) — gas/Blog.gs. 네이버 공개 데이터를 모은다(외부 호출 → 라우터 락 없음, 시트 쓰기만 자체 락)
  blog_sync:            { mode: 'WRITE', allowDegraded: false, m1: true, longRunning: true },
  list_blog_stats:      { mode: 'READ',  allowDegraded: true,  m1: true },
  blog_post_body:       { mode: 'READ',  allowDegraded: true,  m1: true },
  blog_rank_check:      { mode: 'WRITE', allowDegraded: false, m1: true, longRunning: true },
  blog_stats_ingest:    { mode: 'WRITE', allowDegraded: false, m1: true },   // 피클이 읽어 온 로그인 통계(조회수·검색어·유입·독자)
  // 네이버 데이터랩 (2026-11-21, gas/Insight.gs) — 검색어 트렌드·쇼핑 인사이트. 외부 호출 → 라우터 락 없음.
  //   자체 일·월 천장(트렌드 200/2,000 · 쇼핑 100/1,000)을 락 안에서 확인·차감하고, 넘으면 API 를 부르지 않는다.
  insight_trend:        { mode: 'WRITE', allowDegraded: false, m1: true, longRunning: true },
  insight_shopping:     { mode: 'WRITE', allowDegraded: false, m1: true, longRunning: true },
  insight_budget:       { mode: 'READ',  allowDegraded: true,  m1: true },
  // 파이프라인 상태머신 (M2 — 라우터만 연결, ERR_NOT_IMPLEMENTED)
  get_ready_queue:      { mode: 'READ',  allowDegraded: true,  m1: false },
  claim_task:           { mode: 'WRITE', allowDegraded: false, m1: false },
  renew_lease:          { mode: 'WRITE', allowDegraded: false, m1: false },
  report_publish:       { mode: 'WRITE', allowDegraded: false, m1: false },
  report_cross_link:    { mode: 'WRITE', allowDegraded: false, m1: false },
  // 분석 · 벤치마크 (M3)
  record_same_age_metric:{ mode: 'WRITE', allowDegraded: false, m1: false },
  ingest_benchmark:     { mode: 'WRITE', allowDegraded: false, m1: false },
  manage_prompt_rule:   { mode: 'WRITE', allowDegraded: false, m1: false },
  upsert_keyword:       { mode: 'WRITE', allowDegraded: false, m1: false },
  log_rank:             { mode: 'WRITE', allowDegraded: false, m1: false },
  upsert_place:         { mode: 'WRITE', allowDegraded: false, m1: false },
  log_outreach:         { mode: 'WRITE', allowDegraded: false, m1: false },
  log_cta:              { mode: 'WRITE', allowDegraded: false, m1: false }
};

const VALID_BRANDS_ = ['daejeon_youth', 'ppiyak_kimmary'];
const LOCK_WAIT_MS_ = 1800;
const IDEM_CACHE_TTL_SEC_ = 21600;      // 6시간
const RATE_LIMIT_WINDOW_SEC_ = 60;
const RATE_LIMIT_MAX_REQ_ = 120;        // 1인 사용 + 피클 병렬 호출 여유
const MAX_REQUEST_BYTES_ = 524288;      // 512KB
const MAX_PAYLOAD_BYTES_ = 204800;      // 200KB (Drive payload 1개)
const MAX_UPLOAD_REQUEST_BYTES_ = 3565158;   // 3.4MB — upload_video_chunk 만(2MB 조각의 base64 약 2.8MB + 봉투)

/** 비밀번호·쿠키·2FA·카드·주민번호 등은 저장 자체를 막는다 (C7) */
const SENSITIVE_KEY_PATTERN_ = /(passwd|password|pwd|secret|cookie|session(id)?|otp|2fa|auth_?code|cvc|cvv|card_?num|account_?num|rrn|resident|주민|계좌비번|api_?key|private_?key|access_?token|refresh_?token)/i;

/* ------------------------------------------------------------------ *
 * 1. 표준 에러 / 유틸
 * ------------------------------------------------------------------ */

function createAppError_(code, message, details) {
  const err = new Error(message);
  err.isAppError = true;
  err.code = code || 'ERR_INTERNAL';
  err.details = details || {};
  return err;
}

/** 하위 호환: 예전 이름으로 부르는 곳이 있어도 동작하게 */
function createApiError_(code, message, details) {
  return createAppError_(code, message, details);
}

function formatKstIso_(dateObj) {
  return Utilities.formatDate(dateObj || new Date(), 'Asia/Seoul', "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function nowMs_() {
  return Date.now();
}

function sha256Hex_(input) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, String(input), Utilities.Charset.UTF_8);
  return bytes.map(function (b) {
    const v = (b < 0) ? b + 256 : b;
    return ('0' + v.toString(16)).slice(-2);
  }).join('');
}

/** 32바이트(256bit) 랜덤 base64url 토큰 */
function generateSecureToken_() {
  const entropy = Utilities.getUuid() + ':' + Utilities.getUuid() + ':' + Date.now() + ':' + Math.random();
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, entropy, Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(digest).replace(/=+$/, '');
}

/** 타이밍 공격 방지용 상수시간 비교 */
function constantTimeEquals_(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const maxLen = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < maxLen; i++) {
    const ca = i < a.length ? a.charCodeAt(i) : 0;
    const cb = i < b.length ? b.charCodeAt(i) : 0;
    diff |= (ca ^ cb);
  }
  return diff === 0;
}

/** 로그 위생: 토큰·민감값 마스킹 + 300자 절단 (C10) */
function sanitizeErrorDetail_(msg) {
  let s = String(msg == null ? '' : msg);
  s = s.replace(/[A-Za-z0-9\-_]{28,}/g, '[REDACTED]');           // 토큰처럼 긴 문자열
  s = s.replace(/(auth_token|token|password|pwd|cookie|otp)\s*[:=]\s*\S+/gi, '$1=[REDACTED]');
  return s.length > 300 ? s.slice(0, 300) + '…' : s;
}

/* ------------------------------------------------------------------ *
 * 2. 락 — tryLock(1800) / 실패 시 ERR_BUSY
 * ------------------------------------------------------------------ */

/**
 * 쓰기 작업용 락. 성공 시 fn() 결과, 실패 시 ERR_BUSY.
 * 락 안에서는 시트 I/O만 — Drive 호출은 락 밖에서 (S2).
 */
function withWriteLock_(fn) {
  const lock = LockService.getScriptLock();
  const t0 = nowMs_();
  if (!lock.tryLock(LOCK_WAIT_MS_)) {
    throw createAppError_('ERR_BUSY',
      '다른 요청이 처리 중입니다. 잠시 후 다시 시도하세요.',
      { lock_wait_ms: LOCK_WAIT_MS_, retry_after_ms: 800 });
  }
  try {
    return fn(nowMs_() - t0);
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------ *
 * 3. 인증 · 스코프 · 레이트리밋
 * ------------------------------------------------------------------ */

function getSecretToken_() {
  // PropertiesService 단일 소스. 시트 평문 폴백 없음 (C1).
  return PropertiesService.getScriptProperties().getProperty('API_SECRET_TOKEN') || '';
}

/**
 * @param {Object} e        doGet/doPost 이벤트 (없으면 null)
 * @param {Object} body     POST JSON body (없으면 null)
 * @param {Object} options  { requireBrand, allowAllBrand }
 * @return {{clientId:string, brand:string, idempotencyKey:string, spec:Object}}
 */
function authenticateRequest_(e, body, options) {
  const opts = options || {};
  const action = body ? String(body.action || '') : String((e && e.parameter && e.parameter.action) || '');
  const spec = ACTION_WHITELIST[action];
  if (!spec) {
    throw createAppError_('ERR_UNKNOWN_ACTION', '허용되지 않은 액션입니다.', { action: action });
  }

  const expected = getSecretToken_();
  if (!expected) {
    throw createAppError_('ERR_SERVER_CONFIG', 'API_SECRET_TOKEN이 설정되지 않았습니다. Setup을 먼저 실행하세요.');
  }

  // 토큰은 body로만. GET 쿼리 토큰은 거부 (C3).
  if (e && e.parameter && e.parameter.auth_token) {
    throw createAppError_('ERR_GET_TOKEN_FORBIDDEN', '토큰은 URL이 아닌 요청 본문으로만 보내야 합니다.');
  }
  const provided = body && typeof body.auth_token === 'string' ? body.auth_token.trim() : '';
  if (!provided || !constantTimeEquals_(provided, expected)) {
    incrementAuthFailureCount_();
    throw createAppError_('ERR_UNAUTHORIZED', '유효하지 않은 인증 토큰입니다.');
  }

  const clientId = (body && body.client_id) ? String(body.client_id).trim() : 'unknown';
  enforceRateLimit_(clientId);

  const rawBrand = (body && body.brand)
    || (body && body.payload && body.payload.brand)
    || (e && e.parameter && e.parameter.brand) || '';
  const brand = validateBrand_(rawBrand, opts.allowAllBrand !== false, opts.requireBrand === true);

  return {
    action: action,
    spec: spec,
    clientId: clientId,
    brand: brand,
    idempotencyKey: (body && body.idempotency_key) ? String(body.idempotency_key).trim() : ''
  };
}

function validateBrand_(brand, allowAll, isRequired) {
  const b = String(brand || '').trim();
  if (!b) {
    if (isRequired) throw createAppError_('ERR_INVALID_BRAND', 'brand 파라미터가 필요합니다.');
    return '';
  }
  if (allowAll && b === 'ALL') return 'ALL';
  if (VALID_BRANDS_.indexOf(b) === -1) {
    throw createAppError_('ERR_INVALID_BRAND', '지원하지 않는 브랜드입니다: ' + b, { allowed: VALID_BRANDS_ });
  }
  return b;
}

function incrementAuthFailureCount_() {
  try {
    const p = PropertiesService.getScriptProperties();
    const cur = parseInt(p.getProperty('AUTH_FAIL_COUNT') || '0', 10);
    p.setProperty('AUTH_FAIL_COUNT', String(cur + 1));
    p.setProperty('LAST_AUTH_FAIL_AT', formatKstIso_(new Date()));
  } catch (err) { /* 카운트 실패가 응답을 깨지 않게 */ }
}

function enforceRateLimit_(clientId) {
  const cache = CacheService.getScriptCache();
  const bucket = Math.floor(nowMs_() / (RATE_LIMIT_WINDOW_SEC_ * 1000));
  const key = 'RL_' + clientId + '_' + bucket;
  const cur = Number(cache.get(key) || '0');
  if (cur >= RATE_LIMIT_MAX_REQ_) {
    throw createAppError_('ERR_RATE_LIMITED', '분당 요청 한도를 초과했습니다.',
      { retry_after_sec: RATE_LIMIT_WINDOW_SEC_ });
  }
  cache.put(key, String(cur + 1), RATE_LIMIT_WINDOW_SEC_ + 5);

  // 일일 호출량 (쿼터 80% 경보용)
  const todayKst = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMdd');
  const qKey = 'DAILY_CALLS_' + todayKst;
  const calls = Number(cache.get(qKey) || '0') + 1;
  cache.put(qKey, String(calls), 21600);
}

function getDailyCallCount_() {
  const todayKst = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMdd');
  return Number(CacheService.getScriptCache().get('DAILY_CALLS_' + todayKst) || '0');
}

/* ------------------------------------------------------------------ *
 * 4. 요청 크기 · 민감정보 가드
 * ------------------------------------------------------------------ */

function assertRequestSizeWithinLimit_(rawBody) {
  // 영상 조각 업로드만 더 큰 본문을 받는다. 액션 이름은 본문 앞부분에서 가볍게 확인하고(api.js 가 action 을 맨 앞에 쓴다),
  // 진짜 액션은 인증 단계에서 다시 확인된다 — 여기서 속여도 얻는 것은 '큰 본문을 파싱해 보는 것'뿐이다.
  const isUpload = String(rawBody || '').slice(0, 120).indexOf('"action":"upload_video_chunk"') !== -1;
  const limit = isUpload ? MAX_UPLOAD_REQUEST_BYTES_ : MAX_REQUEST_BYTES_;
  const bytes = Utilities.newBlob(rawBody || '').getBytes().length;
  if (bytes > limit) {
    throw createAppError_('ERR_PAYLOAD_TOO_LARGE',
      '요청 본문이 최대 허용 크기(' + (isUpload ? '3.4MB' : '512KB') + ')를 초과했습니다.',
      { byte_length: bytes, max_bytes: limit });
  }
  return bytes;
}

function assertPayloadSizeWithinLimit_(jsonString) {
  const bytes = Utilities.newBlob(jsonString || '').getBytes().length;
  if (bytes > MAX_PAYLOAD_BYTES_) {
    throw createAppError_('ERR_PAYLOAD_TOO_LARGE',
      'payload가 200KB를 초과했습니다. 본문을 분할하세요.',
      { byte_length: bytes, max_bytes: MAX_PAYLOAD_BYTES_ });
  }
  return bytes;
}

/** 재귀 키 검사 — 민감정보는 저장 진입점에서 원천 차단 */
function assertNoSensitiveFields_(obj, path) {
  if (!obj || typeof obj !== 'object') return;
  const cur = path || 'payload';
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) assertNoSensitiveFields_(obj[i], cur + '[' + i + ']');
    return;
  }
  const keys = Object.keys(obj);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (SENSITIVE_KEY_PATTERN_.test(k)) {
      throw createAppError_('ERR_SENSITIVE_FIELD',
        '보안 정책상 저장할 수 없는 필드입니다: ' + k,
        { field_path: cur + '.' + k });
    }
    assertNoSensitiveFields_(obj[k], cur + '.' + k);
  }
}

/* ------------------------------------------------------------------ *
 * 5. 쿼터 서킷브레이커 (5분 쓰기 차단)
 * ------------------------------------------------------------------ */

function isQuotaDegraded_() {
  const last = parseInt(
    PropertiesService.getScriptProperties().getProperty('LAST_QUOTA_ERROR_MS') || '0', 10);
  if (!last) return false;
  return (nowMs_() - last) < (5 * 60 * 1000);
}

function checkQuotaCircuit_(spec) {
  const degraded = isQuotaDegraded_();
  if (degraded && !spec.allowDegraded) {
    throw createAppError_('ERR_QUOTA_EXCEEDED',
      'GAS 쿼터 보호 서킷브레이커가 작동 중입니다(5분간 쓰기 제한, 읽기만 허용).',
      { retry_after_sec: 60 });
  }
  return degraded;
}

function recordQuotaFailure_(errMsg) {
  const p = PropertiesService.getScriptProperties();
  p.setProperty('LAST_QUOTA_ERROR_MS', String(nowMs_()));
  p.setProperty('LAST_QUOTA_ERROR_MSG', sanitizeErrorDetail_(errMsg));
}

/** GAS 쿼터/동시호출 예외 판별 */
function isQuotaError_(err) {
  const m = String((err && err.message) || '');
  return /too many simultaneous invocations|service invoked too many times|quota exceeded|exceeded maximum execution time|too many .*invocations/i.test(m);
}

/* ------------------------------------------------------------------ *
 * 6. 멱등성 — ①Cache 힌트 ②락 내 Channel_Logs 확정
 * ------------------------------------------------------------------ */

function getIdempotencyHint_(idemKey) {
  if (!idemKey) return null;
  const cached = CacheService.getScriptCache().get('IDEM_' + sha256Hex_(idemKey));
  if (!cached) return null;
  try {
    const parsed = JSON.parse(cached);
    parsed.meta = parsed.meta || {};
    parsed.meta.idempotent_replay = true;
    return parsed;
  } catch (err) { return null; }
}

function findConfirmedIdempotencyInSheet_(ss, idemKey) {
  if (!idemKey) return null;
  const sheet = ss.getSheetByName('Channel_Logs');
  if (!sheet) return null;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const start = Math.max(2, lastRow - 499);            // 최근 500행만 (예산 보호)
  const values = sheet.getRange(start, 1, lastRow - start + 1, 16).getValues();
  for (let i = values.length - 1; i >= 0; i--) {
    if (String(values[i][5]) === String(idemKey)) {
      return {
        log_id: values[i][0],
        content_id: values[i][2],
        result_status: values[i][9],
        response_digest: values[i][14],
        created_at: values[i][13]
      };
    }
  }
  return null;
}

/**
 * 감사 로그 + 멱등 응답 캐시 저장.
 * @param {Object} ss
 * @param {Object} entry { action, brand, contentId, channel, idempotencyKey, clientId,
 *                         resultStatus, errorCode, errorDetail, retryCount, responseData,
 *                         serverMs, lockWaitMs }
 */
function recordIdempotencyAndAudit_(ss, entry) {
  const e = entry || {};
  const sheet = ss.getSheetByName('Channel_Logs');
  if (!sheet) return;
  const now = new Date();
  const logId = 'LOG-' + Utilities.formatDate(now, 'Asia/Seoul', 'yyyyMMddHHmmss')
    + '-' + Math.floor(100 + Math.random() * 900);
  const digest = e.responseData ? sha256Hex_(JSON.stringify(e.responseData)).slice(0, 16) : '';

  sheet.appendRow([
    logId,
    e.brand || 'SYSTEM',
    e.contentId || '',
    e.channel || 'system',
    e.action || '',
    e.idempotencyKey || '',
    e.clientId || 'unknown',
    '',                                    // lease_token
    '',                                    // lease_expires_at
    e.resultStatus || 'OK',
    e.retryCount || 0,
    e.errorCode || '',
    e.errorDetail ? sanitizeErrorDetail_(e.errorDetail) : '',
    formatKstIso_(now),
    digest,
    e.serverMs || 0
  ]);

  // 성공 응답만 캐시(힌트). 100KB 제한 방어.
  if (e.idempotencyKey && e.resultStatus === 'OK' && e.responseData) {
    try {
      const wrapped = { ok: true, action: e.action, brand: e.brand || null, data: e.responseData };
      const s = JSON.stringify(wrapped);
      if (s.length < 95000) {
        CacheService.getScriptCache().put('IDEM_' + sha256Hex_(e.idempotencyKey), s, IDEM_CACHE_TTL_SEC_);
      }
    } catch (err) { /* 캐시 실패는 무시 */ }
  }
}

/* ------------------------------------------------------------------ *
 * 7. 토큰 회전
 * ------------------------------------------------------------------ */

function rotateToken_() {
  const props = PropertiesService.getScriptProperties();
  const newToken = generateSecureToken_();
  props.setProperty('API_SECRET_TOKEN_PREV_HASH', sha256Hex_(getSecretToken_()).slice(0, 12));
  props.setProperty('API_SECRET_TOKEN', newToken);
  props.setProperty('API_SECRET_TOKEN_ROTATED_AT', formatKstIso_(new Date()));
  return newToken;   // 응답 1회만 반환. 로그·시트 기록 금지.
}
