/**
 * js/trackChannels.js — 트랙별 운영 채널(프론트 사본)
 *
 * 기준 파일은 seeds/track_channels.json 이다. 런타임에 fetch 하지 않고 이 상수를 그대로 쓴다.
 * 같은 값이 gas/PostDetail.gs(TRACK_CHANNELS)·tools/analytics/lib/channels.js 에도 있고,
 * test/run.js 와 gas/test/run.js 가 세 곳을 기준 파일과 deepStrictEqual 로 대조한다 — 한쪽만 고치면 시험이 깨진다.
 *
 *  · 트랙 A(daejeon_youth)  : 블로그 · 쇼츠 · 릴스 · 피드 · 클립 · 당근
 *  · 트랙 B(ppiyak_kimmary) : 쇼츠 · 릴스 · 클립 (블로그·인스타 피드 사진·당근은 운영하지 않는다 —
 *                             쇼츠·릴스·클립 3개가 올라가면 그 소재는 끝)
 *
 * 브라우저 전용 API 를 쓰지 않아 노드에서도 그대로 불러 시험할 수 있다.
 */

export const TRACK_CHANNELS = {
  daejeon_youth: ['blog', 'shorts', 'reels', 'feed', 'clip', 'daangn'],
  ppiyak_kimmary: ['shorts', 'reels', 'clip']
};

/** 카드(Contents) 안의 채널별 상태 열 — 채널 키 → 열 이름 */
export const STATUS_COLUMN = {
  blog: 'blog_status', shorts: 'shorts_status', reels: 'reels_status',
  feed: 'ig_feed_status', clip: 'clip_status', daangn: 'daangn_status'
};

/** 올라간 것으로 치는 상태 */
export const DONE_STATES = ['UPLOADED', 'DONE', 'PUBLISHED', 'LINKED'];

export const CHANNEL_LABEL = { blog: '블로그', shorts: '쇼츠', reels: '릴스', feed: '피드', clip: '클립', daangn: '당근' };

/** 지표 API 가 없는 채널 — 게시 여부만 안다 */
export const NO_METRIC_CHANNELS = ['clip', 'daangn'];

/** 브랜드의 운영 채널(알 수 없는 브랜드는 대전 청년 기준). 복사본을 돌려준다. */
export function trackChannelsOf(brand) {
  return (TRACK_CHANNELS[brand] || TRACK_CHANNELS.daejeon_youth).slice();
}

export function hasChannel(brand, channel) {
  return trackChannelsOf(brand).indexOf(channel) >= 0;
}

/**
 * 완료 판정 — 분모: 트랙 채널셋 중 상태가 SKIPPED 인 칸을 뺀 것, 분자: 올라간 상태인 칸.
 * Metrics 숫자가 아니라 카드(Contents)의 *_status 만 본다.
 * @returns {{done:number, total:number, targets:string[], complete:boolean}}
 */
export function completionOf(item, fallbackBrand) {
  const brand = (item && item.brand) || fallbackBrand;
  const targets = trackChannelsOf(brand).filter((ch) => (item || {})[STATUS_COLUMN[ch]] !== 'SKIPPED');
  const done = targets.filter((ch) => DONE_STATES.indexOf((item || {})[STATUS_COLUMN[ch]]) >= 0).length;
  return { done, total: targets.length, targets, complete: targets.length > 0 && done === targets.length };
}

/**
 * 자동 수집 행(Analytics_Daily)이 그 트랙에서 보여도 되는지.
 * 쇼츠·릴스·피드 표면은 트랙 채널셋에 있어야 한다(이미 쌓인 트랙 B 피드 행은 목록·KPI·비교표에서 뺀다).
 * 롱폼·채널 요약처럼 표면이 아닌 행은 그대로 둔다.
 */
export function isTrackRow(row, fallbackBrand) {
  const brand = (row && row.brand) || fallbackBrand;
  if (!TRACK_CHANNELS[brand]) return true;
  const ch = row && row.channel;
  if (ch === 'shorts' || ch === 'reels' || ch === 'feed') return TRACK_CHANNELS[brand].indexOf(ch) >= 0;
  return true;
}
