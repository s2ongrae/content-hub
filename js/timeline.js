/**
 * js/timeline.js — ③ 시각 타임라인 작업공간의 계산 (2026-11-27, A단계 v1)
 *
 * 여기에는 DOM·캔버스를 만지지 않는다(노드에서 그대로 시험된다). 화면·미리보기는 js/timelineView.js 가 맡는다.
 *
 * 원칙
 *  · 컷 목록(state.cut_list)이 **유일한 원본**이다. 타임라인에서 끌어 고친 값은 이 목록으로 들어가고,
 *    대본으로 만든 목록·표의 체크·지우기가 바뀌면 타임라인을 다시 그린다(양방향).
 *  · 컷의 시간은 '그 컷에 고른 영상'의 원본 시간이다. 노트북 오더는 지금까지처럼 cuts [from,to] 또는
 *    [from,to,파일번호] 를 받는다 — 컷마다 파일번호를 고를 수 있게 되어도 계약은 그대로다(새 키 없음).
 *  · 모든 값은 초 단위(0.01 반올림). 좌표는 화면 픽셀이 아니라 0~1 비율로 다룬다(폰 360px·PC 공통).
 */

export const MIN_CUT_S = 0.2;          // 컷 한 곳의 최소 길이 — 노트북 ffmpeg 컷도 0.01초 단위라 안전한 하한
export const EDGE_GRAB_PX = 10;        // in/out 손잡이를 잡는 화면 여유(픽셀)
export const SNAP_S = 0.12;            // 자막 경계에 붙는 거리(초)
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 40;
export const MAX_TIMELINE_CUES = 400;  // 노트북 MAX_CUES 와 같은 값
export const MANUAL_TYPE = 'MANUAL';   // 손으로 그은 컷 — 표에서 '직접'으로 보인다

const round2 = (n) => Math.round(Number(n) * 100) / 100;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/** 컷 한 줄의 모양을 믿지 않고 다시 맞춘다(저장값·다른 화면에서 온 값 방어). */
export function normalizeCut(c) {
  const o = c && typeof c === 'object' ? c : {};
  const from = Number(o.from), to = Number(o.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || !(to > from)) return null;
  const type = [MANUAL_TYPE, 'DEAD', 'FILLER', 'REPEAT'].indexOf(String(o.type)) >= 0 ? String(o.type) : 'DEAD';
  const out = { type, from: round2(from), to: round2(to), on: o.on !== false, text: String(o.text == null ? '' : o.text).slice(0, 60) };
  const clip = Number(o.clip);
  if (Number.isInteger(clip) && clip >= 0) out.clip = clip;      // 없으면 싣지 않는다(지금까지의 카드와 같은 모양)
  return out;
}

/** 컷 목록을 from 순으로 정렬한 새 배열. 같은 from 이면 긴 것이 뒤. */
export function sortCuts(list) {
  return (Array.isArray(list) ? list : [])
    .map(normalizeCut).filter(Boolean)
    .sort((a, b) => (a.from - b.from) || (a.to - b.to));
}

/** [{ i: 원래 자리, cut }] — 화면은 from 순으로 그리지만 저장은 원래 자리에 쓴다. */
export function indexedCuts(list) {
  return (Array.isArray(list) ? list : []).map((cut, i) => ({ i, cut: normalizeCut(cut) }))
    .filter((r) => r.cut)
    .sort((a, b) => (a.cut.from - b.cut.from) || (a.cut.to - b.cut.to));
}

/** 컷에 고른 파일번호(0부터) — 없거나 범위 밖이면 null(기본 영상 하나를 쓴다). */
export function clipOf(cut, inputCount) {
  const n = Number(inputCount) > 0 ? Number(inputCount) : 0;
  const c = cut && typeof cut === 'object' ? cut : {};
  if (c.clip === null || c.clip === undefined || c.clip === '') return null;   // 비우면 '기본 영상'이라는 뜻
  const idx = Number(c.clip);
  if (!Number.isInteger(idx) || idx < 0) return null;
  if (n && idx >= n) return null;
  return idx;
}

