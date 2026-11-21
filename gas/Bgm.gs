/**
 * gas/Bgm.gs — 무료 BGM 찾기 · 보관 · 노트북 전달 (2026-11-21)
 *
 *  허브 '제작' 탭 ⑥ 마무리에서 BGM 을 직접 찾는다. 곡은 Openverse(공개 CC 라이선스 색인)에서 찾고,
 *  고른 곡은 이 서버가 한 번 내려받아 드라이브 비공개 폴더 ContentHubOS_Uploads/_bgm/ 에 보관한다.
 *  노트북은 허브 API 토큰으로 그 폴더에서 받아 간다 — 오더 payload 에는 파일 **이름**만 실린다(포털 큐 변경 없음).
 *
 *  쓸 수 있는 곡의 선: 영상(수익 가능 채널)에 쓸 수 있는 것만.
 *   · 라이선스 CC0 · 퍼블릭 도메인(pdm) · CC BY (출처 표기 필요). CC BY-SA·NC·ND 는 뺀다.
 *   · 출처: Jamendo(전곡 MP3) 만. 길이 30초~10분, 25MB 이하.
 *   · 곡마다 '영상 설명란에 넣을 출처 문구'(credit)를 만들어 함께 보관한다 — CC BY 는 이 문구를 넣어야 한다.
 *
 *  보안: 서버가 가져오는 주소는 (1) Openverse API 주소 (2) Openverse 가 알려 준 곡 주소가 *.storage.jamendo.com 모양일 때뿐.
 *  브라우저가 보낸 주소는 쓰지 않는다 — 곡 id(UUID)만 받아 서버가 직접 조회한다.
 *
 *  액션 6개 (Auth.gs 화이트리스트와 Code.gs M1_HANDLERS 에 등록)
 *   · bgm_search  키워드로 찾기(결과 12곡, 6시간 캐시)
 *   · bgm_pick    한 곡을 내려받아 보관(이름 = 영문 slug + id 앞 8자 .mp3)
 *   · bgm_put     **내 음원 올리기**(2026-11-21, 뮤직비디오 모드) — 2MB 조각으로 올려 같은 보관함에 둔다
 *   · bgm_list    보관한 곡 목록(이름·크기·출처 문구·내 파일 여부)
 *   · bgm_fetch   곡 조각을 base64 로(노트북용, 2MB 조각)
 *   · bgm_delete  보관한 곡 하나 휴지통으로
 *
 *  내 음원(bgm_put)은 뮤직비디오 모드에서 쓴다 — 허깅페이스 ACE-Step·Suno·내 녹음 등에서 뽑은
 *  mp3·m4a(25MB)·wav(30MB)를 그대로 올린다. 노트북은 이름만 받아 bgm_fetch 로 가져간다(경로 없음).
 */

const BGM_FOLDER_ID_ = '_bgm';
const BGM_API_URL = 'https://api.openverse.org/v1/audio/';
const BGM_LICENSE_LABELS = { cc0: 'CC0 1.0', pdm: '퍼블릭 도메인', by: 'CC BY' };
const BGM_AUDIO_URL_RE = /^https:\/\/[a-z0-9-]+\.storage\.jamendo\.com\/\?trackid=\d+&format=mp3\d?$/;
const BGM_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/* 보관함 파일 이름 — 내려받은 BGM(영문 slug)과 내가 올린 음원(한글·공백 허용) 둘 다.
   조각 파일은 '<이름>.p00of03' 모양이라 이 규칙(끝이 mp3·m4a·wav)에 걸리지 않는다. */
