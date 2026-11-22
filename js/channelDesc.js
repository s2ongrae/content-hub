/**
 * js/channelDesc.js — 클립·쇼츠·릴스 '설명란 5블록' 포맷과 린터 (2026-11-22)
 *
 * 근거
 *  · 성래 님이 **손으로 고친 네이버 클립 설명**(진미오겹살, 2026-11-22 15:2x):
 *      고치기 전 — 제목·본문·태그가 3줄 덩어리(한 문단에 세 문장이 붙음)
 *      고친 후   — 5블록: 제목 / 요약 1문장 / 정보(한 줄에 한 항목) / 행동 유도 2줄 / 해시태그 1줄,
 *                  블록 사이에만 빈 줄 1개, 이모지 없음, 주소는 '도로명+건물번호'까지만.
 *  · 성래 님 발행 블로그 실측(문단 108 · 덩어리 27 → 덩어리 2~5줄)과 같은 원리(빈 줄은 덩어리 경계에만).
 *  · 제미니 협의 확정(2026-11-22): 제목 32자 이내(모바일 피드 접힘선), 정보 최대 6줄,
 *    클립은 이모지 없이 / 쇼츠·릴스는 📍⏰🚗만, 숫자·시간·주소 내부는 절대 자르지 않는다.
 *
 * 쓰는 법
 *   import { buildDesc, normalizeDesc, lintDesc } from './channelDesc.js';
 *   buildDesc({ channel:'clip', title, summary, info:[{kind:'hours',text:'매일 15:00~24:00'}], action:[...], hashtags:[...] })
 *   normalizeDesc(doc.body, 'clip')   // 이미 있는 문안을 5블록으로 다시 접는다(올리기 직전 후처리)
 *   lintDesc(text, 'clip')            // 발행 전 점검 — 고칠 것이 없으면 []
 *
 * 이 모듈은 글자를 새로 쓰지 않는다(사실을 지어내지 않는다). 넘어온 줄을 **배치만** 바꾼다.
 */

import { RHYTHM, toGroups, splitLongBlock, HASHTAG_LINE_RE } from './blogTone.js';

/** 채널별 한도 — 파이썬 CLI(tools/channel_desc_cli.py)와 같은 값(seeds/channel_desc_rules_2026w48.json). */
export const DESC_RULES = {
  clip: { label: '네이버 클립', titleMax: 34, charsMax: 3000, emoji: false },
  shorts: { label: '유튜브 쇼츠', titleMax: 34, charsMax: 5000, emoji: true },
  reels: { label: '인스타 릴스', titleMax: 34, charsMax: 2200, emoji: true },
  ig_feed: { label: '인스타 피드', titleMax: 34, charsMax: 2200, emoji: true },
  daangn: { label: '당근 스토리', titleMax: 40, charsMax: 1000, emoji: true }
};

export const DESC_BLOCKS = ['title', 'summary', 'info', 'action', 'hashtags'];

/** 정보 줄 종류 — 이 순서대로 한 덩어리에 모은다. */
export const INFO_ORDER = ['hours', 'address', 'parking'];

const INFO_EMOJI = { hours: '⏰', address: '📍', parking: '🚗' };
const TIME_RE = /(?:\d{1,2}\s?:\s?\d{2})|(?:\d{1,2}\s?시(?!간)(?:\s?~\s?\d{1,2}\s?시)?)/;
const ADDRESS_RE = /(?:[가-힣]+(?:시|도)\s*)?[가-힣]+(?:구|군)\s?[가-힣0-9]*[로길]\s?\d+|(?:[가-힣]+동)\s?\d+-\d+/;
const PARKING_RE = /주차/;
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;

export function rulesOf(channel) {
  return DESC_RULES[channel] || DESC_RULES.clip;
}

