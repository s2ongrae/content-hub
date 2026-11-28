/**
 * js/studioCanvas.js — 인스타 카드 PNG 만들기 (2026-11-21, O1 · 3:4 프리셋 2026-11-26 · 4타입 레이아웃 2026-11-28)
 *
 * 1080×1350(4:5, 기본) 또는 1080×1440(3:4) 카드를 브라우저 <canvas> 로 그린다. 서버·토큰 없음.
 *  · 사진은 로컬 Blob/ObjectURL 에서만 그린다 — 드라이브는 비공개라 <img> 로 못 쓴다(CSP img-src 'self').
 *  · 글꼴은 이 기기의 Pretendard(400/500/600/700 번들) → Apple SD Gothic → Noto Sans KR 순.
 *  · 보정 프리셋은 canvas filter 로만 건다 — 원본 파일은 건드리지 않는다.
 *  · 개별 PNG 로 내려받는다. 인스타 업로드는 지금은 수동(설계 §5③).
 *
 * 2026-11-28 — 결과물 품질 1차 개선(진단 work/content-hub-quality-diagnosis-20261128.md §3):
 *  · 한 가지 틀(paintCard) → **4타입 레이아웃**: cover(표지) · body(본문) · quote(인용) · cta(마무리).
 *    카드에 type 이 없으면 첫 장 cover / 마지막 cta / 가운데 body 로 자동 배치한다(옛 카드 100% 호환).
 *  · 글자수 근사(splitLines) 대신 **measureText 기반 wrapKo** — 띄어쓰기 없는 긴 단어도 캔버스 밖으로 넘치지 않는다.
 *  · 굵기 위계 복원(400/500/600/700) + 자간 -0.02em + 숫자/핵심어 액센트 밑줄.
 */

import { PHOTO_WATERMARK_DEFAULT, watermarkPoint } from './designModel.js?v=20261127a';

export const CARD_W = 1080;
export const CARD_H = 1350;
export const CARD_RATIO = CARD_W / CARD_H;

/**
 * 카드 비율 프리셋 (2026-11-26) — 4:5 가 기본이고 3:4 를 고를 수 있다.
 *  · 4:5  1080×1350 : 피드 기본(지금까지 만들던 카드)
 *  · 3:4  1080×1440 : 세로가 길어 글자를 더 담고, 저장을 권하는 카드뉴스에 유리
 * 부르는 쪽은 { aspect: '3:4' } 처럼 비율만 넘기면 된다(안 넘기면 4:5 — 기존 동작 그대로).
 */
export const CARD_PRESETS = [
  { id: '4:5', label: '4:5', width: 1080, height: 1350, note: '피드 기본' },
  { id: '3:4', label: '3:4', width: 1080, height: 1440, note: '세로로 길게' }
];
export const CARD_PRESET_DEFAULT = '4:5';

/** 비율 아이디(또는 {aspect}) → 프리셋. 모르는 값은 기본(4:5). */
export function cardPreset(idOrOpts) {
  const raw = (typeof idOrOpts === 'string')
    ? idOrOpts
    : ((idOrOpts && (idOrOpts.aspect || idOrOpts.preset)) || '');
  const id = String(raw || '').trim();
  return CARD_PRESETS.find((p) => p.id === id) || CARD_PRESETS[0];
}
export const CARD_FONT = '"Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif';
// 워터마크 기본값(2026-11-25) — 사진·카드뉴스에도 @s2ongrae 를 기본으로 넣는다(사용자 지시).
export const CARD_WATERMARK_DEFAULT = PHOTO_WATERMARK_DEFAULT;

/** 카드 타입 4종 (2026-11-28) — AI 초안·사람이 card.type 으로 고른다. */
export const CARD_TYPES = ['cover', 'body', 'quote', 'cta'];

/**
 * 카드 한 장의 타입 — card.type 이 있으면 그대로, 없으면 자리로 정한다.
 *  · 한 장뿐이면 cover · 첫 장 cover · 마지막 cta · 가운데 body(옛 카드 데이터가 이 규칙으로 배치된다)
 */
