/**
 * gas/Orders.gs  —  원스톱 만들기 화면이 부르는 두 액션 (2026-11-18, O4)
 *
 *  ① list_drive_media : 드라이브 폴더 링크 → 파일 목록(이름·종류·촬영시각·크기)
 *      · [폴더 읽기] 버튼. 실패해도 화면은 [파일명 붙여넣기] 폴백으로 계속 쓸 수 있다.
 *      · 최대 100개 · 15초 컷(넘으면 truncated:true 로 잘린 사실을 알린다)
 *
 *  ② hub_order : 조립본을 집 노트북(hub-agent)의 Command_Queue 에 넣는다
 *      · 브라우저에는 큐 토큰을 절대 넣지 않는다 — 토큰은 이 스크립트 속성에만 있다.
 *      · ScriptProperties: QUEUE_EXEC_URL · QUEUE_TOKEN  (필수)
 *                          QUEUE_WORKSPACE(기본 content-hub) · QUEUE_ENGINE(기본 auto)
 *      · 허용 타입 4종: content_render · content_upload · content_stats · blog_neighbor
 *      · 큐에 들어가는 실제 타입은 claude_prompt(mode=edit) 다 — Command_Queue 가 아는 타입이
 *        5종(git_pull·claude_prompt·smartstore_api_relay·toss_sync·git_push)뿐이라서,
 *        논리 타입은 프롬프트 첫 줄과 응답(type)에 남긴다.
 *
 * 왜 프록시인가: 큐 토큰이 브라우저 번들에 들어가면 CSP·공개 저장소로 그대로 샌다.
 * 이 파일은 토큰을 응답에 담지 않고, 받은 값은 길이·모양만 검사해 시트/Drive 로 넘긴다.
 */

/** 허용 타입 — 늘리려면 여기와 docs/ONESTOP_CREATOR_SPEC.md §8.1 을 같이 고친다. */
const HUB_ORDER_TYPES = ['content_render', 'content_upload', 'content_stats', 'blog_neighbor'];

const MEDIA_MAX_FILES = 100;
const MEDIA_DEADLINE_MS = 15000;
const HUB_ORDER_TIMEOUT_MS = 30000;      // 외부 큐 호출 가드(이 화면 버튼 1회의 상한)
const HUB_ORDER_MAX_PROMPT = 2000;       // Command_Queue QQ_MAX_PROMPT 와 같은 값

/* ------------------------------------------------------------------ *
 * ① 드라이브 폴더 읽기
 * ------------------------------------------------------------------ */

/** 드라이브 폴더 링크/ID → 폴더 ID. 못 찾으면 ''. */
function driveFolderIdFrom_(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  // 이미 ID 만 준 경우 (드라이브 폴더 ID 는 20자 이상 [A-Za-z0-9_-])
  if (/^[A-Za-z0-9_-]{20,}$/.test(s)) return s;
  const patterns = [
    /\/folders\/([A-Za-z0-9_-]{20,})/,          // drive.google.com/drive/folders/<ID>
    /[?&]id=([A-Za-z0-9_-]{20,})/,              // open?id=<ID> · uc?id=<ID>
    /\/d\/([A-Za-z0-9_-]{20,})/                 // /file/d/<ID> (폴더가 아니면 아래에서 걸러진다)
  ];
  for (let i = 0; i < patterns.length; i++) {
    const m = s.match(patterns[i]);
    if (m) return m[1];
  }
  return '';
}

/** MIME → 화면이 쓰는 종류(IMAGE · VIDEO · OTHER). */
function mediaKindOf_(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.indexOf('image/') === 0) return 'IMAGE';
  if (m.indexOf('video/') === 0) return 'VIDEO';
  return 'OTHER';
}

