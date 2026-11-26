/**
 * js/studioCanvas.js — 인스타 4:5 카드 PNG 만들기 (2026-11-21, O1)
 *
 * 1080×1350 카드 6장을 브라우저 <canvas> 로 그린다. 서버·토큰 없음.
 *  · 사진은 로컬 Blob/ObjectURL 에서만 그린다 — 드라이브는 비공개라 <img> 로 못 쓴다(CSP img-src 'self').
 *  · 글꼴은 이 기기의 Pretendard → Apple SD Gothic → Noto Sans KR 순. 웹폰트를 새로 받지 않는다(CSP font-src 'self').
 *  · 보정 프리셋은 canvas filter 로만 건다 — 원본 파일은 건드리지 않는다.
 *  · 개별 PNG 로 내려받는다. 인스타 업로드는 지금은 수동(설계 §5③).
 */

import { PHOTO_WATERMARK_DEFAULT, watermarkPoint } from './designModel.js?v=20261126c';

export const CARD_W = 1080;
export const CARD_H = 1350;
export const CARD_RATIO = CARD_W / CARD_H;
export const CARD_FONT = '"Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif';
// 워터마크 기본값(2026-11-25) — 사진·카드뉴스에도 @s2ongrae 를 기본으로 넣는다(사용자 지시).
export const CARD_WATERMARK_DEFAULT = PHOTO_WATERMARK_DEFAULT;

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

/** 글자 수로 줄을 나눈다(measureText 없이) — 한글은 폭이 거의 같아 이 근사로 충분하다. */
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

/** 카드 배경·글자색 — 트랙별(대전 청년 오렌지 / 삐약 김메리 테라코타). */
export const CARD_THEME = {
  daejeon_youth: { bg: '#0e1727', panel: '#131d2f', ink: '#f2f6fd', sub: '#a3b3c9', accent: '#ff7a1a' },
  ppiyak_kimmary: { bg: '#141210', panel: '#221e1a', ink: '#f4efe8', sub: '#c2b8ac', accent: '#e08a56' }
};

/** 사진이 있을 때 카드에 그리는 그림 — 위 60% 사진, 아래 글. */
function paintCard(canvas, card, image, opts) {
  const o = opts || {};
  const theme = o.theme || CARD_THEME.daejeon_youth;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const pad = 72;
  ctx.save();
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  const photoH = image ? Math.round(CARD_H * 0.58) : 0;
  if (image && photoH) {
    const r = coverRect(image.width, image.height, CARD_W, photoH);
    ctx.filter = filterCss(o.filter);
    try { ctx.drawImage(image, r.sx, r.sy, r.sw, r.sh, 0, 0, CARD_W, photoH); } catch (e) { /* 못 그리면 글자만 */ }
    ctx.filter = 'none';
    // 사진 아래 그라데이션 — 글자와 사진 경계를 부드럽게
    const g = ctx.createLinearGradient(0, photoH - 160, 0, photoH);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, theme.bg);
    ctx.fillStyle = g;
    ctx.fillRect(0, photoH - 160, CARD_W, 160);
  }

  const top = image ? photoH + 34 : 120;
  ctx.textBaseline = 'top';
  // 번호 + kicker
  ctx.font = '700 34px ' + CARD_FONT;
  ctx.fillStyle = theme.accent;
  ctx.fillText('0' + (card.no || 1), pad, top);
  ctx.font = '600 32px ' + CARD_FONT;
  ctx.fillStyle = theme.sub;
  const kicker = splitLines(card.kicker, 26)[0] || '';
  if (kicker) ctx.fillText(kicker, pad + 92, top + 2);

  // 헤드라인 — 2줄까지, 넘치면 글자를 줄인다
  let size = 72;
  let lines = [];
  while (size >= 40) {
    ctx.font = '800 ' + size + 'px ' + CARD_FONT;
    lines = splitLines(card.headline, Math.floor((CARD_W - pad * 2) / (size * 0.62)));
    if (lines.length <= 2) break;
    size -= 6;
  }
  ctx.fillStyle = theme.ink;
  lines.slice(0, 2).forEach((l, i) => ctx.fillText(l, pad, top + 82 + i * (size + 10)));

  // 본문 — 남은 높이만큼만
  const bodyTop = top + 82 + Math.min(lines.length, 2) * (size + 10) + 26;
  ctx.font = '500 36px ' + CARD_FONT;
  ctx.fillStyle = theme.sub;
  const bodyLines = splitLines(card.body, 28);
  const maxLines = Math.max(1, Math.floor((CARD_H - bodyTop - pad - 40) / 54));
  bodyLines.slice(0, maxLines).forEach((l, i) => ctx.fillText(l, pad, bodyTop + i * 54));

  // 꼬리 — 저장 유도
  ctx.font = '600 28px ' + CARD_FONT;
  ctx.fillStyle = theme.accent;
  ctx.fillText(o.brandName || '대전 청년', pad, CARD_H - pad - 20);

  // 워터마크(2026-11-25) — 옅은 흰 글씨 + 얇은 그림자. 브랜드 이름과 반대쪽 모서리(기본 오른쪽 아래).
  paintWatermark(ctx, o.watermark);
  ctx.restore();
  return true;
}

/** 카드 워터마크 자리(1080×1350) — designModel.watermarkPoint 를 카드 비율에 맞춰 쓴다. */
export function cardWatermarkPoint(position) {
  return watermarkPoint(position, { width: CARD_W, height: CARD_H, pad: 48, yTop: 54, yBottom: CARD_H - 54 });
}

function paintWatermark(ctx, raw) {
  const wm = raw === false ? null : Object.assign({}, CARD_WATERMARK_DEFAULT, raw && typeof raw === 'object' ? raw : {});
  if (!wm || wm.enabled === false) return;
  const text = String(wm.text || '').trim();
  if (!text) return;
  const p = cardWatermarkPoint(wm.position);
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
