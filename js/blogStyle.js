/**
 * js/blogStyle.js — 성래 님 블로그 '글쓰기 DNA' (2026-11-25, #50347)
 *
 * 왜 만들었나
 *  기존 허브의 '바로 만들기'는 내 메모를 \n\n 로 쪼개 그대로 늘어놓고 `[사진] 이름 — 사실 묘사`
 *  만 끼워 넣었다. 그래서 결과물이 '내 메모 + AI 풀칠'이었고, 성래 님이
 *  "거의 내가 새로 다 다시 써야할 판"이라고 했다(#50347).
 *  원인은 문장이 아니라 **문법**이 없었던 것이다 — 인용구 섹션(`>`), ▲ 캡션, 📌 정보 카드,
 *  ⭐ 총평, 펀치라인 마무리, 👉 교차링크는 발행글마다 반복되는 고정 장치인데
 *  허브 어디에도 데이터로 박혀 있지 않았다.
 *
 * 근거
 *  · 발행글 4편 원문 실측(미미삼겹 224480755004 · 석암 224459297302 · G80 224457982971 ·
 *    10월정산 224462465538) — 본문 줄 평균 36.1/37.2/39.8/45.9자, 인용구 블록 4~10개,
 *    정보카드 8~20줄, 괄호 애드리브 1~17개, 해시태그 2줄, 54자 초과 줄 3~15개.
 *  · 제미니 고정방(3cc80699c40a29c1) 확정안(2026-11-25): 글 종류별 블록 순서 8/6/5,
 *    54자 예외 4종, AI티 vs 거친 표현 판정선, 슬롯 규칙, Phase 1 제외 2개·함정 3개.
 *
 * 원칙
 *  · 0토큰: 이 모듈은 재료(장소·컨셉·메모·사진·확인된 사실)만으로 **뼈대를 조립**한다.
 *    없는 값을 지어내지 않는다 — 비는 자리는 `⟦…⟧` 로 남겨 눈에 보이게 둔다.
 *  · 원문 보존: 성래 님이 쓴 문단은 한 글자도 고치지 않는다. 옮기는 것은 '자리'(인용구·덩어리)뿐이다.
 *  · AI 는 빈 슬롯만 채운다(promptLines). 문장을 새로 쓰게 하지 않는다.
 *
 * 쓰는 법
 *   import { buildStyleSkeleton, renderStyleSkeleton, lintVoice, stylePromptLines } from './blogStyle.js';
 *   const bp = buildStyleSkeleton({ materials, links, title, kind: 'place' });
 *   const text = renderStyleSkeleton(bp);      // 네이버에 붙여넣을 본문
 *   const lint = lintVoice(text, { kind: 'place', photoCount: 7 });
 *
 * 2026-11-25 덧붙임 (사용자 2·3번 승인)
 *  · 제목 3안 — 옛 틀 `[동네] 종류 — 솔직 후기`를 버리고, 검색 키워드는 앞에 두되 뒷부분을
 *    성래 님 인용형·자조 펀치라인으로 뽑는다(titleOptions). 실제 발행 제목이 그 모양이다:
 *    `[대전 봉명동 고기집] 석암생소금구이 야장 솔직후기 : "계좌도 파랗고 소주도 파랗다"`(#7220).
 *  · 사진 한 줄 메모 — 사진마다 `memo`(예: 사장님이 직접 구워주심)를 적으면 추정 대신 그 사실로
 *    `▲ 캡션`을 쓰고 `(괄호 애드리브)` 자리를 연다. 메모가 없으면 예전과 똑같이 역할 기반 캡션이다.
 */

export const SLOT_OPEN = '⟦';
export const SLOT_CLOSE = '⟧';

