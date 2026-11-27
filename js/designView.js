/**
 * js/designView.js — ⑥ 마무리 '글자 디자인 · 구간 제목' 패널 + 웹 캔버스 미리보기 (2026-11-25, Phase 1)
 *
 * 무엇을 하나
 *  · 자막 프리셋 5종 · 글자색/외곽선/그림자/검정 박스(진하기·둥글기) · 자막 위치 X/Y
 *  · 구간 제목(노란 글씨)·배지(검정 알약) — 최대 6구간, '자막 범위로' 스냅
 *  · 1080×1920 캔버스를 360px 로 줄여 실시간으로 보여 주고, 끌어서 위치를 옮긴다.
 *    배경은 **이 기기에서 고른 파일**(사진 또는 영상의 한 프레임)만 쓴다 — 아무것도 올리지 않는다.
 *
 * 값은 state.design 하나에만 두고(카드 studio.formats.video.design), 계산·검사는 js/designModel.js 가 한다.
 * 렌더링은 createElement/textContent 만 — innerHTML 을 쓰지 않는다(공개 저장소 CSP 규칙).
 */
import {
  PRESETS, COLOR_SWATCHES, ROLE_LABELS, MAX_SEGMENTS, MAX_SEG_TITLE, MAX_SEG_BADGE,
  normalizeDesign, defaultDesign, applyPreset, applyTimeline, designWarnings, captionLayout, designSummary,
  snapSegmentToCues, SAFE_TOP, SAFE_BOTTOM, SAFE_SIDE, CAPTION_DEFAULT_Y, W, H,
  WATERMARK_POSITIONS, watermarkPoint,
  FONT_STACK, BUILTIN_FONT, FONT_LICENSES, checkFontLicense, fontLabel, fontRenderNote,
  isBuiltinFont, canvasFontFamily, customFontAlias
} from './designModel.js?v=20261127a';
import { listFonts, uploadFont, fetchFontBytes, isFontFile } from './uploadVideo.js?v=20261127a';
import { wrapText } from './wrapKo.js?v=20261127c';

/* ⑥ 글자 디자인 — 폰트(2026-11-27, P0)
 *  · 기본은 Pretendard(허브에 들어 있는 OFL 폰트). 내 폰트는 _fonts 보관함에 올린 것만 고를 수 있다.
 *  · 올리기는 재배포 가능한 라이선스(OFL·Apache·MIT·CC0·CC BY·퍼블릭 도메인)만 — 화면에서 라이선스를 고르고 확인을 받은 뒤
 *    서버(font_put)가 다시 검사한다. 상용·개인용 라이선스는 목록에 없다(파일 보관 불가).
 *  · 고른 폰트는 역할의 font 값(파일 이름)으로 카드에 저장되고, 미리보기는 FontFace 로 같은 파일을 읽어 그린다.
 */
let FONT_ITEMS = [];          // 보관함에 올라온 폰트 [{ name, label, license, parts, ... }]
const FONT_READY = {};        // 파일 이름 → true(불러옴) | 'loading' | 'failed'

