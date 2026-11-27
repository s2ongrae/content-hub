/**
 * js/designModel.js — 숏폼 글자 디자인 · 구간 제목 (2026-11-25, Phase 1)
 *
 * 노트북 hub-agent/notebook-agent/lib/design.js 와 **같은 값·같은 규칙**의 허브 쪽 사본이다.
 *  · 허브는 화면·미리보기·오더 판단을 하고, 노트북이 같은 값을 ASS 로 굽는다.
 *  · 값의 표는 seeds/video_template.json → test/run.js [15]가 셋을 대조한다.
 *
 * 원칙
 *  · 기본값 = 지금까지의 출력. 아무것도 안 건드렸으면 isDefaultDesign() 이 true 이고,
 *    그때는 오더에 아무 흔적도 남기지 않는다(기존 카드·오더 100% 동일).
 *  · 좌표는 1080×1920 픽셀. 자막 pos 는 '밑단 y' + '가운데에서의 x 오프셋'(x=0 이면 가운데).
 *  · 화면은 textContent/createElement 만 쓴다(이 파일은 계산만, DOM 없음).
 */

export const W = 1080;
export const H = 1920;
export const MAX_SEGMENTS = 6;
export const MAX_SEG_TITLE = 20;
export const MAX_SEG_BADGE = 16;
export const MIN_SEG_S = 0.3;
export const SAFE_TOP = 240;
export const SAFE_BOTTOM = 1420;
export const SAFE_SIDE = 100;
export const CAPTION_DEFAULT_Y = 1419;
export const DEFAULT_BOX_RADIUS = 18;
export const BOX_PAD_X = 22;
export const BOX_PAD_Y = 10;
export const BADGE_PAD_X = 24;
export const BADGE_PAD_Y = 12;

export const PRESETS = [
  {
    id: 'base', label: '기본 돈키호테', note: '지금까지 쓰던 흰 글씨 · 3px 외곽선',
    caption: { color: '#FFFFFF', outline: { color: '#111111', px: 3 }, shadow: { on: true, alpha: 55, x: 2, y: 5, blur: 6 }, box: { on: false, alpha: 70, radius: DEFAULT_BOX_RADIUS } }
  },
  {
    id: 'clean', label: '깔끔 화이트+그림자', note: '외곽선 없이 번지는 그림자 — 밝은 화면에서는 묻힐 수 있어요',
    caption: { color: '#FFFFFF', outline: { color: '#111111', px: 0 }, shadow: { on: true, alpha: 80, x: 0, y: 4, blur: 9 }, box: { on: false, alpha: 70, radius: DEFAULT_BOX_RADIUS } }
  },
  {
    id: 'neon', label: '네온 옐로우', note: '노란 글씨 + 번지는 빛',
    caption: { color: '#FFE84D', outline: { color: '#4A3200', px: 3 }, shadow: { on: true, alpha: 78, x: 0, y: 0, blur: 12 }, box: { on: false, alpha: 70, radius: DEFAULT_BOX_RADIUS } }
  },
  {
    id: 'box', label: '자막 검정 박스', note: '반투명 검정 판 위 흰 글씨 — 밝은 배경에서 가장 안전',
    caption: { color: '#FFFFFF', outline: { color: '#000000', px: 0 }, shadow: { on: false, alpha: 0, x: 0, y: 0, blur: 0 }, box: { on: true, alpha: 70, radius: DEFAULT_BOX_RADIUS } }
  },
  {
    id: 'mint', label: '민트 포인트', note: '민트 글씨 + 진한 테두리',
    caption: { color: '#8FF5D2', outline: { color: '#0E2B24', px: 3 }, shadow: { on: true, alpha: 60, x: 1, y: 4, blur: 5 }, box: { on: false, alpha: 70, radius: DEFAULT_BOX_RADIUS } }
  }
];
export const PRESET_IDS = PRESETS.map((p) => p.id);

