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
 *      · content_render + inputs(영상 파일 이름) 는 큐에 실제 타입 content_render 로 들어간다(계약 v1, 위험 작업·승인 필요).
 *        큐가 그 타입을 모르면 ERR_QUEUE_TYPE_UNKNOWN 으로 알린다(옛 동작으로 되돌리지 않는다).
 *      · 그 밖의 오더는 큐에 claude_prompt(mode=edit) 로 들어간다 — Command_Queue 가 아는 타입이
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
  // 코드 포인트 순(로케일 비의존) — 실행 환경의 정렬 규칙에 따라 목록 순서가 달라지지 않게 한다
  items.sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });

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

/* ------------------------------------------------------------------ *
 * 영상 렌더 오더(계약 v1) — 큐에 실제 타입 content_render 를 넣는다(claude_prompt 가 아니다).
 *   payload 에 inputs(영상 파일 이름 목록)가 있는 content_render 만 이 경로를 탄다.
 *   inputs 가 없는 옛 content_render(#/create 의 조립본 오더)는 그대로 claude_prompt 경로다.
 *   노트북이 inbox/<content_id>/ 안의 파일만 읽는다 — 여기서는 경로가 아니라 '이름'만 통과시킨다.
 * ------------------------------------------------------------------ */
const RENDER_CONTENT_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const RENDER_FILE_RE = /^[A-Za-z0-9가-힣._ -]{1,80}$/;
const RENDER_EXT_RE = /\.(mp4|mov|m4v)$/i;
const RENDER_PROFILES = ['captions', 'bgm'];
const RENDER_BRANDS = ['daejeon_youth', 'ppiyak_kimmary'];
const RENDER_FITS = ['crop', 'blur', 'pad'];   // 프레이밍 — 비우면 노트북이 원본 방향으로 정한다
const RENDER_MAX_INPUTS = 8;
/* 완제품(2026-11-20): 자막 번인·내레이션. 큐 payload 4,000자 때문에 40큐까지 인라인,
   그보다 많으면 payload_source:'drive' 로만 보내고 노트북이 카드 payload(production)에서 읽는다. */
const RENDER_MAX_CUES = 400;
const RENDER_MAX_CUE_TEXT = 200;
const RENDER_CUES_INLINE = 40;
const RENDER_MAX_PAYLOAD_CHARS = 3800;
const RENDER_SUB_STYLES = ['auto', 'shorts', 'long'];
const RENDER_VOICE_RE = /^[a-z]{2}-[A-Z]{2}-[A-Za-z]+Neural$/;

/** 자막·내레이션 큐 검사 → 큐 payload 용 짧은 모양([start,end,text] · 내레이션은 [start,end,text,tone]). */
function hubRenderCues_(raw, label, withTone) {
  if (raw === undefined || raw === null || raw === '') return [];
  const bad = function (msg) { return createAppError_('ERR_VALIDATION_FAILED', msg); };
  if (!Array.isArray(raw)) throw bad(label + ' 는 큐 목록(배열)이어야 합니다.');
  if (raw.length > RENDER_MAX_CUES) throw bad(label + ' 는 ' + RENDER_MAX_CUES + '큐까지입니다(지금 ' + raw.length + '큐).');
  const r2 = function (n) { return Math.round(n * 100) / 100; };
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    let start, end, text, tone = null;
    if (Array.isArray(c)) { start = Number(c[0]); end = Number(c[1]); text = String(c[2] == null ? '' : c[2]); tone = c[3] == null ? null : String(c[3]); }
    else if (c && typeof c === 'object') { start = Number(c.start); end = Number(c.end); text = String(c.text == null ? '' : c.text); tone = c.tone == null ? null : String(c.tone); }
    else throw bad(label + '[' + i + '] 모양이 올바르지 않습니다.');
    if (!isFinite(start) || !isFinite(end) || start < 0 || end <= start) throw bad(label + '[' + i + '] 의 시작·끝(초)이 올바르지 않습니다.');
    const t = text.replace(/\s+/g, ' ').trim();
    if (!t) throw bad(label + '[' + i + '] 의 문장이 비어 있습니다.');
    if (t.length > RENDER_MAX_CUE_TEXT) throw bad(label + '[' + i + '] 의 문장이 너무 깁니다(' + RENDER_MAX_CUE_TEXT + '자까지).');
    if (withTone) {
      if (tone !== null && tone !== '' && ['hype', 'calm'].indexOf(tone) === -1) throw bad(label + '[' + i + '] 의 톤은 hype · calm 중 하나여야 합니다.');
      out.push([r2(start), r2(end), t].concat(tone ? [tone] : []));
    } else out.push([r2(start), r2(end), t]);
  }
  return out;
}

