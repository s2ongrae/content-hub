/**
 * gas/Analytics.gs — 유튜브·인스타 자동 수집분 적재 (2026-11-19)
 *
 * 왜 따로 두나
 *  · Metrics 시트는 '사람이 넣은 숫자'의 시계열이다. 자동 수집은 원본 지표가 더 많고(도달·노출·저장·공유·구독자)
 *    수집일별로 쌓이므로 전용 시트(Analytics_Daily)에 그대로 남긴다.
 *  · 대신 카드와 연결된 행은 Metrics 에도 한 줄 비춰 준다 → 기존 성과분석(#/perf) 화면·배지가 그대로 산다.
 *  · Contents 35컬럼은 건드리지 않는다. Setup.gs 도 건드리지 않는다(첫 적재 때 시트를 스스로 만든다).
 *
 * 액션
 *   ingest_analytics : 수집기(GitHub Actions)가 50건씩 보낸다. 같은 중복 키는 다시 적지 않는다.
 *   list_analytics   : 화면이 읽는다(브랜드·기간·소스·채널 필터).
 *
 * 중복 키 = 소스 | 외부ID | 표면 | 시점 | 수집일  (수집기가 같은 규칙으로 먼저 걸러 준다)
 */

const ANALYTICS_SHEET_ = 'Analytics_Daily';
const ANALYTICS_MAX_ITEMS_ = 500;

const ANALYTICS_SOURCES_ = ['youtube', 'instagram'];
const ANALYTICS_CHANNELS_ = ['shorts', 'longform', 'channel', 'reels', 'feed'];

/** 자동 수집분을 Metrics 에 비출 때 쓰는 채널(롱폼은 Metrics 채널이 없어 비추지 않는다). */
const ANALYTICS_METRIC_CHANNEL_ = { shorts: 'shorts', reels: 'reels', feed: 'feed' };

const ANALYTICS_COLUMNS_ = [
  'analytics_id', 'brand', 'content_id', 'source', 'external_id', 'channel', 'checkpoint',
  'collected_at', 'collected_date',
  'views', 'impressions', 'reach', 'likes', 'comments', 'shares', 'saves',
  'watch_time_sec', 'avg_view_pct', 'subscribers',
  'revenue_krw', 'revenue_estimated', 'rpm_assumed', 'score', 'note'
];

const ANALYTICS_NUMERIC_ = [
  'views', 'impressions', 'reach', 'likes', 'comments', 'shares', 'saves',
  'watch_time_sec', 'avg_view_pct', 'subscribers', 'revenue_krw', 'rpm_assumed', 'score'
];

/** 첫 적재 때 시트·헤더를 만든다(있으면 손대지 않는다). */
function ensureAnalyticsSheet_(ss) {
  let sheet = ss.getSheetByName(ANALYTICS_SHEET_);
  if (!sheet) {
    sheet = ss.insertSheet(ANALYTICS_SHEET_);
    sheet.getRange(1, 1, 1, ANALYTICS_COLUMNS_.length)
      .setValues([ANALYTICS_COLUMNS_])
      .setBackground('#0F172A')
      .setFontColor('#F8FAFC')
      .setFontWeight('bold');
    try { sheet.setFrozenRows(1); } catch (e) { /* 뷰 설정 실패는 적재를 막지 않는다 */ }
    return sheet;
  }
  /* 이미 있는데 열이 모자라면(구버전) 뒤에만 덧붙인다 — 기존 열 순서는 그대로. */
  ensureSheetColumns_(ss, ANALYTICS_SHEET_, ANALYTICS_COLUMNS_);
  return sheet;
}

function analyticsNum_(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function analyticsStr_(v, max) {
  const s = String(v == null ? '' : v).trim();
  return max && s.length > max ? s.slice(0, max) : s;
}

function analyticsStamp_(v) {
  const raw = String(v || '').trim();
  const day = raw.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const tail = raw.length > 10 ? raw.slice(10) : 'T00:00:00+09:00';
    return day + tail;
  }
  return formatKstIso_(new Date());
}

