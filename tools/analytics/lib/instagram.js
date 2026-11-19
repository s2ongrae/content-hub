'use strict';
/**
 * tools/analytics/lib/instagram.js — Instagram Graph API 수집
 *
 * 얻는 것   : 미디어 단위 조회(views)·도달(reach)·저장(saved)·공유(shares)·좋아요·댓글·상호작용
 * 못 얻는 것: 수익(정산 개념이 없음), 협찬·제휴 금액 → 시트에 직접 넣는 값으로만 남긴다.
 *
 * 표면 구분 : media_product_type === 'REELS' → reels, 그 밖(IMAGE·CAROUSEL_ALBUM) → feed
 *             (같은 소재라도 릴스와 피드의 노출 엔진·주요 지표가 다르므로 행을 섞지 않는다)
 *
 * 토큰      : 장기 토큰 60일. 만료되면 수집이 조용히 멈추므로 만료 7일 전부터 경고를 남기고,
 *             refresh_access_token 으로 갱신한 새 토큰을 받아 오는 경로를 둔다(자동 저장은 사람이).
 */

const { fetchJson, AnalyticsError } = require('./http');

const GRAPH_BASE = 'https://graph.facebook.com/v21.0';
const IG_REFRESH_URL = 'https://graph.instagram.com/refresh_access_token';

const MEDIA_FIELDS = 'id,media_type,media_product_type,caption,permalink,timestamp,like_count,comments_count,thumbnail_url';

/** 표면별 인사이트 지표 — 2025년 이후 plays 는 views 로 대체됐다. */
const INSIGHT_METRICS = {
  reels: ['views', 'reach', 'saved', 'shares', 'total_interactions'],
  feed: ['reach', 'saved', 'shares', 'total_interactions']
};

function mediaUrl(igUserId, token, after) {
  const q = '?fields=' + encodeURIComponent(MEDIA_FIELDS) + '&limit=50&access_token=' + encodeURIComponent(token);
  return GRAPH_BASE + '/' + encodeURIComponent(igUserId) + '/media' + q + (after ? '&after=' + encodeURIComponent(after) : '');
}

function insightsUrl(mediaId, surface, token) {
  const metrics = INSIGHT_METRICS[surface] || INSIGHT_METRICS.feed;
  return GRAPH_BASE + '/' + encodeURIComponent(mediaId) + '/insights?metric=' + encodeURIComponent(metrics.join(','))
    + '&access_token=' + encodeURIComponent(token);
}

function surfaceOf(media) {
  const p = String((media && media.media_product_type) || '').toUpperCase();
  return p === 'REELS' ? 'reels' : 'feed';
}

function parseMedia(json) {
  return (((json && json.data) || [])).map((m) => ({
    external_id: String(m.id || ''),
    surface: surfaceOf(m),
    media_type: String(m.media_type || ''),
    media_product_type: String(m.media_product_type || ''),
    caption: String(m.caption || ''),
    permalink: String(m.permalink || ''),
    published_at: String(m.timestamp || ''),
    likes: num(m.like_count),
    comments: num(m.comments_count)
  })).filter((m) => m.external_id);
}

