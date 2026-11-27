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
 *  액션 4개 (Auth.gs 화이트리스트와 Code.gs M1_HANDLERS 에 등록) + 글꼴 4개(font_put·font_list·font_fetch·font_delete)
 *   · upload_video_chunk  조각 하나 저장(같은 번호를 다시 보내면 덮어씀 · 0번은 이전 업로드를 지움)
 *   · upload_video_list   올라온 파일 목록(이름·크기·조각 수·다 올라왔는지 · kind: photo|video)
 *   · upload_video_fetch  조각 하나를 base64 로 돌려줌(노트북용)
 *   · upload_video_delete 파일 하나의 조각 전부 휴지통으로
 *
 *  사진(2026-11-21, O2a): 같은 조각 경로로 jpg·jpeg·png·webp 도 받는다.
 *   · 브라우저가 올리기 전에 장변 2048px·JPEG 0.85 로 줄여(보통 400KB) 조각 1개로 올린다(js/uploadVideo.js).
 *   · 장당 10MB·카드 한 장에 사진 25장까지(영상 8개 상한과 별개 — 60초 영상 15장·블로그 22장을 채우려면 8로는 모자란다).
 *   · 워커는 같은 목록·같은 fetch 로 사진 조각을 받아 inbox/<content_id>/ 에 그대로 붙인다(형식은 확장자로 안다).
 *
 *  글꼴(2026-11-27, P0): ContentHubOS_Fonts/ 에 커스텀 폰트를 같은 조각 방식으로 받는다.
 *   · 재배포 가능한 라이선스(OFL·Apache·MIT·CC0·CC BY·퍼블릭 도메인)만 — 상용·개인용 라이선스는 받지 않는다.
 *   · 파일 앞 4바이트 서명으로 폰트 파일인지 확인한다. 자세한 액션은 아래 '글꼴(폰트) 보관함' 절.
 *
 *  하지 않는 것: 영상·사진·폰트 내용을 읽거나 변환하지 않는다(조각은 불투명 바이트). 재생·미리보기 링크를 만들지 않는다.
 */

const UPLOAD_ROOT_NAME = 'ContentHubOS_Uploads';
const UPLOAD_PART_MAX_BYTES = 2 * 1024 * 1024;     // 조각 하나(원본 바이트) 상한 — 브라우저도 같은 값으로 자른다
const UPLOAD_MAX_PARTS = 800;                      // 800 × 2MB = 1.6GB
const UPLOAD_MAX_TOTAL_BYTES = 1500 * 1024 * 1024; // 파일 하나 1.5GB
const UPLOAD_CONTENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;   // 첫 글자는 영문·숫자(포털 큐·노트북과 같은 규칙)
const UPLOAD_NAME_RE = /^[A-Za-z0-9가-힣][A-Za-z0-9가-힣._ -]{0,79}$/;
const UPLOAD_VIDEO_EXT_RE = /\.(mp4|mov|m4v)$/i;
const UPLOAD_IMAGE_EXT_RE = /\.(jpe?g|png|webp)$/i;
const UPLOAD_EXT_RE = /\.(mp4|mov|m4v|jpe?g|png|webp)$/i;
const UPLOAD_IMAGE_MAX_BYTES = 10 * 1024 * 1024;   // 사진 한 장 10MB (브라우저는 보통 400KB 로 줄여 올린다)
const UPLOAD_IMAGE_MAX_COUNT = 25;                 // 카드 한 장에 사진 25장까지(영상 8개와 별개)
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
    throw uploadBad_('파일 이름은 영문·숫자·한글·공백·._- 만, mp4·mov·m4v·jpg·jpeg·png·webp 확장자만 가능합니다(80자 이내).', { name: n.slice(0, 40) });
  }
  return n;
}