// 워터마크(2026-11-25 사용자 지시 "내 사진이나 영상에 워터마크처럼 @s2ongrae 다 넣게끔") — 기본 ON.
//   노트북 lib/design.js 와 같은 값. 영상은 오른쪽 위(브랜드 뱃지 왼쪽 위·구간 제목 가운데를 피한다).
export const WATERMARK_DEFAULT = { enabled: true, text: '@s2ongrae', opacity: 45, position: 'top-right', size: 34 };
export const WATERMARK_POSITIONS = [
  { id: 'top-right', label: '오른쪽 위' },
  { id: 'top-left', label: '왼쪽 위' },
  { id: 'bottom-right', label: '오른쪽 아래' },
  { id: 'bottom-left', label: '왼쪽 아래' }
];
export const WATERMARK_POSITION_IDS = WATERMARK_POSITIONS.map((p) => p.id);
// 사진·카드뉴스(1080×1350) 기본값 — 사진 아래 브랜드 이름과 반대쪽(오른쪽 아래)에 옅게.
export const PHOTO_WATERMARK_DEFAULT = { enabled: true, text: '@s2ongrae', opacity: 45, position: 'bottom-right', size: 30 };
// 색 스와치 — 흰색·노랑·민트·트랙 주황·분홍·연두 (자유 색은 <input type=color>)
export const COLOR_SWATCHES = ['#FFFFFF', '#FFE84D', '#8FF5D2', '#FF7A1A', '#FF9ECD', '#B6F36B'];
export const ROLE_LABELS = { caption: '자막', title: '구간 제목', badge: '구간 배지' };

/* ────────────────────────── 폰트 (2026-11-27, P0) ──────────────────────────
 * 레이 님 결정(부이 전달 Q-20261127-125239-4t3m): 커스텀 폰트는 **재배포 가능한 라이선스만**.
 *  · 받은 폰트 파일을 허브 보관함(비공개 드라이브)에 두는 것 자체가 '재배포'다 —
 *    상용 데스크톱 라이선스·개인용 무료 폰트는 파일을 올릴 수 없다(영상에 글자로 찍히는 것과 다르다).
 *  · 역할의 font 값은 **파일 이름**이다: 기본은 'Pretendard', 커스텀은 'Miryung-Bold.otf' 처럼.
 *    파일 이름을 그대로 쓰면 노트북이 폰트 파일을 찾기만 하면 되고, 이름이 어긋나지 않는다.
 *  · gas/Upload.gs FONT_LICENSES_OK 와 같은 값이어야 한다(test/run.js·gas/test/run.js 가 대조).
 */
export const FONT_STACK = '"Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif';
export const BUILTIN_FONT = 'Pretendard';
export const FONT_MAX_BYTES = 20 * 1024 * 1024;          // 한 벌 20MB — 한글 전체 ttf 도 들어간다
//  재배포 가능 라이선스만 — ok:false 는 화면에서 이유와 함께 막힌다.
export const FONT_LICENSES = [
  { id: 'OFL-1.1', label: 'SIL Open Font License 1.1 (OFL)', ok: true, note: '가장 흔합니다 — Pretendard·Noto·본고딕 계열' },
  { id: 'Apache-2.0', label: 'Apache License 2.0', ok: true, note: '구글 폰트 일부' },
  { id: 'MIT', label: 'MIT License', ok: true, note: '일부 오픈소스 폰트' },
  { id: 'CC0-1.0', label: 'CC0 1.0 (퍼블릭 도메인 헌정)', ok: true, note: '출처 표기 필요 없음' },
  { id: 'CC-BY-4.0', label: 'CC BY 4.0', ok: true, note: '영상·설명란에 출처를 적어야 합니다' },
  { id: 'PD', label: '퍼블릭 도메인', ok: true, note: '저작권 만료·기증' },
  { id: 'commercial-desktop', label: '상용·데스크톱 라이선스 (산돌·윤디자인 등)', ok: false, why: '파일을 보관·배포할 수 없습니다 — 영상에 글자로 찍어 쓰는 것만 허용됩니다. 폰트를 띄워 쓰려면 그 폰트를 깔린 PC에서 직접 렌더해야 합니다.' },
  { id: 'free-personal', label: '개인용 무료 (상업·재배포 금지)', ok: false, why: '무료로 받았다고 재배포가 되는 것이 아닙니다 — 파일 보관은 허용되지 않습니다.' },
  { id: 'unknown', label: '라이선스를 모름 / 기타', ok: false, why: '라이선스를 확인하지 못한 폰트는 받지 않습니다. 폰트 배포처의 라이선스 문구를 먼저 확인해 주세요.' }
];
export const FONT_LICENSES_OK = FONT_LICENSES.filter((l) => l.ok).map((l) => l.id);
export const FONT_LICENSES_BLOCKED = FONT_LICENSES.filter((l) => !l.ok).map((l) => l.id);
export const FONT_EXT = ['ttf', 'otf', 'woff2'];
export const FONT_EXT_RE = /\.(ttf|otf|woff2)$/i;
export const FONT_NAME_RE = /^[A-Za-z0-9가-힣][A-Za-z0-9가-힣._ -]{0,59}$/;

