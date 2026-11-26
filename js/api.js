/**
 * frontend/js/api.js — ContentHub OS API 클라이언트 (Milestone 1)
 *
 * 규약
 *  - 모든 데이터 호출은 POST + Content-Type: text/plain;charset=utf-8 (CORS preflight 회피)
 *  - 토큰은 URL이 아니라 JSON body 의 auth_token 으로만 보낸다
 *  - 요청 1건 30초 타임아웃(AbortController) / 429·5xx·ERR_BUSY 만 3회 재시도(0.8→1.6→3.2s)
 *  - 서버가 details.retry_after_ms 를 주면 그만큼 기다린다(최대 8초) — 락·쿼터가 알려 준 간격을 무시하지 않는다
 *  - 오프라인이면 fetch 를 보내기 전에 ERR_OFFLINE 으로 멈춘다(30초를 기다리지 않는다)
 *  - 멱등키는 "동작 1건당 1개" 고정 → 중복 클릭·재시도에도 같은 키. 성공하면 폐기.
 *  - GAS URL/토큰이 없으면 ERR_NO_CONFIG 로 멈춘다(가짜 데이터로 대신하지 않는다).
 */

const CFG_KEY = 'contenthub.config.v1';

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
        await sleep(retryDelayMs(err, attempt));
      }
    }
    throw lastErr;
  }

  /** 렌더 등 노트북 오더의 진행 상태(읽기 전용). GAS 의 hub_order_status — 최근 큐 20건 안에서 그 id 한 건. */
  async hubOrderStatus(orderId) {
    const res = await this.post('hub_order_status', { order_id: String(orderId || '') });
    return (res && res.data) || {};
  }

  async _fetchOnce(body, timeoutMs) {
    // 오프라인은 보내 봐야 30초를 기다린다 — 바로 알린다(재시도 가치는 있다: 연결이 돌아오면 성공한다).
    if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) {
      throw new ApiError('ERR_OFFLINE', '지금은 오프라인이에요. 인터넷이 붙으면 다시 시도해 주세요.');
    }
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

  /* 성과(Metrics) — 발행 뒤 채널별 숫자를 시계열로 쌓는다 */
  listMetrics(filters = {}) { return this.post('list_metrics', filters); }

  // 내 블로그(#/blog) — gas/Blog.gs. 가져오기·순위 확인은 네이버를 부르므로 넉넉히 기다린다.
  listBlogStats(filters = {}) { return this.post('list_blog_stats', filters); }
  blogSync(data = {}) { return this.post('blog_sync', data, null, { timeoutMs: 90000 }); }
  blogPostBody(data) { return this.post('blog_post_body', data, null, { timeoutMs: 45000 }); }
  blogRankCheck(data) { return this.post('blog_rank_check', data, null, { timeoutMs: 90000 }); }

  /* 네이버 데이터랩 (gas/Insight.gs) — 검색어 트렌드·쇼핑 인사이트. 서버가 자체 일·월 천장을 지킨다. */
  insightTrend(data) { return this.post('insight_trend', data, null, { timeoutMs: 60000 }); }
  insightShopping(data) { return this.post('insight_shopping', data, null, { timeoutMs: 60000 }); }
  insightBudget() { return this.post('insight_budget', {}); }

  /* 오늘의 블로그 제목 10 (gas/BlogSeo.gs) — 처음 부를 때만 데이터랩·검색을 부르고, 같은 날은 저장된 줄을 준다. */
  blogSeoTitles(data = {}) { return this.post('blog_seo_titles', data, null, { timeoutMs: 120000 }); }

  recordMetrics(data, action) {
    return this.post('record_metrics', data, action ? action.key : null);
  }

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

  /* ---------------- 인스타 피드 카드뉴스 초안 (gas/IgCardDraft.gs) ---------------- */

  /** 야간 초안을 지금 한 번 돌려 본다(사람이 화면에서 부를 때만). 한 번에 최대 3장. */
  igCardDraftRun(data = {}) {
    return this.post('ig_card_draft_run', data, null, { timeoutMs: 180000 });
  }

  /** 초안 승인(human_approved) / 반려(queued) — 서버가 '초안이 준비된 카드'만 받는다. */
  igCardReview(contentId, decision, opts = {}) {
    return this.post('ig_card_review', {
      content_id: String(contentId || ''),
      decision: decision,
      reason: opts.reason || ''
    }, newIdempotencyKey('igreview'));
  }

  igCardApprove(contentId) {
    return this.igCardReview(contentId, 'approve');
  }

  igCardReject(contentId, reason) {
    return this.igCardReview(contentId, 'reject', { reason: reason });
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 재시도 간격 — 서버가 알려 준 retry_after_ms 를 먼저 존중하고, 없으면 0.8→1.6→3.2초. */
function retryDelayMs(err, attempt) {
  const asked = Number(err && err.details && err.details.retry_after_ms);
  if (Number.isFinite(asked) && asked > 0) return Math.min(asked, 8000);
  return RETRY_DELAYS[attempt];
}

export const api = new ContentHubApi();
