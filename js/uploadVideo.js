/**
 * js/uploadVideo.js — 영상·사진 올리기(구글 드라이브) 클라이언트 (2026-11-20 · 사진 2026-11-21)
 *
 * 브라우저 → GAS(gas/Upload.gs) 로 2MB 조각을 나눠 올린다. 조각은 드라이브의 비공개 폴더
 * ContentHubOS_Uploads/<content_id>/ 에 저장되고, 노트북이 렌더할 때 같은 API 로 받아 간다.
 *
 *  · 조각 하나는 같은 번호로 다시 보내도 결과가 같다(멱등) → 끊기면 그 조각만 최대 4번 다시 보낸다.
 *    api.js 의 재시도 규칙(429/5xx 3회)은 건드리지 않고, 여기서 네트워크·시간 초과만 따로 다시 시도한다.
 *  · 0번 조각을 보내면 서버가 같은 이름의 옛 조각을 모두 지운다(새 업로드의 시작).
 *  · 영상 바이트는 이 화면의 메모리에 2MB 씩만 올라온다(파일 전체를 읽지 않는다).
 *
 * 사진(2026-11-21, O2a):
 *  · jpg·jpeg·png·webp 를 받는다. 올리기 전에 브라우저에서 **장변 2048px · JPEG 0.85** 로 줄인다
 *    (EXIF 회전은 createImageBitmap 의 imageOrientation:'from-image' 로 바로 세운다 — 세로 사진이 눕지 않게).
 *  · 줄인 사진은 보통 400KB 라 2MB 조각 하나에 들어간다. 그래도 넘으면 기존 조각 경로가 알아서 나눈다.
 *  · 장당 10MB·카드 한 장에 25장까지(gas/Upload.gs 가 최종 확인). 미리보기는 **로컬 Blob/ObjectURL** 로만 한다
 *    — 드라이브는 비공개라 <img src> 에 넣으면 CSP(img-src 'self')와 인증 때문에 엑스박스가 된다.
 */

import { UPLOAD_PART_BYTES, checkUploadFile, checkVoiceFile } from './produceLogic.js?v=20261123e';

const CHUNK_TIMEOUT_MS = 120000;
const CHUNK_TRIES = 4;
const RETRY_WAIT_MS = [1500, 3000, 6000];

/* 사진 규격 — gas/Upload.gs 와 같은 값이어야 한다 */
export const PHOTO_MAX_COUNT = 25;
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const PHOTO_MAX_EDGE = 2048;      // 긴 변 기준
export const PHOTO_QUALITY = 0.85;       // JPEG 품질
export const PHOTO_EXT_RE = /\.(jpe?g|png|webp)$/i;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/** Uint8Array → base64 (큰 배열을 한 번에 펼치지 않는다). */
export function bytesToBase64(bytes) {
  let bin = '';
  const STEP = 0x8000;
  for (let i = 0; i < bytes.length; i += STEP) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + STEP));
  return btoa(bin);
}

/** 그 조각을 다시 보내 볼 만한 실패인가(네트워크·시간 초과·서버 바쁨). 인증·검증 오류는 다시 보내도 같다. */
export function isRetryableUploadError(err) {
  const c = err && err.code;
  return ['ERR_TIMEOUT', 'ERR_NETWORK', 'ERR_BAD_RESPONSE', 'ERR_BUSY', 'ERR_RATE_LIMITED', 'ERR_QUOTA_EXCEEDED'].indexOf(c) >= 0 || (err && err.status >= 500);
}

/**
 * 파일 하나 올리기.
 *  opts: { api, contentId, file, name?, onProgress?({index, parts, sent, total}), shouldCancel?() }
 * 반환: { name, parts, bytes }.  취소하면 code 'CANCELLED' 로 던진다. 이미 올라간 조각은 서버에 남는다(다음 올리기가 지운다).
 */
export async function uploadVideo(opts) {
  const { api, contentId, file } = opts;
  const chk = checkUploadFile({ name: opts.name || file.name, size: file.size });
  if (!chk.ok) { const e = new Error(chk.errors[0]); e.code = 'ERR_VALIDATION_FAILED'; throw e; }
  const parts = chk.parts;
  let sent = 0;
  for (let i = 0; i < parts; i++) {
    if (opts.shouldCancel && opts.shouldCancel()) { const e = new Error('올리기를 멈췄어요'); e.code = 'CANCELLED'; throw e; }
    const blob = file.slice(i * UPLOAD_PART_BYTES, Math.min(file.size, (i + 1) * UPLOAD_PART_BYTES));
    const data = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
    let lastErr = null;
    for (let t = 0; t < CHUNK_TRIES; t++) {
      try {
        await api.post('upload_video_chunk', { content_id: contentId, name: chk.name, index: i, parts, total_size: file.size, data }, null, { timeoutMs: CHUNK_TIMEOUT_MS });
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        if (!isRetryableUploadError(err) || t === CHUNK_TRIES - 1) break;
        await sleep(RETRY_WAIT_MS[t]);
        if (opts.shouldCancel && opts.shouldCancel()) { const e = new Error('올리기를 멈췄어요'); e.code = 'CANCELLED'; throw e; }
      }
    }
    if (lastErr) throw lastErr;
    sent += blob.size;
    if (opts.onProgress) opts.onProgress({ index: i + 1, parts, sent, total: file.size });
  }
  return { name: chk.name, parts, bytes: file.size };
}