/** 라이선스 한 줄 — 화면·보고에 쓸 이름. */
export function fontLicenseLabel(id) {
  const l = FONT_LICENSES.find((x) => x.id === String(id == null ? '' : id).trim());
  return l ? l.label : '';
}

/** 라이선스 검사 — 받을 수 있는 것만 통과(이유를 그대로 돌려준다). */
export function checkFontLicense(id) {
  const v = String(id == null ? '' : id).trim();
  const l = FONT_LICENSES.find((x) => x.id === v);
  if (!l) return { ok: false, error: '라이선스를 골라 주세요(재배포 가능한 라이선스만 받습니다).' };
  if (!l.ok) return { ok: false, error: l.why };
  return { ok: true, id: l.id, label: l.label };
}

/** 파일 이름에서 화면에 보일 이름 — 확장자만 떼고 32자까지. */
export function fontLabel(name) {
  return String(name == null ? '' : name).replace(FONT_EXT_RE, '').slice(0, 32) || '내 폰트';
}

/** 기본 폰트인가(허브에 들어 있는 Pretendard). */
export function isBuiltinFont(font) {
  const f = String(font == null ? '' : font).trim();
  return !f || f === BUILTIN_FONT || f === '기본';
}

/** 커스텀 폰트 파일 이름인가 — 확장자·안전한 글자만. */
export function isCustomFontFile(name) {
  const n = String(name == null ? '' : name).trim();
  return !isBuiltinFont(n) && n.length <= 60 && n.indexOf('..') === -1 && n.charAt(0) !== '.' && FONT_NAME_RE.test(n) && FONT_EXT_RE.test(n);
}

/**
 * 역할의 font 값 정리 — 모르는 값은 기본(Pretendard)으로 돌린다(렌더가 깨지지 않게).
 *  · 기본 폰트 이름, 또는 안전한 폰트 파일 이름만 남긴다.
 */
export function normalizeFontRef(raw) {
  const s = String(raw == null ? '' : raw).replace(CONTROL_RE, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!s || s === BUILTIN_FONT || s === '기본') return BUILTIN_FONT;
  return isCustomFontFile(s) ? s : BUILTIN_FONT;
}

/** 커스텀 폰트를 캔버스에 쓸 때의 별명 — 파일 이름이 달라도 서로 섞이지 않게. */
export function customFontAlias(name) {
  const n = String(name == null ? '' : name).trim().toLowerCase();
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) % 100000007;
  return 'HubFont' + h;
}

/** 캔버스 font-family 값 — 기본이면 Pretendard 스택, 커스텀이면 별명 + 같은 폴백. */
export function canvasFontFamily(font) {
  if (isBuiltinFont(font)) return FONT_STACK;
  return '"' + customFontAlias(font) + '", ' + FONT_STACK;
}

/**
 * 올리기 전 폰트 파일 검사 — 확장자·크기·빈 파일.
 *  반환: { ok, errors, name(다듬은 이름), label, ext }
 *  · 파일 내용이 진짜 폰트인지는 서버(gas/Upload.gs)가 첫 4바이트로 본다.
 */
export function checkFontFile(file) {
  const errors = [];
  const raw = String((file && file.name) || '내 폰트.ttf');
  const extM = raw.match(FONT_EXT_RE);
  const ext = extM ? extM[0].toLowerCase() : '';
  let base = raw.slice(0, raw.length - (extM ? extM[0].length : 0))
    .replace(/[^A-Za-z0-9가-힣._ -]+/g, '_').replace(/_{2,}/g, '_').replace(/\s+/g, ' ').trim()
    .replace(/^[^A-Za-z0-9가-힣]+/, '').trim();
  if (base.length > 52) base = base.slice(0, 52).trim();
  const name = (base || '내 폰트') + ext;
  if (!file) errors.push('파일이 없습니다.');
  else {
    if (!ext) errors.push(FONT_EXT.join('·') + ' 파일만 올릴 수 있습니다: ' + raw.slice(0, 40));
    if (Number(file.size) > FONT_MAX_BYTES) errors.push(raw.slice(0, 40) + ' 이(가) 너무 큽니다(한 벌 20MB까지).');
    if (Number(file.size) <= 0) errors.push(raw.slice(0, 40) + ' 이(가) 비어 있습니다.');
  }
  return { ok: errors.length === 0, errors, name, label: fontLabel(name), ext: ext.replace('.', '') };
}

