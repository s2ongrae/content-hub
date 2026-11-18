/**
 * js/assembler-channels.js — 채널 조립기 (쇼츠·클립·당근·인스타)
 *
 * 값은 seeds/skills/shorts_preset.json · seeds/daangn_story_v1.json · docs/ONESTOP_CREATOR_SPEC.md §5 를 따른다.
 * 사용자 문장(USER 블록)은 인용만 한다. 새 문장을 지어내지 않고, 슬롯 안내문만 붙인다.
 */

const clean = (s) => String(s == null ? '' : s).replace(/\r\n?/g, '\n').trim();
const short = (s, n) => clean(s).replace(/\s+/g, ' ').slice(0, n);

/** USER 블록에서 12자 안쪽 한 줄을 뽑는다(자막 후보). 없으면 빈 문자열. */
export function pickLines(blocks, max, limit) {
  const out = [];
  (blocks || []).forEach((b) => {
    if (!b || b.origin !== 'USER') return;
    b.text.split('\n').map((s) => s.trim()).filter(Boolean).forEach((line) => {
      if (line.length <= (max || 16) && out.length < (limit || 6)) out.push(line);
    });
  });
  return out;
}

/** 제목 문법: 구체 디테일 하나 + 잘린 궁금증 (형용사 금지) */
export function shortTitle(facts, blocks) {
  const f = facts || {};
  const place = clean(f.place_name) || '[가게]';
  const first = clean(f.price_menu).split(/[·,]/)[0].trim();
  const price = first.split(/\s+/)[0];            // "냉동삼겹" 처럼 메뉴 이름만
  const detail = price || short((pickLines(blocks, 14, 1)[0] || ''), 14);
  const tail = clean(f.wait_time) ? short(f.wait_time, 12) : '';
  return (detail ? place + ' ' + detail : place) + (tail ? ' ' + tail : '') + ' …';
}

export function composeShorts({ facts, blocks, slots, brand }) {
  const f = facts || {};
  const beats = Array.isArray(slots) ? slots : [];
  const cuts = beats.map((s, i) => ({
    no: i + 1,
    role: s.role,
    time: s.start + '–' + s.end + 's',
    media: s.media || '[컷 비어 있음]',
    subtitle: short(
      (i === 0 && pickLines(blocks, 12, 1)[0]) || (f.price_menu && /증거/.test(s.role || '') ? short(f.price_menu, 14) : '') || s.note,
      14
    )
  }));
  const lines = pickLines(blocks, 14, 6);
  return {
    brand: brand || 'daejeon_youth',
    length_sec: brand === 'ppiyak_kimmary' ? 15 : 25,
    cut_count: cuts.length,
    title: shortTitle(f, blocks),
    cuts,
    caption: lines.length ? lines.slice(0, 3).join(' / ') : short(f.price_menu || f.place_name, 40),
    pinned_comment: '📍 위치·메뉴판·솔직 단점은 블로그에 정리했습니다',
    checks: [
      { id: 'vertical', ok: cuts.every((c) => c.media !== '[컷 비어 있음]'), msg: '모든 비트에 컷이 배정됐는가' },
      { id: 'safe_area', ok: true, msg: '자막 안전영역 상단 14%·하단 22%' },
      { id: 'cut_count', ok: cuts.length >= 14 && cuts.length <= 20, msg: '컷 14~20 (현재 ' + cuts.length + ')' }
    ]
  };
}

export function composeClip({ facts, blocks, slots }) {
  const f = facts || {};
  const segs = (Array.isArray(slots) ? slots : []).map((s) => ({
    time: s.start + '–' + s.end + 's',
    media: s.media || '[세로 원본 필요]',
    overlay: short(f.place_name + (f.price_menu ? ' · ' + f.price_menu : ''), 24)
  }));
  const catTag = short(f.category || '맛집', 8).replace(/[·/,\s]+/g, '');
  const base = ['대전맛집', (clean(f.region_dong) || '유성').replace(/\s/g, '') + '맛집', (clean(f.place_name) || '대전클립').replace(/\s/g, ''), '오늘클립챌린지', catTag].filter(Boolean);
  return {
    title: shortTitle(f, blocks),
    segments: segs,
    place_tag: clean(f.place_name) || '[장소 태그 확인 필요]',
    hashtags: base.slice(0, 5).map((t) => '#' + t.replace(/\s+/g, '')),
    checks: [
      { id: 'original', ok: segs.length > 0, msg: '세로 원본만 쓴다(워터마크 제거)' },
      { id: 'length', ok: true, msg: '15~30초 구간 지정' },
      { id: 'challenge', ok: true, msg: '#오늘클립챌린지 포함 · 주 3영상/5게시물 카운트' }
    ]
  };
}

