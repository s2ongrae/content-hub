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
const HUB_ORDER_TYPES = ['content_render', 'content_upload', 'content_stats', 'blog_neighbor', 'content_draft', 'product_extract'];

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
    case 'content_draft':
      return '이 카드의 재료(사진·장소·메모)로 블로그 초안(제목 3안·문단 사이 연결·빈 사진 캡션·마무리) 또는 영상 대본·자막 큐를 만든다. '
        + 'USER 블록(사용자가 쓴 문단)은 한 글자도 고치지 않고 사이에만 넣는다. 결과는 update_content 로 카드 payload 에만 쓰고, 파일은 고치지 않는다.';
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
const RENDER_CONTENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;   // 첫 글자는 영문·숫자(포털 큐·노트북과 같은 규칙)
const RENDER_FILE_RE = /^[A-Za-z0-9가-힣._ -]{1,80}$/;
const RENDER_EXT_RE = /\.(mp4|mov|m4v)$/i;
/* 사진 입력(2026-11-21, O2a/O2b): 영상 8개 상한과 별개로 25장까지 받는다.
   60초 영상 15장·블로그 22장을 채우려면 8로는 모자라다(설계 §11-1). */
const RENDER_IMAGE_EXT_RE = /\.(jpe?g|png|webp)$/i;
const RENDER_MAX_IMAGES = 25;
const RENDER_PROFILES = ['captions', 'bgm'];
const RENDER_BRANDS = ['daejeon_youth', 'ppiyak_kimmary'];
const RENDER_FITS = ['crop', 'blur', 'pad'];   // 프레이밍 — 비우면 노트북이 원본 방향으로 정한다
// 자동 줌·모션(2026-11-21) — 노트북 lib/motion.js PRESET_IDS · 허브 js/produceLogic.js MOTION_IDS 와 같은 값.
//   motion 은 'auto'(기본 · 오늘 오더도 모션이 붙는다) · dynamic · calm · none. none 이면 예전과 완전 동일.
const RENDER_MOTIONS = ['auto', 'dynamic', 'calm', 'none'];
/* 템포 프리셋(2026-11-23) — 노트북 lib/pace.js · 허브 js/produceLogic.js PACE_IDS 와 같은 값. */
const RENDER_PACES = ['calm', 'standard', 'fast'];
/* 자막 배열 4번째 = 스토리 비트(2026-11-23) — 노트북 lib/story.js 와 같은 값. */
const RENDER_BEATS = ['hook', 'info', 'build', 'climax', 'payoff'];
const RENDER_MOTION_QUALITY = ['standard', 'high'];   // standard = linear(≤1.15배) / high = cubic 강제
const RENDER_MAX_INPUTS = 8;
/* 완제품(2026-11-20): 자막 번인·내레이션. 큐 payload 4,000자 때문에 40큐까지 인라인,
   그보다 많으면 payload_source:'drive' 로만 보내고 노트북이 카드 payload(production)에서 읽는다. */
const RENDER_MAX_CUES = 400;
const RENDER_MAX_CUE_TEXT = 200;
const RENDER_CUES_INLINE = 40;
const RENDER_MAX_PAYLOAD_CHARS = 3500;   // 큐 4,000자 한도 — 넘으면 payload_source:'drive' 로 바꿔 보낸다(설계 §7.2)
const RENDER_SUB_STYLES = ['auto', 'shorts', 'long'];
/* 채널 시그니처 템플릿(2026-11-21) — 허브 js/videoTemplate.js · 노트북 lib/template.js 와 같은 값. */
const RENDER_TEMPLATES = ['auto', 'none', 'daejeon_youth', 'ppiyak_kimmary'];
const RENDER_TEMPLATE_TEXT = { title: 40, badge: 14, hook: 16, hook_sub: 6, outro: 24 };
const RENDER_VOICE_RE = /^[a-z]{2}-[A-Z]{2}-[A-Za-z]+Neural$/;
/* 내 육성 녹음(2026-11-23) — 노트북 lib/render.js validate · 포털 Code.gs qqRenderVoiceOf_ 와 같은 값.
   ⚠ 위 RENDER_VOICE_RE 는 **edge-tts 보이스 이름**이다 — 육성 파일은 voice_file 로 이름을 분리한다(같은 칸을 쓰면 TTS 가 깨진다). */
const RENDER_VOICE_MODES = ['tts', 'human'];
const RENDER_VOICE_FILE_RE = /^[A-Za-z0-9가-힣][A-Za-z0-9가-힣._ -]{0,79}\.(mp3|m4a|wav)$/i;
const RENDER_VOICE_OFFSET_MS = 3000;

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
    } else {
      // 자막 4번째는 스토리 비트 — 모르는 값은 버리고 문장만 보낸다(예전 허브 호환).
      const beat = tone !== null && tone !== '' && RENDER_BEATS.indexOf(String(tone)) !== -1 ? String(tone) : '';
      out.push([r2(start), r2(end), t].concat(beat ? [beat] : []));
    }
  }
  return out;
}

const RENDER_STAGES = ['transcribe', 'finish'];
const RENDER_BGM_RE = /^[A-Za-z0-9가-힣][A-Za-z0-9가-힣._ -]{0,79}\.(mp3|wav|m4a|aac)$/i;
/* 뮤직비디오 모드(2026-11-21, Phase 1) — 사진 + 내 음원/보관 BGM + 가사 + 비트 컷.
   허브 js/studioLogic.js · 노트북 lib/mv.js 와 같은 값이다. */