/** 한 줄 안에 여러 문장이 붙어 있으면 문장 단위로 나눈다(마침표 뒤 공백 기준). */
export function splitSentences(line) {
  const s = String(line == null ? '' : line).replace(/\s+/g, ' ').trim();
  if (!s) return [];
  const parts = s.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
  const out = [];
  parts.forEach((p) => {
    if (p.length > RHYTHM.descLineMax) {
      const cut = splitLongBlock(p, RHYTHM.descLineMax);
      // 잘린 조각이 12자 미만이면 자르지 않는다(제목·명사가 토막 나는 것을 막는다)
      if (cut.length > 1 && cut.every((x) => x.length >= 12)) cut.forEach((x) => out.push(x));
      else out.push(p);
    } else out.push(p);
  });
  return out;
}

/** 이 줄이 무슨 정보인가 — hours · address · parking · null */
export function infoKindOf(line) {
  const s = String(line || '');
  if (PARKING_RE.test(s)) return 'parking';
  if (ADDRESS_RE.test(s)) return 'address';
  if (TIME_RE.test(s)) return 'hours';
  return null;
}

/** 이모지 접두를 떼고 판정한다(쇼츠·릴스 문안을 다시 읽을 때). */
function stripEmoji(s) {
  return String(s || '').replace(/^(?:[📍⏰🚗💰📞☎🕘🅿⏳🍴🚙]\s*)+/u, '').trim();
}

/** 정보 줄 다듬기 — 마침표·호수(103·104호)를 빼고 도로명+건물번호까지만 남긴다(성래 님 클립 수정본 기준). */
export function tidyInfo(text, kind) {
  let s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  if (kind === 'address') s = s.replace(/\s*\d+(?:\s?[·,-]\s?\d+)*호\.?$/, '').trim();
  return s.replace(/[.\s]+$/, '');
}

/** 한 줄에 두 가지 이상 정보가 몰렸으면 쪼갠다 — "매일 15:00~24:00, 대전 서구 용문로 41-80". */
export function splitInfoLine(line) {
  const s = String(line == null ? '' : line).replace(/\s+/g, ' ').trim();
  if (!s) return [];
  const kinds = [TIME_RE.test(s), ADDRESS_RE.test(s), PARKING_RE.test(s)].filter(Boolean).length;
  if (kinds < 2) return [{ kind: infoKindOf(s) || 'hours', text: s }];
  return s.split(/\s*,\s*|\s{2,}/)
    .map((p) => p.trim()).filter(Boolean)
    .map((p) => ({ kind: infoKindOf(p) || 'hours', text: p }));
}

/** 마무리·행동 유도 문장인가 — 요약이 아니라 마지막 블록으로 보낸다. */
export function isActionLine(line) {
  const s = String(line || '').trim();
  return /(?:세요|해요|하세요|보세요|가세요|드세요|주문|저장|달려|방문|들러|예약)[!.~\s]*$/.test(s)
    || /^(?:저장|꼭 |한 번 |다음엔|다음에)/.test(s);
}

function normalizeInfo(entry) {
  if (entry && typeof entry === 'object') {
    const kind = INFO_ORDER.indexOf(entry.kind) >= 0 ? entry.kind : (infoKindOf(entry.text) || 'hours');
    return { kind, text: String(entry.text || '').trim() };
  }
  const text = String(entry == null ? '' : entry).trim();
  return { kind: infoKindOf(text) || 'hours', text };
}

function hashtagsOf(list) {
  const arr = Array.isArray(list) ? list : String(list || '').split(/\s+/);
  const out = [];
  arr.forEach((t) => {
    const s = String(t || '').trim();
    if (!s) return;
    const one = s.charAt(0) === '#' ? s : '#' + s;
    if (!out.includes(one)) out.push(one);
  });
  return out;
}

function withEmoji(kind, text, channel) {
  const r = rulesOf(channel);
  if (!r.emoji) return text;
  const e = INFO_EMOJI[kind];
  if (!e) return text;
  return text.startsWith(e) ? text : e + ' ' + text;
}

/**
 * 5블록 설명란을 만든다.
 *  { channel, title, summary(문자열 또는 배열), info(문자열/객체 배열), action(문자열/배열), hashtags(배열/문자열) }
 */