export function designPanel(ctx) {
  const { h, state, change, toast } = ctx;
  const cues = Array.isArray(ctx.cues) ? ctx.cues : [];
  const styleSize = Number(ctx.size) > 0 ? Number(ctx.size) : 68;
  const duration = Number(ctx.duration) > 0 ? Number(ctx.duration) : 0;
  const hookEnd = Number(ctx.hookEnd) > 0 ? Number(ctx.hookEnd) : 0;
  const brandBadge = ctx.brandBadge !== false;

  let role = 'caption';
  let sampleText = cues.length ? String(cues[0].text || '').replace(/\*\*/g, '') : '16,000원 맞아? 반찬부터 깔린다';
  let bg = null;            // 배경(Image 또는 Video) — 이 기기 메모리에만 있다
  let bgUrl = '';

  const d = () => normalizeDesign(state.design);
  const save = (next) => change((s) => { s.design = next; });

  /* ── 내 폰트(2026-11-27) ─────────────────────────────────── */
  const FONT_UI = { showUpload: false, agree: false, note: '', loaded: false };
  let fontListPromise = null;
  function loadFontList() {
    if (fontListPromise || !ctx.api || typeof listFonts !== 'function') return;
    fontListPromise = listFonts(ctx.api)
      .then((items) => { FONT_ITEMS = items; FONT_UI.loaded = true; paintRole(); draw(); })
      .catch(() => { FONT_UI.loaded = true; });
  }
  /** 내 폰트를 이 화면에서 쓸 수 있게 불러온다(FontFace). 실패해도 렌더는 계속된다(MP4 는 노트북이 읽는다). */
  function ensureFont(name) {
    const n = String(name == null ? '' : name);
    if (isBuiltinFont(n) || FONT_READY[n]) return;
    if (!ctx.api || typeof fetchFontBytes !== 'function') return;
    if (typeof FontFace !== 'function' || typeof document === 'undefined' || !document.fonts) return;
    const item = FONT_ITEMS.find((f) => f.name === n);
    if (!item) return;
    FONT_READY[n] = 'loading';
    fetchFontBytes(ctx.api, item)
      .then((bytes) => new FontFace(customFontAlias(n), bytes.buffer).load())
      .then((face) => { document.fonts.add(face); FONT_READY[n] = true; draw(); })
      .catch(() => { FONT_READY[n] = 'failed'; paintRole(); draw(); });
  }
  function fontOptions(cur) {
    const opts = [h('option', { value: BUILTIN_FONT, selected: isBuiltinFont(cur) ? '' : null, text: 'Pretendard (기본)' })];
    FONT_ITEMS.forEach((f) => {
      opts.push(h('option', { value: f.name, selected: cur === f.name ? '' : null, text: fontLabel(f.name) + ' · ' + (f.license || '') }));
    });
    if (!isBuiltinFont(cur) && !FONT_ITEMS.some((f) => f.name === cur)) {
      opts.push(h('option', { value: cur, selected: '', text: fontLabel(cur) + ' · 보관함에 없음' }));
    }
    return opts;
  }
  /** 올리기 판 — 라이선스를 고르고 확인을 받은 뒤에만 보낸다(서버도 같은 규칙으로 다시 본다). */
  function fontUploadBlock(roleKey) {
    const fileEl = h('input', { type: 'file', accept: '.ttf,.otf,.woff2,font/ttf,font/otf,font/woff2', 'aria-label': '내 폰트 파일' });
    const fileName = h('span', { class: 'pr-check-s', text: FONT_UI.note });
    fileEl.addEventListener('change', () => {
      const f = fileEl.files && fileEl.files[0];
      fileName.textContent = f ? (f.name + ' · ' + Math.max(1, Math.round(Number(f.size) / 1024)) + 'KB') : '';
    });
    const fileBtn = h('label', { class: 'btn sm dg-filebtn' }, fileEl, h('span', { text: '폰트 파일 고르기 (ttf·otf·woff2)' }));
    const licSel = h('select', { class: 'pr-sel', 'aria-label': '내 폰트 라이선스' },
      ...FONT_LICENSES.filter((l) => l.ok).map((l) => h('option', { value: l.id, selected: l.id === 'OFL-1.1' ? '' : null, text: l.label })));
    const agree = h('input', { type: 'checkbox' });
    const prog = h('span', { class: 'pr-check-s', text: '' });
    const up = h('button', { class: 'btn primary', type: 'button', text: '보관함에 올리기' });
    up.addEventListener('click', async () => {
      const file = fileEl.files && fileEl.files[0];
      if (!file) { toast('폰트 파일을 고르세요', 'err'); return; }
      if (!isFontFile(file.name)) { toast('ttf·otf·woff2 파일만 올릴 수 있습니다', 'err'); return; }
      const lic = checkFontLicense(licSel.value);
      if (!lic.ok) { toast(lic.error, 'err'); return; }
      if (!agree.checked) { toast('라이선스 확인에 체크해 주세요', 'err'); return; }
      up.disabled = true;
      FONT_UI.note = '';
      try {
        const r = await uploadFont({ api: ctx.api, file: file, license: licSel.value, onProgress: (p) => { prog.textContent = '올리는 중… ' + p.index + '/' + p.parts; } });
        FONT_ITEMS = await listFonts(ctx.api).catch(() => FONT_ITEMS);
        // 목록을 못 불러왔어도 방금 올린 폰트는 바로 고를 수 있게 둔다(미리보기·선택지).
        if (!FONT_ITEMS.some((f) => f.name === r.name)) FONT_ITEMS = FONT_ITEMS.concat([{ name: r.name, label: r.label, license: r.license, parts: r.parts, complete: true }]);
        FONT_UI.showUpload = false;
        const design = d();
        design.roles[roleKey].font = r.name;
        save(design);
        paintRole(); refresh();
        ensureFont(r.name);
        toast('폰트를 보관함에 올렸어요: ' + r.label, 'ok');
      } catch (err) {
        prog.textContent = '';
        FONT_UI.note = String((err && err.message) || '').slice(0, 120);
        toast('올리지 못했어요 — ' + ((err && err.message) || '연결 확인'), 'err');
        paintRole();
      } finally { up.disabled = false; }
    });
    return h('div', { class: 'pr-field dg-fontup' },
      h('span', { class: 'pr-check-s', text: '재배포 가능한 라이선스만 — 라이선스를 고르고 확인에 체크해야 올라갑니다.' }),
      h('div', { class: 'pr-row' }, fileBtn, licSel, up),
      fileName,
      h('label', { class: 'pr-check' }, agree, h('span', null,
        h('span', { class: 'pr-check-t', text: '이 폰트를 다시 배포해도 된다는 것을 확인했어요' }),
        h('span', { class: 'pr-check-s', text: 'OFL·Apache·MIT·CC0·CC BY·퍼블릭 도메인만 해당합니다. 상용·개인용 라이선스는 파일 보관이 안 됩니다.' }))),
      prog);
  }
  function fontBlock(roleKey, cur) {
    const kids = [
      h('span', { class: 'pr-label', text: '폰트' }),
      h('div', { class: 'pr-row' },
        h('select', {
          class: 'pr-sel', 'aria-label': ROLE_LABELS[roleKey] + ' 폰트',
          onchange: (e) => {
            const design = d();
            design.roles[roleKey].font = e.target.value;
            save(design);
            refresh();
            ensureFont(e.target.value);
          }
        }, ...fontOptions(cur)),
        h('button', {
          class: 'btn sm', type: 'button', text: FONT_UI.showUpload ? '닫기' : '＋ 내 폰트 올리기',
          onclick: () => { FONT_UI.showUpload = !FONT_UI.showUpload; paintRole(); }
        })),
      isBuiltinFont(cur) ? h('span', { class: 'pr-check-s', text: '기본 Pretendard(OFL) — 허브에 들어 있어 따로 올리지 않아도 됩니다.' }) : null,
      !isBuiltinFont(cur) && fontRenderNote(cur) ? h('span', { class: 'pr-check-s', text: fontRenderNote(cur) }) : null,
      !isBuiltinFont(cur) && FONT_READY[cur] === 'failed' ? h('span', { class: 'pr-check-s', text: '이 기기에서 미리보기를 못 불러왔어요 — MP4 에는 노트북이 보관함에서 받아 넣습니다.' }) : null,
      FONT_UI.showUpload ? fontUploadBlock(roleKey) : null,
      h('span', { class: 'pr-check-s', text: '내 폰트는 보관함(비공개 드라이브)에 올린 것만 고를 수 있어요 — 모든 카드가 같이 씁니다.' })
    ];
    return h('div', { class: 'pr-field dg-font' }, ...kids.filter((k) => k != null));
  }

  /* ── 미리보기 캔버스 ─────────────────────────────────────────── */
  const canvas = h('canvas', { class: 'dg-canvas', width: String(W), height: String(H), 'aria-label': '글자 디자인 미리보기' });
  // 캔버스를 못 쓰는 브라우저(아주 오래된 웹뷰)에서도 패널은 열린다 — 미리보기만 건너뛴다.
  let g = null;
  try { g = canvas.getContext ? canvas.getContext('2d') : null; } catch (e) { g = null; }
  const posLine = h('span', { class: 'dg-pos', text: '' });
  const sumLine = h('span', { class: 'pr-check-s', text: '' });

  function drawBackground() {
    g.save();
    g.fillStyle = '#1b1b1b';
    g.fillRect(0, 0, W, H);
    if (bg) {
      const vw = bg.videoWidth || bg.naturalWidth || W;
      const vh = bg.videoHeight || bg.naturalHeight || H;
      const s = Math.max(W / vw, H / vh);
      const dw = vw * s, dh = vh * s;
      try { g.drawImage(bg, (W - dw) / 2, (H - dh) / 2, dw, dh); } catch (e) { /* 첫 프레임 전이면 회색 */ }
      g.fillStyle = 'rgba(0,0,0,0.18)';
      g.fillRect(0, 0, W, H);
    } else {
      // 배경이 없을 때: 어두운 화면 + 위아래 안내(사진을 골라 얹으면 실제 화면에서 보인다)
      g.fillStyle = '#2a2a2a';
      g.fillRect(0, 0, W, 220);
      g.fillRect(0, H - 300, W, 300);
      g.fillStyle = 'rgba(255,255,255,0.10)';
      for (let y = 0; y < H; y += 120) g.fillRect(0, y, W, 2);
    }
    g.restore();
    // 안전선(표준 v3) — 옅은 점선
    g.save();
    g.strokeStyle = 'rgba(255,255,255,0.28)';
    g.setLineDash([12, 12]);
    g.lineWidth = 3;
    g.strokeRect(SAFE_SIDE, SAFE_TOP, W - SAFE_SIDE * 2, SAFE_BOTTOM - SAFE_TOP);
    g.restore();
  }

  function drawCaptionSample(design) {
    const cap = design.roles.caption;
    const lines = wrapText(sampleText, 12, 2, true);
    const layout = captionLayout(cap, { size: styleSize, lines });
    if (layout.box) {
      g.save();
      g.fillStyle = 'rgba(0,0,0,' + (cap.box.alpha / 100) + ')';
      roundRect(g, layout.box.x, layout.box.y, layout.box.w, layout.box.h, cap.box.radius);
      g.fill();
      g.restore();
    }
    g.save();
    g.font = '700 ' + styleSize + 'px ' + canvasFontFamily(cap.font);
    g.textAlign = 'center';
    g.textBaseline = 'bottom';
    g.lineJoin = 'round';
    // 외곽선은 그림자 없이 먼저(그림자가 두 번 겹치지 않게)
    if (cap.outline.px > 0) {
      g.strokeStyle = cap.outline.color;
      g.lineWidth = cap.outline.px * 2;
      layout.lines.forEach((line, i) => {
        g.strokeText(line, layout.text.x, layout.text.y - (layout.lines.length - 1 - i) * layout.lineHeight);
      });
    }
    if (cap.shadow.on) {
      g.shadowColor = 'rgba(0,0,0,' + (cap.shadow.alpha / 100) + ')';
      g.shadowBlur = cap.shadow.blur * 2;
      g.shadowOffsetX = cap.shadow.x * 2;
      g.shadowOffsetY = cap.shadow.y * 2;
    }
    g.fillStyle = cap.color;
    layout.lines.forEach((line, i) => {
      g.fillText(line, layout.text.x, layout.text.y - (layout.lines.length - 1 - i) * layout.lineHeight);
    });
    g.restore();
    return layout;
  }

  function drawSegmentSample(design) {
    const seg = design.segments[0];
    const t = design.roles.title;
    const b = design.roles.badge;
    const titleText = (seg && seg.title) || (role === 'title' ? '구간 제목' : '');
    const badgeText = (seg && seg.badge) || (role === 'badge' ? '구간 배지' : '');
    if (titleText) {
      g.save();
      g.font = '700 ' + t.size + 'px ' + canvasFontFamily(t.font);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineJoin = 'round';
      g.strokeStyle = '#111111';
      g.lineWidth = 6;
      g.strokeText(titleText, 540 + t.pos.x, t.pos.y);
      g.fillStyle = t.color;
      g.fillText(titleText, 540 + t.pos.x, t.pos.y);
      g.restore();
    }
    if (badgeText) {
      g.save();
      g.font = '700 ' + b.size + 'px ' + canvasFontFamily(b.font);
      const tw = g.measureText(badgeText).width;
      const bw = Math.max(120, tw + 48);
      const bh = b.size + 24;
      const bx = 540 + b.pos.x - bw / 2;
      if (b.pill) {
        g.fillStyle = 'rgba(0,0,0,0.88)';
        roundRect(g, bx, b.pos.y, bw, bh, bh / 2);
        g.fill();
      }
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = b.color;
      g.fillText(badgeText, 540 + b.pos.x, b.pos.y + bh / 2);
      g.restore();
    }
  }

  function drawWatermark(design) {
    const wm = design.watermark;
    if (!wm.enabled || !wm.text) return;
    const p = watermarkPoint(wm.position, { pad: 72 });
    g.save();
    g.font = '700 ' + wm.size + 'px ' + FONT_STACK;
    g.textAlign = p.align;
    g.textBaseline = 'middle';
    g.globalAlpha = Math.max(0.05, Math.min(1, wm.opacity / 100));
    g.shadowColor = 'rgba(0,0,0,0.55)';
    g.shadowBlur = 4;
    g.shadowOffsetY = 1;
    g.fillStyle = '#FFFFFF';
    g.fillText(wm.text, p.x, p.y);
    g.restore();
  }

  function draw() {
    if (!g) return;
    const design = d();
    // 내 폰트가 고른 역할에 있으면 먼저 불러온다 — 아직이면 폴백(Pretendard)으로 그리고, 불러오면 다시 그린다.
    ['caption', 'title', 'badge'].forEach((k) => ensureFont(design.roles[k] && design.roles[k].font));
    drawBackground();
    drawCaptionSample(design);
    drawSegmentSample(design);
    drawWatermark(design);
    const p = design.roles[role] || design.roles.caption;
    const y = p.pos ? p.pos.y : 0;
    const x = p.pos ? p.pos.x : 0;
    posLine.textContent = '지금 위치 ' + ROLE_LABELS[role] + ' Y' + y + ' · X' + x;
    sumLine.textContent = designSummary(design);
  }

  function roundRect(c2, x, y, w, hh, r) {
    const rr = Math.max(0, Math.min(Number(r) || 0, Math.min(w, hh) / 2));
    c2.beginPath();
    c2.moveTo(x + rr, y);
    c2.lineTo(x + w - rr, y);
    c2.quadraticCurveTo(x + w, y, x + w, y + rr);
    c2.lineTo(x + w, y + hh - rr);
    c2.quadraticCurveTo(x + w, y + hh, x + w - rr, y + hh);
    c2.lineTo(x + rr, y + hh);
    c2.quadraticCurveTo(x, y + hh, x, y + hh - rr);
    c2.lineTo(x, y + rr);
    c2.quadraticCurveTo(x, y, x + rr, y);
    c2.closePath();
  }

  /* ── 끌어서 옮기기 ─────────────────────────────────────────── */
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    const pt = canvasPoint(e);
    const p = d().roles[role];
    drag = { px: pt.x, py: pt.y, x0: p.pos.x, y0: p.pos.y };
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 오래된 브라우저 */ }
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const pt = canvasPoint(e);
    const design = d();
    const target = design.roles[role];
    let nx = Math.round(drag.x0 + (pt.x - drag.px));
    let ny = Math.round(drag.y0 + (pt.y - drag.py));
    nx = Math.max(-540, Math.min(540, nx));
    ny = Math.max(0, Math.min(1919, ny));
    // 살짝 붙는 자리 — 자막 밑단(1419)과 구간 제목 기본(300)
    if (role === 'caption' && Math.abs(ny - CAPTION_DEFAULT_Y) <= 14) ny = CAPTION_DEFAULT_Y;
    if (role === 'title' && Math.abs(ny - 372) <= 14) ny = 372;
    target.pos = { x: nx, y: ny };
    state.design = normalizeDesign(design);
    draw();
    e.preventDefault();
  });
  const endDrag = () => {
    if (!drag) return;
    drag = null;
    save(d());          // 손을 뗄 때 카드에 저장(끄는 동안은 화면만)
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', endDrag);

  function canvasPoint(e) {
    const r = canvas.getBoundingClientRect();
    const sx = r.width ? W / r.width : 1;
    const sy = r.height ? H / r.height : 1;
    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
  }

  /* ── 미리보기 배경(로컬 파일) ───────────────────────────────── */
  const bgFile = h('input', { type: 'file', accept: 'image/*,video/*', class: 'dg-file', 'aria-label': '미리보기 배경 파일', id: 'dg-bg-' + (ctx.contentId || 'x') });
  const bgState = h('span', { class: 'pr-check-s', text: '배경 없음 — 사진이나 영상 한 프레임을 얹어 보세요(이 기기에서만 열려요 · 올리지 않아요).' });
  const bgClear = h('button', { class: 'btn sm', type: 'button', text: '배경 지우기' });
  bgClear.addEventListener('click', () => {
    if (bgUrl) { try { URL.revokeObjectURL(bgUrl); } catch (e) { /* 무시 */ } }
    bgUrl = ''; bg = null; bgFile.value = ''; bgState.textContent = '배경 없음 — 사진이나 영상 한 프레임을 얹어 보세요(이 기기에서만 열려요 · 올리지 않아요).'; draw();
  });
  bgFile.addEventListener('change', () => {
    const f = bgFile.files && bgFile.files[0];
    if (!f) return;
    if (bgUrl) { try { URL.revokeObjectURL(bgUrl); } catch (e) { /* 무시 */ } }
    bgUrl = URL.createObjectURL(f);
    const isVideo = /^video\//.test(f.type) || /\.(mp4|mov|m4v|webm)$/i.test(f.name);
    if (isVideo) {
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';
      v.src = bgUrl;
      v.addEventListener('loadeddata', () => {
        // 페이드가 켜진 0초는 글자가 투명하다(기획안 3-2③) — 훅이 끝난 3초 근처 프레임을 쓴다.
        try { v.currentTime = Math.min(3, Math.max(0.2, (v.duration || 5) * 0.2)); } catch (e) { bg = v; draw(); }
      });
      v.addEventListener('seeked', () => { bg = v; bgState.textContent = '배경: ' + f.name + ' (영상 ' + (v.currentTime || 0).toFixed(1) + '초 프레임)'; draw(); });
      v.addEventListener('error', () => { bgState.textContent = '이 영상은 브라우저에서 열 수 없어요 — 사진으로 얹어 주세요(' + f.name + ').'; });
      bgState.textContent = '영상에서 한 프레임을 뽑는 중…';
    } else {
      const img = new Image();
      img.onload = () => { bg = img; bgState.textContent = '배경: ' + f.name + ' (' + img.naturalWidth + '×' + img.naturalHeight + ')'; draw(); };
      img.onerror = () => { bgState.textContent = '이 사진은 브라우저에서 열 수 없어요 — ' + f.name; };
      img.src = bgUrl;
      bgState.textContent = '사진을 여는 중…';
    }
  });

  /* ── 공통 입력 조각 ────────────────────────────────────────── */
  const range = (label, value, min, max, step, onInput) => {
    const val = h('span', { class: 'dg-val', text: String(value) });
    const inp = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value), 'aria-label': label });
    inp.addEventListener('input', () => { val.textContent = inp.value; onInput(Number(inp.value)); refresh(); });
    return h('label', { class: 'dg-range' }, h('span', { class: 'dg-range-t', text: label }), inp, val);
  };
  const num = (label, value, min, max, onInput) => {
    const inp = h('input', { class: 'pr-in', type: 'number', min: String(min), max: String(max), step: '1', value: String(value), 'aria-label': label });
    inp.addEventListener('input', () => { if (inp.value === '') return; onInput(Number(inp.value)); refresh(); });
    return h('label', { class: 'pr-field dg-num' }, h('span', { class: 'pr-label', text: label }), inp);
  };
  const colorRow = (label, value, onPick) => {
    const swatches = COLOR_SWATCHES.map((c) => {
      const b = h('button', { type: 'button', class: 'dg-sw' + (String(value).toUpperCase() === c ? ' on' : ''), 'aria-label': label + ' ' + c, title: c });
      b.style.background = c;
      b.addEventListener('click', () => { onPick(c); paintRole(); refresh(); });
      return b;
    });
    const pick = h('input', { type: 'color', class: 'dg-color', value, 'aria-label': label + ' 직접 고르기' });
    pick.addEventListener('input', () => { onPick(pick.value.toUpperCase()); refresh(); });
    pick.addEventListener('change', () => { paintRole(); refresh(); });
    return h('div', { class: 'pr-field dg-colorrow' }, h('span', { class: 'pr-label', text: label }), h('div', { class: 'dg-sws' }, ...swatches, pick));
  };
  const check = (label, checked, onChange, sub) => {
    const cb = h('input', { type: 'checkbox' });
    cb.checked = !!checked;
    cb.addEventListener('change', () => { onChange(cb.checked); refresh(); });
    return h('label', { class: 'pr-check' }, cb, h('span', null, h('span', { class: 'pr-check-t', text: label }), sub ? h('span', { class: 'pr-check-s', text: sub }) : null));
  };

  /* ── 역할별 조절판 ─────────────────────────────────────────── */
  const roleBox = h('div', { class: 'dg-role' });
  function paintRole() {
    const design = d();
    const cap = design.roles.caption;
    const t = design.roles.title;
    const b = design.roles.badge;
    roleBox.replaceChildren();
    // append(null) 은 화면에 'null' 글자가 된다 — 실제 DOM 도 그렇다. 빈 값은 걸러서 넣는다.
    const put = (...kids) => roleBox.append(...kids.filter((k) => k != null && k !== false));
    if (role === 'caption') {
      put(
        fontBlock('caption', cap.font),
        h('span', { class: 'pr-check-s', text: '프리셋을 고르면 색·외곽선·그림자·박스가 한 번에 바뀌어요. 아래에서 하나씩 미세 조정할 수 있어요.' }),
        colorRow('글자색', cap.color, (c) => { design.roles.caption.color = c; design.roles.caption.preset = 'custom'; save(design); }),
        h('div', { class: 'pr-two' },
          colorRow('외곽선 색', cap.outline.color, (c) => { design.roles.caption.outline.color = c; design.roles.caption.preset = 'custom'; save(design); }),
          range('외곽선 두께(px)', cap.outline.px, 0, 10, 1, (v) => { design.roles.caption.outline.px = v; design.roles.caption.preset = 'custom'; save(design); })),
        check('그림자', cap.shadow.on, (v) => { design.roles.caption.shadow.on = v; design.roles.caption.preset = 'custom'; save(design); },
          '번지는 그림자 — 밝은 화면에서 글자를 띄워요(진하기·방향·번짐)'),
        cap.shadow.on ? h('div', { class: 'dg-grid2' },
          range('그림자 진하기(%)', cap.shadow.alpha, 0, 100, 5, (v) => { design.roles.caption.shadow.alpha = v; save(design); }),
          range('번짐(px)', cap.shadow.blur, 0, 30, 1, (v) => { design.roles.caption.shadow.blur = v; save(design); }),
          range('가로(X)', cap.shadow.x, -20, 20, 1, (v) => { design.roles.caption.shadow.x = v; save(design); }),
          range('세로(Y)', cap.shadow.y, -20, 20, 1, (v) => { design.roles.caption.shadow.y = v; save(design); })) : null,
        check('검정 박스(반투명)', cap.box.on, (v) => { design.roles.caption.box.on = v; design.roles.caption.preset = 'custom'; save(design); },
          '가장 긴 줄 폭으로 둥근 판 한 장을 깔아요 — 줄마다 따로 그리지 않아요'),
        cap.box.on ? h('div', { class: 'dg-grid2' },
          range('박스 진하기(%)', cap.box.alpha, 0, 100, 5, (v) => { design.roles.caption.box.alpha = v; save(design); }),
          range('둥글기(px)', cap.box.radius, 0, 60, 1, (v) => { design.roles.caption.box.radius = v; save(design); })) : null,
        h('div', { class: 'dg-grid2' },
          num('위치 X', cap.pos.x, -540, 540, (v) => { design.roles.caption.pos.x = v; save(design); }),
          num('위치 Y (자막 밑단)', cap.pos.y, 0, 1919, (v) => { design.roles.caption.pos.y = v; save(design); })),
        h('div', { class: 'pr-row' },
          h('button', {
            class: 'btn sm', type: 'button', text: '이 위치를 모든 자막에 적용',
            onclick: () => { const cur = d(); const pos = { x: cur.roles.caption.pos.x, y: cur.roles.caption.pos.y }; cur.roles.caption.pos = pos; save(cur); refresh(); toast('자막 위치를 Y' + pos.y + ' · X' + pos.x + '로 모든 자막에 적용했어요', 'ok'); }
          }),
          h('button', {
            class: 'btn sm', type: 'button', text: '디자인 초기화',
            onclick: () => { const keep = d().segments; const base = defaultDesign(); base.segments = keep; save(base); refresh(); toast('글자 디자인을 기본값으로 되돌렸어요(구간은 그대로)', 'ok'); }
          })));
    } else if (role === 'title') {
      put(
        fontBlock('title', t.font),
        h('span', { class: 'pr-check-s', text: '구간마다 같은 자리에 노란 제목을 놓아요. 구간 제목을 하나라도 쓰면 상단 2줄 임팩트 제목은 자동으로 꺼져요.' }),
        colorRow('제목 색', t.color, (c) => { design.roles.title.color = c; save(design); }),
        range('글자 크기(px)', t.size, 24, 120, 2, (v) => { design.roles.title.size = v; save(design); }),
        h('div', { class: 'dg-grid2' },
          num('위치 X', t.pos.x, -540, 540, (v) => { design.roles.title.pos.x = v; save(design); }),
          num('위치 Y', t.pos.y, 0, 1919, (v) => { design.roles.title.pos.y = v; save(design); })),
        h('span', { class: 'pr-check-s', text: '기본 Y372 는 상단 브랜드 뱃지(y 244~322) 바로 아래예요. 더 올리면 겹칠 수 있어요.' }));
    } else {
      put(
        fontBlock('badge', b.font),
        h('span', { class: 'pr-check-s', text: '구간 배지는 검정 알약 위 흰 글씨예요. 제목 바로 아래(Y454)에 놓입니다.' }),
        colorRow('배지 글자색', b.color, (c) => { design.roles.badge.color = c; save(design); }),
        range('글자 크기(px)', b.size, 16, 80, 1, (v) => { design.roles.badge.size = v; save(design); }),
        check('알약(둥근 검정 판)', b.pill, (v) => { design.roles.badge.pill = v; save(design); }),
        h('div', { class: 'dg-grid2' },
          num('위치 X', b.pos.x, -540, 540, (v) => { design.roles.badge.pos.x = v; save(design); }),
          num('위치 Y', b.pos.y, 0, 1919, (v) => { design.roles.badge.pos.y = v; save(design); })));
    }
  }

  /* ── 프리셋·탭 ─────────────────────────────────────────────── */
  const presetRow = h('div', { class: 'dg-presets' });
  function paintPresets() {
    const cur = d().roles.caption.preset;
    presetRow.replaceChildren(...PRESETS.map((p) => {
      const sw = h('span', { class: 'dg-preset-sw' });
      sw.style.background = p.caption.color;
      sw.style.borderColor = p.caption.outline.color;
      const btn = h('button', {
        type: 'button', class: 'dg-preset' + (cur === p.id ? ' on' : ''), title: p.note,
        onclick: () => {
          const design = d();
          design.roles.caption = applyPreset(design.roles.caption, p.id);
          save(design); paintPresets(); paintRole(); refresh();
        }
      }, sw, h('span', { class: 'dg-preset-t', text: p.label }));
      return btn;
    }), h('span', { class: 'pr-check-s', text: cur === 'custom' ? '지금은 프리셋에서 벗어난 조합이에요.' : '' }));
  }

  const tabs = h('div', { class: 'dg-tabs', role: 'tablist' });
  function paintTabs() {
    tabs.replaceChildren(...['caption', 'title', 'badge'].map((k) => h('button', {
      type: 'button', class: 'dg-tab' + (role === k ? ' on' : ''), role: 'tab', 'aria-selected': role === k ? 'true' : 'false',
      text: ROLE_LABELS[k],
      onclick: () => { role = k; paintTabs(); paintRole(); draw(); }
    })));
  }

  /* ── 구간 목록 ─────────────────────────────────────────────── */
  const segBox = h('div', { class: 'dg-segs' });
  const addBtn = h('button', { class: 'btn sm', type: 'button', text: '+ 구간 추가' });
  addBtn.addEventListener('click', () => {
    const list = rawSegs();
    if (list.length >= MAX_SEGMENTS) { toast('구간은 ' + MAX_SEGMENTS + '개까지예요', 'err'); return; }
    const last = list[list.length - 1];
    const start = last ? Number(last.end) : (hookEnd || 0);
    const end = duration > 0 ? Math.min(duration, start + 5.6) : start + 5.6;
    if (end - start < 0.3) { toast('영상 길이 안에 구간을 더 넣을 자리가 없어요 — 앞 구간 끝을 줄여 주세요', 'err'); return; }
    commitSegs(list.concat([{ start, end, title: '', badge: '' }]), true);
  });
  /** 편집 중인 날것의 구간 목록 — 빈 칸이어도 줄이 사라지지 않게(입력 중 커서 보호). */
  function rawSegs() {
    const s = state.design;
    if (s && Array.isArray(s.segments)) return s.segments;
    return d().segments;
  }
  /** 구간 목록을 통째로 커밋한다. full=false 면 줄을 다시 그리지 않는다(입력 중 커서 보호). */
  function commitSegs(list, full) {
    const design = normalizeDesign(state.design);
    design.segments = list.slice(0, MAX_SEGMENTS).map((s) => ({
      start: Math.max(0, Number(s.start) || 0),
      end: Math.max(0, Number(s.end) || 0),
      title: String(s.title == null ? '' : s.title).slice(0, MAX_SEG_TITLE),
      badge: String(s.badge == null ? '' : s.badge).slice(0, MAX_SEG_BADGE)
    }));
    state.design = design;
    change((st) => { st.design = design; });
    draw(); paintWarn();
    if (full) paintSegs();
  }

  function paintSegs() {
    const list = rawSegs();
    const shown = d().segments;
    segBox.replaceChildren();
    if (!list.length) {
      segBox.append(h('span', { class: 'pr-check-s', text: '구간이 없어요 — [+ 구간 추가]로 0~5.6초 같은 구간을 만들고 제목·배지를 넣어 보세요.' }));
      return;
    }
    if (!shown.length) segBox.append(h('span', { class: 'pr-check-s', text: '문구가 비어 아직 렌더에 안 들어가요 — 제목이나 배지를 채우면 그때부터 보여요.' }));
    list.forEach((seg, i) => {
      const startIn = h('input', { class: 'pr-in dg-t', type: 'number', min: '0', step: '0.1', value: String(seg.start), 'aria-label': '구간 ' + (i + 1) + ' 시작(초)' });
      const endIn = h('input', { class: 'pr-in dg-t', type: 'number', min: '0', step: '0.1', value: String(seg.end), 'aria-label': '구간 ' + (i + 1) + ' 끝(초)' });
      const titleIn = h('input', { class: 'pr-in', type: 'text', maxlength: String(MAX_SEG_TITLE), value: seg.title || '', placeholder: '예: 돈키호테 쇼핑리스트 2단', 'aria-label': '구간 ' + (i + 1) + ' 제목' });
      const badgeIn = h('input', { class: 'pr-in', type: 'text', maxlength: String(MAX_SEG_BADGE), value: seg.badge || '', placeholder: '예: 이번엔 일본 약국템만', 'aria-label': '구간 ' + (i + 1) + ' 배지' });
      const patch = (p, full) => {
        const next = rawSegs().map((s, j) => (j === i ? Object.assign({}, s, p) : s));
        commitSegs(next, full);
      };
      [startIn, endIn].forEach((el) => el.addEventListener('change', () => patch({ start: Number(startIn.value) || 0, end: Number(endIn.value) || 0 }, true)));
      titleIn.addEventListener('input', () => patch({ title: titleIn.value }, false));
      badgeIn.addEventListener('input', () => patch({ badge: badgeIn.value }, false));
      titleIn.addEventListener('change', () => patch({ title: titleIn.value }, true));
      badgeIn.addEventListener('change', () => patch({ badge: badgeIn.value }, true));
      const snap = h('button', { class: 'btn sm', type: 'button', text: '자막 범위로' });
      snap.addEventListener('click', () => {
        const s = snapSegmentToCues(rawSegs()[i], cues);
        if (!s) { toast('카드에 자막이 없어 스냅할 곳이 없어요', 'err'); return; }
        patch(s, true);
        toast('자막 ' + s.start.toFixed(1) + '~' + s.end.toFixed(1) + '초로 맞췄어요', 'ok');
      });
      const del = h('button', { class: 'btn sm', type: 'button', text: '삭제' });
      del.addEventListener('click', () => { const next = rawSegs().slice(); next.splice(i, 1); commitSegs(next, true); });
      segBox.append(h('div', { class: 'dg-seg' },
        h('div', { class: 'dg-seg-head' },
          h('strong', { text: '구간 ' + (i + 1) }),
          startIn, h('span', { class: 'dg-t-sep', text: '~' }), endIn,
          h('span', { class: 'dg-t-sep', text: '초' })),
        h('div', { class: 'dg-seg-body' },
          h('label', { class: 'dg-seg-f' }, h('span', { class: 'dg-seg-l', text: '제목(노란 글씨)' }), titleIn),
          h('label', { class: 'dg-seg-f' }, h('span', { class: 'dg-seg-l', text: '배지(검정 알약)' }), badgeIn)),
        h('div', { class: 'pr-row' }, snap, del)));
    });
  }

  /* ── 경고·요약 ─────────────────────────────────────────────── */
  const warnBox = h('div', { class: 'dg-warn' });
  function paintWarn() {
    const design = d();
    const tl = applyTimeline(design, { duration, hookEnd });
    const list = tl.warnings.concat(designWarnings(tl.design, {
      duration, hookEnd, brandBadge, captionBand: { top: CAPTION_DEFAULT_Y - Math.round(styleSize * 1.22) * 2 }
    }));
    warnBox.replaceChildren();
    if (!list.length) return;
    warnBox.append(...list.map((w) => h('div', { class: 'dg-warnline ' + w.level, text: (w.level === 'warn' ? '⚠ ' : '· ') + w.msg })));
  }

  function refresh() {
    paintPresets();
    paintWarn();
    paintSegs();
    draw();
  }

  /* ── 워터마크(2026-11-25) ──────────────────────────────────── */
  function commitWm(patch, full) {
    const design = d();
    design.watermark = Object.assign({}, design.watermark, patch);
    save(design);
    draw();
    if (full) paintWarn();
  }
  const wmHost = h('div', { class: 'dg-wm' });
  function watermarkBlock() {
    paintWm();
    return wmHost;
  }
  function paintWm() {
    const wmEl = d().watermark;
    const on = h('input', { type: 'checkbox' });
    on.checked = wmEl.enabled;
    on.addEventListener('change', () => { commitWm({ enabled: on.checked }, true); paintWm(); });
    const textEl = h('input', { class: 'pr-in', type: 'text', maxlength: '24', value: wmEl.text, placeholder: '@s2ongrae', 'aria-label': '워터마크 문구' });
    textEl.addEventListener('input', () => { commitWm({ text: textEl.value }, false); });
    textEl.addEventListener('change', () => { commitWm({ text: textEl.value }, true); });
    const posEl = h('select', { class: 'pr-sel', 'aria-label': '워터마크 위치', onchange: () => commitWm({ position: posEl.value }, true) },
      ...WATERMARK_POSITIONS.map((p) => h('option', { value: p.id, selected: wmEl.position === p.id ? '' : null, text: p.label })));
    const op = h('input', { type: 'range', min: '5', max: '100', step: '5', value: String(wmEl.opacity), 'aria-label': '워터마크 진하기' });
    const opVal = h('span', { class: 'dg-val', text: wmEl.opacity + '%' });
    op.addEventListener('input', () => { opVal.textContent = op.value + '%'; commitWm({ opacity: Number(op.value) }, false); });
    wmHost.replaceChildren(...[h('label', { class: 'pr-check' }, on,
        h('span', null, h('span', { class: 'pr-check-t', text: '내 계정 워터마크 (영상 전체)' }), h('span', { class: 'pr-check-s', text: '기본 @s2ongrae · 옅은 흰 글씨 + 얇은 그림자 — 자막·아웃트로·브랜드 뱃지와 겹치지 않는 모서리에 넣어요.' }))),
      on.checked ? h('div', { class: 'dg-wmrow' },
        h('label', { class: 'dg-seg-f' }, h('span', { class: 'dg-seg-l', text: '문구' }), textEl),
        h('label', { class: 'dg-seg-f' }, h('span', { class: 'dg-seg-l', text: '위치' }), posEl),
        h('label', { class: 'dg-range dg-wmop' }, h('span', { class: 'dg-range-t', text: '진하기' }), op, opVal)) : null].filter((x) => x != null));
  }

  /* ── 조립 ─────────────────────────────────────────────────── */
  const root = h('div', { class: 'pr-field dg' },
    h('div', { class: 'dg-head' },
      h('span', { class: 'pr-label', text: '글자 디자인 · 구간 제목 (자막 색·박스·위치)' }),
      sumLine),
    presetRow,
    h('div', { class: 'dg-main' },
      h('div', { class: 'dg-preview' },
        g ? canvas : h('div', { class: 'dg-nocanvas', text: '이 브라우저에서는 미리보기 캔버스를 쓸 수 없어요 — 값은 그대로 저장되고 MP4 에 적용돼요.' }),
        h('div', { class: 'dg-under' }, posLine, h('span', { class: 'pr-check-s', text: '미리보기에서 끌어 옮기면 지금 고른 역할이 움직여요. MP4 와 같은 Pretendard·같은 좌표로 그려요.' })),
        h('div', { class: 'pr-row dg-bgrow' },
          h('label', { class: 'btn sm dg-filebtn' }, bgFile, h('span', { text: '배경 사진/영상 고르기' })),
          bgClear),
        bgState),
      h('div', { class: 'dg-controls' },
        tabs,
        roleBox)),
    watermarkBlock(),
    h('div', { class: 'dg-segwrap' },
      h('div', { class: 'dg-seghead' },
        h('span', { class: 'pr-label', text: '구간 제목 · 배지 (최대 ' + MAX_SEGMENTS + '개)' }),
        addBtn),
      h('span', { class: 'pr-check-s', text: '구간은 컷이 아니라 초(타임라인) 기준이에요. [자막 범위로]를 누르면 카드의 자막 시작·끝에 맞춰요. 구간 제목을 쓰면 상단 2줄 제목은 자동으로 꺼져요.' }),
      segBox,
      warnBox));

  paintTabs();
  paintRole();
  refresh();
  loadFontList();
  // 고른 역할이 내 폰트면 미리보기에 쓸 파일을 미리 받아 둔다.
  ['caption', 'title', 'badge'].forEach((k) => ensureFont(d().roles[k].font));
  if (document.fonts && document.fonts.load) {
    try { document.fonts.load('700 ' + styleSize + 'px Pretendard').then(() => { if (canvas.isConnected) draw(); }).catch(() => {}); } catch (e) { /* 폰트 API 없음 */ }
  }
  return root;
}