const RENDER_MV_DENSITIES = ['fast_2beat', 'normal_4beat', 'slow_1bar'];
const RENDER_MV_EFFECTS = ['pulse', 'none'];
const RENDER_MV_MOODS = ['pop', 'ballad', 'comic', 'rock'];
const RENDER_MV_LYRIC_MODES = ['mine', 'none'];
const RENDER_MV_MIN_IMAGES = 3;
const RENDER_MV_MAX_LYRICS = 2000;
const RENDER_MV_AUDIO_RE = /^[A-Za-z0-9가-힣][A-Za-z0-9가-힣._ -]{0,79}\.(mp3|m4a|wav)$/i;

function isRealRenderOrder_(type, payload) {
  if (type !== 'content_render' || !payload) return false;
  // stage 가 적혀 있으면(모르는 값이어도) 진짜 렌더 경로로 보내 검증에서 거절한다 — 옛 claude_prompt 경로로 새지 않게
  // 사진만 있는 오더(images)도 진짜 렌더다 — inputs 가 없어도 claude_prompt 로 보내면 안 된다.
  //  images 키가 **있기만 해도**(배열이 아니어도) 렌더 경로로 보내 검증에서 거절한다 — 조용히 옛 길로 새지 않게.
  //  mode:'mv'(뮤직비디오)도 렌더다 — 모르는 mode 값도 같이 보내 거절한다.
  const mode = String(payload.mode || '').trim();
  return Array.isArray(payload.inputs) || payload.images !== undefined || String(payload.stage || '') !== '' || mode !== '';
}

/** 사진 파일 이름 목록 — 영상과 별개. 중복은 버리고 순서는 보존한다. */
function hubRenderImages_(raw) {
  if (raw === undefined || raw === null || raw === '') return [];
  const bad = function (msg) { return createAppError_('ERR_VALIDATION_FAILED', msg); };
  if (!Array.isArray(raw)) throw bad('images 는 파일 이름 목록(배열)이어야 합니다.');
  if (raw.length > RENDER_MAX_IMAGES) throw bad('images 는 ' + RENDER_MAX_IMAGES + '장까지입니다(지금 ' + raw.length + '장).');
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const n = raw[i];
    if (typeof n !== 'string' || !RENDER_FILE_RE.test(n) || n.indexOf('..') !== -1 || n.charAt(0) === '.' || !RENDER_IMAGE_EXT_RE.test(n)) {
      throw bad('images 에는 사진 파일 이름(jpg·jpeg·png·webp)만 넣을 수 있습니다: ' + String(n).slice(0, 40));
    }
    if (out.indexOf(n) === -1) out.push(n);
  }
  if (raw.length && !out.length) throw bad('images 가 비었습니다.');
  return out;
}

/**
 * 뮤직비디오 모드 payload(2026-11-21, Phase 1) — 사진 + 음원 이름 + 가사 + 컷 밀도.
 *
 *  계약(허브 js/createStudio.js · 노트북 lib/mv.js 와 같은 모양)
 *   { content_id, brand, profile:'captions', mode:'mv', images:[…], mv:{ audio, density, bpm_hint, lyrics, effects, mood, length_sec, lyric_mode } }
 *  · 유료 API 없음 — 음원은 _bgm 보관함(내 파일·무료 BGM) 이름만 실린다. 곡 파일 자체는 큐로 오지 않는다.
 *  · 가사가 길면 큐 4,000자 한도에 걸리므로 그때만 lyrics 를 빼고 payload_source:'drive' 로 보낸다
 *    (노트북이 카드 payload 의 studio.formats.video.mv 에서 읽는다 — 새 경로 없음).
 */
function hubRenderMvPayload_(payload, contentId, brand) {
  const bad = function (msg) { return createAppError_('ERR_VALIDATION_FAILED', msg); };
  const images = hubRenderImages_(payload.images);
  if (images.length < RENDER_MV_MIN_IMAGES) {
    throw bad('뮤직비디오는 사진이 ' + RENDER_MV_MIN_IMAGES + '장 이상 필요합니다(지금 ' + images.length + '장).');
  }
  // Phase 1 은 사진만 — 영상 컷을 섬는 것은 다음 단계다(모르는 입력을 조용히 버리지 않고 알린다).
  if (payload.inputs !== undefined && payload.inputs !== null && payload.inputs !== '' && Array.isArray(payload.inputs) && payload.inputs.length) {
    throw bad('뮤직비디오 모드는 지금 사진만 씁니다 — 영상은 [일반 영상]으로 렌더하세요.');
  }
  const mvIn = payload.mv && typeof payload.mv === 'object' ? payload.mv : {};
  const audio = String(mvIn.audio || '').trim();
  if (!RENDER_MV_AUDIO_RE.test(audio) || audio.indexOf('..') !== -1 || audio.charAt(0) === '.') {
    throw bad('mv.audio 는 보관함의 음원 파일 이름(mp3·m4a·wav, 폴더·경로 금지)이어야 합니다.');
  }
  const density = mvIn.density === undefined || mvIn.density === null || mvIn.density === '' ? 'normal_4beat' : String(mvIn.density).trim().toLowerCase();
  if (RENDER_MV_DENSITIES.indexOf(density) === -1) throw bad('mv.density 는 ' + RENDER_MV_DENSITIES.join(' · ') + ' 중 하나여야 합니다.');
  const effects = mvIn.effects === undefined || mvIn.effects === null || mvIn.effects === '' ? 'pulse' : String(mvIn.effects).trim().toLowerCase();
  if (RENDER_MV_EFFECTS.indexOf(effects) === -1) throw bad('mv.effects 는 ' + RENDER_MV_EFFECTS.join(' · ') + ' 중 하나여야 합니다.');
  const mood = mvIn.mood === undefined || mvIn.mood === null || mvIn.mood === '' ? 'pop' : String(mvIn.mood).trim().toLowerCase();
  if (RENDER_MV_MOODS.indexOf(mood) === -1) throw bad('mv.mood 는 ' + RENDER_MV_MOODS.join(' · ') + ' 중 하나여야 합니다.');
  let lyricMode = mvIn.lyric_mode === undefined || mvIn.lyric_mode === null || mvIn.lyric_mode === '' ? 'mine' : String(mvIn.lyric_mode).trim().toLowerCase();
  if (RENDER_MV_LYRIC_MODES.indexOf(lyricMode) === -1) throw bad('mv.lyric_mode 는 ' + RENDER_MV_LYRIC_MODES.join(' · ') + ' 중 하나여야 합니다.');
  let bpmHint = 0;
  if (mvIn.bpm_hint !== undefined && mvIn.bpm_hint !== null && mvIn.bpm_hint !== '') {
    bpmHint = Number(mvIn.bpm_hint);
    if (!isFinite(bpmHint) || bpmHint < 0 || bpmHint > 300) throw bad('mv.bpm_hint 는 0~300 사이 숫자여야 합니다(0=자동).');
    bpmHint = Math.round(bpmHint * 10) / 10;
  }
  let lengthSec = 0;
  if (mvIn.length_sec !== undefined && mvIn.length_sec !== null && mvIn.length_sec !== '') {
    lengthSec = Number(mvIn.length_sec);
    if (!isFinite(lengthSec) || lengthSec < 0 || lengthSec > 600) throw bad('mv.length_sec 는 0~600초여야 합니다(0=곡 끝까지).');
    lengthSec = Math.round(lengthSec);
  }
  let lyrics = String(mvIn.lyrics === undefined || mvIn.lyrics === null ? '' : mvIn.lyrics).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
  if (lyricMode === 'none') lyrics = '';
  if (lyrics.length > 8000) throw bad('가사가 너무 깁니다(8,000자까지).');
  const mv = { audio: audio, density: density, bpm_hint: bpmHint, effects: effects, mood: mood, length_sec: lengthSec, lyric_mode: lyricMode, lines: lyrics ? lyrics.split('\n').filter(function (s) { return s.trim(); }).length : 0 };
  if (lyrics.length <= RENDER_MV_MAX_LYRICS) mv.lyrics = lyrics;
  const out = { content_id: contentId, brand: brand, profile: 'captions', mode: 'mv', images: images, mv: mv };
  if (lyrics.length > RENDER_MV_MAX_LYRICS) out.payload_source = 'drive';
  if (JSON.stringify(out).length > RENDER_MAX_PAYLOAD_CHARS) {
    delete out.mv.lyrics;
    out.payload_source = 'drive';
  }
  return out;
}

