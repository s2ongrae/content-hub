/**
 * js/produceLogic.js — 제작 스텝퍼의 순수 계산(DOM·네트워크 없음, 노드에서 그대로 시험된다)
 *
 * 규격의 원본은 docs/CONTENT_STANDARD_v3.md(표1 클린 마스터·표3 캡컷 7단계)다. 숫자가 어긋나면 그 문서가 우선.
 * 노트북 content_render 오더 계약 v1 과 같은 규칙으로 입력을 검사한다(노트북·GAS 가 각자 한 번 더 검사한다).
 *
 * 2026-11-20: ① 영상 올리기(구글 드라이브 조각 업로드의 계산)와 ③ 컷 목록 → ④ 오더의 cuts 를 더했다.
 * 하지 않는 것: SRT 생성(다음 단계). 영상 바이트를 읽거나 보내는 일은 js/uploadVideo.js 가 한다(여기는 계산만).
 */

import { tcToSec } from './yt/edl.js?v=20261120a';

export const CONTENT_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
export const FILE_RE = /^[A-Za-z0-9가-힣._ -]{1,80}$/;
export const EXT_RE = /\.(mp4|mov|m4v)$/i;
export const MAX_INPUTS = 8;
export const MAX_CUTS = 150;                 // 노트북·GAS 와 같은 값(큐 payload 4000자 한도)
export const MAX_CUT_SPAN_S = 3600;

/* ── 영상 올리기(구글 드라이브) — GAS gas/Upload.gs 와 같은 값 ── */
export const UPLOAD_PART_BYTES = 2 * 1024 * 1024;
export const UPLOAD_MAX_BYTES = 1500 * 1024 * 1024;
export const UPLOAD_MAX_PARTS = 800;
const UPLOAD_NAME_OK = /^[A-Za-z0-9가-힣][A-Za-z0-9가-힣._ -]{0,79}$/;

/** 음량 프로필 — 표1. tpTarget 은 오더에 쓰는 목표, tpMax 는 검수 한도(목표에 여유를 둔다). */
export const PROFILES = {
  captions: { label: '자막만 얹을 때', lufs: -14.0, tol: 0.5, tpMax: -1.8, tpTarget: -2.0 },
  bgm: { label: 'BGM·효과음을 얹을 때', lufs: -16.0, tol: 0.5, tpMax: -2.0, tpTarget: -2.5 }
};

/** 트랙별 마무리 값 — 표3 ②④. 키는 brand 값 그대로(트랙 분기는 brand 하나로만). */
export const BRAND_FINISH = {
  daejeon_youth: { font: 'Pretendard Bold', fontFallback: 'Noto Sans KR Bold', color: '#FF7A1A', cpl: 12 },
  ppiyak_kimmary: { font: 'NanumSquareRound ExtraBold', fontFallback: '빙그레체 Bold', color: '#E08A56', cpl: 11 }
};
export function finishOf(brand) { return BRAND_FINISH[brand] || BRAND_FINISH.daejeon_youth; }

/** 표3 — 캡컷 7단계(합격 기준은 문서 그대로 줄인 것). brand 로 달라지는 칸은 finishOf 로 채운다. */
export function reviewSteps(brand) {
  const f = finishOf(brand);
  return [
    { id: 'r1', title: '캔버스·내보내기', rule: '9:16(1080×1920) · 30fps · 12~15Mbps · 스마트 HDR 끄기' },
    { id: 'r2', title: '폰트·스타일 일괄', rule: f.font + '(없으면 ' + f.fontFallback + ') · 크기 8~9 · 자간 -2 · 외곽선 #000000 9%' },
    { id: 'r3', title: '안전영역 배치', rule: '훅 Y +620(크기 115%) · 본문 Y -420 · 좌우 100px 이상 · 하단 1420px 이내 · 상단 240px 이상 · 줄당 ' + f.cpl + '자·2줄' },
    { id: 'r4', title: '강조어·페이드', rule: '자막당 강조어 1~2개만 ' + f.color + ' · 페이드는 첫·마지막 자막만 0.15초' },
    { id: 'r5', title: 'AI 보조 안내', rule: 'AI 가 자막을 만들었으면 마지막 2초 우측 "AI 자막 보조" + 업로드 본문에 "자막: AI 보조"' },
    { id: 'r6', title: 'BGM·효과음·최종 음량', rule: 'BGM 현장음 있으면 -24dB, 없으면 -16dB · 내보낸 뒤 loudnorm 실측 -14.0±0.5 LUFS / TP -1.5 이하' },
    { id: 'r7', title: '커버 프레임·제목', rule: '정사각 1080×1080 안전 구도 · 피사체 중앙 · 눈 감음 0 · 제목 4단어 이내' }
  ];
}