/** 확장자로 사진·영상을 가른다. 목록 응답의 kind 로 화면·워커가 구분한다. */
function uploadKind_(name) {
  return UPLOAD_IMAGE_EXT_RE.test(String(name || '')) ? 'photo' : (UPLOAD_VIDEO_EXT_RE.test(String(name || '')) ? 'video' : 'other');
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
  const kind = uploadKind_(name);
  if (payload.total_size !== undefined && payload.total_size !== null) {
    if (kind === 'photo') uploadInt_(payload.total_size, 'total_size', 1, UPLOAD_IMAGE_MAX_BYTES);
    else uploadInt_(payload.total_size, 'total_size', 1, UPLOAD_MAX_TOTAL_BYTES);
  }
  const b64 = String(payload.data || '');
  if (!b64 || !/^[A-Za-z0-9+\/=]+$/.test(b64)) throw uploadBad_('data 는 base64 문자열이어야 합니다.');
  const bytes = Utilities.base64Decode(b64);
  if (!bytes || !bytes.length) throw uploadBad_('빈 조각은 올릴 수 없습니다.');
  if (bytes.length > UPLOAD_PART_MAX_BYTES) throw uploadBad_('조각이 너무 큽니다(최대 ' + UPLOAD_PART_MAX_BYTES + '바이트).', { bytes: bytes.length });

  const folder = uploadFolder_(contentId, true);
  const mine = uploadParts_(folder).filter(function (p) { return p.name === name; });
  // 사진 상한 — 새 사진(index 0 이고 아직 없는 이름)만 센다. 다시 보낸 조각·영상은 세지 않는다.
  if (kind === 'photo' && index === 0 && !mine.length) {
    const names = {};
    uploadParts_(folder).forEach(function (p) { if (uploadKind_(p.name) === 'photo') names[p.name] = true; });
    if (Object.keys(names).length >= UPLOAD_IMAGE_MAX_COUNT) {
      throw uploadBad_('사진은 한 카드에 ' + UPLOAD_IMAGE_MAX_COUNT + '장까지입니다. 필요 없는 사진을 지우고 올려 주세요.',
        { photos: Object.keys(names).length, max: UPLOAD_IMAGE_MAX_COUNT });
    }
  }
  // 0번은 새 업로드의 시작 — 앞서 올린 같은 이름의 조각(조각 수가 달랐던 것 포함)을 모두 치운다.
  // 그 밖의 번호는 같은 번호의 옛 조각만 바꾼다(재시도해도 같은 결과).
  trashParts_(mine.filter(function (p) { return index === 0 || p.index === index || p.parts !== parts; }));
  const blob = Utilities.newBlob(bytes, 'application/octet-stream', uploadPartName_(name, index, parts));
  folder.createFile(blob);
  return { content_id: contentId, name: name, kind: kind, index: index, parts: parts, bytes: bytes.length };
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
      kind: uploadKind_(n),
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

/* ------------------------------------------------------------------ *
 * 글꼴(폰트) 보관함 — 커스텀 폰트 업로드 (2026-11-27, P0 · 레이 님 결정)
 *
 *  결정: 재배포 가능한 라이선스(OFL 등)만 받는다. 받은 폰트 파일을 이 보관함에 두는 것 자체가
 *        '재배포'라서 상용 데스크톱·개인용 무료 라이선스 폰트는 올릴 수 없다(글자로 영상에 찍히는 것과 다르다).
 *
 *  저장: 드라이브 ContentHubOS_Fonts/ (비공개) — 영상·사진과 달리 카드에 묶지 않는다(모든 카드가 같이 쓴다).
 *        조각 이름 규칙은 영상과 같다(<이름>.part00000of00003). 목록·라이선스는 _fonts.json 한 파일에 모은다.
 *        같은 이름으로 다시 올리면(index 0) 옛 조각을 지우고 새로 시작한다.
 *
 *  액션 4개 (Auth.gs 화이트리스트·Code.gs M1_HANDLERS 에 등록)
 *   · font_put     조각 하나 저장(라이선스는 index 0 에서 한 번 확인) — 비허용 라이선스는 받지 않는다
 *   · font_list    보관함 목록(이름·라이선스·크기·조각 수·완성 여부)
 *   · font_fetch   조각 하나를 base64 로(화면 미리보기·노트북 렌더용)
 *   · font_delete  파일 하나의 조각 전부와 목록 항목을 지운다
 *
 *  하지 않는 것: 폰트 내용을 해석하지 않는다. 첫 4바이트 서명만 보고 폰트 파일인지 확인한다(엉뚱한 파일 차단).
 * ------------------------------------------------------------------ */
const FONT_ROOT_NAME = 'ContentHubOS_Fonts';
const FONT_INDEX_NAME = '_fonts.json';
const FONT_EXT_RE = /\.(ttf|otf|woff2)$/i;
const FONT_NAME_RE = /^[A-Za-z0-9가-힣][A-Za-z0-9가-힣._ -]{0,59}$/;
const FONT_MAX_BYTES = 20 * 1024 * 1024;   // 폰트 한 벌 20MB — 한글 전체 ttf 도 들어간다(js/designModel.js 와 같은 값)
const FONT_MAX_COUNT = 40;                 // 보관함 40종까지
// 재배포 가능 라이선스(허용) — js/designModel.js FONT_LICENSES 와 같은 값이어야 한다.
const FONT_LICENSES_OK = ['OFL-1.1', 'Apache-2.0', 'MIT', 'CC0-1.0', 'CC-BY-4.0', 'PD'];
// 받지 않는 라이선스 — 화면이 이유를 보여 준다.
const FONT_LICENSES_BLOCKED = ['commercial-desktop', 'free-personal', 'unknown'];

function fontBad_(msg, details) { return createAppError_('ERR_VALIDATION_FAILED', msg, details); }

function fontName_(payload) {
  const n = String((payload && payload.name) || '');
  if (n.indexOf('..') !== -1 || n.charAt(0) === '.' || !FONT_NAME_RE.test(n) || !FONT_EXT_RE.test(n)) {
    throw fontBad_('폰트 이름은 영문·숫자·한글·공백·._- 만, ttf·otf·woff2 확장자만 가능합니다(60자 이내).', { name: n.slice(0, 40) });
  }
  return n;
}

/** 라이선스 값 확인 — 허용 목록 밖이면 받지 않는다(이유를 그대로 알린다). */
function fontLicense_(raw) {
  const v = String(raw == null ? '' : raw).trim();
  if (!v) throw fontBad_('폰트 라이선스를 골라 주세요. 재배포 가능한 라이선스만 받습니다(' + FONT_LICENSES_OK.join(' · ') + ').', { licenses: FONT_LICENSES_OK });
  if (FONT_LICENSES_OK.indexOf(v) === -1) {
    const blocked = FONT_LICENSES_BLOCKED.indexOf(v) !== -1;
    throw fontBad_(blocked
      ? '이 라이선스 폰트는 보관함에 둘 수 없습니다 — 영상에 글자로 찍히는 것만 허용됩니다. 재배포 가능한 라이선스(OFL 등)만 올려 주세요.'
      : '모르는 라이선스입니다. 재배포 가능한 라이선스만 받습니다(' + FONT_LICENSES_OK.join(' · ') + ').', { license: v.slice(0, 40) });
  }
  return v;
}

/** 첫 4바이트로 폰트 파일인지 본다(확장자만 바꾼 엉뚱한 파일 차단). */
function fontSignatureOk_(bytes) {
  if (!bytes || bytes.length < 4) return false;
  const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (tag === 'wOF2' || tag === 'wOFF' || tag === 'OTTO' || tag === 'true' || tag === 'ttcf') return true;
  return bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0;   // TrueType 1.0
}

/** 폰트 보관함 폴더(비공개). create=false 이면 없을 때 null. */
function fontFolder_(create) {
  const props = PropertiesService.getScriptProperties();
  let root = null;
  const rootId = props.getProperty('FONT_ROOT_FOLDER_ID');
  try { root = rootId ? DriveApp.getFolderById(rootId) : null; } catch (err) { root = null; }
  if (!root) {
    const it = DriveApp.getRootFolder().getFoldersByName(FONT_ROOT_NAME);
    if (it.hasNext()) root = it.next();
    else if (create) root = DriveApp.getRootFolder().createFolder(FONT_ROOT_NAME);
    else return null;
    props.setProperty('FONT_ROOT_FOLDER_ID', root.getId());
    try { root.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); } catch (err) { /* 이미 비공개 */ }
  }
  return root;
}