/* ────────────────────────── 사진 ────────────────────────── */

/** 사진인가(확장자). MIME 이 비어 있는 폰 사진도 있다 — 이름으로 판단한다. */
export function isPhotoFile(name) {
  return PHOTO_EXT_RE.test(String(name || ''));
}

/**
 * 사진 파일 이름을 서버 규칙(영문·숫자·한글·공백·._-, 80자)에 맞게 다듬는다.
 *  · 순번을 붙여 같은 이름의 사진이 서로를 덮지 않게 한다: 사진01_외관.jpg
 *  · 확장자는 항상 .jpg (브라우저에서 JPEG 로 다시 굽기 때문).
 */
export function photoFileName(file, index) {
  const raw = String((file && file.name) || '사진');
  const base = raw.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9가-힣._ -]+/g, '_').replace(/^[^A-Za-z0-9가-힣]+/, '').trim() || '사진';
  const no = String((index || 0) + 1).padStart(2, '0');
  return ('사진' + no + '_' + base).slice(0, 74) + '.jpg';
}

/** 사진 파일 자체 검사 — 올리기 전에 화면에서 먼저 막는다(서버도 같은 상한을 본다). */
export function checkPhotoFile(file) {
  const errors = [];
  const name = String((file && file.name) || '');
  if (!file) errors.push('파일이 없습니다.');
  else {
    if (!isPhotoFile(name) && !/^image\//.test(String(file.type || ''))) errors.push('사진(jpg·jpeg·png·webp)만 올릴 수 있습니다: ' + name.slice(0, 40));
    if (Number(file.size) > PHOTO_MAX_BYTES) errors.push(name.slice(0, 40) + ' 이(가) 너무 큽니다(장당 10MB까지).');
    if (Number(file.size) <= 0) errors.push(name.slice(0, 40) + ' 이(가) 비어 있습니다.');
  }
  return { ok: errors.length === 0, errors };
}

/** 긴 변이 maxEdge 를 넘을 때만 줄인다(작은 사진을 억지로 늘리지 않는다). */
export function fitPhotoSize(width, height, maxEdge) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  const max = Number(maxEdge) > 0 ? Number(maxEdge) : PHOTO_MAX_EDGE;
  if (!w || !h) return { width: 0, height: 0, scaled: false };
  const longest = Math.max(w, h);
  if (longest <= max) return { width: Math.round(w), height: Math.round(h), scaled: false };
  const k = max / longest;
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)), scaled: true };
}

/**
 * 사진 → 올릴 Blob 준비(장변 2048px · JPEG 0.85).
 *  반환: { blob, name, width, height, bytes, scaled, previewUrl }
 *  · createImageBitmap 이 없거나 실패하면(옛 브라우저) 원본 파일을 그대로 쓴다 — 올리기는 계속된다.
 *  · previewUrl 은 이 화면에서만 쓰는 ObjectURL(blob:). 다 쓰면 revokeObjectURL 로 풀어 준다.
 */