/** 스타일 DNA — 시드(seeds/blog_style_dna_2026w48.json)와 같은 값이어야 한다(시험이 대조). */
export const STYLE_DNA = {
  version: '2026w48',
  source: '성래 님 발행글 4편 실측(2026-10-29~11-17) + 제미니 고정방 확정안(2026-11-25)',
  measure: {
    line_avg: [36.1, 37.2, 39.8, 45.9],
    line_median: [35, 48],
    quote_blocks: [4, 10],
    over54_lines: [3, 15],
    short_lines: [2, 14],
    asides: [1, 17],
    hashtag_lines: 2,
    info_card_lines: [8, 20]
  },

  /* 글 종류별 블록 순서 — 제미니 확정안 그대로 */
  kinds: {
    place: {
      label: '맛집·장소',
      blocks: [
        { id: 'opener', label: '도입 — 자기소개 + 자조 타이틀', required: true, role: 'MIX' },
        { id: 'forecast', label: '오늘 글 예고', required: true, role: 'MIX' },
        { id: 'sections', label: '인용구 섹션 + 1:1 사진(▲ 캡션 + 괄호 애드리브)', required: true, role: 'MIX' },
        { id: 'info_card', label: '📌 업체정보 + 6항목(📍🕘🚫🍴🅿☎)', required: true, role: 'FACT' },
        { id: 'rating', label: '⭐ 맛·가성비·서비스 3줄', required: true, role: 'AI' },
        { id: 'punch', label: '펀치라인 종결', required: true, role: 'AI' },
        { id: 'hashtags', label: '해시태그 2줄', required: true, role: 'AUTO' },
        { id: 'crosslink', label: '👉 같은 동네 편 교차링크', required: false, role: 'AUTO' }
      ]
    },
    info: {
      label: '정보·리뷰',
      blocks: [
        { id: 'opener', label: '도입 — 자기소개 + 자조 타이틀', required: true, role: 'MIX' },
        { id: 'forecast', label: '핵심 요약·예고', required: true, role: 'MIX' },
        { id: 'sections', label: '인용구 + 1:1 사진 본문', required: true, role: 'MIX' },
        { id: 'numbers', label: '숫자·스펙 요약', required: false, role: 'FACT' },
        { id: 'punch', label: '펀치라인 종결', required: true, role: 'AI' },
        { id: 'hashtags', label: '해시태그 + 교차링크', required: true, role: 'AUTO' }
      ]
    },
    story: {
      label: '자기서사·정산',
      blocks: [
        { id: 'opener', label: '도입 — 자기소개 + 자조 타이틀', required: true, role: 'MIX' },
        { id: 'forecast', label: '상황 예고', required: true, role: 'MIX' },
        { id: 'sections', label: '인용구 + 1:1 사진 서사', required: true, role: 'MIX' },
        { id: 'punch', label: '펀치라인(또는 자판 난타)', required: true, role: 'AI' },
        { id: 'hashtags', label: '해시태그 + 교차링크', required: true, role: 'AUTO' }
      ]
    }
  },

  /** 인용구 섹션 — 성래 님 글의 최대 특징. 머리 + 빈 `>` + 판정 한 줄. */
  quote: {
    head_chars: 32,
    punch_chars: 40,
    heads: {
      section: '📍',
      menu: '📋',
      food: '🍴',
      side: '🥗',
      review: '⭐',
      tip: '🍯',
      money: '📊',
      place_info: '📌'
    }
  },

  /** 사진 — ▲ 캡션 한 줄(+선택 괄호 애드리브). 역할 순서는 studioLogic.autoOrderPhotos 와 같다.
   *  memo_max: 사진 한 줄 메모 길이(넘으면 자른다) · asides_max: 글 전체 애드리브 자리 수. */
  caption: {
    head: '▲',
    max_chars: 42,
    aside_chars: 40,
    memo_max: 60,
    asides_max: 3,
    roles: ['외관', '메뉴판', '음식', '분위기', '마무리']
  },

  /** 제목 3안 — 검색 키워드 전진 + 인용형 자조 (2026-11-25, #50841 사용자 승인).
   *  quotes[].needs 가 있는 줄은 그 값(가격·대기)이 확인된 글에서만 쓴다 — 없는 값을 지어내지 않는다.
   *  ban: 제목에 쓰면 옛 틀·AI 티로 보는 말 · ban_tail: 제목 끝에 오면 옛 틀. */
  title: {
    version: '2026w48',
    max_chars: 55,
    ban: ['총정리', '완벽 정리', '완벽정리', '알아보았다', '추천합니다', '후기 정리', '꿀팁', '필독', '모든 것', '한 번에 정리'],
    ban_tail: ['솔직 후기', '솔직후기', '후기 정리'],
    quotes: [
      { text: '가오는 잡았고, 통장은 잡혔습니다' },
      { text: '통장은 얇고 마음은 두껍다' },
      { text: '월급은 스치고 지출만 남는다' },
      { text: '오늘도 나는 계획대로 안 됐다' },
      { text: '{price}의 행복, 카드값은 다음 달의 나에게', needs: 'price' },
      { text: '{wait} 기다린 값은 했습니다', needs: 'wait' },
      { text: '고기는 죄가 없다, 내 지갑이 얇을 뿐', kind: 'place' },
      { text: '맛은 있는데 내 통장이 얇다', kind: 'place' },
      { text: '배는 부르고 통장은 홀쭉하다', kind: 'place' },
      { text: '한 끼에 진심인 청년의 최후', kind: 'place' },
      { text: '{price}, 이 정도면 밥값은 했다', kind: 'place', needs: 'price' },
      { text: '줄은 길었고 고기는 짧았다', kind: 'place', needs: 'wait' }
    ]
  },

  /** 정보 카드 6항목 — 사실이 없으면 그 줄은 만들지 않는다(지어내지 않음). */
  info_card: {
    title: '📌 업체정보',
    fields: [
      { key: 'address', head: '📍', label: '위치' },
      { key: 'hours', head: '🕘', label: '영업' },
      { key: 'closed_days', head: '🚫', label: '휴무' },
      { key: 'price_menu', head: '🍴', label: '가격' },
      { key: 'parking', head: '🅿', label: '주차' },
      { key: 'wait_time', head: '⏳', label: '대기' },
      { key: 'tel', head: '☎', label: '전화' }
    ],
    required: ['📍', '🕘', '🍴', '🅿', '☎']
  },

  /** ⭐ 총평 — 맛집 글에서만. 별점은 성래 님이 정한다(0토큰은 자리만). */
  rating: {
    head: '⭐ 대전청년의 솔직 총평',
    tome: '내 돈 내고 먹고 남기는 얘기입니다',
    rows: ['맛', '가성비', '서비스']
  },

  /** 도입 — 인사 + 자기소개. self 는 성래 님이 쓰는 자조 타이틀(비면 슬롯). */
  opener: {
    greeting: '안녕하세요, 대전 청년입니다.',
    greeting_emoji: '🙋✨',
    templates: [
      '안녕하세요, {self}입니다.',
      '안녕하세요, 오늘은 {self}입니다.'
    ]
  },

  /** 마무리 — 교훈·당부가 아니라 펀치라인. 이 어미가 나오면 AI 티로 본다. */
  punch: {
    ban_endings: [
      '뜻이니까요', '중요합니다', '도움이 되셨', '기대해', '기대하겠습니다', '마치겠습니다',
      '알아보았습니다', '함께 이겨내', '응원합니다', '저장해 두세요', '방문해 보세요',
      '즐거운 하루', '다음 편에서', '정리해 보았습니다', '추천드립니다', '하시길 바랍니다',
      '챙겨 보세요', '기억해 두세요', '니까요', '보세요', '바랍니다', '되세요', '좋겠습니다'
    ],
    examples: [
      '나쁜건 오빠가 다 마셔서 사라지게 해줄게.',
      '가오는 잡았고, 통장은 잡혔습니다.',
      '차라도 똑바로 굴러가니 다행이네요.',
      '제발 코스닥도 음흉하고 발작적이고 폭발적인 뜨거운 급등 부탁드립니다. 제가 잘못했어요.'
    ]
  },

  /** 성래 님 거친 표현 — 린터가 'AI 티'로 오인하면 안 되는 목록(지우지 않는다). */
  rough_voice: {
    allow: [
      '개박살', '개작살', '박살', '쳐발', '개소리', '미개한', '흡연충', '찌질이', '후두려',
      '짖어대', '헥토파스칼킥', '똥물', '물타', '지옥구렁', '금쪽이', '개도박', '아작',
      '깡패', '1황', '원탑', '맛잘알', '남바원', '쎄단', '가오', '카푸어', '빚쟁이',
      '거지', '맷값', '낭낭', '생생탱귤', '데헷', 'ㅋㅋ', 'ㅠ', '..'
    ],
    local: ['성심당', '트램', '1호선', '유성온천', '대전역', '한밭', '갑천', '도안동', '봉명동', '유성', '대전']
  },

  /** 54자 초과를 감점하지 않는 줄 — 제미니 확정(2026-11-25) */
  long_line: {
    exempt: ['quote', 'info', 'hashtag', 'url', 'list'],
    max_prose_over: 15,
    consecutive_max: 2
  },

  /** 해시태그 — 2줄, 첫 줄 8개까지. 사실에 있는 말만. */
  hashtag: { lines: 2, per_line: 7, max: 13 },

  /** 채널 설명·교차링크 */
  crosslink: '👉 같은 {dong} {topic} 편: {title}',
  video_link: '▶ 영상으로 보기',

  /* ── 품질 7지침 (2026-11-25, #50614 스레드 @k.sh0000_) ──
   * 성래 님 목소리와 부딪히는 지점은 목소리를 이긴다(해요체 강제 없음·자조 유지).
   * 여기 값은 '기계로 셀 수 있는 것'만 둔다 — ⑤자료 구분은 텍스트로 못 재우므로 프롬프트 규칙만. */
  quality: {
    version: '2026w48',
    length_chars: [1800, 3000],     // 공백 제외. 제미니 확정(2026-11-25): 권장 1,800~3,000 · 허용 1,500~3,500
    length_warn: [1500, 3500],
    experience_min: 3,              // 1인칭·경험 표지
    ending_repeat_max: 0.35,        // 같은 종결 어미 비율 상한(문장 6개 이상일 때)
    ending_min_sentences: 6,
    menu_facets_min: 2,             // 서로 다른 묘사 축(제미니 확정: 5요소 중 2개↑ · 의성·의태어 허용)
    abstract_ban: [
      '분위기가 느껴졌', '분위기를 느낄 수 있', '맛의 방향이 분명했', '맛의 방향이 분명합',
      '정갈한 맛', '깊은 풍미', '조화로움이 느껴졌', '음식의 조화가 돋보였', '정성이 느껴졌',
      '입안 가득 퍼지는', '감탄이 나왔', '기대 이상이었', '실망시키지 않았', '여운이 남는',
      '한 끼의 행복', '특유의 감칠맛이 일품', '풍미가 살아있', '비주얼이 훌륭', '감성 가득'
    ],
    ad_words: ['최고의 맛', '인생 맛집', '무조건 추천', '강력 추천', '후회 없', '완벽한 맛',
      '기대 이상', '실망시키지 않', '꼭 가보셔야', '두 번 가세요'],
    menu_facets: {
      '국물': ['국물', '육수', '진하', '걸죽', '걸쭉', '시원하'],
      '식감': ['식감', '쫀득', '바삭', '쫄깃', '부드', '사각', '두툼', '얇', '탱글'],
      '맵기': ['매콤', '매운', '얼큰', '칼칼', '맵기', '살얼큰'],
      '온도': ['뜨끈', '뜨거', '따뜻', '차갑', '식은', '얼음'],
      '조화': ['어울', '조화', '곁들', '싸먹', '올려', '비벼', '찍어']
    },
    shortcoming_words: ['아쉬', '비싸', '좁', '불편', '시끄', '웨이팅', '대기', '양이 적', '간이 세', '주차가 어려', '주차 어려'],
    info_dup_keys: [
      { key: 'parking', words: ['주차'] },
      { key: 'wait', words: ['웨이팅'] },
      { key: 'hours', words: ['영업시간', '라스트오더'] }
    ]
  }
};

const SLOT_RE = new RegExp(SLOT_OPEN + '([^' + SLOT_CLOSE + ']+)' + SLOT_CLOSE, 'g');

export function slot(text) {
  return SLOT_OPEN + String(text || '').trim() + SLOT_CLOSE;
}

/** 남아 있는 ⟦슬롯⟧ 목록 — 사람이 채울 자리. */
export function slotsOf(text) {
  const out = [];
  String(text == null ? '' : text).replace(SLOT_RE, (_, t) => { out.push(String(t).trim()); return ''; });
  return out;
}

/** 글 종류 — materials.concept.kind(review|story|info) + 장소 유무로 place/info/story 를 고른다. */
export function kindOf(conceptKind, hasPlace) {
  const k = String(conceptKind || '').trim();
  if (k === 'story') return 'story';
  if (k === 'review') return hasPlace ? 'place' : 'info';
  return hasPlace ? 'place' : 'info';
}

