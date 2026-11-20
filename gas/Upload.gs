/**
 * gas/Upload.gs — 영상 올리기(구글 드라이브 보관) · 노트북이 받아 가기 (2026-11-20)
 *
 *  허브 '제작' 탭 ① 재료에서 영상을 올리면 이 파일의 액션들이 구글 드라이브에 보관한다.
 *   · 브라우저 → GAS 는 요청 한 번에 크기 제한이 있어 영상을 2MB 조각으로 나눠 올린다.
 *   · 조각은 드라이브 폴더  ContentHubOS_Uploads / <content_id> /  에
 *       <파일이름>.part00003of00012   (번호는 0부터, 뒤 숫자는 전체 조각 수)
 *     로 저장된다. 비공개 폴더이고 링크 공유를 켜지 않는다.
 *   · 노트북(render.js)은 upload_video_list 로 크기·조각 수를 읽고, upload_video_fetch 로 조각을 하나씩 받아
 *     inbox/<content_id>/ 에 이어 붙인다. 접근은 허브 API 토큰 하나뿐이다(드라이브 링크 공유 없음).
 *
 *  액션 4개 (Auth.gs 화이트리스트와 Code.gs M1_HANDLERS 에 등록)
 *   · upload_video_chunk  조각 하나 저장(같은 번호를 다시 보내면 덮어씀 · 0번은 이전 업로드를 지움)
 *   · upload_video_list   올라온 파일 목록(이름·크기·조각 수·다 올라왔는지)
 *   · upload_video_fetch  조각 하나를 base64 로 돌려줌(노트북용)
 *   · upload_video_delete 파일 하나의 조각 전부 휴지통으로
 *
 *  하지 않는 것: 영상 내용을 읽거나 변환하지 않는다(조각은 불투명 바이트). 재생·미리보기 링크를 만들지 않는다.
 */

const UPLOAD_ROOT_NAME = 'ContentHubOS_Uploads';
const UPLOAD_PART_MAX_BYTES = 2 * 1024 * 1024;     // 조각 하나(원본 바이트) 상한 — 브라우저도 같은 값으로 자른다
const UPLOAD_MAX_PARTS = 800;                      // 800 × 2MB = 1.6GB
const UPLOAD_MAX_TOTAL_BYTES = 1500 * 1024 * 1024; // 파일 하나 1.5GB
const UPLOAD_CONTENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;   // 첫 글자는 영문·숫자(포털 큐·노트북과 같은 규칙)
const UPLOAD_NAME_RE = /^[A-Za-z0-9가-힣][A-Za-z0-9가-힣._ -]{0,79}$/;
const UPLOAD_EXT_RE = /\.(mp4|mov|m4v)$/i;
const UPLOAD_PART_RE = /^(.+)\.part(\d{5})of(\d{5})$/;

function uploadBad_(msg, details) { return createAppError_('ERR_VALIDATION_FAILED', msg, details); }

function uploadContentId_(payload) {
  const id = String((payload && payload.content_id) || '');
  if (!UPLOAD_CONTENT_ID_RE.test(id)) throw uploadBad_('content_id 는 영문·숫자·_·- 40자 이내여야 합니다.');
  return id;
}

function uploadName_(payload) {
  const n = String((payload && payload.name) || '');
  if (!UPLOAD_NAME_RE.test(n) || n.indexOf('..') !== -1 || !UPLOAD_EXT_RE.test(n)) {
    throw uploadBad_('파일 이름은 영문·숫자·한글·공백·._- 만, mp4·mov·m4v 확장자만 가능합니다(80자 이내).', { name: n.slice(0, 40) });
  }
  return n;
}

function uploadInt_(v, label, min, max) {
  const n = Number(v);
  if (!isFinite(n) || Math.floor(n) !== n || n < min || n > max) throw uploadBad_(label + ' 값이 올바르지 않습니다(' + min + '~' + max + ').');
  return n;
}

function uploadPad_(n) { return ('00000' + n).slice(-5); }
function uploadPartName_(name, index, parts) { return name + '.part' + uploadPad_(index) + 'of' + uploadPad_(parts); }

