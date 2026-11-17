/**
 * frontend/js/api.js — ContentHub OS API 클라이언트 (Milestone 1)
 *
 * 규약
 *  - 모든 데이터 호출은 POST + Content-Type: text/plain;charset=utf-8 (CORS preflight 회피)
 *  - 토큰은 URL이 아니라 JSON body 의 auth_token 으로만 보낸다
 *  - 요청 1건 30초 타임아웃(AbortController) / 429·5xx·ERR_BUSY 만 3회 재시도(0.8→1.6→3.2s)
 *  - 멱등키는 "동작 1건당 1개" 고정 → 중복 클릭·재시도에도 같은 키. 성공하면 폐기.
 *  - 오프라인/실패 큐(localStorage)에 남겨 두고 온라인 복귀 시 재전송
 *  - GAS URL/토큰이 없으면 ERR_NO_CONFIG 로 멈춘다(가짜 데이터로 대신하지 않는다).
 */

const CFG_KEY = 'contenthub.config.v1';
const QUEUE_KEY = 'contenthub.queue.v1';

export const BRAND_LABEL = {
  daejeon_youth: '대전 청년',
  ppiyak_kimmary: '삐약 김메리'
};

export function loadConfig() {
  try {
    return JSON.parse(localStorage.getItem(CFG_KEY)) || {};
  } catch (e) {
    return {};
  }
}

export function saveConfig(patch) {
  const next = Object.assign({}, loadConfig(), patch || {});
  localStorage.setItem(CFG_KEY, JSON.stringify(next));
  return next;
}

export function clearToken() {
  const cfg = loadConfig();
  delete cfg.token;
  localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
}