const cp = (s) => [...String(s == null ? '' : s)].length;

/** 코드포인트로 자르기 — UTF-16 `slice` 는 이모지(서로게이트 페어)를 반으로 갈라 글자를 깬다. */
export function clipChars(text, max) {
  const chars = [...String(text == null ? '' : text)];
  const n = Math.max(0, Number(max) || 0);
  return chars.length <= n ? chars.join('') : chars.slice(0, n).join('');
}

/** 한 줄로 줄이기 — 캡션처럼 자리가 좁은 곳. 낱말 중간에서 자르지 않는다(허브·스튜디오가 같이 쓴다). */
export function clipLine(text, max) {
  const chars = [...String(text == null ? '' : text).replace(/\s+/g, ' ').trim()];
  if (chars.length <= max) return chars.join('');
  const head = chars.slice(0, max).join('');
  const cut = head.replace(/\s+\S*$/, '').replace(/[.,·]$/, '');
  return cut || head;
}

/** 빈 줄 기준 덩어리(네이버 문단). studioLogic.splitUserBlocks 와 같은 규칙이지만 여기선 자체 보유. */
function splitBlocks(text) {
  return String(text == null ? '' : text).replace(/\r\n?/g, '\n')
    .split(/\n{2,}/).map((x) => x.replace(/^\n+|\n+$/g, '')).filter((x) => x.trim());
}

const SECTION_HEAD_RE = /^(?:>\s*)?(?:📍|📌|▶|🎥|🍯|📊|⭐)/u;

function groupLines(lines, size) {
  const out = [];
  const n = Math.max(1, size || 3);
  for (let i = 0; i < lines.length; i += n) out.push(lines.slice(i, i + n));
  return out;
}

/**
 * 사진 → 섹션 배치. 사진 순서(autoOrderPhotos)는 그대로 두고, 역할로 자리를 고른다.
 *   반환 [{ photo, role, caption, section }]  section = 섹션 인덱스(-1 = 도입 위 표지)
 */
function planStylePhotos(photos, sectionCount, captionOf) {
  const ps = Array.isArray(photos) ? photos : [];
  const out = [];
  const n = ps.length || 1;
  /* 표지·분위기·마무리만 역할로 고정하고, 나머지(음식·메뉴판 등)는 사진 순서대로 섹션에 고르게 편다. */
  const fixed = ps.map((p, i) => {
    const role = p.role || '';
    if (!sectionCount) return -1;
    if (role === '외관' || role === '간판') return i === 0 ? -1 : 0;
    if (role === '분위기') return 0;
    if (role === '마무리') return sectionCount - 1;
    return null;
  });
  const loose = fixed.filter((x) => x === null).length || 1;
  let seen = 0;
  ps.forEach((p, i) => {
    const role = p.role || '';
    let section = fixed[i];
    if (section === null) {
      section = Math.min(sectionCount - 1, Math.floor((seen * sectionCount) / loose));
      seen++;
    }
    out.push({
      photo: p.name, role: role, section: section,
      caption: captionOf ? captionOf(p) : (p.caption || ''),
      /* 60자 상한은 코드포인트 기준 — 이모지 경계에서 글자가 깨지지 않게(cue2 QA). */
      memo: clipChars(String(p.memo || '').trim(), STYLE_DNA.caption.memo_max)
    });
  });
  return out;
}

/**
 * 뼈대 조립 — 0토큰. 성래 님이 쓴 문단은 옮기기만 하고 고치지 않는다.
 *  @param {{materials:object, links?:array, title?:string, kind?:string, self?:string, topic?:string}} input
 *  @returns {{kind, blocks:object[], photos:object[], slots:string[], facts:object}}
 */