const BGM_NAME_RE_SERVER = /^[A-Za-z0-9가-힣][A-Za-z0-9가-힣._ -]{0,79}\.(mp3|m4a|wav)$/;
const BGM_EXT_RE = /\.(mp3|m4a|wav)$/i;
const BGM_MIME = { mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav' };
const BGM_PART_BYTES = 2 * 1024 * 1024;
const BGM_MAX_BYTES = 25 * 1024 * 1024;
const BGM_PUT_MAX_PARTS = 16;                       // 16 × 2MB = 32MB
const BGM_PUT_MAX_BYTES = 30 * 1024 * 1024;         // wav 3분이 30MB 안팎이다
const BGM_MIN_BYTES = 100 * 1024;
const BGM_MIN_SEC = 30;
const BGM_MAX_SEC = 600;
const BGM_PAGE_SIZE = 12;
const BGM_CACHE_SECONDS = 6 * 3600;

function bgmBad_(msg, details) { return createAppError_('ERR_VALIDATION_FAILED', msg, details); }

function bgmClean_(s, max) {
  return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Openverse 결과 한 건 → 화면·보관용 모양. 쓸 수 없는 곡이면 null. */
function bgmItemOf_(r) {
  if (!r || typeof r !== 'object') return null;
  const id = String(r.id || '');
  const lic = String(r.license || '').toLowerCase();
  const url = String(r.url || '');
  const sec = Math.round(Number(r.duration) / 1000);
  if (!BGM_ID_RE.test(id)) return null;
  if (!BGM_LICENSE_LABELS[lic]) return null;                         // by-sa · nc · nd 등은 뺀다
  if (String(r.provider || r.source || '') !== 'jamendo') return null;
  if (!BGM_AUDIO_URL_RE.test(url)) return null;
  if (!isFinite(sec) || sec < BGM_MIN_SEC || sec > BGM_MAX_SEC) return null;
  const title = bgmClean_(r.title, 80) || '이름 없는 곡';
  const creator = bgmClean_(r.creator, 60) || '알 수 없음';
  const version = lic === 'by' ? bgmClean_(r.license_version, 6) : '';
  const label = lic === 'by' ? 'CC BY' + (version ? ' ' + version : '') : BGM_LICENSE_LABELS[lic];
  const licenseUrl = /^https:\/\/creativecommons\.org\//.test(String(r.license_url || '')) ? String(r.license_url) : '';
  const landing = /^https:\/\/www\.jamendo\.com\//.test(String(r.foreign_landing_url || '')) ? String(r.foreign_landing_url) : '';
  const credit = 'Music: "' + title + '" by ' + creator + (landing ? ' (' + landing + ')' : '') + ' — ' + label + (licenseUrl ? ' (' + licenseUrl + ')' : '');
  const genres = Array.isArray(r.genres) ? r.genres.slice(0, 3).map(function (g) { return bgmClean_(g, 20); }).filter(Boolean) : [];
  return {
    id: id, title: title, creator: creator, license: lic, license_label: label, credit_required: lic === 'by',
    duration_sec: sec, genres: genres, landing_url: landing, license_url: licenseUrl, credit: credit,
    preview_url: url, audio_url: url
  };
}

/** 화면에 보내는 모양(서버 내부용 audio_url 은 빼고 미리듣기 주소만 남긴다). */
function bgmPublicItem_(it) {
  const o = {};
  Object.keys(it).forEach(function (k) { if (k !== 'audio_url') o[k] = it[k]; });
  return o;
}

function bgmGetJson_(url) {
  let res;
  try {
    res = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true, followRedirects: true, headers: { Accept: 'application/json' } });
  } catch (err) {
    throw createAppError_('ERR_BGM_UNREACHABLE', 'BGM 목록 서비스에 연결하지 못했어요. 잠시 뒤 다시 눌러 주세요.',
      { detail: sanitizeErrorDetail_(String(err && err.message || err)) });
  }
  const code = res.getResponseCode();
  if (code === 429) throw createAppError_('ERR_BGM_UNREACHABLE', 'BGM 검색을 너무 자주 해서 잠시 막혔어요. 몇 분 뒤 다시 눌러 주세요.', { http: code });
  if (code === 404) throw createAppError_('ERR_NOT_FOUND', '그 곡을 찾지 못했어요.', { http: code });
  if (code < 200 || code >= 300) throw createAppError_('ERR_BGM_UNREACHABLE', 'BGM 목록 서비스가 응답하지 않아요(HTTP ' + code + '). 잠시 뒤 다시 눌러 주세요.', { http: code });
  try { return JSON.parse(res.getContentText()); } catch (err) { throw createAppError_('ERR_BGM_UNREACHABLE', 'BGM 목록 응답을 읽지 못했어요.', {}); }
}