/** 단계 정의 — 화면 순서. */
export const STEPS = [
  { key: 'material', no: 1, title: '재료' },
  { key: 'plan', no: 2, title: '기획' },
  { key: 'cuts', no: 3, title: '컷 목록' },
  { key: 'render', no: 4, title: '클린 마스터' },
  { key: 'srt', no: 5, title: '자막 파일', soon: true },
  { key: 'finish', no: 6, title: '검수·마무리' }
];

export function defaultState() {
  return { v: 1, inputs: [], profile: 'captions', crop_x: '', plan: false, cuts: false, cut_list: [], cut_input: '', review: {}, render: null };
}

/** 저장된 값을 믿지 않고 모양을 다시 맞춘다(손상·옛 버전 방어). */
export function normalizeState(raw) {
  const s = defaultState();
  if (!raw || typeof raw !== 'object') return s;
  if (Array.isArray(raw.inputs)) s.inputs = raw.inputs.filter((x) => typeof x === 'string').slice(0, MAX_INPUTS);
  if (raw.profile === 'bgm' || raw.profile === 'captions') s.profile = raw.profile;
  if (raw.crop_x === '' || raw.crop_x == null) s.crop_x = '';
  else if (Number.isFinite(Number(raw.crop_x))) s.crop_x = Number(raw.crop_x);
  s.plan = raw.plan === true;
  s.cuts = raw.cuts === true;
  if (Array.isArray(raw.cut_list)) {
    s.cut_list = raw.cut_list.map((c) => {
      const o = c && typeof c === 'object' ? c : {};
      return { type: ['DEAD', 'FILLER', 'REPEAT'].indexOf(o.type) >= 0 ? o.type : 'DEAD', from: Number(o.from), to: Number(o.to), on: o.on !== false, text: String(o.text || '').slice(0, 60) };
    }).filter((c) => Number.isFinite(c.from) && Number.isFinite(c.to) && c.from >= 0 && c.to > c.from).slice(0, MAX_CUTS);
  }
  if (typeof raw.cut_input === 'string') s.cut_input = raw.cut_input.slice(0, 80);
  if (raw.review && typeof raw.review === 'object') {
    Object.keys(raw.review).forEach((k) => { if (/^r[1-7]$/.test(k)) s.review[k] = raw.review[k] === true; });
  }
  if (raw.render && typeof raw.render === 'object') {
    const r = raw.render;
    s.render = {
      order_id: String(r.order_id || '').slice(0, 60),
      status: String(r.status || '').slice(0, 30),
      sent_at: String(r.sent_at || '').slice(0, 40),
      needs_approval: r.needs_approval === true,
      approval_expires_at: String(r.approval_expires_at || '').slice(0, 40),
      note: String(r.note || '').slice(0, 200),
      report: (r.report && typeof r.report === 'object') ? r.report : null
    };
  }
  return s;
}

/** 입력 칸(줄바꿈·쉼표로 나눈 파일 이름) → { names, errors }. 경로·확장자·개수를 여기서 막는다. */
export function parseInputs(text) {
  const errors = [];
  const names = [];
  String(text || '').split(/[\r\n,]+/).map((s) => s.trim()).filter(Boolean).forEach((n) => {
    if (names.indexOf(n) >= 0) return;
    if (n.indexOf('..') >= 0 || n[0] === '.') errors.push('"' + n + '" — 점으로 시작하거나 ..이 들어간 이름은 안 돼요');
    else if (!FILE_RE.test(n)) errors.push('"' + n + '" — 파일 이름만 적어 주세요(폴더 경로·특수문자 불가, 80자 이내)');
    else if (!EXT_RE.test(n)) errors.push('"' + n + '" — mp4 · mov · m4v 만 가능해요');
    else names.push(n);
  });
  if (names.length > MAX_INPUTS) errors.push('파일은 ' + MAX_INPUTS + '개까지예요(지금 ' + names.length + '개)');
  return { names: names.slice(0, MAX_INPUTS), errors };
}

/* ── ③ 컷 목록 ── */