/** 행 하나 정규화 — 잘못된 소스·표면은 ERR_VALIDATION_FAILED 로 거절한다(조용히 버리지 않는다). */
function analyticsRowOf_(it, brandFallback) {
  const source = analyticsStr_(it.source, 16);
  if (ANALYTICS_SOURCES_.indexOf(source) < 0) {
    throw createAppError_('ERR_VALIDATION_FAILED', 'source 는 youtube 또는 instagram 이어야 합니다: ' + source);
  }
  const channel = analyticsStr_(it.channel, 16);
  if (ANALYTICS_CHANNELS_.indexOf(channel) < 0) {
    throw createAppError_('ERR_VALIDATION_FAILED', 'channel 값이 올바르지 않습니다: ' + channel);
  }
  const externalId = analyticsStr_(it.external_id, 64);
  if (!externalId) throw createAppError_('ERR_VALIDATION_FAILED', 'external_id 가 필요합니다.');

  const collectedAt = analyticsStamp_(it.collected_at);
  const row = {
    analytics_id: 'AND-' + Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMddHHmmss') + '-' + Math.floor(100 + Math.random() * 900),
    brand: analyticsStr_(it.brand || brandFallback || '', 32),
    content_id: analyticsStr_(it.content_id, 64),
    source: source,
    external_id: externalId,
    channel: channel,
    checkpoint: analyticsStr_(it.checkpoint || 'LATEST', 8).toUpperCase(),
    collected_at: collectedAt,
    collected_date: String(collectedAt).slice(0, 10),
    revenue_estimated: it.revenue_estimated === true || String(it.revenue_estimated).toLowerCase() === 'true',
    note: analyticsStr_(it.note, 120)
  };
  ANALYTICS_NUMERIC_.forEach(function (k) { row[k] = analyticsNum_(it[k]); });
  return row;
}

function analyticsKey_(r) {
  return [r.source, r.external_id, r.channel, r.checkpoint, r.collected_date].join('|');
}

/**
 * 수집분 적재.
 * payload = { items:[row...], mirror_metrics?:boolean }
 */
function handleIngestAnalytics_(ss, payload, ctx) {
  const items = (Array.isArray(payload.items) && payload.items.length) ? payload.items : [];
  if (!items.length) throw createAppError_('ERR_VALIDATION_FAILED', 'items 가 비어 있습니다.');
  if (items.length > ANALYTICS_MAX_ITEMS_) {
    throw createAppError_('ERR_VALIDATION_FAILED', '한 번에 ' + ANALYTICS_MAX_ITEMS_ + '건까지만 적재할 수 있습니다.', { count: items.length });
  }

  const sheet = ensureAnalyticsSheet_(ss);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);

  /* 기존 중복 키 — 시트 전체를 읽어 한 번만 만든다(하루 수백 행 규모). */
  const existing = {};
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const srcCol = headers.indexOf('source');
    const extCol = headers.indexOf('external_id');
    const chCol = headers.indexOf('channel');
    const cpCol = headers.indexOf('checkpoint');
    const dayCol = headers.indexOf('collected_date');
    if (srcCol >= 0 && extCol >= 0) {
      const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
      values.forEach(function (v) {
        existing[[v[srcCol], v[extCol], v[chCol], v[cpCol], v[dayCol]].join('|')] = true;
      });
    }
  }

  const rows = [];
  const metricsItems = [];
  const mirror = payload.mirror_metrics !== false;
  let skipped = 0;

  items.forEach(function (it) {
    const row = analyticsRowOf_(it, ctx && ctx.brand);
    const key = analyticsKey_(row);
    if (existing[key]) { skipped += 1; return; }
    existing[key] = true;
    rows.push(row);

    const mChannel = ANALYTICS_METRIC_CHANNEL_[row.channel] || '';
    if (mirror && row.content_id && mChannel) {
      metricsItems.push({
        content_id: row.content_id,
        channel: mChannel,
        snapshot: row.checkpoint,
        views: row.views,
        likes_comments: row.likes + row.comments,
        saves: row.saves,
        measured_at: row.collected_date,
        brand: row.brand
      });
    }
  });

  if (rows.length) {
    const values = rows.map(function (r) {
      return headers.map(function (h) { return r[h] === undefined ? '' : r[h]; });
    });
    sheet.getRange(sheet.getLastRow() + 1, 1, values.length, headers.length).setValues(values);
  }

  /* 기존 성과분석 화면에도 비춘다 — 실패해도 적재 자체는 성공으로 남긴다. */
  let mirrored = 0;
  if (metricsItems.length) {
    try {
      const res = handleRecordMetrics_(ss, { items: metricsItems, brand: ctx && ctx.brand }, ctx);
      mirrored = (res && res.count) || 0;
    } catch (err) {
      mirrored = 0;
    }
  }

  return {
    received: items.length,
    inserted: rows.length,
    skipped: skipped,
    mirrored: mirrored,
    collected_at: formatKstIso_(new Date())
  };
}