/** 폰트 파일 한 벌의 안내 — woff2 는 화면 미리보기용이고 MP4 렌더에는 ttf·otf 가 필요하다. */
export function fontRenderNote(name) {
  const n = String(name == null ? '' : name);
  if (isBuiltinFont(n)) return '';
  if (/\.woff2$/i.test(n)) return 'woff2 는 이 화면 미리보기용입니다 — MP4 에 굽으려면 같은 폰트의 ttf·otf 를 올려 주세요(노트북이 woff2 를 풀지 못합니다).';
  return '';
}

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g;
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{2190}-\u{21FF}]/gu;

export function clampNum(v, min, max, dflt) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}
const round2 = (n) => Math.round(n * 100) / 100;

export function hexColor(v, dflt) {
  const s = String(v == null ? '' : v).trim();
  return COLOR_RE.test(s) ? s.toUpperCase() : dflt;
}

export function cleanSegText(v, max) {
  let s = String(v == null ? '' : v).replace(EMOJI_RE, '').replace(CONTROL_RE, '').replace(/\r\n?/g, ' ').replace(/[\t ]+/g, ' ').trim();
  s = s.replace(/\\/g, '＼').replace(/\{/g, '（').replace(/\}/g, '）');
  if (max && s.length > max) s = s.slice(0, max).trim();
  return s;
}

export function charEm(ch) {
  if (!ch) return 0;
  const c = ch.charCodeAt(0);
  if (c >= 0xAC00 && c <= 0xD7A3) return 1.0;
  if (c >= 0x1100 && c <= 0x11FF) return 0.9;
  if (c >= 0x3130 && c <= 0x318F) return 0.95;
  if (ch === ' ') return 0.3;
  if (c >= 0x30 && c <= 0x39) return 0.58;
  if (c >= 0x41 && c <= 0x5A) return 0.64;
  if (c >= 0x61 && c <= 0x7A) return 0.54;
  if ('.,:;!?\'"()[]{}%-'.indexOf(ch) >= 0) return 0.36;
  if (c >= 0xFF00 && c <= 0xFFEF) return 0.95;
  return 0.62;
}

/** 줄 폭(px) — 노트북의 박스 폭 계산과 같은 식(폰트 측정이 아니라 글자 폭 표). */
export function measureLineWidth(text, size) {
  const s = String(text == null ? '' : text).replace(EMOJI_RE, '');
  let em = 0;
  for (const ch of s) em += charEm(ch);
  return Math.round(em * (Number(size) > 0 ? Number(size) : 68));
}

export function defaultCaption() {
  const p = PRESETS[0].caption;
  return {
    preset: 'base',
    font: 'Pretendard',
    color: p.color,
    outline: { color: p.outline.color, px: p.outline.px },
    shadow: { on: p.shadow.on, alpha: p.shadow.alpha, x: p.shadow.x, y: p.shadow.y, blur: p.shadow.blur },
    box: { on: p.box.on, alpha: p.box.alpha, radius: p.box.radius },
    pos: { x: 0, y: CAPTION_DEFAULT_Y }
  };
}

export function defaultWatermark() {
  return { enabled: true, text: '@s2ongrae', opacity: 45, position: 'top-right', size: 34 };
}

export function normalizeWatermark(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const on = o.enabled !== false;
  const pos = String(o.position == null ? '' : o.position).trim();
  return {
    enabled: on,
    text: cleanSegText(o.text == null ? (on ? WATERMARK_DEFAULT.text : '') : o.text, 24) || (on ? WATERMARK_DEFAULT.text : ''),
    opacity: Math.round(clampNum(o.opacity, 5, 100, WATERMARK_DEFAULT.opacity)),
    position: WATERMARK_POSITION_IDS.indexOf(pos) >= 0 ? pos : WATERMARK_DEFAULT.position,
    size: Math.round(clampNum(o.size, 16, 72, WATERMARK_DEFAULT.size))
  };
}

export function defaultDesign() {
  return {
    v: 1,
    watermark: defaultWatermark(),
    roles: {
      caption: defaultCaption(),
      title: { font: 'Pretendard', color: '#FFE84D', size: 78, pos: { x: 0, y: 372 } },
      badge: { font: 'Pretendard', color: '#FFFFFF', size: 42, pos: { x: 0, y: 454 }, pill: true }
    },
    segments: []
  };
}