function isRealRenderOrder_(type, payload) {
  return type === 'content_render' && !!payload && Array.isArray(payload.inputs);
}

/** 렌더 오더 payload 를 검사해 큐에 보낼 모양(고정 키 5개 이하)으로 돌려준다. 어긋나면 ERR_VALIDATION_FAILED. */
function hubRenderPayload_(payload) {
  const bad = function (msg) { return createAppError_('ERR_VALIDATION_FAILED', msg); };
  const contentId = String(payload.content_id || '');
  if (!RENDER_CONTENT_ID_RE.test(contentId)) throw bad('content_id 는 영문·숫자·_·- 40자 이내여야 합니다.');
  const brand = String(payload.brand || '');
  if (RENDER_BRANDS.indexOf(brand) === -1) throw bad('brand 가 올바르지 않습니다.');
  const inputs = payload.inputs;
  if (!inputs.length || inputs.length > RENDER_MAX_INPUTS) throw bad('inputs 는 1~' + RENDER_MAX_INPUTS + '개여야 합니다.');
  const names = [];
  for (let i = 0; i < inputs.length; i++) {
    const n = inputs[i];
    if (typeof n !== 'string' || !RENDER_FILE_RE.test(n) || n.indexOf('..') !== -1 || n.charAt(0) === '.' || !RENDER_EXT_RE.test(n)) {
      throw bad('inputs 에는 파일 이름(mp4·mov·m4v)만 넣을 수 있습니다: ' + String(n).slice(0, 40));
    }
    if (names.indexOf(n) === -1) names.push(n);
  }
  const profile = payload.profile === undefined || payload.profile === null || payload.profile === '' ? 'captions' : String(payload.profile);
  if (RENDER_PROFILES.indexOf(profile) === -1) throw bad('profile 은 captions 또는 bgm 이어야 합니다.');
  const out = { content_id: contentId, brand: brand, inputs: names, profile: profile };
  if (payload.fit !== undefined && payload.fit !== null && payload.fit !== '') {
    const fit = String(payload.fit).trim().toLowerCase();
    if (RENDER_FITS.indexOf(fit) === -1) throw bad('fit 은 crop · blur · pad 중 하나여야 합니다.');
    out.fit = fit;
  }
  if (payload.crop_x !== undefined && payload.crop_x !== null && payload.crop_x !== '') {
    const c = Number(payload.crop_x);
    if (!isFinite(c) || c < 0 || c > 1) throw bad('crop_x 는 0~1 사이 숫자여야 합니다.');
    out.crop_x = c;
  }
  const cuts = hubRenderCuts_(payload.cuts, names.length);
  if (cuts.length) out.cuts = cuts;
  // ── 완제품 옵션 — 자막 번인·내레이션(2026-11-20) ──
  const captions = hubRenderCues_(payload.captions, 'captions', false);
  const narration = hubRenderCues_(payload.narration, 'narration', true);
  let source = 'inline';
  if (payload.payload_source !== undefined && payload.payload_source !== null && payload.payload_source !== '') {
    source = String(payload.payload_source).trim().toLowerCase();
    if (['inline', 'drive'].indexOf(source) === -1) throw bad('payload_source 는 inline · drive 중 하나여야 합니다.');
  }
  let subStyle = 'auto';
  if (payload.sub_style !== undefined && payload.sub_style !== null && payload.sub_style !== '') {
    subStyle = String(payload.sub_style).trim().toLowerCase();
    if (RENDER_SUB_STYLES.indexOf(subStyle) === -1) throw bad('sub_style 은 ' + RENDER_SUB_STYLES.join(' · ') + ' 중 하나여야 합니다.');
  }
  if (payload.narrate !== undefined && payload.narrate !== null && payload.narrate !== '' && typeof payload.narrate !== 'boolean') throw bad('narrate 는 true·false 여야 합니다.');
  if (payload.voice !== undefined && payload.voice !== null && payload.voice !== '') {
    if (!RENDER_VOICE_RE.test(String(payload.voice))) throw bad('voice 는 edge-tts 보이스 이름(예: ko-KR-SunHiNeural)이어야 합니다.');
    out.voice = String(payload.voice);
  }
  if (payload.burn_subtitles !== undefined && payload.burn_subtitles !== null && payload.burn_subtitles !== '' && typeof payload.burn_subtitles !== 'boolean') throw bad('burn_subtitles 는 true·false 여야 합니다.');
  if (payload.burn_subtitles === false) out.burn_subtitles = false;
  if (payload.narrate === true) out.narrate = true;
  if (source === 'inline' && captions.length + narration.length > RENDER_CUES_INLINE) source = 'drive';
  if (source === 'drive') out.payload_source = 'drive';
  else {
    if (captions.length) out.captions = captions;
    if (narration.length) out.narration = narration;
  }
  if (out.burn_subtitles !== false && (captions.length || narration.length || source === 'drive') && subStyle !== 'auto') out.sub_style = subStyle;
  if (JSON.stringify(out).length > RENDER_MAX_PAYLOAD_CHARS) {
    // 큐 payload 한도 — 문장을 자르지 않고 카드에서 읽게 한다.
    delete out.captions;
    delete out.narration;
    out.payload_source = 'drive';
  }
  return out;
}