export function cardTypeOf(card, index, total) {
  const raw = String((card && card.type) || '').trim().toLowerCase();
  if (CARD_TYPES.indexOf(raw) >= 0) return raw;
  const n = Number(total);
  const i = Number(index);
  if (Number.isFinite(n) && n <= 1) return 'cover';
  if (Number.isFinite(i) && i <= 0) return 'cover';
  if (Number.isFinite(i) && Number.isFinite(n) && i >= n - 1) return 'cta';
  return 'body';
}

/** 보정 프리셋 — 밝기·따뜻함만. 값은 canvas filter 문자열. */
export const FILTER_PRESETS = [
  { id: 'none', label: '원본', css: 'none' },
  { id: 'bright', label: '밝게', css: 'brightness(1.08) contrast(1.02)' },
  { id: 'warm', label: '따뜻하게', css: 'brightness(1.04) saturate(1.06) sepia(0.08)' },
  { id: 'calm', label: '차분하게', css: 'brightness(0.98) saturate(0.92) contrast(1.04)' }
];

export function filterCss(id) {
  const f = FILTER_PRESETS.find((x) => x.id === id);
  return f ? f.css : 'none';
}

/** 사진을 카드 비율로 '채워' 넣을 때의 원본 자를 위치(가운데). 순수 계산 — 시험용. */
export function coverRect(sw, sh, dw, dh) {
  const w = Number(sw) || 0;
  const h = Number(sh) || 0;
  if (!w || !h) return { sx: 0, sy: 0, sw: 0, sh: 0 };
  const scale = Math.max(dw / w, dh / h);
  const cw = dw / scale;
  const ch = dh / scale;
  return { sx: Math.max(0, (w - cw) / 2), sy: Math.max(0, (h - ch) / 2), sw: cw, sh: ch };
}

/** 글자 수로 줄을 나눈다(measureText 없이) — 2026-11-21 방식. 옛 호출부 호환용으로 남긴다. */
export function splitLines(text, maxChars) {
  const s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  if (!s) return [];
  const n = Math.max(4, Number(maxChars) || 18);
  const out = [];
  let line = '';
  s.split(' ').forEach((word) => {
    if (!line) { line = word; return; }
    if ((line + ' ' + word).length <= n) line += ' ' + word;
    else { out.push(line); line = word; }
  });
  if (line) out.push(line);
  return out;
}

/** 한글 폭 근사 — measureText 를 못 쓸 때만 쓴다(한글은 폭이 거의 같다). */
export function approxWidth(text, fontPx) {
  const n = Array.from(String(text == null ? '' : text)).length;
  return n * (Number(fontPx) || 0) * 0.58;
}

/**
 * 폭 재는 함수 하나로 만든다 — 캔버스가 있으면 measureText, 없으면(또는 0 을 주면) 글자수 근사.
 * wrapKo·fitText 가 같은 자를 쓰게 모아 둔다.
 */
export function makeMeasure(ctx, fontPx, font) {
  return function measure(line) {
    const s = String(line == null ? '' : line);
    if (!s) return 0;
    try {
      if (ctx && typeof ctx.measureText === 'function') {
        if (font) ctx.font = font;
        const m = ctx.measureText(s);
        const w = m && Number(m.width);
        if (Number.isFinite(w) && w > 0) return w;
      }
    } catch (e) { /* 못 재면 근사로 */ }
    return approxWidth(s, fontPx);
  };
}

/**
 * 한국어 줄바꿈 (2026-11-28) — 글자수 근사 대신 실제 폭으로 자른다.
 *  · 띄어쓰기(어절) 단위로 먼저 나누고, 한 어절이 폭을 넘으면 글자 단위로 쪼갠다
 *    → "아주바쁜날먹으러갔더니" 같은 긴 단어도 캔버스 밖으로 넘치지 않는다.
 *  · 줄 끝에 한 글자만 남는 '고아 글자'는 앞 줄에서 한 글자를 당겨 온다.
 * @param {string} text
 * @param {number} maxWidth px
 * @param {(s:string)=>number} measure
 * @returns {string[]}
 */
