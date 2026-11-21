/**
 * gas/BlogSeo.gs — 매일 아침 '오늘의 블로그 제목 10' (2026-11-21)
 *
 * 왜 서버(GAS)에서 만드나
 *   · 아침 브리핑은 브라우저가 꺼져 있어도 돌아야 한다 → 제목도 서버가 그때 만들어 시트에 남긴다.
 *   · 화면(#/blog)과 브리핑이 **같은 줄**을 본다(같은 날 두 번 계산해 다른 제목이 나오지 않게).
 *
 * 절대 규칙
 *   · AI 를 부르지 않는다(토큰 0). 축별 키워드 풀 + 데이터랩 추이 + 내 블로그 실적을 규칙으로 조합한다.
 *   · 지어내지 않는다. 제목은 '각도'이고, 가게 이름·가격처럼 확인하지 않은 값은 넣지 않는다.
 *   · 발행하지 않는다. 제목을 눌러도 초안 스튜디오(#/create/blog)로 넘길 뿐이다.
 *   · 데이터랩 숫자는 **그 키워드 안에서의 상대지수**(최고=100)다. 그래서 서로의 크기를 비교하지 않고
 *     모양(최근 4구간 vs 직전 4구간 증감률 · 성수기 여부)만 쓴다.
 *
 * 한도
 *   · 데이터랩은 후보 18개를 5개씩 4회 호출(자체 천장 일 200/월 2,000회의 2% 수준, 12시간 캐시).
 *   · 네이버 블로그 검색은 후보 18개 = 18회(일 25,000회 한도, 우리 천장과 무관). 실패해도 제목은 나온다.
 *
 * 액션
 *   · blog_seo_titles : 오늘 줄이 있으면 그대로, 없으면 만들어 저장하고 돌려준다(payload.refresh=true 면 다시 만든다).
 *
 * 매일 아침 자동 실행(설치 함수 — 등록은 사용자가 승인한 뒤에 한다)
 *   · installBlogSeoTitlesTrigger() : 매일 08:30(KST) blogSeoTitlesDaily 실행
 */

const BLOG_SEO_SHEET_ = 'Blog_Seo_Titles';
const BLOG_SEO_HEAD_ = [
  'day', 'rank', 'axis', 'axis_label', 'keyword', 'title',
  'trend_pct', 'trend_state', 'season', 'peak', 'sample',
  'my_rank', 'inflow', 'doc_total', 'score', 'reason', 'generated_at', 'source'
];
const BLOG_SEO_COUNT_ = 10;
/** 축별 하루 배분 — 합이 10 이어야 한다. */
const BLOG_SEO_QUOTA_ = { food: 3, life: 3, store: 2, cat: 2 };
/** 후보는 배분보다 2개씩 더 본다(표본 적음·이미 쓴 말로 빠질 때 채우려고). */
const BLOG_SEO_EXTRA_ = 2;
const BLOG_SEO_TREND_BATCH_ = 5;        // 데이터랩 요청 1회에 주제어 5개까지
const BLOG_SEO_TITLE_MAX_ = 45;         // 모바일 목록에서 잘리지 않는 상한(공백 포함) — 내 상위 글 평균은 53자
const BLOG_SEO_TITLE_MIN_ = 18;
const BLOG_SEO_RECENT_DAYS_ = 7;        // 같은 제목을 다시 내지 않으려 보는 기간
const BLOG_SEO_DUP_DAYS_ = 30;          // 이미 쓴 글과 겹치는지 보는 기간

/**
 * 4축 — 제목을 만드는 재료. keyword 는 그대로 검색어로 보낸다.
 * titles 의 {kw} 는 키워드, {year} 는 올해로 바뀐다.
 * skeleton 은 #/create/blog 에서 메모 칸에 넣는 뼈대(사용자가 고쳐 쓴다).
 */