/** 렌더 오더 payload 를 검사해 큐에 보낼 모양(고정 키 5개 이하)으로 돌려준다. 어긋나면 ERR_VALIDATION_FAILED. */
function hubRenderPayload_(payload) {
  const bad = function (msg) { return createAppError_('ERR_VALIDATION_FAILED', msg); };
  const contentId = String(payload.content_id || '');
  if (!RENDER_CONTENT_ID_RE.test(contentId)) throw bad('content_id 는 영문·숫자·_·- 40자 이내여야 합니다.');
  const brand = String(payload.brand || '');
  if (RENDER_BRANDS.indexOf(brand) === -1) throw bad('brand 가 올바르지 않습니다.');
  // 뮤직비디오 모드(2026-11-21) — 일반 영상과 계약이 다르므로 앞에서 따로 검사한다.
  const mode = String(payload.mode || '').trim().toLowerCase();
  if (mode) {
    if (mode !== 'mv') throw bad('mode 는 mv 하나입니다(일반 영상은 비워 두세요).');
    return hubRenderMvPayload_(payload, contentId, brand);
  }
  // 2·3단계(자막 초안·마무리)는 클린 마스터를 이어받으므로 원본 이름이 없다 — 옵션만 통과시킨다(모르는 필드는 버린다)
  const stage = String(payload.stage || '');
  if (stage) {
    if (RENDER_STAGES.indexOf(stage) === -1) throw bad('stage 는 transcribe 또는 finish 여야 합니다.');
    const so = { content_id: contentId, brand: brand, stage: stage };
    if (stage === 'finish') {
      so.burn = payload.burn === undefined ? true : payload.burn === true;
      so.ai_notice = payload.ai_notice === true;
      if (payload.bgm !== undefined && payload.bgm !== null && payload.bgm !== '') {
        const b = payload.bgm && typeof payload.bgm === 'object' ? payload.bgm : {};
        const bn = String(b.name || '');
        if (!RENDER_BGM_RE.test(bn) || bn.indexOf('..') !== -1) throw bad('bgm.name 은 BGM 파일 이름(mp3·wav·m4a·aac)만 넣을 수 있습니다.');
        so.bgm = { name: bn };
        if (b.volume_db !== undefined && b.volume_db !== null && b.volume_db !== '') {
          const vv = Number(b.volume_db);
          if (!isFinite(vv) || vv < -40 || vv > 0) throw bad('bgm.volume_db 는 -40~0 사이 숫자여야 합니다.');
          so.bgm.volume_db = vv;
        }
      }
      if (payload.cover !== undefined && payload.cover !== null && payload.cover !== '') {
        const ct = Number(payload.cover && payload.cover.t);
        if (!isFinite(ct) || ct < 0 || ct > 3600) throw bad('cover.t 는 0~3600 사이 초 단위 숫자여야 합니다.');
        so.cover = { t: Math.round(ct * 100) / 100 };
      }
    }
    return so;
  }
  const inputs = payload.inputs;
  const images = hubRenderImages_(payload.images);
  if (!inputs && !images.length) throw bad('inputs(영상 1~' + RENDER_MAX_INPUTS + '개) 또는 images(사진 1~' + RENDER_MAX_IMAGES + '장)가 필요합니다.');
  if (inputs && (!inputs.length || inputs.length > RENDER_MAX_INPUTS)) throw bad('inputs 는 1~' + RENDER_MAX_INPUTS + '개여야 합니다.');
  const names = [];
  if (inputs) {
    for (let i = 0; i < inputs.length; i++) {
      const n = inputs[i];
      if (typeof n !== 'string' || !RENDER_FILE_RE.test(n) || n.indexOf('..') !== -1 || n.charAt(0) === '.' || !RENDER_EXT_RE.test(n)) {
        throw bad('inputs 에는 파일 이름(mp4·mov·m4v)만 넣을 수 있습니다: ' + String(n).slice(0, 40));
      }
      if (names.indexOf(n) === -1) names.push(n);
    }
  }
  // 사진과 영상에 같은 이름이 두 번 오면 거절한다(서로 다른 파일이 같은 자리에 풍기는 것 방지)
  images.forEach(function (n) { if (names.indexOf(n) !== -1) throw bad('같은 파일이 영상·사진 양쪽에 있습니다: ' + n); });
  const profile = payload.profile === undefined || payload.profile === null || payload.profile === '' ? 'captions' : String(payload.profile);
  if (RENDER_PROFILES.indexOf(profile) === -1) throw bad('profile 은 captions 또는 bgm 이어야 합니다.');
  const out = { content_id: contentId, brand: brand, profile: profile };
  if (names.length) out.inputs = names;
  if (images.length) out.images = images;
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
  // 자동 줌·모션 — 이 함수가 payload 를 고정 키로 다시 만들기 때문에 여기서 싣지 않으면 선택이 조용히 사라진다.
  if (payload.motion !== undefined && payload.motion !== null && payload.motion !== '') {
    const mo = String(payload.motion).trim().toLowerCase();
    if (RENDER_MOTIONS.indexOf(mo) === -1) throw bad('motion 은 ' + RENDER_MOTIONS.join(' · ') + ' 중 하나여야 합니다.');
    out.motion = mo;
  }
  if (payload.motion_quality !== undefined && payload.motion_quality !== null && payload.motion_quality !== '') {
    const mq = String(payload.motion_quality).trim().toLowerCase();
    if (RENDER_MOTION_QUALITY.indexOf(mq) === -1) throw bad('motion_quality 는 ' + RENDER_MOTION_QUALITY.join(' · ') + ' 중 하나여야 합니다.');
    out.motion_quality = mq;
  }
  // 템포(2026-11-23) — standard 는 기본값이라 큐에 싣지 않는다(허브 produceLogic 과 같은 규칙).
  if (payload.pace !== undefined && payload.pace !== null && payload.pace !== '') {
    const pc = String(payload.pace).trim().toLowerCase();
    if (RENDER_PACES.indexOf(pc) === -1) throw bad('pace 는 ' + RENDER_PACES.join(' · ') + ' 중 하나여야 합니다.');
    if (pc !== 'standard') out.pace = pc;
  }
  const cuts = hubRenderCuts_(payload.cuts, names.length);
  if (cuts.length) out.cuts = cuts;
  // 사진 길이·전환(2026-11-21): 비우면 노트북이 자막 길이로 계산한다(장당 3.0초 이상)
  if (payload.photo_seconds !== undefined && payload.photo_seconds !== null && payload.photo_seconds !== '') {
    const v = Number(payload.photo_seconds);
    if (!isFinite(v) || v < 1 || v > 15) throw bad('photo_seconds 는 1~15초 사이 숫자여야 합니다.');
    out.photo_seconds = Math.round(v * 100) / 100;
  }
  if (payload.xfade !== undefined && payload.xfade !== null && payload.xfade !== '') {
    const v = Number(payload.xfade);
    if (!isFinite(v) || v < 0 || v > 2) throw bad('xfade 는 0~2초 사이 숫자여야 합니다.');
    out.xfade = Math.round(v * 100) / 100;
  }
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
  // ── 내 육성 녹음(2026-11-23) ──
  //   이 함수가 payload 를 **고정 키로 다시 만드는** 구조라, 여기서 싣지 않으면 화면의 선택이 조용히 사라진다(컷·템플릿이 그랬다).
  //   값이 없으면 아무 키도 넣지 않는다 — 구버전 카드·오더는 지금과 100% 동일(TTS 경로).
  if (payload.voice_mode !== undefined && payload.voice_mode !== null && payload.voice_mode !== '') {
    const vm = String(payload.voice_mode).trim().toLowerCase();
    if (RENDER_VOICE_MODES.indexOf(vm) === -1) throw bad('voice_mode 는 tts · human 중 하나여야 합니다.');
    out.voice_mode = vm;
    if (vm === 'human') {
      const vf = String(payload.voice_file === undefined || payload.voice_file === null ? '' : payload.voice_file).trim();
      if (!RENDER_VOICE_FILE_RE.test(vf) || vf.indexOf('..') !== -1 || vf.indexOf('/') !== -1 || vf.indexOf('\\') !== -1) {
        throw bad('voice_file 은 녹음 파일 이름(mp3·m4a·wav, 폴더·경로 금지)이어야 합니다.');
      }
      out.voice_file = vf;
      if (payload.voice_offset_ms !== undefined && payload.voice_offset_ms !== null && payload.voice_offset_ms !== '') {
        const vo = Number(payload.voice_offset_ms);
        if (!isFinite(vo) || Math.round(vo) !== vo || Math.abs(vo) > RENDER_VOICE_OFFSET_MS) {
          throw bad('voice_offset_ms 는 -' + RENDER_VOICE_OFFSET_MS + '~' + RENDER_VOICE_OFFSET_MS + ' 사이 정수(ms)여야 합니다.');
        }
        if (vo) out.voice_offset_ms = vo;
      }
      if (payload.voice_fallback_tts !== undefined && payload.voice_fallback_tts !== null && payload.voice_fallback_tts !== '') {
        if (typeof payload.voice_fallback_tts !== 'boolean') throw bad('voice_fallback_tts 는 true·false 여야 합니다.');
        if (payload.voice_fallback_tts === true) out.voice_fallback_tts = true;
      }
    }
  }
  // ── 채널 템플릿 — template 은 'auto' 도 통과시킨다(노트북이 브랜드 기본을 고른다) ──
  if (payload.template !== undefined && payload.template !== null && payload.template !== '') {
    const tm = String(payload.template).trim().toLowerCase();
    if (RENDER_TEMPLATES.indexOf(tm) === -1) throw bad('template 은 ' + RENDER_TEMPLATES.join(' · ') + ' 중 하나여야 합니다.');
    out.template = tm;
  }
  // 오프닝 훅 위치·유지시간 — 'none'·'ppiyak_kimmary' 템플릿은 훅이 없어 조용히 버린다
  const hookOff = out.template === 'none' || out.template === 'ppiyak_kimmary';
  if (payload.hook_pos !== undefined && payload.hook_pos !== null && payload.hook_pos !== '') {
    const hp = String(payload.hook_pos).trim().toLowerCase();
    if (hp !== 'center' && hp !== 'top') throw bad('hook_pos 는 center·top 중 하나여야 합니다.');
    if (!hookOff) out.hook_pos = hp;
  }
  if (payload.hook_hold !== undefined && payload.hook_hold !== null && payload.hook_hold !== '') {
    const hh = Number(payload.hook_hold);
    if (!isFinite(hh) || hh < 1.0 || hh > 4.0) throw bad('hook_hold 는 1.0~4.0초 사이 숫자여야 합니다.');
    if (!hookOff) out.hook_hold = Math.round(hh * 10) / 10;
  }
  // 첫 프레임 잠금(2026-11-21) — 기준 사진을 0.0초 첫 프레임으로, 앞 클립 마지막 프레임을 다음 클립 첫 프레임으로.
  //   노트북 lib/framelock.js 와 같은 값. 끔(false)이면 사진·길이를 조용히 버린다(숨은 동작 없음).
  if (payload.frame_lock !== undefined && payload.frame_lock !== null && payload.frame_lock !== '') {
    if (typeof payload.frame_lock !== 'boolean') throw bad('frame_lock 은 true·false 여야 합니다.');
    if (payload.frame_lock === true) {
      out.frame_lock = true;
      const img = payload.frame_lock_image;
      if (img !== undefined && img !== null && img !== '') {
        const n = String(img);
        if (!/\.(jpe?g|png|webp)$/i.test(n) || n.indexOf('..') !== -1 || n.indexOf('/') !== -1 || n.indexOf('\\') !== -1) {
          throw bad('frame_lock_image 는 사진 파일 이름이어야 합니다(jpg·jpeg·png·webp, 폴더 금지).');
        }
        out.frame_lock_image = n;
      }
      const ls = payload.frame_lock_seconds;
      if (ls !== undefined && ls !== null && ls !== '') {
        const v = Number(ls);
        if (!isFinite(v) || v < 0.02 || v > 0.5) throw bad('frame_lock_seconds 는 0.02~0.5초 사이 숫자여야 합니다.');
        out.frame_lock_seconds = Math.round(v * 100) / 100;
      }
    }
  }
  Object.keys(RENDER_TEMPLATE_TEXT).forEach(function (k) {
    const v = payload[k];
    if (v === undefined || v === null || v === '') return;
    if (typeof v !== 'string') throw bad(k + ' 는 문자열이어야 합니다.');
    const t = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, RENDER_TEMPLATE_TEXT[k]);
    if (t) out[k] = t;
  });
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
    pace: cues.pace ? String(cues.pace) : undefined,
    approval_expires_at: String((json && json.approval_expires_at) || (item && item.approval_expires_at) || '')
  };
}