function handleBgmSearch_(ss, payload) {
  const q = bgmClean_(payload && payload.q, 40);
  if (!q) throw bgmBad_('찾을 말을 적어 주세요(예: calm piano, upbeat, lofi).');
  const page = Math.max(1, Math.min(5, Math.floor(Number(payload && payload.page)) || 1));
  const cacheKey = 'BGM_Q_' + sha256Hex_(q.toLowerCase() + '|' + page);
  const cache = CacheService.getScriptCache();
  const hit = cache.get(cacheKey);
  if (hit) { try { return JSON.parse(hit); } catch (err) { /* 다시 조회 */ } }
  const url = BGM_API_URL + '?q=' + encodeURIComponent(q) + '&source=jamendo&license=by,cc0,pdm&page_size=' + BGM_PAGE_SIZE + '&page=' + page;
  const data = bgmGetJson_(url);
  const items = (Array.isArray(data.results) ? data.results : []).map(bgmItemOf_).filter(Boolean).map(bgmPublicItem_);
  const out = { q: q, page: page, total: Number(data.result_count) || 0, items: items };
  try { cache.put(cacheKey, JSON.stringify(out), BGM_CACHE_SECONDS); } catch (err) { /* 캐시가 안 돼도 결과는 준다 */ }
  return out;
}

function bgmFolder_(create) { return uploadFolder_(BGM_FOLDER_ID_, create); }

function bgmSlug_(title) {
  const s = String(title || '').normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 40).replace(/-+$/g, '');
  return s || 'bgm';
}

function bgmName_(it) { return bgmSlug_(it.title) + '-' + it.id.slice(0, 8) + '.mp3'; }
function bgmMetaName_(name) { return String(name).replace(BGM_EXT_RE, '') + '.credit.json'; }

function bgmNameOf_(payload) {
  const n = String((payload && payload.name) || '');
  if (!BGM_NAME_RE_SERVER.test(n) || n.indexOf('..') !== -1) throw bgmBad_('BGM 이름 형식이 맞지 않아요.');
  return n;
}

function bgmFindFile_(folder, name) {
  const it = folder.getFilesByName(name);
  let best = null;
  while (it.hasNext()) {
    const f = it.next();
    if (fileTrashed_(f)) continue;
    if (!best || f.getLastUpdated().getTime() > best.getLastUpdated().getTime()) best = f;
  }
  return best;
}

function handleBgmPick_(ss, payload) {
  const id = String((payload && payload.id) || '').toLowerCase();
  if (!BGM_ID_RE.test(id)) throw bgmBad_('곡 id 형식이 맞지 않아요.');
  // 브라우저가 준 값은 id 뿐 — 라이선스·주소는 서버가 다시 조회해서 확인한다
  const item = bgmItemOf_(bgmGetJson_(BGM_API_URL + id + '/'));
  if (!item) throw bgmBad_('이 곡은 영상에 쓸 수 있는 조건(CC0·퍼블릭 도메인·CC BY, 30초~10분)이 아니에요.');
  const name = bgmName_(item);
  const folder = bgmFolder_(true);
  const existing = bgmFindFile_(folder, name);
  if (existing && existing.getSize() >= BGM_MIN_BYTES && bgmFindFile_(folder, bgmMetaName_(name))) {
    return { name: name, bytes: Number(existing.getSize()) || 0, already: true, item: bgmPublicItem_(item), credit: item.credit };
  }
  let res;
  try {
    res = UrlFetchApp.fetch(item.audio_url, { method: 'get', muteHttpExceptions: true, followRedirects: true });
  } catch (err) {
    throw createAppError_('ERR_BGM_UNREACHABLE', '곡을 내려받지 못했어요. 잠시 뒤 다시 눌러 주세요.', { detail: sanitizeErrorDetail_(String(err && err.message || err)) });
  }
  if (res.getResponseCode() !== 200) throw createAppError_('ERR_BGM_UNREACHABLE', '곡을 내려받지 못했어요(HTTP ' + res.getResponseCode() + ').', { http: res.getResponseCode() });
  const blob = res.getBlob();
  const bytes = blob.getBytes();
  if (bytes.length < BGM_MIN_BYTES || bytes.length > BGM_MAX_BYTES) throw bgmBad_('곡 크기가 이상해요(' + bytes.length + '바이트).', { bytes: bytes.length });
  // mp3 는 'ID3' 머리글이나 프레임 동기(0xFF 0xEx)로 시작한다 — 아니면 오디오가 아닌 것
  const b0 = bytes[0] & 255, b1 = bytes[1] & 255, b2 = bytes[2] & 255;
  const looksMp3 = (b0 === 0x49 && b1 === 0x44 && b2 === 0x33) || (b0 === 0xFF && (b1 & 0xE0) === 0xE0);
  if (!looksMp3) throw bgmBad_('받은 파일이 mp3 가 아니에요.');

  [name, bgmMetaName_(name)].forEach(function (n) {
    const old = folder.getFilesByName(n);
    while (old.hasNext()) { try { old.next().setTrashed(true); } catch (err) { /* 이미 지워짐 */ } }
  });
  folder.createFile(Utilities.newBlob(bytes, 'audio/mpeg', name));
  const meta = {
    id: item.id, title: item.title, creator: item.creator, license: item.license, license_label: item.license_label,
    credit_required: item.credit_required, license_url: item.license_url, landing_url: item.landing_url, credit: item.credit,
    duration_sec: item.duration_sec, saved_at: formatKstIso_(new Date())
  };
  folder.createFile(bgmMetaName_(name), JSON.stringify(meta), 'application/json');
  return { name: name, bytes: bytes.length, already: false, item: bgmPublicItem_(item), credit: item.credit };
}

