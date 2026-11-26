/**
 * js/productFallback.js — 상품 이미지를 못 받았을 때의 5단계 (2026-11-26)
 *
 * 무엇을 막나
 *  - 지금은 자동 수집이 실패하면 한 줄 오류만 남기고 끝났다. 사용자는 사진 없이 무엇을 할 수 있는지 몰랐고,
 *    실패한 링크는 사라져서 나중에 다시 시도할 방법이 없었다. 새로고침하면 적던 값도 날아갔다.
 *
 * 5단계 (뷔투 초안 Q-20261126-133128-yitv)
 *  ① 왜 안 됐는지 한 줄 — 코드(ERR_XXX)가 아니라 사람 말. 문장은 js/uiState.js 표를 먼저 본다.
 *  ② 대신 채우기 — 사진 직접 올리기 / 핵심 특징 3개 적기 / 다른 링크로 다시 해 보기
 *  ③ 입력한 내용만으로 기본 틀 만들기 — 사진이 없어도 대본·설명란은 나온다(렌더는 사진 5장부터)
 *  ④ 실패한 링크는 '다시 시도할 링크'에 담아 둔다 — 지우기 전까지 남는다
 *  ⑤ 적던 값·고른 트랙·올린 사진 이름은 자동 저장 — 새로고침해도 그대로
 *
 * 규칙
 *  - DOM 은 만들지 않는다(h 를 인자로 받는다). 브라우저 없이 시험할 수 있게.
 *  - 저장은 storage 인자(localStorage 모양)로만 만지고, 저장이 막혀도 화면은 산다(던지지 않는다).
 *  - 화면 문구는 쉬운 한국어 — '폴백·큐·payload' 같은 말을 쓰지 않는다.
 */

import { errorInfo } from './uiState.js?v=20261126a';

/* ────────────────────────── ① 실패 사유 한 줄 ────────────────────────── */

/** 상품 수집에서 자주 나는 실패 — 표에 있으면 이 문장을 먼저 쓴다(표에 없으면 uiState 가 만든다). */
export const PRODUCT_FAILURE_TEXT = {
  ERR_PRODUCT_BLOCKED: '이 쇼핑몰이 서버 수집을 막았어요 — 사진을 직접 올리거나 아래에 직접 적어 주세요.',
  ERR_PRODUCT_FETCH: '상품 페이지에서 상품 정보를 찾지 못했어요 — 링크를 확인하거나 직접 적어 주세요.',
  ERR_PRODUCT_DUPLICATE: '12시간 안에 이미 받은 상품이에요 — 아래 기존 카드를 이어서 쓰면 됩니다.',
  ERR_TIMEOUT: '쇼핑몰이 제때 답하지 않았어요 — 잠시 뒤 다시 누르거나 다른 링크로 해 보세요.',
  ERR_QUEUE_TYPE_UNKNOWN: '집 노트북이 이 주문을 아직 몰라요 — 노트북 쪽 설정을 새로 올린 뒤 다시 보내 주세요.',
  ERR_QUEUE_UNREACHABLE: '집 노트북에 닿지 못했어요 — 노트북이 켜져 있는지 확인해 주세요.',
  ERR_QUEUE_TIMEOUT: '집 노트북이 제때 답하지 않았어요 — 잠시 뒤 다시 보내 주세요.',
  ERR_IMAGE_UPLOAD: '사진을 올리지 못했어요 — 잠시 뒤 다시 눌러 주세요.'
};

/** 실패한 링크를 '다시 시도할 링크'에 담아도 되는가(입력 실수·중복은 담지 않는다). */
const QUEUEABLE_CODES = [
  'ERR_PRODUCT_BLOCKED', 'ERR_PRODUCT_FETCH', 'ERR_TIMEOUT', 'ERR_NETWORK', 'ERR_OFFLINE', 'ERR_BAD_RESPONSE',
  'ERR_QUEUE_UNREACHABLE', 'ERR_QUEUE_TIMEOUT', 'ERR_QUEUE_REJECTED', 'ERR_PRODUCT_NO_NAME'
];

function codeOf(err) {
  if (err == null) return '';
  if (typeof err === 'string') return String(err).trim().toUpperCase();
  return String(err.code || '').trim().toUpperCase();
}