/* ------------------------------------------------------------------ *
 * content_draft — 텍스트 생성 오더(2026-11-21, O2b / 설계 §7.1)
 *
 *   왜 claude_prompt 를 재사용하지 않나: claude_prompt 는 **파일을 고치는** 오더다(편집 규칙·사후 게이트·git).
 *   블로그 초안·영상 대본은 결과를 카드 payload 에만 쓰고 파일은 하나도 안 건드린다 — 위험도 LOW·자동승인.
 *   (content_render 는 그대로 HIGH 유지 — 큰 파일과 CPU 를 오래 쓴다)
 *
 *   요청: { type:'content_draft', content_id, brand, format:'blog'|'video', concept:{kind,tone,hint},
 *           facts:{…}, memo_sha256, blocks:[{id,origin:'USER',text,sha256}], media:[{name,role}],
 *           ask:{titles:3,bridge,captions,outro}, payload_source:'inline'|'drive' }
 *   허브에서 먼저 막는 것(1중): ① block.sha256 이 그 문단과 같은가 ② memo_sha256 이 블록 전체와 같은가
 *   노트북이 두 번째(사이에만 삽입) · 저장 전 세 번째(USER 블록 재해시 불일치면 폐기·재시도).
 * ------------------------------------------------------------------ */
const DRAFT_FORMATS = ['blog', 'video'];
const DRAFT_KINDS = ['review', 'story', 'info'];
const DRAFT_TONES = ['plain', 'hype', 'chungcheong'];
const DRAFT_MAX_MEDIA = 25;
const DRAFT_MAX_BLOCKS = 60;
const DRAFT_MAX_BLOCK_TEXT = 4000;
const DRAFT_MAX_HINT = 200;
const DRAFT_MAX_FACT = 400;
const DRAFT_LENGTHS = [15, 30, 60];
const DRAFT_FACT_KEYS = ['place_name', 'region_dong', 'category', 'hours', 'closed_days', 'parking',
  'wait_time', 'price_menu', 'tel', 'address', 'naver_place_url'];