/**
 * 잘라낼 구간(초) 검사 → 큐 payload 용 짧은 모양으로. 큐 payload 가 4000자까지라 구간 하나를 [from,to] 또는 [from,to,파일번호] 로 줄인다.
 * 받는 모양은 [from,to,(파일번호)] 또는 { from, to, file }. 영상이 둘 이상이면 파일번호(inputs 순서, 0부터)가 꼭 필요하다.
 */
const RENDER_MAX_CUTS = 150;
const RENDER_MAX_CUT_SPAN_S = 3600;
function hubRenderCuts_(raw, inputCount) {
  if (raw === undefined || raw === null || raw === '') return [];
  const bad = function (msg) { return createAppError_('ERR_VALIDATION_FAILED', msg); };
  if (!Array.isArray(raw)) throw bad('cuts 는 구간 목록(배열)이어야 합니다.');
  if (raw.length > RENDER_MAX_CUTS) throw bad('cuts 는 ' + RENDER_MAX_CUTS + '개까지입니다(지금 ' + raw.length + '개).');
  const r2 = function (n) { return Math.round(n * 100) / 100; };
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    let from, to, file;
    if (Array.isArray(c)) { from = Number(c[0]); to = Number(c[1]); file = c.length > 2 && c[2] !== null && c[2] !== undefined ? Number(c[2]) : null; }
    else if (c && typeof c === 'object') { from = Number(c.from); to = Number(c.to); file = c.file !== undefined && c.file !== null ? Number(c.file) : null; }
    else throw bad('cuts[' + i + '] 모양이 올바르지 않습니다.');
    if (!isFinite(from) || !isFinite(to) || from < 0 || to <= from) throw bad('cuts[' + i + '] 의 from·to 는 0 이상이고 to 가 from 보다 커야 합니다(초).');
    if (to - from > RENDER_MAX_CUT_SPAN_S) throw bad('cuts[' + i + '] 구간이 너무 깁니다(최대 ' + RENDER_MAX_CUT_SPAN_S + '초).');
    if (file === null) {
      if (inputCount !== 1) throw bad('cuts[' + i + '] 에 어느 영상인지(파일 번호)가 필요합니다. 영상이 여러 개입니다.');
      out.push([r2(from), r2(to)]);
    } else {
      if (Math.floor(file) !== file || file < 0 || file >= inputCount) throw bad('cuts[' + i + '] 의 파일 번호가 올바르지 않습니다.');
      out.push([r2(from), r2(to), file]);
    }
    if (out[out.length - 1][1] <= out[out.length - 1][0]) throw bad('cuts[' + i + '] 구간이 반올림 뒤 0초가 됩니다(0.01초 이상으로).');
  }
  return out;
}