/** buildEDL 결과의 컷(타임코드 글자) → 상태에 저장하는 초 단위 목록. 전부 켜진 채로 시작한다. */
export function cutsFromEdl(result) {
  const list = [];
  ((result && result.cuts) || []).forEach((c) => {
    const from = tcToSec(c.from), to = tcToSec(c.to);
    if (from === null || to === null || !(to > from)) return;
    list.push({ type: c.type, from: Math.round(from * 100) / 100, to: Math.round(to * 100) / 100, on: true, text: String(c.text || '').slice(0, 60) });
  });
  return list;
}

/** 켜진 컷의 개수·잘라낼 초·남는 길이(원본 길이를 알 때). */
export function cutSummary(list, sourceSeconds) {
  const on = (list || []).filter((c) => c.on !== false);
  const sec = on.reduce((a, c) => a + (c.to - c.from), 0);
  const out = { count: on.length, seconds: Math.round(sec * 100) / 100, left: null };
  if (Number.isFinite(sourceSeconds) && sourceSeconds > 0) out.left = Math.round((sourceSeconds - sec) * 100) / 100;
  return out;
}

/**
 * 켜진 컷 → 오더에 싣는 짧은 모양. 영상이 하나면 [from,to], 둘 이상이면 [from,to,파일번호].
 * 영상이 여럿인데 어느 영상의 컷인지 정하지 않았으면 오류.
 */
export function cutsForOrder(state, inputs) {
  const s = normalizeState(state);
  const on = s.cut_list.filter((c) => c.on !== false);
  if (!on.length) return { ok: true, cuts: [] };
  const names = Array.isArray(inputs) ? inputs : s.inputs;
  if (on.length > MAX_CUTS) return { ok: false, error: '컷은 ' + MAX_CUTS + '곳까지예요(지금 ' + on.length + '곳). 덜 중요한 것을 꺼 주세요.' };
  let idx = null;
  if (names.length > 1) {
    idx = names.indexOf(s.cut_input);
    if (idx < 0) return { ok: false, error: '컷이 어느 영상의 것인지 ③에서 골라 주세요(영상이 ' + names.length + '개예요).' };
  } else if (names.length === 0) {
    return { ok: false, error: '컷을 자를 영상이 없어요. ①에서 영상을 먼저 정해 주세요.' };
  }
  const cuts = on.map((c) => {
    const f = Math.round(c.from * 100) / 100, t = Math.round(c.to * 100) / 100;
    return idx === null ? [f, t] : [f, t, idx];
  });
  for (const c of cuts) {
    if (!(c[1] > c[0]) || c[1] - c[0] > MAX_CUT_SPAN_S) return { ok: false, error: '컷 구간이 올바르지 않아요(' + c[0] + '~' + c[1] + '초).' };
  }
  return { ok: true, cuts };
}

/* ── ① 영상 올리기 ── */

/** 드라이브 보관·노트북 inbox 에서 쓸 수 있는 이름으로 바꾼다(허용 밖 글자 → _). 바뀌었는지도 알려 준다. */
export function safeUploadName(name) {
  const orig = String(name || '').trim();
  let n = orig.replace(/[^A-Za-z0-9가-힣._ -]/g, '_').replace(/\.{2,}/g, '_').replace(/^[^A-Za-z0-9가-힣]+/, '');
  const m = n.match(/^(.*?)(\.[A-Za-z0-9]+)?$/);
  let base = (m && m[1]) || '';
  const ext = (m && m[2]) || '';
  if (base.length + ext.length > 80) base = base.slice(0, 80 - ext.length);
  n = base + ext;
  return { name: n, changed: n !== orig };
}

/** 올릴 파일 검사 → { ok, name, renamed, parts, errors }. 이름은 안전한 이름으로 고쳐서 돌려준다. */
export function checkUploadFile(file) {
  const errors = [];
  const f = file || {};
  const fixed = safeUploadName(f.name);
  if (!UPLOAD_NAME_OK.test(fixed.name) || !EXT_RE.test(fixed.name)) errors.push('"' + String(f.name || '').slice(0, 40) + '" — mp4 · mov · m4v 영상만 올릴 수 있어요');
  const size = Number(f.size);
  if (!Number.isFinite(size) || size < 1) errors.push('파일이 비어 있어요');
  else if (size > UPLOAD_MAX_BYTES) errors.push('파일이 너무 커요(' + Math.round(size / 1048576) + 'MB, 최대 ' + Math.round(UPLOAD_MAX_BYTES / 1048576) + 'MB)');
  const parts = Number.isFinite(size) && size > 0 ? Math.ceil(size / UPLOAD_PART_BYTES) : 0;
  if (parts > UPLOAD_MAX_PARTS) errors.push('조각이 너무 많아요');
  return { ok: errors.length === 0, name: fixed.name, renamed: fixed.changed, parts, errors };
}