/** 업로드 보관 폴더(비공개). create=false 이면 없을 때 null. */
function uploadFolder_(contentId, create) {
  const props = PropertiesService.getScriptProperties();
  let root = null;
  const rootId = props.getProperty('UPLOAD_ROOT_FOLDER_ID');
  try { root = rootId ? DriveApp.getFolderById(rootId) : null; } catch (err) { root = null; }
  if (!root) {
    const it = DriveApp.getRootFolder().getFoldersByName(UPLOAD_ROOT_NAME);
    if (it.hasNext()) root = it.next();
    else if (create) root = DriveApp.getRootFolder().createFolder(UPLOAD_ROOT_NAME);
    else return null;
    props.setProperty('UPLOAD_ROOT_FOLDER_ID', root.getId());
    try { root.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); } catch (err) { /* 이미 비공개 */ }
  }
  const it2 = root.getFoldersByName(contentId);
  if (it2.hasNext()) return it2.next();
  if (!create) return null;
  const f = root.createFolder(contentId);
  try { f.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); } catch (err) { /* 이미 비공개 */ }
  return f;
}

/** 폴더 안의 조각 파일을 [{file, name, index, parts}] 로. 이름 규칙에 안 맞는 파일은 건드리지 않는다. */
function uploadParts_(folder) {
  const out = [];
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (fileTrashed_(f)) continue;   // 폴더 목록에 휴지통 파일이 섞여 나올 수 있다
    const m = String(f.getName() || '').match(UPLOAD_PART_RE);
    if (!m) continue;
    out.push({ file: f, name: m[1], index: Number(m[2]), parts: Number(m[3]) });
  }
  return out;
}

function fileTrashed_(f) { try { return typeof f.isTrashed === 'function' && f.isTrashed() === true; } catch (err) { return false; } }

function trashParts_(list) { list.forEach(function (p) { try { p.file.setTrashed(true); } catch (err) { /* 이미 지워짐 */ } }); }

function handleUploadVideoChunk_(ss, payload) {
  const contentId = uploadContentId_(payload);
  const name = uploadName_(payload);
  const parts = uploadInt_(payload.parts, 'parts', 1, UPLOAD_MAX_PARTS);
  const index = uploadInt_(payload.index, 'index', 0, parts - 1);
  if (payload.total_size !== undefined && payload.total_size !== null) {
    uploadInt_(payload.total_size, 'total_size', 1, UPLOAD_MAX_TOTAL_BYTES);
  }
  const b64 = String(payload.data || '');
  if (!b64 || !/^[A-Za-z0-9+\/=]+$/.test(b64)) throw uploadBad_('data 는 base64 문자열이어야 합니다.');
  const bytes = Utilities.base64Decode(b64);
  if (!bytes || !bytes.length) throw uploadBad_('빈 조각은 올릴 수 없습니다.');
  if (bytes.length > UPLOAD_PART_MAX_BYTES) throw uploadBad_('조각이 너무 큽니다(최대 ' + UPLOAD_PART_MAX_BYTES + '바이트).', { bytes: bytes.length });

  const folder = uploadFolder_(contentId, true);
  const mine = uploadParts_(folder).filter(function (p) { return p.name === name; });
  // 0번은 새 업로드의 시작 — 앞서 올린 같은 이름의 조각(조각 수가 달랐던 것 포함)을 모두 치운다.
  // 그 밖의 번호는 같은 번호의 옛 조각만 바꾼다(재시도해도 같은 결과).
  trashParts_(mine.filter(function (p) { return index === 0 || p.index === index || p.parts !== parts; }));
  const blob = Utilities.newBlob(bytes, 'application/octet-stream', uploadPartName_(name, index, parts));
  folder.createFile(blob);
  return { content_id: contentId, name: name, index: index, parts: parts, bytes: bytes.length };
}

function handleUploadVideoList_(ss, payload) {
  const contentId = uploadContentId_(payload);
  const folder = uploadFolder_(contentId, false);
  if (!folder) return { content_id: contentId, items: [] };
  const by = {};
  uploadParts_(folder).forEach(function (p) {
    const g = by[p.name] || (by[p.name] = { name: p.name, sets: {} });
    const s = g.sets[p.parts] || (g.sets[p.parts] = { parts: p.parts, seen: {}, size: 0 });
    if (!s.seen[p.index]) { s.seen[p.index] = true; s.size += Number(p.file.getSize()) || 0; }
  });
  const items = Object.keys(by).sort().map(function (n) {
    const g = by[n];
    const keys = Object.keys(g.sets);
    // 조각 수가 다른 묶음이 섞여 있으면(중간에 끊긴 옛 업로드) 완성된 묶음을 우선하고, 없으면 조각이 가장 많은 묶음
    let best = null;
    keys.forEach(function (k) {
      const s = g.sets[k];
      const found = Object.keys(s.seen).length;
      const done = found === s.parts;
      if (!best || (done && !best.done) || (done === best.done && found > best.found)) best = { s: s, found: found, done: done };
    });
    return {
      name: n,
      size: best.s.size,
      parts: best.s.parts,
      parts_found: best.found,
      complete: best.done && keys.length === 1,
      mixed: keys.length > 1
    };
  });
  return { content_id: contentId, items: items };
}