/** _fonts.json 읽기 — 깨졌으면 빈 목록(올리기는 계속된다). */
function fontIndexRead_(folder) {
  if (!folder) return { v: 1, fonts: [] };
  const it = folder.getFilesByName(FONT_INDEX_NAME);
  let best = null;
  while (it.hasNext()) {
    const f = it.next();
    if (fileTrashed_(f)) continue;
    if (!best || f.getLastUpdated().getTime() > best.getLastUpdated().getTime()) best = f;
  }
  if (!best) return { v: 1, fonts: [] };
  try {
    const d = JSON.parse(best.getBlob().getDataAsString());
    if (!d || !Array.isArray(d.fonts)) return { v: 1, fonts: [] };
    return { v: 1, fonts: d.fonts };
  } catch (err) {
    return { v: 1, fonts: [] };
  }
}

/** _fonts.json 쓰기 — 옛 파일은 휴지통으로(같은 이름이 여러 개면 마지막 것만 산다). */
function fontIndexWrite_(folder, index) {
  const old = folder.getFilesByName(FONT_INDEX_NAME);
  while (old.hasNext()) { try { old.next().setTrashed(true); } catch (err) { /* 이미 지워짐 */ } }
  folder.createFile(FONT_INDEX_NAME, JSON.stringify({ v: 1, fonts: index.fonts }), 'application/json');
}

