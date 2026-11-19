/**
 * js/produceLogic.js — 제작 스텝퍼의 순수 계산(DOM·네트워크 없음, 노드에서 그대로 시험된다)
 *
 * 규격의 원본은 docs/CONTENT_STANDARD_v3.md(표1 클린 마스터·표3 캡컷 7단계)다. 숫자가 어긋나면 그 문서가 우선.
 * 노트북 content_render 오더 계약 v1 과 같은 규칙으로 입력을 검사한다(노트북·GAS 가 각자 한 번 더 검사한다).
 *
 * 하지 않는 것: 영상 업로드·전송(inbox 로 파일이 들어오는 방법은 아직 정해지지 않았다), SRT 생성(다음 단계).
 */

export const CONTENT_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
export const FILE_RE = /^[A-Za-z0-9가-힣._ -]{1,80}$/;
export const EXT_RE = /\.(mp4|mov|m4v)$/i;
export const MAX_INPUTS = 8;

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
  return { v: 1, inputs: [], profile: 'captions', crop_x: '', plan: false, cuts: false, review: {}, render: null };
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

/** 오더 payload 만들기 — 계약 v1. 하나라도 어긋나면 { ok:false, errors }. */
export function buildRenderPayload({ contentId, brand, inputs, profile, cropX }) {
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
