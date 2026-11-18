/**
 * js/slot-engine.js — 원스톱 슬롯 엔진 (브라우저 순수 함수)
 *
 * 재료(팩트·원문 메모·미디어 목록)를 받아 채널별 슬롯 배치와 원문 블록·해시를 만든다.
 * 서버·LLM을 쓰지 않는다. DOM도 만지지 않는다(노드에서 그대로 돌려 시험할 수 있게).
 *
 * 불변식
 *  - 원문은 origin:'USER' 블록으로 쪼개고, 블록 안의 한 줄바꿈은 건드리지 않는다(두 줄 호흡).
 *  - user_body_sha256 = SHA-256(USER블록.join('\n\n')) — 조립 뒤 이 값이 바뀌면 실패다.
 *  - 숫자는 docs/ONESTOP_CREATOR_SPEC.md §5 값만 쓴다. 모자라면 모자란 대로 배정하고 경고를 남긴다.
 */

export const CHANNEL_IDS = ['blog', 'shorts', 'ig_reels', 'ig_feed', 'clip', 'daangn'];

export const BLOG_STEPS = [
  { id: 'BLOG_STEP1', role: '외관·간판' },
  { id: 'BLOG_STEP2', role: '입구·주차·웨이팅' },
  { id: 'BLOG_STEP3', role: '메뉴판·가격' },
  { id: 'BLOG_STEP4', role: '기본찬·불판' },
  { id: 'BLOG_STEP5', role: '메인 메뉴' },
  { id: 'BLOG_STEP6', role: '먹조합' },
  { id: 'BLOG_STEP7', role: '영수증·총평' }
];

/** 25초 6비트 (대전 청년) */
export const BEATS_25S = [
  { role: 'HOOK', label: '첫 2초 훅', start: 0, end: 2, note: '현장 클로즈업 1컷, 자막 6~12자' },
  { role: 'PROMISE', label: '한 문장 약속', start: 2, end: 5, note: '무엇을 알게 되는지, 채널 소개 금지' },
  { role: 'PROOF-1', label: '증거 1', start: 5, end: 12, note: '숫자·메뉴판. 정보는 숫자로만' },
  { role: 'PROOF-2', label: '증거 2 + 단점', start: 12, end: 18, note: '단점 1회는 그대로 말한다' },
  { role: 'PAYOFF', label: '페이오프', start: 18, end: 22, note: '영수증·총액 1개' },
  { role: 'CTA', label: '요청 한 개', start: 22, end: 25, note: '저장·댓글 유도 딱 1회' }
];

/** 메리 15초 4비트 */
export const BEATS_15S = [
  { role: 'HOOK', label: '첫 1.5초 반응', start: 0, end: 1.5, note: '표정·몸짓 클로즈업' },
  { role: 'TURN', label: '전환', start: 1.5, end: 6, note: '한 컷에 한 동작' },
  { role: 'TWIST', label: '반전', start: 6, end: 12, note: '자막이 곧 말' },
  { role: 'CTA', label: '요청', start: 12, end: 15, note: '한 번만' }
];

const PHOTO_EXT = /\.(jpe?g|png|heic|heif|webp|gif|bmp)$/i;
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|avi|mkv)$/i;

/** 파일명 한 덩어리에서 종류를 추정한다. */
export function kindOfName(name) {
  const s = String(name || '');
  if (VIDEO_EXT.test(s)) return 'VIDEO';
  if (PHOTO_EXT.test(s)) return 'PHOTO';
  return 'UNKNOWN';
}

/** "파일명 붙여넣기" 입력 → media 항목 배열. `영상: a.mp4` 처럼 종류를 앞에 적을 수 있다. */
export function parseMediaPaste(text) {
  const out = [];
  String(text || '').split('\n').forEach((raw) => {
    let line = raw.trim();
    if (!line) return;
    let kind = '';
    const m = line.match(/^(사진|영상|photo|video)\s*[:：]\s*/i);
    if (m) { kind = /영상|video/i.test(m[1]) ? 'VIDEO' : 'PHOTO'; line = line.slice(m[0].length).trim(); }
    if (!line) return;
    out.push({
      name: line,
      kind: kind || (kindOfName(line) === 'UNKNOWN' ? 'PHOTO' : kindOfName(line)),
      orientation: 'UNKNOWN',
      dur_sec: null,
      taken_at: ''
    });
  });
  return out;
}