function fontEntryOf_(index, name) {
  const list = (index && index.fonts) || [];
  for (let i = 0; i < list.length; i++) if (list[i] && list[i].name === name) return list[i];
  return null;
}

/** 이름에서 화면에 보일 짧은 이름 — 확장자를 떼고 32자까지. */
function fontLabel_(name) {
  return String(name || '').replace(FONT_EXT_RE, '').slice(0, 32) || '내 폰트';
}

function handleFontPut_(ss, payload) {
  const name = fontName_(payload);
  const parts = uploadInt_(payload.parts, 'parts', 1, UPLOAD_MAX_PARTS);
  const index = uploadInt_(payload.index, 'index', 0, parts - 1);
  if (payload.total_size !== undefined && payload.total_size !== null) {
    uploadInt_(payload.total_size, 'total_size', 1, FONT_MAX_BYTES);
  }
  const b64 = String(payload.data || '');
  if (!b64 || !/^[A-Za-z0-9+\/=]+$/.test(b64)) throw fontBad_('data 는 base64 문자열이어야 합니다.');
  const bytes = Utilities.base64Decode(b64);
  if (!bytes || !bytes.length) throw fontBad_('빈 조각은 올릴 수 없습니다.');
  if (bytes.length > UPLOAD_PART_MAX_BYTES) throw fontBad_('조각이 너무 큽니다(최대 ' + UPLOAD_PART_MAX_BYTES + ' 바이트).', { bytes: bytes.length });

  const folder = fontFolder_(true);
  const mine = uploadParts_(folder).filter(function (p) { return p.name === name; });
  const idx = fontIndexRead_(folder);
  const known = fontEntryOf_(idx, name);
  let license = known ? known.license : '';
  // 라이선스는 새 업로드의 첫 조각에서 한 번 받는다(이미 있는 폰트를 다시 올릴 때는 다시 묻지 않는다).
  if (index === 0) {
    license = fontLicense_(payload.license !== undefined && payload.license !== null && payload.license !== '' ? payload.license : license);
    if (!mine.length && !known && idx.fonts.length >= FONT_MAX_COUNT) {
      throw fontBad_('폰트는 ' + FONT_MAX_COUNT + '종까지 보관할 수 있습니다. 안 쓰는 폰트를 지우고 올려 주세요.', { fonts: idx.fonts.length, max: FONT_MAX_COUNT });
    }
    if (!fontSignatureOk_(bytes.slice(0, 4))) {
      throw fontBad_('폰트 파일이 아닌 것 같습니다(ttf·otf·woff2 파일의 앞부분이 다릅니다). 확장자만 바꾼 파일은 올릴 수 없습니다.');
    }
  } else if (!known && !mine.length) {
    throw fontBad_('먼저 첫 조각(0번)을 보내 주세요.');
  }
  // 0번은 새 업로드의 시작 — 같은 이름의 옛 조각을 모두 치운다. 그 밖의 번호는 같은 번호만 바꾼다(재시도 안전).
  trashParts_(mine.filter(function (p) { return index === 0 || p.index === index || p.parts !== parts; }));
  folder.createFile(Utilities.newBlob(bytes, 'application/octet-stream', uploadPartName_(name, index, parts)));

  if (index === 0) {
    const total = Number(payload.total_size) > 0 ? Number(payload.total_size) : bytes.length;
    const entry = { name: name, label: fontLabel_(name), license: license, bytes: total, parts: parts, updated_at: formatKstIso_(new Date()) };
    const rest = idx.fonts.filter(function (f) { return f && f.name !== name; });
    rest.push(entry);
    fontIndexWrite_(folder, { v: 1, fonts: rest });
  }
  return { name: name, label: fontLabel_(name), license: license, index: index, parts: parts, bytes: bytes.length };
}