/** 바이트 수 → '12.3MB' 같은 짧은 글자. */
export function formatBytes(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return '-';
  if (v < 1024 * 1024) return Math.max(1, Math.round(v / 1024)) + 'KB';
  if (v < 1024 * 1024 * 1024) return (v / 1048576).toFixed(1) + 'MB';
  return (v / 1073741824).toFixed(2) + 'GB';
}

/** 오더 payload 만들기 — 계약 v1(+ cuts). 하나라도 어긋나면 { ok:false, errors }. */
export function buildRenderPayload({ contentId, brand, inputs, profile, cropX, cuts }) {
  const errors = [];
  if (!CONTENT_ID_RE.test(String(contentId || ''))) errors.push('콘텐츠 ID 형식이 맞지 않아요(영문·숫자·_·- 40자 이내)');
  if (brand !== 'daejeon_youth' && brand !== 'ppiyak_kimmary') errors.push('트랙을 알 수 없어요');
  const list = Array.isArray(inputs) ? inputs : [];
  if (!list.length) errors.push('영상 파일 이름을 하나 이상 적어 주세요');
  const chk = parseInputs(list.join('\n'));
  errors.push(...chk.errors);
  const prof = profile || 'captions';
  if (!PROFILES[prof]) errors.push('음량 프로필이 올바르지 않아요');
  const payload = { content_id: String(contentId || ''), brand, inputs: chk.names, profile: prof };
  if (cropX !== '' && cropX != null) {
    const n = Number(cropX);
    if (!Number.isFinite(n) || n < 0 || n > 1) errors.push('crop_x 는 0~1 사이 숫자예요(0=왼쪽, 0.5=가운데, 1=오른쪽)');
    else payload.crop_x = n;
  }
  if (cuts !== undefined && cuts !== null) {
    if (!Array.isArray(cuts)) errors.push('cuts 는 구간 목록이어야 해요');
    else if (cuts.length > MAX_CUTS) errors.push('컷은 ' + MAX_CUTS + '곳까지예요');
    else {
      cuts.forEach((c, i) => {
        const good = Array.isArray(c) && c.length >= 2 && c.length <= 3 && Number.isFinite(c[0]) && Number.isFinite(c[1]) && c[0] >= 0 && c[1] > c[0] && c[1] - c[0] <= MAX_CUT_SPAN_S
          && (c.length === 2 ? chk.names.length === 1 : (Number.isInteger(c[2]) && c[2] >= 0 && c[2] < chk.names.length));
        if (!good) errors.push('컷 ' + (i + 1) + '번 구간이 올바르지 않아요');
      });
      if (cuts.length && !errors.length) payload.cuts = cuts;
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, payload };
}

/** 큐 상태 코드 → 화면 문구(코드값은 화면에 그대로 보이지 않는다). 모르는 값은 '확인 필요'로. */
const ORDER_STATUS_KO = {
  WAITING_APPROVAL: '승인 대기', PENDING: '실행 대기', RUNNING: '실행 중', DONE: '완료', FAILED: '실패',
  REJECTED: '거절됨', EXPIRED: '승인 기한 지남', REVIEW_NEEDED: '확인 필요', TIMEOUT_REVIEW: '확인 필요', PARTIAL: '일부만 진행'
};
export function orderStatusLabel(code) {
  const c = String(code || '').toUpperCase();
  if (!c) return '접수됨';
  return ORDER_STATUS_KO[c] || '확인 필요';
}

/* ── 오더 진행 상태 자동 표시 (hub_order_status 폴링) ───────────────────────── */

/** 더 기다려도 바뀌지 않는 상태 — 폴링을 멈춘다. */
export const ORDER_TERMINAL = ['DONE', 'FAILED', 'REJECTED', 'EXPIRED', 'REVIEW_NEEDED', 'TIMEOUT_REVIEW'];
export const POLL_INTERVAL_MS = 15000;
export const POLL_MAX_FAILS = 3;

export function isTerminalStatus(code) {
  return ORDER_TERMINAL.indexOf(String(code || '').toUpperCase()) >= 0;
}

/** 서버(GAS)가 이 액션을 아직 모르는 코드들 — 빨간 에러 대신 중립 안내(기존 화면들과 같은 기준). */
export function isNotDeployedCode(code) {
  return ['ERR_UNKNOWN_ACTION', 'ERR_NOT_IMPLEMENTED', 'ERR_ACTION_NOT_ALLOWED', 'ERR_INVALID_ACTION'].indexOf(String(code || '')) >= 0;
}

/** 승인 기한까지 남은 시간 → '12분 03초' / 지났으면 null. 기한을 모르면 null. */
export function approvalRemaining(expiresAt, nowMs) {
  const t = Date.parse(String(expiresAt || ''));
  if (!Number.isFinite(t)) return null;
  const left = Math.floor((t - nowMs) / 1000);
  if (left <= 0) return null;
  const m = Math.floor(left / 60), sec = left % 60;
  return m + '분 ' + String(sec).padStart(2, '0') + '초';
}

function minutesSince(iso, nowMs) {
  const t = Date.parse(String(iso || ''));
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((nowMs - t) / 60000));
}