function handleUploadVideoFetch_(ss, payload) {
  const contentId = uploadContentId_(payload);
  const name = uploadName_(payload);
  const parts = uploadInt_(payload.parts, 'parts', 1, UPLOAD_MAX_PARTS);
  const index = uploadInt_(payload.index, 'index', 0, parts - 1);
  const folder = uploadFolder_(contentId, false);
  if (!folder) throw createAppError_('ERR_NOT_FOUND', '올라온 영상이 없습니다.', { content_id: contentId });
  const it = folder.getFilesByName(uploadPartName_(name, index, parts));
  let file = null;
  while (it.hasNext()) { const f = it.next(); if (!fileTrashed_(f)) { file = f; break; } }
  if (!file) throw createAppError_('ERR_NOT_FOUND', '조각을 찾지 못했습니다.', { name: name, index: index });
  const bytes = file.getBlob().getBytes();
  return { content_id: contentId, name: name, index: index, parts: parts, bytes: bytes.length, data: Utilities.base64Encode(bytes) };
}

/* ------------------------------------------------------------------ *
 * 자산(짧은 글) — 자막 초안·확정 자막·결과 보고 (2026-11-20)
 *  노트북이 만든 결과(자막 초안 SRT·렌더 보고)를 허브 화면이 읽고, 사람이 확정한 자막을 노트북이 읽어 간다.
 *  큐가 돌려주는 결과는 짧게 잘려 있어서(수백 자) 자막·검수표는 이 경로로 주고받는다.
 *  저장: 드라이브 ContentHubOS_Uploads/<content_id>/<kind>.txt (같은 이름은 덮어씀). 글만, 200KB 까지.
 * ------------------------------------------------------------------ */
const ASSET_KINDS = ['srt_draft', 'srt_final', 'report_clean', 'report_transcribe', 'report_finish'];
const ASSET_MAX_BYTES = 200000;

function assetKind_(payload) {
  const k = String((payload && payload.kind) || '');
  if (ASSET_KINDS.indexOf(k) === -1) throw uploadBad_('kind 는 ' + ASSET_KINDS.join(' · ') + ' 중 하나여야 합니다.', { kind: k.slice(0, 30) });
  return k;
}

function handleAssetPut_(ss, payload) {
  const contentId = uploadContentId_(payload);
  const kind = assetKind_(payload);
  const text = payload.text === undefined || payload.text === null ? '' : String(payload.text);
  const bytes = Utilities.newBlob(text).getBytes().length;
  if (bytes > ASSET_MAX_BYTES) throw createAppError_('ERR_PAYLOAD_TOO_LARGE', '글이 너무 깁니다(최대 ' + ASSET_MAX_BYTES + '바이트).', { bytes: bytes });
  const folder = uploadFolder_(contentId, true);
  const name = kind + '.txt';
  const old = folder.getFilesByName(name);
  while (old.hasNext()) { try { old.next().setTrashed(true); } catch (err) { /* 이미 지워짐 */ } }
  folder.createFile(name, text, 'text/plain');
  return { content_id: contentId, kind: kind, bytes: bytes };
}

function handleAssetGet_(ss, payload) {
  const contentId = uploadContentId_(payload);
  const kind = assetKind_(payload);
  const folder = uploadFolder_(contentId, false);
  if (!folder) return { content_id: contentId, kind: kind, exists: false };
  const it = folder.getFilesByName(kind + '.txt');
  let best = null;
  while (it.hasNext()) {
    const f = it.next();
    if (fileTrashed_(f)) continue;   // 덮어쓰며 휴지통에 넣은 옛 글을 읽지 않는다
    if (!best || f.getLastUpdated().getTime() > best.getLastUpdated().getTime()) best = f;
  }
  if (!best) return { content_id: contentId, kind: kind, exists: false };
  return { content_id: contentId, kind: kind, exists: true, text: best.getBlob().getDataAsString(), updated_at: formatKstIso_(best.getLastUpdated()) };
}

function handleUploadVideoDelete_(ss, payload) {
  const contentId = uploadContentId_(payload);
  const name = uploadName_(payload);
  const folder = uploadFolder_(contentId, false);
  if (!folder) return { content_id: contentId, name: name, removed: 0 };
  const mine = uploadParts_(folder).filter(function (p) { return p.name === name; });
  trashParts_(mine);
  return { content_id: contentId, name: name, removed: mine.length };
}
