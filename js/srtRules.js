/**
 * js/srtRules.js — 자막(SRT) 읽기·검사 (순수 계산: DOM·네트워크 없음, 노드에서 그대로 시험된다)
 *
 * 규격은 docs/CONTENT_STANDARD_v3.md 표2 — 줄당 12자(대전 청년)/11자(김메리, 공백 포함) · 최대 2줄 · cue 1.0~3.5초 ·
 * cue 간격 0.06초 이상 · 문장 끝 마침표 제거 · ASS 태그·화자 표기·카라오케 금지.
 * 노트북 hub-agent/notebook-agent/lib/srt.js 의 parseSrt·checkSrt 와 **같은 규칙**이다(허브는 사람이 고칠 때 바로 알려 주고,
 * 노트북은 굽기 직전에 한 번 더 막는다). 한쪽만 바꾸지 말고 시험의 같은 값 표로 맞춘다.
 *
 * FAIL = 굽지 못하는 문제(시간 역전·겹침·3줄 이상·빈 자막·태그·화자 표기), WARN = 알리고 진행할 수 있는 문제.
 */

export const CPL = { daejeon_youth: 12, ppiyak_kimmary: 11 };
export const MIN_DUR = 1.0;
export const MAX_DUR = 3.5;
export const MIN_GAP = 0.06;
export const MAX_LINES = 2;

export function cplOf(brand) { return CPL[brand] || CPL.daejeon_youth; }

/** 00:00:01,234 · 00:00:01.234 → 초. 못 읽으면 null */
export function parseTime(s) {
  const m = String(s || '').trim().match(/^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})$/);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000;
}

/** SRT 글자 → { cues:[{start,end,text,lines}], errors:[{block,msg}] } — 깨진 블록은 건너뛰고 이유를 남긴다. */
export function parseSrt(input) {
  const text = String(input == null ? '' : input).replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
  const cues = [], errors = [];
  if (!text) return { cues, errors };
  text.split(/\n{2,}/).forEach((block, bi) => {
    const lines = block.split('\n');
    let i = 0;
    if (/^\d+$/.test(lines[0].trim())) i = 1;
    const tl = lines[i] || '';
    const m = tl.match(/^\s*(\S+)\s*-->\s*(\S+)/);
    if (!m) { errors.push({ block: bi + 1, msg: '시간 줄(00:00:01,000 --> 00:00:03,000)이 없어요' }); return; }
    const start = parseTime(m[1]), end = parseTime(m[2]);
    if (start === null || end === null) { errors.push({ block: bi + 1, msg: '시간 형식이 올바르지 않아요: ' + tl.trim().slice(0, 40) }); return; }
    const body = lines.slice(i + 1).join('\n').trim();
    cues.push({ start, end, text: body, lines: body ? body.split('\n') : [] });
  });
  return { cues, errors };
}

/** 규격 검사 → [{ cue(1부터), level:'FAIL'|'WARN', code, msg }] */
export function checkSrt(cues, brand) {
  const cpl = cplOf(brand);
  const issues = [];
  const add = (cue, level, code, msg) => issues.push({ cue, level, code, msg });
  (Array.isArray(cues) ? cues : []).forEach((c, idx) => {
    const n = idx + 1;
    const lines = Array.isArray(c.lines) && c.lines.length ? c.lines : String(c.text || '').split('\n');
    const body = lines.join('\n');
    if (!body.trim()) add(n, 'FAIL', 'empty', '내용이 비어 있어요');
    if (!(c.end > c.start)) add(n, 'FAIL', 'time_order', '끝 시각이 시작보다 빨라요');
    if (lines.length > MAX_LINES) add(n, 'FAIL', 'lines', lines.length + '줄이에요(최대 ' + MAX_LINES + '줄)');
    if (/\{\\[^}]*\}|\\an?\d|\\k\d|\\c&|\\fad/i.test(body)) add(n, 'FAIL', 'ass_tag', 'ASS 태그는 쓸 수 없어요');
    const slot = /\[\s*(채우기)?\s*\]/.test(body);
    if (slot) add(n, 'FAIL', 'slot', '채우지 않은 칸([ ])이 남아 있어요 — 영상에서 확인한 값으로 채워 주세요');
    if (!slot && /^\s*(\[[^\]]{1,12}\]|\([^)]{1,12}\)|[가-힣A-Za-z0-9]{1,8}\s*:)\s/.test(body) && /^\s*(\[|\(|[가-힣A-Za-z0-9]{1,8}\s*:)/.test(lines[0])) add(n, 'FAIL', 'speaker', '화자 표기는 쓸 수 없어요');
    lines.forEach((ln, li) => { if (ln.length > cpl) add(n, 'WARN', 'cpl', (li + 1) + '번째 줄이 ' + ln.length + '자예요(최대 ' + cpl + '자)'); });
    const dur = c.end - c.start;
    if (dur > 0 && dur < MIN_DUR - 1e-6) add(n, 'WARN', 'short', '표시 시간이 ' + dur.toFixed(2) + '초예요(최소 ' + MIN_DUR + '초)');
    if (dur > MAX_DUR + 1e-6) add(n, 'WARN', 'long', '표시 시간이 ' + dur.toFixed(2) + '초예요(최대 ' + MAX_DUR + '초)');
    if (/[.。]\s*$/.test(body)) add(n, 'WARN', 'period', '문장 끝 마침표는 지워요');
    const prev = cues[idx - 1];
    if (prev) {
      if (c.start < prev.end - 1e-6) add(n, 'FAIL', 'overlap', '앞 자막과 시간이 겹쳐요');
      else if (c.start - prev.end < MIN_GAP - 1e-6) add(n, 'WARN', 'gap', '앞 자막과 간격이 ' + (c.start - prev.end).toFixed(2) + '초예요(최소 ' + MIN_GAP + '초)');
    }
  });
  return issues;
}

/** 글 → { cues, errors, issues, fail, warn } — 화면이 한 번에 쓰는 요약 */
export function analyzeSrt(text, brand) {
  const p = parseSrt(text);
  const issues = checkSrt(p.cues, brand);
  return {
    cues: p.cues, errors: p.errors, issues,
    fail: issues.filter((i) => i.level === 'FAIL').length + p.errors.length,
    warn: issues.filter((i) => i.level === 'WARN').length
  };
}

/** 확정 여부 비교용 짧은 지문(줄바꿈·앞뒤 공백 차이는 같은 글로 본다). 보안용이 아니다. */
export function textHash(text) {
  const s = String(text == null ? '' : text).replace(/\r\n?/g, '\n').trim();
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36) + ':' + s.length;
}
