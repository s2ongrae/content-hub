/**
 * js/uploadVideo.js — 영상 올리기(구글 드라이브) 클라이언트 (2026-11-20)
 *
 * 브라우저 → GAS(gas/Upload.gs) 로 영상을 2MB 조각으로 나눠 올린다. 조각은 드라이브의 비공개 폴더
 * ContentHubOS_Uploads/<content_id>/ 에 저장되고, 노트북이 렌더할 때 같은 API 로 받아 간다.
 *
 *  · 조각 하나는 같은 번호로 다시 보내도 결과가 같다(멱등) → 끊기면 그 조각만 최대 4번 다시 보낸다.
 *    api.js 의 재시도 규칙(429/5xx 3회)은 건드리지 않고, 여기서 네트워크·시간 초과만 따로 다시 시도한다.
 *  · 0번 조각을 보내면 서버가 같은 이름의 옛 조각을 모두 지운다(새 업로드의 시작).
 *  · 영상 바이트는 이 화면의 메모리에 2MB 씩만 올라온다(파일 전체를 읽지 않는다).
 */

import { UPLOAD_PART_BYTES, checkUploadFile } from './produceLogic.js?v=20261120e';

const CHUNK_TIMEOUT_MS = 120000;
const CHUNK_TRIES = 4;
const RETRY_WAIT_MS = [1500, 3000, 6000];

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

/** 이 카드에 올라온 영상 목록 [{ name, size, parts, parts_found, complete, mixed }] */
export async function listUploads(api, contentId) {
  const res = await api.post('upload_video_list', { content_id: contentId });
  return (res && res.data && Array.isArray(res.data.items)) ? res.data.items : [];
}

/** 올라온 영상 하나 지우기(휴지통). */
export async function deleteUpload(api, contentId, name) {
  const res = await api.post('upload_video_delete', { content_id: contentId, name });
  return (res && res.data) || {};
}
