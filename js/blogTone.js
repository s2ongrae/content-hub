/**
 * js/blogTone.js — 대전 청년 블로그 '톤 & 딱 2줄 호흡' 규칙 (2026-11-21)
 *
 * 근거: 성래 님 기존 발행글 8편 실측(문단 455~467개, 글별 평균 33~42자) + 제미니 고정방
 * 「콘텐츠 허브 프로젝트 관리」 확정안 A(2026-11-21). 문서: docs/BLOG_TONE_v5.md
 *
 * 확정 수치 (모바일 360px 기준 한 줄 ≈ 20자)
 *  · 문단(블록) 길이: 하한 22자 / 목표 32~44자 / 상한 54자
 *  · 1줄(≤20자) 블록은 전체의 20% 이내, 3연속 금지(시처럼 보이는 현상 방지)
 *  · 블록 안 줄바꿈(\n) 0개 — 한 생각은 끊지 않고 이어 쓴다. 블록 사이는 빈 줄.
 *  · 사진 캡션은 '▲ 한 줄', 이모지는 소제목·정보 카드에만(전체의 10% 이하)
 *
 * 원칙: 사용자 원문(USER 블록)은 이 모듈도 고치지 않는다.
 *  applyBlogRhythm 은 **호출한 쪽이 넘긴 글**만 다듬고, 무엇을 바꿨는지 issues 로 돌려준다.
 *  화면에서 사용자가 [2줄 호흡으로 정리]를 누를 때만 원문 블록에도 적용한다(선택).
 */

export const RHYTHM = {
  lineChars: 20,        // 모바일 360px 한 줄 글자수(기준)
  blockMin: 22,         // 블록 하한
  blockTargetLo: 32,    // 목표 하한
  blockTargetHi: 44,    // 목표 상한
  blockMax: 54,         // 상한 — 넘으면 자동 분할
  oneLineMax: 20,       // 1줄 블록 기준
  oneLineRatio: 0.20,   // 1줄 블록 허용 비율
  oneLineRunMax: 2,     // 같은 1줄 연속 허용 개수(3연속부터 경고)
  emojiRatio: 0.10,     // 이모지 블록 허용 비율
  // 2026-11-22 — 덩어리(빈 줄로 나뉘는 묶음) 규칙. 실측: 성래 님 발행글 108문단 / 27덩어리.
  groupMin: 2,          // 덩어리 최소 줄 수(고아 1줄 덩어리는 앞 덩어리에 붙인다)
  groupMergeTo: 3,      // 고아 1줄 덩어리를 붙일 때 목표 줄 수
  groupMax: 5,          // 덩어리 최대 줄 수
  infoGroupMax: 6,      // 정보 줄(📍⏰🚗)·캡션 덩어리 최대 줄 수
  blankRatioMax: 0.5,   // 빈 줄 비율 상한(전체 줄 대비) — 넘으면 '빈 줄 과다'
  descTitleMax: 32,     // 클립·쇼츠·릴스 첫 줄(제목) 상한 — 모바일 피드에서 잘리지 않는 길이
  descLineMax: 54       // 설명란 한 줄 상한
};

/** 톤 프리셋 3종 — 문장 규칙은 화면 힌트·프롬프트에 쓴다. */
export const PRESETS = [
  {
    id: 'jajo',
    label: '자조 찰진',
    polite: 75,
    rule: '정중체(~습니다/~다) 75% + 급발진 반말·구어 25%. 허용: 개작살·쪽박·물타기·존버, 의도적 오타 1글자.',
    humor: ['대전 로컬 비유(성심당 줄·트램·1호선)', '국밥·치킨 환산', '급발진 반말 펀치라인']
  },
  {
    id: 'review',
    label: '담백 리뷰',
    polite: 85,
    rule: '정중체 85% + 구어(~더라고요) 15%. 허용: 솔직 단점 1줄·실측 수치.',
    humor: ['가성비 자폭', '대기시간 비유', '반전 한줄평']
  },
  {
    id: 'info',
    label: '정보 정리',
    polite: 95,
    rule: '정중체 95% + 단정형(~함) 5%. 사실·수치만, 감상은 1줄.',
    humor: ['건조한 팩트 체크', '예상 질문 차단', '한줄 요약 비유']
  }
];