function bgmMetaOf_(folder, name) {
  const f = bgmFindFile_(folder, bgmMetaName_(name));
  if (!f) return null;
  try { return JSON.parse(f.getBlob().getDataAsString()); } catch (err) { return null; }
}

/* ------------------------------------------------------------------ *
 * 내 음원 올리기 (2026-11-21, 뮤직비디오 모드) — 2MB 조각으로 받아 하나로 붙인다
 *
 *  브라우저가 보내는 것: { name, index, parts, total_size, data(base64) }
 *   · name 은 사용자가 고른 파일 이름이다(한글·공백 허용). 경로는 안 받는다(이름만).
 *   · 조각은 '<이름>.p00of03' 모양으로 _bgm 폴더에 잠시 둔다 — 목록 규칙(끝이 mp3·m4a·wav)에 걸리지 않는다.
 *   · 마지막 조각까지 다 오면 순서대로 붙여 최종 파일 하나로 만든다(크기·머리글 확인).
 *   · 0번 조각은 '새로 올리기 시작' — 같은 이름의 옛 파일·조각을 먼저 치운다(다시 올리면 덮어쓴다).
 *   · 메타(<이름>.credit.json)에 source:'user' 를 남긴다 — 화면이 '내 파일'로 보여 주고, 출처 표기는 필요 없다.
 * ------------------------------------------------------------------ */
const BGM_MAGIC_OK = { mp3: true, m4a: true, wav: true };

function bgmPutName_(payload) {
  const raw = String((payload && payload.name) || '');
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!BGM_NAME_RE_SERVER.test(name) || name.indexOf('..') !== -1 || name.charAt(0) === '.') {
    throw bgmBad_('음원 파일 이름은 mp3·m4a·wav 이고, 폴더·경로가 없는 이름이어야 해요(80자 이내).', { name: raw.slice(0, 40) });
  }
  return name;
}

function bgmPartName_(name, index, parts) {
  const two = function (n) { const s = String(n); return s.length < 2 ? '0' + s : s; };
  return name + '.p' + two(index) + 'of' + two(parts);
}

function bgmPutParts_(folder, name) {
  const out = [];
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (fileTrashed_(f)) continue;
    const n = String(f.getName() || '');
    if (n.indexOf(name + '.p') !== 0) continue;
    const m = /^(.*)\.p(\d{2})of(\d{2})$/.exec(n);
    if (!m) continue;
    out.push({ file: f, name: n, index: Number(m[2]), parts: Number(m[3]) });
  }
  return out;
}

function bgmTrashParts_(list) {
  let n = 0;
  (list || []).forEach(function (p) { try { p.file.setTrashed(true); n++; } catch (err) { /* 이미 지워짐 */ } });
  return n;
}

function bgmLooksAudio_(bytes, ext) {
  if (!bytes || bytes.length < 4) return false;
  const b0 = bytes[0] & 255, b1 = bytes[1] & 255, b2 = bytes[2] & 255, b3 = bytes[3] & 255;
  if (ext === 'wav') return b0 === 0x52 && b1 === 0x49 && b2 === 0x46 && b3 === 0x46;   // RIFF
  if (ext === 'm4a') {
    // ISO 기본 파일 형식: 4~8바이트가 'ftyp'
    return bytes.length > 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
  }
  // mp3: ID3 머리글 또는 프레임 동기(0xFF 0xEx)
  return (b0 === 0x49 && b1 === 0x44 && b2 === 0x33) || (b0 === 0xFF && (b1 & 0xE0) === 0xE0);
}

