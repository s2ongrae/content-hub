/**
 * js/productTracks.js — 상품 숏폼의 운영 트랙 A/B (2026-11-26)
 *
 * 왜 이 파일이 따로 있나
 *  - 화면(#/create/product)은 **브랜드(트랙)** 와 **클립 방식(챌린지·수익화)** 두 가지를 고른다.
 *    클립 방식은 productShorts.js 의 A/B(challenge·commerce)가 이미 맡는다. 이 파일은 그 위의
 *    "어느 브랜드로 만들 것인가"만 맡는다 — 둘을 한 이름으로 부르면 화면에서 헷갈린다.
 *  - 트랙 이름은 저장소 공통 표기(trackChannels.js · seeds/track_channels.json)와 같다.
 *      A = 대전 청년(daejeon_youth)  · 블로그 · 쇼츠 · 릴스 · 피드 · 클립
 *      B = 삐약 김메리(ppiyak_kimmary) · 쇼츠 · 릴스 · 클립
 *  - 여기서 다루는 채널은 **상품 링크로 만드는 표면**만이다. 당근은 링크 상품 발행 표면이 아니라 뺐고,
 *    운영 채널 계약(TRACK_CHANNELS)은 그대로 둔다(건드리면 시드·GAS·분석 사본 3곳 대조가 깨진다).
 *
 * 규칙
 *  - 트랙을 바꿔도 **상품명·사진·핵심 특징 3개는 그대로**다. 바뀌는 것은 채널 목록·비율·문구 세트뿐.
 *  - B 로 바꾸면 B 에 없는 채널(블로그·피드)은 해제하고, 왜 해제했는지 한 줄로 알린다.
 *  - 마지막으로 쓴 트랙을 기억한다. 처음 쓰는 브라우저는 A(대전 청년)로 시작한다.
 *  - DOM 을 만들지 않는다(브라우저 없이 시험). 저장은 storage 인자로만 만진다.
 */

/** 두 트랙 — id 는 화면 탭, brand 는 카드·오더에 실리는 값(저장소 공통 표기). */
export const BRAND_TRACKS = [
  { id: 'A', brand: 'daejeon_youth', label: '트랙 A · 대전 청년', short: '대전 청년', where: '블로그 · 쇼츠 · 릴스 · 피드 · 클립' },
  { id: 'B', brand: 'ppiyak_kimmary', label: '트랙 B · 삐약 김메리', short: '삐약 김메리', where: '쇼츠 · 릴스 · 클립' }
];

/** 상품 링크로 만드는 채널(운영 채널 계약의 부분집합 — 당근 제외). */
export const PRODUCT_CHANNELS = {
  A: ['blog', 'shorts', 'reels', 'feed', 'clip'],
  B: ['shorts', 'reels', 'clip']
};

/** 채널 이름·비율 — 비율은 트랙이 아니라 채널이 정한다(같은 9:16 이라도 문구는 트랙이 바꾼다). */
export const CHANNEL_SHAPE = {
  blog: { label: '블로그', ratio: '글', ratio_note: '사진 18~22장' },
  shorts: { label: '쇼츠', ratio: '9:16', ratio_note: '세로 영상' },
  reels: { label: '릴스', ratio: '9:16', ratio_note: '세로 영상' },
  feed: { label: '피드', ratio: '4:5', ratio_note: '사진 카드' },
  clip: { label: '클립', ratio: '9:16', ratio_note: '세로 영상' }
};

export const BRAND_TRACK_KEY = 'contenthub.product.brandtrack.v1';

/** 화면에 보이는 채널 순서(A 기준) — B 는 이 목록에서 걸러 쓴다. */
const CHANNEL_ORDER = ['blog', 'shorts', 'reels', 'feed', 'clip'];

/** 'A'·'B' 만 인정. 모르는 값은 첫 사용 기본값 A. */
export function normalizeBrandTrack(value) {
  const s = String(value == null ? '' : value).trim().toUpperCase();
  return s === 'B' ? 'B' : 'A';
}

/** 카드의 brand → 트랙 id. 모르는 브랜드는 A(대전 청년 기준). */
export function trackOfBrand(brand) {
  const b = String(brand == null ? '' : brand).trim().toLowerCase();
  return b === 'ppiyak_kimmary' ? 'B' : 'A';
}

export function trackById(value) {
  const id = normalizeBrandTrack(value);
  return BRAND_TRACKS.filter((t) => t.id === id)[0];
}

/** 트랙의 브랜드 값(카드·오더에 그대로 싣는다). */
export function brandOfTrack(value) {
  return trackById(value).brand;
}

/** 트랙이 쓰는 채널 — 복사본을 돌려준다(화면이 목록을 만지지 않게). */
export function channelsOfTrack(value) {
  const id = normalizeBrandTrack(value);
  return PRODUCT_CHANNELS[id].slice();
}

/** 채널 키 → 사람이 읽는 이름(모르는 키는 그대로). */
export function channelLabelOf(channel) {
  const shape = CHANNEL_SHAPE[channel];
  return shape ? shape.label : String(channel || '');
}

/**
 * 트랙 전환 계획 — 저장 상태(입력값)는 그대로 두고, 채널·문구·비율만 갈아 끼운다.
 * @param {string} fromId 지금 트랙
 * @param {string} toId   바꿀 트랙
 * @param {object} facts  지금 입력한 상품 사실(상품명·사진·핵심 특징)
 * @returns {{track:string, brand:string, channels:string[], dropped:string[], kept:object, note:string, changed:boolean}}
 */