function handleListDriveMedia_(ss, payload) {
  const raw = String((payload && (payload.folder_url || payload.folder_id)) || '').trim();
  if (!raw) {
    throw createAppError_('ERR_NO_FOLDER', '드라이브 폴더 링크를 먼저 넣어 주세요.',
      { hint: 'drive.google.com/drive/folders/<ID> 형태의 링크' });
  }
  const folderId = driveFolderIdFrom_(raw);
  if (!folderId) {
    throw createAppError_('ERR_NO_FOLDER', '링크에서 폴더 ID 를 찾지 못했습니다.',
      { hint: '…/folders/<ID> 또는 …?id=<ID> 형태로 붙여넣어 주세요' });
  }

  let folder;
  try {
    folder = DriveApp.getFolderById(folderId);
  } catch (err) {
    throw createAppError_('ERR_NO_FOLDER', '폴더를 열 수 없습니다(권한 또는 링크 확인).',
      { reason: sanitizeErrorDetail_((err && err.message) || '') });
  }

  const startedAt = nowMs_();
  const items = [];
  let truncated = false;
  const it = folder.getFiles();
  while (it.hasNext()) {
    if (items.length >= MEDIA_MAX_FILES) { truncated = true; break; }
    if (nowMs_() - startedAt > MEDIA_DEADLINE_MS) { truncated = true; break; }
    const f = it.next();
    let size = 0, created = '', updated = '';
    try { size = Number(f.getSize()) || 0; } catch (e) { size = 0; }
    try { created = formatKstIso_(f.getDateCreated()); } catch (e) { created = ''; }
    try { updated = formatKstIso_(f.getLastUpdated()); } catch (e) { updated = ''; }
    const mime = String(f.getMimeType() || '');
    items.push({
      id: f.getId(),
      name: String(f.getName() || ''),
      kind: mediaKindOf_(mime),
      mime: mime,
      size: size,
      created_at: created,
      updated_at: updated
    });
  }

  // 이름 순 — 화면 표가 새로고침마다 흔들리지 않게.
  items.sort(function (a, b) { return a.name.localeCompare(b.name); });

  const byKind = { IMAGE: 0, VIDEO: 0, OTHER: 0 };
  items.forEach(function (x) { byKind[x.kind] = (byKind[x.kind] || 0) + 1; });

  return {
    folder: { id: folderId, name: String(folder.getName() || '') },
    items: items,
    count: items.length,
    counts: byKind,
    truncated: truncated,
    note: truncated
      ? '일부만 읽었습니다(최대 ' + MEDIA_MAX_FILES + '개 · ' + Math.round(MEDIA_DEADLINE_MS / 1000) + '초). 나머지는 파일명을 붙여넣어 주세요.'
      : '사진·영상의 가로/세로 크기는 드라이브에서 읽지 못해 비워 둡니다(조립은 파일명·개수로 합니다).'
  };
}

/* ------------------------------------------------------------------ *
 * ② 노트북 오더 (Command_Queue 프록시)
 * ------------------------------------------------------------------ */

/** 타입별 지시문 — 프롬프트 1건이 2,000자를 넘지 않게 짧게 유지한다. */
function hubOrderInstruction_(type, payload) {
  const place = String((payload && payload.place_name) || '').trim();
  const channel = String((payload && payload.channel) || '').trim();
  switch (type) {
    case 'content_render':
      return '이 조립본으로 채널 산출물(쇼츠·클립·당근·인스타·블로그)을 실제 파일로 만든다. '
        + '만들 파일은 1~2개만. 렌더 도구가 없으면 `BLOCKED: NEED <경로>` 한 줄만 남기고 멈춘다.';
    case 'content_upload':
      return '이 조립본을 채널에 업로드할 준비(제목·본문·태그·썸네일 문구)를 파일 1개로 정리한다. '
        + '실제 업로드·로그인은 하지 않는다.';
    case 'content_stats':
      return '이 콘텐츠의 채널별 지표(조회·저장·댓글)를 읽어 Metrics 에 넣을 JSON 1개로 만든다. '
        + '숫자를 못 읽으면 `BLOCKED: NEED <경로>` 한 줄로 멈춘다.';
    case 'blog_neighbor':
      return '이 글에 달린 댓글·서로이웃 후보를 정리해 답글 초안 1개 파일로 만든다. '
        + '실제 전송은 하지 않는다.';
    default:
      return '조립본을 확인하고 결과 파일 1~2개만 남긴다.';
  }
}