/** 미디어 목록을 슬롯 엔진이 쓰는 모양으로 정리한다(촬영시각 오름차순). */
export function normalizeMedia(items) {
  const list = (Array.isArray(items) ? items : []).map((it, i) => {
    const name = String((it && it.name) || '').trim();
    const kind = String((it && it.kind) || '').toUpperCase();
    return {
      id: (it && it.id) || 'm' + String(i + 1).padStart(2, '0'),
      name,
      kind: kind === 'VIDEO' || kind === 'PHOTO' ? kind : (kindOfName(name) === 'UNKNOWN' ? 'PHOTO' : kindOfName(name)),
      orientation: String((it && it.orientation) || 'UNKNOWN').toUpperCase(),
      dur_sec: it && it.dur_sec != null && it.dur_sec !== '' ? Number(it.dur_sec) : null,
      taken_at: String((it && it.taken_at) || ''),
      size: it && it.size != null ? Number(it.size) : null
    };
  }).filter((it) => it.name);

  return list.slice().sort((a, b) => {
    if (!a.taken_at && !b.taken_at) return 0;
    if (!a.taken_at) return 1;
    if (!b.taken_at) return -1;
    return a.taken_at < b.taken_at ? -1 : a.taken_at > b.taken_at ? 1 : 0;
  });
}

/** 원문 메모 → USER 블록. 빈 줄(\n\n) 단위로 쪼개고 블록 안의 \n은 그대로 둔다. */
export function splitUserBlocks(memo) {
  const text = String(memo == null ? '' : memo).replace(/\r\n?/g, '\n');
  if (!text.trim()) return [];
  return text.split(/\n{2,}/).map((s) => s.replace(/^\n+|\n+$/g, '')).filter((s) => s.length)
    .map((s, i) => ({
      id: 'U' + String(i + 1).padStart(2, '0'),
      origin: 'USER',
      immutable: true,
      text: s,
      media_ref: null
    }));
}

