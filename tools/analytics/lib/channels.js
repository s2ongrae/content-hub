'use strict';
/**
 * tools/analytics/lib/channels.js — 트랙별 운영 채널(수집기 쪽 사본)
 *
 * 기준 파일은 seeds/track_channels.json 이다. 프론트(js/channelView.js)·GAS(gas/PostDetail.gs)·이 파일이
 * 각자 사본을 갖고(런타임 fetch·시트 읽기 없음), test/run.js 와 gas/test/run.js 가 deepStrictEqual 로 대조한다.
 *
 * 인스타 수집에서 쓰는 것은 그중 표면(reels·feed)뿐이다. 트랙 설정에 allowedSurfaces 가 있으면 그것이 우선이고,
 * 없으면 인스타가 줄 수 있는 두 표면을 모두 받는다(대전 청년). 김메리는 릴스만(피드 사진은 운영하지 않는다).
 */

const TRACK_CHANNELS = {
  daejeon_youth: ['blog', 'shorts', 'reels', 'feed', 'clip', 'daangn'],
  ppiyak_kimmary: ['shorts', 'reels', 'clip']
};

const INSTAGRAM_SURFACES = ['reels', 'feed'];

/** 브랜드가 인스타에서 받을 수 있는 표면 — 트랙 채널셋 ∩ 인스타 표면. */
function instagramSurfacesOf(brand) {
  const set = TRACK_CHANNELS[brand];
  if (!set) return INSTAGRAM_SURFACES.slice();
  return INSTAGRAM_SURFACES.filter((s) => set.indexOf(s) >= 0);
}

module.exports = { TRACK_CHANNELS, INSTAGRAM_SURFACES, instagramSurfacesOf };