export function wrapKo(text, maxWidth, measure) {
  const s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  if (!s) return [];
  const limit = Number(maxWidth) || 0;
  const widthOf = (typeof measure === 'function') ? measure : ((t) => approxWidth(t, 32));
  const fits = (t) => !limit || widthOf(t) <= limit;
  const lines = [];
  let line = '';
  s.split(' ').forEach((word) => {
    if (!word) return;
    const next = line ? line + ' ' + word : word;
    if (fits(next)) { line = next; return; }
    if (line) { lines.push(line); line = ''; }
    if (fits(word)) { line = word; return; }
    // 한 어절이 한 줄 폭보다 길다 — 글자 단위로 쪼갠다
    const chars = Array.from(word);
    let piece = '';
    chars.forEach((ch) => {
      const t = piece + ch;
      if (piece && !fits(t)) { lines.push(piece); piece = ch; }
      else piece = t;
    });
    line = piece;
  });
  if (line) lines.push(line);
  // 고아 글자(한 글자만 남은 마지막 줄) 정리 — 앞 줄에서 한 글자를 내려 준다
  for (let i = lines.length - 1; i > 0; i -= 1) {
    const cur = Array.from(lines[i]);
    if (cur.length !== 1) break;
    const prev = Array.from(lines[i - 1]);
    if (prev.length < 4) break;
    const moved = prev.pop();
    lines[i - 1] = prev.join('').replace(/\s+$/, '');
    lines[i] = moved + lines[i];
    if (!fits(lines[i])) break;
  }
  return lines;
}

/**
 * 글자를 상자에 맞춘다 — maxLines 줄 안에 들어올 때까지 폰트를 줄인다(최소 minPx).
 * @returns {{lines:string[], fontPx:number}}
 */
export function fitText(text, opts) {
  const o = opts || {};
  const maxWidth = Number(o.maxWidth) || CARD_W;
  const maxLines = Math.max(1, Number(o.maxLines) || 1);
  const start = Math.max(8, Number(o.fontPx) || 72);
  const min = Math.max(8, Number(o.minPx) || Math.round(start * 0.62));
  const step = Math.max(1, Number(o.step) || 2);
  const weight = Number(o.weight) || 700;
  const measureFor = o.measureFor;   // (fontPx, weight) => measure
  let fontPx = start;
  let lines = [];
  for (;;) {
    const measure = measureFor ? measureFor(fontPx, weight) : ((s) => approxWidth(s, fontPx));
    lines = wrapKo(text, maxWidth, measure);
    if (lines.length <= maxLines || fontPx <= min) break;
    fontPx = Math.max(min, fontPx - step);
  }
  return { lines: lines, fontPx: fontPx };
}

/** 카드 배경·글자색 — 트랙별(대전 청년 오렌지 / 삐약 김메리 테라코타). */
export const CARD_THEME = {
  daejeon_youth: { bg: '#0e1727', panel: '#131d2f', ink: '#f2f6fd', sub: '#a3b3c9', accent: '#ff7a1a' },
  ppiyak_kimmary: { bg: '#141210', panel: '#221e1a', ink: '#f4efe8', sub: '#c2b8ac', accent: '#e08a56' }
};

/* ────────────────────────── 그리기 도구 ────────────────────────── */

const PAD = 72;