/**
 * 큐가 준 상태 → 화면 문구. 코드값(WAITING_APPROVAL 등)은 그대로 보이지 않는다.
 * live = { status, approval_expires_at, started_at, created_at, result, error }
 * 반환 { kind: 'info'|'ok'|'warn'|'err', title, text }
 */
export function describeOrder(live, nowMs) {
  const l = live || {};
  const c = String(l.status || '').toUpperCase();
  const first = (v) => String(v || '').split(/\r?\n/).find((x) => x.trim()) || '';
  switch (c) {
    case 'WAITING_APPROVAL': {
      if (!Date.parse(String(l.approval_expires_at || ''))) {
        return { kind: 'info', title: '승인 대기', text: '포털 오더함에서 [승인]을 눌러 주세요(15분 안에).' };   // 기한을 모르면 지났다고 단정하지 않는다
      }
      const left = approvalRemaining(l.approval_expires_at, nowMs);
      return left
        ? { kind: 'info', title: '승인 대기', text: '포털 오더함에서 [승인]을 눌러 주세요. 남은 시간 ' + left + '.' }
        : { kind: 'warn', title: '승인 대기', text: '승인 기한이 지났을 수 있어요. 포털 오더함에서 확인해 주세요.' };
    }
    case 'PENDING':
      return { kind: 'info', title: '실행 대기', text: '승인됐어요. 노트북이 곧 집어 가요(1분 안팎).' };
    case 'RUNNING': {
      const m = minutesSince(l.started_at || l.created_at, nowMs);
      return { kind: 'info', title: '실행 중', text: '노트북에서 만들고 있어요' + (m !== null ? ' · 시작한 지 ' + m + '분' : '') + '. 영상 길이에 따라 몇 분 걸려요.' };
    }
    case 'DONE':
      return { kind: 'ok', title: '완료', text: (first(l.result) ? first(l.result) + ' ' : '') + '결과 표(규격 대조)는 아래에 report 를 붙여 넣어 보세요.' };
    case 'FAILED':
      return { kind: 'err', title: '실패', text: (first(l.error) || first(l.result) || '노트북에서 실패했어요.') + ' — 원인은 포털 오더함에서 확인해 주세요.' };
    case 'REJECTED':
      return { kind: 'warn', title: '거절됨', text: '승인에서 거절됐어요. 필요하면 다시 보내 주세요.' };
    case 'EXPIRED':
      return { kind: 'warn', title: '승인 기한 지남', text: '15분 안에 승인되지 않아 실행되지 않았어요. 다시 보내 주세요.' };
    case 'REVIEW_NEEDED':
    case 'TIMEOUT_REVIEW':
      return { kind: 'warn', title: '확인 필요', text: '실행 결과를 사람이 확인해야 해요. 포털 오더함에서 확인해 주세요.' };
    default:
      return { kind: 'info', title: orderStatusLabel(c), text: '' };
  }
}

const CHECK_STATUS = ['PASS', 'WARN', 'FAIL'];