export function composeDaangn({ facts, blocks, slots }) {
  const f = facts || {};
  const place = clean(f.place_name) || '[가게]';
  const dong = clean(f.region_dong) || '대전';
  const segs = (Array.isArray(slots) ? slots : []);
  // 팁은 앞머리 훅이 아니라 뒤쪽 문장에서 고른다(첫 줄은 보통 도입 챕터다)
  const allLines = [];
  (blocks || []).forEach((b) => { if (b && b.origin === 'USER') b.text.split('\n').map((x) => x.trim()).filter(Boolean).forEach((x) => allLines.push(x)); });
  const tips = allLines.slice(1).filter((x) => x.length >= 10 && x.length <= 40).sort((a, b) => b.length - a.length);
  const tipLines = tips.slice(0, 1);
  const price = short(f.price_menu, 30);
  const first = '[' + dong + ' ' + place + ']' + (price ? ' ' + price : '');
  const second = tipLines.length ? tipLines[0] : short(f.wait_time || f.parking, 30);
  const desc = (first + '\n' + (second || '')).trim();
  const tags = ['대전맛집', dong + '맛집', dong + '고기집'].filter(Boolean).slice(0, 3);
  return {
    duration_sec: segs.length ? Math.min(25, Math.max(15, segs.length * 4)) : 0,
    description: desc,
    place_tag: place,
    tags: tags.map((t) => '#' + t.replace(/\s+/g, '')),
    checks: [
      { id: 'video', ok: segs.length > 0, msg: '영상 필수(10초↑) · 정지 사진 50% 이하' },
      { id: 'desc_len', ok: desc.replace(/\s/g, '').length >= 30, msg: '설명 30자↑ (현재 ' + desc.replace(/\s/g, '').length + '자)' },
      { id: 'no_url', ok: !/https?:\/\//.test(desc), msg: '외부 링크 금지' },
      { id: 'disclosure', ok: true, msg: '협찬이면 첫 줄 #광고 #협찬' }
    ]
  };
}

export function composeInstagram(kind, { facts, blocks, slots }) {
  const f = facts || {};
  const dong = clean(f.region_dong) ? clean(f.region_dong).replace(/\s+/g, '') : '대전';
  const catTag = short(f.category || '맛집', 6).replace(/[·/,\s]+/g, '');
  const tags = ['대전맛집', dong + '맛집', (clean(f.place_name) || '대전').replace(/\s/g, ''), catTag, dong + '술집']
    .filter(Boolean).slice(0, 5).map((t) => '#' + t.replace(/\s+/g, ''));
  if (kind === 'feed') {
    const slides = (Array.isArray(slots) ? slots : []).map((s, i) => ({
      no: i + 1,
      media: s.media || '[사진 필요]',
      role: s.role,
      copy: i === 0 ? (clean(f.place_name) || '') + (f.price_menu ? ' · ' + short(f.price_menu, 18) : '') : s.role
    }));
    return {
      kind: 'feed',
      slides,
      caption: [clean(f.place_name) || '', short(f.price_menu, 30), '자세한 후기는 블로그에'].filter(Boolean).join('\n'),
      hashtags: tags,
      checks: [
        { id: 'count', ok: slides.length >= 5 && slides.length <= 8, msg: '5~8장 (현재 ' + slides.length + '장)' },
        { id: 'd_plus', ok: true, msg: '블로그 D+1~2 시차 발행' }
      ]
    };
  }
  const lines = pickLines(blocks, 16, 2);
  return {
    kind: 'reels',
    caption: (lines.length ? lines.join('\n') : short(f.place_name, 30)) + '\n\n저장해 두고 가세요 📌',
    hashtags: tags,
    length_sec: 15,
    checks: [
      { id: 'tags', ok: tags.length === 5, msg: '해시태그 정확히 5개' },
      { id: 'hook', ok: lines.length > 0, msg: '첫 2줄 훅 · 저장 유도 1회' }
    ]
  };
}

if (typeof window !== 'undefined') {
  window.OnestopChannels = { composeShorts, composeClip, composeDaangn, composeInstagram, shortTitle, pickLines };
}