const DRAFT_ALLOWED_KEYS = ['type', 'content_id', 'brand', 'format', 'concept', 'facts', 'memo_sha256',
  'blocks', 'media', 'ask', 'payload_source', 'length_sec', 'user_body_sha256'];
const REPORT_SHA_RE = /^[0-9a-f]{64}$/;

/** 문자열의 SHA-256 hex — 블록 락에 쓸 때만 쓴다(개인정보·비밀값 아님). */
function hubSha256_(text) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text == null ? '' : text), Utilities.Charset.UTF_8);
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = (bytes[i] + 256) % 256;
    out += (b < 16 ? '0' : '') + b.toString(16);
  }
  return out;
}

/** content_draft payload 검사 → 큐에 보낼 모양. 어긋나면 ERR_VALIDATION_FAILED. */
function hubDraftPayload_(payload) {
  const bad = function (msg) { return createAppError_('ERR_VALIDATION_FAILED', msg); };
  // 자동승인(LOW) 오더다 — 모르는 필드는 조용히 버리지 않고 거절한다(무엇을 보냈는지가 결과에 남게)
  Object.keys(payload || {}).forEach(function (k) {
    if (DRAFT_ALLOWED_KEYS.indexOf(k) === -1) throw bad('허용되지 않은 필드입니다: ' + k);
  });
  const contentId = String(payload.content_id || '');
  if (!RENDER_CONTENT_ID_RE.test(contentId)) throw bad('content_id 는 영문·숫자·_·- 40자 이내여야 합니다.');
  const brand = String(payload.brand || '');
  if (RENDER_BRANDS.indexOf(brand) === -1) throw bad('brand 가 올바르지 않습니다.');
  const format = String(payload.format || '');
  if (DRAFT_FORMATS.indexOf(format) === -1) throw bad('format 은 ' + DRAFT_FORMATS.join(' · ') + ' 이어야 합니다.');
  const concept = payload.concept && typeof payload.concept === 'object' ? payload.concept : {};
  const kind = String(concept.kind || 'review');
  if (DRAFT_KINDS.indexOf(kind) === -1) throw bad('concept.kind 는 ' + DRAFT_KINDS.join(' · ') + ' 중 하나여야 합니다.');
  const tone = String(concept.tone || 'plain');
  if (DRAFT_TONES.indexOf(tone) === -1) throw bad('concept.tone 은 ' + DRAFT_TONES.join(' · ') + ' 중 하나여야 합니다.');
  const hint = String(concept.hint == null ? '' : concept.hint).slice(0, DRAFT_MAX_HINT);
  const memoSha = String(payload.memo_sha256 || '');
  if (!REPORT_SHA_RE.test(memoSha)) throw bad('memo_sha256(SHA-256 64자리)가 필요합니다 — 화면에서 메모 해시를 먼저 만드세요.');

  // 사진 목록(이름·역할) — 내용은 보내지 않는다(파일은 드라이브 비공개 폴더에 있다)
  const media = [];
  if (payload.media !== undefined && payload.media !== null && payload.media !== '') {
    if (!Array.isArray(payload.media)) throw bad('media 는 목록이어야 합니다.');
    if (payload.media.length > DRAFT_MAX_MEDIA) throw bad('media 는 ' + DRAFT_MAX_MEDIA + '장까지입니다(지금 ' + payload.media.length + '장).');
    for (let i = 0; i < payload.media.length; i++) {
      const mm = payload.media[i] && typeof payload.media[i] === 'object' ? payload.media[i] : {};
      const n = String(mm.name || '');
      if (!RENDER_FILE_RE.test(n) || n.indexOf('..') !== -1 || n.charAt(0) === '.') throw bad('media[' + i + '] 이름이 올바르지 않습니다.');
      media.push({ name: n, role: String(mm.role || '').slice(0, 20) });
    }
  }

  // 사용자 원문 블록 — 각 블록의 해시가 그 글과 같은지 여기서 본다(1중)
  let payloadSource = 'inline';
  if (payload.payload_source !== undefined && payload.payload_source !== null && payload.payload_source !== '') {
    payloadSource = String(payload.payload_source).trim().toLowerCase();
    if (['inline', 'drive'].indexOf(payloadSource) === -1) throw bad('payload_source 는 inline · drive 중 하나여야 합니다.');
  }
  const blocks = [];
  if (payload.blocks !== undefined && payload.blocks !== null && payload.blocks !== '') {
    if (!Array.isArray(payload.blocks)) throw bad('blocks 는 목록이어야 합니다.');
    if (payload.blocks.length > DRAFT_MAX_BLOCKS) throw bad('blocks 는 ' + DRAFT_MAX_BLOCKS + '문단까지입니다.');
    for (let i = 0; i < payload.blocks.length; i++) {
      const b = payload.blocks[i] && typeof payload.blocks[i] === 'object' ? payload.blocks[i] : {};
      const text = String(b.text == null ? '' : b.text);
      if (!text.trim()) throw bad('blocks[' + i + '] 문단이 비었습니다.');
      if (text.length > DRAFT_MAX_BLOCK_TEXT) throw bad('blocks[' + i + '] 문단이 너무 깁니다(4,000자까지).');
      if (String(b.origin || 'USER').toUpperCase() !== 'USER') throw bad('blocks[' + i + '] 는 USER 문단만 보낼 수 있습니다.');
      const sha = String(b.sha256 || '');
      if (!REPORT_SHA_RE.test(sha)) throw bad('blocks[' + i + '] 에 sha256 이 필요합니다.');
      if (hubSha256_(text) !== sha) throw bad('blocks[' + i + '] 해시가 문단과 다릅니다 — 화면에서 다시 만드세요.');
      blocks.push({ id: String(b.id || ('U' + (i + 1))), origin: 'USER', text: text, sha256: sha });
    }
  }
  if (blocks.length) {
    const joined = blocks.map(function (b) { return b.text; }).join('\n\n');
    if (hubSha256_(joined) !== memoSha) throw bad('memo_sha256 이 전체 메모와 다릅니다 — 화면에서 다시 만드세요.');
  }

  const facts = {};
  if (payload.facts && typeof payload.facts === 'object') {
    DRAFT_FACT_KEYS.forEach(function (k) {
      const v = payload.facts[k];
      if (v !== undefined && v !== null && v !== '') facts[k] = String(v).slice(0, DRAFT_MAX_FACT);
    });
  }
  const askIn = payload.ask && typeof payload.ask === 'object' ? payload.ask : {};
  let askTitles = 3;
  if (askIn.titles !== undefined && askIn.titles !== null && askIn.titles !== '') {
    askTitles = Number(askIn.titles);
    if ([1, 2, 3].indexOf(askTitles) === -1) throw bad('ask.titles 는 1~3 이어야 합니다.');
  }
  const ask = {
    titles: askTitles,
    bridge: askIn.bridge !== false,
    captions: askIn.captions !== false,
    outro: askIn.outro !== false
  };
  const out = { content_id: contentId, brand: brand, format: format, concept: { kind: kind, tone: tone, hint: hint }, memo_sha256: memoSha, ask: ask };
  if (media.length) out.media = media;
  if (format === 'video') {
    const len = Number(payload.length_sec);
    out.length_sec = DRAFT_LENGTHS.indexOf(len) >= 0 ? len : 30;
  }
  if (payloadSource === 'drive') out.payload_source = 'drive';
  else {
    if (blocks.length) out.blocks = blocks;
    if (Object.keys(facts).length) out.facts = facts;
    if (JSON.stringify(out).length > RENDER_MAX_PAYLOAD_CHARS) {
      // 길어지면 문장을 자르지 않고 카드에서 읽게 한다(워커가 get_content_detail 로 같은 값을 가져온다)
      delete out.blocks;
      delete out.facts;
      out.payload_source = 'drive';
    }
  }
  if (JSON.stringify(out).length > 3900) {
    // 사진 25장 이름까지 넘치면 이름을 10장으로 줄인다(워커는 카드에서 전체 목록을 다시 읽는다)
    if (out.media) out.media = out.media.slice(0, 10);
    out.payload_source = 'drive';
  }
  return out;
}