const BLOG_SEO_AXES_ = {
  food: {
    label: '대전 맛집·카페',
    keywords: ['대전 맛집', '유성 맛집', '봉명동 맛집', '대전 카페', '유성 카페',
      '대전 혼밥', '대전 국밥', '대전 냉삼', '대전 야장', '도룡동 맛집'],
    titles: [
      '{kw} 다녀왔습니다 — 주문한 메뉴와 값',
      '{kw} 웨이팅·주차까지 적어 둡니다',
      '{kw} 다시 갈지 고민한 이유',
      '{kw} 처음 가는 사람 기준 정리'
    ],
    skeleton: ['1. 언제 · 누구랑 갔는지:', '2. 주차 · 웨이팅:', '3. 주문한 메뉴 · 값:',
      '4. 맛 · 아쉬운 점:', '5. 또 갈지:']
  },
  life: {
    label: '대전 생활·청년정책',
    keywords: ['대전 청년 정책', '대전 청년 지원금', '대전 월세지원', '유성구 청년 정책',
      '대전 대형폐기물', '대전 트램', '대전 청년 창업 지원', '대전 청년 문화'],
    titles: [
      '{kw} {year} 신청 조건 정리',
      '{kw} 해 보고 막힌 데만 적었습니다',
      '{kw} 마감 전에 확인할 세 가지',
      '{kw} 서류·기간 헷갈리는 부분'
    ],
    skeleton: ['1. 알게 된 경로 · 시기:', '2. 신청 조건에서 걸린 것:', '3. 준비한 서류:',
      '4. 처리 기간 · 결과:', '5. 헷갈렸던 부분:']
  },
  store: {
    label: '스마트스토어·재테크',
    keywords: ['스마트스토어 위탁판매', '스마트스토어 첫 주문', '무재고 부업',
      '청년 창업 세액감면', '공모주 청약 일정', '청년미래적금'],
    titles: [
      '{kw} 첫 달에 실제로 남은 것',
      '{kw} 시작 전에 알았으면 한 것',
      '{kw} 2주 해 보고 바꾼 것'
    ],
    skeleton: ['1. 시작한 때 · 준비물:', '2. 첫 주문까지 걸린 것:', '3. 비용 · 수수료:',
      '4. 안 된 시도:', '5. 다음에 바꿀 것:']
  },
  cat: {
    label: '반려묘',
    keywords: ['브리티쉬 숏헤어', '고양이 스크래쳐', '고양이 모래', '고양이 화장실 냄새',
      '고양이 심장사상충', '고양이 자동급식기'],
    titles: [
      '{kw} 두 달 써 보고 남긴 후기',
      '{kw} 사기 전에 본 것과 산 뒤',
      '{kw} 집사가 헷갈렸던 부분 정리'
    ],
    skeleton: ['1. 산 것 · 산 이유:', '2. 쓴 기간:', '3. 좋았던 점:',
      '4. 아쉬운 점:', '5. 다시 산다면:']
  }
};
const BLOG_SEO_AXIS_ORDER_ = ['food', 'life', 'store', 'cat'];

/* ------------------------------------------------------------------ *
 * ① 오늘 줄 읽기·저장
 * ------------------------------------------------------------------ */