export function trackSwitchPlan(fromId, toId, facts) {
  const from = normalizeBrandTrack(fromId);
  const to = normalizeBrandTrack(toId);
  const f = facts && typeof facts === 'object' ? facts : {};
  const channels = channelsOfTrack(to);
  const dropped = CHANNEL_ORDER.filter((ch) => channels.indexOf(ch) < 0 && channelsOfTrack(from).indexOf(ch) >= 0);
  const kept = {
    name: String(f.name || ''),
    images: (Array.isArray(f.images) ? f.images : []).map(String),
    key_points: (Array.isArray(f.key_points) ? f.key_points : []).map(String).slice(0, 5)
  };
  let note = '';
  if (to !== from) {
    note = dropped.length
      ? shortName(to) + '는 ' + channels.map(channelLabelOf).join('·') + ' ' + channels.length + '채널만 해요 — '
        + dropped.map(channelLabelOf).join('·') + '는 해제했어요. 상품명·사진·특징은 그대로입니다.'
      : shortName(to) + ' 채널로 바꿨어요 — 상품명·사진·특징은 그대로입니다.';
  }
  return { track: to, brand: brandOfTrack(to), channels: channels, dropped: dropped, kept: kept, note: note, changed: to !== from };
}

function shortName(trackId) {
  return trackById(trackId).short;
}

/**
 * 채널 하나의 문구·비율 — 트랙이 다르면 같은 채널이라도 말투·태그·행동 한 줄이 다르다.
 * @returns {{channel:string,label:string,ratio:string,ratio_note:string,voice:string,hook:string,hashtags:string[],cta:string}}
 */
export function channelCopy(trackId, channel, facts) {
  const id = normalizeBrandTrack(trackId);
  const ch = String(channel || '');
  const shape = CHANNEL_SHAPE[ch] || { label: ch, ratio: '9:16', ratio_note: '' };
  const f = facts && typeof facts === 'object' ? facts : {};
  const name = String(f.name || '상품').slice(0, 40);
  const point = (Array.isArray(f.key_points) ? f.key_points : []).map(String).filter(Boolean)[0] || '';
  const out = { channel: ch, label: shape.label, ratio: shape.ratio, ratio_note: shape.ratio_note, voice: '', hook: '', hashtags: [], cta: '' };
  if (id === 'B') {
    out.voice = '집사 시점 · 짧은 반말';
    out.hook = point ? point + ' — 우리 집 냥이 반응부터' : name + ' — 우리 집 냥이 반응부터';
    out.hashtags = ['#삐약김메리', '#집사일상', '#냥템'];
    out.cta = '우리 집 냥이 반응은 영상에서';
    return out;
  }
  out.voice = '정보형 · 담백한 말투';
  if (ch === 'blog') {
    out.hook = '[대전] ' + name + ' 써 보고 남는 것만 적었어요';
    out.hashtags = ['#대전청년', '#대전', '#살림템'];
    out.cta = '자세한 건 블로그에 정리했어요';
  } else if (ch === 'feed') {
    out.hook = '한 장으로 보는 ' + name;
    out.hashtags = ['#대전청년', '#오늘의살림', '#살림템'];
    out.cta = '저장해 두고 필요할 때 보세요';
  } else {
    out.hook = point ? point + ', 이 정도면 쓸 만해요' : name + ', 이 정도면 쓸 만해요';
    out.hashtags = ['#대전청년', '#상품추천', '#살림템'];
    out.cta = '상품 태그에서 조건 확인하세요';
  }
  return out;
}

/** 트랙의 채널 카드 묶음(화면 미리보기) — 채널 순서는 화면과 같다. */
export function channelPlan(trackId, facts, selected) {
  const id = normalizeBrandTrack(trackId);
  const picked = Array.isArray(selected) && selected.length
    ? channelsOfTrack(id).filter((ch) => selected.indexOf(ch) >= 0)
    : channelsOfTrack(id);
  return picked.map((ch) => channelCopy(id, ch, facts));
}

/** 설명란 해시태그 목록 — 트랙 색을 유지한 채 5개까지(클립 문구 세트 기준). */
export function trackTagList(trackId, facts) {
  const id = normalizeBrandTrack(trackId);
  const seen = [];
  channelsOfTrack(id).forEach((ch) => {
    channelCopy(id, ch, facts).hashtags.forEach((t) => {
      if (seen.indexOf(t) < 0 && seen.length < 5) seen.push(t);
    });
  });
  return seen;
}

/** 위 목록을 한 줄로(화면 표시용). */
export function trackTagLine(trackId, facts) {
  return trackTagList(trackId, facts).join(' ');
}

/* ────────────────────────── 저장(마지막 트랙 기억) ────────────────────────── */

/** 마지막으로 쓴 트랙. 처음 쓰는 브라우저는 A. 저장이 막혀도 화면은 A 로 산다. */
export function readBrandTrack(storage) {
  try {
    if (!storage) return 'A';
    return normalizeBrandTrack(storage.getItem(BRAND_TRACK_KEY));
  } catch (e) { return 'A'; }
}

/** 기억 저장 — 실패해도 던지지 않는다(사생활 보호 모드에서 저장이 막힌다). */
export function writeBrandTrack(storage, trackId) {
  try {
    if (!storage) return false;
    storage.setItem(BRAND_TRACK_KEY, normalizeBrandTrack(trackId));
    return true;
  } catch (e) { return false; }
}