export function buildDesc(input) {
  const o = input || {};
  const channel = o.channel || 'clip';
  const r = rulesOf(channel);
  const blocks = [];

  const title = String(o.title == null ? '' : o.title).replace(/\s+/g, ' ').trim();
  if (title) blocks.push([title.slice(0, Math.max(r.titleMax, 1) * 2)]);

  const summaryLines = [];
  (Array.isArray(o.summary) ? o.summary : String(o.summary == null ? '' : o.summary).split('\n'))
    .forEach((line) => splitSentences(line).forEach((x) => summaryLines.push(x)));
  if (summaryLines.length) blocks.push(summaryLines);

  const entries = (Array.isArray(o.info) ? o.info : (o.info ? [o.info] : []))
    .reduce((acc, x) => acc.concat(normalizeInfo(x)), [])
    .map((x) => ({ kind: x.kind, text: tidyInfo(x.text, x.kind) }))
    .filter((x) => x.text);
  if (entries.length) {
    const ordered = INFO_ORDER.map((k) => entries.filter((x) => x.kind === k))
      .reduce((a, b) => a.concat(b), [])
      .concat(entries.filter((x) => INFO_ORDER.indexOf(x.kind) < 0));
    blocks.push(ordered.map((x) => withEmoji(x.kind, x.text, channel)));
  }

  const actionLines = [];
  (Array.isArray(o.action) ? o.action : String(o.action == null ? '' : o.action).split('\n'))
    .forEach((line) => splitSentences(line).forEach((x) => actionLines.push(x)));
  if (actionLines.length) blocks.push(actionLines);

  const tags = hashtagsOf(o.hashtags);
  if (tags.length) blocks.push([tags.join(' ')]);

  return blocks.map((b) => b.filter(Boolean).join('\n')).filter(Boolean).join('\n\n');
}

/**
 * 이미 있는 설명란(한 덩어리로 뭉친 글 포함)을 5블록으로 다시 접는다.
 *  ① 해시태그 줄을 뒤로 뺀다 ② 정보 줄을 찾아 한 줄씩 ③ 첫 줄은 제목 ④ 남은 줄은 요약·행동
 *  사실을 더하거나 빼지 않는다 — **배치만** 바꾼다.
 */