/** 오더 프롬프트 — 사람이 읽어도 무슨 일인지 남게 첫 줄에 논리 타입·장소를 적는다. */
function hubOrderPrompt_(type, payload) {
  const place = String((payload && payload.place_name) || '(장소 미정)').trim();
  const channel = String((payload && payload.channel) || '').trim();
  const slots = Number(payload && payload.slot_count);
  const sha = String((payload && payload.user_body_sha256) || '').slice(0, 16);
  const tone = String((payload && payload.tone_seed) || 'seeds/skills/tone_reference_v1.md').trim();
  const lines = [
    '[콘텐츠 허브 오더 · ' + type + '] ' + place + (channel ? ' · ' + channel : ''),
    '슬롯 ' + (isFinite(slots) ? slots : 0) + '개 · 조립본 해시 ' + (sha || '(없음)') + ' · 톤 시드 ' + tone,
    '',
    '근거: docs/ONESTOP_CREATOR_SPEC.md §8 · docs/CONTENT_STANDARD_v3.md 를 먼저 읽어라.',
    hubOrderInstruction_(type, payload),
    '',
    '[규칙] 다른 파일은 고치지 않는다. 커밋·원격 반영은 하지 않는다(게이트가 판단한다). '
      + '완료하면 바꾼 파일 경로와 한 줄 요약만 남긴다.'
  ];
  let text = lines.join('\n');
  if (text.length > HUB_ORDER_MAX_PROMPT) text = text.slice(0, HUB_ORDER_MAX_PROMPT);
  return text;
}

/** 큐 응답(JSON)에서 사람이 볼 값만 꺼낸다. */
function hubOrderResult_(json, type, workspace, prompt) {
  const item = (json && json.item) || {};
  const id = String(item.id || (json && json.order_id) || '');
  return {
    order_id: id,
    status: String(item.status || (json && json.status) || ''),
    type: type,
    queue_type: 'claude_prompt',
    workspace: workspace,
    prompt_chars: prompt.length,
    note: String((json && json.note) || ''),
    duplicate: !!(json && json.duplicate)
  };
}