/** 이 컷이 실제로 쓸 영상 이름 — 파일번호도 기본 영상도 없으면 ''. */
export function clipNameOf(cut, inputs, defaultName) {
  const names = Array.isArray(inputs) ? inputs : [];
  const idx = clipOf(cut, names.length);
  if (idx !== null) return names[idx] || '';
  if (names.length <= 1) return names[0] || '';
  return names.indexOf(defaultName) >= 0 ? defaultName : '';
}

/* ── 좌표(화면 비율) ───────────────────────────────────────────── */

/** 지금 보이는 구간 — 확대하면 재생 위치를 가운데 두고 창을 좁힌다. */
export function viewSpan(duration, zoom, center) {
  const dur = Number(duration) > 0 ? Number(duration) : 0;
  if (!dur) {
    const z0 = clamp(Number(zoom) || 1, MIN_ZOOM, MAX_ZOOM);
    return { from: 0, to: 0, zoom: z0, empty: true };
  }
  const z = clamp(Number(zoom) || 1, MIN_ZOOM, MAX_ZOOM);
  const len = dur / z;
  if (len >= dur - 1e-9) return { from: 0, to: round2(dur), zoom: 1, empty: false };
  const c = Number.isFinite(Number(center)) ? Number(center) : 0;
  const from = clamp(c - len / 2, 0, dur - len);
  return { from: round2(from), to: round2(from + len), zoom: z, empty: false };
}

/** 초 → 이 구간 안의 0~1 비율(밖이면 0·1로 잘린다). */
export function ratioOf(t, span) {
  const a = Number(span && span.from) || 0;
  const b = Number(span && span.to) || 0;
  if (!(b > a)) return 0;
  return clamp((Number(t) - a) / (b - a), 0, 1);
}

/** 0~1 비율 → 초. */
export function timeOfRatio(r, span) {
  const a = Number(span && span.from) || 0;
  const b = Number(span && span.to) || 0;
  if (!(b > a)) return a;
  return round2(a + clamp(Number(r) || 0, 0, 1) * (b - a));
}

/** 픽셀 폭에서 x → 초. width 가 0 이면 구간 시작. */
export function timeAtPx(x, width, span) {
  const w = Number(width) > 0 ? Number(width) : 0;
  if (!w) return Number(span && span.from) || 0;
  return timeOfRatio(Number(x) / w, span);
}

/** 초 → 픽셀 x. */
export function pxOfTime(t, width, span) {
  return ratioOf(t, span) * (Number(width) > 0 ? Number(width) : 0);
}

/** 손잡이를 잡을 거리(초) — 화면 픽셀 여유를 지금 구간에 맞춰 초로 바꾼다. */
export function grabSeconds(width, span, px) {
  const a = Number(span && span.from) || 0;
  const b = Number(span && span.to) || 0;
  const w = Number(width) > 0 ? Number(width) : 0;
  const p = Number(px) > 0 ? Number(px) : EDGE_GRAB_PX;
  if (!w || !(b > a)) return 0;
  return (b - a) * (p / w);
}

/* ── 자막에 붙이기 ─────────────────────────────────────────────── */

/** t 를 자막 시작·끝에 붙인다(가까울 때만). */
export function snapTime(t, cues, tol) {
  const v = Number(t);
  if (!Number.isFinite(v) || !Array.isArray(cues) || !cues.length) return round2(v);
  const limit = Number(tol) > 0 ? Number(tol) : SNAP_S;
  let best = null, bestD = limit;
  cues.forEach((c) => {
    [Number(c && c.start), Number(c && c.end)].forEach((edge) => {
      if (!Number.isFinite(edge)) return;
      const d = Math.abs(edge - v);
      if (d <= bestD) { bestD = d; best = edge; }
    });
  });
  return round2(best === null ? v : best);
}