/** 무거운 AI 칼럼투 — 문단 첫머리에 오면 바로 잡는다(제미니 확정 22선). */
export const AI_COLUMN_BAN = [
  '결론부터 말씀드리자면', '살펴보도록 하겠습니다', '알아보도록 하겠습니다', '주목할 필요가 있습니다',
  '중요한 시점입니다', '함께 알아보시죠', '단순히', '이는 곧', '이처럼', '오늘날 많은 사람들이',
  '현대 사회에서', '투자의 세계에서는', '성공적인 투자를 위해서는', '무엇보다 중요한 것은',
  '종합해 볼 때', '요약하자면', '결국 핵심은', '에 대해 이야기해 보겠습니다', '놀랍게도',
  '흥미로운 점은', '한 가지 분명한 사실은', '마지막으로 강조하고 싶은 것은'
];

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;
const QUOTE_PAIRS = [['(', ')'], ['[', ']'], ['{', '}'], ['“', '”'], ['‘', '’'], ['《', '》'], ['「', '」']];

export function isEmojiBlock(text) {
  return EMOJI_RE.test(String(text || ''));
}

/** 정보 줄 머리 — 이 줄들로만 된 덩어리는 '정보 카드'라서 안에 빈 줄을 넣지 않는다.
 *  2026-11-24: 📊(수치)·🏦(자금)·📈(그래프)·💡(한 줄 정리)·💳 추가 — 실제 카드에서 쓰는 머리인데
 *  빠져 있어서 정보 카드가 낱줄로 쪼개지고 '한 줄 덩어리'로 잘못 세어졌다. */
export const INFO_HEAD_RE = /^(?:📍|⏰|🚗|💰|📊|📈|🏦|💡|💳|📞|☎|📌|✔|🕘|🕐|🕒|🅿|⏳|🍴|🚙|🎟)/u;
/** 사진 캡션 머리(▲/△). */
export const CAPTION_HEAD_RE = /^(?:▲|△)/u;
/** 해시태그만 있는 줄 — 마지막 덩어리 하나로 둔다. */
export const HASHTAG_LINE_RE = /^#[^\s#]+(?:\s+#[^\s#]+)*$/u;
/** 사진 자리표시( [사진 1] · ![캡션](경로) ) — 덩어리 병합을 막는다. */
export const PHOTO_MARK_RE = /^(?:\[(?:사진|📸)[^\]]*\]|!\[[^\]]*\]\([^)]*\))$/u;

/**
 * 빈 줄 기준 '덩어리'로 나눈다 — 덩어리 안의 줄 배열을 돌려준다.
 *   toBlocks(줄 단위)와 달리 **원문의 빈 줄 구분을 살린다**.
 *   예) "줄1\n줄2\n\n줄3" → [["줄1","줄2"], ["줄3"]]
 */
export function toGroups(text) {
  return String(text == null ? '' : text)
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((g) => g.split('\n').map((l) => l.trim()).filter((l) => l.length))
    .filter((g) => g.length);
}

