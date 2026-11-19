/**
 * gas/Blog.gs — 내 네이버 블로그를 콘텐츠 허브 안에서 보기 (2026-11-19)
 *
 * 네이버 블로그는 '블로그 통계'를 바깥에 여는 공식 API가 없다. 대신 로그인 없이 누구나 볼 수 있는
 * 공개 데이터만 모은다 — 쿠키·비밀번호는 쓰지 않는다(CLAUDE.md §4).
 *
 *   ① blog_sync        : 글 목록(제목·카테고리·발행일·댓글·공감·사진 수) + 최근 5일 방문자 수 → 시트 누적
 *   ② list_blog_stats  : 시트에 쌓인 것 → 화면용 묶음(글별 7일 증가분 · 방문자 추이 · 키워드 순위)
 *   ③ blog_post_body   : 발행된 글 1개 본문을 줄글로 바꿔 돌려준다 → 화면이 린터(8항목)로 채점
 *   ④ blog_rank_check  : 네이버 검색 오픈API(블로그 검색)로 키워드별 내 글 순위(상위 100) → Rank_Log
 *
 * 쓰는 공개 주소(모두 GET, 로그인 불필요)
 *   · m.blog.naver.com/api/blogs/{id}/post-list   글 목록 + commentCnt · sympathyCnt · thumbnailCount
 *   · blog.naver.com/NVisitorgp4Ajax.naver        최근 5일 방문자 수(XML)
 *   · m.blog.naver.com/PostView.naver             글 본문(스마트에디터 ONE HTML)
 * 조회수(글별)·유입 경로·검색어는 로그인한 본인만 보는 통계라 여기서 못 가져온다 → #/perf 수동 입력 유지.
 *
 * 방문자 수는 네이버가 '최근 5일'만 준다. 하루 한 번 blogDailySync() 트리거가 돌면 시트에 계속 쌓인다
 * (편집기에서 installBlogDailyTrigger() 1회 실행).
 *
 * 비밀: 검색 오픈API 키는 스크립트 속성 NAVER_CLIENT_ID · NAVER_CLIENT_SECRET 에만 둔다(저장소·시트 금지).
 */

/** 브랜드 → 블로그 아이디. 김메리 트랙은 블로그를 쓰지 않는다(SKIPPED, 2026-11-16 확정). */
const BLOG_IDS_ = { daejeon_youth: 'youth-daejeon' };

const BLOG_SHEETS_ = {
  Blog_Posts: [
    'blog_id', 'log_no', 'title', 'url', 'category', 'published_at',
    'comment_cnt', 'sympathy_cnt', 'share_cnt', 'photo_count', 'content_id',
    'first_seen_at', 'synced_at'
  ],
  // 글별 하루 1줄(같은 날 다시 모으면 덮어씀) — 댓글·공감이 언제 늘었는지 보려고 쌓는다.
  Blog_Post_Daily: ['day', 'blog_id', 'log_no', 'comment_cnt', 'sympathy_cnt', 'synced_at'],
  Blog_Visitors: ['blog_id', 'day', 'visitors', 'synced_at']
};

const BLOG_UA_ = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36';
const BLOG_MAX_PAGES_ = 10;          // 30개 × 10쪽 = 최근 300개까지
const BLOG_RANK_MAX_KEYWORDS_ = 10;  // 한 번에 확인하는 키워드 수(오픈API 일 25,000회 한도에 한참 못 미침)
const BLOG_RANK_DEPTH_ = 100;        // 상위 100위 안에서만 찾는다

/* ------------------------------------------------------------------ *
 * 공용
 * ------------------------------------------------------------------ */

function blogIdFor_(brand) {
  const b = String(brand || 'daejeon_youth');
  const props = PropertiesService.getScriptProperties();
  const override = props.getProperty('NAVER_BLOG_ID_' + b);
  const id = String(override || BLOG_IDS_[b] || '').trim();
  if (!id) {
    throw createAppError_('ERR_BLOG_SKIPPED',
      '이 브랜드는 블로그를 쓰지 않습니다(삐약 김메리는 쇼츠·릴스·클립만).');
  }
  if (!/^[A-Za-z0-9_-]{3,40}$/.test(id)) {
    throw createAppError_('ERR_SERVER_CONFIG', '블로그 아이디 형식이 이상합니다: NAVER_BLOG_ID_' + b);
  }
  return id;
}