function messageOf(err) {
  if (!err || typeof err !== 'object') return '';
  return String(err.message || '').trim();
}

/**
 * 실패 하나 → 화면이 쓸 한 줄과 다음에 할 수 있는 일.
 * @param {object|string|null} err ApiError·Error·코드 문자열
 * @returns {{code:string, title:string, reason:string, retryable:boolean, queueable:boolean, noName:boolean}}
 */
export function failureReason(err) {
  let code = codeOf(err);
  const message = messageOf(err);
  /* 코드 없이 '상품명을 찾지 못했습니다' 로 끝나는 경로(화면이 직접 던진다)도 같은 안내를 받게 한다. */
  const noName = !code && /상품명/.test(message);
  if (noName) code = 'ERR_PRODUCT_NO_NAME';
  const info = errorInfo({ code: code || 'ERR_UNKNOWN_PRODUCT', message: message });
  const reason = PRODUCT_FAILURE_TEXT[code] || (noName ? '상품 페이지에서 상품명을 찾지 못했어요 — 링크를 확인하거나 직접 적어 주세요.' : info.text);
  const queueable = noName || QUEUEABLE_CODES.indexOf(code) >= 0;
  return {
    code: code || '',
    title: info.title || '상품을 자동으로 못 읽었어요',
    reason: reason,
    retryable: queueable || info.retryable === true,
    queueable: queueable,
    noName: noName
  };
}

/* ────────────────────────── ② 핵심 특징 3칸 ────────────────────────── */

export const KEY_POINT_SLOTS = 3;

/** 입력한 특징을 3칸으로 — 모자란 칸은 빈 문자열(화면이 3칸을 늘 보여 준다). */
export function keyPointSlots(facts, count) {
  const n = Math.max(1, Number(count) || KEY_POINT_SLOTS);
  const list = (facts && Array.isArray(facts.key_points) ? facts.key_points : []).map((x) => String(x || '').trim()).filter(Boolean);
  const out = [];
  for (let i = 0; i < n; i++) out.push(list[i] || '');
  return out;
}

/**
 * 3칸에 적은 값을 특징 목록으로 — 앞 3개는 3칸이 정하고, 뒤에 남은 특징(4·5번째)은 잃지 않는다.
 * @param {string[]} existing 지금 저장된 특징
 * @param {string[]} slots    3칸에 적은 값
 * @returns {string[]} 빈 칸을 뺀 목록(최대 5개)
 */
export function mergeKeyPoints(existing, slots) {
  const out = [];
  const put = (v) => {
    const s = String(v == null ? '' : v).trim();
    if (s && out.indexOf(s) < 0 && out.length < 5) out.push(s);
  };
  (Array.isArray(slots) ? slots : []).slice(0, KEY_POINT_SLOTS).forEach(put);
  (Array.isArray(existing) ? existing : []).slice(KEY_POINT_SLOTS).forEach(put);
  return out;
}

/* ────────────────────────── ③ 입력값만으로 기본 틀 ────────────────────────── */

/**
 * 사진이 없어도 대본·설명란을 만들 수 있는가 — 상품명만 있으면 된다(값은 지어내지 않는다).
 * @returns {{ok:boolean, reason:string, images:number, note:string}}
 */
export function basicTemplateGate(facts) {
  const f = facts && typeof facts === 'object' ? facts : {};
  const name = String(f.name || '').trim();
  const images = (Array.isArray(f.images) ? f.images : []).filter(Boolean).length;
  if (!name) return { ok: false, reason: '상품명을 먼저 적어 주세요 — 한 줄만 있으면 기본 틀을 만들 수 있어요.', images: images, note: '' };
  return {
    ok: true,
    reason: '',
    images: images,
    note: '사진 없이 기본 틀로 만듭니다 — 사진은 나중에 올려도 됩니다. 영상 렌더는 사진 5장부터예요.'
  };
}

/* ────────────────────────── ⑤ 적던 값 자동 저장 ────────────────────────── */

export const DRAFT_KEY = 'contenthub.product.draft.v1';
export const DRAFT_VERSION = 1;
export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;   // 일주일 지난 입력은 버린다(엉뚱한 값이 되살아나지 않게)