/**
 * 수집분 조회 — 기간(from~to, YYYY-MM-DD)·브랜드·소스·채널·카드로 거른다.
 * 화면은 summary(소스별 마지막 수집 시각·건수)로 '동기화 상태'를 그린다.
 */
function handleListAnalytics_(ss, payload, ctx) {
  const from = String(payload.from || '').slice(0, 10);
  const to = String(payload.to || '').slice(0, 10);
  const brand = String(payload.brand || ctx.brand || '');
  const source = String(payload.source || '').trim();
  const channel = String(payload.channel || '').trim();
  const contentId = String(payload.content_id || '').trim();
  const limit = Math.max(1, Math.min(2000, Number(payload.limit) || 800));

  const all = readSheetAsObjects_(ss, ANALYTICS_SHEET_);
  const filtered = all.filter(function (r) {
    if (!r.external_id) return false;
    if (brand && brand !== 'ALL' && String(r.brand) !== brand) return false;
    if (source && String(r.source) !== source) return false;
    if (channel && String(r.channel) !== channel) return false;
    if (contentId && String(r.content_id) !== contentId) return false;
    const day = String(r.collected_date || '').slice(0, 10);
    if (from && day && day < from) return false;
    if (to && day && day > to) return false;
    return true;
  });

  const summary = { rows: filtered.length, by_source: {}, by_channel: {}, last_collected_at: '', last_collected_by_source: {} };
  filtered.forEach(function (r) {
    const s = String(r.source || 'UNKNOWN');
    const ch = String(r.channel || 'UNKNOWN');
    summary.by_source[s] = (summary.by_source[s] || 0) + 1;
    summary.by_channel[ch] = (summary.by_channel[ch] || 0) + 1;
    const at = String(r.collected_at || '');
    if (at > summary.last_collected_at) summary.last_collected_at = at;
    if (!summary.last_collected_by_source[s] || at > summary.last_collected_by_source[s]) summary.last_collected_by_source[s] = at;
  });

  const rows = filtered.slice(-limit).map(function (r) {
    const out = {
      analytics_id: String(r.analytics_id || ''),
      brand: String(r.brand || ''),
      content_id: String(r.content_id || ''),
      source: String(r.source || ''),
      external_id: String(r.external_id || ''),
      channel: String(r.channel || ''),
      checkpoint: String(r.checkpoint || ''),
      collected_at: String(r.collected_at || ''),
      collected_date: String(r.collected_date || ''),
      revenue_estimated: r.revenue_estimated === true || String(r.revenue_estimated).toLowerCase() === 'true',
      note: String(r.note || '')
    };
    ANALYTICS_NUMERIC_.forEach(function (k) { out[k] = Number(r[k]) || 0; });
    return out;
  });

  return { brand: brand, from: from, to: to, count: rows.length, summary: summary, rows: rows };
}