function hexToRgba(hex, alpha) {
  const s = String(hex || '').replace('#', '');
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  const n = parseInt(full.slice(0, 6), 16);
  if (!Number.isFinite(n)) return 'rgba(0,0,0,' + alpha + ')';
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

function fontOf(weight, px) {
  return weight + ' ' + Math.round(px) + 'px ' + CARD_FONT;
}

function setLetterSpacing(ctx, value) {
  try { ctx.letterSpacing = value; } catch (e) { /* 지원하지 않는 브라우저 */ }
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  try {
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  } catch (e) { /* 못 그리면 사각형으로 */ }
}

function fillRoundRect(ctx, x, y, w, h, r, style) {
  ctx.save();
  ctx.fillStyle = style;
  roundRectPath(ctx, x, y, w, h, r);
  try { ctx.fill(); } catch (e) { ctx.fillRect(x, y, w, h); }
  ctx.restore();
}

/** 사진 한 장을 주어진 사각형에 '채워' 그린다(비율 유지·가운데 자름·보정 프리셋). */
function paintPhoto(ctx, image, filter, x, y, w, h) {
  if (!image || !w || !h) return false;
  const r = coverRect(image.width, image.height, w, h);
  if (!r.sw || !r.sh) return false;
  ctx.save();
  ctx.filter = filterCss(filter);
  try { ctx.drawImage(image, r.sx, r.sy, r.sw, r.sh, x, y, w, h); } catch (e) { ctx.restore(); return false; }
  ctx.filter = 'none';
  ctx.restore();
  return true;
}

/** 사진 위 글자가 읽히게 까는 그라데이션 — 위 투명 → 아래 theme.bg. */
function paintScrim(ctx, theme, x, y, w, h, solidAlpha) {
  if (!h) return;
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, hexToRgba(theme.bg, 0));
  g.addColorStop(0.45, hexToRgba(theme.bg, solidAlpha == null ? 0.55 : solidAlpha * 0.6));
  g.addColorStop(1, hexToRgba(theme.bg, solidAlpha == null ? 0.94 : solidAlpha));
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
}

/** kicker — 알약(배경 액센트 18%) 위 액센트 글자. */
function paintKicker(ctx, theme, text, x, y, px) {
  const label = String(text || '').replace(/\s+/g, ' ').trim();
  if (!label) return 0;
  const size = px || 34;
  ctx.save();
  ctx.font = fontOf(600, size);
  setLetterSpacing(ctx, '-0.01em');
  const measure = makeMeasure(ctx, size, fontOf(600, size));
  const shown = wrapKo(label, 420, measure)[0] || '';
  const w = measure(shown) + size * 1.2;
  const h = Math.round(size * 1.72);
  fillRoundRect(ctx, x, y, w, h, h / 2, hexToRgba(theme.accent, 0.18));
  ctx.fillStyle = theme.accent;
  ctx.textBaseline = 'middle';
  ctx.fillText(shown, x + size * 0.6, y + h / 2 + 1);
  ctx.restore();
  return w;
}

/** 헤드라인 자간 — 한글 카드에서 가장 큰 차이를 만드는 한 줄. */
function paintHeadlineLines(ctx, lines, x, y, fontPx, lineHeight, theme, opts) {
  const o = opts || {};
  ctx.save();
  ctx.font = fontOf(o.weight || 700, fontPx);
  setLetterSpacing(ctx, '-0.02em');
  ctx.fillStyle = o.color || theme.ink;
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * lineHeight));
  ctx.restore();
}

/**
 * 본문 — 폭에 맞춰 줄을 나누고 남은 높이만큼만 그린다.
 * 넘치는 줄은 '…' 를 붙여 잘린 티를 낸다(조용히 사라지지 않게).
 */
function paintBody(ctx, theme, text, x, y, maxWidth, maxLines, opts) {
  const o = opts || {};
  const px = Number(o.fontPx) || 34;
  const lh = Number(o.lineHeight) || 52;
  const font = fontOf(o.weight || 400, px);
  ctx.save();
  ctx.font = font;
  const measure = makeMeasure(ctx, px, font);
  let lines = wrapKo(text, maxWidth, measure);
  if (maxLines > 0 && lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = wrapKo(last + ' …', maxWidth, measure)[0] || (last + ' …');
  }
  ctx.fillStyle = o.color || theme.sub;
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * lh));
  ctx.restore();
  return lines;
}