function parseInsights(json) {
  const out = {};
  (((json && json.data) || [])).forEach((d) => {
    const v = (d.values && d.values[0] && d.values[0].value);
    out[String(d.name || '')] = num(v);
  });
  return out;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 미디어 목록 + (최근 N일) 인사이트.
 * @param {{igUserId:string, token:string, fetchImpl?:Function, now?:Date, windowDays?:number,
 *          maxMedia?:number, withInsights?:boolean}} opts
 */
async function collectInstagram(opts) {
  const o = opts || {};
  if (!o.token) throw new AnalyticsError('ERR_NO_TOKEN', 'IG_ACCESS_TOKEN 이 없습니다.');
  if (!o.igUserId) throw new AnalyticsError('ERR_NO_IG_USER', 'IG_USER_ID 가 없습니다.');
  const now = o.now ? new Date(o.now) : new Date();
  const windowDays = Number.isFinite(o.windowDays) ? o.windowDays : 45;
  const maxMedia = Number.isFinite(o.maxMedia) ? o.maxMedia : 50;
  const withInsights = o.withInsights !== false;
  const secrets = [o.token];

  let calls = 0;
  const collected = [];
  let after = '';
  let pages = 0;

  while (collected.length < maxMedia && pages < 3) {
    const res = await fetchJson(mediaUrl(o.igUserId, o.token, after), { fetchImpl: o.fetchImpl, secrets });
    calls += res.calls;
    const items = parseMedia(res.body);
    items.forEach((m) => {
      if (collected.length >= maxMedia) return;
      if (!withinWindow(m.published_at, now, windowDays)) return;
      collected.push(m);
    });
    after = String((res.body && res.body.paging && res.body.paging.cursors && res.body.paging.cursors.after) || '');
    pages += 1;
    if (!after || !items.length) break;
  }

  const insightsErrors = [];
  if (withInsights) {
    for (const m of collected) {
      try {
        const res = await fetchJson(insightsUrl(m.external_id, m.surface, o.token), { fetchImpl: o.fetchImpl, secrets });
        calls += res.calls;
        Object.assign(m, { insight: parseInsights(res.body), insight_error: '' });
      } catch (err) {
        /* 지표 하나가 막혀도 미디어 행은 남긴다 — 앱 권한이 부분적으로 없는 경우가 흔하다. */
        m.insight = {};
        m.insight_error = (err && err.code) || 'ERR_INSIGHTS';
        insightsErrors.push({ external_id: m.external_id, code: m.insight_error, reason: (err && err.details && err.details.reason) || '' });
      }
    }
  }

  return { media: collected, insightsErrors, calls };
}

/**
 * 장기 토큰 갱신(60일). 성공하면 새 토큰과 만료까지 남은 초를 돌려준다.
 * 저장은 하지 않는다 — 값이 밖으로 새지 않게 호출한 쪽이 시크릿에 넣는다.
 */
async function refreshInstagramToken(opts) {
  const o = opts || {};
  if (!o.token) throw new AnalyticsError('ERR_NO_TOKEN', 'IG_ACCESS_TOKEN 이 없습니다.');
  const url = IG_REFRESH_URL + '?grant_type=ig_refresh_token&access_token=' + encodeURIComponent(o.token);
  const res = await fetchJson(url, { fetchImpl: o.fetchImpl, secrets: [o.token], retries: 1 });
  const body = res.body || {};
  if (!body.access_token) throw new AnalyticsError('ERR_REFRESH', '토큰 갱신 응답에 access_token 이 없습니다.');
  return { access_token: String(body.access_token), expires_in: num(body.expires_in), calls: res.calls };
}

/** 만료 예고 — 7일 이내면 경고 문구, 지났으면 중단 문구. */
function tokenNotice(expiresAtISO, now) {
  const t = Date.parse(expiresAtISO || '');
  if (!t || Number.isNaN(t)) return { level: 'unknown', daysLeft: null, message: '토큰 만료일을 아직 모릅니다 — 발급 직후 만료일을 적어 두세요.' };
  const daysLeft = Math.floor((t - (now ? new Date(now).getTime() : Date.now())) / 86400000);
  if (daysLeft < 0) return { level: 'expired', daysLeft, message: '인스타 토큰이 만료됐습니다. 수집이 멈춥니다 — 새 장기 토큰을 발급해 등록하세요.' };
  if (daysLeft <= 7) return { level: 'soon', daysLeft, message: '인스타 토큰이 ' + daysLeft + '일 뒤 만료됩니다. 갱신하세요.' };
  return { level: 'ok', daysLeft, message: '인스타 토큰 ' + daysLeft + '일 남음' };
}

function withinWindow(iso, now, days) {
  const t = Date.parse(iso);
  if (!t || Number.isNaN(t)) return false;
  return (now.getTime() - t) <= days * 86400000 && t <= now.getTime() + 86400000;
}

module.exports = {
  collectInstagram,
  refreshInstagramToken,
  tokenNotice,
  parseMedia,
  parseInsights,
  surfaceOf,
  mediaUrl,
  insightsUrl,
  INSIGHT_METRICS,
  MEDIA_FIELDS
};
