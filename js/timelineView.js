/**
 * js/timelineView.js — ③ 컷 목록의 시각 타임라인 작업공간 (2026-11-27, A단계 v1)
 *
 * 무엇을 하나
 *  · 이 기기에서 고른 원본 영상을 <video> 로 열어 재생·스크럽하고, 타임라인 바에서 in/out 을 끌어 컷을 만든다.
 *    값은 state.cut_list 하나에만 쓴다 — 표(아래 컷 목록)·대본 계산과 **양방향**으로 맞물린다.
 *  · 컷마다 클립(파일번호)을 고를 수 있다(영상이 2개 이상일 때). 저장은 cut.clip, 오더는 지금까지의
 *    cuts [from,to,파일번호] 그대로다 — GAS·노트북 계약 변경 없음.
 *  · 자막 트랙을 얹고, 재생 위치의 자막·구간 제목·배지를 캔버스에 실시간으로 겹쳐 보여 준다.
 *    ⑥의 글자 디자인 값(state.design)을 그대로 쓰므로 미리보기와 결과가 같은 값을 본다.
 *
 * 왜 드라이브 영상을 바로 재생하지 않나
 *  · ①에서 올린 영상은 비공개 드라이브에 2MB 조각으로 있다. 브라우저가 그 주소로 바로 재생할 수 없고
 *    (CSP·인증), 조각을 전부 받아 이어 붙이면 폰에서 수백 MB 를 메모리에 올려야 한다.
 *    그래서 미리보기는 **이 기기에서 고른 같은 파일**로만 한다 — 아무것도 올리지 않는다(⑥ 배경 미리보기와 같은 방식).
 *    시간은 원본 파일 기준이라, 노트북이 같은 이름의 파일을 잘라도 컷 위치가 어긋나지 않는다.
 *
 * 화면은 만들어 넣기(textContent/createElement)만 한다 — 문자열을 통째로 넣는 방식은 쓰지 않는다.
 */
import {
  MIN_CUT_S, EDGE_GRAB_PX, viewSpan, ratioOf, timeAtPx, grabSeconds, snapTime,
  indexedCuts, cutAt, edgeNear, dragEdge, newCut, removeCut, setCutOn, setCutClip, setAllClips,
  clipTotals, cueList, overlayAt, captionLines, formatTime, timeTicks,
  clipNameOf, clipOf, normalizeCut, cutsForLane, cutAwayAt, toOutputTime, toSourceTime
} from './timeline.js?v=20261127a';
import { normalizeDesign, captionLayout, watermarkPoint, canvasFontFamily, W, H } from './designModel.js?v=20261127a';
import { parseSrt } from './srtRules.js?v=20261127c';

const round2 = (n) => Math.round(Number(n) * 100) / 100;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
// 한 번에 하나만 열도록 이전 미리보기 주소를 기억해 둔다(주소를 그대로 두면 메모리가 샌다).
let lastObjectUrl = '';

/** 캔버스 둥근 판 — designView 와 같은 모양(값은 designModel 규칙 그대로). */
function roundRect(g, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(Number(r) || 0, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + rr, y);
  g.lineTo(x + w - rr, y);
  g.quadraticCurveTo(x + w, y, x + w, y + rr);
  g.lineTo(x + w, y + h - rr);
  g.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  g.lineTo(x + rr, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - rr);
  g.lineTo(x, y + rr);
  g.quadraticCurveTo(x, y, x + rr, y);
  g.closePath();
}

/**
 * 타임라인 패널.
 * ctx: { h, state, change, toast, brand, inputs, cues(카드 자막), loadCueText?: async ()=>SRT 글자,
 *        onListChanged?: () => void }
 * 반환: { el, refresh } — refresh 는 표·대본 쪽에서 목록이 바뀌었을 때 부른다.
 */