/* ── 컷 찾기·끌기 ──────────────────────────────────────────────── */

/** 그 시각을 덮는 컷. 없으면 null. */
export function cutAt(rows, t) {
  const v = Number(t);
  const list = Array.isArray(rows) ? rows : [];
  for (const r of list) {
    if (v >= r.cut.from - 1e-6 && v < r.cut.to + 1e-6) return r;
  }
  return null;
}

/** 가까운 in/out 손잡이 — { i, edge:'from'|'to', cut } 또는 null. 시작·끝이 같게 가까우면 끝을 먼저 잡는다. */
export function edgeNear(rows, t, tol) {
  const v = Number(t);
  const limit = Number(tol) > 0 ? Number(tol) : 0;
  let best = null, bestD = limit;
  (Array.isArray(rows) ? rows : []).forEach((r) => {
    [['from', r.cut.from], ['to', r.cut.to]].forEach(([edge, at]) => {
      const d = Math.abs(at - v);
      if (d <= bestD) { bestD = d; best = { i: r.i, edge, cut: r.cut }; }
    });
  });
  return best;
}

/** 모든 줄을 정규 모양으로 — 손대지 않은 줄까지 같은 모양으로 돌려준다(저장값이 섞이지 않게). */
function normAll(list) {
  return (Array.isArray(list) ? list : []).map((c) => normalizeCut(c) || c);
}

/** 손잡이 하나를 t 로 옮긴 새 목록. 앞뒤 컷과 겹치지 않게, 최소 길이(MIN_CUT_S)를 지킨다.
 * opts: { duration, minLen, cues, snap }
 * 반환: { ok, list, from, to } — 못 옮기면 { ok:false, error }
 */
export function dragEdge(list, i, edge, t, opts) {
  const o = opts || {};
  const arr = Array.isArray(list) ? list : [];
  const cur = normalizeCut(arr[i]);
  if (!cur) return { ok: false, error: '컷을 찾지 못했어요' };
  const minLen = Number(o.minLen) > 0 ? Number(o.minLen) : MIN_CUT_S;
  const dur = Number(o.duration) > 0 ? Number(o.duration) : null;
  const rows = indexedCuts(arr);
  const at = rows.findIndex((r) => r.i === i);
  const prev = at > 0 ? rows[at - 1].cut : null;
  const next = at >= 0 && at < rows.length - 1 ? rows[at + 1].cut : null;
  let v = Number(t);
  if (!Number.isFinite(v)) return { ok: false, error: '옮길 위치를 알 수 없어요' };
  if (o.snap !== false) v = snapTime(v, o.cues, o.snapSeconds);
  if (dur !== null) v = clamp(v, 0, dur);
  if (v < 0) v = 0;

  let from = cur.from, to = cur.to;
  if (edge === 'from') {
    let lo = Math.max(0, prev ? prev.to : 0);
    let hi = cur.to - minLen;
    if (hi < lo) return { ok: false, error: '앞 컷에 붙어 있어 시작을 더 못 옮겨요' };
    from = clamp(v, lo, hi);
  } else if (edge === 'to') {
    let lo = cur.from + minLen;
    let hi = dur !== null ? dur : Infinity;
    if (next) hi = Math.min(hi, next.from);
    if (hi < lo) return { ok: false, error: '뒤 컷에 붙어 있어 끝을 더 못 옮겨요' };
    to = clamp(v, lo, hi);
  } else {
    return { ok: false, error: "손잡이는 'from'·'to' 만 있어요" };
  }
  from = round2(from); to = round2(to);
  if (!(to - from >= minLen - 1e-9)) return { ok: false, error: minLen + '초보다 짧아요' };
  const out = normAll(arr);
  out[i] = Object.assign({}, cur, { from, to });
  return { ok: true, list: out, from, to };
}