export function normalizeDesc(text, channel) {
  const ch = channel || 'clip';
  const r0 = rulesOf(ch);
  const headline = [];
  const info = [];
  const body = [];
  const tags = [];

  // 첫 줄은 제목 — 제목 상한을 넘으면 제목 경계(공백)에서 먼저 끊는다.
  const takeTitle = (rawLine) => {
    const arr = Array.from(String(rawLine || '').replace(/\s+/g, ' ').trim());
    if (!arr.length) return '';
    if (arr.length <= r0.titleMax) {
      headline.push(arr.join(''));
      return '';
    }
    let cut = -1;
    for (let i = Math.max(0, r0.titleMax - 6); i <= Math.min(arr.length - 1, r0.titleMax + 10); i++) {
      if (arr[i] === ' ') { cut = i; break; }
    }
    if (cut > 0) {
      headline.push(arr.slice(0, cut).join('').trim());
      return arr.slice(cut + 1).join('').trim();
    }
    headline.push(arr.join(''));
    return '';
  };

  toGroups(String(text == null ? '' : text)).forEach((g) => {
    g.forEach((rawLine) => {
      let line = rawLine;
      if (!headline.length) {
        line = takeTitle(line);
        if (!line) return;
      }
      splitSentences(line).forEach((one) => {
        if (HASHTAG_LINE_RE.test(one.replace(/\s+/g, ' ').trim())) {
          (one.match(/#[^\s#]+/g) || []).forEach((t) => { if (!tags.includes(t)) tags.push(t); });
          return;
        }
        const plain = stripEmoji(one);
        if (infoKindOf(plain)) {
          splitInfoLine(plain).forEach((part) => {
            const tidy = tidyInfo(part.text, part.kind);
            if (tidy && !info.some((x) => x.text === tidy)) info.push({ kind: part.kind, text: tidy });
          });
          return;
        }
        body.push(one);
      });
    });
  });

  const action = body.filter(isActionLine);
  const summary = body.filter((l) => !isActionLine(l));
  return buildDesc({
    channel: ch,
    title: headline[0] || '',
    summary: summary.slice(0, 2),
    info,
    action,
    hashtags: tags
  });
}

/**
 * 발행 전 점검 — 고칠 것이 없으면 [].
 * 코드: title_long · run_on · info_merged · info_split · line_long · hashtag_not_last ·
 *       emoji_in_clip · blank_ratio · chars_over · block_missing
 */
export function lintDesc(text, channel) {
  const ch = channel || 'clip';
  const r = rulesOf(ch);
  const issues = [];
  const raw = String(text == null ? '' : text);
  if (!raw.trim()) return [{ code: 'empty', level: 'warn', text: '설명란이 비었습니다' }];
  const chars = Array.from(raw).length;
  if (chars > r.charsMax) issues.push({ code: 'chars_over', level: 'warn', text: chars + '자 — 한도 ' + r.charsMax + '자' });

  const groups = toGroups(raw);
  const lines = groups.reduce((a, g) => a.concat(g), []);
  const title = (groups[0] && groups[0][0]) || '';
  const titleLen = Array.from(title).length;

  if (groups.length < 3) {
    issues.push({ code: 'run_on', level: 'warn', text: '블록 ' + groups.length + '개 — 제목/요약/정보/행동/해시태그를 빈 줄로 나누세요' });
  }
  const allLines = raw.replace(/\r\n?/g, '\n').split('\n');
  const blankRatio = allLines.length ? allLines.filter((l) => !l.trim()).length / allLines.length : 0;
  if (allLines.length >= 6 && blankRatio > RHYTHM.blankRatioMax) {
    issues.push({ code: 'blank_ratio', level: 'warn', text: '빈 줄 비율 ' + Math.round(blankRatio * 100) + '% — 블록 사이에만 한 줄' });
  }
  if (titleLen > r.titleMax) {
    issues.push({ code: 'title_long', level: 'warn', text: '첫 줄 ' + titleLen + '자 — ' + r.titleMax + '자 이내(피드에서 잘림)' });
  }
  lines.forEach((l) => {
    const n = Array.from(l).length;
    if (n > RHYTHM.descLineMax) issues.push({ code: 'line_long', level: 'warn', text: n + '자 줄 — ' + RHYTHM.descLineMax + '자 이내로: ' + l.slice(0, 18) + '…' });
  });

  // 정보가 한 줄에 몰려 있는가 (예: "매일 15:00~24:00 대전 서구 용문로 41-80")
  const merged = lines.filter((l) => {
    const hits = [TIME_RE.test(l), ADDRESS_RE.test(l), PARKING_RE.test(l)].filter(Boolean).length;
    return hits >= 2;
  });
  if (merged.length) {
    issues.push({ code: 'info_merged', level: 'warn', text: '정보 ' + merged.length + '줄에 두 가지 이상 — 영업시간·주소·주차를 한 줄에 하나씩' });
  }
  // 정보 줄이 여러 블록으로 흩어졌는가
  const infoGroups = groups.filter((g) => g.every((l) => infoKindOf(stripEmoji(l))));
  if (infoGroups.length > 1) {
    issues.push({ code: 'info_split', level: 'warn', text: '정보 줄이 블록 ' + infoGroups.length + '개로 흩어짐 — 한 덩어리로 붙이세요' });
  }
  // 해시태그는 마지막 줄
  const last = lines[lines.length - 1] || '';
  const hasTags = lines.some((l) => HASHTAG_LINE_RE.test(l.replace(/\s+/g, ' ').trim()));
  if (hasTags && !HASHTAG_LINE_RE.test(last.replace(/\s+/g, ' ').trim())) {
    issues.push({ code: 'hashtag_not_last', level: 'warn', text: '해시태그가 마지막 줄이 아닙니다' });
  }
  if (!r.emoji) {
    const line = lines.find((l) => EMOJI_RE.test(l));
    if (line) issues.push({ code: 'emoji_in_clip', level: 'warn', text: '클립은 이모지 없이 담백하게: ' + line.slice(0, 20) });
  }
  return issues;
}

/** 화면·프롬프트에 그대로 쓰는 한 줄 요약. */
export function descSummary(text, channel) {
  const issues = lintDesc(text, channel);
  const groups = toGroups(text).length;
  return { blocks: groups, issues, ok: issues.length === 0 };
}
