/**
 * gas/Result.gs — 만든 영상·커버를 허브에 올려 두고 허브 화면에서 받기 (2026-11-21)
 *
 *  노트북이 렌더를 끝내면 결과 파일(최종 mp4·커버 jpg)을 이 파일의 액션으로 구글 드라이브에 보관한다.
 *  허브 화면(④ 결과·⑥ 마무리)이 목록을 읽어 '내려받기'·'여기서 보기'를 보여 준다 — 노트북 폴더에 가지 않아도 된다.
 *
 *  저장: 드라이브 ContentHubOS_Uploads / out_<content_id> /  <파일이름>.part00003of00012  (영상 올리기와 같은 조각 방식·2MB)
 *   · 폴더는 비공개이고 링크 공유를 켜지 않는다. 접근은 허브 API 토큰 하나뿐이다.
 *   · 올리는 쪽은 노트북(조각 보내기), 받는 쪽은 허브 화면(조각을 받아 브라우저에서 이어 붙임).
 *   · 같은 이름을 다시 올리면 덮어쓴다(0번 조각이 새 업로드의 시작).
 *
 *  액션 4개 (Auth.gs 화이트리스트와 Code.gs M1_HANDLERS 에 등록)
 *   · result_put    조각 하나 저장(노트북용)
 *   · result_list   올라온 결과 파일 목록(이름·크기·조각 수·다 올라왔는지·올린 시각)
 *   · result_fetch  조각 하나를 base64 로(허브 화면용)
 *   · result_delete 파일 하나의 조각 전부 휴지통으로
 *
 *  Upload.gs 의 도우미(uploadFolder_·uploadParts_·uploadInt_·fileTrashed_…)를 그대로 쓴다.
 */

const RESULT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}\.(mp4|jpg)$/;
const RESULT_MAX_PARTS = 100;                          // 100 × 2MB = 200MB
const RESULT_MAX_TOTAL_BYTES = 200 * 1024 * 1024;

function resultName_(payload) {
  const n = String((payload && payload.name) || '');
  if (!RESULT_NAME_RE.test(n) || n.indexOf('..') !== -1) {
    throw uploadBad_('결과 파일 이름은 영문·숫자·._- 만, mp4·jpg 확장자만 가능합니다(80자 이내).', { name: n.slice(0, 40) });
  }
  return n;
}

function resultFolder_(contentId, create) { return uploadFolder_('out_' + contentId, create); }

function handleResultPut_(ss, payload) {
  const contentId = uploadContentId_(payload);
  const name = resultName_(payload);
  const parts = uploadInt_(payload.parts, 'parts', 1, RESULT_MAX_PARTS);
  const index = uploadInt_(payload.index, 'index', 0, parts - 1);
  if (payload.total_size !== undefined && payload.total_size !== null) uploadInt_(payload.total_size, 'total_size', 1, RESULT_MAX_TOTAL_BYTES);
  const b64 = String(payload.data || '');
  if (!b64 || !/^[A-Za-z0-9+\/=]+$/.test(b64)) throw uploadBad_('data 는 base64 문자열이어야 합니다.');
  const bytes = Utilities.base64Decode(b64);
  if (!bytes || !bytes.length) throw uploadBad_('빈 조각은 올릴 수 없습니다.');
  if (bytes.length > UPLOAD_PART_MAX_BYTES) throw uploadBad_('조각이 너무 큽니다(최대 ' + UPLOAD_PART_MAX_BYTES + '바이트).', { bytes: bytes.length });

  const folder = resultFolder_(contentId, true);
  const mine = uploadParts_(folder).filter(function (p) { return p.name === name; });
  // 0번은 새 업로드의 시작 — 같은 이름의 앞선 조각을 모두 치운다. 그 밖의 번호는 같은 번호의 옛 조각만 바꾼다.
  trashParts_(mine.filter(function (p) { return index === 0 || p.index === index || p.parts !== parts; }));
  folder.createFile(Utilities.newBlob(bytes, 'application/octet-stream', uploadPartName_(name, index, parts)));
  return { content_id: contentId, name: name, index: index, parts: parts, bytes: bytes.length };
}

function handleResultList_(ss, payload) {
  const contentId = uploadContentId_(payload);
  const folder = resultFolder_(contentId, false);
  if (!folder) return { content_id: contentId, items: [] };
  const by = {};
  uploadParts_(folder).forEach(function (p) {
    if (!RESULT_NAME_RE.test(p.name)) return;
    const g = by[p.name] || (by[p.name] = { name: p.name, sets: {} });
    const s = g.sets[p.parts] || (g.sets[p.parts] = { parts: p.parts, seen: {}, size: 0, at: 0 });
    if (!s.seen[p.index]) { s.seen[p.index] = true; s.size += Number(p.file.getSize()) || 0; }
    const t = p.file.getLastUpdated().getTime();
    if (t > s.at) s.at = t;
  });
  const items = Object.keys(by).sort().map(function (n) {
    const g = by[n];
    let best = null;
    Object.keys(g.sets).forEach(function (k) {
      const s = g.sets[k];
      const found = Object.keys(s.seen).length;
      const done = found === s.parts;
      if (!best || (done && !best.done) || (done === best.done && found > best.found)) best = { s: s, found: found, done: done };
    });
    return {
      name: n, size: best.s.size, parts: best.s.parts, parts_found: best.found,
      complete: best.done && Object.keys(g.sets).length === 1,
      kind: /\.jpg$/i.test(n) ? 'image' : 'video',
      updated_at: best.s.at ? formatKstIso_(new Date(best.s.at)) : ''
    };
  });
  return { content_id: contentId, items: items };
}

function handleResultFetch_(ss, payload) {
  const contentId = uploadContentId_(payload);
  const name = resultName_(payload);
  const parts = uploadInt_(payload.parts, 'parts', 1, RESULT_MAX_PARTS);
  const index = uploadInt_(payload.index, 'index', 0, parts - 1);
  const folder = resultFolder_(contentId, false);
  if (!folder) throw createAppError_('ERR_NOT_FOUND', '올라온 결과 파일이 없습니다.', { content_id: contentId });
  const it = folder.getFilesByName(uploadPartName_(name, index, parts));
  let file = null;
  while (it.hasNext()) { const f = it.next(); if (!fileTrashed_(f)) { file = f; break; } }
  if (!file) throw createAppError_('ERR_NOT_FOUND', '조각을 찾지 못했습니다.', { name: name, index: index });
  const bytes = file.getBlob().getBytes();
  return { content_id: contentId, name: name, index: index, parts: parts, bytes: bytes.length, data: Utilities.base64Encode(bytes) };
}

function handleResultDelete_(ss, payload) {
  const contentId = uploadContentId_(payload);
  const name = resultName_(payload);
  const folder = resultFolder_(contentId, false);
  if (!folder) return { content_id: contentId, name: name, removed: 0 };
  const mine = uploadParts_(folder).filter(function (p) { return p.name === name; });
  trashParts_(mine);
  return { content_id: contentId, name: name, removed: mine.length };
}