/**
 * 새 컷을 긋는다. 이미 있는 컷과 겹치면 하나로 합친다(합친 구간에 다른 파일번호가 섞이면 기본 영상으로).
 * opts: { duration, minLen, cues, snap, type }
 * 반환: { ok, list, index, from, to, merged } — index 는 새 목록에서 그 컷의 자리
 */
export function newCut(list, from, to, opts) {
  const o = opts || {};
  const arr = Array.isArray(list) ? list : [];
  const minLen = Number(o.minLen) > 0 ? Number(o.minLen) : MIN_CUT_S;
  const dur = Number(o.duration) > 0 ? Number(o.duration) : null;
  let a = Number(from), b = Number(to);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return { ok: false, error: '구간을 알 수 없어요' };
  if (b < a) { const tmp = a; a = b; b = tmp; }
  if (o.snap !== false) { a = snapTime(a, o.cues, o.snapSeconds); b = snapTime(b, o.cues, o.snapSeconds); }
  a = Math.max(0, a); if (dur !== null) { a = Math.min(a, dur); b = Math.min(b, dur); }
  a = round2(a); b = round2(b);
  if (!(b - a >= minLen - 1e-9)) return { ok: false, error: '자르려면 ' + minLen + '초보다 길게 그어 주세요' };

  let lo = a, hi = b, merged = 0;
  const clips = [];
  const keep = [];
  arr.forEach((c) => {
    const cur = normalizeCut(c);
    if (!cur) return;
    // 붙어 있는 구간(앞 컷의 끝 == 새 구간의 시작)도 합친다 — 타임라인에서 이어 그으면 한 덩어리로 보이는 게 자연스럽다.
    if (cur.to < a - 1e-9 || cur.from > b + 1e-9) { keep.push(cur); return; }
    merged++;
    lo = Math.min(lo, cur.from);
    hi = Math.max(hi, cur.to);
    clips.push(clipOf(cur, 0));
  });
  const uniq = clips.filter((v, k) => clips.indexOf(v) === k);
  const row = { type: String(o.type || MANUAL_TYPE), from: round2(lo), to: round2(hi), on: true, text: '' };
  if (uniq.length === 1 && uniq[0] !== null) row.clip = uniq[0];
  keep.push(row);
  const out = sortCuts(keep);
  const index = out.findIndex((c) => c.from === row.from && c.to === row.to);
  return { ok: true, list: out, index, from: row.from, to: row.to, merged };
}

/** 컷 하나를 목록에서 뺀다. */
export function removeCut(list, i) {
  const arr = Array.isArray(list) ? list : [];
  if (!(i >= 0 && i < arr.length)) return { ok: false, error: '컷을 찾지 못했어요' };
  return { ok: true, list: normAll(arr.slice(0, i).concat(arr.slice(i + 1))) };
}

/** 켜기/끄기 — 목록에서 그 자리만 바꾼 새 배열. */
export function setCutOn(list, i, on) {
  const arr = Array.isArray(list) ? list : [];
  const cur = normalizeCut(arr[i]);
  if (!cur) return { ok: false, error: '컷을 찾지 못했어요' };
  const out = normAll(arr);
  out[i] = Object.assign({}, cur, { on: on !== false });
  return { ok: true, list: out };
}

/** 그 컷의 영상을 바꾼다. clip 이 null/범위 밖이면 파일번호를 지운다(기본 영상). */
export function setCutClip(list, i, clip, inputCount) {
  const arr = Array.isArray(list) ? list : [];
  const cur = normalizeCut(arr[i]);
  if (!cur) return { ok: false, error: '컷을 찾지 못했어요' };
  const idx = clipOf({ clip }, inputCount);
  const row = Object.assign({}, cur);
  if (idx === null) delete row.clip; else row.clip = idx;
  const out = normAll(arr);
  out[i] = row;
  return { ok: true, list: out };
}