function blogFetch_(url, headers) {
  let res;
  try {
    res = UrlFetchApp.fetch(url, {
      method: 'get',
      muteHttpExceptions: true,
      followRedirects: true,
      headers: Object.assign({ 'User-Agent': BLOG_UA_ }, headers || {})
    });
  } catch (err) {
    throw createAppError_('ERR_BLOG_UNREACHABLE',
      '네이버 블로그에 연결하지 못했습니다. 잠시 뒤 다시 눌러 주세요.',
      { detail: sanitizeErrorDetail_(String(err && err.message || err)) });
  }
  const code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw createAppError_('ERR_BLOG_UNREACHABLE',
      '네이버가 응답하지 않았습니다(HTTP ' + code + '). 잠시 뒤 다시 눌러 주세요.', { http: code });
  }
  return res.getContentText();
}

function blogSheet_(ss, name) {
  let sheet = ss.getSheetByName(name);
  const headers = BLOG_SHEETS_[name];
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers])
      .setBackground('#0F172A').setFontColor('#F8FAFC').setFontWeight('bold');
    sheet.setFrozenRows(1);
    return sheet;
  }
  ensureSheetColumns_(ss, name, headers);
  return sheet;
}

function kstDay_(d) { return Utilities.formatDate(d, 'Asia/Seoul', 'yyyy-MM-dd'); }

function decodeEntities_(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, function (_, h) { return String.fromCodePoint(parseInt(h, 16)); })
    .replace(/&#(\d+);/g, function (_, d) { return String.fromCodePoint(parseInt(d, 10)); })
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

function stripTags_(s) {
  return decodeEntities_(String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''))
    .replace(/[​﻿]/g, '');
}

/* ------------------------------------------------------------------ *
 * 파서 (네트워크 없이 시험 가능)
 * ------------------------------------------------------------------ */

/** post-list JSON → 글 배열. 형식이 바뀌었으면 빈 배열 대신 오류(조용히 0건으로 보이지 않게). */
function parseBlogPostList_(text, blogId) {
  let j;
  try { j = JSON.parse(text); } catch (e) {
    throw createAppError_('ERR_BLOG_FORMAT', '네이버 글 목록 형식이 바뀐 것 같습니다(JSON 아님).');
  }
  if (!j || j.isSuccess === false || !j.result || !Array.isArray(j.result.items)) {
    throw createAppError_('ERR_BLOG_FORMAT', '네이버 글 목록 형식이 바뀐 것 같습니다(items 없음).');
  }
  return j.result.items.map(function (it) {
    const logNo = String(it.logNo || it.logNoObject || '');
    const added = Number(it.addDate);
    return {
      log_no: logNo,
      title: decodeEntities_(it.titleWithInspectMessage || it.title || ''),
      url: 'https://blog.naver.com/' + blogId + '/' + logNo,
      category: decodeEntities_(it.categoryName || ''),
      published_at: Number.isFinite(added) && added > 0 ? formatKstIso_(new Date(added)) : '',
      comment_cnt: Number(it.commentCnt) || 0,
      sympathy_cnt: Number(it.sympathyCnt) || 0,
      share_cnt: Number(it.shareCnt) || 0,
      photo_count: Number(it.thumbnailCount != null ? it.thumbnailCount
        : (it.thumbnailList ? it.thumbnailList.length : 0)) || 0,
      open: it.notOpen !== true && it.allOpenPost !== false
    };
  }).filter(function (p) { return /^\d{6,}$/.test(p.log_no); });
}

/** NVisitorgp4Ajax XML → [{day:'YYYY-MM-DD', visitors:n}] */
function parseBlogVisitors_(xml) {
  const out = [];
  const re = /<visitorcnt\s+id="(\d{8})"\s+cnt="(\d+)"/g;
  let m;
  while ((m = re.exec(String(xml || '')))) {
    out.push({ day: m[1].slice(0, 4) + '-' + m[1].slice(4, 6) + '-' + m[1].slice(6, 8), visitors: Number(m[2]) });
  }
  return out;
}