/** 헤드라인 안의 핵심어(또는 첫 숫자)에 액센트 밑줄 — 강조가 없으면 아무것도 하지 않는다. */
function paintEmphasis(ctx, theme, line, x, y, fontPx, emphasis) {
  const target = String(emphasis || '').trim();
  if (!target || !line || line.indexOf(target) < 0) return false;
  ctx.save();
  ctx.font = fontOf(700, fontPx);
  const measure = makeMeasure(ctx, fontPx, fontOf(700, fontPx));
  const before = line.slice(0, line.indexOf(target));
  const x0 = x + measure(before);
  const w = measure(target);
  ctx.fillStyle = theme.accent;
  ctx.fillRect(x0, y + fontPx * 1.16, w, Math.max(4, Math.round(fontPx * 0.06)));
  ctx.restore();
  return true;
}

/** 카운터 — '01/07'. total 이 없으면 번호만. */
function counterText(card, total) {
  const no = Number(card && card.no) || 1;
  const n = Number(total);
  const pad2 = (v) => (v < 10 ? '0' + v : String(v));
  return Number.isFinite(n) && n > 0 ? pad2(no) + '/' + pad2(n) : pad2(no);
}

function paintCounter(ctx, theme, card, total, W) {
  ctx.save();
  ctx.font = fontOf(600, 28);
  ctx.fillStyle = theme.sub;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText(counterText(card, total), W - PAD, PAD);
  ctx.restore();
}

function paintBrand(ctx, theme, name, x, y, align) {
  ctx.save();
  ctx.font = fontOf(600, 28);
  ctx.fillStyle = theme.accent;
  ctx.textAlign = align || 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(String(name || '대전 청년'), x, y);
  ctx.restore();
}

/* ────────────────────────── 4타입 레이아웃 ────────────────────────── */

/** 표지(cover) — 사진 풀블리드(없으면 액센트 그라데이션) + 굵은 한 줄 제목 + 카운터. */
function paintCover(ctx, card, image, theme, o, W, H) {
  const brandName = o.brandName || '대전 청년';
  const total = o.total || card.total;
  const photoOk = image ? paintPhoto(ctx, image, o.filter, 0, 0, W, H) : false;
  if (photoOk) {
    paintScrim(ctx, theme, 0, Math.round(H * 0.30), W, Math.round(H * 0.70), 0.96);
  } else {
    const g = ctx.createLinearGradient(0, 0, W * 0.4, H);
    g.addColorStop(0, theme.panel);
    g.addColorStop(1, theme.bg);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // 액센트 레일 — 사진이 없어도 '템플릿'처럼 보이게
    ctx.fillStyle = hexToRgba(theme.accent, 0.9);
    ctx.fillRect(PAD, Math.round(H * 0.17), 96, 8);
  }
  paintCounter(ctx, theme, card, total, W);

  const kickerY = photoOk ? Math.round(H * 0.545) : Math.round(H * 0.24);
  paintKicker(ctx, theme, card.kicker, PAD, kickerY, 34);
  const headlineTop = kickerY + 58 + 40;
  const fit = fitText(card.headline, {
    fontPx: 88, minPx: 56, maxLines: 2, maxWidth: W - PAD * 2, weight: 700,
    measureFor: (px) => makeMeasure(ctx, px, fontOf(700, px))
  });
  paintHeadlineLines(ctx, fit.lines, PAD, headlineTop, fit.fontPx, Math.round(fit.fontPx * 1.14), theme, { weight: 700 });
  if (card.body) {
    const bodyTop = headlineTop + fit.lines.length * Math.round(fit.fontPx * 1.14) + 28;
    const maxLines = Math.max(1, Math.floor((H - PAD - 120 - bodyTop) / 50));
    paintBody(ctx, theme, card.body, PAD, bodyTop, W - PAD * 2, Math.min(2, maxLines), { fontPx: 34, lineHeight: 50 });
  }
  paintBrand(ctx, theme, brandName, PAD, H - PAD - 20);
}