export function presetById(id) {
  const k = String(id == null ? '' : id).trim();
  return PRESETS.find((p) => p.id === k) || null;
}

export function normalizeCaption(raw) {
  const d = defaultCaption();
  const o = raw && typeof raw === 'object' ? raw : {};
  const ol = o.outline && typeof o.outline === 'object' ? o.outline : {};
  const sh = o.shadow && typeof o.shadow === 'object' ? o.shadow : {};
  const bx = o.box && typeof o.box === 'object' ? o.box : {};
  const pos = o.pos && typeof o.pos === 'object' ? o.pos : {};
  const presetRaw = String(o.preset == null ? 'base' : o.preset);
  return {
    preset: PRESET_IDS.indexOf(presetRaw) >= 0 ? presetRaw : 'custom',
    font: normalizeFontRef(o.font === undefined || o.font === null || o.font === '' ? d.font : o.font),
    color: hexColor(o.color, d.color),
    outline: { color: hexColor(ol.color, d.outline.color), px: Math.round(clampNum(ol.px, 0, 10, d.outline.px)) },
    shadow: {
      on: sh.on !== false,
      alpha: Math.round(clampNum(sh.alpha, 0, 100, d.shadow.alpha)),
      x: Math.round(clampNum(sh.x, -20, 20, d.shadow.x)),
      y: Math.round(clampNum(sh.y, -20, 20, d.shadow.y)),
      blur: Math.round(clampNum(sh.blur, 0, 30, d.shadow.blur))
    },
    box: {
      on: bx.on === true,
      alpha: Math.round(clampNum(bx.alpha, 0, 100, d.box.alpha)),
      radius: Math.round(clampNum(bx.radius, 0, 60, d.box.radius))
    },
    pos: { x: Math.round(clampNum(pos.x, -540, 540, 0)), y: Math.round(clampNum(pos.y, 0, 1920, d.pos.y)) }
  };
}

/** 프리셋을 적용한 새 caption 역할(pos·font 는 지킨다). */
export function applyPreset(caption, presetId) {
  const base = normalizeCaption(caption);
  const p = presetById(presetId);
  if (!p) return base;
  return Object.assign({}, base, {
    preset: p.id,
    color: p.caption.color,
    outline: Object.assign({}, p.caption.outline),
    shadow: Object.assign({}, p.caption.shadow),
    box: Object.assign({}, p.caption.box)
  });
}

function normalizeSegment(raw) {
  const o = raw && typeof raw === 'object' ? raw : (Array.isArray(raw) ? { start: raw[0], end: raw[1], title: raw[2], badge: raw[3] } : {});
  const start = Number(o.start === undefined ? o.s : o.start);
  const end = Number(o.end === undefined ? o.e : o.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || end <= start) return null;
  const title = cleanSegText(o.title, MAX_SEG_TITLE);
  const badge = cleanSegText(o.badge, MAX_SEG_BADGE);
  if (!title && !badge) return null;
  return { start: round2(start), end: round2(end), title, badge };
}

export function normalizeDesign(raw) {
  const base = defaultDesign();
  const o = raw && typeof raw === 'object' ? raw : {};
  const roles = o.roles && typeof o.roles === 'object' ? o.roles : {};
  const t = roles.title && typeof roles.title === 'object' ? roles.title : {};
  const b = roles.badge && typeof roles.badge === 'object' ? roles.badge : {};
  const caption = normalizeCaption(roles.caption);
  const title = {
    font: normalizeFontRef(t.font === undefined || t.font === null || t.font === '' ? base.roles.title.font : t.font),
    color: hexColor(t.color, base.roles.title.color),
    size: Math.round(clampNum(t.size, 24, 120, base.roles.title.size)),
    pos: { x: Math.round(clampNum(t.pos && t.pos.x, -540, 540, 0)), y: Math.round(clampNum(t.pos && t.pos.y, 0, 1920, base.roles.title.pos.y)) }
  };
  const badge = {
    font: normalizeFontRef(b.font === undefined || b.font === null || b.font === '' ? base.roles.badge.font : b.font),
    color: hexColor(b.color, base.roles.badge.color),
    size: Math.round(clampNum(b.size, 16, 80, base.roles.badge.size)),
    pos: { x: Math.round(clampNum(b.pos && b.pos.x, -540, 540, 0)), y: Math.round(clampNum(b.pos && b.pos.y, 0, 1920, base.roles.badge.pos.y)) },
    pill: b.pill !== false
  };
  const rawSegs = Array.isArray(o.segments) ? o.segments : [];
  const segs = rawSegs.map(normalizeSegment).filter(Boolean).sort((a, c) => a.start - c.start || a.end - c.end).slice(0, MAX_SEGMENTS);
  const outSegs = [];
  segs.forEach((s) => {
    const prev = outSegs[outSegs.length - 1];
    const from = prev && s.start < prev.end ? prev.end : s.start;
    if (s.end - from < MIN_SEG_S) return;
    outSegs.push({ start: round2(from), end: round2(s.end), title: s.title, badge: s.badge });
  });
  return { v: 1, watermark: normalizeWatermark(o.watermark), roles: { caption, title, badge }, segments: outSegs };
}