function blogSeoSheet_(ss) {
  let sheet = ss.getSheetByName(BLOG_SEO_SHEET_);
  if (!sheet) {
    sheet = ss.insertSheet(BLOG_SEO_SHEET_);
    sheet.getRange(1, 1, 1, BLOG_SEO_HEAD_.length).setValues([BLOG_SEO_HEAD_]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function blogSeoRowsOfDay_(ss, day) {
  return readSheetAsObjects_(ss, BLOG_SEO_SHEET_)
    .filter(function (r) { return String(r.day) === day && String(r.title) !== ''; })
    .sort(function (a, b) { return (Number(a.rank) || 99) - (Number(b.rank) || 99); });
}

/** 그날 줄만 갈아 끼운다(같은 날 두 번 만들어도 10줄). 다른 날 줄은 그대로 둔다. */
function blogSeoSave_(ss, day, rows) {
  withWriteLock_(function () {
    const sheet = blogSeoSheet_(ss);
    const last = sheet.getLastRow();
    const kept = [];
    if (last > 1) {
      const values = sheet.getRange(1, 1, last, BLOG_SEO_HEAD_.length).getValues();
      for (let i = 1; i < values.length; i++) {
        const row = values[i];
        if (String(row[0]) === day) continue;
        if (String(row.join('')).replace(/\s/g, '') === '') continue;
        kept.push(row);
      }
    }
    const fresh = rows.map(function (r) {
      return BLOG_SEO_HEAD_.map(function (h) {
        return Object.prototype.hasOwnProperty.call(r, h) ? r[h] : '';
      });
    });
    const body = kept.concat(fresh);
    const width = BLOG_SEO_HEAD_.length;
    const padded = body.map(function (row) {
      const out = row.slice(0, width);
      while (out.length < width) out.push('');
      return out;
    });
    // 남는 옛 줄은 빈 값으로 덮어 중복이 남지 않게 한다.
    const totalRows = Math.max(1 + padded.length, last);
    const matrix = [BLOG_SEO_HEAD_.slice()];
    for (let i = 0; i < totalRows - 1; i++) {
      matrix.push(padded[i] || new Array(width).fill(''));
    }
    sheet.getRange(1, 1, matrix.length, width).setValues(matrix);
  });
}

/* ------------------------------------------------------------------ *
 * ② 후보 고르기 — 날짜에 따라 돌려 가며(같은 키워드가 매일 나오지 않게)
 * ------------------------------------------------------------------ */

function blogSeoHash_(text) {
  const hex = sha256Hex_(String(text || ''));
  return parseInt(hex.slice(0, 8), 16) || 0;
}

/** 날짜 순번(1970-01-01 기준 일수) — 풀을 돌리는 기준 */
function blogSeoDayIndex_(day) {
  const t = Date.parse(String(day) + 'T00:00:00+09:00');
  return Math.floor((Number.isNaN(t) ? Date.now() : t) / 86400000);
}

/**
 * 오늘 볼 후보 — 축별로 배분+2 개씩, 축 안에서는 날짜 순번으로 시작점을 옮긴다.
 * @return {Array<{axis:string, keyword:string}>}
 */
function blogSeoCandidates_(day) {
  const idx = blogSeoDayIndex_(day);
  const out = [];
  BLOG_SEO_AXIS_ORDER_.forEach(function (axis) {
    const pool = (BLOG_SEO_AXES_[axis] && BLOG_SEO_AXES_[axis].keywords) || [];
    if (!pool.length) return;
    const want = Math.min(pool.length, (BLOG_SEO_QUOTA_[axis] || 0) + BLOG_SEO_EXTRA_);
    const start = idx % pool.length;
    for (let i = 0; i < want; i++) {
      out.push({ axis: axis, keyword: pool[(start + i) % pool.length] });
    }
  });
  return out;
}

/* ------------------------------------------------------------------ *
 * ③ 데이터랩 추이 — 후보를 5개씩 묶어 부른다(키워드마다 창구 호출 1회는 낭비)
 *    실패한 묶음은 통째로 비워 두고, 그 키워드는 '표본 없음'으로 남긴다.
 * ------------------------------------------------------------------ */

function blogSeoTrendOf_(ss, candidates, brand) {
  const out = {};
  const failed = [];
  for (let i = 0; i < candidates.length; i += BLOG_SEO_TREND_BATCH_) {
    const batch = candidates.slice(i, i + BLOG_SEO_TREND_BATCH_);
    const groups = batch.map(function (c) { return { name: c.keyword, keywords: [c.keyword] }; });
    let res = null;
    try {
      res = handleInsightTrend_(ss, { brand: brand, months: 12, unit: 'week', groups: groups }, { brand: brand });
    } catch (err) {
      failed.push(String((err && err.message) || err).slice(0, 80));
    }
    const list = (res && Array.isArray(res.groups)) ? res.groups : [];
    list.forEach(function (g) {
      out[String(g.title || '')] = {
        delta_pct: g.delta_pct == null ? null : Number(g.delta_pct),
        trend: String(g.trend || ''),
        season: String(g.season || ''),
        latest: g.latest == null ? null : Number(g.latest),
        peak: g.peak == null ? null : Number(g.peak)
      };
    });
  }
  return { byKeyword: out, failed: failed };
}

/* ------------------------------------------------------------------ *
 * ④ 경쟁 강도 — 네이버 블로그 검색 결과 수(문서 수)
 *    키가 없거나 실패하면 null 로 두고 점수에 넣지 않는다.
 * ------------------------------------------------------------------ */

function blogSeoDocsOf_(candidates) {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('NAVER_CLIENT_ID');
  const secret = props.getProperty('NAVER_CLIENT_SECRET');
  if (!id || !secret) return {};
  const mode = String(props.getProperty('NAVER_API_MODE') || '').toLowerCase();
  const out = {};
  candidates.forEach(function (c) {
    try {
      const got = naverBlogSearch_(c.keyword, id, secret, mode);
      const code = got.res.getResponseCode();
      if (code !== 200) return;
      const j = JSON.parse(got.res.getContentText());
      out[c.keyword] = Number(j.total) || 0;
    } catch (e) { /* 한 키워드 실패는 그 키워드만 비운다 */ }
  });
  return out;
}

/* ------------------------------------------------------------------ *
 * ⑤ 내 블로그 실적 — 유입 검색어 · 순위 · 글 제목
 * ------------------------------------------------------------------ */

function blogSeoMine_(ss, brand) {
  const blogId = blogIdFor_(brand);
  const today = kstDay_(new Date());
  const weekAgo = kstDay_(new Date(Date.now() - 7 * 86400000));
  const since = kstDay_(new Date(Date.now() - BLOG_SEO_DUP_DAYS_ * 86400000));

  const posts = readSheetAsObjects_(ss, 'Blog_Posts').filter(function (r) {
    return String(r.blog_id) === blogId;
  }).map(function (r) {
    return {
      title: String(r.title || ''),
      published_at: dayKey_(r.published_at),
      comment_cnt: Number(r.comment_cnt) || 0,
      sympathy_cnt: Number(r.sympathy_cnt) || 0
    };
  });

  const ranks = {};
  const rankRows = {};
  readSheetAsObjects_(ss, 'Rank_Log').forEach(function (r) {
    if (String(r.surface) !== 'naver_blog_search' || String(r.brand) !== brand) return;
    const k = String(r.keyword || '');
    if (!k) return;
    const at = r.checked_at instanceof Date ? formatKstIso_(r.checked_at) : String(r.checked_at || '');
    if (!rankRows[k] || at > rankRows[k].at) rankRows[k] = { at: at, rank: Number(r.rank_pos) || 0 };
  });
  Object.keys(rankRows).forEach(function (k) { ranks[k] = rankRows[k].rank; });

  let inflow = [];
  try {
    const ins = aggregateIngested_(ss, blogId, weekAgo);
    inflow = (ins.keywords || []).map(function (x) { return String(x.keyword || ''); });
  } catch (e) { inflow = []; }

  return {
    today: today,
    posts: posts,
    ranks: ranks,
    inflow: inflow,
    recentTitles: posts.filter(function (p) { return p.published_at >= since; }).map(function (p) { return p.title; }),
    // 상위 노출 패턴 — 내가 실제로 반응을 받은 글의 제목 생김새(지어내지 않고 세기만 한다)
    pattern: blogSeoPattern_(posts)
  };
}

function blogSeoPattern_(posts) {
  const list = (posts || []).slice().sort(function (a, b) {
    return (b.comment_cnt + b.sympathy_cnt) - (a.comment_cnt + a.sympathy_cnt);
  }).slice(0, 5);
  if (!list.length) return null;
  const len = list.reduce(function (s, p) { return s + String(p.title).length; }, 0);
  const digits = list.filter(function (p) { return /[0-9]/.test(p.title); }).length;
  const bracket = list.filter(function (p) { return /[\[\]()]/.test(p.title); }).length;
  const recap = list.filter(function (p) { return /(후기|정리|기록|비교)/.test(p.title); }).length;
  return {
    sample: list.length,
    avg_len: Math.round(len / list.length),
    with_number: digits,
    with_bracket: bracket,
    with_recap: recap,
    text: '내 반응 상위 ' + list.length + '편 제목: 평균 ' + Math.round(len / list.length)
      + '자 · 숫자 ' + digits + '편 · 괄호 ' + bracket + '편 · 후기·정리 ' + recap + '편'
  };
}

/* ------------------------------------------------------------------ *
 * ⑥ 점수와 선별 (순수 계산 — 시트·네트워크 없이 시험할 수 있다)
 * ------------------------------------------------------------------ */

function blogSeoTrendScore_(t) {
  if (!t) return { score: -100, state: '표본 없음' };
  const peak = Number(t.peak);
  if (Number.isFinite(peak) && peak < 10) return { score: -100, state: '표본 적음' };
  const d = t.delta_pct == null ? null : Number(t.delta_pct);
  let score = 0;
  let state = '비슷함';
  if (d == null || !Number.isFinite(d)) { score = 0; state = '비교 전'; }
  else if (d >= 40) { score = 30; state = '오르는 중'; }
  else if (d >= 15) { score = 20; state = '오르는 중'; }
  else if (d <= -15) { score = -10; state = '내리는 중'; }
  else { score = 5; state = '비슷함'; }
  if (t.season === '성수기') score += 10;
  return { score: score, state: state };
}

function blogSeoDocScore_(docTotal) {
  const n = Number(docTotal);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n < 50000) return 12;        // 문서가 적다 = 상위에 설 여지
  if (n < 200000) return 6;
  if (n < 1000000) return 0;
  return -8;                       // 문서가 아주 많다 = 큰 글에 밀리기 쉽다
}

function blogSeoInflowHit_(keyword, inflow) {
  const k = String(keyword || '');
  if (!k) return '';
  for (let i = 0; i < (inflow || []).length; i++) {
    const w = String(inflow[i] || '');
    if (!w) continue;
    if (w.indexOf(k) >= 0 || k.indexOf(w) >= 0) return w;
  }
  return '';
}

/** 이미 쓴 글과 같은 말인가 — 제목에 키워드가 통째로 들어 있으면 겹친다고 본다. */
function blogSeoAlreadyUsed_(keyword, titles) {
  const k = String(keyword || '');
  if (!k) return false;
  return (titles || []).some(function (t) { return String(t || '').indexOf(k) >= 0; });
}

/**
 * 후보 → 오늘의 10줄.
 * @param {{day:string, candidates:Array, trend:Object, docs:Object, mine:Object, recentTitles:Array}} input
 * @return {{rows:Array, fallback:string}}
 */
function blogSeoPick_(input) {
  const i = input || {};
  const day = String(i.day || kstDay_(new Date()));
  const trend = i.trend || {};
  const docs = i.docs || {};
  const mine = i.mine || {};
  const ranks = mine.ranks || {};
  const inflow = mine.inflow || [];

  const scored = (i.candidates || []).map(function (c) {
    const t = trend[c.keyword] || null;
    const ts = blogSeoTrendScore_(t);
    const rank = Number(ranks[c.keyword]) || 0;
    const hit = blogSeoInflowHit_(c.keyword, inflow);
    const dup = blogSeoAlreadyUsed_(c.keyword, mine.recentTitles || []);
    let score = ts.score + blogSeoDocScore_(docs[c.keyword]);
    if (hit) score += 25;
    if (rank >= 1 && rank <= 10) score += 12;
    else if (rank >= 11 && rank <= 50) score += 22;
    if (dup && !(rank >= 11 && rank <= 50)) score = -100;   // 이미 쓴 말은 순위 방어 목적일 때만
    score += (blogSeoHash_(day + c.keyword) % 7);           // 동점이면 날마다 순서가 달라지게
    return {
      axis: c.axis, keyword: c.keyword, trend: t, trend_state: ts.state,
      my_rank: rank || null, inflow: hit || '', doc_total: Number(docs[c.keyword]) || null,
      score: score
    };
  }).filter(function (x) { return x.score > -100; });

  // 표본이 얇은 말은 '표본 적음'이라 적고 뒤로 미룬다 — 오름/내림을 말할 수 없는 값이다.
  const thin = scored.filter(function (x) { return x.trend_state === '표본 적음' || x.trend_state === '표본 없음'; });
  const solid = scored.filter(function (x) { return thin.indexOf(x) < 0; });

  // 축별로 점수 높은 순으로 줄을 세우고, 라운드마다 축 하나씩 돌아가며 뽑는다.
  //   → 1번은 각 축의 가장 센 말, 2번은 그다음 … 한 축이 화면을 다 차지하지 않는다.
  const roundTables = {};
  BLOG_SEO_AXIS_ORDER_.forEach(function (a) {
    roundTables[a] = solid.filter(function (x) { return x.axis === a; })
      .sort(function (p, q) { return q.score - p.score; });
  });
  const taken = {};
  const picked = [];
  for (let round = 0; round < BLOG_SEO_COUNT_ && picked.length < BLOG_SEO_COUNT_; round++) {
    const line = [];
    BLOG_SEO_AXIS_ORDER_.forEach(function (a) {
      const want = BLOG_SEO_QUOTA_[a] || 0;
      if (round >= want) return;
      const x = roundTables[a][round];
      if (!x) return;
      // 점수가 마이너스인 후보는 그 축의 자리를 비워 두고, 뒤에 전체 점수 순으로 채운다.
      if (x.score < 0) return;
      line.push(x);
    });
    line.sort(function (p, q) { return q.score - p.score; });
    line.forEach(function (x) {
      if (picked.length >= BLOG_SEO_COUNT_) return;
      if (taken[x.axis + '|' + x.keyword]) return;
      taken[x.axis + '|' + x.keyword] = true;
      x.slot = (roundTables[x.axis].indexOf(x));
      picked.push(x);
    });
  }
  // 남는 자리는 전체 점수 순(축 상한 = 배분+1)으로 채운다.
  const restAll = solid.filter(function (x) { return !taken[x.axis + '|' + x.keyword]; })
    .sort(function (p, q) { return q.score - p.score; });
  const axisCount = {};
  picked.forEach(function (x) { axisCount[x.axis] = (axisCount[x.axis] || 0) + 1; });
  restAll.forEach(function (x) {
    if (picked.length >= BLOG_SEO_COUNT_) return;
    const cap = (BLOG_SEO_QUOTA_[x.axis] || 0) + 1;
    if ((axisCount[x.axis] || 0) >= cap) return;
    x.slot = roundTables[x.axis].indexOf(x);
    axisCount[x.axis] = (axisCount[x.axis] || 0) + 1;
    picked.push(x);
  });
  // 그래도 모자라면 표본 적음 후보로 채우되, 화면·근거에 '표본 적음'이라고 적는다.
  if (picked.length < BLOG_SEO_COUNT_) {
    thin.sort(function (p, q) { return q.score - p.score; });
    const axisThin = {};
    picked.forEach(function (x) { axisThin[x.axis] = (axisThin[x.axis] || 0) + 1; });
    thin.forEach(function (x) {
      if (picked.length >= BLOG_SEO_COUNT_) return;
      const cap = (BLOG_SEO_QUOTA_[x.axis] || 0) + 1;
      if ((axisThin[x.axis] || 0) >= cap) return;
      x.slot = 0;
      axisThin[x.axis] = (axisThin[x.axis] || 0) + 1;
      picked.push(x);
    });
    // 축 상한 때문에 모자라면 그때는 상한을 풀고 채운다(빈 줄보다 낫다).
    thin.forEach(function (x) {
      if (picked.length >= BLOG_SEO_COUNT_) return;
      if (picked.indexOf(x) >= 0) return;
      x.slot = 0;
      picked.push(x);
    });
  }

  // 화면은 센 것부터 — 뽑는 순서(축 돌아가며)와 보여 주는 순서(점수)를 나눈다.
  picked.sort(function (p, q) { return q.score - p.score; });

  // 제목 붙이기 — 같은 제목이 최근에 나왔으면 다음 각도로 넘긴다.
  const madeTitles = [];
  const usedTemplates = {};
  const rows = picked.map(function (x, idx) {
    const title = blogSeoTitle_(x.axis, x.keyword, day, madeTitles, x.slot || 0, usedTemplates);
    madeTitles.push(title);
    const t = x.trend || {};
    const bits = [];
    if (t.delta_pct != null && Number.isFinite(Number(t.delta_pct))) {
      const d = Number(t.delta_pct);
      bits.push('최근 4주 ' + (d > 0 ? '+' : d < 0 ? '−' : '') + Math.round(Math.abs(d)) + '%');
    } else if (x.trend_state === '표본 적음' || x.trend_state === '표본 없음') {
      bits.push(x.trend_state);
    }
    if (x.my_rank) bits.push('내 ' + x.my_rank + '위');
    if (x.doc_total != null) bits.push('문서 ' + blogSeoDocLabel_(x.doc_total));
    if (x.inflow) bits.push('유입 "' + x.inflow + '"');
    return {
      day: day,
      rank: idx + 1,
      axis: x.axis,
      axis_label: (BLOG_SEO_AXES_[x.axis] || {}).label || x.axis,
      keyword: x.keyword,
      title: title,
      trend_pct: t.delta_pct == null ? '' : Number(t.delta_pct),
      trend_state: x.trend_state,
      season: t.season || '',
      peak: t.peak == null ? '' : Number(t.peak),
      sample: x.trend_state === '표본 적음' || x.trend_state === '표본 없음' ? 'thin' : 'ok',
      my_rank: x.my_rank || '',
      inflow: x.inflow || '',
      doc_total: x.doc_total == null ? '' : x.doc_total,
      score: Math.round(x.score),
      reason: bits.join(' · '),
      generated_at: formatKstIso_(new Date()),
      source: 'rule'
    };
  });

  return { rows: rows, fallback: rows.length ? '' : '오늘은 조건에 맞는 키워드를 찾지 못했습니다.' };
}

function blogSeoDocLabel_(n) {
  const v = Number(n) || 0;
  if (v >= 10000) return Math.round(v / 10000) + '만';
  return String(v);
}

/** 키워드 → 제목. 날짜·키워드 해시로 각도를 돌리고, 최근에 쓴 제목은 건너뛴다. */
function blogSeoTitle_(axis, keyword, day, avoid, slot, usedTemplates) {
  const spec = BLOG_SEO_AXES_[axis] || BLOG_SEO_AXES_.food;
  const list = spec.titles || ['{kw} 정리'];
  const year = String(day).slice(0, 4);
  const used = usedTemplates || {};
  used[axis] = used[axis] || [];
  // 같은 축에서 두 번째·세 번째 줄은 **아직 안 쓴 각도**로 쓴다(같은 날 같은 문형이 반복되지 않게).
  const start = (blogSeoHash_(String(day) + '|' + keyword) + (Number(slot) || 0)) % list.length;
  for (let i = 0; i < list.length; i++) {
    const at = (start + i) % list.length;
    let t = list[at].replace(/\{kw\}/g, keyword).replace(/\{year\}/g, year);
    if (t.length > BLOG_SEO_TITLE_MAX_) t = t.slice(0, BLOG_SEO_TITLE_MAX_);
    if ((avoid || []).indexOf(t) >= 0) continue;
    if (used[axis].indexOf(at) >= 0) continue;
    used[axis].push(at);
    return t;
  }
  // 각도를 다 썼으면 제목이 겹치지 않는 쪽을 쓴다.
  for (let i = 0; i < list.length; i++) {
    const t = list[(start + i) % list.length].replace(/\{kw\}/g, keyword).replace(/\{year\}/g, year);
    if ((avoid || []).indexOf(t) < 0) return t;
  }
  return list[start].replace(/\{kw\}/g, keyword).replace(/\{year\}/g, year);
}

/* ------------------------------------------------------------------ *
 * ⑦ 응답 모양 — 화면·브리핑이 같이 읽는 한 벌
 * ------------------------------------------------------------------ */

function blogSeoSkeletons_() {
  const out = {};
  BLOG_SEO_AXIS_ORDER_.forEach(function (a) {
    out[a] = { label: BLOG_SEO_AXES_[a].label, skeleton: BLOG_SEO_AXES_[a].skeleton };
  });
  return out;
}

function blogSeoOut_(day, rows, cached, extra) {
  const e = extra || {};
  const clean = rows.map(function (r) {
    return {
      rank: Number(r.rank) || 0,
      axis: String(r.axis || ''),
      axis_label: String(r.axis_label || ''),
      keyword: String(r.keyword || ''),
      title: String(r.title || ''),
      trend_pct: r.trend_pct === '' || r.trend_pct == null ? null : Number(r.trend_pct),
      trend_state: String(r.trend_state || ''),
      season: String(r.season || ''),
      sample: String(r.sample || ''),
      my_rank: r.my_rank === '' || r.my_rank == null ? null : Number(r.my_rank),
      inflow: String(r.inflow || ''),
      doc_total: r.doc_total === '' || r.doc_total == null ? null : Number(r.doc_total),
      score: r.score === '' || r.score == null ? null : Number(r.score),
      reason: String(r.reason || ''),
      generated_at: String(r.generated_at || '')
    };
  });
  return {
    day: day,
    count: clean.length,
    rows: clean,
    axes: blogSeoSkeletons_(),
    pattern: e.pattern || null,
    fallback: e.fallback || '',
    trend_failed: e.trend_failed || [],
    cached: !!cached,
    note: '숫자는 절대 검색량이 아니라 그 키워드 안에서의 상대지수(최고=100)입니다. '
      + '그래서 키워드끼리 크기를 비교하지 않고, 오르는지·성수기인지만 봅니다. 제목은 각도 제안이고 발행은 사람이 합니다.'
  };
}

/* ------------------------------------------------------------------ *
 * ⑧ 액션
 * ------------------------------------------------------------------ */

function handleBlogSeoTitles_(ss, payload, ctx) {
  const brand = (payload && payload.brand) || (ctx && ctx.brand) || 'daejeon_youth';
  if (brand !== 'daejeon_youth') {
    return { day: kstDay_(new Date()), count: 0, rows: [], axes: blogSeoSkeletons_(),
      pattern: null, fallback: '삐약 김메리 트랙은 블로그를 쓰지 않아요.', trend_failed: [], cached: false,
      note: '블로그는 대전 청년 트랙에서만 씁니다.' };
  }
  const day = kstDay_(new Date());
  const refresh = !!(payload && payload.refresh === true);
  const stored = blogSeoRowsOfDay_(ss, day);
  const mine = blogSeoMine_(ss, brand);
  if (stored.length && !refresh) {
    return blogSeoOut_(day, stored, true, { pattern: mine.pattern });
  }

  const candidates = blogSeoCandidates_(day);
  const trend = blogSeoTrendOf_(ss, candidates, brand);
  const docs = blogSeoDocsOf_(candidates);
  const picked = blogSeoPick_({
    day: day, candidates: candidates, trend: trend.byKeyword, docs: docs, mine: mine
  });

  // 데이터랩이 통째로 실패했어도 내 실적만으로 만든 줄은 남긴다(비어 있는 것보다 낫다).
  if (picked.rows.length) blogSeoSave_(ss, day, picked.rows);
  return blogSeoOut_(day, picked.rows, false, {
    pattern: mine.pattern,
    fallback: picked.fallback || (trend.failed.length ? '데이터랩 조회가 막혀 순위·유입만으로 골랐습니다.' : ''),
    trend_failed: trend.failed
  });
}

/* ------------------------------------------------------------------ *
 * ⑨ 매일 아침 (설치 함수 — 등록은 승인 뒤에 한다)
 * ------------------------------------------------------------------ */

/** 매일 08:30(KST) — 브리핑(09:00)보다 30분 먼저 만들어 시트에 남긴다. */
function blogSeoTitlesDaily() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    const out = handleBlogSeoTitles_(ss, { brand: 'daejeon_youth', refresh: true }, { brand: 'daejeon_youth' });
    Logger.log('blog_seo_titles ' + out.day + ' · ' + out.count + '줄'
      + (out.trend_failed.length ? ' · 데이터랩 실패 ' + out.trend_failed.length : ''));
    return out;
  } catch (err) {
    Logger.log('blog_seo_titles 실패: ' + ((err && err.message) || err));
    throw err;
  }
}

/** 편집기에서 한 번 실행하면 매일 08:30 트리거가 붙는다(이미 있으면 그대로 둔다). */
function installBlogSeoTitlesTrigger() {
  const fn = 'blogSeoTitlesDaily';
  const has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === fn; });
  if (has) return { installed: false, note: '이미 08:30 트리거가 있습니다.' };
  ScriptApp.newTrigger(fn).timeBased().atHour(8).nearMinute(30).everyDays(1).inTimezone('Asia/Seoul').create();
  return { installed: true, note: '매일 08:30(KST) blogSeoTitlesDaily' };
}
