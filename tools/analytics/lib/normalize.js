'use strict';
/**
 * tools/analytics/lib/normalize.js — API 응답 → Analytics_Daily 행
 *
 * 행 하나 = (소스 · 외부 ID · 표면 · 시점 · 수집일) 한 칸.
 * 시점(checkpoint)은 발행일에서 계산한다 — D1/D7/D14/D30 이 정확히 그날이면 그 값, 아니면 LATEST.
 * (하루 한 번 도는 크론에서 '오늘'의 누적값을 남기므로, 시점별 스냅샷과 일별 추이가 함께 쌓인다.)
 *
 * 표면(channel) 값
 *   youtube   : shorts | longform | channel(채널 요약)
 *   instagram : reels | feed
 * GAS 쪽 허용값과 반드시 같아야 한다(gas/Analytics.gs ANALYTICS_CHANNELS).
 */

const KST_OFFSET_MIN = 9 * 60;
const CHECKPOINTS = [1, 7, 14, 30];

const SURFACES = ['shorts', 'longform', 'channel', 'reels', 'feed'];
const SOURCES = ['youtube', 'instagram'];

/** Metrics 시트로 비출 때 쓰는 채널 이름(없으면 비우지 않는다). */
const METRIC_CHANNEL = { shorts: 'shorts', reels: 'reels', feed: 'feed' };

function pad(n, w) { return String(n).padStart(w || 2, '0'); }

function kstDate(now) {
  const d = new Date((now ? new Date(now).getTime() : Date.now()) + KST_OFFSET_MIN * 60000);
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}

function kstIso(now) {
  const d = new Date((now ? new Date(now).getTime() : Date.now()) + KST_OFFSET_MIN * 60000);
  return kstDate(now) + 'T' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()) + '+09:00';
}

/** 발행일 → 지난 날 수(반올림). 잘못된 값이면 null. */
function ageDays(publishedAt, now) {
  const t = Date.parse(publishedAt || '');
  if (!t || Number.isNaN(t)) return null;
  const base = now ? new Date(now).getTime() : Date.now();
  return Math.max(0, Math.floor((base - t) / 86400000));
}

function checkpointFor(publishedAt, now) {
  const days = ageDays(publishedAt, now);
  if (days == null) return 'LATEST';
  return CHECKPOINTS.indexOf(days) >= 0 ? 'D' + days : 'LATEST';
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function baseRow(extra) {
  return Object.assign({
    brand: '', content_id: '', source: '', external_id: '', channel: '', checkpoint: 'LATEST',
    collected_at: '', collected_date: '', views: 0, impressions: 0, reach: 0, likes: 0, comments: 0,
    shares: 0, saves: 0, watch_time_sec: 0, avg_view_pct: 0, subscribers: 0,
    revenue_krw: 0, revenue_estimated: false, rpm_assumed: 0, score: 0, note: ''
  }, extra || {});
}

/**
 * 유튜브 영상 1건 → 행.
 * @param {object} video collectYoutube() 의 videos[] 한 건
 * @param {{link?:{brand:string,content_id:string}, now?:Date, analytics?:object}} ctx
 */
function normalizeYoutubeVideo(video, ctx) {
  const c = ctx || {};
  const link = c.link || {};
  const ch = video.surface === 'shorts' ? 'shorts' : 'longform';
  const note = [];
  if (!link.content_id) note.push('UNMAPPED');       // 허브 카드와 아직 연결되지 않음
  return baseRow({
    brand: link.brand || video.brand || '',
    content_id: link.content_id || '',
    source: 'youtube',
    external_id: String(video.video_id || ''),
    channel: ch,
    checkpoint: checkpointFor(video.published_at, c.now),
    collected_at: kstIso(c.now),
    collected_date: kstDate(c.now),
    views: num(video.views),
    likes: num(video.likes),
    comments: num(video.comments),
    note: note.join(',')
  });
}

/** 유튜브 채널 요약 1건 → 행(구독자·총조회). */
function normalizeYoutubeChannel(channel, ctx) {
  const c = ctx || {};
  const link = c.link || {};
  return baseRow({
    brand: link.brand || c.brand || '',
    content_id: '',
    source: 'youtube',
    external_id: String(channel.channel_id || ''),
    channel: 'channel',
    checkpoint: 'LATEST',
    collected_at: kstIso(c.now),
    collected_date: kstDate(c.now),
    views: num(channel.total_views),
    subscribers: num(channel.subscribers),
    note: 'CHANNEL_SUMMARY'
  });
}

/**
 * 인스타 미디어 1건 → 행.
 * @param {object} media collectInstagram() 의 media[] 한 건 (insighit 포함)
 */
function normalizeInstagramMedia(media, ctx) {
  const c = ctx || {};
  const link = c.link || {};
  const ins = media.insight || {};
  const surface = media.surface === 'reels' ? 'reels' : 'feed';
  const note = [];
  if (!link.content_id) note.push('UNMAPPED');
  if (media.insight_error) note.push('INSIGHTS_' + media.insight_error);
  return baseRow({
    brand: link.brand || c.brand || '',
    content_id: link.content_id || '',
    source: 'instagram',
    external_id: String(media.external_id || ''),
    channel: surface,
    checkpoint: checkpointFor(media.published_at, c.now),
    collected_at: kstIso(c.now),
    collected_date: kstDate(c.now),
    views: num(ins.views),
    impressions: 0,                       // 메타가 impressions 를 폐기(도달로 대체)
    reach: num(ins.reach),
    likes: num(media.likes),
    comments: num(media.comments),
    shares: num(ins.shares),
    saves: num(ins.saved),
    note: note.join(',')
  });
}

/** 같은 (소스·외부ID·표면·시점·수집일) 은 한 번만 적재한다. */
function dedupeKey(row) {
  return [row.source, row.external_id, row.channel, row.checkpoint, row.collected_date].join('|');
}

function metricChannelOf(channel) {
  return METRIC_CHANNEL[String(channel || '')] || '';
}

module.exports = {
  CHECKPOINTS, SURFACES, SOURCES, KST_OFFSET_MIN,
  kstDate, kstIso, ageDays, checkpointFor,
  normalizeYoutubeVideo, normalizeYoutubeChannel, normalizeInstagramMedia,
  dedupeKey, metricChannelOf
};