/** 워터마크만 끈 design — '아무것도 안 건드린 상태'의 비교 기준(2026-11-25 이전 동작). */
function plainDesign() {
  const d = defaultDesign();
  d.watermark = Object.assign(defaultWatermark(), { enabled: false, text: '' });
  return d;
}

/** 자막 역할을 사용자가 건드렸는가 — 안 건드렸으면 자막 스타일은 예전 그대로 둔다(워터마크만 얹는다). */
export function hasCaptionDesign(raw) {
  const d = normalizeDesign(raw);
  return json(d.roles.caption) !== json(defaultCaption());
}

const json = (v) => JSON.stringify(v);

export function isDefaultDesign(raw) {
  return json(normalizeDesign(raw)) === json(defaultDesign());
}

/**
 * 렌더에 design 을 적용해야 하는가.
 *  · 2026-11-25부터 워터마크가 기본 ON 이라 **값이 없어도 true** 다(모든 영상에 @s2ongrae).
 *  · 워터마크를 끄고 글자 디자인도 안 건드렸을 때만 false — 그때가 예전과 100% 같은 출력이다.
 *  · true 면 오더는 payload_source:'drive' 만 싣고 노트북이 카드에서 읽는다(큐는 고정 키로 payload 를 다시 만든다).
 */
export function hasDesign(raw) {
  if (raw !== undefined && raw !== null && typeof raw !== 'object') return false;
  return json(normalizeDesign(raw)) !== json(plainDesign());
}

/** 구간을 실제 타임라인에 맞춘다(훅 끝에서 시작·영상 길이에서 자름). 노트북 lib/design.js applyTimeline 과 같다. */
export function applyTimeline(raw, ctx) {
  const d = normalizeDesign(raw);
  const c = ctx || {};
  const duration = Number(c.duration) > 0 ? Number(c.duration) : 0;
  const hookEnd = Number(c.hookEnd) > 0 ? round2(Number(c.hookEnd)) : 0;
  const warnings = [];
  let clamped = 0, dropped = 0;
  const segs = [];
  d.segments.forEach((s) => {
    let from = s.start;
    const to = duration > 0 ? Math.min(s.end, duration) : s.end;
    if (hookEnd > 0 && from < hookEnd) {
      from = hookEnd;
      clamped++;
      warnings.push({ code: 'seg_hook', level: 'warn', msg: '"' + (s.title || s.badge) + '" 구간이 오프닝 훅(0~' + hookEnd + '초)과 겹쳐 ' + hookEnd + '초에서 시작해요.' });
    }
    if (duration > 0 && s.end > duration) {
      warnings.push({ code: 'seg_over_duration', level: 'warn', msg: '"' + (s.title || s.badge) + '" 구간 끝(' + s.end + '초)이 영상 길이(' + round2(duration) + '초)를 넘어 잘렸어요.' });
      clamped++;
    }
    if (to - from < MIN_SEG_S) { dropped++; return; }
    segs.push({ start: round2(from), end: round2(to), title: s.title, badge: s.badge });
  });
  const fixed = [];
  segs.forEach((s) => {
    const prev = fixed[fixed.length - 1];
    const from = prev && s.start < prev.end ? prev.end : s.start;
    if (s.end - from < MIN_SEG_S) { dropped++; return; }
    fixed.push({ start: round2(from), end: round2(s.end), title: s.title, badge: s.badge });
  });
  return { design: { v: 1, watermark: d.watermark, roles: d.roles, segments: fixed }, clamped, dropped, warnings };
}

export function readabilityOk(caption) {
  const c = normalizeCaption(caption);
  if (c.outline.px >= 2) return true;
  if (c.box.on && c.box.alpha >= 40) return true;
  if (c.shadow.on && c.shadow.alpha >= 70 && c.shadow.blur <= 4) return true;
  return false;
}