/** 덩어리 성격 — info · caption · hashtag · heading · photo · prose */
export function groupKind(lines) {
  const list = Array.isArray(lines) ? lines : [lines];
  const first = String(list[0] || '').trim();
  if (PHOTO_MARK_RE.test(first)) return 'photo';
  if (CAPTION_HEAD_RE.test(first)) return 'caption';
  if (list.length === 1 && HASHTAG_LINE_RE.test(first)) return 'hashtag';
  if (list.every((l) => INFO_HEAD_RE.test(String(l).trim()))) return 'info';
  if (list.length === 1 && (/^\*\*[^*].*\*\*$/.test(first) || /^#{1,6}\s/.test(first))) return 'heading';
  return 'prose';
}

/** 덩어리 안에 있어도 되는 줄 수(성격별). */
function groupCap(kind) {
  return (kind === 'info' || kind === 'caption') ? RHYTHM.infoGroupMax : RHYTHM.groupMax;
}

/**
 * '줄(문단)' 단위로 나눈다 — 네이버 에디터의 문단과 1:1.
 *   2026-11-22: 빈 줄은 **덩어리 경계**만 뜻하게 되었다. 통계·분할은 줄 단위로 센다.
 *   (덩어리는 toGroups 로 따로 읽는다)
 */
export function toBlocks(text) {
  return String(text == null ? '' : text)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((b) => b.trim())
    .filter((b) => b.length);
}

/**
 * 이 지점에서 끊어도 되는가 — 숫자+단위, 괄호·따옴표 내부는 보호한다.
 * i 는 '앞부분의 끝' 인덱스(자르는 자리).
 */
export function isProtectedCut(text, i) {
  const prev = text[i - 1] || '';
  const next = text[i] || '';
  if (/[0-9]/.test(prev) && /[0-9,.만천억원%]/.test(next)) return true;
  if (/[0-9]/.test(prev) && /[만천억원%]/.test(next)) return true;
  if (/[만천억원%]/.test(prev)) return true;
  const before = text.slice(0, i);
  for (const pair of QUOTE_PAIRS) {
    const o = (before.split(pair[0]).length - 1);
    const c = (before.split(pair[1]).length - 1);
    if (o > c) return true;
  }
  const dq = (before.split('"').length - 1);
  if (dq % 2 === 1) return true;
  return false;
}

/** 자를 후보 자리 — ① 문장부호 ② 쉼표·연결어미 ③ 어절 공백 순. */
export function cutCandidates(text) {
  const s = String(text || '');
  const sentence = [];
  const punct = [];
  const space = [];
  for (let i = 1; i < s.length; i++) {
    const prev = s[i - 1];
    const next = s[i];
    if (/[.!?]/.test(prev) && (next === ' ' || i === s.length - 1)) sentence.push(i);
    else if ((prev === ',' || prev === '·' || prev === '—' || prev === ':') && next === ' ') punct.push(i + 1);
    else if (next === ' ') {
      if (/(는데|지만|해서|니까|면서|라고|고|며|서)$/.test(s.slice(Math.max(0, i - 3), i))) punct.push(i + 1);
      else space.push(i + 1);
    }
  }
  return { sentence, punct, space };
}

function pickCut(text, minPrefix, minSuffix) {
  const c = cutCandidates(text);
  const groups = [c.sentence, c.punct, c.space];
  for (const list of groups) {
    const fits = list.filter((i) => {
      if (isProtectedCut(text, i)) return false;
      const a = text.slice(0, i).trim().length;
      const b = text.slice(i).trim().length;
      return a >= minPrefix && b >= minSuffix;
    });
    if (!fits.length) continue;
    // 목표 중심(38자)에 가장 가까운 자리
    let best = fits[0];
    let bestD = Math.abs(text.slice(0, best).trim().length - 38);
    fits.forEach((i) => {
      const d = Math.abs(text.slice(0, i).trim().length - 38);
      if (d < bestD) { best = i; bestD = d; }
    });
    return best;
  }
  return -1;
}

/** 3줄(55자↑) 블록을 2줄 블록들로 나눈다. 못 나누면 그대로 둔다. */
export function splitLongBlock(block, max) {
  const limit = Number(max) > 0 ? Number(max) : RHYTHM.blockMax;
  const out = [];
  let rest = String(block == null ? '' : block).replace(/[ \t]+/g, ' ').trim();
  let guard = 0;
  while (rest.length > limit && guard++ < 20) {
    let at = pickCut(rest, RHYTHM.blockMin, RHYTHM.blockMin);
    if (at < 0) at = pickCut(rest, 15, 15);
    if (at < 0) break;
    const head = rest.slice(0, at).trim();
    const tail = rest.slice(at).trim();
    if (!head || !tail || head.length < 15 || tail.length < 15) break;
    out.push(head);
    rest = tail;
  }
  if (rest) out.push(rest);
  return out;
}

/** 줄 단위로 정리한다(줄 안의 중복 공백만 제거). 줄바꿈은 살린다 — 덩어리 구조가 곧 호흡이다. */
export function flattenBlocks(text) {
  return toBlocks(text).map((b) => b.replace(/\s{2,}/g, ' ').trim());
}

/** 줄 첫머리의 AI 칼럼투를 떼고, 남은 hit 는 경고로 돌려준다. 줄·빈 줄 구조는 그대로 둔다. */
export function stripBanWords(text) {
  const removed = [];
  const hits = [];
  const lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n').map((line) => {
    if (!line.trim()) return line;
    let out = line;
    AI_COLUMN_BAN.forEach((w) => {
      if (out.trim().startsWith(w)) {
        out = out.replace(w, '').replace(/^[\s,·:]/, '');
        removed.push(w);
      } else if (out.indexOf(w) >= 0) {
        hits.push(w);
      }
    });
    return out;
  });
  return { text: lines.join('\n'), removed, hits };
}