export async function preparePhoto(file, opts) {
  const o = opts || {};
  const chk = checkPhotoFile(file);
  if (!chk.ok) { const e = new Error(chk.errors[0]); e.code = 'ERR_VALIDATION_FAILED'; throw e; }
  const name = o.name || photoFileName(file, o.index || 0);
  const fallback = () => ({ blob: file, name: name.replace(/\.[^.]+$/, '') + (/\.(jpe?g)$/i.test(file.name) ? '.jpg' : (PHOTO_EXT_RE.exec(file.name) || ['.jpg'])[0].toLowerCase()), width: 0, height: 0, bytes: file.size, scaled: false, previewUrl: null, resized: false });
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function' || typeof HTMLCanvasElement === 'undefined') return fallback();
  let bmp = null;
  try {
    // imageOrientation:'from-image' — 폰 사진의 EXIF 회전을 픽셀에 반영한다(눕는 문제 방지).
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (e) {
    try { bmp = await createImageBitmap(file); } catch (e2) { return fallback(); }
  }
  try {
    const size = fitPhotoSize(bmp.width, bmp.height, o.maxEdge || PHOTO_MAX_EDGE);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return fallback();
    ctx.drawImage(bmp, 0, 0, size.width, size.height);
    const blob = await new Promise((resolve) => {
      if (typeof canvas.toBlob !== 'function') return resolve(null);
      canvas.toBlob((b) => resolve(b), 'image/jpeg', Number(o.quality) || PHOTO_QUALITY);
    });
    if (!blob || blob.size <= 0) return fallback();
    return { blob, name, width: size.width, height: size.height, bytes: blob.size, scaled: size.scaled, previewUrl: null, resized: true };
  } catch (e) {
    return fallback();
  } finally {
    try { if (bmp && typeof bmp.close === 'function') bmp.close(); } catch (e) { /* 무시 */ }
  }
}

/**
 * 사진 하나 올리기 — preparePhoto 로 줄인 뒤 기존 조각 경로로 보낸다.
 *  opts: { api, contentId, file, index?, name?, onProgress?, shouldCancel?, prepared? }
 *  prepared 를 넘기면 다시 줄이지 않는다(같은 사진을 재시도할 때 두 번 굽지 않게).
 *  반환: { name, parts, bytes, width, height, scaled, resized }
 */
export async function uploadPhoto(opts) {
  const { api, contentId } = opts;
  const prepared = opts.prepared || await preparePhoto(opts.file, { index: opts.index || 0, name: opts.name });
  const blob = prepared.blob;
  const size = Number(blob.size) || 0;
  if (size <= 0) { const e = new Error('사진이 비어 있습니다.'); e.code = 'ERR_VALIDATION_FAILED'; throw e; }
  if (size > PHOTO_MAX_BYTES) { const e = new Error('사진이 너무 큽니다(10MB까지).'); e.code = 'ERR_VALIDATION_FAILED'; throw e; }
  const parts = Math.max(1, Math.ceil(size / UPLOAD_PART_BYTES));
  let sent = 0;
  for (let i = 0; i < parts; i++) {
    if (opts.shouldCancel && opts.shouldCancel()) { const e = new Error('올리기를 멈췄어요'); e.code = 'CANCELLED'; throw e; }
    const slice = blob.slice(i * UPLOAD_PART_BYTES, Math.min(size, (i + 1) * UPLOAD_PART_BYTES));
    const data = bytesToBase64(new Uint8Array(await slice.arrayBuffer()));
    let lastErr = null;
    for (let t = 0; t < CHUNK_TRIES; t++) {
      try {
        await api.post('upload_video_chunk', { content_id: contentId, name: prepared.name, index: i, parts, total_size: size, data }, null, { timeoutMs: CHUNK_TIMEOUT_MS });
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        if (!isRetryableUploadError(err) || t === CHUNK_TRIES - 1) break;
        await sleep(RETRY_WAIT_MS[t]);
        if (opts.shouldCancel && opts.shouldCancel()) { const e = new Error('올리기를 멈췄어요'); e.code = 'CANCELLED'; throw e; }
      }
    }
    if (lastErr) throw lastErr;
    sent += slice.size;
    if (opts.onProgress) opts.onProgress({ index: i + 1, parts, sent, total: size });
  }
  return { name: prepared.name, parts, bytes: size, width: prepared.width, height: prepared.height, scaled: prepared.scaled, resized: prepared.resized };
}

/* ────────────────────────── 내 육성 녹음(2026-11-23) ────────────────────────── */

/**
 * 녹음 파일 하나 올리기 — gas/Bgm.gs voice_put(2MB 조각). 이름은 **서버가 만든다**(<content_id>_voice.ext).
 * opts: { api, contentId, file, onProgress?({index, parts, sent, total}), shouldCancel?() }
 * 반환: { name, parts, bytes, ext }
 */
export async function uploadVoice(opts) {
  const { api, contentId, file } = opts;
  const chk = checkVoiceFile({ name: file && file.name, size: file && file.size }, contentId);
  if (!chk.ok) { const e = new Error(chk.errors[0]); e.code = 'ERR_VALIDATION_FAILED'; throw e; }
  const parts = chk.parts;
  let sent = 0;
  for (let i = 0; i < parts; i++) {
    if (opts.shouldCancel && opts.shouldCancel()) { const e = new Error('올리기를 멈췄어요'); e.code = 'CANCELLED'; throw e; }
    const blob = file.slice(i * UPLOAD_PART_BYTES, Math.min(file.size, (i + 1) * UPLOAD_PART_BYTES));
    const data = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
    let lastErr = null;
    for (let t = 0; t < CHUNK_TRIES; t++) {
      try {
        await api.post('voice_put', { content_id: contentId, ext: chk.ext, index: i, parts, total_size: file.size, data }, null, { timeoutMs: CHUNK_TIMEOUT_MS });
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        if (!isRetryableUploadError(err) || t === CHUNK_TRIES - 1) break;
        await sleep(RETRY_WAIT_MS[t]);
        if (opts.shouldCancel && opts.shouldCancel()) { const e = new Error('올리기를 멈췄어요'); e.code = 'CANCELLED'; throw e; }
      }
    }
    if (lastErr) throw lastErr;
    sent += blob.size;
    if (opts.onProgress) opts.onProgress({ index: i + 1, parts, sent, total: file.size });
  }
  return { name: chk.name, parts, bytes: file.size, ext: chk.ext };
}

/** 이 카드에 올라온 파일 목록 [{ name, kind:'photo'|'video'|'other', size, parts, parts_found, complete, mixed }] */
export async function listUploads(api, contentId) {
  const res = await api.post('upload_video_list', { content_id: contentId });
  return (res && res.data && Array.isArray(res.data.items)) ? res.data.items : [];
}

/** 올라온 파일 하나 지우기(휴지통). */
export async function deleteUpload(api, contentId, name) {
  const res = await api.post('upload_video_delete', { content_id: contentId, name });
  return (res && res.data) || {};
}