export function buildStyleSkeleton(input) {
  const i = input || {};
  const m = i.materials || {};
  const place = (m.place && m.place.name) ? String(m.place.name).trim() : '';
  const content = m.content || {};
  const concept = m.concept || {};
  const facts = {
    place_name: place,
    region_dong: String(content.region_dong || '').trim(),
    category: String(content.category || '').trim(),
    hours: String(content.hours || '').trim(),
    closed_days: String(content.closed_days || '').trim(),
    price_menu: String(content.price_menu || '').trim(),
    parking: String(content.parking || '').trim(),
    wait_time: String(content.wait_time || '').trim(),
    tel: String(content.tel || '').trim(),
    address: String(content.address || '').trim()
  };
  const kind = i.kind || kindOf(concept.kind, !!place);
  const spec = STYLE_DNA.kinds[kind] || STYLE_DNA.kinds.info;
  const all = splitBlocks(content.memo || '');
  const photos = Array.isArray(i.photos) ? i.photos : (Array.isArray(m.photos) ? m.photos : []);
  const links = (Array.isArray(i.links) ? i.links : []).filter((l) => l && l.url);

  const blocks = [];
  const push = (b) => blocks.push(Object.assign({ lines: [] }, b));

  /* ① 도입 — 메모가 인사말로 시작하면 그 줄을 그대로 쓰고, 아니면 인사 + 슬롯. */
  let cursor = 0;
  const first = all[0] ? String(all[0]).split('\n')[0].trim() : '';
  let openerLines = [];
  if (/^안녕하세요/.test(first) || /^반가워요/.test(first) || /^안녕/.test(first)) {
    const head = String(all[0]).split('\n').map((x) => x.trim()).filter(Boolean);
    openerLines = head.slice(0, 2);
    cursor = 1;
  } else {
    const self = String(i.self || '').trim();
    openerLines = [STYLE_DNA.opener.greeting + (STYLE_DNA.opener.greeting_emoji ? ' ' + STYLE_DNA.opener.greeting_emoji : '')];
    openerLines.push(self ? STYLE_DNA.opener.templates[0].replace('{self}', self) : slot('자기소개+자조 한 줄 (예: Lv.2 빚 있는 청년 카푸어)'));
  }
  push({ id: 'opener', role: 'MIX', lines: openerLines });

  /* ② 예고 — 다음 덩어리(섹션 머리가 아닌 것)를 그대로. 없으면 슬롯. */
  const forecast = [];
  while (cursor < all.length && !SECTION_HEAD_RE.test(String(all[cursor]).trim()) && forecast.length < 2) {
    forecast.push(...String(all[cursor]).split('\n').map((x) => x.trim()).filter(Boolean));
    cursor++;
  }
  push({ id: 'forecast', role: 'MIX', lines: forecast.length ? forecast : [slot('오늘 글 예고 한 줄')] });

  /* ③ 섹션 — 메모의 📍/📌 머리를 인용구로 살린다. 머리가 없으면 사진 역할로 만든다. */
  const rest = all.slice(cursor);
  const explicit = rest.filter((t) => SECTION_HEAD_RE.test(String(t).trim()));
  const sections = [];
  if (explicit.length) {
    let cur = null;
    rest.forEach((t) => {
      const s = String(t).trim();
      if (SECTION_HEAD_RE.test(s)) {
        const nl = s.indexOf('\n');
        const head = (nl >= 0 ? s.slice(0, nl) : s).replace(/^>\s*/, '').trim();
        const inline = nl >= 0 ? s.slice(nl + 1).split('\n').map((x) => x.trim()).filter(Boolean) : [];
        cur = { head: head, lines: inline.slice(), punch: '' };
        sections.push(cur);
      } else if (cur) {
        cur.lines.push(...s.split('\n').map((x) => x.trim()).filter(Boolean));
      } else {
        cur = { head: place ? '📍 ' + place : '📍 ' + (facts.region_dong || '현장'), lines: s.split('\n').map((x) => x.trim()).filter(Boolean), punch: '' };
        sections.push(cur);
      }
    });
  } else {
    /* 머리가 없으면 사진 역할로 섹션을 만든다 — 사실을 새로 만들지 않고 '자리'만 나눈다. */
    const heads = [];
    if (place) heads.push('📍 ' + place);
    const hasMenu = photos.some((p) => (p.role || '') === '메뉴판');
    if (hasMenu && facts.price_menu) heads.push('📋 메뉴');
    heads.push('🍴 먹은 것');
    const body = rest.reduce((acc, t) => acc.concat(String(t).split('\n').map((x) => x.trim()).filter(Boolean)), []);
    const per = Math.max(1, Math.ceil(body.length / heads.length));
    heads.forEach((h, n) => sections.push({ head: h, lines: body.slice(n * per, (n + 1) * per), punch: '' }));
  }

  /* 섹션 판정 한 줄 — 그 섹션 첫 줄이 짧으면(≤40자) 인용구로 올린다. 길면 슬롯. */
  /* (사진은 섹션 순서대로 훑되, 붙이는 순서는 사진 번호 순서 그대로 — 3,5,2,4 처럼 뒤섞이지 않게) */
  sections.forEach((s) => {
    const firstLine = s.lines[0] || '';
    if (firstLine && cp(firstLine) <= STYLE_DNA.quote.punch_chars) {
      s.punch = firstLine;
      s.lines = s.lines.slice(1);
    } else {
      s.punch = slot('판정 한 줄 (훅·놀림·단정)');
    }
    const h = cp(s.head);
    if (h > STYLE_DNA.quote.head_chars) s.head = [...s.head].slice(0, STYLE_DNA.quote.head_chars).join('');
  });

  /* 섹션 판정 한 줄을 먼저 정하고 본문에서 뺀다 — 마지막 줄을 펀치로 쓸 때 두 번 나오지 않게. */
  let tailPunch = '';
  if (sections.length) {
    const lastSec = sections[sections.length - 1];
    const cand = lastSec.lines[lastSec.lines.length - 1] || '';
    if (cand && cp(cand) <= 60 && !STYLE_DNA.punch.ban_endings.some((b) => cand.indexOf(b) >= 0)) {
      tailPunch = cand;
      lastSec.lines = lastSec.lines.slice(0, -1);
    }
  }

  let foodN = 0;
  const plan = planStylePhotos(photos, sections.length, (p) => {
    /* 캡션 우선순위(2026-11-26, cue2 QA — 문서 BLOG_TITLE_PHOTO_MEMO_v1 과 통일):
       내가 적은 사실(memo) → 직접 쓴 캡션(caption) → 역할 추정. 메모가 이긴다. */
    const note = String(p.memo || '').trim();
    if (note) return clipLine(note, STYLE_DNA.caption.max_chars);
    if (String(p.caption || '').trim()) return String(p.caption).trim();
    const role = p.role || '';
    if (role === '외관') return place ? place + ' 입구' : '가게 입구';
    if (role === '메뉴판') return '메뉴판 실물';
    if (role === '음식') {
      /* 음식 사진이 여러 장이면 같은 캡션을 복붙하지 않는다(7지침 6) — 순서대로 돌려 쓴다. */
      const rot = ['불판 위 고기', '한입 크기로 자른 고기', '접시에 올린 한 점', '반찬 한 상', '익어가는 중', '마무리 한 입'];
      return rot[Math.min(foodN++, rot.length - 1)];
    }
    if (role === '분위기') return place ? place + ' 안쪽' : '매장 안쪽';
    if (role === '마무리') return '계산하고 나오는 길';
    return '현장 사진';
  });

  let lastSec2 = -1;
  plan.forEach((p) => { p.section = Math.max(p.section, lastSec2); lastSec2 = p.section; });

  /* 표지 — 도입·예고 바로 뒤, 섹션 앞(외관·간판). */
  const cover = plan.filter((p) => p.section < 0);
  let asidesLeft = STYLE_DNA.caption.asides_max;
  /* 메모가 붙은 사진은 그 사실로 애드리브 한 줄을 받는다. 메모가 없으면 예전 그대로( 첫 섹션 첫 사진 뒤). */
  const asideLine = (p, num, isLegacySpot) => {
    if (asidesLeft <= 0) return '';
    if (p && p.memo) { asidesLeft--; return slot('사진 애드리브 (사진 ' + num + ')'); }
    if (isLegacySpot) { asidesLeft--; return slot('사진 애드리브 한 줄 (선택)'); }
    return '';
  };
  if (cover.length) {
    const lines = [];
    cover.forEach((p, k) => {
      if (k) lines.push('');
      lines.push('[사진 ' + (plan.indexOf(p) + 1) + '] ' + p.photo);
      lines.push(STYLE_DNA.caption.head + ' ' + p.caption);
      const aside = asideLine(p, plan.indexOf(p) + 1, false);
      if (aside) lines.push(aside);
    });
    push({ id: 'cover', role: 'MIX', lines: lines });
  }

  const secBlock = sections.map((s, n) => {
    const mine = plan.filter((p) => p.section === n);
    /* 덩어리 2~3줄 — 2줄 호흡 표준. */
    const groups = groupLines(s.lines, 3);
    const lines = [];
    lines.push('> ' + s.head);
    lines.push('>');
    lines.push('> ' + s.punch);
    groups.forEach((g) => { lines.push(''); lines.push(g.join('\n')); });
    mine.forEach((p, k) => {
      const num = plan.indexOf(p) + 1;
      lines.push('');
      lines.push('[사진 ' + num + '] ' + p.photo);
      lines.push(STYLE_DNA.caption.head + ' ' + p.caption);
      const aside = asideLine(p, num, n === 0 && k === 0);
      if (aside) lines.push(aside);
    });
    return { id: 'section_' + (n + 1), role: 'MIX', quote: { head: s.head, punch: s.punch }, lines: lines };
  });
  secBlock.forEach((b) => push(b));

  /* ④ 정보 카드 — 사실이 있는 줄만. */
  if (kind === 'place' || Object.keys(facts).some((k) => facts[k])) {
    const card = [(place ? '📌 ' + place : STYLE_DNA.info_card.title) + (i.fact_note ? ' · ' + i.fact_note : '')];
    STYLE_DNA.info_card.fields.forEach((f) => {
      const v = facts[f.key];
      if (v) card.push(f.head + ' ' + f.label + ' : ' + v);
    });
    const missing = STYLE_DNA.info_card.required.filter((h) => !card.some((l) => l.indexOf(h) === 0));
    if (missing.length) card.push(slot('빠진 정보: ' + STYLE_DNA.info_card.fields.filter((f) => missing.indexOf(f.head) >= 0).map((f) => f.head + f.label).join(' ')));
    if (facts.address) card.push('');
    if (facts.address) card.push(facts.address + (place ? ' ' + place : ''));
    push({ id: 'info_card', role: 'FACT', lines: card });
  }

  /* ⑤ ⭐ 총평 — 맛집 글에서만. 별점은 성래 님 몫. */
  if (kind === 'place') {
    const lines = ['> ' + STYLE_DNA.rating.head, '>', '> ' + STYLE_DNA.rating.tome, ''];
    STYLE_DNA.rating.rows.forEach((r) => lines.push(r + ' ' + slot('별점') + ' (' + slot(r + ' 한 줄') + ')'));
    push({ id: 'rating', role: 'AI', lines: lines });
  }

  /* ⑥ 펀치라인 — 메모 마지막 한 줄이 이미 짧으면 그대로, 아니면 슬롯. */
  const punchLine = tailPunch || slot('마무리 펀치라인 (교훈·당부 금지)');
  push({ id: 'punch', role: 'AI', lines: [punchLine] });

  /* ⑦ 링크·해시태그 — 사실에 있는 말만. */
  const tags = buildHashtags(facts, kind, i.topic);
  const tagLines = groupLines(tags, STYLE_DNA.hashtag.per_line).slice(0, STYLE_DNA.hashtag.lines)
    .map((g) => g.join(' '));
  const tail = [];
  tail.push(...tagLines);
  if (i.video || i.has_video) { tail.push(''); tail.push(STYLE_DNA.video_link); }
  const prev = links.filter((l) => l.title || l.url)[0];
  if (prev) {
    tail.push('');
    tail.push(STYLE_DNA.crosslink
      .replace('{dong}', facts.region_dong || '대전')
      .replace('{topic}', i.topic || STYLE_DNA.kinds[kind].label.split('·')[0])
      .replace('{title}', prev.title || prev.url));
  }
  push({ id: 'hashtags', role: 'AUTO', lines: tail });

  const text = renderStyleSkeleton({ kind: kind, blocks: blocks, photos: plan, facts: facts, spec: spec });
  return {
    kind: kind, spec: spec, blocks: blocks, photos: plan, facts: facts,
    text: text, slots: slotsOf(text), links: links
  };
}

/* ────────────────────────── 제목 3안 (2026-11-25, #50841 사용자 승인) ────────────────────────── */

const TITLE_FILL = '[채우기]';
const TITLE_KIND_LABEL = { review: '맛집 리뷰', story: '일상 썰', info: '정보성' };