/** 본문(body) — 사진 위 52% + 아래 글. 헤드라인 76px · 본문 34px. */
function paintBodyCard(ctx, card, image, theme, o, W, H) {
  const brandName = o.brandName || '대전 청년';
  const total = o.total || card.total;
  const photoH = image ? Math.round(H * 0.52) : 0;
  const photoOk = image ? paintPhoto(ctx, image, o.filter, 0, 0, W, photoH) : false;
  if (photoOk) paintScrim(ctx, theme, 0, photoH - 220, W, 220, 0.98);

  const top = photoOk ? photoH + 34 : 120;
  if (!photoOk) {
    ctx.fillStyle = hexToRgba(theme.accent, 0.9);
    ctx.fillRect(PAD, 80, 64, 8);
  }
  // 번호 + kicker
  ctx.save();
  ctx.font = fontOf(600, 34);
  ctx.fillStyle = theme.accent;
  ctx.textBaseline = 'top';
  ctx.fillText(counterText(card, total), PAD, top);
  ctx.restore();
  ctx.save();
  ctx.font = fontOf(600, 32);
  ctx.fillStyle = theme.sub;
  ctx.textBaseline = 'top';
  const kickerMeasure = makeMeasure(ctx, 32, fontOf(600, 32));
  const kicker = wrapKo(card.kicker, 520, kickerMeasure)[0] || '';
  if (kicker) ctx.fillText(kicker, PAD + 128, top + 2);
  ctx.restore();

  const fit = fitText(card.headline, {
    fontPx: 76, minPx: 48, maxLines: 2, maxWidth: W - PAD * 2, weight: 700,
    measureFor: (px) => makeMeasure(ctx, px, fontOf(700, px))
  });
  const headlineTop = top + 78;
  const lineHeight = Math.round(fit.fontPx * 1.16);
  paintHeadlineLines(ctx, fit.lines, PAD, headlineTop, fit.fontPx, lineHeight, theme, { weight: 700 });
  if (fit.lines.length && card.emphasis) {
    paintEmphasis(ctx, theme, fit.lines[0], PAD, headlineTop, fit.fontPx, card.emphasis);
  }

  const bodyTop = headlineTop + fit.lines.length * lineHeight + 30;
  const room = H - PAD - 70 - bodyTop;
  const maxLines = Math.max(1, Math.floor(room / 52));
  paintBody(ctx, theme, card.body, PAD, bodyTop, W - PAD * 2, maxLines, { fontPx: 34, lineHeight: 52 });
  paintBrand(ctx, theme, brandName, PAD, H - PAD - 20);
}

/** 인용(quote) — 단색 + 가운데 정렬 96px 한 줄 강조 + 출처 한 줄. */
function paintQuote(ctx, card, image, theme, o, W, H) {
  const brandName = o.brandName || '대전 청년';
  const total = o.total || card.total;
  if (image) {
    const ok = paintPhoto(ctx, image, o.filter, 0, 0, W, H);
    if (ok) {
      ctx.fillStyle = hexToRgba(theme.bg, 0.82);
      ctx.fillRect(0, 0, W, H);
    }
  }
  paintCounter(ctx, theme, card, total, W);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = hexToRgba(theme.accent, 0.55);
  ctx.font = fontOf(700, 150);
  ctx.textBaseline = 'top';
  ctx.fillText('“', W / 2, Math.round(H * 0.16));
  ctx.restore();

  const fit = fitText(card.headline || card.body, {
    fontPx: 96, minPx: 54, maxLines: 3, maxWidth: W - PAD * 2 - 24, weight: 700,
    measureFor: (px) => makeMeasure(ctx, px, fontOf(700, px))
  });
  const lineHeight = Math.round(fit.fontPx * 1.22);
  const blockH = fit.lines.length * lineHeight;
  const top = Math.max(Math.round(H * 0.36), Math.round((H - blockH) / 2) - 40);
  ctx.save();
  ctx.font = fontOf(700, fit.fontPx);
  setLetterSpacing(ctx, '-0.02em');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = theme.ink;
  fit.lines.forEach((l, i) => ctx.fillText(l, W / 2, top + i * lineHeight));
  ctx.restore();

  const source = String(card.source || card.kicker || '').trim();
  if (source) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = fontOf(500, 30);
    ctx.fillStyle = theme.sub;
    ctx.fillText(source, W / 2, top + blockH + 44);
    ctx.restore();
  }
  if (card.body && fit.lines.join(' ').indexOf(String(card.body).slice(0, 10)) < 0) {
    paintBody(ctx, theme, card.body, PAD, top + blockH + 110, W - PAD * 2, 3, { fontPx: 32, lineHeight: 48, color: theme.sub });
  }
  paintBrand(ctx, theme, brandName, W / 2, H - PAD - 20, 'center');
}