/** 1줄 블록이 3연속이면 앞 두 개를 붙인다(붙여도 44자 이내일 때만). */
export function mergeShortRuns(blocks) {
  const list = Array.isArray(blocks) ? blocks.slice() : [];
  const out = [];
  let run = [];
  const flush = () => {
    while (run.length >= 3) {
      const merged = run[0] + ' ' + run[1];
      if (merged.length <= RHYTHM.blockTargetHi) {
        run.splice(0, 2, merged);
      } else break;
    }
    out.push.apply(out, run);
    run = [];
  };
  list.forEach((b) => {
    if (String(b).trim().length <= RHYTHM.oneLineMax) run.push(String(b).trim());
    else { flush(); out.push(String(b)); }
  });
  flush();
  return out;
}

/** 본문 통계 — n·평균·1줄 비율·3줄 초과·최장 1줄 연속·이모지 비율. */
export function rhythmStats(text) {
  const blocks = flattenBlocks(text);
  const n = blocks.length;
  const lens = blocks.map((b) => b.length);
  const total = lens.reduce((s, x) => s + x, 0);
  const oneLine = lens.filter((x) => x <= RHYTHM.oneLineMax).length;
  let run = 0;
  let runMax = 0;
  lens.forEach((x) => {
    if (x <= RHYTHM.oneLineMax) { run++; runMax = Math.max(runMax, run); }
    else run = 0;
  });
  return {
    blocks: n,
    chars: total,
    avg: n ? Math.round((total / n) * 10) / 10 : 0,
    oneLine: oneLine,
    oneLineRatio: n ? Math.round((oneLine / n) * 100) / 100 : 0,
    overMax: lens.filter((x) => x > RHYTHM.blockMax).length,
    oneLineRunMax: runMax,
    emoji: blocks.filter(isEmojiBlock).length,
    longest: lens.length ? Math.max.apply(null, lens) : 0
  };
}

/**
 * 본문을 2줄 호흡 + 덩어리로 정리한다.
 *  ① 덩어리(빈 줄) 경계를 살린다 → ② 블록 내 \n 제거 → ③ AI 칼럼투 제거
 *  ④ 54자↑ 줄 분할 → ⑤ 덩어리 상한(일반 5줄·정보/캡션 6줄) → ⑥ 고아 1줄 덩어리를 앞 덩어리에 병합
 * 돌려주는 값: { text, groups, kinds, blocks, stats, issues, removed, hits }
 */
export function applyBlogRhythm(text) {
  const stripped = stripBanWords(String(text == null ? '' : text));
  const chunks = [];
  toGroups(stripped.text).forEach((g) => {
    const kind = groupKind(g);
    const lines = [];
    g.forEach((raw) => {
      const line = String(raw).replace(/[ \t]+/g, ' ').replace(/\n+/g, ' ').trim();
      if (!line) return;
      if (line.length > RHYTHM.blockMax) splitLongBlock(line, RHYTHM.blockMax).forEach((x) => lines.push(x));
      else lines.push(line);
    });
    const cap = groupCap(kind);
    for (let i = 0; i < lines.length; i += cap) chunks.push({ kind, lines: lines.slice(i, i + cap) });
  });

  // 고아 1줄 덩어리(본문·정보)는 앞 덩어리에 붙인다 — 빈 줄 과다 교정(성래 님 실측: 덩어리 2~5줄).
  const out = [];
  chunks.forEach((cur) => {
    const prev = out[out.length - 1];
    const joinable = prev && cur.kind === prev.kind && (cur.kind === 'prose' || cur.kind === 'info')
      && prev.lines.length < Math.min(groupCap(prev.kind), RHYTHM.groupMergeTo)
      && cur.lines.length <= RHYTHM.groupMin
      && prev.lines.length + cur.lines.length <= groupCap(prev.kind);
    if (joinable) {
      prev.lines = prev.lines.concat(cur.lines);
      return;
    }
    out.push({ kind: cur.kind, lines: cur.lines.slice() });
  });

  const groups = out.map((g) => g.lines);
  const textOut = groups.map((g) => g.join('\n')).join('\n\n');
  const lines = groups.reduce((acc, g) => acc.concat(g), []);
  return {
    text: textOut,
    groups,
    kinds: out.map((g) => g.kind),
    blocks: lines,
    stats: rhythmStats(textOut),
    issues: lintRhythm(textOut),
    removed: stripped.removed,
    hits: stripped.hits
  };
}