/** SHA-256 hex. 브라우저·노드 18+ 의 crypto.subtle을 쓴다. */
export async function sha256Hex(text) {
  const data = new TextEncoder().encode(String(text == null ? '' : text));
  const buf = await globalThis.crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** USER 블록만 이어 붙인 문자열 — 해시 대상. */
export function userBodyText(blocks) {
  return (Array.isArray(blocks) ? blocks : []).filter((b) => b && b.origin === 'USER').map((b) => b.text).join('\n\n');
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/** 채널별 슬롯 계획(동기). */
export function planChannels({ facts, blocks, media, brand, monthPlaces }) {
  const photos = media.filter((m) => m.kind === 'PHOTO');
  const videos = media.filter((m) => m.kind === 'VIDEO');
  const portraitVideos = videos.filter((m) => m.orientation === 'PORTRAIT');
  const warnings = [];
  const channels = { blog: [], shorts: [], ig_reels: [], ig_feed: [], clip: [], daangn: [] };

  /* ── 블로그: 사진 18~22장을 7단계에 고르게 ── */
  const blogPhotos = photos.slice(0, 22);
  blogPhotos.forEach((p, i) => {
    const step = BLOG_STEPS[clamp(Math.floor((i * BLOG_STEPS.length) / Math.max(blogPhotos.length, 1)), 0, BLOG_STEPS.length - 1)];
    p.assigned = (p.assigned || []).concat(['BLOG']);
    channels.blog.push({ slot_id: step.id, role: step.role, media: p.name, note: '장당 95~120자' });
  });
  if (blogPhotos.length < 18) warnings.push({ code: 'PHOTOS_SHORT', msg: '블로그 사진 ' + blogPhotos.length + '장 — 권장 18장 이상' });
  if (!photos.length) warnings.push({ code: 'PHOTOS_NONE', msg: '사진이 없어 블로그·피드 슬롯을 비웁니다' });

  /* ── 숏폼 컷: 세로 영상 우선, 없으면 사진 보조 ── */
  const merry = brand === 'ppiyak_kimmary';
  const beats = merry ? BEATS_15S : BEATS_25S;
  const cutTarget = clamp(portraitVideos.length * 3 + 4, 14, 20);
  const pool = (portraitVideos.length >= 3 ? portraitVideos.concat(photos.slice(0, 3)) : videos.concat(photos.slice(0, 3)));
  if (portraitVideos.length < 3) warnings.push({ code: 'NEED_CROP', msg: '세로 영상 ' + portraitVideos.length + '개 — 가로 영상은 크롭이 필요합니다' });
  if (!videos.length) warnings.push({ code: 'NO_VIDEO', msg: '영상이 없어 숏폼·클립·당근은 사진으로만 구성됩니다' });

  const totalSec = beats[beats.length - 1].end;
  let cutIndex = 0;
  beats.forEach((b) => {
    const share = (b.end - b.start) / totalSec;
    const n = Math.max(1, Math.round(cutTarget * share));
    for (let k = 0; k < n; k += 1) {
      const m = pool.length ? pool[cutIndex % pool.length] : null;
      cutIndex += 1;
      channels.shorts.push({
        slot_id: 'SHORTS_' + b.role,
        role: b.label,
        start: b.start,
        end: b.end,
        media: m ? m.name : '',
        note: b.note
      });
    }
  });
  channels.ig_reels = channels.shorts.map((s) => Object.assign({}, s, { slot_id: s.slot_id.replace('SHORTS_', 'REELS_'), note: '쇼츠와 같은 컷 · 하단 UI 안전영역만 다름' }));

  /* ── 클립: 세로 원본만 ── */
  const clipPool = portraitVideos.filter((v) => !/reels|shorts|tiktok/i.test(v.name));
  if (portraitVideos.length && !clipPool.length) warnings.push({ code: 'NEED_ORIGINAL', msg: '파일명에 reels·shorts·tiktok — 워터마크 없는 원본으로 교체하세요' });
  const clipCuts = clipPool.length ? clipPool : portraitVideos;
  clipCuts.slice(0, 3).forEach((m, i) => {
    channels.clip.push({ slot_id: 'CLIP_' + (i + 1), role: ['오픈', '핵심', '마무리'][i] || '추가', start: i * 10, end: (i + 1) * 10, media: m.name, note: '핵심 메뉴·위치 텍스트 오버레이' });
  });

  /* ── 당근: 15~25초, 세로만, 메리 트랙 제외 ── */
  if (merry) {
    warnings.push({ code: 'SKIPPED', msg: '삐약 김메리 트랙은 당근 스토리를 올리지 않습니다(SKIPPED)' });
  } else {
    const daangnPool = portraitVideos.length ? portraitVideos : videos;
    daangnPool.slice(0, 6).forEach((m, i) => {
      channels.daangn.push({ slot_id: 'DAANGN_' + (i + 1), role: '비트 ' + (i + 1), start: i * 4, end: Math.min(25, (i + 1) * 4), media: m.name, note: '정지 사진 비중 50% 이하' });
    });
    if (!daangnPool.length) warnings.push({ code: 'DAANGN_NO_VIDEO', msg: '당근은 영상 필수(10초↑) — 세로 영상이 필요합니다' });
    if (String(facts && facts.place_name || '').trim() && Array.isArray(monthPlaces) && monthPlaces.indexOf(String(facts.place_name).trim()) >= 0) {
      warnings.push({ code: 'DUP_PLACE_MONTH', msg: '이번 달 같은 장소를 이미 올렸습니다 — 당근은 월 1회만 인정' });
    }
  }

  /* ── 인스타 피드: 가로·4:5 5~8장 ── */
  const feedPool = photos.filter((p) => p.orientation !== 'PORTRAIT');
  const feedPhotos = (feedPool.length >= 5 ? feedPool : photos).slice(0, 8);
  feedPhotos.forEach((p, i) => {
    channels.ig_feed.push({
      slot_id: 'IG_FEED_' + (i + 1),
      role: i === 0 ? '표지(메인 클로즈업)' : i === 1 ? '메뉴판' : (i === feedPhotos.length - 1 ? '가격·위치 요약' : '디테일'),
      media: p.name,
      note: '4:5 세로 크롭 · D+1~2 발행'
    });
  });
  if (feedPhotos.length < 5) warnings.push({ code: 'FEED_SKIPPED', msg: '가로 사진이 5장 미만 — 피드 카드뉴스는 건너뛰는 것을 권합니다' });

  /* ── 원문 블록마다 사진 한 장 ── */
  const userBlocks = (blocks || []).filter((b) => b.origin === 'USER');
  userBlocks.forEach((b, i) => { b.media_ref = photos[i] ? photos[i].name : null; });

  return { channels, warnings, media };
}

/**
 * 슬롯 가이드 전체.
 * @returns {Promise<{user_body_sha256:string, blocks:object[], channels:object, warnings:object[]}>}
 */
export async function buildSlotGuide(input) {
  const opts = input || {};
  const facts = Object.assign({}, opts.facts || {});
  const brand = opts.brand === 'ppiyak_kimmary' ? 'ppiyak_kimmary' : 'daejeon_youth';
  const blocks = splitUserBlocks(opts.userMemo);
  const media = normalizeMedia(opts.mediaItems);
  const plan = planChannels({ facts, blocks, media, brand, monthPlaces: opts.monthPlaces || [] });
  const hash = await sha256Hex(userBodyText(blocks));
  return {
    brand,
    facts,
    user_body_sha256: hash,
    blocks,
    channels: plan.channels,
    media: plan.media,
    warnings: plan.warnings,
    generated_at: new Date().toISOString()
  };
}

if (typeof window !== 'undefined') {
  window.SlotEngine = { buildSlotGuide, parseMediaPaste, splitUserBlocks, sha256Hex, BEATS_25S, BEATS_15S, BLOG_STEPS };
}