/** 켜져 있는 컷 전부의 영상을 바꾼다. clip 이 null 이면 파일번호를 모두 지운다. */
export function setAllClips(list, clip, inputCount) {
  const arr = Array.isArray(list) ? list : [];
  const idx = clipOf({ clip }, inputCount);
  return {
    ok: true,
    list: arr.map((c) => {
      const cur = normalizeCut(c);
      if (!cur) return c;
      const row = Object.assign({}, cur);
      if (idx === null) delete row.clip; else row.clip = idx;
      return row;
    })
  };
}

/* ── 셈 ────────────────────────────────────────────────────────── */

/** 켜진 컷의 수·초. onOnly=false 면 꺼진 것까지. */
export function cutTotals(list, onOnly) {
  const rows = (Array.isArray(list) ? list : []).map(normalizeCut).filter(Boolean)
    .filter((c) => onOnly === false || c.on !== false);
  const seconds = rows.reduce((a, c) => a + (c.to - c.from), 0);
  return { count: rows.length, seconds: round2(seconds) };
}

/** 영상(파일번호)별로 몇 곳·몇 초를 자르는지 — 컷 교체 화면의 요약. */
export function clipTotals(list, inputs, defaultName) {
  const names = Array.isArray(inputs) ? inputs : [];
  const by = {};
  (Array.isArray(list) ? list : []).map(normalizeCut).filter(Boolean).forEach((c) => {
    const name = clipNameOf(c, names, defaultName) || '(정하지 않음)';
    const g = by[name] || (by[name] = { name, count: 0, seconds: 0, on: 0 });
    g.count++;
    g.seconds = round2(g.seconds + (c.to - c.from));
    if (c.on !== false) g.on++;
  });
  return Object.keys(by).sort().map((k) => by[k]);
}

/** 시간 눈금 — 화면 폭에 맞춰 8개 이하로. [{ t, label }] */
export function timeTicks(span, maxTicks) {
  const a = Number(span && span.from) || 0;
  const b = Number(span && span.to) || 0;
  if (!(b > a)) return [];
  const want = Number(maxTicks) > 0 ? Number(maxTicks) : 6;
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  const step = steps.find((s) => (b - a) / s <= want) || 600;
  const out = [];
  for (let t = Math.ceil(a / step) * step; t <= b + 1e-9; t += step) {
    out.push({ t: round2(t), label: formatTime(t, step < 1) });
  }
  return out;
}

/** 12.3 → '0:12.3' · 372.5 → '6:12.5' (short 면 소수점 한 자리, 아니면 둘째 자리 생략) */
export function formatTime(sec, withTenth) {
  const v = Math.max(0, Number(sec) || 0);
  const m = Math.floor(v / 60);
  const s = v - m * 60;
  if (withTenth === true) return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
  if (withTenth === false) return m + ':' + (s < 10 ? '0' : '') + Math.round(s);
  return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
}

/* ── 자막 트랙 ─────────────────────────────────────────────────── */

/**
 * 미리보는 영상 한 대에 걸린 컷(켜진 것만) — from 순.
 * 영상이 하나면 모두 그 영상의 것이고, 여럿이면 clip 이 그 영상인 것만 고른다.
 * laneName 은 지금 미리보기로 연 영상 이름.
 */
export function cutsForLane(list, inputs, laneName, defaultName) {
  const names = Array.isArray(inputs) ? inputs : [];
  return (Array.isArray(list) ? list : []).map(normalizeCut).filter(Boolean)
    .filter((c) => c.on !== false)
    .filter((c) => (names.length <= 1 ? true : clipNameOf(c, names, defaultName) === laneName))
    .sort((a, b) => a.from - b.from);
}

/** 그 원본 시각이 잘려 나가는 중인가(켜진 컷 안). */
export function cutAwayAt(laneCuts, t) {
  const v = Number(t);
  return (Array.isArray(laneCuts) ? laneCuts : []).some((c) => v >= c.from - 1e-6 && v < c.to - 1e-6);
}