/* ------------------------------------------------------------------ *
 * product_extract — 상품 링크 → 사실표 + 이미지 1~6장 (2026-11-24, v2)
 *
 *   왜 허브 GAS 가 이미 아는 것을 또 보내나: 노트북이 브라우저를 열지 않고 바로 이미지만 받게 하려고.
 *   GAS 1차(product_fetch)가 성공하면 그 사실·이미지 주소를 이 오더에 실어 보낸다 — 막힌 몰은 비워 보내고
 *   노트북이 주거 IP HTTP → 설치된 Chrome(channel:'chrome') 순으로 스스로 읽는다(3단 추출).
 *
 *   요청: { type:'product_extract', content_id, brand, url, facts:{…}, images:[url…],
 *           max_images:1~6, seconds:12~45, auto_render:true|false }
 *   규칙: 몰 허용 목록은 gas/Product.gs PRODUCT_ALLOWED_HOSTS_ 한 곳. 이미지 주소는 https 만.
 *         큐 payload 3,500자 한도를 넘으면 사실·이미지를 빼고 링크만 보낸다(노트북이 다시 읽는다).
 * ------------------------------------------------------------------ */
const PRODUCT_ORDER_MAX_IMAGES = 6;
const PRODUCT_ORDER_MAX_IMAGE_URLS = 12;
const PRODUCT_ORDER_MAX_KEY_POINTS = 5;
const PRODUCT_ORDER_IMAGE_URL_MAX = 500;
const PRODUCT_ORDER_FACT_KEYS = ['name', 'brand', 'category', 'price', 'original_price', 'rating', 'reviews', 'shipping', 'key_points', 'images'];
const PRODUCT_ORDER_ALLOWED_KEYS = ['type', 'content_id', 'brand', 'url', 'facts', 'images', 'max_images', 'seconds', 'auto_render'];

