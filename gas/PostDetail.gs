/**
 * gas/PostDetail.gs — 채널 목록·콘텐츠 상세 드릴다운 (2026-11-19)
 *
 * 화면 #/post 가 읽는다. 시트 한 장(Media_Meta)을 새로 쓰고, 나머지는 이미 있는 시트를 읽기만 한다.
 *   · Media_Meta     — 영상·게시물의 제목·썸네일·발행일·길이(수집기가 종료 때 올린다). 7일 안 갱신은 건너뛴다.
 *   · Analytics_Daily — 유튜브·인스타 시계열(D1/D7/D14/D30/LATEST)          [gas/Analytics.gs 가 쓴다 — 여기서는 읽기만]
 *   · Blog_Post_Views / Blog_Posts / Blog_Keywords / Blog_Inflow            [gas/Blog.gs 가 쓴다 — 읽기만]
 *   · Contents       — 카드의 6개 URL·상태 열로 같은 소재의 트랙 채널을 한 화면에 묶는다.
 *
 * 액션(화이트리스트: gas/Auth.gs, 연결: gas/Code.gs M1_HANDLERS)
 *   get_post_detail   READ   (source, external_id, content_id?) → 시계열·메타·트랙 채널 비교
 *   upsert_media_meta WRITE  (items[]) → Media_Meta 갱신(라우터가 tryLock 을 잡는다)
 *   list_media_meta   READ   (source?, ids[]) → 여러 건 일괄 조회
 *
 * 하지 않는 것: Contents 열 추가 · Setup.gs/Analytics.gs 수정(시트는 첫 올리기 때 스스로 만든다).
 * tools/analytics/lib/ids.js 는 CommonJS 라 가져올 수 없어 같은 정규화 규칙을 아래에 복제했고,
 * gas/test/run.js 가 두 구현을 같은 입력 표로 대조한다.
 */

/** 트랙별 운영 채널 — seeds/track_channels.json 과 같아야 한다(gas/test/run.js 가 deepStrictEqual 로 대조). */
const TRACK_CHANNELS = {
  daejeon_youth: ['blog', 'shorts', 'reels', 'feed', 'clip', 'daangn'],
  ppiyak_kimmary: ['shorts', 'reels', 'clip']
};

const MEDIA_META_SHEET_ = 'Media_Meta';
const MEDIA_META_COLUMNS_ = [
  'meta_key', 'source', 'external_id', 'channel', 'title', 'thumbnail_url',
  'published_at', 'duration_sec', 'updated_at'
];
const MEDIA_META_MAX_ITEMS_ = 500;
const MEDIA_META_LIST_MAX_IDS_ = 200;
const MEDIA_META_STALE_MS_ = 7 * 24 * 3600 * 1000;
const MEDIA_META_SOURCES_ = ['youtube', 'instagram'];
const MEDIA_META_CHANNELS_ = ['shorts', 'longform', 'reels', 'feed'];

const POST_DETAIL_SOURCES_ = ['youtube', 'instagram', 'blog'];
const POST_DETAIL_CHECKPOINTS_ = ['D1', 'D7', 'D14', 'D30', 'LATEST'];
const POST_DETAIL_DAILY_MAX_ = 60;

const POST_CHANNEL_STATUS_COL_ = {
  blog: 'blog_status', shorts: 'shorts_status', reels: 'reels_status',
  feed: 'ig_feed_status', clip: 'clip_status', daangn: 'daangn_status'
};
const POST_CHANNEL_URL_COL_ = {
  blog: 'blog_url', shorts: 'shorts_url', reels: 'reels_url',
  feed: 'ig_feed_url', clip: 'clip_url', daangn: 'daangn_url'
};
/** 지표 API 가 없는 채널 — 비교표에 '게시 완료(지표 없음)' 로 보인다. */
const POST_NO_METRIC_CHANNELS_ = ['clip', 'daangn'];

/* ------------------------------------------------------------------ *
 * ID 정규화 — tools/analytics/lib/ids.js 와 같은 규칙(복제)
 * ------------------------------------------------------------------ */

