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
  emojiRatio: 0.10      // 이모지 블록 허용 비율
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

/** 블록을 빈 줄 기준으로 나눈다(키트·본문 공통). */
export function toBlocks(text) {
  return String(text == null ? '' : text)
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((b) => b.replace(/^\n+|\n+$/g, '').trim())
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

/** 블록 안의 줄바꿈을 공백으로 — 블록 내 \n 0개 규칙. */
export function flattenBlocks(text) {
  return toBlocks(text).map((b) => b.replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ').trim());
}

/** 문단 첫머리의 AI 칼럼투를 떼고, 남은 hit 는 경고로 돌려준다. */
export function stripBanWords(text) {
  const removed = [];
  const hits = [];
  const blocks = toBlocks(text).map((b) => {
    let out = b;
    AI_COLUMN_BAN.forEach((w) => {
      if (out.startsWith(w)) {
        out = out.slice(w.length).replace(/^[\s,·:]/, '');
        removed.push(w);
      } else if (out.indexOf(w) >= 0) {
        hits.push(w);
      }
    });
    return out;
  }).filter((b) => b.length);
  return { text: blocks.join('\n\n'), removed, hits };
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
 * 본문을 2줄 호흡으로 정리한다.
 *  ① 블록 내 \n 제거 → ② AI 칼럼투 제거 → ③ 55자↑ 분할 → ④ 1줄 3연속 병합
 * 돌려주는 값: { text, blocks, stats, issues, removed, hits }
 */
export function applyBlogRhythm(text) {
  const stripped = stripBanWords(String(text == null ? '' : text));
  const flat = flattenBlocks(stripped.text);
  const split = [];
  flat.forEach((b) => { splitLongBlock(b).forEach((x) => split.push(x)); });
  const merged = mergeShortRuns(split);
  const out = merged.join('\n\n');
  return {
    text: out,
    blocks: merged,
    stats: rhythmStats(out),
    issues: lintRhythm(out),
    removed: stripped.removed,
    hits: stripped.hits
  };
}

/** 발행 전 점검 — 고칠 것이 없으면 빈 배열. */
export function lintRhythm(text) {
  const issues = [];
  const s = rhythmStats(text);
  const blocks = flattenBlocks(text);
  const innerNewlines = toBlocks(String(text || '')).filter((b) => b.indexOf('\n') >= 0).length;
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
    issues.push({ code: 'over_max', level: 'warn', text: '3줄 초과 문단 ' + s.overMax + '개 — 54자 넘음' });
  }
  if (innerNewlines > 0) {
    issues.push({ code: 'inner_newline', level: 'warn', text: '문단 안 줄바꿈 ' + innerNewlines + '곳 — 한 생각은 이어 쓰세요' });
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
    '문단(블록) 하나 = 모바일 2줄: 22~44자(상한 54자). 넘으면 문장부호 뒤에서 나눈다.',
    '문단 안 줄바꿈 금지. 문단 사이는 빈 줄 하나.',
    '1줄(20자 이하) 문단은 전체 20% 이내, 3연속 금지.',
    '숫자+단위(1억 1,300만 원·-3.5%)·고유명사(성심당·대전 트램)·괄호·따옴표 안은 자르지 않는다.',
    '금지 문구: ' + AI_COLUMN_BAN.slice(0, 8).join(' · ') + ' 등 AI 칼럼투.',
    '사진 캡션은 "▲ 한 줄", 이모지는 소제목·정보 카드에만.'
  ];
}