function cleanFacts(raw) {
  const f = raw && typeof raw === 'object' ? raw : {};
  const numOrNull = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(String(v).replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) ? n : null;
  };
  const list = (v, max) => (Array.isArray(v) ? v : []).map((x) => String(x == null ? '' : x).trim()).filter(Boolean).slice(0, max);
  return {
    name: String(f.name || '').trim().slice(0, 120),
    category: String(f.category || '').trim().slice(0, 80),
    price: numOrNull(f.price),
    original_price: numOrNull(f.original_price),
    key_points: list(f.key_points, 5),
    images: list(f.images, 6)
  };
}

/**
 * 지금 화면 상태 → 저장할 초안.
 * @param {object} facts 상품 사실
 * @param {{url?:string, brand_track?:string, clip_track?:string, channels?:string[], uploaded?:string[], card_id?:string, at?:string}} opts
 */
export function draftOf(facts, opts) {
  const o = opts || {};
  return {
    v: DRAFT_VERSION,
    at: o.at || new Date().toISOString(),
    url: String(o.url || '').slice(0, 500),
    facts: cleanFacts(facts),
    brand_track: String(o.brand_track || 'A').toUpperCase() === 'B' ? 'B' : 'A',
    clip_track: String(o.clip_track || 'commerce').toLowerCase() === 'challenge' ? 'challenge' : 'commerce',
    channels: (Array.isArray(o.channels) ? o.channels : []).map(String).slice(0, 6),
    uploaded: (Array.isArray(o.uploaded) ? o.uploaded : []).map(String).filter(Boolean).slice(0, 25),
    card_id: String(o.card_id || '')
  };
}

/**
 * 저장된 값을 화면이 믿고 쓸 수 있는 모양으로 — 깨졌거나 오래됐으면 null.
 * @param {*} raw JSON.parse 결과
 * @param {number} [nowMs]
 */
export function normalizeDraft(raw, nowMs) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (Number(raw.v) !== DRAFT_VERSION) return null;
  const at = Date.parse(String(raw.at || ''));
  const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  if (!Number.isFinite(at) || now - at > DRAFT_TTL_MS) return null;
  return {
    at: new Date(at).toISOString(),
    age_ms: Math.max(0, now - at),
    url: String(raw.url || '').slice(0, 500),
    facts: cleanFacts(raw.facts),
    brand_track: String(raw.brand_track || 'A').toUpperCase() === 'B' ? 'B' : 'A',
    clip_track: String(raw.clip_track || 'commerce').toLowerCase() === 'challenge' ? 'challenge' : 'commerce',
    channels: (Array.isArray(raw.channels) ? raw.channels : []).map(String).slice(0, 6),
    uploaded: (Array.isArray(raw.uploaded) ? raw.uploaded : []).map(String).filter(Boolean).slice(0, 25),
    card_id: String(raw.card_id || '')
  };
}