/** 같은 재료면 같은 제목 — 다시 눌렀다고 문구가 흔들리면 고르기 어렵다(djb2). */
function titleSeed(text) {
  let h = 5381;
  const s = String(text == null ? '' : text);
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  /* 아래 비트만 쓰면 한글 이름끼리 잘 붙는다 — 한 번 더 흔들어 섞는다(murmur3 마무리). */
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507) >>> 0;
  h ^= h >>> 13;
  return h >>> 0;
}

/** 상한을 넘는 제목은 따옴표 안(펀치)부터 줄인다 — 지역·가게명(검색 키워드)은 살린다.
 *  · 따옴표가 **정확히 한 쌍**일 때만 안쪽을 줄인다. 가게 이름에 따옴표가 섞이면 짝이 깨진다(cue2 QA).
 *  · 뒤에서 자를 때도 짝 없는 따옴표는 남기지 않고, 낱말·쉼표 중간에서 끝나지 않는다. */
function fitTitle(text, max) {
  const limit = Math.max(4, Number(max) || 55);
  const t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  if (cp(t) <= limit) return t;
  const first = t.indexOf('"');
  const last = t.lastIndexOf('"');
  if (first >= 0 && last > first && t.indexOf('"', first + 1) === last) {
    const head = t.slice(0, first + 1);
    const tail = t.slice(last);
    const room = limit - cp(head) - cp(tail);
    if (room >= 8) {
      const punch = t.slice(first + 1, last);
      const q = clipLine(punch, room - 1);
      /* 줄였다면 따옴표 안에 … 를 남겨 중간에서 끊긴 말처럼 보이지 않게. */
      if (q && cp(q) >= 2) return head + q + (cp(q) < cp(punch) ? '…' : '') + tail;
    }
  }
  let cut = clipLine(t, Math.max(2, limit - 1));
  if ((cut.match(/"/g) || []).length % 2) cut = cut.slice(0, cut.lastIndexOf('"'));
  cut = cut.replace(/[\s:·,;/\-–—]+$/, '').trim();
  return (cut || clipLine(t, Math.max(1, limit - 1))) + '…';
}

/**
 * 제목 3안 — 검색 키워드(지역·가게명)는 앞에, 뒷부분은 성래 님 인용형·자조 펀치라인.
 *   1안(검색형)  [대전 봉명동 고기집] 미미삼겹 : "고기는 죄가 없다, 내 지갑이 얇을 뿐"
 *   2안(사실·자조) 미미삼겹, 16,000원 먹고 "가오는 잡았고, 통장은 잡혔습니다"
 *   3안(인용 전진) "줄은 길었고 고기는 짧았다" — 봉명동 미미삼겹
 *  · 없는 값(가격·대기)은 쓰지 않는다 — 필요한 값이 없는 인용구는 후보에서 빠진다.
 *  · 사용자 메모도 재료다(추정하지 않기).
 */
export function titleOptions(materials, opts) {
  const T = STYLE_DNA.title;
  const m = materials && typeof materials === 'object' ? materials : {};
  const c = (m.content && typeof m.content === 'object') ? m.content : {};
  const o = opts || {};
  /* 가게 이름·동네·종류에 섞인 큰따옴표는 작은따옴표로 바꿨다 — 제목의 큰따옴표는 인용구(펀치) 자리다.
     이름에 " 가 섞이면 fitTitle 이 어느 따옴표가 짝인지 알 수 없어 제목이 중간에서 끊긴다(cue2 QA). */
  const plain = (s) => String(s == null ? '' : s).replace(/["“”]/g, "'").replace(/\s+/g, ' ').trim();
  const place = plain((m.place && m.place.name) || '');
  const dong = plain(c.region_dong);
  const cat = plain(c.category);
  const priceM = String(c.price_menu || '').match(/([0-9][0-9,]{2,})\s*원/);
  const price = priceM ? priceM[1] + '원' : '';
  const wait = String(c.wait_time || '').trim();
  const kind = String(o.kind || (m.concept && m.concept.kind) || 'review');
  const topic = plain(o.topic);
  /* 주제는 '가게 이름·주제' 칸(place)과 넘겨받은 topic 만 쓴다. 한 줄 지시(hint)는 제목 재료가 아니다. */
  const subject = place || topic || TITLE_FILL;
  const quotes = (T.quotes || [])
    .filter((q) => (!q.kind || q.kind === kind)
      && (!q.needs || (q.needs === 'price' && price) || (q.needs === 'wait' && wait)))
    .map((q) => String(q.text).replace('{price}', price).replace('{wait}', wait));
  if (!quotes.length) quotes.push('고기는 죄가 없다, 내 지갑이 얇을 뿐');
  const seed = titleSeed([place, dong, cat, kind, o.photoCount || ''].join('|'));
  const q = (n) => quotes[(seed + n) % quotes.length];
  /* 지역 접두어 — 동네가 이미 '대전 …'이면 또 붙이지 않는다('대전 대전 유성구' 방지, cue2 QA). */
  const region = (() => {
    const d = String(dong || '').trim().replace(/\s+/g, ' ');
    if (!d) return '';
    return /^대전/.test(d) ? d : '대전 ' + d;
  })();
  const catTag = (/^대전\s+/.test(cat) && /대전/.test(region)) ? cat.replace(/^대전\s+/, '') : cat;
  const prefix = (region || catTag)
    ? '[' + [region || '대전', catTag].filter(Boolean).join(' ') + ']'
    : '';
  const food = /(맛집|고기|삼겹|오겹|국밥|식당|분식|카페|커피|베이커리|한식|일식|중식|양식|술집|호프|포차|안주)/.test(cat + ' ' + place);
  const fact = price || wait;
  const one = (prefix ? prefix + ' ' : '') + subject + ' : "' + q(0) + '"';
  const two = fact
    ? subject + ', ' + fact + (food ? ' 먹고 ' : ' 쓰고 ') + '"' + q(1) + '"'
    : subject + (food ? ' 먹고 왔습니다 — "' : ' 이야기 — "') + q(1) + '"';
  const three = '"' + q(2) + '" — ' + (String(dong || '').trim() ? String(dong).trim() + ' ' : '') + subject;
  const out = [one, two, three].map((t) => fitTitle(t, T.max_chars));
  /* 세 안이 같은 구조면(재료가 너무 적을 때만) 종류 이름으로 자리를 바꿔 준다. */
  const label = TITLE_KIND_LABEL[kind] || TITLE_KIND_LABEL.review;
  if (!place && !topic) out[2] = fitTitle('"' + q(2) + '" — 대전 청년 ' + label, T.max_chars);
  return out;
}

/** 제목 문법 프롬프트 — 허브·노트북이 같은 문구를 쓴다(허브 시험이 대조). */
export function titlePromptLines() {
  const T = STYLE_DNA.title;
  return [
    '[제목 3안 — 성래 님 제목 문법. 세 안의 각도를 다르게]',
    '1안(검색형): [대전 봉명동 고기집] 미미삼겹 : "고기는 죄가 없다, 내 지갑이 얇을 뿐"',
    '2안(사실·자조): 미미삼겹, 16,000원 먹고 "가오는 잡았고, 통장은 잡혔습니다"',
    '3안(인용 전진): "줄은 길었고 고기는 짧았다" — 봉명동 미미삼겹',
    '- 지역(동네)·가게명·주제는 앞에 둔다(검색 유입). 뒷부분은 인용구·펀치라인 한 줄.',
    '- 확인된 사실(가격·대기·영업시간)만. 모르는 값은 제목에 넣지 않는다.',
    '- 금지: ' + T.ban.slice(0, 5).join(' · ') + ' 같은 상투어, 느낌표 남발, 근거 없는 과장(최고·인생·무조건). 제목 끝을 ' + T.ban_tail.join('·') + '로 맺지 않는다.',
    '- 따옴표는 큰따옴표(") 한 쌍만, 한 제목 ' + T.max_chars + '자 이내. 세 제목이 같은 문장 구조면 다시 쓴다.'
  ];
}

/** 해시태그 — 동네·종류·가게명·대전맛집·대전청년. 사실에 있는 말만. */
export function buildHashtags(facts, kind, topic) {
  const f = facts || {};
  const tags = [];
  const add = (t) => {
    const s = String(t || '').replace(/[^0-9A-Za-z가-힣_]/g, '');
    const hit = '#' + s;
    if (s.length >= 2 && tags.indexOf(hit) < 0) tags.push(hit);
  };
  const dong = f.region_dong || '';
  const cat = f.category || '';
  if (dong) add(dong + '맛집');
  if (dong && cat) add(dong + cat);
  if (cat) add(cat);
  if (dong) add(dong);
  if (f.place_name) add(f.place_name);
  add('대전맛집');
  add(kind === 'place' ? '내돈내산후기' : (topic || '대전청년'));
  add('대전청년');
  if (kind === 'place') { add('로컬맛집'); add(dong ? dong + '술집' : '대전술집'); }
  return tags.slice(0, STYLE_DNA.hashtag.max);
}

/** 뼈대 → 붙여넣을 본문. 빈 줄 규칙: 덩어리 사이 1개, 카드 안 0개. */
export function renderStyleSkeleton(bp) {
  const b = bp || {};
  const blocks = Array.isArray(b.blocks) ? b.blocks : [];
  const out = [];
  blocks.forEach((blk, n) => {
    const lines = Array.isArray(blk.lines) ? blk.lines.slice() : [];
    if (!lines.length) return;
    if (n) out.push('');
    lines.forEach((l) => out.push(l));
  });
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/* ────────────────────────── 품질 린터 (7지침, 2026-11-25 #50614) ────────────────────────── */

/** 공백 제외 글자수 — 네이버 글자수 표시와 같다. */
export function charsNoSpace(text) {
  return String(text == null ? '' : text).replace(/\s/g, '').length;
}

/** 본문 문장(인용구·캡션·정보카드·해시태그 제외) — 반복·묘사 판정의 분모. */
function proseSentences(text) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean)
    .filter((l) => !/^[>▲#\[▶👉]/u.test(l))
    .filter((l) => !/^(?:📍|📌|🕘|🚫|🍴|🅿|☎|⏳|🍯|📊|💰|📈|🏦|💡|💳)/u.test(l));
  const out = [];
  lines.forEach((l) => {
    (l.match(/[^.!?。？！]+[.!?。？！]?/g) || []).forEach((s) => {
      const t = s.trim();
      if (cp(t) >= 6) out.push(t);
    });
  });
  return out;
}

/**
 * 품질 7지침 검사 — 목소리(lintVoice)와 따로 돌린다.
 *  ① 실제 경험 ② AI 상토 표현 ③ 장단점 균형 ④ 정보 중복 ⑤(프롬프트 전용) ⑥ 메뉴 묘사 ⑦ 분량·반복
 *  거친 표현·자조는 감점하지 않는다 — 그건 목소리다.
 */
export function lintQuality(text, opts) {
  const Q = STYLE_DNA.quality;
  const o = opts || {};
  const kind = o.kind || 'place';
  const src = String(text == null ? '' : text);
  const items = [];
  const add = (id, label, state, value, fix) => items.push({ id, label, state, value, fix });
  const sents = proseSentences(src);

  /* ① 실제 경험 — 1인칭·행동·동행 */
  const expRe = /(?:저는|제가|내가|우리|함께|갔습니다|갔더니|먹었|시켰|앉았|기다렸|들어갔|나왔|보니|느꼈|느낀|직접)/g;
  const exp = (src.match(expRe) || []).length;
  add('experience', '실제 경험 서술', exp >= Q.experience_min ? 'pass' : (exp ? 'near' : 'warn'),
    exp + '회 (권장 ' + Q.experience_min + '회↑)', '누가·언제·뭐 시켰는지 한 줄씩. 없는 경험은 만들지 않는다');

  /* ② AI 상토 표현 */
  const abs = Q.abstract_ban.filter((w) => src.indexOf(w) >= 0);
  add('abstract_ai', '추상 AI 표현', abs.length ? 'warn' : 'pass', abs.slice(0, 3).join('·') || '없음',
    '"분위기가 느껴졌습니다" 대신 본 것·들은 것을 쓰세요');

  /* ③ 장단점 균형 — 없으면 감점하지 않고 '주의'만 */
  const bad = Q.shortcoming_words.filter((w) => src.indexOf(w) >= 0);
  add('balance', '아쉬운 점 한 줄', bad.length ? 'pass' : 'near', bad.slice(0, 3).join('·') || '없음',
    '실제로 아쉬웠면 한 줄만. 억지 단점은 만들지 않는다');

  /* ④ 정보 중복 — 정보카드 밖 본문(캔션·애드리브 제외)에서 같은 정보를 세 번 이상 또 쓰는가.
     '주차/웨이팅' 같은 말을 사진 켄션에서 한 번 쓰는 건 이야기다 — 본문 줄만 센다. */
  const cardStart = src.indexOf('📌');
  const bodyRaw = cardStart > 0 ? src.slice(0, cardStart) : src;
  const card = cardStart > 0 ? src.slice(cardStart) : '';
  const body = bodyRaw.split('\n').map((l) => l.trim()).filter(Boolean)
    .filter((l) => !/^(?:[>▲#\[▶👉]|\(|📍|📌|🕘|🚫|🍴|🅿|☎|⏳)/u.test(l)).join('\n');
  const dup = [];
  Q.info_dup_keys.forEach((k) => {
    const inCard = k.words.some((w) => card.indexOf(w) >= 0);
    const inBody = k.words.reduce((n, w) => n + (body.split(w).length - 1), 0);
    if (inCard && inBody >= 3) dup.push(k.key + ' ' + inBody + '회');
    else if (!inCard && inBody >= 4) dup.push(k.key + ' ' + inBody + '회');
  });
  add('info_dup', '정보 중복', dup.length ? 'warn' : 'pass', dup.join(' · ') || '없음',
    '주소·주차·웨이팅은 해당 항목에 한 번만');

  /* ⑥ 메뉴 묘사 — 음식 글이 아니면(차·보험·예산) 강제하지 않는다. */
  const facets = Object.keys(Q.menu_facets).filter((f) => Q.menu_facets[f].some((w) => src.indexOf(w) >= 0));
  const isFood = o.food === true || (kind === 'place' && o.food !== false);
  add('menu_desc', '메뉴 묘사 축', !isFood ? 'pass' : (facets.length >= Q.menu_facets_min ? 'pass' : (facets.length >= 2 ? 'near' : 'warn')),
    !isFood ? '음식 글이 아님' : (facets.join('·') || '없음'),
    '국물·식감·맵기·온도·조화 중 서로 다른 축으로. 메뉴마타 같은 표현 복붙 금지');

  /* ⑦ 종결·단어 반복 — 정중체(~습니다) 반복은 목소리다. 그 앞의 '내용어'가 같은지를 본다. */
  const STEM_RE = /(?:습니다|입니다|니다|해요|어요|아요|네요|더라고요|다|요|죠|까|나요)$/;
  const ends = {};
  sents.forEach((s) => {
    let m = s.replace(/[.!?。？！]+$/, '').trim();
    m = m.replace(STEM_RE, '').trim();
    const tail = m.slice(-2) || m;
    if (tail) ends[tail] = (ends[tail] || 0) + 1;
  });
  const top = Object.keys(ends).sort((a, b) => ends[b] - ends[a])[0] || '';
  const ratio = sents.length ? (ends[top] || 0) / sents.length : 0;
  add('ending_repeat', '종결 반복', sents.length < Q.ending_min_sentences ? 'near'
    : ratio <= Q.ending_repeat_max ? 'pass' : 'warn',
    sents.length < Q.ending_min_sentences ? '문장 ' + sents.length + '개'
      : '"' + top + '" ' + Math.round(ratio * 100) + '% / 상한 ' + Math.round(Q.ending_repeat_max * 100) + '%',
    '같은 어미가 반복됩니다 — 문장 흐름을 섮으세요');

  /* ⑦-2 광고성 표현 */
  const ads = (Q.ad_words || []).filter((w) => src.indexOf(w) >= 0);
  add('ad_words', '광고성 표현', ads.length ? 'warn' : 'pass', ads.slice(0, 3).join('·') || '없음',
    '최고·인생·무조건 같은 과장은 빼세요');

  /* ⑦-3 분량(공백 제외) */
  const chars = charsNoSpace(src);
  const [lo, hi] = Q.length_chars;
  const [wlo, whi] = Q.length_warn;
  add('length', '분량(공백 제외)', chars >= lo && chars <= hi ? 'pass' : (chars >= wlo && chars <= whi ? 'near' : 'warn'),
    chars + '자 / 목표 ' + lo + '~' + hi + '자', '짧으면 경험·묘사를 더, 길면 반복을 덜어냅니다');

  const weight = { pass: 1, near: 0.5, warn: 0 };
  const score = Math.round((items.reduce((s, x) => s + weight[x.state], 0) / items.length) * 100);
  const warns = items.filter((x) => x.state === 'warn');
  return {
    score: score, items: items, warns: warns,
    summary: warns.length ? '고칠 것 ' + warns.length + '개 — ' + warns.map((w) => w.label).join('·')
      : '품질 통과 — ' + items.filter((x) => x.state === 'pass').length + '/' + items.length,
    chars: chars, version: STYLE_DNA.quality.version
  };
}

/** 품질 7지침 프롬프트 — 허브·노트북 공용. */
export function qualityPromptLines(kind) {
  const Q = STYLE_DNA.quality;
  return [
    '[품질 7지침 — 먼저 읽고 쓰지 말고, 쓴 뒤에 스스로 검수한다]',
    '1) 실제 경험: 누가 같이 갔는지·몇 시에 갔는지·얼마나 기다렸는지·뭐을 시켰는지·양과 맛을 원문 사실 안에서만 쓴다. 제공되지 않은 경험은 만들지 않는다.',
    '2) AI 상토 금지: ' + Q.abstract_ban.slice(0, 4).join(' · ') + ' 같은 추상 표현 금지. 같은 문장 구조·종결을 반복하지 않는다.',
    '3) 장단점: 원문에 아쉬운 점(웨이팅·좁은 자리·비싼 가격·짠 간)이 있으면 한 줄 넣는다. 없으면 만들지 않는다(억지 단점 금지).',
    '4) 정보 중복 금지: 주소·주차·웨이팅·영업시간은 📌 정보카드와 해당 섹션에서 한 번만. 다른 소제목은 다른 정보를 전한다.',
    '5) 자료 구분: 메뉴·주소·영업시간·주차는 공식·원문 자료만. 다른 사람 후기를 내가 겪은 것처럼 쓰지 않는다.',
    '6) 메뉴 묘사: 국물·식감·맵기·온도·조화 중 서로 다른 축으로 메뉴를 따로 묘사한다. 메뉴마타 같은 맛 표현 복붙 금지.',
    '7) 검수: 창작 0건 · 종결 반복 상한 ' + Math.round(Q.ending_repeat_max * 100) + '% · 광고성 표현 0 · 분량 ' + Q.length_chars[0] + '~' + Q.length_chars[1] + '자(공백 제외). 넘거나 모자라면 출력 전에 고친다.'
  ];
}

/* ────────────────────────── AI 결과로 빈 자리 채우기 ────────────────────────── */

/**
 * 뼈대의 `⟦…⟧` 를 AI 초안 값으로 바꿔 넣는다 — 순서대로, 라벨별로.
 *  AI 가 안 보낸 항목은 그대로 슬롯으로 남긴다(지어내지 않는다).
 *  draft = { opener, section_punch:[{after,text}], rating:[{row,stars,note}], outro, captions:[{name,text,aside}] }
 */
export function fillStyleSlots(text, draft) {
  let out = String(text == null ? '' : text);
  const d = draft || {};
  const one = (s, max) => clipChars(String(s == null ? '' : s).replace(/\s+/g, ' ').trim(), max || 200);

  const opener = one(d.opener, 120);
  if (opener) out = out.replace(new RegExp(SLOT_OPEN + '자기소개[^' + SLOT_CLOSE + ']*' + SLOT_CLOSE), opener);

  const punches = (Array.isArray(d.section_punch) ? d.section_punch : [])
    .map((x) => one(typeof x === 'string' ? x : (x && x.text), 200)).filter(Boolean);
  let pi = 0;
  out = out.replace(new RegExp(SLOT_OPEN + '판정[^' + SLOT_CLOSE + ']*' + SLOT_CLOSE, 'g'), (m) => (pi < punches.length ? punches[pi++] : m));

  /* 사진 애드리브 — 슬롯 라벨의 `(사진 N)` 번호와 바로 위 `[사진 N] 이름` 둘로 그 사진 자리에만 넣는다.
     · 이름표가 먼저다(같은 파일명이 여럿이면 글에 나온 순서대로 하나씩 — 덮어쓰지 않는다).
     · 이름이 없는 예전 결과만 순서 폴백(하위 호환) — 앞의 메모 없는 사진이 뒤 사진 애드리브를 가져가지 않는다(cue2 QA). */
  const capName = (s) => String(s == null ? '' : s).trim().replace(/\\/g, '/').split('/').pop().toLowerCase();
  const capChars = STYLE_DNA.caption.aside_chars;
  const asideByName = {};
  const asideByNo = {};
  const looseAsides = [];
  const takeAside = (q) => (Array.isArray(q) && q.length ? q.shift() : '');
  (Array.isArray(d.captions) ? d.captions : []).forEach((raw) => {
    const c = (raw && typeof raw === 'object') ? raw : {};
    const v = clipLine(String(c.aside == null ? '' : c.aside).replace(/^[(]|[)]$/g, ''), capChars);
    if (!v) return;
    const no = String(c.number != null ? c.number : (c.photo_no != null ? c.photo_no : '')).trim();
    const name = capName(c.name);
    if (no) (asideByNo[no] = asideByNo[no] || []).push(v);
    else if (name) (asideByName[name] = asideByName[name] || []).push(v);
    else looseAsides.push(v);
  });
  if (Object.keys(asideByName).length || Object.keys(asideByNo).length || looseAsides.length) {
    const nameByNo = {};
    out.split('\n').forEach((line) => {
      const m = line.match(/^\[사진\s+(\d+)\]\s*(.+)$/);
      if (m) nameByNo[m[1]] = capName(m[2]);
    });
    out = out.split('\n').map((line) => {
      if (/^\[사진\s+\d+\]/.test(line)) return line;
      if (line.indexOf(SLOT_OPEN + '사진 애드리브') < 0) return line;
      const at = line.match(/사진\s*(\d+)/);
      const no = at ? at[1] : '';
      const aside = takeAside(asideByName[nameByNo[no] || '']) || takeAside(asideByNo[no]) || takeAside(looseAsides);
      return aside ? '(' + aside + ')' : line;
    }).join('\n');
  }

  const rows = Array.isArray(d.rating) ? d.rating : [];
  STYLE_DNA.rating.rows.forEach((r) => {
    const hit = rows.find((x) => x && (String(x.row || '').indexOf(r) >= 0));
    if (!hit) return;
    const stars = String(hit.stars || '').trim() || '⭐⭐⭐⭐☆';
    const note = one(hit.note, 80);
    out = out.replace(new RegExp('^' + r + ' ' + SLOT_OPEN + '별점' + SLOT_CLOSE + ' \\(' + SLOT_OPEN + r + ' 한 줄' + SLOT_CLOSE + '\\)', 'm'),
      r + ' ' + stars + (note ? ' (' + note + ')' : ''));
  });

  const outro = one(d.outro, 160);
  if (outro) out = out.replace(new RegExp(SLOT_OPEN + '마무리 펀치라인[^' + SLOT_CLOSE + ']*' + SLOT_CLOSE), outro);

  return out;
}

/* ────────────────────────── 린터 ────────────────────────── */

/** 인용구 블록 수 — `> 머리` 다음에 빈 `>` 가 오는 형태만 센다. */
export function quoteSections(text) {
  const lines = String(text || '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (/^>\s*\S/.test(lines[i]) && /^>\s*$/.test(lines[i + 1])) out.push(lines[i].replace(/^>\s*/, '').trim());
  }
  return out;
}

/** 54자 초과 줄 분류 — quote/info/hashtag/url/list 는 감점 제외. */
export function longLines(text) {
  const rows = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const out = [];
  rows.forEach((l) => {
    if (cp(l) <= 54) return;
    let kind = 'prose';
    if (/^>/.test(l)) kind = 'quote';
    else if (/^(?:📍|⏰|🚗|💰|📊|📈|🏦|💡|💳|📞|☎|📌|🕘|🚫|🍴|🅿|⏳|▶|👉)/u.test(l)) kind = 'info';
    else if (/^#/.test(l)) kind = 'hashtag';
    else if (/https?:\/\//.test(l)) kind = 'url';
    else if (/^\d+[.)]\s/.test(l) || /^[-*•]\s/.test(l)) kind = 'list';
    out.push({ text: l, chars: cp(l), kind: kind, exempt: STYLE_DNA.long_line.exempt.indexOf(kind) >= 0 });
  });
  return out;
}

/**
 * 성래 님 목소리 검수 — 점수(0~100)와 항목별 상태.
 *  'AI 티'와 '거친 표현'을 가르는 판정선(제미니 확정): 거친 표현·자조·로컬 비유·구체 숫자는 통과,
 *  번역투·교훈형 마무리·근거 없는 추상 칭찬은 감점.
 */
export function lintVoice(text, opts) {
  const o = opts || {};
  const kind = o.kind || (o.hasPlace ? 'place' : 'info');
  const photoCount = Number(o.photoCount || 0);
  const src = String(text == null ? '' : text);
  const items = [];
  const add = (id, label, state, value, fix) => items.push({ id, label, state, value, fix });

  const quotes = quoteSections(src);
  const needs = kind === 'place' ? 3 : 2;
  add('quote_sections', '인용구 섹션', quotes.length >= needs ? 'pass' : (quotes.length ? 'near' : 'warn'),
    quotes.length + '개 / 권장 ' + needs + '개↑', '📍 머리 + 빈 > + 판정 한 줄로 섹션을 만드세요');

  const caps = (src.match(/^▲/gm) || []).length;
  add('captions', '▲ 사진 캡션', photoCount ? (caps >= Math.ceil(photoCount * 0.6) ? 'pass' : (caps ? 'near' : 'warn')) : (caps ? 'pass' : 'near'),
    caps + '개 / 사진 ' + photoCount + '장', '사진마다 ▲ 한 줄(감성) + 괄호 애드리브를 붙이세요');

  const heads = STYLE_DNA.info_card.required.filter((h) => new RegExp('^' + h, 'm').test(src));
  add('info_card', '📌 정보 카드', heads.length >= 4 ? 'pass' : (heads.length ? 'near' : 'warn'),
    heads.join(' ') || '없음', '📍위치 🕘영업 🍴가격 🅿주차 ☎전화를 한 덩어리로');

  if (kind === 'place') {
    const stars = (src.match(/^(?:맛|가성비|서비스)\s⭐/gm) || []).length;
    add('rating', '⭐ 총평 3줄', stars >= 3 ? 'pass' : (stars ? 'near' : 'warn'), stars + '줄', '맛·가성비·서비스 별점 3줄');
  }

  const prose = src.split('\n').map((l) => l.trim()).filter((l) => l && !/^[>▲#\[▶👉]/u.test(l) && !/^(?:📍|📌|🕘|🚫|🍴|🅿|☎|⏳|🍯|📊|💰)/u.test(l));
  const tail = prose.slice(-2).join(' ');
  const ban = STYLE_DNA.punch.ban_endings.filter((b) => tail.indexOf(b) >= 0);
  add('punch_end', '펀치라인 종결', ban.length ? 'warn' : (prose.length ? 'pass' : 'near'),
    ban.length ? '교훈·당부 어미: ' + ban.join('·') : '없음', '마지막은 결론이 아니라 펀치라인으로');

  add('crosslink', '👉 교차링크', /^👉/m.test(src) ? 'pass' : 'near', /^👉/m.test(src) ? '있음' : '없음', '같은 동네 이전 글을 👉 한 줄로');

  const tagLines = (src.match(/^#/gm) || []).length;
  add('hashtags', '해시태그 2줄', tagLines === 2 ? 'pass' : (tagLines === 1 ? 'near' : 'warn'), tagLines + '줄', '해시태그를 두 줄로 나눠 마지막에');

  const rough = STYLE_DNA.rough_voice.allow.filter((w) => src.indexOf(w) >= 0);
  add('rough_voice', '거친 표현·자조', rough.length >= 2 ? 'pass' : (rough.length ? 'near' : 'warn'),
    rough.length ? rough.slice(0, 5).join('·') : '0개', '욕설·자조가 0이면 AI가 쓴 글처럼 읽힙니다');

  const local = STYLE_DNA.rough_voice.local.filter((w) => src.indexOf(w) >= 0);
  add('local_metaphor', '대전 로컬 비유', local.length >= 1 ? 'pass' : 'near', local.slice(0, 4).join('·') || '없음', '성심당·트램·1호선·유성온천 같은 대전 비유 하나');

  const digits = (src.match(/[0-9]/g) || []).length;
  const ratio = cp(src) ? digits / cp(src) : 0;
  add('numbers', '숫자 밀도', ratio >= 0.015 ? 'pass' : 'warn', Math.round(ratio * 1000) / 10 + '% (권장 1.5%↑)', '가격·시간·거리 숫자를 문단마다');

  const long = longLines(src);
  const bad = long.filter((l) => !l.exempt);
  add('long_line', '54자 초과', bad.length <= STYLE_DNA.long_line.max_prose_over ? 'pass' : 'warn',
    '서술 ' + bad.length + '줄 · 예외 ' + (long.length - bad.length) + '줄', '인용구·정보카드·해시태그는 길어도 됩니다');

  const left = slotsOf(src);
  add('slots', '남은 빈 자리', left.length === 0 ? 'pass' : (left.length <= 4 ? 'near' : 'warn'),
    left.length ? left.length + '곳 — ' + left.slice(0, 3).join(' / ') : '없음', '⟦⟧ 안을 채우면 발행할 수 있습니다');

  const weight = { pass: 1, near: 0.5, warn: 0 };
  const scored = items.filter((x) => x.id !== 'slots');
  const score = Math.round((scored.reduce((s, x) => s + weight[x.state], 0) / scored.length) * 100);
  const warns = items.filter((x) => x.state === 'warn');
  return {
    score: score, items: items, warns: warns,
    summary: (warns.length ? '고칠 것 ' + warns.length + '개 — ' + warns.map((w) => w.label).join('·')
      : '목소리 그대로 — ' + items.filter((x) => x.state === 'pass').length + '/' + items.length + ' 통과')
      + ' · 남은 빈 자리 ' + left.length + '곳',
    version: STYLE_DNA.version
  };
}

/* ────────────────────────── AI 슬롯 프롬프트 ────────────────────────── */

/** 노트북(hub-agent content_draft)에 보낼 슬롯 목록 — draft.js 의 같은 문자열과 시험이 대조한다. */
export function stylePromptLines(kind) {
  const k = STYLE_DNA.kinds[kind] || STYLE_DNA.kinds.info;
  return [
    '[문법 — 성래 님 발행글 그대로. 새 문장을 쓰지 말고 아래 빈 자리만 채운다]',
    '1) 인용구 섹션: `> 📍 머리` + 빈 `>` + `> 판정 한 줄(훅·놀림·단정, 40자 이내)`. 판정은 그 섹션 사진·원문에서 나온 것만.',
    '2) ▲ 캡션: 사진 순서대로 한 줄(42자 이내, 감성·놀림). 사진 메모가 있으면 그 메모가 그 사진의 사실이다 — 메모를 바탕으로 캡션을 쓰고, 필요하면 바로 아래 (괄호 애드리브) 한 줄. 메모가 없으면 역할(외관·메뉴판·음식·분위기·마무리)로만. 애드리브는 글 전체 3개 이내.',
    '3) 도입: 인사 한 줄 + 자기소개·자조 타이틀 한 줄(예: "Lv.2 빚 있는 청년 카푸어"). 원문에 있으면 그 문장을 쓴다.',
    '4) 마무리: 교훈·당부 금지. 펀치라인 한 줄(예: "나쁜건 오빠가 다 마셔서 사라지게 해줄게.").',
    '5) ⭐ 총평: 맛·가성비·서비스 3줄. 별점(★/☆ 5칸)과 괄호 한 줄. 사실에 없는 평가는 쓰지 않는다.',
    '6) 금지: 번역투(~에 대한·~를 통해·~할 수 있습니다), 교훈형 엔딩("~라는 뜻이니까요"), 근거 없는 추상 칭찬, 미확인 가격·시간, `[사진 위치]` 같은 자리표시.',
    '7) 비는 자리는 지어내지 말고 "" 로 돌려준다(허브가 ⟦⟧ 로 남긴다).',
    '블록 순서(' + k.label + '): ' + k.blocks.map((b) => b.id + (b.required ? '' : '(선택)')).join(' → ')
  ];
}

if (typeof window !== 'undefined') {
  window.BlogStyle = {
    STYLE_DNA, buildStyleSkeleton, renderStyleSkeleton, lintVoice, buildHashtags,
    stylePromptLines, quoteSections, longLines, slotsOf, kindOf, fillStyleSlots,
    lintQuality, qualityPromptLines, charsNoSpace, titleOptions, titlePromptLines
  };
}