function handleBgmPut_(ss, payload) {
  const name = bgmPutName_(payload);
  const ext = (BGM_EXT_RE.exec(name) || [])[0].slice(1).toLowerCase();
  const parts = Math.floor(Number(payload && payload.parts));
  if (!isFinite(parts) || parts < 1 || parts > BGM_PUT_MAX_PARTS) throw bgmBad_('parts 는 1~' + BGM_PUT_MAX_PARTS + ' 이어야 해요.');
  const index = Math.floor(Number(payload && payload.index));
  if (!isFinite(index) || index < 0 || index >= parts) throw bgmBad_('index 는 0~' + (parts - 1) + ' 사이여야 해요.');
  const totalSize = Math.floor(Number(payload && payload.total_size));
  if (!isFinite(totalSize) || totalSize < BGM_MIN_BYTES || totalSize > BGM_PUT_MAX_BYTES) {
    throw bgmBad_('음원 크기는 100KB~' + Math.round(BGM_PUT_MAX_BYTES / 1048576) + 'MB 까지예요.');
  }
  if (ext === 'wav' && totalSize > BGM_PUT_MAX_BYTES) throw bgmBad_('wav 는 30MB 까지예요 — mp3·m4a 로 바꿔 올려 주세요.');
  if (ext !== 'wav' && totalSize > BGM_MAX_BYTES) throw bgmBad_('mp3·m4a 는 25MB 까지예요.');
  const b64 = String((payload && payload.data) || '');
  if (!b64 || !/^[A-Za-z0-9+\/=]+$/.test(b64)) throw bgmBad_('data 는 base64 문자열이어야 해요.');
  const bytes = Utilities.base64Decode(b64);
  if (!bytes || !bytes.length) throw bgmBad_('빈 조각은 올릴 수 없어요.');
  if (bytes.length > BGM_PART_BYTES) throw bgmBad_('조각이 너무 커요(최대 2MB).', { bytes: bytes.length });

  const folder = bgmFolder_(true);
  const existing = bgmPutParts_(folder, name);
  if (index === 0) {
    // 새로 올리기 시작 — 같은 이름의 **옛 조각**만 치운다. 이미 보관된 완성 곡은 다 올라올 때까지 그대로 둔다
    // (중간에 실패해도 멀쩡한 옛 곡을 잃지 않게).
    bgmTrashParts_(existing);
  } else {
    // 같은 번호·다른 조각 수의 옛 조각만 치운다(나머지 조각은 그대로 둔다).
    bgmTrashParts_(existing.filter(function (p) { return p.index === index || p.parts !== parts; }));
  }
  folder.createFile(Utilities.newBlob(bytes, 'application/octet-stream', bgmPartName_(name, index, parts)));

  const now = bgmPutParts_(folder, name).filter(function (p) { return p.parts === parts; });
  const seen = {};
  now.forEach(function (p) { seen[p.index] = true; });
  const received = Object.keys(seen).length;
  if (received < parts) return { name: name, index: index, parts: parts, received: received, done: false };

  // 다 모였다 — 순서대로 붙여 하나로 만든다.
  //  · push.apply 는 원소가 많으면 스택이 넘친다(실측: 3MB 에서 Maximum call stack) → 인덱스로 채운다.
  const chunks = [];
  let sum = 0;
  for (let i = 0; i < parts; i++) {
    const p = now.find(function (x) { return x.index === i; });
    const chunk = p.file.getBlob().getBytes();
    chunks.push(chunk);
    sum += chunk.length;
    if (sum > BGM_PUT_MAX_BYTES) throw bgmBad_('이어 붙인 크기가 한도을 넘어요.');
  }
  let buf;
  if (chunks.length === 1) buf = chunks[0];
  else {
    buf = new Array(sum);
    let off = 0;
    for (let c = 0; c < chunks.length; c++) {
      const ch = chunks[c];
      for (let k = 0; k < ch.length; k++) buf[off + k] = ch[k];
      off += ch.length;
    }
  }
  if (buf.length !== totalSize) {
    bgmTrashParts_(bgmPutParts_(folder, name));
    throw bgmBad_('받은 크기(' + buf.length + '바이트)가 알려 준 크기(' + totalSize + ')와 달라요. 처음부터 다시 올려 주세요.',
      { received: buf.length, expected: totalSize });
  }
  if (!bgmLooksAudio_(buf, ext)) {
    bgmTrashParts_(bgmPutParts_(folder, name));
    throw bgmBad_('받은 파일이 ' + ext + ' 음원이 아니에요(머리글이 다름).');
  }
  [name, bgmMetaName_(name)].forEach(function (n) {
    const old = folder.getFilesByName(n);
    while (old.hasNext()) { try { old.next().setTrashed(true); } catch (err) { /* 이미 지워짐 */ } }
  });
  folder.createFile(Utilities.newBlob(buf, BGM_MIME[ext] || 'audio/mpeg', name));
  const title = bgmClean_(payload && payload.title, 80) || name.replace(BGM_EXT_RE, '');
  const meta = {
    name: name, title: title, creator: '내 파일', license: 'user', license_label: '내 파일',
    credit_required: false, credit: '', source: 'user', duration_sec: 0,
    bytes: buf.length, saved_at: formatKstIso_(new Date())
  };
  folder.createFile(bgmMetaName_(name), JSON.stringify(meta), 'application/json');
  bgmTrashParts_(bgmPutParts_(folder, name));
  return { name: name, bytes: buf.length, parts: parts, received: parts, done: true, title: title };
}