/** 큐 응답(JSON)에서 사람이 볼 값만 꺼낸다. */
function hubOrderResult_(json, type, workspace, prompt, queueType, cutCount, cueCounts) {
  const item = (json && json.item) || {};
  const id = String(item.id || (json && json.order_id) || '');
  const cues = cueCounts || {};
  return {
    order_id: id,
    status: String(item.status || (json && json.status) || ''),
    type: type,
    queue_type: queueType || 'claude_prompt',
    workspace: workspace,
    prompt_chars: prompt ? prompt.length : 0,
    note: String((json && json.note) || (item && item.note) || ''),
    duplicate: !!(json && json.duplicate),
    needs_approval: !!((json && json.needs_approval) || (item && item.needs_approval)),
    risk_level: String((json && json.risk_level) || (item && item.risk_level) || ''),
    cuts: (typeof cutCount === 'number') ? cutCount : undefined,
    captions: (typeof cues.captions === 'number') ? cues.captions : undefined,
    narration: (typeof cues.narration === 'number') ? cues.narration : undefined,
    approval_expires_at: String((json && json.approval_expires_at) || (item && item.approval_expires_at) || '')
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

  const realRender = isRealRenderOrder_(type, payload);
  let prompt = '';
  let body;
  if (realRender) {
    // 검증 실패는 큐를 부르기 전에 끝낸다(설정 검사 뒤라도 외부 호출은 하지 않는다).
    body = {
      key: token,
      action: 'queue_enqueue',
      type: 'content_render',
      workspace: workspace,
      payload: hubRenderPayload_(payload)
    };
  } else {
    prompt = hubOrderPrompt_(type, payload);
    body = {
      key: token,
      action: 'queue_enqueue',
      type: 'claude_prompt',
      workspace: workspace,
      payload: { prompt: prompt, mode: 'edit', engine: engine }
    };
  }

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
    // 큐(Apps Script)가 아직 content_render 를 모르는 동안: 옛 동작으로 되돌리지 않고 분명히 알린다.
    // (포털 오더함 큐는 code 'type' + "보낼 수 없는 오더" 로, 노트북 큐는 ERR_UNKNOWN_TYPE 으로 거절한다 — 둘 다 같은 안내)
    if (realRender && (code === 'ERR_UNKNOWN_TYPE' || code === 'type' || /ERR_UNKNOWN_TYPE|허용되지 않은 작업 타입|보낼 수 없는 오더/.test(msg))) {
      throw createAppError_('ERR_QUEUE_TYPE_UNKNOWN',
        '노트북 큐가 아직 영상 렌더(content_render)를 모릅니다. 큐 Apps Script 를 새 버전으로 배포한 뒤 다시 보내 주세요(오더는 만들어지지 않았습니다).',
        { queue_code: code || 'ERR_UNKNOWN_TYPE' });
    }
    const hint = /unauthorized/i.test(msg) ? ' — QUEUE_TOKEN 이 그 웹앱의 키와 다릅니다'
      : (code === 'workspace' ? ' — QUEUE_WORKSPACE 값이 큐의 허용 목록에 없습니다'
      : (code === 'too_long' || code === 'bad_request' ? ' — 오더 내용을 줄여 주세요' : ''));
    throw createAppError_('ERR_QUEUE_REJECTED', '큐가 오더를 받지 않았습니다: ' + msg + hint,
      { queue_code: code });
  }

  const out = hubOrderResult_(json, type, workspace, prompt, realRender ? 'content_render' : 'claude_prompt',
    realRender ? (body.payload.cuts ? body.payload.cuts.length : 0) : undefined,
    realRender ? { captions: (body.payload.captions || []).length, narration: (body.payload.narration || []).length } : undefined);
  appendSystemHealth_({
    eventType: 'HUB_ORDER', status: 'SUCCESS', actor: 'api',
    detail: type + ' → ' + (out.order_id || '(id 없음)') + ' · ' + workspace
  });
  return out;
}