function postUrlParts_(text) {
  const m = String(text == null ? '' : text).trim().match(/^[A-Za-z][A-Za-z0-9+.-]*:\/\/([^\/?#\s]+)(\/[^?#]*)?(\?[^#]*)?/);
  if (!m) return null;
  return {
    host: m[1].toLowerCase().replace(/:\d+$/, '').replace(/^www\./, ''),
    path: m[2] || '',
    query: m[3] || ''
  };
}

function cleanYoutubeId_(v) {
  const s = String(v == null ? '' : v).trim();
  return /^[A-Za-z0-9_-]{11}$/.test(s) ? s : '';
}

function queryParam_(query, name) {
  const pairs = String(query || '').replace(/^\?/, '').split('&');
  for (let i = 0; i < pairs.length; i++) {
    const at = pairs[i].indexOf('=');
    const k = at < 0 ? pairs[i] : pairs[i].slice(0, at);
    if (k !== name) continue;
    const raw = at < 0 ? '' : pairs[i].slice(at + 1);
    try { return decodeURIComponent(raw); } catch (e) { return raw; }
  }
  return null;
}

/** 유튜브 주소(youtu.be · /shorts · /watch?v= · /embed · /live)나 순수 11자 ID → ID. 못 찾으면 ''. */
function youtubeIdOf_(text) {
  const raw = String(text == null ? '' : text).trim();
  if (!raw) return '';
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;
  const u = postUrlParts_(raw);
  if (!u) return '';
  if (u.host === 'youtu.be') return cleanYoutubeId_(u.path.split('/').filter(Boolean)[0] || '');
  if (u.host !== 'youtube.com' && u.host !== 'm.youtube.com' && u.host !== 'music.youtube.com') return '';
  if (u.path === '/watch') return cleanYoutubeId_(queryParam_(u.query, 'v'));
  const m = u.path.match(/^\/(shorts|embed|live|v)\/([^\/?#]+)/);
  return m ? cleanYoutubeId_(m[2]) : '';
}

/** 인스타 주소 → 'instagram.com/reel/CODE' 형태의 permalink 키(추적값·끝 슬래시 제거). */
function instagramKeyOf_(text) {
  const u = postUrlParts_(text);
  if (!u || !/instagram\.com$/.test(u.host)) return '';
  const m = u.path.match(/^\/(reel|reels|p|tv)\/([^\/?#]+)/);
  if (!m) return '';
  return 'instagram.com/' + (m[1] === 'reels' ? 'reel' : m[1]) + '/' + m[2];
}

/** 인스타 permalink 의 shortcode 만. */
function instagramShortcodeOf_(text) {
  const key = instagramKeyOf_(text);
  return key ? key.split('/')[2] : '';
}

/** 네이버 블로그 주소 → 글 번호(9자리 이상 숫자). logNo= 가 있으면 그것을 먼저 본다. */
function blogLogNoOf_(text) {
  const raw = String(text == null ? '' : text);
  const byParam = raw.match(/[?&]logNo=(\d{9,})/);
  if (byParam) return byParam[1];
  const any = raw.match(/(\d{9,})/);
  return any ? any[1] : '';
}

function postTrackChannels_(brand) {
  const set = TRACK_CHANNELS[String(brand || '')];
  return set ? set.slice() : [];
}

/* ------------------------------------------------------------------ *
 * Media_Meta
 * ------------------------------------------------------------------ */

function ensureMediaMetaSheet_(ss) {
  let sheet = ss.getSheetByName(MEDIA_META_SHEET_);
  if (!sheet) {
    sheet = ss.insertSheet(MEDIA_META_SHEET_);
    sheet.getRange(1, 1, 1, MEDIA_META_COLUMNS_.length)
      .setValues([MEDIA_META_COLUMNS_])
      .setBackground('#0F172A')
      .setFontColor('#F8FAFC')
      .setFontWeight('bold');
    try { sheet.setFrozenRows(1); } catch (e) { /* 뷰 설정 실패는 올리기를 막지 않는다 */ }
    return sheet;
  }
  ensureSheetColumns_(ss, MEDIA_META_SHEET_, MEDIA_META_COLUMNS_);
  return sheet;
}

function mediaMetaKey_(source, externalId) {
  return String(source) + ':' + String(externalId);
}

/** 시트가 Date 로 돌려주든 문자열이든 ms. 모르면 0. */
function mediaMetaMs_(v) {
  if (v && typeof v === 'object' && typeof v.getTime === 'function') return v.getTime();
  const t = Date.parse(String(v == null ? '' : v));
  return isNaN(t) ? 0 : t;
}

function mediaMetaText_(v) {
  if (v && typeof v === 'object' && typeof v.getTime === 'function') return formatKstIso_(v);
  return String(v == null ? '' : v);
}

/** 행 하나 정규화. 못 쓰는 행은 null(조용히 버리지 않고 dropped 로 센다). 썸네일은 https 주소만 받는다. */
function mediaMetaRowOf_(it) {
  if (!it || typeof it !== 'object') return null;
  const source = String(it.source || '').trim();
  const externalId = String(it.external_id == null ? '' : it.external_id).trim();
  const channel = String(it.channel || '').trim();
  if (MEDIA_META_SOURCES_.indexOf(source) < 0) return null;
  if (!externalId || externalId.length > 64) return null;
  if (MEDIA_META_CHANNELS_.indexOf(channel) < 0) return null;
  const thumb = String(it.thumbnail_url || '').trim();
  const dur = Number(it.duration_sec);
  return {
    meta_key: mediaMetaKey_(source, externalId),
    source: source,
    external_id: externalId,
    channel: channel,
    title: String(it.title || '').replace(/\s+/g, ' ').trim().slice(0, 200),
    /* 인스타 CDN 썸네일 주소는 630~700자까지 온다 — 480자 상한이면 통째로 버려진다(2026-11-19 상향). */
    thumbnail_url: /^https:\/\/\S{1,1200}$/.test(thumb) ? thumb : '',
    published_at: String(it.published_at || '').trim().slice(0, 40),
    duration_sec: isFinite(dur) && dur >= 0 ? Math.round(dur) : 0
  };
}

/**
 * meta_key(source:external_id)가 없거나 updated_at 이 7일 지났을 때만 쓴다.
 * 호출하는 쪽(라우터)이 쓰기 락을 잡고 있다.
 * @returns {{inserted:number, updated:number, skipped:number}}
 */
function upsertMediaMeta_(ss, rows) {
  const sheet = ensureMediaMetaSheet_(ss);
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  const keyCol = headers.indexOf('meta_key');
  const stampCol = headers.indexOf('updated_at');
  const lastRow = sheet.getLastRow();
  const existing = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];

  const index = {};
  existing.forEach(function (vals, i) { index[String(vals[keyCol])] = i; });

  const nowMs = Date.now();
  const stamp = formatKstIso_(new Date());
  const appended = [];
  let inserted = 0, updated = 0, skipped = 0, dirty = false;

  (rows || []).forEach(function (r) {
    const k = r.meta_key;
    if (Object.prototype.hasOwnProperty.call(index, k)) {
      const i = index[k];
      if (i < 0) { skipped += 1; return; }                                  // 같은 묶음 안의 중복
      const at = mediaMetaMs_(existing[i][stampCol]);
      if (at && nowMs - at < MEDIA_META_STALE_MS_) { skipped += 1; return; } // 7일 안에 갱신됨
      headers.forEach(function (h, c) {
        if (h === 'updated_at') existing[i][c] = stamp;
        else if (Object.prototype.hasOwnProperty.call(r, h)) existing[i][c] = r[h];
      });
      updated += 1;
      dirty = true;
    } else {
      appended.push(headers.map(function (h) {
        if (h === 'updated_at') return stamp;
        return Object.prototype.hasOwnProperty.call(r, h) ? r[h] : '';
      }));
      index[k] = -1;
      inserted += 1;
    }
  });

  if (dirty) sheet.getRange(2, 1, existing.length, lastCol).setValues(existing);
  if (appended.length) sheet.getRange(lastRow + 1, 1, appended.length, lastCol).setValues(appended);
  return { inserted: inserted, updated: updated, skipped: skipped };
}

function mediaMetaOut_(r) {
  return {
    meta_key: String(r.meta_key || ''),
    source: String(r.source || ''),
    external_id: String(r.external_id == null ? '' : r.external_id),
    channel: String(r.channel || ''),
    title: String(r.title || ''),
    thumbnail_url: String(r.thumbnail_url || ''),
    published_at: mediaMetaText_(r.published_at),
    duration_sec: Number(r.duration_sec) || 0,
    updated_at: mediaMetaText_(r.updated_at)
  };
}

/** 여러 건 일괄 조회 — source 가 비면 전체 소스, ids 가 비면 제한 없음(호출하는 쪽이 상한을 건다). */
function listMediaMeta_(ss, source, ids) {
  const want = {};
  let filterIds = false;
  (ids || []).forEach(function (id) { want[String(id)] = true; filterIds = true; });
  return readSheetAsObjects_(ss, MEDIA_META_SHEET_)
    .filter(function (r) {
      if (!r.meta_key) return false;
      if (source && String(r.source) !== source) return false;
      if (filterIds && !want[String(r.external_id)]) return false;
      return true;
    })
    .map(mediaMetaOut_);
}

function handleUpsertMediaMeta_(ss, payload, ctx) {
  const items = (payload && Array.isArray(payload.items)) ? payload.items : [];
  if (!items.length) throw createAppError_('ERR_VALIDATION_FAILED', 'items 가 비어 있습니다.');
  if (items.length > MEDIA_META_MAX_ITEMS_) {
    throw createAppError_('ERR_VALIDATION_FAILED', '한 번에 ' + MEDIA_META_MAX_ITEMS_ + '건까지만 올릴 수 있습니다.', { count: items.length });
  }
  const rows = [];
  let dropped = 0;
  items.forEach(function (it) {
    const row = mediaMetaRowOf_(it);
    if (row) rows.push(row); else dropped += 1;
  });
  if (!rows.length) throw createAppError_('ERR_VALIDATION_FAILED', '올릴 수 있는 행이 없습니다(source·external_id·channel 확인).', { dropped: dropped });
  const res = upsertMediaMeta_(ss, rows);
  return { received: items.length, inserted: res.inserted, updated: res.updated, skipped: res.skipped, dropped: dropped };
}

function handleListMediaMeta_(ss, payload, ctx) {
  const source = String((payload && payload.source) || '').trim();
  if (source && MEDIA_META_SOURCES_.indexOf(source) < 0) {
    throw createAppError_('ERR_VALIDATION_FAILED', 'source 는 youtube 또는 instagram 이어야 합니다.');
  }
  const ids = (payload && Array.isArray(payload.ids)) ? payload.ids : [];
  if (ids.length > MEDIA_META_LIST_MAX_IDS_) {
    throw createAppError_('ERR_VALIDATION_FAILED', 'ids 는 ' + MEDIA_META_LIST_MAX_IDS_ + '개까지만 조회할 수 있습니다.', { count: ids.length });
  }
  const items = listMediaMeta_(ss, source, ids.map(String));
  return { source: source, count: items.length, items: items };
}

/* ------------------------------------------------------------------ *
 * 상세
 * ------------------------------------------------------------------ */

function postPoint_(r) {
  const n = function (k) { return Number(r[k]) || 0; };
  return {
    checkpoint: String(r.checkpoint || ''),
    collected_date: analyticsDayOf_(r.collected_date),
    collected_at: mediaMetaText_(r.collected_at),
    views: n('views'), impressions: n('impressions'), reach: n('reach'),
    likes: n('likes'), comments: n('comments'), shares: n('shares'), saves: n('saves'),
    watch_time_sec: n('watch_time_sec'), avg_view_pct: n('avg_view_pct'), score: n('score')
  };
}

function postLatest_(rows) {
  let best = null;
  rows.forEach(function (r) {
    if (!best || mediaMetaText_(r.collected_at) >= mediaMetaText_(best.collected_at)) best = r;
  });
  return best;
}

/**
 * 현재값 = checkpoint 가 LATEST 인 행 중 가장 최근 하나(누적값이라 여러 날을 더하면 중복).
 * 발행 D+1·7·14·30일째는 수집기가 LATEST 대신 D1/D7/D14/D30 행을 쓴다 → 그날은 LATEST 가 없다.
 * 그때 목록·비교에서 영상이 하루 사라지지 않도록, 가장 최근 수집일(collected_at) 행으로 폴백한다.
 * (체크포인트 행도 누적값이므로 그날의 최신값이 맞다. 'channel' 요약 행은 영상이 아니라 제외.)
 */
function postCurrentRow_(rows) {
  const ofVideo = rows.filter(function (r) { return String(r.checkpoint) !== 'channel'; });
  const latest = postLatest_(ofVideo.filter(function (r) { return String(r.checkpoint) === 'LATEST'; }));
  return latest || postLatest_(ofVideo);
}

function postFindContent_(contents, contentId, source, externalId) {
  if (contentId) {
    for (let i = 0; i < contents.length; i++) {
      if (String(contents[i].content_id) === contentId) return contents[i];
    }
    return null;
  }
  if (source === 'blog') {
    for (let j = 0; j < contents.length; j++) {
      if (blogLogNoOf_(contents[j].blog_url) === externalId) return contents[j];
    }
  }
  return null;
}

function postBlogMetrics_(ss, blogId, logNo, from7) {
  const views = readSheetAsObjects_(ss, 'Blog_Post_Views').filter(function (r) {
    return String(r.blog_id) === blogId && String(r.log_no) === logNo;
  });
  const daily = views.map(function (r) { return { day: dayKey_(r.day), views: Number(r.views) || 0 }; })
    .sort(function (a, b) { return a.day < b.day ? -1 : (a.day > b.day ? 1 : 0); });
  const post = readSheetAsObjects_(ss, 'Blog_Posts').filter(function (r) {
    return String(r.blog_id) === blogId && String(r.log_no) === logNo;
  })[0] || null;
  let total = 0, d7 = 0;
  daily.forEach(function (d) { total += d.views; if (d.day >= from7) d7 += d.views; });
  return { daily: daily, post: post, collected: daily.length > 0, views_total: daily.length ? total : null, views_7d: daily.length ? d7 : null };
}

/**
 * 같은 소재의 트랙 채널을 한 줄씩 묶는다. 일부러 건너뛴 채널(SKIPPED)은 넣지 않는다.
 * 지표 API 가 없는 채널(클립·당근)은 metrics=null, has_metrics_api=false.
 */
function postCompare_(ss, content, analyticsRows, blogCache) {
  const brand = String(content.brand || '');
  const out = [];
  postTrackChannels_(brand).forEach(function (ch) {
    const status = String(content[POST_CHANNEL_STATUS_COL_[ch]] || '');
    if (status === 'SKIPPED') return;
    const url = String(content[POST_CHANNEL_URL_COL_[ch]] || '');
    const entry = {
      channel: ch, status: status, url: url, source: '', external_id: '',
      has_metrics_api: POST_NO_METRIC_CHANNELS_.indexOf(ch) < 0, collected: false, metrics: null
    };
    if (ch === 'blog') {
      entry.source = 'blog';
      entry.external_id = blogLogNoOf_(url);
      if (entry.external_id && blogCache) {
        const m = postBlogMetrics_(ss, blogCache.blogId, entry.external_id, blogCache.from7);
        entry.collected = m.collected;
        if (m.collected) {
          entry.metrics = {
            views: m.views_total, views_7d: m.views_7d,
            comments: m.post ? Number(m.post.comment_cnt) || 0 : 0,
            sympathy: m.post ? Number(m.post.sympathy_cnt) || 0 : 0
          };
        }
      }
    } else if (ch === 'shorts') {
      entry.source = 'youtube';
      entry.external_id = youtubeIdOf_(url);
      const rows = analyticsRows.filter(function (r) {
        return String(r.source) === 'youtube' && String(r.channel) === 'shorts' &&
          (entry.external_id ? String(r.external_id) === entry.external_id : String(r.content_id) === String(content.content_id));
      });
      const cur = postCurrentRow_(rows);
      if (cur) {
        entry.external_id = String(cur.external_id);
        entry.collected = true;
        entry.metrics = { views: Number(cur.views) || 0, likes: Number(cur.likes) || 0, comments: Number(cur.comments) || 0, avg_view_pct: Number(cur.avg_view_pct) || 0 };
      }
    } else if (ch === 'reels' || ch === 'feed') {
      entry.source = 'instagram';
      entry.shortcode = instagramShortcodeOf_(url);
      const rows = analyticsRows.filter(function (r) {
        return String(r.source) === 'instagram' && String(r.channel) === ch && String(r.content_id) === String(content.content_id);
      });
      const cur = postCurrentRow_(rows);
      if (cur) {
        entry.external_id = String(cur.external_id);
        entry.collected = true;
        entry.metrics = { views: Number(cur.views) || 0, reach: Number(cur.reach) || 0, likes: Number(cur.likes) || 0, saves: Number(cur.saves) || 0, shares: Number(cur.shares) || 0 };
      }
    }
    out.push(entry);
  });
  return out;
}

/**
 * 상세 한 건.
 * @param {string} source 'youtube' | 'instagram' | 'blog'
 * @param {string} externalId 영상 ID · 인스타 미디어 ID(또는 연결된 카드로 찾는 값) · 블로그 글 번호
 * @param {string} contentId 카드 ID(없으면 시트 행의 content_id 로 찾는다)
 * @param {string} ctxBrand 요청 브랜드(블로그에서 계정을 정할 때만 쓴다)
 */
function getPostDetail_(ss, source, externalId, contentId, ctxBrand) {
  source = String(source || '').trim();
  externalId = String(externalId == null ? '' : externalId).trim();
  contentId = String(contentId || '').trim();
  if (POST_DETAIL_SOURCES_.indexOf(source) < 0) {
    throw createAppError_('ERR_VALIDATION_FAILED', 'source 는 youtube · instagram · blog 중 하나여야 합니다.');
  }
  const idOk = source === 'youtube' ? /^[A-Za-z0-9_-]{11}$/.test(externalId)
    : (source === 'blog' ? /^\d{9,20}$/.test(externalId) : /^[A-Za-z0-9_-]{1,64}$/.test(externalId));
  if (!idOk) throw createAppError_('ERR_VALIDATION_FAILED', 'external_id 형식이 올바르지 않습니다.', { source: source });
  if (contentId && !/^[A-Za-z0-9_.-]{1,64}$/.test(contentId)) {
    throw createAppError_('ERR_VALIDATION_FAILED', 'content_id 형식이 올바르지 않습니다.');
  }

  const contents = readSheetAsObjects_(ss, 'Contents');
  const analytics = source === 'blog' ? [] : readSheetAsObjects_(ss, ANALYTICS_SHEET_);

  let mine = [];
  if (source !== 'blog') {
    mine = analytics.filter(function (r) {
      return String(r.source) === source && String(r.external_id) === externalId && String(r.channel) !== 'channel';
    });
    /* 인스타는 주소(shortcode)로 들어올 수 있다 — 카드의 릴스·피드 주소와 맞는 표면의 미디어로 찾는다. */
    if (!mine.length && source === 'instagram' && contentId) {
      const card = postFindContent_(contents, contentId, source, externalId);
      let wantChannel = '';
      if (card && externalId === instagramShortcodeOf_(card.reels_url)) wantChannel = 'reels';
      else if (card && externalId === instagramShortcodeOf_(card.ig_feed_url)) wantChannel = 'feed';
      const cand = postLatest_(analytics.filter(function (r) {
        return String(r.source) === 'instagram' && String(r.content_id) === contentId && String(r.channel) !== 'channel' &&
          (!wantChannel || String(r.channel) === wantChannel);
      }));
      if (cand) {
        externalId = String(cand.external_id);
        mine = analytics.filter(function (r) { return String(r.source) === 'instagram' && String(r.external_id) === externalId; });
      }
    }
    if (!contentId) {
      const linked = mine.filter(function (r) { return r.content_id; })[0];
      if (linked) contentId = String(linked.content_id);
    }
  }

  const content = postFindContent_(contents, contentId, source, externalId);
  const contentMissing = !!contentId && !content;
  const rowBrand = mine.length ? String(mine[0].brand || '') : '';
  let brand = (content && String(content.brand || '')) || rowBrand || '';
  if (!brand && ctxBrand && ctxBrand !== 'ALL') brand = String(ctxBrand);

  const out = {
    source: source, external_id: externalId,
    content_id: content ? String(content.content_id) : '', linked: !!content, content_missing: contentMissing,
    brand: brand, channel: '', collected: false,
    meta: null, checkpoints: {}, daily: [], latest: null,
    track_channels: postTrackChannels_(brand), compare: []
  };

  if (source === 'blog') {
    const blogBrand = brand || 'daejeon_youth';
    const blogId = blogIdFor_(blogBrand);                       // 김메리는 ERR_BLOG_SKIPPED
    const from7 = kstDay_(new Date(Date.now() - 7 * 86400000));
    const m = postBlogMetrics_(ss, blogId, externalId, from7);
    const agg = m.collected ? aggregateIngested_(ss, blogId, from7) : { keywords: [], inflow: [] };
    const post = m.post;
    out.brand = blogBrand;
    out.track_channels = postTrackChannels_(blogBrand);
    out.channel = 'blog';
    out.collected = m.collected;
    out.meta = post ? {
      title: String(post.title || ''), url: String(post.url || ''), published_at: mediaMetaText_(post.published_at)
    } : null;
    out.blog = {
      log_no: externalId,
      views_total: m.views_total, views_7d: m.views_7d,
      comment_cnt: post ? Number(post.comment_cnt) || 0 : null,
      sympathy_cnt: post ? Number(post.sympathy_cnt) || 0 : null,
      daily: m.daily.slice(-POST_DETAIL_DAILY_MAX_),
      keywords_7d: agg.keywords, inflow_7d: agg.inflow,
      scope_note: '검색어·유입 경로는 글별이 아니라 블로그 전체의 최근 7일 통계입니다.'
    };
    out.daily = m.daily.slice(-POST_DETAIL_DAILY_MAX_).map(function (d) { return { collected_date: d.day, views: d.views }; });
    out.latest = m.collected ? { views: m.views_total, views_7d: m.views_7d } : null;
  } else {
    if (mine.length) {
      const channel = String(postLatest_(mine).channel || '');
      const set = postTrackChannels_(brand);
      if (set.length && set.indexOf(channel) < 0) {
        throw createAppError_('ERR_NOT_FOUND', '이 트랙에서 운영하지 않는 채널의 게시물입니다.', { channel: channel });
      }
      out.channel = channel;
      out.collected = true;
      POST_DETAIL_CHECKPOINTS_.forEach(function (cp) {
        const hit = postLatest_(mine.filter(function (r) { return String(r.checkpoint) === cp; }));
        if (hit) out.checkpoints[cp] = postPoint_(hit);
      });
      /* 날짜마다 그날 마지막으로 수집한 한 줄 — 추이 차트용 */
      const byDay = {};
      mine.forEach(function (r) {
        const day = analyticsDayOf_(r.collected_date);
        if (!day) return;
        if (!byDay[day] || mediaMetaText_(r.collected_at) >= mediaMetaText_(byDay[day].collected_at)) byDay[day] = r;
      });
      out.daily = Object.keys(byDay).sort().slice(-POST_DETAIL_DAILY_MAX_).map(function (d) { return postPoint_(byDay[d]); });
      out.latest = out.daily.length ? out.daily[out.daily.length - 1] : null;
    }
    out.meta = listMediaMeta_(ss, source, [externalId])[0] || null;
    if (!out.channel && out.meta) out.channel = out.meta.channel;
  }

  if (content) {
    let blogCache = null;
    if (postTrackChannels_(String(content.brand || '')).indexOf('blog') >= 0) {
      try {
        blogCache = { blogId: blogIdFor_(String(content.brand)), from7: kstDay_(new Date(Date.now() - 7 * 86400000)) };
      } catch (e) { blogCache = null; }
    }
    out.compare = postCompare_(ss, content, analytics, blogCache);
  }
  return out;
}

function handleGetPostDetail_(ss, payload, ctx) {
  const p = payload || {};
  return getPostDetail_(ss, p.source, p.external_id != null ? p.external_id : p.id, p.content_id, ctx && ctx.brand);
}