function handleFontList_(ss, payload) {
  const folder = fontFolder_(false);
  if (!folder) return { items: [] };
  const idx = fontIndexRead_(folder);
  const byName = {};
  uploadParts_(folder).forEach(function (p) {
    const g = byName[p.name] || (byName[p.name] = { name: p.name, sets: {} });
    const s = g.sets[p.parts] || (g.sets[p.parts] = { parts: p.parts, seen: {}, size: 0 });
    if (!s.seen[p.index]) { s.seen[p.index] = true; s.size += Number(p.file.getSize()) || 0; }
  });
  const items = idx.fonts.map(function (f) {
    const g = byName[f.name];
    const set = g && g.sets[f.parts] ? g.sets[f.parts] : null;
    const found = set ? Object.keys(set.seen).length : 0;
    return {
      name: f.name,
      label: f.label || fontLabel_(f.name),
      license: f.license || '',
      bytes: set ? set.size : Number(f.bytes) || 0,
      parts: f.parts,
      parts_found: found,
      complete: !!set && found === f.parts,
      updated_at: f.updated_at || ''
    };
  }).filter(function (it) { return it.parts_found > 0 || it.bytes > 0; });
  return { items: items };
}

function handleFontFetch_(ss, payload) {
  const name = fontName_(payload);
  const parts = uploadInt_(payload.parts, 'parts', 1, UPLOAD_MAX_PARTS);
  const index = uploadInt_(payload.index, 'index', 0, parts - 1);
  const folder = fontFolder_(false);
  if (!folder) throw createAppError_('ERR_NOT_FOUND', '보관한 폰트가 없습니다.', { name: name });
  const it = folder.getFilesByName(uploadPartName_(name, index, parts));
  let file = null;
  while (it.hasNext()) { const f = it.next(); if (!fileTrashed_(f)) { file = f; break; } }
  if (!file) throw createAppError_('ERR_NOT_FOUND', '폰트 조각을 찾지 못했습니다.', { name: name, index: index });
  const bytes = file.getBlob().getBytes();
  return { name: name, index: index, parts: parts, bytes: bytes.length, data: Utilities.base64Encode(bytes) };
}

function handleFontDelete_(ss, payload) {
  const name = fontName_(payload);
  const folder = fontFolder_(false);
  if (!folder) return { name: name, removed: 0 };
  const mine = uploadParts_(folder).filter(function (p) { return p.name === name; });
  trashParts_(mine);
  const idx = fontIndexRead_(folder);
  const rest = idx.fonts.filter(function (f) { return f && f.name !== name; });
  if (rest.length !== idx.fonts.length) fontIndexWrite_(folder, { v: 1, fonts: rest });
  return { name: name, removed: mine.length };
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