function handleBgmList_(ss, payload) {
  const folder = bgmFolder_(false);
  if (!folder) return { items: [] };
  const seen = {};
  const items = [];
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (fileTrashed_(f)) continue;
    const n = String(f.getName() || '');
    if (!BGM_NAME_RE_SERVER.test(n) || seen[n]) continue;
    seen[n] = true;
    const meta = bgmMetaOf_(folder, n) || {};
    items.push({
      name: n, bytes: Number(f.getSize()) || 0, parts: Math.max(1, Math.ceil((Number(f.getSize()) || 0) / BGM_PART_BYTES)),
      title: String(meta.title || ''), creator: String(meta.creator || ''), license_label: String(meta.license_label || ''),
      credit_required: meta.credit_required === true, credit: String(meta.credit || ''), duration_sec: Number(meta.duration_sec) || 0,
      source: String(meta.source || 'openverse')   // 'user' = 내가 올린 음원(출처 표기 없음)
    });
  }
  items.sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });
  return { items: items };
}

function handleBgmFetch_(ss, payload) {
  const name = bgmNameOf_(payload);
  const folder = bgmFolder_(false);
  const f = folder ? bgmFindFile_(folder, name) : null;
  if (!f) throw createAppError_('ERR_NOT_FOUND', '허브에 그 BGM 이 없습니다: ' + name, { name: name });
  const all = f.getBlob().getBytes();
  const parts = Math.max(1, Math.ceil(all.length / BGM_PART_BYTES));
  const index = Math.floor(Number(payload && payload.index));
  if (!isFinite(index) || index < 0 || index >= parts) throw bgmBad_('index 는 0~' + (parts - 1) + ' 사이여야 합니다.');
  const slice = all.slice(index * BGM_PART_BYTES, Math.min(all.length, (index + 1) * BGM_PART_BYTES));
  const meta = index === 0 ? bgmMetaOf_(folder, name) : null;
  return { name: name, index: index, parts: parts, size: all.length, bytes: slice.length, data: Utilities.base64Encode(slice), credit: meta ? String(meta.credit || '') : undefined };
}

function handleBgmDelete_(ss, payload) {
  const name = bgmNameOf_(payload);
  const folder = bgmFolder_(false);
  if (!folder) return { name: name, removed: 0 };
  let removed = 0;
  removed += bgmTrashParts_(bgmPutParts_(folder, name));
  [name, bgmMetaName_(name)].forEach(function (n) {
    const it = folder.getFilesByName(n);
    while (it.hasNext()) { try { it.next().setTrashed(true); removed++; } catch (err) { /* 이미 지워짐 */ } }
  });
  return { name: name, removed: removed };
}