function handleHubOrder_(ss, payload, ctx) {
  const type = String((payload && payload.type) || '').trim();
  if (HUB_ORDER_TYPES.indexOf(type) === -1) {
    throw createAppError_('ERR_INVALID_ACTION', '허용되지 않은 오더 타입입니다: ' + (type || '(없음)'),
      { allowed: HUB_ORDER_TYPES });
  }

  const props = PropertiesService.getScriptProperties();
  const url = String(props.getProperty('QUEUE_EXEC_URL') || '').trim();
  const token = String(props.getProperty('QUEUE_TOKEN') || '').trim();
  if (!url || !/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url)) {
    throw createAppError_('ERR_SERVER_CONFIG',
      'QUEUE_EXEC_URL 이 없거나 형식이 다릅니다. 스크립트 속성에 큐 웹앱 /exec 주소를 넣어 주세요.');
  }
  if (!token) {
    throw createAppError_('ERR_SERVER_CONFIG',
      'QUEUE_TOKEN 이 없습니다. 스크립트 속성에 큐 키를 넣어 주세요(브라우저에는 내려가지 않습니다).');
  }
  const workspace = String(props.getProperty('QUEUE_WORKSPACE') || 'content-hub').trim() || 'content-hub';
  const engine = String(props.getProperty('QUEUE_ENGINE') || 'auto').trim() || 'auto';

  const prompt = hubOrderPrompt_(type, payload);
  const body = {
    key: token,
    action: 'queue_enqueue',
    type: 'claude_prompt',
    workspace: workspace,
    payload: { prompt: prompt, mode: 'edit', engine: engine }
  };

  let res, text;
  try {
    res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'text/plain;charset=utf-8',
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
      followRedirects: true
    });
    text = res.getContentText();
  } catch (err) {
    throw createAppError_('ERR_QUEUE_UNREACHABLE', '큐에 연결하지 못했습니다(잠시 뒤 다시 시도).',
      { reason: sanitizeErrorDetail_((err && err.message) || '') });
  }

  let json = null;
  try { json = JSON.parse(text); } catch (e) { json = null; }
  if (!json) {
    throw createAppError_('ERR_QUEUE_UNREACHABLE', '큐가 JSON 이 아닌 응답을 줬습니다(배포·권한 확인).',
      { status: (res && res.getResponseCode && res.getResponseCode()) || 0, preview: String(text || '').slice(0, 160) });
  }
  if (!json.ok) {
    // 포털은 오류를 문자열('unauthorized')로도, 객체({code,message})로도 준다 — 둘 다 읽는다.
    const e = (json.error && typeof json.error === 'object') ? json.error : {};
    const msg = e.message || (typeof json.error === 'string' ? json.error : '') || '큐가 거절';
    const code = String(e.code || json.code || '');
    const hint = /unauthorized/i.test(msg) ? ' — QUEUE_TOKEN 이 그 웹앱의 키와 다릅니다'
      : (code === 'workspace' ? ' — QUEUE_WORKSPACE 값이 큐의 허용 목록에 없습니다'
      : (code === 'too_long' || code === 'bad_request' ? ' — 오더 내용을 줄여 주세요' : ''));
    throw createAppError_('ERR_QUEUE_REJECTED', '큐가 오더를 받지 않았습니다: ' + msg + hint,
      { queue_code: code });
  }

  const out = hubOrderResult_(json, type, workspace, prompt);
  appendSystemHealth_({
    eventType: 'HUB_ORDER', status: 'SUCCESS', actor: 'api',
    detail: type + ' → ' + (out.order_id || '(id 없음)') + ' · ' + workspace
  });
  return out;
}

/* ------------------------------------------------------------------ *
 * 연결 점검 — 편집기에서 이 함수 하나를 [실행]하면 큐 연결을 확인한다.
 *
 *   · ScriptProperties 의 QUEUE_EXEC_URL · QUEUE_TOKEN 으로 큐에 queue_status(읽기)만 부른다
 *     → 오더를 만들지 않는다.
 *   · 처음 실행할 때 UrlFetchApp 권한(script.external_request) 동의 창이 한 번 뜬다.
 *     이 함수를 실행해 두면 #/create 의 [오더 보내기]가 바로 동작한다.
 * ------------------------------------------------------------------ */
function checkQueueLink() {
  const props = PropertiesService.getScriptProperties();
  const url = String(props.getProperty('QUEUE_EXEC_URL') || '').trim();
  const token = String(props.getProperty('QUEUE_TOKEN') || '').trim();
  if (!url || !token) {
    return { ok: false, error: 'QUEUE_EXEC_URL · QUEUE_TOKEN 을 스크립트 속성에 넣어 주세요.' };
  }
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'text/plain;charset=utf-8',
    payload: JSON.stringify({ key: token, action: 'queue_status' }),
    muteHttpExceptions: true,
    followRedirects: true
  });
  const text = res.getContentText();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { json = null; }
  if (!json) return { ok: false, error: '큐 응답이 JSON 이 아닙니다', status: res.getResponseCode(), preview: String(text).slice(0, 120) };
  return {
    ok: !!json.ok,
    workspace: String(props.getProperty('QUEUE_WORKSPACE') || 'content-hub'),
    engine: String(props.getProperty('QUEUE_ENGINE') || 'auto'),
    queue: json.queue || null,
    heartbeat: json.heartbeat || null,
    raw_ok: json.ok
  };
}