/** 노트북 결과(report) 모양 검사 — 문자열(JSON)도 받는다. 숫자가 숫자가 아니면 거부한다(지어내지 않는다). */
export function parseReport(input) {
  let r = input;
  if (typeof input === 'string') {
    try { r = JSON.parse(input); } catch (e) { return { ok: false, error: 'JSON 형식이 아니에요' }; }
  }
  if (!r || typeof r !== 'object' || Array.isArray(r)) return { ok: false, error: '결과 형식이 아니에요' };
  const num = (k) => (r[k] === null || r[k] === undefined || r[k] === '') ? null : Number(r[k]);
  const out = { out: String(r.out || ''), width: num('width'), height: num('height'), fps: num('fps'),
    duration: num('duration'), lufs: num('lufs'), tp: num('tp'), checks: [] };
  for (const k of ['width', 'height', 'fps', 'duration', 'lufs', 'tp']) {
    if (out[k] !== null && !Number.isFinite(out[k])) return { ok: false, error: k + ' 값이 숫자가 아니에요' };
  }
  if (!Array.isArray(r.checks)) return { ok: false, error: 'checks 목록이 없어요' };
  for (const c of r.checks.slice(0, 40)) {
    const st = String((c && c.status) || '').toUpperCase();
    if (CHECK_STATUS.indexOf(st) < 0) return { ok: false, error: 'checks 의 status 는 PASS·WARN·FAIL 이어야 해요' };
    out.checks.push({ id: String((c && c.id) || '').slice(0, 40), status: st, msg: String((c && c.msg) || '').slice(0, 200) });
  }
  return { ok: true, report: out };
}

/** 표1 과 대조 — 노트북이 잰 값을 화면이 한 번 더 규격에 맞춰 본다(값이 없으면 '확인 못 함'). */
export function compareStandard(report, profile) {
  const p = PROFILES[profile] || PROFILES.captions;
  const rows = [];
  const add = (id, label, status, msg) => rows.push({ id, label, status, msg });
  const has = (v) => v !== null && v !== undefined && Number.isFinite(v);
  add('size', '해상도 1080×1920', !has(report.width) || !has(report.height) ? 'WARN' : (report.width === 1080 && report.height === 1920 ? 'PASS' : 'FAIL'),
    has(report.width) && has(report.height) ? report.width + '×' + report.height : '확인 못 함');
  add('fps', '프레임 30fps', !has(report.fps) ? 'WARN' : (Math.abs(report.fps - 30) < 0.01 ? 'PASS' : 'FAIL'), has(report.fps) ? report.fps + 'fps' : '확인 못 함');
  add('len', '길이 3.0~90.0초', !has(report.duration) ? 'WARN' : (report.duration >= 3 && report.duration <= 90 ? 'PASS' : 'FAIL'),
    has(report.duration) ? report.duration.toFixed(1) + '초' : '확인 못 함');
  add('lufs', '음량 ' + p.lufs.toFixed(1) + '±' + p.tol + ' LUFS', !has(report.lufs) ? 'WARN' : (Math.abs(report.lufs - p.lufs) <= p.tol ? 'PASS' : 'FAIL'),
    has(report.lufs) ? report.lufs.toFixed(2) + ' LUFS' : '확인 못 함');
  add('tp', '진짜 피크 ' + p.tpMax.toFixed(1) + ' dBTP 이하', !has(report.tp) ? 'WARN' : (report.tp <= p.tpMax ? 'PASS' : 'FAIL'),
    has(report.tp) ? report.tp.toFixed(2) + ' dBTP' : '확인 못 함');
  return rows;
}

/** 단계별 완료 여부 — 화면 머리의 진행 표시용. 렌더는 '오더 접수'가 아니라 '규격 대조 FAIL 0'이어야 끝이다. */
export function stepStatus(state, brand) {
  const s = normalizeState(state);
  const parsed = parseInputs(s.inputs.join('\n'));
  const rep = s.render && s.render.report;
  let renderDone = false;
  if (rep) {
    const rows = compareStandard(rep, s.profile);
    renderDone = rows.every((r) => r.status !== 'FAIL') && rep.checks.every((c) => c.status !== 'FAIL');
  }
  const reviewDone = reviewSteps(brand).every((x) => s.review[x.id] === true);
  return {
    material: parsed.names.length > 0 && parsed.errors.length === 0,
    plan: s.plan,
    cuts: s.cuts,
    render: renderDone,
    srt: false,
    finish: reviewDone
  };
}