export function timelinePanel(ctx) {
  const { h, state, change, toast } = ctx;
  const onListChanged = typeof ctx.onListChanged === 'function' ? ctx.onListChanged : () => {};
  const inputs = () => (Array.isArray(state.inputs) ? state.inputs : []);
  const cardCues = cueList(ctx.cues);

  const mem = {
    url: '', fileName: '', duration: 0, t: 0, playing: false,
    zoom: 1, center: 0, sel: -1, drag: null,
    markA: null, markB: null, msg: '',
    cues: cardCues.slice(), cueLabel: cardCues.length ? '카드 자막' : '', cueBusy: false, cueTried: false,
    lane: ''   // 지금 미리보기로 연 영상 이름(영상이 여럿일 때 컷·자막을 이 영상 기준으로 읽는다)
  };
  mem.lane = state.cut_input || (inputs()[0] || '');

  /* ── 뼈대 ───────────────────────────────────────────────── */
  const root = h('div', { class: 'tl' });
  const msgEl = h('div', { class: 'pr-err', role: 'alert' });
  const statusEl = h('span', { class: 'tl-status', text: '영상을 열기 전이에요 — 컷 목록만 보고 있어요.' });

  const fileIn = h('input', { type: 'file', accept: '.mp4,.mov,.m4v,video/mp4,video/quicktime', class: 'tl-file', 'aria-label': '이 기기에서 열 원본 영상' });
  const openBtn = h('label', { class: 'btn sm tl-filebtn' }, h('span', { text: '영상 열기' }), fileIn);

  const playBtn = h('button', { class: 'btn sm', type: 'button', text: '재생' });
  const backBtn = h('button', { class: 'btn sm', type: 'button', text: '◀ 0.1초' });
  const fwdBtn = h('button', { class: 'btn sm', type: 'button', text: '0.1초 ▶' });
  const timeEl = h('span', { class: 'tl-time', text: '0:00.0' });
  const zoomOut = h('button', { class: 'btn sm', type: 'button', text: '－', 'aria-label': '타임라인 축소' });
  const zoomIn = h('button', { class: 'btn sm', type: 'button', text: '＋', 'aria-label': '타임라인 확대' });
  const zoomEl = h('span', { class: 'tl-zoom', text: '1×' });
  const lenEl = h('span', { class: 'tl-len', text: '' });
  const laneSel = h('select', { class: 'pr-sel tl-lane-sel', 'aria-label': '미리 볼 영상' });
  const laneBox = h('label', { class: 'tl-lanebox' }, h('span', { class: 'pr-label', text: '미리 볼 영상' }), laneSel,
    h('span', { class: 'pr-check-s', text: '고른 영상과 같은 파일을 [영상 열기]로 연다. 컷·자막은 이 영상 기준으로 보인다.' }));

  const inBtn = h('button', { class: 'btn sm', type: 'button', text: '시작 표시' });
  const outBtn = h('button', { class: 'btn sm', type: 'button', text: '끝 표시' });
  const makeBtn = h('button', { class: 'btn primary sm', type: 'button', text: '표시한 구간 자르기' });
  const markEl = h('span', { class: 'tl-mark', text: '재생 위치를 옮기고 [시작 표시] → [끝 표시] 를 누르면 그 구간을 자를 수 있어요.' });

  const head = h('div', { class: 'tl-head' },
    openBtn,
    h('div', { class: 'tl-nav' }, playBtn, backBtn, fwdBtn, timeEl),
    h('div', { class: 'tl-nav' }, zoomOut, zoomEl, zoomIn),
    laneBox,
    lenEl,
    statusEl);
  if (inputs().length <= 1) laneBox.style.display = 'none';

  const placeholder = h('div', { class: 'tl-empty', text: '영상 열기 — 이 기기에서 고른 파일로만 미리 봐요(아무것도 올리지 않아요).' });
  const video = h('video', { class: 'tl-video', playsinline: true, preload: 'metadata' });
  const canvas = h('canvas', { class: 'tl-overlay', width: String(W), height: String(H), 'aria-label': '자막·구간 제목 미리보기' });
  video.style.display = 'none';
  const stage = h('div', { class: 'tl-stage' }, placeholder, video, canvas);

  const bar = h('div', { class: 'tl-bar', role: 'group', 'aria-label': '타임라인 막대', tabindex: '0' });
  const markRow = h('div', { class: 'tl-row' }, inBtn, outBtn, makeBtn, markEl);
  const selHost = h('div', { class: 'tl-sel' });
  const clipHost = h('div', { class: 'tl-clips' });
  const cueHost = h('div', { class: 'tl-cues' });

  root.append(head, stage, bar, markRow, selHost, clipHost, cueHost, msgEl);

  let g = null;
  try { g = canvas.getContext ? canvas.getContext('2d') : null; } catch (e) { g = null; }
  let playEl = null;      // 재생선 — 재생 중에는 이것만 움직인다

  /* ── 작은 도우미 ───────────────────────────────────────────── */
  function setMsg(text) {
    if (mem.msg === String(text || '')) return;
    mem.msg = String(text || '');
    msgEl.textContent = mem.msg;
  }
  function maxCutEnd() {
    let end = 0;
    indexedCuts(state.cut_list).forEach((r) => { if (r.cut.to > end) end = r.cut.to; });
    return end;
  }
  /** 영상이 없을 때 보여 줄 시간 축 끝 — 컷 끝과 자막 끝(원본 시간으로 되돌린 것) 중 긴 쪽. */
  function axisEnd() {
    let end = mem.duration || 0;
    if (end) return end;
    end = maxCutEnd();
    const laneCuts = cutsForLane(state.cut_list, inputs(), mem.lane, state.cut_input);
    mem.cues.forEach((c) => { const s = toSourceTime(laneCuts, c.end); if (s > end) end = s; });
    return end;
  }
  function spanNow() { return viewSpan(axisEnd(), mem.zoom, mem.center); }
  function cutNow() {
    const i = mem.sel;
    return i >= 0 && i < state.cut_list.length ? normalizeCut(state.cut_list[i]) : null;
  }
  function risky(fn) { try { return fn(); } catch (e) { return null; } }

  /** 컷 목록을 바꾼다 — 저장(change) + 표 갱신(onListChanged). */
  function applyList(list) {
    change((s) => { s.cut_list = list; });
    if (mem.sel >= state.cut_list.length) mem.sel = -1;
    paintBar();
    paintSel();
    paintClips();
    onListChanged();
  }

  function seek(t) {
    const dur = mem.duration;
    const v = clamp(Number(t) || 0, 0, dur > 0 ? dur : Number(t) || 0);
    mem.t = round2(v);
    risky(() => { video.currentTime = v; });
    paintLive();
  }

  /* ── 영상 ─────────────────────────────────────────────────── */
  fileIn.addEventListener('change', () => {
    const f = (fileIn.files || [])[0];
    if (!f) return;
    if (mem.url) risky(() => URL.revokeObjectURL(mem.url));
    if (lastObjectUrl && lastObjectUrl !== mem.url) risky(() => URL.revokeObjectURL(lastObjectUrl));
    mem.url = risky(() => URL.createObjectURL(f)) || '';
    lastObjectUrl = mem.url;
    mem.fileName = String(f.name || '');
    mem.duration = 0; mem.t = 0; mem.center = 0; mem.zoom = 1; mem.playing = false;
    mem.markA = null; mem.markB = null;
    if (!mem.url) { setMsg('이 브라우저에서는 파일을 열 수 없어요 — 아래 목록으로 자를 곳을 정할 수 있어요.'); return; }
    risky(() => { video.src = mem.url; });
    video.style.display = '';
    placeholder.style.display = 'none';
    setMsg('');
    statusEl.textContent = '여는 중… ' + mem.fileName;
    paintAll();
  });

  video.addEventListener('loadedmetadata', () => {
    mem.duration = round2(Number(video.duration) || 0);
    mem.t = 0; mem.center = 0;
    statusEl.textContent = mem.fileName + ' · ' + (mem.duration ? formatTime(mem.duration) + ' (' + mem.duration.toFixed(1) + '초)' : '길이를 읽지 못했어요');
    paintAll();
  });
  video.addEventListener('error', () => {
    setMsg('이 형식은 브라우저에서 열 수 없어요 — mp4(H.264)로 저장한 파일을 열어 주세요. (컷 목록은 아래 표에서 그대로 고칠 수 있어요)');
    statusEl.textContent = mem.fileName + ' · 열지 못함';
  });
  video.addEventListener('timeupdate', () => {
    mem.t = round2(Number(video.currentTime) || 0);
    paintLive();
  });
  const setPlaying = (v) => { mem.playing = !!v; playBtn.textContent = mem.playing ? '멈춤' : '재생'; };
  video.addEventListener('play', () => setPlaying(true));
  video.addEventListener('pause', () => setPlaying(false));
  video.addEventListener('ended', () => { setPlaying(false); paintLive(); });

  playBtn.addEventListener('click', () => {
    if (!mem.duration) { setMsg('영상을 먼저 열어 주세요.'); return; }
    if (mem.playing) risky(() => video.pause());
    else risky(() => { const p = video.play(); if (p && p.catch) p.catch(() => setMsg('재생을 시작하지 못했어요 — 화면을 한 번 눌러 주세요.')); });
  });
  backBtn.addEventListener('click', () => seek((mem.t || 0) - 0.1));
  fwdBtn.addEventListener('click', () => seek((mem.t || 0) + 0.1));

  zoomIn.addEventListener('click', () => { mem.zoom = clamp(mem.zoom * 2, 1, 40); mem.center = mem.t; paintBar(); });
  zoomOut.addEventListener('click', () => { mem.zoom = clamp(mem.zoom / 2, 1, 40); mem.center = mem.t; paintBar(); });

  inBtn.addEventListener('click', () => { mem.markA = mem.t; if (mem.markB !== null && mem.markB <= mem.markA) mem.markB = null; paintMarks(); });
  outBtn.addEventListener('click', () => { mem.markB = mem.t; if (mem.markA !== null && mem.markA >= mem.markB) mem.markA = null; paintMarks(); });
  makeBtn.addEventListener('click', () => {
    if (!mem.duration) { setMsg('영상을 먼저 열어 주세요.'); return; }
    if (mem.markA === null || mem.markB === null) { setMsg('[시작 표시]와 [끝 표시]를 먼저 눌러 주세요.'); return; }
    const res = newCut(state.cut_list, mem.markA, mem.markB, { duration: mem.duration, cues: mem.cues });
    if (!res.ok) { setMsg(res.error); return; }
    applyList(res.list);
    mem.sel = res.index;
    mem.markA = null; mem.markB = null;
    paintMarks(); paintSel();
    if (toast) toast('컷 한 곳을 그었어요 — ' + formatTime(res.from) + ' → ' + formatTime(res.to), 'ok');
  });

  /* ── 타임라인 바 ───────────────────────────────────────────── */
  function barRect() { return risky(() => bar.getBoundingClientRect()) || { left: 0, width: 0 }; }
  function tFromEvent(e) {
    const r = barRect();
    const w = Number(r.width) > 0 ? Number(r.width) : 0;
    const x = (Number(e && e.clientX) || 0) - (Number(r.left) || 0);
    return timeAtPx(x, w, spanNow());
  }

  bar.addEventListener('pointerdown', (e) => {
    if (!mem.duration) { setMsg('영상을 먼저 열어 주세요 — 열면 타임라인을 끌어 바로 자를 수 있어요.'); return; }
    if (e && e.button != null && e.button !== 0) return;
    const span = spanNow();
    const t = tFromEvent(e);
    const tol = grabSeconds(barRect().width, span, EDGE_GRAB_PX);
    const rows = indexedCuts(state.cut_list);
    const edge = edgeNear(rows, t, tol);
    setMsg('');
    if (edge) {
      mem.sel = edge.i;
      mem.drag = { mode: 'edge', i: edge.i, edge: edge.edge };
      seek(t);
    } else {
      const hit = cutAt(rows, t);
      if (hit) { mem.sel = hit.i; mem.drag = { mode: 'seek' }; seek(t); }
      else { mem.drag = { mode: 'new', a: snapTime(t, mem.cues), b: snapTime(t, mem.cues) }; }
    }
    risky(() => bar.setPointerCapture(e.pointerId));
    paintBar(); paintSel(); paintClips();
  });

  bar.addEventListener('pointermove', (e) => {
    const d = mem.drag;
    if (!d) return;
    const t = tFromEvent(e);
    if (d.mode === 'edge') {
      const res = dragEdge(state.cut_list, d.i, d.edge, t, { duration: mem.duration, cues: mem.cues });
      if (res.ok) {
        change((s) => { s.cut_list = res.list; });
        mem.t = round2(t);
        paintBar(); paintSel(); paintClips(); paintLive();
        onListChanged();
      }
    } else if (d.mode === 'new') {
      d.b = snapTime(t, mem.cues);
      paintBar();
    } else if (d.mode === 'seek') {
      seek(t);
    }
  });

  function finishDrag() {
    const d = mem.drag;
    mem.drag = null;
    if (!d) return;
    if (d.mode === 'new') {
      const a = Math.min(d.a, d.b), b = Math.max(d.a, d.b);
      if (b - a >= MIN_CUT_S) {
        const res = newCut(state.cut_list, a, b, { duration: mem.duration, cues: mem.cues });
        if (res.ok) {
          applyList(res.list);
          mem.sel = res.index;
          paintSel(); paintClips();
          setMsg('컷 한 곳을 그었어요 — ' + formatTime(res.from) + ' → ' + formatTime(res.to) + (res.merged ? ' (붙어 있던 컷과 합쳤어요)' : ''));
        } else setMsg(res.error);
      } else seek(a);
    }
    paintBar(); paintSel();
  }
  bar.addEventListener('pointerup', finishDrag);
  bar.addEventListener('pointercancel', finishDrag);
  bar.addEventListener('pointerleave', () => { if (mem.drag && mem.drag.mode === 'new') finishDrag(); });
  // 키보드 — 막대에 초점을 두고 ←/→ 로 0.1초(Shift 1초), Home/End 로 처음·끝
  bar.addEventListener('keydown', (e) => {
    const step = e && e.shiftKey ? 1 : 0.1;
    if (!mem.duration) return;
    if (e.key === 'ArrowLeft') { seek((mem.t || 0) - step); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { seek((mem.t || 0) + step); e.preventDefault(); }
    else if (e.key === 'Home') { seek(0); e.preventDefault(); }
    else if (e.key === 'End') { seek(mem.duration); e.preventDefault(); }
  });

  function paintBar() {
    const axis = axisEnd();          // 영상을 열기 전에도 컷·자막을 같은 시간 축으로 보여 준다
    const span = viewSpan(axis, mem.zoom, mem.center);    const rows = indexedCuts(state.cut_list);
    const names = inputs();
    const laneCut = h('div', { class: 'tl-lane tl-lane-cut' }, h('span', { class: 'tl-lane-t', text: '자를 곳' }));
    if (axis) {
      rows.forEach(({ i, cut }) => {
        if (cut.to <= span.from || cut.from >= span.to) return;
        const l = ratioOf(cut.from, span) * 100;
        const r = ratioOf(cut.to, span) * 100;
        const w = Math.max(r - l, 0.8);
        const clipName = names.length > 1 ? clipNameOf(cut, names, state.cut_input) : '';
        const el = h('div', {
          class: 'tl-cut' + (cut.on === false ? ' off' : '') + (i === mem.sel ? ' sel' : ''),
          style: 'left:' + l.toFixed(3) + '%;width:' + w.toFixed(3) + '%',
          title: formatTime(cut.from) + ' → ' + formatTime(cut.to) + (clipName ? ' · ' + clipName : '') + (cut.on === false ? ' (끔)' : ''),
          'data-cut': String(i)
        });
        if (clipName && w >= 10) el.append(h('span', { class: 'tl-cut-t', text: clipName.replace(/\.(mp4|mov|m4v)$/i, '') }));
        laneCut.append(el);
      });
    }
    const laneCue = h('div', { class: 'tl-lane tl-lane-cue' }, h('span', { class: 'tl-lane-t', text: '자막' }));
    if (axis) {
      const laneCuts = cutsForLane(state.cut_list, names, mem.lane, state.cut_input);
      mem.cues.forEach((c) => {
        // 자막은 결과 영상 시간이다 — 이 영상에 걸린 컷을 되돌려 원본 시간 자리에 그린다.
        const s = toSourceTime(laneCuts, c.start);
        const e = Math.max(s + 0.02, toSourceTime(laneCuts, c.end));
        if (e <= span.from || s >= span.to) return;
        const l = ratioOf(s, span) * 100;
        const r = ratioOf(e, span) * 100;
        laneCue.append(h('div', {
          class: 'tl-cue', style: 'left:' + l.toFixed(3) + '%;width:' + Math.max(r - l, 0.5).toFixed(3) + '%',
          title: c.text
        }));
      });
    }
    const kids = [laneCut, laneCue];
    // 눈금(초) — 확대·축소해도 8개 이하
    if (axis) {
      const ticks = h('div', { class: 'tl-ticks' });
      timeTicks(span, 6).forEach((tk) => ticks.append(h('span', { class: 'tl-tick', style: 'left:' + (ratioOf(tk.t, span) * 100).toFixed(3) + '%', text: tk.label })));
      kids.push(ticks);
    }
    // 새로 긋는 중인 구간
    const d = mem.drag;
    if (d && d.mode === 'new') {
      const a = Math.min(d.a, d.b), b = Math.max(d.a, d.b);
      kids.push(h('div', { class: 'tl-band', style: 'left:' + (ratioOf(a, span) * 100).toFixed(3) + '%;width:' + (ratioOf(b, span) * 100 - ratioOf(a, span) * 100).toFixed(3) + '%' }));
    }
    // 재생 위치
    const ph = h('div', { class: 'tl-play', style: 'left:' + (ratioOf(mem.t, span) * 100).toFixed(3) + '%' });
    playEl = ph;
    kids.push(ph);
    // 표시해 둔 시작·끝
    [['a', mem.markA], ['b', mem.markB]].forEach(([k, at]) => {
      if (at === null || at === undefined) return;
      kids.push(h('div', { class: 'tl-mark-pin tl-mark-' + k, style: 'left:' + (ratioOf(at, span) * 100).toFixed(3) + '%' }));
    });
    bar.replaceChildren(...kids);
    zoomEl.textContent = (span.zoom ? span.zoom : 1) + '×';
    if (mem.duration) {
      const cutSec = cutsForLane(state.cut_list, names, mem.lane, state.cut_input).reduce((a, c) => a + (c.to - c.from), 0);
      lenEl.textContent = '원본 ' + formatTime(mem.duration) + ' → 자른 뒤 ' + formatTime(Math.max(0, mem.duration - cutSec));
    } else lenEl.textContent = '';
  }

  function paintLive() {
    let span = spanNow();
    // 확대했을 때는 재생 위치를 따라간다
    if (mem.zoom > 1 && mem.duration && (mem.t < span.from || mem.t > span.to)) {
      mem.center = mem.t;
      paintBar();
      span = spanNow();
    }
    timeEl.textContent = formatTime(mem.t) + ' / ' + formatTime(mem.duration || 0);
    // 재생 중에는 막대를 다시 그리지 않고 재생선만 옮긴다(초당 4번 다시 그리면 폰이 버벅인다).
    if (playEl) playEl.style.left = (ratioOf(mem.t, span) * 100).toFixed(3) + '%';
    drawOverlay();
  }

  function paintMarks() {
    const a = mem.markA === null ? '-' : formatTime(mem.markA);
    const b = mem.markB === null ? '-' : formatTime(mem.markB);
    markEl.textContent = '표시: ' + a + ' → ' + b + (mem.markA !== null && mem.markB !== null ? ' (' + round2(mem.markB - mem.markA) + '초)' : '');
    paintBar();
  }

  /* ── 고른 컷 ───────────────────────────────────────────────── */
  function paintSel() {
    const cut = cutNow();
    if (!cut) { selHost.replaceChildren(); return; }
    const i = mem.sel;
    const onCb = h('input', { type: 'checkbox', 'aria-label': '이 구간 자르기' });
    onCb.checked = cut.on !== false;
    onCb.addEventListener('change', () => {
      const res = setCutOn(state.cut_list, i, onCb.checked);
      if (res.ok) applyList(res.list);
    });
    const startBtn = h('button', { class: 'btn sm', type: 'button', text: '시작을 지금으로' });
    startBtn.addEventListener('click', () => {
      if (!mem.duration) { setMsg('영상을 먼저 열어 주세요.'); return; }
      const res = dragEdge(state.cut_list, i, 'from', mem.t, { duration: mem.duration, cues: mem.cues });
      if (!res.ok) { setMsg(res.error); return; }
      applyList(res.list); paintSel();
    });
    const endBtn = h('button', { class: 'btn sm', type: 'button', text: '끝을 지금으로' });
    endBtn.addEventListener('click', () => {
      if (!mem.duration) { setMsg('영상을 먼저 열어 주세요.'); return; }
      const res = dragEdge(state.cut_list, i, 'to', mem.t, { duration: mem.duration, cues: mem.cues });
      if (!res.ok) { setMsg(res.error); return; }
      applyList(res.list); paintSel();
    });
    const delBtn = h('button', { class: 'btn sm', type: 'button', text: '이 컷 빼기' });
    delBtn.addEventListener('click', () => {
      const res = removeCut(state.cut_list, i);
      if (!res.ok) { setMsg(res.error); return; }
      applyList(res.list);
      mem.sel = -1;
      paintSel();
    });
    const kids = [
      h('strong', { text: '고른 컷 · ' + formatTime(cut.from) + ' → ' + formatTime(cut.to) + ' (' + round2(cut.to - cut.from) + '초)' }),
      h('label', { class: 'pr-check' }, onCb, h('span', null, h('span', { class: 'pr-check-t', text: '이 구간 자르기' }),
        h('span', { class: 'pr-check-s', text: '끄면 목록에 남지만 ④에서 자르지 않아요.' }))),
      h('div', { class: 'tl-row' }, startBtn, endBtn, delBtn)
    ];
    if (inputs().length > 1) kids.push(clipPicker(cut, i));
    selHost.replaceChildren(h('div', { class: 'tl-box' }, ...kids));
  }

  /** 컷 하나의 클립 고르기 — 파일번호(clip)만 바꾼다. */
  function clipPicker(cut, i) {
    const names = inputs();
    const cur = clipOf(cut, names.length);
    const sel = h('select', { class: 'pr-sel', 'aria-label': '이 컷의 영상' },
      h('option', { value: '', text: '기본 — ' + (state.cut_input || names[0] || '영상 하나') }),
      ...names.map((n, k) => h('option', { value: String(k), selected: cur === k ? '' : null, text: n })));
    sel.value = cur === null ? '' : String(cur);
    sel.addEventListener('change', () => {
      const res = setCutClip(state.cut_list, i, sel.value === '' ? null : Number(sel.value), names.length);
      if (res.ok) { applyList(res.list); paintSel(); }
    });
    const allBtn = h('button', { class: 'btn sm', type: 'button', text: '모든 컷을 이 영상으로' });
    allBtn.addEventListener('click', () => {
      const res = setAllClips(state.cut_list, sel.value === '' ? null : Number(sel.value), names.length);
      if (res.ok) { applyList(res.list); paintSel(); paintClips(); if (toast) toast('켜져 있는 컷의 영상을 바꿨어요', 'ok'); }
    });
    return h('div', { class: 'tl-box tl-clipbox' },
      h('span', { class: 'pr-label', text: '이 컷의 영상' }), sel,
      h('span', { class: 'pr-check-s', text: '컷의 시간은 그 영상의 원본 기준이에요. 영상마다 따로 계산하니 같은 초라도 다른 장면일 수 있어요.' }),
      h('div', { class: 'tl-row' }, allBtn));
  }

  /** 영상별로 몇 곳을 자르는지 — 짧은 요약. */
  function paintClips() {
    const names = inputs();
    if (names.length <= 1) { clipHost.replaceChildren(); return; }
    const rows = clipTotals(state.cut_list, names, state.cut_input);
    if (!rows.length) { clipHost.replaceChildren(); return; }
    clipHost.replaceChildren(h('div', { class: 'tl-sum' },
      h('span', { class: 'pr-label', text: '영상별로 자르는 곳' }),
      ...rows.map((r) => h('span', { class: 'tl-sum-i', text: r.name + ' · ' + r.count + '곳(켜짐 ' + r.on + ') · ' + r.seconds.toFixed(1) + '초' }))));
  }

  /* ── 자막 ─────────────────────────────────────────────────── */
  /** 미리 볼 영상 고르기 — 영상이 여럿일 때만 보인다(컷·자막의 기준이 바뀐다). */
  function paintLaneSel() {
    const names = inputs();
    if (names.length <= 1) { laneBox.style.display = 'none'; return; }
    laneBox.style.display = '';
    if (names.indexOf(mem.lane) < 0) mem.lane = names[0];
    laneSel.replaceChildren(...names.map((n) => h('option', { value: n, selected: n === mem.lane ? '' : null, text: n })));
    laneSel.value = mem.lane;
  }
  laneSel.addEventListener('change', () => {
    mem.lane = laneSel.value;
    setMsg('');
    paintBar(); paintLive(); paintClips();
  });

  function paintCueHost() {
    const btn = h('button', { class: 'btn sm', type: 'button', text: mem.cues.length ? '확정 자막 다시 불러오기' : '확정 자막 불러오기' });
    if (mem.cueBusy) btn.setAttribute('disabled', '');
    btn.addEventListener('click', () => { loadCues(); });
    const kids = [h('div', { class: 'tl-cuerow' },
      h('span', { class: 'tl-cue-t', text: mem.cues.length ? '자막 ' + mem.cues.length + '개 · ' + (mem.cueLabel || '카드 자막') : '자막 없음 — 카드에 자막이 없거나 아직 확정 전이에요.' }),
      btn)];
    if (mem.cueErr) kids.push(h('span', { class: 'pr-check-s', text: mem.cueErr }));
    cueHost.replaceChildren(...kids);
  }

  async function loadCues() {
    if (mem.cueBusy || typeof ctx.loadCueText !== 'function') return;
    mem.cueBusy = true; mem.cueErr = '';
    paintCueHost();
    try {
      const text = await ctx.loadCueText();
      const parsed = parseSrt(text);
      if (parsed.cues.length) { mem.cues = cueList(parsed.cues); mem.cueLabel = '확정 자막(⑤)'; }
      else mem.cueErr = '확정 자막이 아직 없어요 — ⑤에서 자막을 확정하면 여기에도 떠요.';
    } catch (err) {
      mem.cueErr = '자막을 불러오지 못했어요 — ' + ((err && err.message) || '연결 확인');
    }
    mem.cueBusy = false;
    paintCueHost();
    paintBar();
    drawOverlay();
  }

  /* ── 미리보기 겹치기(1080×1920) ─────────────────────────────── */
  /** 미리보는 영상에 걸린 켜진 컷 — 자막 시간·결과 길이의 기준. */
  function laneCutsNow() { return cutsForLane(state.cut_list, inputs(), mem.lane, state.cut_input); }
  function drawOverlay() {
    if (!g) return;
    const design = normalizeDesign(state.design);
    const size = state.sub_style === 'long' ? 56 : 68;
    try {
      g.clearRect(0, 0, W, H);
      const laneCuts = laneCutsNow();
      // 자막은 결과 영상 시간이다 — 잘려 나가는 자리면 결과에 없는 장면이므로 자막을 얹지 않는다.
      const at = cutAwayAt(laneCuts, mem.t || 0)
        ? { caption: null, title: '', badge: '' }
        : overlayAt({ design, cues: mem.cues, t: toOutputTime(laneCuts, mem.t || 0) });
      const lines = captionLines(at.caption);
      const cap = design.roles.caption;
      if (lines.length) {
        const layout = captionLayout(cap, { size, lines });
        if (layout.box) {
          g.save();
          g.fillStyle = 'rgba(0,0,0,' + (cap.box.alpha / 100) + ')';
          roundRect(g, layout.box.x, layout.box.y, layout.box.w, layout.box.h, cap.box.radius);
          g.fill();
          g.restore();
        }
        g.save();
        g.font = '700 ' + size + 'px ' + canvasFontFamily(cap.font);
        g.textAlign = 'center';
        g.textBaseline = 'bottom';
        g.lineJoin = 'round';
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
      }
      // 구간 제목·배지 — ⑥ 글자 디자인 값 그대로
      const t = design.roles.title;
      const b = design.roles.badge;
      if (at.title) {
        g.save();
        g.font = '700 ' + t.size + 'px ' + canvasFontFamily(t.font);
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.lineJoin = 'round';
        g.strokeStyle = '#111111';
        g.lineWidth = 6;
        g.strokeText(at.title, 540 + t.pos.x, t.pos.y);
        g.fillStyle = t.color;
        g.fillText(at.title, 540 + t.pos.x, t.pos.y);
        g.restore();
      }
      if (at.badge) {
        g.save();
        g.font = '700 ' + b.size + 'px ' + canvasFontFamily(b.font);
        const tw = g.measureText(at.badge).width;
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
        g.fillText(at.badge, 540 + b.pos.x, b.pos.y + bh / 2);
        g.restore();
      }
      // 워터마크(기본 켜짐) — 결과와 같은 자리
      const wm = design.watermark;
      if (wm.enabled && wm.text) {
        const p = watermarkPoint(wm.position, { pad: 72 });
        g.save();
        g.font = '700 ' + wm.size + 'px ' + canvasFontFamily(null);
        g.textAlign = p.align;
        g.textBaseline = 'middle';
        g.globalAlpha = Math.max(0.05, Math.min(1, wm.opacity / 100));
        g.fillStyle = '#FFFFFF';
        g.fillText(wm.text, p.x, p.y);
        g.restore();
      }
    } catch (e) { /* 캔버스를 못 쓰는 브라우저에서도 패널은 산다 */ }
  }

  /* ── 처음 그리기 ───────────────────────────────────────────── */
  function paintAll() {
    paintLaneSel();
    paintBar();
    paintLive();
    paintSel();
    paintClips();
    paintCueHost();
    paintMarks();
    msgEl.textContent = mem.msg;
  }
  paintAll();

  // 확정 자막이 있으면 한 번 불러 본다(⑤에서 확정한 자막이 실제로 구워지는 자막이다).
  if (state.srt && state.srt.confirmed === true && !mem.cueTried) {
    mem.cueTried = true;
    loadCues();
  }

  /** 표·대본 쪽에서 목록이 바뀌었을 때 — 타임라인만 다시 그린다. */
  function refresh() {
    if (mem.sel >= state.cut_list.length) mem.sel = -1;
    paintLaneSel(); paintBar(); paintSel(); paintClips(); paintLive();
  }

  return { el: root, refresh, cues: () => mem.cues };
}