/**
 * 원본 시각 → 결과 영상 시각. 컷은 결과에서 사라지므로 그 앞의 초만큼 당겨진다.
 *  · 자막(⑤)은 컷을 거친 **결과 영상** 기준 시간이다 — 미리보기에서 자막을 맞추려면 이 변환이 필요하다.
 *  · 잘려 나가는 중이면 그 컷 시작까지 당긴 시각을 돌려준다(보여 줄지는 호출자가 판단).
 */
export function toOutputTime(laneCuts, t) {
  const v = Math.max(0, Number(t) || 0);
  let removed = 0;
  (Array.isArray(laneCuts) ? laneCuts : []).forEach((c) => {
    if (c.to <= v) removed += c.to - c.from;
    else if (c.from < v) removed += v - c.from;
  });
  return round2(Math.max(0, v - removed));
}

/** 결과 영상 시각 → 원본 시각(위 함수의 반대). */
export function toSourceTime(laneCuts, outT) {
  const v = Math.max(0, Number(outT) || 0);
  let removed = 0;
  const list = Array.isArray(laneCuts) ? laneCuts : [];
  for (const c of list) {
    const outStart = c.from - removed;
    if (v < outStart) return round2(v + removed);
    removed += c.to - c.from;
  }
  return round2(v + removed);
}

/** 카드 자막([start,end,text])·확정 자막(parseSrt 결과)·객체를 한 모양으로. */
export function cueList(raw) {
  const out = [];
  (Array.isArray(raw) ? raw : []).forEach((c) => {
    let start, end, text, lines;
    if (Array.isArray(c)) { start = Number(c[0]); end = Number(c[1]); text = String(c[2] == null ? '' : c[2]); }
    else if (c && typeof c === 'object') { start = Number(c.start); end = Number(c.end); text = String(c.text == null ? '' : c.text); lines = c.lines; }
    if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) return;
    const ls = (Array.isArray(lines) && lines.length ? lines : String(text).split('\n')).map((s) => String(s)).slice(0, 2);
    out.push({ start: round2(start), end: round2(end), text: ls.join('\n'), lines: ls });
  });
  return out.sort((a, b) => a.start - b.start).slice(0, MAX_TIMELINE_CUES);
}

/** 그 시각에 떠 있는 자막 — { cue, index } 또는 null. 끝 시각은 다음 자막의 시작으로 본다. */
export function cueAt(cues, t) {
  const v = Number(t);
  const list = Array.isArray(cues) ? cues : [];
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (v >= c.start - 1e-6 && v < c.end) return { cue: c, index: i };
  }
  return null;
}

/* ── 미리보기 겹치기 ───────────────────────────────────────────── */

/** 그 시각의 구간 제목·배지(design.segments). */
export function segmentAt(design, t) {
  const segs = design && Array.isArray(design.segments) ? design.segments : [];
  const v = Number(t);
  for (const s of segs) {
    if (v >= Number(s.start) - 1e-6 && v < Number(s.end)) return s;
  }
  return null;
}

/** 재생 위치에 지금 보여야 할 글자 — 자막·구간 제목·배지. */
export function overlayAt(opts) {
  const o = opts || {};
  const hit = cueAt(o.cues, o.t);
  const seg = segmentAt(o.design, o.t);
  return {
    caption: hit ? hit.cue : null,
    captionIndex: hit ? hit.index : -1,
    title: seg ? String(seg.title || '') : '',
    badge: seg ? String(seg.badge || '') : ''
  };
}

/** 미리보기에서 쓸 자막 줄 — 2줄까지, 빈 줄은 버린다. */
export function captionLines(cue) {
  if (!cue) return [];
  const ls = Array.isArray(cue.lines) && cue.lines.length ? cue.lines : String(cue.text || '').split('\n');
  return ls.map((s) => String(s).replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 2);
}