/** 저장 — 실패해도 던지지 않는다. @returns {{ok:boolean, error:string}} */
export function saveDraft(storage, draft) {
  try {
    if (!storage) return { ok: false, error: '저장소가 없습니다' };
    storage.setItem(DRAFT_KEY, JSON.stringify(draft));
    return { ok: true, error: '' };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

/** 읽기 — 없거나 깨졌으면 null. */
export function loadDraft(storage, nowMs) {
  try {
    if (!storage) return null;
    return normalizeDraft(JSON.parse(storage.getItem(DRAFT_KEY) || 'null'), nowMs);
  } catch (e) { return null; }
}

export function clearDraft(storage) {
  try { if (storage) storage.removeItem(DRAFT_KEY); return true; } catch (e) { return false; }
}

/** '이전에 쓰던 입력을 불러왔어요 — 11월 26일 14:20 저장' (없으면 빈 문장) */
export function draftNotice(draft) {
  if (!draft || !draft.at) return '';
  const d = new Date(draft.at);
  if (isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return '이전에 쓰던 입력을 불러왔어요 — ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' + hh + ':' + mm + ' 저장.';
}

/* ────────────────────────── ④ 다시 시도할 링크 ────────────────────────── */

export const RETRY_KEY = 'contenthub.product.retry.v1';
export const RETRY_MAX = 10;

function retryId() {
  return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** 저장된 목록 → 화면이 쓰는 모양(깨진 줄은 버린다, 최근 것이 앞). */
export function normalizeRetryQueue(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  list.forEach((x) => {
    if (!x || typeof x !== 'object' || !x.url) return;
    out.push({
      id: String(x.id || retryId()),
      url: String(x.url).slice(0, 500),
      brand: String(x.brand || 'daejeon_youth'),
      brand_track: String(x.brand_track || 'A').toUpperCase() === 'B' ? 'B' : 'A',
      clip_track: String(x.clip_track || 'commerce').toLowerCase() === 'challenge' ? 'challenge' : 'commerce',
      reason: String(x.reason || '').slice(0, 160),
      at: String(x.at || new Date().toISOString()),
      attempts: Math.max(0, Math.floor(Number(x.attempts) || 0)),
      status: ['PENDING', 'DONE', 'FAILED'].indexOf(String(x.status || '').toUpperCase()) >= 0 ? String(x.status).toUpperCase() : 'PENDING'
    });
  });
  return out.slice(0, RETRY_MAX);
}

/**
 * 실패한 링크를 목록에 담는다 — 같은 (주소·브랜드)가 이미 있으면 새 줄을 만들지 않고 사유만 새로 적는다.
 * @returns {Array} 새 목록(원본은 건드리지 않는다)
 */
export function enqueueRetry(queue, item, opts) {
  const o = opts || {};
  const list = normalizeRetryQueue(queue);
  const url = String((item && item.url) || '').trim();
  if (!url) return list;
  const brand = String((item && item.brand) || 'daejeon_youth');
  const hit = list.filter((x) => x.url === url && x.brand === brand)[0];
  if (hit) {
    hit.reason = String((item && item.reason) || hit.reason || '').slice(0, 160);
    hit.status = 'PENDING';
    hit.attempts = Math.max(0, Number(hit.attempts) || 0);
    if (o.at) hit.at = String(o.at);
    return normalizeRetryQueue(list);
  }
  const next = normalizeRetryQueue([{
    id: retryId(),
    url: url,
    brand: brand,
    brand_track: (item && item.brand_track) || 'A',
    clip_track: (item && item.clip_track) || 'commerce',
    reason: (item && item.reason) || '',
    at: o.at || new Date().toISOString(),
    attempts: 0,
    status: 'PENDING'
  }].concat(list));
  return next.slice(0, RETRY_MAX);
}

export function dequeueRetry(queue, id) {
  return normalizeRetryQueue(queue).filter((x) => x.id !== id);
}

/** 한 줄의 상태 바꾸기(다시 시도함 · 됨 · 또 실패). */
export function markRetry(queue, id, patch) {
  const p = patch || {};
  return normalizeRetryQueue(queue).map((x) => {
    if (x.id !== id) return x;
    const next = Object.assign({}, x);
    if (p.status) next.status = String(p.status).toUpperCase();
    if (p.reason !== undefined) next.reason = String(p.reason || '').slice(0, 160);
    if (p.bump) next.attempts = (Number(x.attempts) || 0) + 1;
    if (p.at) next.at = String(p.at);
    return next;
  });
}

/** 목록 한 줄 요약 — 화면 머리말에 쓴다. */
export function retryQueueSummary(queue) {
  const list = normalizeRetryQueue(queue);
  const pending = list.filter((x) => x.status === 'PENDING').length;
  const done = list.filter((x) => x.status === 'DONE').length;
  const failed = list.filter((x) => x.status === 'FAILED').length;
  const text = !list.length ? '다시 시도할 링크가 없어요'
    : '다시 시도할 링크 ' + pending + '건' + (done ? ' · 끝난 것 ' + done + '건' : '') + (failed ? ' · 또 실패 ' + failed + '건' : '');
  return { total: list.length, pending: pending, done: done, failed: failed, text: text };
}

export function saveRetryQueue(storage, queue) {
  try {
    if (!storage) return { ok: false };
    storage.setItem(RETRY_KEY, JSON.stringify(normalizeRetryQueue(queue)));
    return { ok: true };
  } catch (e) { return { ok: false }; }
}

export function loadRetryQueue(storage) {
  try {
    if (!storage) return [];
    return normalizeRetryQueue(JSON.parse(storage.getItem(RETRY_KEY) || '[]'));
  } catch (e) { return []; }
}

/* ────────────────────────── 화면 조각 ────────────────────────── */

function button(h, text, onClick, cls) {
  return h('button', { class: cls || 'btn sm', type: 'button', text: text, onclick: onClick || (() => {}) });
}

function codeTitle(failure) {
  return failure && failure.code ? { title: '오류 코드: ' + failure.code } : {};
}

/**
 * ①②③ — 실패 안내 한 판.
 * handlers: { onUpload, onFeatures, onOtherLink, onBasic }
 */
export function fallbackPanel(h, failure, handlers) {
  const f = failure && failure.reason ? failure : failureReason(failure);
  const acts = handlers || {};
  const gate = basicTemplateGate(acts.facts || {});
  const kids = [
    h('h3', codeTitle(f), '상품을 자동으로 못 읽었어요'),
    h('p', { class: 'st-hint', text: f.reason })
  ];
  const row = h('div', { class: 'row' });
  if (acts.onUpload) row.appendChild(button(h, '📷 사진 직접 올리기', acts.onUpload, 'btn sm primary'));
  if (acts.onFeatures) row.appendChild(button(h, '✍️ 핵심 특징 3개 적기', acts.onFeatures));
  if (acts.onOtherLink) row.appendChild(button(h, '🔗 다른 링크로 다시 해 보기', acts.onOtherLink));
  if (row.children.length) kids.push(row);
  if (acts.onBasic) {
    const basicRow = h('div', { class: 'row' }, button(h, '입력한 내용으로 기본 틀 만들기', acts.onBasic, 'btn sm'));
    kids.push(basicRow);
  }
  if (!gate.ok && acts.onBasic) kids.push(h('p', { class: 'st-hint', text: gate.reason }));
  if (gate.ok && acts.onBasic) kids.push(h('p', { class: 'st-hint', text: gate.note }));
  kids.push(h('p', { class: 'hint', text: '적은 내용은 그대로 남아 있어요 — 새로고침해도 사라지지 않아요.' }));
  if (f.queueable) kids.push(h('p', { class: 'hint', text: '이 링크는 아래 [다시 시도할 링크]에 담아 뒀어요. 나중에 한 번에 다시 눌러요.' }));
  return h('div', { class: 'panel state-panel', role: 'alert' }, ...kids);
}

/**
 * ④ — 다시 시도할 링크 목록. handlers: { onRetry(item), onRemove(item), onRetryAll(), onClear() }
 */
export function retryQueuePanel(h, queue, handlers) {
  const list = normalizeRetryQueue(queue);
  if (!list.length) return null;
  const acts = handlers || {};
  const sum = retryQueueSummary(list);
  const box = h('div', { class: 'panel' }, h('h3', null, '다시 시도할 링크 (' + sum.pending + ')'));
  box.appendChild(h('p', { class: 'hint', text: sum.text }));
  list.forEach((item) => {
    const line = h('div', { class: 'gate-row' },
      h('span', { text: (item.status === 'DONE' ? '✅ ' : item.status === 'FAILED' ? '⚠️ ' : '') + shortUrl(item.url) }),
      h('span', { class: 'gv na', text: (item.reason || '이유 없음') + (item.attempts ? ' · ' + item.attempts + '번 다시 함' : '') }));
    const ops = h('div', { class: 'row' },
      button(h, '다시 시도', acts.onRetry ? () => acts.onRetry(item) : null),
      button(h, '빼기', acts.onRemove ? () => acts.onRemove(item) : null));
    line.appendChild(ops);
    box.appendChild(line);
  });
  const foot = h('div', { class: 'row' },
    button(h, '전체 다시 시도', acts.onRetryAll ? acts.onRetryAll : null, 'btn sm primary'),
    button(h, '목록 비우기', acts.onClear ? acts.onClear : null));
  box.appendChild(foot);
  return box;
}

/** 주소를 한 줄에 — 긴 경로는 뒤에서 자른다(같은 몰의 다른 상품을 구별할 만큼만). */
export function shortUrl(url) {
  const s = String(url || '').trim();
  if (!s) return '';
  const m = s.match(/^https?:\/\/([^\/]+)(\/.*)?$/i);
  if (!m) return s.slice(0, 48);
  const tail = String(m[2] || '');
  const cut = tail.length > 28 ? '…' + tail.slice(-28) : tail;
  return m[1].replace(/^www\./, '') + cut;
}
