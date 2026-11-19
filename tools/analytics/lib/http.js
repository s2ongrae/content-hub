'use strict';
/**
 * tools/analytics/lib/http.js — 외부 API 호출 공통부
 *
 * 규칙
 *  · 429 · 5xx · 네트워크 실패만 재시도한다(3회, 0.5s → 1.5s → 4s + 지터 없음: 시험 재현성).
 *  · 4xx 는 재시도하지 않는다(키 오류·권한 없음·수익화 전 403 등은 다시 불러도 같다).
 *  · 토큰·키는 URL 로그·에러 메시지에 남기지 않는다(값이 있으면 '[redacted]').
 *  · 네트워크 구현은 주입 가능하다(fetchImpl) — 시험은 가짜 함수로 호출 수를 센다.
 *
 * 모든 오류는 AnalyticsError(code, message, details) 로 통일한다.
 */

const RETRY_DELAYS = [500, 1500, 4000];
const DEFAULT_TIMEOUT_MS = 20000;

class AnalyticsError extends Error {
  constructor(code, message, details) {
    super(message || code);
    this.name = 'AnalyticsError';
    this.code = code || 'ERR_UNKNOWN';
    this.details = details || {};
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** URL·문자열에서 비밀값을 지운다(에러 메시지·로그용). */
function redact(text, secrets) {
  let out = String(text == null ? '' : text);
  (secrets || []).forEach((s) => {
    if (s && String(s).length > 3) out = out.split(String(s)).join('[redacted]');
  });
  return out;
}

/**
 * fetch 한 번 + 재시도.
 * @returns {{ok:boolean, status:number, body:any, calls:number}}
 */
async function fetchJson(url, opts = {}) {
  const fetchImpl = opts.fetchImpl || (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
  if (!fetchImpl) throw new AnalyticsError('ERR_NO_FETCH', '이 환경에는 fetch 가 없습니다. Node 18+ 로 실행하세요.');
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const retries = opts.retries == null ? RETRY_DELAYS.length : opts.retries;
  const secrets = opts.secrets || [];
  let calls = 0;
  let lastErr = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    let res;
    calls += 1;
    try {
      res = await withTimeout(fetchImpl, url, opts, timeoutMs);
    } catch (err) {
      lastErr = new AnalyticsError('ERR_NETWORK', redact((err && err.message) || '네트워크 실패', secrets), { url: redact(url, secrets) });
      if (attempt < retries) { await sleep(RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)]); continue; }
      lastErr.details.calls = calls;
      throw lastErr;
    }

    const parsed = await parseBody(res);
    if (res.status >= 200 && res.status < 300) {
      return { ok: true, status: res.status, body: parsed, calls };
    }

    const apiErr = apiErrorOf(parsed, res.status);
    lastErr = new AnalyticsError(
      apiErr.code || 'ERR_HTTP_' + res.status,
      redact(apiErr.message || ('HTTP ' + res.status), secrets),
      { status: res.status, reason: apiErr.reason, url: redact(url, secrets) }
    );

    if (res.status === 429 || res.status >= 500) {
      if (attempt < retries) { await sleep(RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)]); continue; }
    }
    lastErr.details.calls = calls;
    throw lastErr;
  }
  throw lastErr;
}

async function withTimeout(fetchImpl, url, opts, timeoutMs) {
  if (typeof AbortController !== 'function') return fetchImpl(url, opts);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetchImpl(url, Object.assign({}, opts, { signal: ctrl.signal }));
  } finally {
    clearTimeout(timer);
  }
}

/** 테스트용 주입 fetch 는 {status, body} 객체를 그대로 줄 수 있다.
 *  실제 fetch 의 Response 는 body 읽기가 비동기이므로 이 함수도 비동기다(await 필수) —
 *  동기로 두면 body 가 Promise 인 채로 흘러 .items 같은 필드가 사라진다.
 */
async function parseBody(res) {
  if (res == null) return null;
  if (Object.prototype.hasOwnProperty.call(res, 'body') && typeof res.json !== 'function') {
    const b = res.body;
    if (typeof b === 'string') { try { return JSON.parse(b); } catch (e) { return b; } }
    return b;
  }
  if (typeof res.json === 'function') {
    return res.json().catch(() => null);
  }
  if (typeof res.text === 'function') {
    return res.text().then((t) => { try { return JSON.parse(t); } catch (e) { return t; } });
  }
  return null;
}

/** 구글·메타 오류 본문을 {code, message, reason} 로 정리한다. */
function apiErrorOf(body, status) {
  const err = body && body.error;
  if (!err) return { code: 'ERR_HTTP_' + status, message: 'HTTP ' + status + ' 응답', reason: '' };
  if (typeof err === 'string') return { code: 'ERR_API', message: err, reason: '' };
  const first = (Array.isArray(err.errors) && err.errors[0]) || {};
  return {
    code: err.status ? 'ERR_' + String(err.status).toUpperCase().replace(/[^A-Z_]/g, '_') : 'ERR_API',
    message: err.message || first.message || ('HTTP ' + status),
    reason: first.reason || ''
  };
}

module.exports = { AnalyticsError, fetchJson, redact, RETRY_DELAYS };