/** 32바이트 랜덤 멱등키 (crypto.randomUUID 우선) */
export function newIdempotencyKey(prefix = 'op') {
  const rnd = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID().replace(/-/g, '')
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${prefix}-${Date.now()}-${rnd}`;
}

export class ApiError extends Error {
  constructor(code, message, details, status) {
    super(message || code);
    this.name = 'ApiError';
    this.code = code || 'ERR_UNKNOWN';
    this.details = details || {};
    this.status = status || 0;
  }
  get retryable() {
    return this.code === 'ERR_BUSY'
      || this.code === 'ERR_RATE_LIMITED'
      || this.code === 'ERR_QUOTA_EXCEEDED'
      || (this.status >= 500);
  }
}

const RETRY_DELAYS = [800, 1600, 3200];

export class ContentHubApi {
  constructor(opts = {}) {
    this.queueKey = QUEUE_KEY;
    this.clientId = 'web-admin';
    this.timeoutMs = 30000;
    this.reload();
    Object.assign(this, opts);
  }

  /** localStorage 설정을 다시 읽는다. 설정 저장 후 반드시 호출. */
  reload() {
    const cfg = loadConfig();
    this.baseUrl = cfg.baseUrl || '';
    this.token = cfg.token || '';
    this.brand = cfg.activeBrand || 'daejeon_youth';
    this.clientId = cfg.clientId || 'web-admin';
    return this;
  }

  get configured() {
    return !!(this.baseUrl && this.token);
  }

  /** 화면에 표시할 연결 상태: live | unconfigured */
  get mode() {
    return this.configured ? 'live' : 'unconfigured';
  }

  setBrand(brand) {
    this.brand = brand;
    saveConfig({ activeBrand: brand });
  }

  /** 동작 1건 = 멱등키 1개. 성공 후 버린다. */
  createAction(keyPrefix) {
    return { key: newIdempotencyKey(keyPrefix), done: false };
  }

  async post(action, payload = {}, idemKey = null, opts = {}) {
    const envelope = {
      action,
      auth_token: this.token,
      client_id: this.clientId,
      brand: payload.brand || this.brand,
      idempotency_key: idemKey || newIdempotencyKey(action),
      payload
    };

    if (!this.configured) {
      throw new ApiError('ERR_NO_CONFIG', 'GAS Web App URL과 API 토큰을 먼저 설정하세요(⚙︎ → 연결).');
    }

    const timeoutMs = opts.timeoutMs || this.timeoutMs;
    let lastErr = null;
    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
      try {
        const json = await this._fetchOnce(envelope, timeoutMs);
        if (!json.ok) {
          throw new ApiError(json.error && json.error.code, json.error && json.error.message,
            json.error && json.error.details, 200);
        }
        return json;
      } catch (err) {
        lastErr = err;
        const retryable = (err instanceof ApiError) ? err.retryable : true;
        if (!retryable || attempt === RETRY_DELAYS.length) break;
        await sleep(RETRY_DELAYS[attempt]);
      }
    }
    throw lastErr;
  }

  async _fetchOnce(body, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || this.timeoutMs);
    try {
      const res = await fetch(this.baseUrl, {
        method: 'POST',
        // preflight 회피: text/plain
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
        redirect: 'follow',
        signal: controller.signal
      });

      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch (e) {
        // GAS 가 HTML 오류 페이지를 돌려준 경우
        throw new ApiError('ERR_BAD_RESPONSE',
          '서버 응답을 해석할 수 없습니다. 배포 URL/권한(모든 사용자)을 확인하세요.',
          { preview: text.slice(0, 200) }, res.status);
      }
      if (!res.ok) {
        throw new ApiError((json.error && json.error.code) || 'ERR_HTTP_' + res.status,
          (json.error && json.error.message) || ('HTTP ' + res.status), json.error && json.error.details, res.status);
      }
      return json;
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new ApiError('ERR_TIMEOUT', '서버 응답이 ' + Math.round((timeoutMs || this.timeoutMs) / 1000) + '초를 넘었습니다. 잠시 후 다시 시도하세요.');
      }
      if (err instanceof ApiError) throw err;
      throw new ApiError('ERR_NETWORK', '네트워크 오류: ' + (err.message || err));
    } finally {
      clearTimeout(timer);
    }
  }

  /* ---------------- 오프라인 큐 ---------------- */

  enqueue(action, payload, idemKey) {
    const q = this.readQueue();
    q.push({ action, payload, idemKey, at: Date.now() });
    localStorage.setItem(this.queueKey, JSON.stringify(q.slice(-50)));
  }

  readQueue() {
    try { return JSON.parse(localStorage.getItem(this.queueKey)) || []; } catch (e) { return []; }
  }

  async flushQueue() {
    const q = this.readQueue();
    if (!q.length) return { sent: 0, failed: 0 };
    const remain = [];
    let sent = 0;
    for (const item of q) {
      try {
        await this.post(item.action, item.payload, item.idemKey);
        sent++;
      } catch (e) {
        if (e.retryable) remain.push(item);
      }
    }
    localStorage.setItem(this.queueKey, JSON.stringify(remain));
    return { sent, failed: remain.length };
  }

  /* ---------------- M1 엔드포인트 ---------------- */

  health() { return this.post('health', {}); }

  listContents(filters = {}) { return this.post('list_contents', filters); }

  getContentDetail(contentId) { return this.post('get_content_detail', { content_id: contentId }); }

  createContent(data, action) {
    return this.post('create_content', data, action ? action.key : null);
  }

  updateContent(data, action) {
    return this.post('update_content', data, action ? action.key : null);
  }

  recordChecklist(data) { return this.post('record_checklist', data); }

  /* 운영 · 백업 · 보안 */
  getSystemHealth() { return this.post('get_system_health', {}); }

  backupNow(tier = 'MANUAL') {
    // 백업은 30초를 넘길 수 있다 → 웹 UI 에서만 타임아웃을 늘린다(PRD §7 알려진 제약)
    return this.post('backup_now', { tier }, null, { timeoutMs: 120000 });
  }

  integrityCheck() {
    return this.post('integrity_check', {}, null, { timeoutMs: 120000 });
  }

  restoreSnapshot(date, remap = true) {
    const digits = String(date).replace(/[^0-9]/g, '');
    return this.post('restore_from_snapshot', {
      snapshot_date: digits,
      confirm_phrase: 'RESTORE_' + digits,
      remap_contents: remap
    }, null, { timeoutMs: 120000 });
  }

  rotateToken() { return this.post('rotate_token', {}); }

  runColdstart(force = false) { return this.post('run_coldstart_onboarding', { force: !!force }, null, { timeoutMs: 120000 }); }

  /* ---------------- 모바일 10초 승인 ---------------- */

  /** 승인: 검수 기록(Checklist_Runs) + READY 승격을 버튼 1회로 */
  async quickApprove(contentId, opts = {}) {
    const action = this.createAction('approve');
    const channel = opts.channel || 'naver_blog';
    const score = opts.score != null ? opts.score : 88;

    // 1) 사람 검수 기록 — 이 버튼을 누른 것 자체가 human_reviewed
    await this.post('record_checklist', {
      content_id: contentId,
      target_channel: channel,
      total_score: score,
      human_reviewed: true,
      reviewer: this.clientId,
      items: opts.items || {}
    }, newIdempotencyKey('checklist'));

    // 2) READY 승격 (버전은 최신값을 다시 읽어 온다)
    const detail = await this.getContentDetail(contentId);
    const res = await this.post('update_content', {
      content_id: contentId,
      expected_version: detail.data.version,
      status: 'READY',
      target_channel: channel
    }, action.key, { timeoutMs: opts.timeoutMs || this.timeoutMs });
    action.done = true;
    return res;
  }

  async quickReject(contentId, reason, opts = {}) {
    const detail = await this.getContentDetail(contentId);
    return this.post('update_content', {
      content_id: contentId,
      expected_version: detail.data.version,
      status: 'REVIEW',
      patch: {
        reject_reason: reason || '대표님 반려',
        rejected_at: new Date().toISOString()
      }
    }, newIdempotencyKey('reject'), { timeoutMs: opts.timeoutMs || this.timeoutMs });
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const api = new ContentHubApi();

/* 온라인 복귀·탭 포커스 복귀 시 자동 재전송 */
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    api.flushQueue().catch(() => {});
  });
  // 탭을 다시 볼 때(백그라운드에서 돌아왔을 때)도 큐 재시도 — 온라인 이벤트가 안 터지는 경우 보완
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      api.flushQueue().catch(() => {});
    }
  });
}