/** 발행 전 점검 — 고칠 것이 없으면 빈 배열. */
export function lintRhythm(text) {
  const issues = [];
  const raw = String(text || '');
  const s = rhythmStats(raw);
  const blocks = flattenBlocks(raw);
  const groups = toGroups(raw);
  const kinds = groups.map(groupKind);
  const lines = groups.reduce((acc, g) => acc.concat(g), []);
  const blankRun = (raw.match(/\n{3,}/g) || []).length;
  // 빈 줄 비율 = 빈 줄 수 ÷ 전체 줄(빈 줄 포함) — 50%를 넘으면 '한 줄 걸러 빈 줄' 상태
  const allLines = raw.replace(/\r\n?/g, '\n').split('\n');
  const blankLines = allLines.filter((l) => !l.trim()).length;
  const blankRatio = allLines.length ? blankLines / allLines.length : 0;
  if (!s.blocks) return [{ code: 'empty', level: 'warn', text: '본문이 비었습니다' }];
  if (s.oneLineRatio > RHYTHM.oneLineRatio) {
    issues.push({
      code: 'one_line_ratio', level: 'warn',
      text: '1줄 문단 ' + Math.round(s.oneLineRatio * 100) + '% — 20% 이하로(지금 ' + s.oneLine + '/' + s.blocks + ')'
    });
  }
  if (s.oneLineRunMax > RHYTHM.oneLineRunMax) {
    issues.push({ code: 'one_line_run', level: 'warn', text: '1줄 문단 ' + s.oneLineRunMax + '연속 — 시처럼 보입니다' });
  }
  if (s.overMax > 0) {
    issues.push({ code: 'over_max', level: 'warn', text: '54자 초과 문단 ' + s.overMax + '개 — 문장을 둘로 나누세요' });
  }
  if (blankRun > 0) {
    issues.push({ code: 'blank_run', level: 'warn', text: '빈 줄 ' + (blankRun + 1) + '줄 연속 ' + blankRun + '곳 — 빈 줄은 한 줄만' });
  }
  if (lines.length >= 8 && blankRatio > RHYTHM.blankRatioMax) {
    issues.push({
      code: 'blank_ratio', level: 'warn',
      text: '빈 줄 비율 ' + Math.round(blankRatio * 100) + '% — 한 줄씩 빈 줄이 들어갔습니다(줄을 붙여 덩어리로)'
    });
  }
  // 정보 줄·캡션 줄이 빈 줄로 끊겼는가 — 붙여야 하는 덩어리
  const splitInfo = kinds.filter((k, i) => i > 0 && k === 'info' && kinds[i - 1] === 'info').length;
  const splitCap = kinds.filter((k, i) => i > 0 && k === 'caption' && kinds[i - 1] === 'caption').length;
  if (splitInfo > 0) issues.push({ code: 'info_gap', level: 'warn', text: '정보 줄이 빈 줄로 ' + splitInfo + '번 끊겼습니다 — 📍⏰🚗는 한 덩어리로 붙이세요' });
  if (splitCap > 0) issues.push({ code: 'caption_gap', level: 'warn', text: '▲ 캡션이 빈 줄로 ' + splitCap + '번 끊겼습니다 — 한 덩어리로' });
  // 고아 1줄 덩어리(본문) 연속
  let orphanRun = 0;
  let orphanRunMax = 0;
  let orphanTotal = 0;
  groups.forEach((g, i) => {
    const k = kinds[i];
    if (g.length === 1 && k === 'prose') {
      orphanTotal++; orphanRun++; orphanRunMax = Math.max(orphanRunMax, orphanRun);
    } else orphanRun = 0;
  });
  if (lines.length >= 6 && orphanRunMax >= 2) {
    issues.push({ code: 'orphan_group', level: 'warn', text: '한 줄짜리 덩어리 ' + orphanTotal + '개 — 앞뒤 줄과 붙여 2~5줄 덩어리로' });
  }
  // 덩어리 상한 초과
  const bigGroups = groups.filter((g, i) => g.length > groupCap(kinds[i])).length;
  if (bigGroups > 0) {
    issues.push({ code: 'group_over', level: 'warn', text: '덩어리 상한(' + RHYTHM.groupMax + '줄) 초과 ' + bigGroups + '개 — 덩어리를 나누세요' });
  }
  const hits = [];
  blocks.forEach((b) => AI_COLUMN_BAN.forEach((w) => { if (b.indexOf(w) >= 0) hits.push(w); }));
  if (hits.length) {
    issues.push({ code: 'ai_column', level: 'warn', text: 'AI 칼럼투 ' + hits.length + '개 — ' + hits.slice(0, 3).join('·') });
  }
  if (s.blocks >= 10 && s.avg > RHYTHM.blockMax - 10) {
    issues.push({ code: 'avg_long', level: 'warn', text: '평균 ' + s.avg + '자 — 목표 32~44자' });
  }
  return issues;
}