/**
 * 스마트에디터 ONE 본문 HTML → 린터 입력({title, body, photoCount, ...}).
 *  · 글 문단(se-text-paragraph) 1개 = 한 줄
 *  · 사진은 `![사진](n)` 한 줄(린터가 장수를 센다)
 *  · 링크 카드(oglink)는 `[LINK_CARD: url]` 한 줄 — 카드 제목 속 해시태그가 본문으로 새지 않게
 *  · 지도(placesMap)는 이름·주소 한 줄(첫 화면 정보 판정에 쓰임)
 */
function parseBlogPostBody_(html) {
  const src = String(html || '');
  const start = src.indexOf('se-main-container');
  if (start < 0) {
    throw createAppError_('ERR_BLOG_FORMAT',
      '본문을 찾지 못했습니다. 예전 에디터(스마트에디터 2) 글이거나 비공개 글일 수 있습니다.');
  }
  let main = src.slice(start);
  // 본문 안에도 데이터용 <script class="__se_module_data"> 가 끼어 있다 → 그건 건너뛰고 진짜 스크립트·꼬리에서 자른다
  const cut = main.search(/<script\b(?![^>]*__se_module_data)|class="post_footer|class="post_tag|id="printPost|class="_checkVisible"|id="blog_fe_feed"/);
  if (cut > 0) main = main.slice(0, cut);

  const og = src.match(/property="og:title"\s+content="([^"]*)"/);
  let title = og ? decodeEntities_(og[1]).trim() : '';

  const parts = main.split(/<div class="se-component se-/).slice(1);
  const lines = [];
  let photos = 0, videos = 0, linkCards = 0;

  parts.forEach(function (chunk) {
    const kind = (chunk.match(/^([A-Za-z]+)/) || [])[1] || '';
    if (kind === 'documentTitle') {
      const t = stripTags_((chunk.match(/<p class="se-text-paragraph[^>]*>([\s\S]*?)<\/p>/) || [])[1] || '').trim();
      if (t) title = t;
      return;
    }
    if (kind === 'image' || kind === 'imageGroup' || kind === 'imageStrip' || kind === 'sticker') {
      if (kind === 'sticker') return;
      const n = Math.max(1, (chunk.match(/se-image-resource/g) || []).length);
      for (let i = 0; i < n; i++) { photos++; lines.push('![사진](' + photos + ')'); }
      // 사진 설명(캡션)도 글로 친다
      captionLines_(chunk).forEach(function (l) { lines.push(l); });
      return;
    }
    if (kind === 'video' || kind === 'oembed') { videos++; return; }
    if (kind === 'oglink') {
      const href = (chunk.match(/href="(https?:\/\/[^"]+)"/) || [])[1];
      if (href) { linkCards++; lines.push('[LINK_CARD: ' + decodeEntities_(href) + ']'); }
      return;
    }
    if (kind === 'placesMap' || kind === 'map') {
      const name = stripTags_((chunk.match(/class="se-map-title">([\s\S]*?)<\//) || [])[1] || '').trim();
      const addr = stripTags_((chunk.match(/class="se-map-address">([\s\S]*?)<\//) || [])[1] || '').trim();
      const line = [name, addr].filter(Boolean).join(' · ');
      if (line) lines.push(line);
      return;
    }
    if (kind === 'horizontalLine') return;
    // text · quotation · sectionTitle · table 등 글이 들어 있는 것
    const re = /<p class="se-text-paragraph[^>]*>([\s\S]*?)<\/p>/g;
    let m;
    while ((m = re.exec(chunk))) {
      stripTags_(m[1]).split('\n').forEach(function (l) {
        const t = l.replace(/\s+/g, ' ').trim();
        if (t) lines.push(t);
      });
    }
  });

  const body = lines.join('\n');
  return {
    title: title,
    body: body,
    photo_count: photos,
    video_count: videos,
    link_cards: linkCards,
    char_count: lines.filter(function (l) { return !/^!\[|^\[LINK_CARD:/.test(l); })
      .join('').replace(/\s/g, '').length
  };
}

function captionLines_(chunk) {
  const out = [];
  const re = /class="se-caption[\s\S]*?<p class="se-text-paragraph[^>]*>([\s\S]*?)<\/p>/g;
  let m;
  while ((m = re.exec(chunk))) {
    const t = stripTags_(m[1]).replace(/\s+/g, ' ').trim();
    if (t) out.push(t);
  }
  return out;
}

/** 검색 오픈API 응답 → 내 블로그 첫 등장 순위(없으면 0) */
function findBlogRank_(items, blogId, offset) {
  const needle = 'blog.naver.com/' + String(blogId).toLowerCase() + '/';
  for (let i = 0; i < (items || []).length; i++) {
    const link = String(items[i].link || '').toLowerCase();
    if (link.indexOf(needle) >= 0) {
      const logNo = (link.split(needle)[1] || '').replace(/[^0-9].*$/, '');
      return { rank: (offset || 0) + i + 1, log_no: logNo, title: stripTags_(items[i].title || '') };
    }
  }
  return { rank: 0, log_no: '', title: '' };
}

/* ------------------------------------------------------------------ *
 * ① blog_sync
 * ------------------------------------------------------------------ */

function fetchBlogPosts_(blogId) {
  const all = [];
  for (let page = 1; page <= BLOG_MAX_PAGES_; page++) {
    const url = 'https://m.blog.naver.com/api/blogs/' + encodeURIComponent(blogId)
      + '/post-list?categoryNo=0&itemCount=30&page=' + page;
    const items = parseBlogPostList_(blogFetch_(url, { Referer: 'https://m.blog.naver.com/' + blogId }), blogId);
    items.forEach(function (p) { all.push(p); });
    if (items.length < 30) break;
  }
  return all;
}

function fetchBlogVisitors_(blogId) {
  const url = 'https://blog.naver.com/NVisitorgp4Ajax.naver?blogId=' + encodeURIComponent(blogId);
  try {
    return parseBlogVisitors_(blogFetch_(url, { Referer: 'https://blog.naver.com/' + blogId }));
  } catch (err) {
    return [];   // 방문자 수가 안 와도 글 목록은 저장한다
  }
}

/** 시트 한 장을 key 기준으로 덮어쓰기/추가. rows 는 객체 배열, keyFn 은 객체 → 키 문자열. */
function upsertRows_(sheet, rows, keyFn) {
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  const lastRow = sheet.getLastRow();
  const existing = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];
  const index = {};
  existing.forEach(function (vals, i) {
    const obj = {};
    headers.forEach(function (h, c) { obj[h] = vals[c]; });
    index[keyFn(obj)] = i;
  });
  const appended = [];
  let updated = 0;
  rows.forEach(function (r) {
    const k = keyFn(r);
    if (Object.prototype.hasOwnProperty.call(index, k)) {
      const i = index[k];
      headers.forEach(function (h, c) {
        if (Object.prototype.hasOwnProperty.call(r, h)) existing[i][c] = r[h];
      });
      updated++;
    } else {
      appended.push(headers.map(function (h) { return Object.prototype.hasOwnProperty.call(r, h) ? r[h] : ''; }));
      index[k] = -1;
    }
  });
  if (existing.length && updated) sheet.getRange(2, 1, existing.length, lastCol).setValues(existing);
  if (appended.length) sheet.getRange(lastRow + 1, 1, appended.length, lastCol).setValues(appended);
  return { updated: updated, added: appended.length };
}

function syncBlog_(ss, brand) {
  const blogId = blogIdFor_(brand);
  const posts = fetchBlogPosts_(blogId);          // 네트워크는 락 밖에서
  const visitors = fetchBlogVisitors_(blogId);
  const now = new Date();
  const stamp = formatKstIso_(now);
  const today = kstDay_(now);

  return withWriteLock_(function () {
    // 콘텐츠 카드와 연결 — blog_url 에 글 번호가 들어 있으면 같은 글
    const contents = readSheetAsObjects_(ss, 'Contents');
    const byLogNo = {};
    contents.forEach(function (c) {
      const m = String(c.blog_url || '').match(/(\d{9,})/);
      if (m) byLogNo[m[1]] = String(c.content_id || '');
    });

    const postSheet = blogSheet_(ss, 'Blog_Posts');
    const known = {};
    readSheetAsObjects_(ss, 'Blog_Posts').forEach(function (r) {
      if (String(r.blog_id) === blogId) known[String(r.log_no)] = r;
    });
    let newPosts = 0;
    const postRows = posts.map(function (p) {
      const prev = known[p.log_no];
      if (!prev) newPosts++;
      return {
        blog_id: blogId, log_no: p.log_no, title: p.title, url: p.url, category: p.category,
        published_at: p.published_at, comment_cnt: p.comment_cnt, sympathy_cnt: p.sympathy_cnt,
        share_cnt: p.share_cnt, photo_count: p.photo_count,
        content_id: byLogNo[p.log_no] || (prev ? String(prev.content_id || '') : ''),
        first_seen_at: prev && prev.first_seen_at ? prev.first_seen_at : stamp,
        synced_at: stamp
      };
    });
    upsertRows_(postSheet, postRows, function (r) { return String(r.blog_id) + '|' + String(r.log_no); });

    upsertRows_(blogSheet_(ss, 'Blog_Post_Daily'), posts.map(function (p) {
      return { day: today, blog_id: blogId, log_no: p.log_no,
               comment_cnt: p.comment_cnt, sympathy_cnt: p.sympathy_cnt, synced_at: stamp };
    }), function (r) { return dayKey_(r.day) + '|' + String(r.blog_id) + '|' + String(r.log_no); });

    upsertRows_(blogSheet_(ss, 'Blog_Visitors'), visitors.map(function (v) {
      return { blog_id: blogId, day: v.day, visitors: v.visitors, synced_at: stamp };
    }), function (r) { return String(r.blog_id) + '|' + dayKey_(r.day); });

    PropertiesService.getScriptProperties().setProperty('BLOG_LAST_SYNC_' + blogId, stamp);
    return {
      blog_id: blogId,
      posts: posts.length,
      new_posts: newPosts,
      linked_cards: postRows.filter(function (r) { return r.content_id; }).length,
      visitor_days: visitors.length,
      synced_at: stamp
    };
  });
}

/** 시트가 날짜 문자열을 Date 로 바꿔 돌려줄 때도 같은 키가 나오게 */
function dayKey_(v) {
  if (v instanceof Date) return kstDay_(v);
  return String(v || '').slice(0, 10);
}

function handleBlogSync_(ss, payload, ctx) {
  return syncBlog_(ss, payload.brand || ctx.brand || 'daejeon_youth');
}

/** 매일 1회 트리거용 — 방문자 수(최근 5일만 제공)를 놓치지 않게 쌓는다. */
function blogDailySync() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(BLOG_IDS_).forEach(function (brand) {
    try { syncBlog_(ss, brand); } catch (err) { Logger.log('blogDailySync ' + brand + ': ' + err.message); }
  });
}

/** 편집기에서 한 번 실행: 매일 밤 11시(한국) 자동 수집. 이미 있으면 그대로 둔다. */
function installBlogDailyTrigger() {
  const exists = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'blogDailySync';
  });
  if (!exists) {
    ScriptApp.newTrigger('blogDailySync').timeBased().everyDays(1).atHour(23)
      .inTimezone('Asia/Seoul').create();
  }
  return exists ? '이미 설치돼 있음' : '설치함: 매일 23시 blogDailySync';
}

/* ------------------------------------------------------------------ *
 * ② list_blog_stats
 * ------------------------------------------------------------------ */

function handleListBlogStats_(ss, payload, ctx) {
  const brand = payload.brand || ctx.brand || 'daejeon_youth';
  const blogId = blogIdFor_(brand);
  const days = Math.min(Math.max(Number(payload.days || 60), 7), 365);
  const today = kstDay_(new Date());
  const from = kstDay_(new Date(Date.now() - (days - 1) * 86400000));
  const weekAgo = kstDay_(new Date(Date.now() - 7 * 86400000));

  const posts = readSheetAsObjects_(ss, 'Blog_Posts')
    .filter(function (r) { return String(r.blog_id) === blogId; });

  // 7일 전(또는 그 이후 가장 이른 날) 기록과 비교해 증가분을 낸다
  const base = {};
  readSheetAsObjects_(ss, 'Blog_Post_Daily').forEach(function (r) {
    if (String(r.blog_id) !== blogId) return;
    const d = dayKey_(r.day);
    if (d < weekAgo) return;
    const k = String(r.log_no);
    if (!base[k] || d < base[k].day) {
      base[k] = { day: d, comment_cnt: Number(r.comment_cnt) || 0, sympathy_cnt: Number(r.sympathy_cnt) || 0 };
    }
  });

  const visitors = readSheetAsObjects_(ss, 'Blog_Visitors')
    .filter(function (r) { return String(r.blog_id) === blogId; })
    .map(function (r) { return { day: dayKey_(r.day), visitors: Number(r.visitors) || 0 }; })
    .filter(function (r) { return r.day >= from && r.day <= today; })
    .sort(function (a, b) { return a.day < b.day ? -1 : 1; });

  // 키워드 순위: 키워드마다 최근 기록 1개 + 바로 앞 기록(변화 표시용)
  const rankBy = {};
  readSheetAsObjects_(ss, 'Rank_Log').forEach(function (r) {
    if (String(r.surface) !== 'naver_blog_search' || String(r.brand) !== brand) return;
    const k = String(r.keyword || '');
    if (!k) return;
    (rankBy[k] = rankBy[k] || []).push({
      rank: Number(r.rank_pos) || 0, log_no: String(r.note || '').replace(/[^0-9]/g, ''),
      checked_at: r.checked_at instanceof Date ? formatKstIso_(r.checked_at) : String(r.checked_at || '')
    });
  });
  const ranks = Object.keys(rankBy).map(function (k) {
    const list = rankBy[k].sort(function (a, b) { return a.checked_at < b.checked_at ? 1 : -1; });
    return { keyword: k, rank: list[0].rank, log_no: list[0].log_no, checked_at: list[0].checked_at,
             prev_rank: list[1] ? list[1].rank : null };
  }).sort(function (a, b) { return (a.rank || 999) - (b.rank || 999); });

  // 화면이 키워드를 고를 수 있게, 블로그를 올린 카드의 목표 키워드를 같이 준다
  const keywordHints = [];
  readSheetAsObjects_(ss, 'Contents').forEach(function (c) {
    if (String(c.brand) !== brand) return;
    String(c.target_keywords || '').split(/[,\n]/).forEach(function (k) {
      const t = k.trim();
      if (t && keywordHints.indexOf(t) < 0) keywordHints.push(t);
    });
  });

  const props = PropertiesService.getScriptProperties();
  return {
    blog_id: blogId,
    last_synced_at: props.getProperty('BLOG_LAST_SYNC_' + blogId) || '',
    search_api_ready: !!(props.getProperty('NAVER_CLIENT_ID') && props.getProperty('NAVER_CLIENT_SECRET')),
    posts: posts.map(function (r) {
      const k = String(r.log_no);
      const b = base[k];
      const c = Number(r.comment_cnt) || 0, s = Number(r.sympathy_cnt) || 0;
      return {
        log_no: k, title: String(r.title || ''), url: String(r.url || ''), category: String(r.category || ''),
        published_at: r.published_at instanceof Date ? formatKstIso_(r.published_at) : String(r.published_at || ''),
        comment_cnt: c, sympathy_cnt: s, share_cnt: Number(r.share_cnt) || 0,
        photo_count: Number(r.photo_count) || 0, content_id: String(r.content_id || ''),
        comment_7d: b ? c - b.comment_cnt : null, sympathy_7d: b ? s - b.sympathy_cnt : null,
        since_day: b ? b.day : null
      };
    }).sort(function (a, b) { return a.published_at < b.published_at ? 1 : -1; }),
    visitors: visitors,
    ranks: ranks,
    keyword_hints: keywordHints.slice(0, 30)
  };
}

/* ------------------------------------------------------------------ *
 * ③ blog_post_body
 * ------------------------------------------------------------------ */

function handleBlogPostBody_(ss, payload, ctx) {
  const blogId = blogIdFor_(payload.brand || ctx.brand || 'daejeon_youth');
  const logNo = String(payload.log_no || '').trim();
  if (!/^\d{6,20}$/.test(logNo)) throw createAppError_('ERR_VALIDATION_FAILED', '글 번호(log_no)가 숫자가 아닙니다.');
  const url = 'https://m.blog.naver.com/PostView.naver?blogId=' + encodeURIComponent(blogId) + '&logNo=' + logNo;
  const parsed = parseBlogPostBody_(blogFetch_(url, { Referer: 'https://m.blog.naver.com/' + blogId }));
  parsed.log_no = logNo;
  parsed.url = 'https://blog.naver.com/' + blogId + '/' + logNo;
  return parsed;
}

/* ------------------------------------------------------------------ *
 * ④ blog_rank_check — 네이버 검색 오픈API(블로그)
 * ------------------------------------------------------------------ */

function handleBlogRankCheck_(ss, payload, ctx) {
  const brand = payload.brand || ctx.brand || 'daejeon_youth';
  const blogId = blogIdFor_(brand);
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('NAVER_CLIENT_ID');
  const secret = props.getProperty('NAVER_CLIENT_SECRET');
  if (!id || !secret) {
    throw createAppError_('ERR_NO_NAVER_KEY',
      '검색 순위를 보려면 네이버 개발자센터에서 \'검색\' API 키를 받아 Apps Script 스크립트 속성에 '
      + 'NAVER_CLIENT_ID · NAVER_CLIENT_SECRET 으로 넣어 주세요(무료, 하루 25,000회).');
  }
  const raw = Array.isArray(payload.keywords) ? payload.keywords : String(payload.keywords || '').split(/[,\n]/);
  const keywords = [];
  raw.forEach(function (k) {
    const t = String(k || '').trim().slice(0, 40);
    if (t && keywords.indexOf(t) < 0) keywords.push(t);
  });
  if (!keywords.length) throw createAppError_('ERR_VALIDATION_FAILED', '확인할 키워드를 하나 이상 적어 주세요.');
  if (keywords.length > BLOG_RANK_MAX_KEYWORDS_) keywords.length = BLOG_RANK_MAX_KEYWORDS_;

  const results = keywords.map(function (kw) {
    const url = 'https://openapi.naver.com/v1/search/blog.json?query=' + encodeURIComponent(kw)
      + '&display=' + BLOG_RANK_DEPTH_ + '&start=1&sort=sim';
    let res;
    try {
      res = UrlFetchApp.fetch(url, {
        method: 'get', muteHttpExceptions: true,
        headers: { 'X-Naver-Client-Id': id, 'X-Naver-Client-Secret': secret }
      });
    } catch (err) {
      return { keyword: kw, rank: null, error: '연결 실패' };
    }
    const code = res.getResponseCode();
    if (code === 401 || code === 403) {
      throw createAppError_('ERR_NO_NAVER_KEY', '네이버 검색 API 키가 맞지 않거나 \'검색\' API 사용 신청이 안 되어 있습니다(HTTP ' + code + ').');
    }
    if (code !== 200) return { keyword: kw, rank: null, error: 'HTTP ' + code };
    let j;
    try { j = JSON.parse(res.getContentText()); } catch (e) { return { keyword: kw, rank: null, error: '형식 오류' }; }
    const hit = findBlogRank_(j.items, blogId, 0);
    return { keyword: kw, rank: hit.rank, log_no: hit.log_no, title: hit.title, total: Number(j.total) || 0 };
  });

  const stamp = formatKstIso_(new Date());
  withWriteLock_(function () {
    const sheet = ss.getSheetByName('Rank_Log');
    if (!sheet) return;
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    const posts = {};
    readSheetAsObjects_(ss, 'Blog_Posts').forEach(function (p) { posts[String(p.log_no)] = String(p.content_id || ''); });
    const rows = results.filter(function (r) { return r.rank != null; }).map(function (r) {
      const obj = {
        rank_log_id: 'RK-' + Utilities.getUuid().slice(0, 8), brand: brand,
        content_id: r.log_no ? (posts[r.log_no] || '') : '', keyword: r.keyword,
        surface: 'naver_blog_search', rank_pos: r.rank, index_status: r.rank ? 'IN_TOP100' : 'OUT',
        bldex_grade: '', check_method: 'naver_openapi_sim', note: r.log_no || '', checked_at: stamp
      };
      return headers.map(function (h) { return Object.prototype.hasOwnProperty.call(obj, h) ? obj[h] : ''; });
    });
    if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
  });

  return { blog_id: blogId, checked_at: stamp, depth: BLOG_RANK_DEPTH_, results: results };
}