/** 마무리(cta) — 큰 '저장' + 브랜드 자리. 사진이 있으면 어둡게 깔고 그 위에. */
function paintCta(ctx, card, image, theme, o, W, H) {
  const brandName = o.brandName || '대전 청년';
  const total = o.total || card.total;
  if (image) {
    const ok = paintPhoto(ctx, image, o.filter, 0, 0, W, H);
    if (ok) {
      ctx.fillStyle = hexToRgba(theme.bg, 0.86);
      ctx.fillRect(0, 0, W, H);
    }
  } else {
    const g = ctx.createLinearGradient(0, H, W, 0);
    g.addColorStop(0, theme.bg);
    g.addColorStop(1, theme.panel);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  paintCounter(ctx, theme, card, total, W);

  const fit = fitText(card.headline || '저장해 두세요', {
    fontPx: 96, minPx: 56, maxLines: 2, maxWidth: W - PAD * 2, weight: 700,
    measureFor: (px) => makeMeasure(ctx, px, fontOf(700, px))
  });
  const lineHeight = Math.round(fit.fontPx * 1.18);
  const blockH = fit.lines.length * lineHeight;
  const top = Math.round(H * 0.32);
  paintHeadlineLines(ctx, fit.lines, PAD, top, fit.fontPx, lineHeight, theme, { weight: 700 });
  if (card.emphasis) paintEmphasis(ctx, theme, fit.lines[0], PAD, top, fit.fontPx, card.emphasis);

  const bodyTop = top + blockH + 30;
  paintBody(ctx, theme, card.body, PAD, bodyTop, W - PAD * 2, 3, { fontPx: 34, lineHeight: 54 });

  // 저장 버튼 자리 — 큰 알약 하나(글자는 카드 문구, 없으면 '저장')
  const label = String(card.cta || '저장').trim().slice(0, 12) || '저장';
  ctx.save();
  ctx.font = fontOf(700, 40);
  setLetterSpacing(ctx, '-0.01em');
  const measure = makeMeasure(ctx, 40, fontOf(700, 40));
  const w = measure(label) + 176;
  const h = 112;
  const x = PAD;
  const y = H - PAD - 190;
  fillRoundRect(ctx, x, y, w, h, h / 2, theme.accent);
  ctx.fillStyle = theme.bg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, y + h / 2 + 2);
  ctx.restore();

  paintBrand(ctx, theme, brandName, PAD, H - PAD - 20);
}

/** 카드 한 장 — 타입에 따라 레이아웃을 고른다. 반환: 그렸는지 */
function paintCard(canvas, card, image, opts) {
  const o = opts || {};
  const theme = o.theme || CARD_THEME.daejeon_youth;
  if (!canvas || typeof canvas.getContext !== 'function') return false;
  const size = o.size || cardPreset(o);
  const W = size.width;
  const H = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  canvas.width = W;
  canvas.height = H;
  const c = card && typeof card === 'object' ? card : {};

  ctx.save();
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);
  const type = cardTypeOf(c, o.index, o.total);
  const pass = { brandName: o.brandName, filter: o.filter, total: o.total || c.total, type: type };
  if (type === 'quote') paintQuote(ctx, c, image, theme, pass, W, H);
  else if (type === 'cta') paintCta(ctx, c, image, theme, pass, W, H);
  else if (type === 'body') paintBodyCard(ctx, c, image, theme, pass, W, H);
  else paintCover(ctx, c, image, theme, pass, W, H);

  // 워터마크(2026-11-25) — 옅은 흰 글씨 + 얇은 그림자. 브랜드 이름과 반대쪽 모서리(기본 오른쪽 아래).
  paintWatermark(ctx, o.watermark, size);
  ctx.restore();
  return true;
}