/** 프롬프트·화면에 그대로 넣는 규칙 문장(한 곳에서만 고친다). */
export function rhythmPromptLines() {
  return [
    '한 줄 = 한 문장: 22~44자(상한 ' + RHYTHM.blockMax + '자). 넘으면 . ? ! 뒤에서 나누고 숫자+단위·괄호는 자르지 않는다.',
    '2~4줄(최대 ' + RHYTHM.groupMax + '줄)을 빈 줄 없이 붙여 한 덩어리로 쓴다. 빈 줄은 **덩어리 사이에만 한 줄**.',
    '📍⏰🚗💰 정보 줄과 ▲ 사진 캡션은 각각 한 덩어리로 붙인다(안에 빈 줄 금지, 최대 ' + RHYTHM.infoGroupMax + '줄).',
    '한 줄짜리 덩어리를 연달아 두지 않는다(해시태그·소제목·인용구는 예외).',
    '1줄(' + RHYTHM.oneLineMax + '자 이하) 줄은 전체 20% 이내, 3연속 금지.',
    '숫자+단위(1억 1,300만 원·-3.5%)·고유명사(성심당·대전 트램)·괄호·따옴표 안은 자르지 않는다.',
    '해시태그는 마지막 줄에 한 덩어리로.',
    '금지 문구: ' + AI_COLUMN_BAN.slice(0, 8).join(' · ') + ' 등 AI 칼럼투.'
  ];
}

/**
 * 설명란(클립·쇼츠·릴스) 프롬프트 문장 — 5블록 구조.
 * 확정: 성래 님 클립 설명 수정본(2026-11-22) + 제미니 협의(2026-11-22).
 */
export function descPromptLines() {
  return [
    '설명란은 5블록: ① 제목(' + RHYTHM.descTitleMax + '자 이내) ② 요약 1문장 ③ 정보(한 줄에 한 항목) ④ 행동 유도 2줄 ⑤ 해시태그 1줄.',
    '블록 사이에만 빈 줄 1개, 블록 안은 줄바꿈 1개. 줄글 덩어리(: 한 문단에 세 문장 이상)로 쓰지 않는다.',
    '정보 줄은 영업시간·주소·주차를 각각 한 줄로. 주소는 도로명+건물번호까지만(호수는 뺀다).',
    '네이버 클립은 이모지 없이 담백하게, 유튜브 쇼츠·인스타 릴스는 정보 줄에 📍(주소)·⏰(영업)·🚗(주차)만 붙인다.',
    '한 줄은 ' + RHYTHM.descLineMax + '자 이하. 마무리는 저장·방문 유도 두 줄.'
  ];
}