/* ------------------------------------------------------------------ *
 * 오더 진행 상태 — hub_order 로 보낸 오더가 지금 어디까지 갔는지(읽기 전용)
 *
 *   · 큐 웹앱의 queue_list(최근 20건, 읽기)만 부르고 그 안에서 order_id 한 건만 골라 돌려준다.
 *   · 오더를 만들거나 바꾸지 않는다. 큐 토큰은 요청 본문으로만 가고 응답에는 없다.
 *   · result 는 큐가 200자로 자른 값이라 검수표(PASS/WARN/FAIL)를 만들 수 없다 — 그건 report.json 을 붙여 넣는다.
 *   · 최근 20건 밖으로 밀려난 오더는 ERR_NOT_FOUND (화면은 '목록에서 사라짐'으로 안내).
 * ------------------------------------------------------------------ */
const HUB_ORDER_ID_RE = /^Q-\d{8}-\d{6}-[a-z0-9]{4}$/;
const HUB_STATUS_LIST_LIMIT = 20;   // 포털 queue_list 의 상한(QQ_LIST_MAX)

function handleHubOrderStatus_(ss, payload) {
  const orderId = String((payload && payload.order_id) || '').trim();
  if (!HUB_ORDER_ID_RE.test(orderId)) {
    throw createAppError_('ERR_VALIDATION_FAILED', 'order_id 형식이 올바르지 않습니다(예: Q-20261119-210000-ab12).');
  }
  const props = PropertiesService.getScriptProperties();
  const url = String(props.getProperty('QUEUE_EXEC_URL') || '').trim();
  const token = String(props.getProperty('QUEUE_TOKEN') || '').trim();
  if (!url || !/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url)) {
    throw createAppError_('ERR_SERVER_CONFIG', 'QUEUE_EXEC_URL 이 없거나 형식이 다릅니다. 스크립트 속성에 큐 웹앱 /exec 주소를 넣어 주세요.');
  }
  if (!token) {
    throw createAppError_('ERR_SERVER_CONFIG', 'QUEUE_TOKEN 이 없습니다. 스크립트 속성에 큐 키를 넣어 주세요(브라우저에는 내려가지 않습니다).');
  }

  let res, text;
  try {
    res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'text/plain;charset=utf-8',
      payload: JSON.stringify({ key: token, action: 'queue_list', limit: HUB_STATUS_LIST_LIMIT }),
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
      { status: (res && res.getResponseCode && res.getResponseCode()) || 0 });
  }
  if (!json.ok) {
    const e = (json.error && typeof json.error === 'object') ? json.error : {};
    const msg = e.message || (typeof json.error === 'string' ? json.error : '') || '큐가 거절';
    throw createAppError_('ERR_QUEUE_REJECTED', '큐가 상태 조회를 받지 않았습니다: ' + msg,
      { queue_code: String(e.code || json.code || '') });
  }

  const items = Array.isArray(json.items) ? json.items : [];
  let hit = null;
  for (let i = 0; i < items.length; i++) {
    if (items[i] && String(items[i].id) === orderId) { hit = items[i]; break; }
  }
  if (!hit) {
    throw createAppError_('ERR_NOT_FOUND', '최근 오더 ' + HUB_STATUS_LIST_LIMIT + '건 안에 이 오더가 없습니다(목록에서 밀려났거나 id 가 다릅니다).',
      { order_id: orderId });
  }
  const clip = function (v, n) { return String(v == null ? '' : v).slice(0, n); };
  return {
    order_id: orderId,
    status: clip(hit.status, 30).toUpperCase(),
    type: clip(hit.type, 40),
    risk_level: clip(hit.risk_level, 10).toUpperCase(),
    created_at: clip(hit.created_at, 40),
    started_at: clip(hit.started_at, 40),
    beat_at: clip(hit.beat_at, 40),
    finished_at: clip(hit.finished_at, 40),
    approval_expires_at: clip(hit.approval_expires_at, 40),
    result: clip(hit.result, 300),
    error: clip(hit.error, 300)
  };
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