/** 화면 아래에 그대로 보여 줄 경고(막지 않는다). 노트북 lib/design.js designWarnings 와 같은 문구. */
export function designWarnings(raw, ctx) {
  const d = normalizeDesign(raw);
  const c = ctx || {};
  const out = [];
  const cap = d.roles.caption;
  if (!readabilityOk(cap)) out.push({ code: 'contrast', level: 'warn', msg: '가독성 하한 미달 — 외곽선 2px 이상 · 검정 박스 40% 이상 · 진한 그림자(70%+번짐 4 이하) 중 하나를 켜 주세요. 밝은 음식 화면에서 글자가 묻혀요.' });
  if (cap.pos.y < 1200) out.push({ code: 'caption_high', level: 'warn', msg: '자막이 너무 위에 있어요(Y' + cap.pos.y + ') — 화면 가운데 피사체를 가릴 수 있어요.' });
  if (cap.pos.y > SAFE_BOTTOM) out.push({ code: 'caption_low', level: 'warn', msg: '자막 밑단이 안전선(' + SAFE_BOTTOM + 'px)을 넘어 잘릴 수 있어요(Y' + cap.pos.y + ').' });
  if (Math.abs(cap.pos.x) > 540 - SAFE_SIDE) out.push({ code: 'caption_side', level: 'warn', msg: '자막이 좌우 여백(' + SAFE_SIDE + 'px)을 벗어날 수 있어요(X' + cap.pos.x + ').' });
  if (cap.preset === 'custom') out.push({ code: 'custom_preset', level: 'info', msg: '프리셋에서 벗어난 색·테두리 조합이에요 — 트랙 톤에서 멀어지지 않게 한 번 봐 주세요.' });
  // 커스텀 폰트(2026-11-27) — woff2 는 화면 미리보기용이라 그대로 렌더하면 기본 폰트로 나온다(미리 알린다).
  ['caption', 'title', 'badge'].forEach((k) => {
    const f = d.roles[k].font;
    const note = fontRenderNote(f);
    if (note && out.every((w) => w.code !== 'font_woff2')) out.push({ code: 'font_woff2', level: 'warn', msg: ROLE_LABELS[k] + ': ' + note });
  });
  const segs = d.segments;
  if (segs.length) {
    const t = d.roles.title;
    const b = d.roles.badge;
    if (t.pos.y < SAFE_TOP) out.push({ code: 'seg_title_top', level: 'warn', msg: '구간 제목이 상단 안전선(' + SAFE_TOP + 'px)을 침범해요(Y' + t.pos.y + ').' });
    if (b.pos.y + b.size + BADGE_PAD_Y * 2 > SAFE_BOTTOM) out.push({ code: 'seg_badge_bottom', level: 'warn', msg: '구간 배지가 하단 안전선(' + SAFE_BOTTOM + 'px)을 넘어요.' });
    if (c.brandBadge && t.pos.y < 340) out.push({ code: 'seg_brand_overlap', level: 'warn', msg: '구간 제목(Y' + t.pos.y + ')이 상단 브랜드 뱃지(y 244~322)와 겹칠 수 있어요 — Y를 340 아래로 내려 주세요.' });
    const bandTop = c.captionBand && Number(c.captionBand.top) > 0 ? Number(c.captionBand.top) : 1294;
    if (b.pos.y + b.size + BADGE_PAD_Y * 2 > bandTop) out.push({ code: 'seg_caption_overlap', level: 'warn', msg: '구간 배지가 자막 띠(' + bandTop + 'px부터)와 겹쳐요.' });
    if (c.hookEnd > 0 && segs.some((s) => s.start < Number(c.hookEnd))) out.push({ code: 'seg_hook', level: 'warn', msg: '오프닝 훅(0~' + c.hookEnd + '초) 구간에는 구간 제목을 놓지 않아요 — 시작을 훅 끝으로 미뤘어요.' });
    if (segs.length >= MAX_SEGMENTS) out.push({ code: 'seg_max', level: 'info', msg: '구간은 ' + MAX_SEGMENTS + '개까지예요(더 넣으면 뒤가 잘려요).' });
  }
  return out;
}

/**
 * 미리보기 좌표 — 캔버스(1080×1920) 안에서 자막 한 덩어리의 자리.
 * 반환: { lines, lineHeight, text:{x,y}, box:{x,y,w,h} | null }
 *  · y 는 밑단(마지막 줄의 바닥). 박스는 가장 긴 줄 폭 기준 한 장.
 */