/** 카드 워터마크 자리 — designModel.watermarkPoint 를 카드 비율(기본 1080×1350)에 맞춰 쓴다. */
export function cardWatermarkPoint(position, size) {
  const s = size || { width: CARD_W, height: CARD_H };
  return watermarkPoint(position, { width: s.width, height: s.height, pad: 48, yTop: 54, yBottom: s.height - 54 });
}

function paintWatermark(ctx, raw, size) {
  const wm = raw === false ? null : Object.assign({}, CARD_WATERMARK_DEFAULT, raw && typeof raw === 'object' ? raw : {});
  if (!wm || wm.enabled === false) return;
  const text = String(wm.text || '').trim();
  if (!text) return;
  const p = cardWatermarkPoint(wm.position, size);
  ctx.save();
  ctx.font = '700 ' + (Number(wm.size) || 30) + 'px ' + CARD_FONT;
  ctx.textAlign = p.align;
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = Math.max(0.05, Math.min(1, (Number(wm.opacity) || 45) / 100));
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(text, p.x, p.y);
  ctx.restore();
}

/** 카드 한 장을 캔버스에 그린다. 반환: canvas | null */
export function drawCard(card, image, opts) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  return paintCard(canvas, card || {}, image || null, opts) ? canvas : null;
}

/**
 * 인스타 카드뉴스 초안(draft.slides — {no,kicker,headline,body,type?}) → 캔버스 카드 모양.
 *  · type 이 없으면 첫 장 cover / 마지막 cta / 가운데 body 로 자리에서 정한다(2026-11-28).
 *  · total 을 같이 담아 '01/07' 카운터가 모든 장에서 같은 수를 센다.
 */
export function cardsFromSlides(slides) {
  const list = Array.isArray(slides) ? slides : [];
  const n = list.length;
  return list.map((s, i) => {
    const o = s && typeof s === 'object' ? s : {};
    return {
      no: Number(o.no) || i + 1,
      kicker: String(o.kicker || ''),
      headline: String(o.headline || ''),
      body: String(o.body || ''),
      type: cardTypeOf(o, i, n),
      total: n,
      emphasis: String(o.emphasis || ''),
      source: String(o.source || '')
    };
  });
}

/**
 * 카드용 글꼴을 미리 받아 둔다(2026-11-28) — canvas 는 폰트가 준비되기 전에 그리면 폴백 글꼴로 굽는다.
 * 부르는 쪽은 이 약속을 await 한 뒤 drawCard 를 부르면 된다. 실패해도 그리기는 계속된다.
 */
export async function warmCardFonts() {
  try {
    if (typeof document === 'undefined' || !document.fonts || typeof document.fonts.load !== 'function') return false;
    const jobs = [400, 500, 600, 700].map((w) => {
      try { return document.fonts.load(fontOf(w, 88)); } catch (e) { return Promise.resolve(); }
    });
    await Promise.all(jobs);
    return true;
  } catch (e) { return false; }
}

/** 캔버스 → PNG Blob. */
export function canvasToPng(canvas) {
  return new Promise((resolve) => {
    if (!canvas || typeof canvas.toBlob !== 'function') return resolve(null);
    try { canvas.toBlob((b) => resolve(b), 'image/png'); } catch (e) { resolve(null); }
  });
}

/** objectURL → 그릴 수 있는 이미지. 실패하면 null(사진 없이 글자만 남긴다). */
export async function loadImage(url) {
  if (typeof Image === 'undefined' || !url) return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Blob → 파일 이름 붙은 다운로드. */
export function downloadBlob(blob, filename) {
  if (typeof document === 'undefined' || !blob) return false;
  try {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return true;
  } catch (e) { return false; }
}

/** 카드 묶음 PNG 파일 이름 — '미미삼겹_카드1.png' */
export function cardFileName(place, no) {
  const base = String(place || '카드').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 30);
  return base + '_카드' + (no || 1) + '.png';
}