/** 상품 오더 payload 검사 → 큐에 보낼 모양. 어긋나면 ERR_VALIDATION_FAILED. */
function hubProductExtractPayload_(payload) {
  const bad = function (msg) { return createAppError_('ERR_VALIDATION_FAILED', msg); };
  Object.keys(payload || {}).forEach(function (k) {
    if (PRODUCT_ORDER_ALLOWED_KEYS.indexOf(k) === -1) throw bad('허용되지 않은 필드입니다: ' + k);
  });
  const contentId = String(payload.content_id || '');
  if (!RENDER_CONTENT_ID_RE.test(contentId)) throw bad('content_id 는 영문·숫자·_·- 40자 이내여야 합니다.');
  const brand = String(payload.brand || '');
  if (RENDER_BRANDS.indexOf(brand) === -1) throw bad('brand 가 올바르지 않습니다.');
  const url = String(payload.url || '').trim();
  if (!/^https:\/\//i.test(url)) throw bad('상품 링크는 https 여야 합니다.');
  const host = (url.match(/^https:\/\/([^\/]+)/i) || [])[1].toLowerCase().replace(/^www\./, '');
  if (PRODUCT_ALLOWED_HOSTS_.indexOf(host) === -1) throw bad('지원하지 않는 쇼핑몰입니다: ' + host.slice(0, 40));

  let maxImages = PRODUCT_ORDER_MAX_IMAGES;
  if (payload.max_images !== undefined && payload.max_images !== null && payload.max_images !== '') {
    const n = Number(payload.max_images);
    if (!isFinite(n) || Math.floor(n) !== n || n < 1 || n > PRODUCT_ORDER_MAX_IMAGES) throw bad('max_images 는 1~' + PRODUCT_ORDER_MAX_IMAGES + ' 이어야 합니다.');
    maxImages = n;
  }
  let seconds = 20;
  if (payload.seconds !== undefined && payload.seconds !== null && payload.seconds !== '') {
    const n = Number(payload.seconds);
    if (!isFinite(n) || n < 12 || n > 45) throw bad('seconds 는 12~45 사이여야 합니다.');
    seconds = Math.round(n);
  }
  if (payload.auto_render !== undefined && payload.auto_render !== null) {
    if (typeof payload.auto_render !== 'boolean') throw bad('auto_render 는 true·false 여야 합니다.');
  }

  /* 이미지 주소 — https 만. 쿼리(축소 파라미터)는 그대로 둔다(노트북이 원본 판단). */
  const images = [];
  if (Array.isArray(payload.images)) {
    if (payload.images.length > PRODUCT_ORDER_MAX_IMAGE_URLS) throw bad('이미지 주소는 ' + PRODUCT_ORDER_MAX_IMAGE_URLS + '개까지입니다.');
    payload.images.forEach(function (u, i) {
      const s = String(u || '').trim();
      if (!/^https:\/\/[^\s]+$/i.test(s) || s.length > PRODUCT_ORDER_IMAGE_URL_MAX) throw bad('images[' + i + '] 주소가 올바르지 않습니다.');
      if (images.indexOf(s) === -1) images.push(s);
    });
  }

  /* 사실표 — 허용 키만, 숫자는 숫자로, 길이는 자른다(모르는 값은 넣지 않는다). */
  const facts = {};
  if (payload.facts && typeof payload.facts === 'object') {
    Object.keys(payload.facts).forEach(function (k) {
      if (PRODUCT_ORDER_FACT_KEYS.indexOf(k) === -1) return;
      const v = payload.facts[k];
      if (v === undefined || v === null || v === '') return;
      if (k === 'price' || k === 'original_price' || k === 'rating' || k === 'reviews') {
        const n = productNumber_(v);
        if (n !== null) facts[k] = n;
      } else if (k === 'key_points') {
        facts.key_points = (Array.isArray(v) ? v : []).map(function (x) { return String(x || '').trim().slice(0, 60); })
          .filter(Boolean).slice(0, PRODUCT_ORDER_MAX_KEY_POINTS);
      } else if (k === 'images') {
        /* 사실표 안의 이미지 목록은 위 images 와 같은 규칙으로 접는다. */
      } else {
        facts[k] = String(v).trim().slice(0, k === 'name' ? 160 : 80);
      }
    });
    if (!facts.key_points || !facts.key_points.length) delete facts.key_points;
  }

  const out = { content_id: contentId, brand: brand, url: url, max_images: maxImages, seconds: seconds, auto_render: payload.auto_render === true };
  if (Object.keys(facts).length) out.facts = facts;
  if (images.length) out.images = images;
  if (JSON.stringify(out).length > RENDER_MAX_PAYLOAD_CHARS) {
    /* 사실·이미지가 길면 링크만 — 노트북이 브라우저/HTTP 로 다시 읽는다(조용히 다른 상품을 만들지 않는다). */
    delete out.facts;
    delete out.images;
  }
  return out;
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
  const isDraft = type === 'content_draft';
  const isProduct = type === 'product_extract';
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
  } else if (isDraft) {
    // 텍스트 생성 — 큐에서도 실제 타입 content_draft 로 들어간다(LOW·자동승인). 파일은 안 고친다.
    body = {
      key: token,
      action: 'queue_enqueue',
      type: 'content_draft',
      workspace: workspace,
      payload: hubDraftPayload_(payload)
    };
  } else if (isProduct) {
    // 상품 수집(2026-11-24, v2) — 사실·이미지는 큐의 product_extract 오더로 내려간다(LOW·자동승인).
    body = {
      key: token,
      action: 'queue_enqueue',
      type: 'product_extract',
      workspace: workspace,
      payload: hubProductExtractPayload_(payload)
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
    if ((realRender || isDraft || isProduct) && (code === 'ERR_UNKNOWN_TYPE' || code === 'type' || /ERR_UNKNOWN_TYPE|허용되지 않은 작업 타입|보낼 수 없는 오더/.test(msg))) {
      const what = isProduct ? 'product_extract(상품 수집)' : (isDraft ? 'content_draft(초안 생성)' : 'content_render(영상 렌더)');
      throw createAppError_('ERR_QUEUE_TYPE_UNKNOWN',
        '노트북 큐가 아직 ' + what + ' 를 모릅니다. 큐 Apps Script 를 새 버전으로 배포한 뒤 다시 보내 주세요(오더는 만들어지지 않았습니다).',
        { queue_code: code || 'ERR_UNKNOWN_TYPE', order_type: isProduct ? 'product_extract' : (isDraft ? 'content_draft' : 'content_render') });
    }
    const hint = /unauthorized/i.test(msg) ? ' — QUEUE_TOKEN 이 그 웹앱의 키와 다릅니다'
      : (code === 'workspace' ? ' — QUEUE_WORKSPACE 값이 큐의 허용 목록에 없습니다'
      : (code === 'too_long' || code === 'bad_request' ? ' — 오더 내용을 줄여 주세요' : ''));
    throw createAppError_('ERR_QUEUE_REJECTED', '큐가 오더를 받지 않았습니다: ' + msg + hint,
      { queue_code: code });
  }

  const queueType = isProduct ? 'product_extract' : (isDraft ? 'content_draft' : (realRender ? 'content_render' : 'claude_prompt'));
  const out = hubOrderResult_(json, type, workspace, prompt, queueType,
    realRender ? (body.payload.cuts ? body.payload.cuts.length : 0) : undefined,
    realRender ? { captions: (body.payload.captions || []).length, narration: (body.payload.narration || []).length, pace: body.payload.pace || '' } : undefined);
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