export function captionLayout(raw, opts) {
  const cap = normalizeCaption(raw);
  const o = opts || {};
  const size = Number(o.size) > 0 ? Number(o.size) : 68;
  const lines = (Array.isArray(o.lines) && o.lines.length ? o.lines : [String(o.text || '이 가격 실화냐? 16,000원 맞아?')]).slice(0, 2);
  const lineHeight = Math.round(size * 1.22);
  const x = 540 + cap.pos.x;
  const y = cap.pos.y;
  const longest = Math.max.apply(null, lines.map((l) => measureLineWidth(l, size)));
  const box = cap.box.on ? {
    x: Math.round(x - (longest + BOX_PAD_X * 2) / 2),
    y: Math.round(y - lineHeight * lines.length - BOX_PAD_Y),
    w: longest + BOX_PAD_X * 2,
    h: lineHeight * lines.length + BOX_PAD_Y * 2
  } : null;
  return { lines, lineHeight, text: { x, y }, box };
}

/** 워터마크 자리(1080×1920) — 노트북 lib/design.js watermarkPoint 와 같은 값. 미리보기가 그대로 쓴다. */
export function watermarkPoint(position, opts) {
  const o = opts || {};
  const pad = Number(o.pad) > 0 ? Number(o.pad) : 72;
  const w = Number(o.width) > 0 ? Number(o.width) : W;
  const h = Number(o.height) > 0 ? Number(o.height) : H;
  const yTop = Number(o.yTop) > 0 ? Number(o.yTop) : 250;
  const yBottom = Number(o.yBottom) > 0 ? Number(o.yBottom) : 1400;
  const p = WATERMARK_POSITION_IDS.indexOf(String(position)) >= 0 ? String(position) : WATERMARK_DEFAULT.position;
  if (p === 'top-left') return { x: pad, y: yTop, align: 'left' };
  if (p === 'bottom-left') return { x: pad, y: yBottom, align: 'left' };
  if (p === 'bottom-right') return { x: w - pad, y: yBottom, align: 'right' };
  return { x: w - pad, y: yTop, align: 'right' };
}

/** 캔버스 좌표(화면에 보이는 px) → 1080×1920 좌표. 미리보기 끌어 옮기기에 쓴다. */
export function canvasToDesign(px, py, scale) {
  const s = Number(scale) > 0 ? Number(scale) : 1;
  return { x: Math.round(px / s), y: Math.round(py / s) };
}

/** 화면에 보여 줄 한 줄 요약 — "기본 돈키호테 · Y1419 X0 · 구간 2개". */
export function designSummary(raw) {
  const d = normalizeDesign(raw);
  const p = presetById(d.roles.caption.preset);
  const name = p ? p.label : '내 조합';
  const fonts = ['caption', 'title', 'badge'].map((k) => d.roles[k].font).filter((f, i, a) => !isBuiltinFont(f) && a.indexOf(f) === i);
  return name + ' · Y' + d.roles.caption.pos.y + ' X' + d.roles.caption.pos.x + ' · 구간 ' + d.segments.length + '개'
    + (fonts.length ? ' · 내 폰트 ' + fonts.map(fontLabel).join(', ') : '');
}

/** 카드 payload(studio.formats.video.design)에 넣을 값 — 기본값이면 null(키를 만들지 않는다). */
export function designForCard(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const d = normalizeDesign(raw);
  return isDefaultDesign(d) ? null : d;   // 기본값(워터마크 ON 포함)은 카드에 쓰지 않는다 — 키를 만들지 않는다
}

/** 구간을 자막 큐 경계로 스냅한다('자막 범위로'). 큐가 없으면 그대로. */
export function snapSegmentToCues(seg, cues) {
  const list = (Array.isArray(cues) ? cues : []).filter((c) => Number.isFinite(Number(c.start)) && Number.isFinite(Number(c.end)));
  if (!list.length) return null;
  const t = Number(seg && seg.start) || 0;
  const hit = list.reduce((best, c) => (Math.abs(Number(c.start) - t) < Math.abs(Number(best.start) - t) ? c : best), list[0]);
  const idx = list.indexOf(hit);
  const next = list[idx + 1];
  const end = next ? Number(next.start) : Number(hit.end);
  return { start: round2(Number(hit.start)), end: round2(Math.max(Number(hit.start) + MIN_SEG_S, end)) };
}
