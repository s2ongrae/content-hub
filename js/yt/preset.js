/**
 * js/yt/preset.js — 숏폼 프리셋(당근 스타일)과 대본 뼈대 생성
 *
 * 프리셋 데이터: seeds/skills/shorts_preset.json
 *   기본 = daangn-local-v1(대전 청년, 25초 6비트). 변형 = merry-jjalbang-v1(메리, 무내레이션 15초 4비트).
 *   비트마다 타임코드·화면 지시(ON SCREEN)·자막 배치가 붙는다.
 *
 * 여기서 만드는 건 '뼈대'다. 문장을 지어내지 않는다. 확인한 값(가격·대기·총액)은
 * 인자로 받고, 없으면 [채우기]로 남긴다. 확인하지 않은 숫자가 자막에 들어가면
 * 그 영상의 신뢰가 통째로 깎이기 때문이다.
 *
 * 발화 속도(어절/분)는 트랙별 상수다 — 대사형과 짤방형의 밀도가 다르다.
 */

const PRESET_URL = 'seeds/skills/shorts_preset.json';

let cache = null;

export async function loadPreset(force) {
  if (cache && !force) return cache;
  const res = await fetch(`${PRESET_URL}?v=2`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`프리셋을 불러오지 못했습니다 (HTTP ${res.status})`);
  cache = await res.json();
  return cache;
}

/** 트랙에 맞는 프리셋을 고른다 — 변형이 있으면 변형, 없으면 기본. */
export function pickPreset(data, brand) {
  const baseSlot = data.slot_seconds || (data.beats ? data.beats[data.beats.length - 1].end : 25);
  const variants = data.variants || [];
  const v = variants.filter((x) => (x.tracks || []).indexOf(brand) >= 0)[0];
  if (!v) return { ...data, slot_seconds: baseSlot, is_variant: false };
  return {
    ...data,
    slot_seconds: baseSlot,
    ...v,
    is_variant: true,
    channels: data.channels,
    source: data.source,
    // 변형이 덮어쓰지 않은 필드는 기본값을 물려받는다
    cuts_copy: data.cut_rhythm
  };
}

const FILL = (v, fallback) => (v && String(v).trim() ? String(v).trim() : fallback);

export function buildScript(preset, ctx = {}) {
  const place = FILL(ctx.place, '[가게·등장 대상]');
  const hook = FILL(ctx.hook, preset.silent
    ? '[자막 훅: 화면에서 벌어지는 일 8~14자]'
    : `[훅: ${place}에서 확인한 숫자 하나로 7~20어절]`);
  const payload = {
    훅: hook,
    핵심: FILL(ctx.point, '[이 영상에서 알게 되는 것 한 가지]'),
    가격: FILL(ctx.price, '[가격: 미확인]'),
    대기: FILL(ctx.wait, '[대기: 미확인]'),
    단점: FILL(ctx.con, '[단점: 실제로 겪은 것 1개]'),
    총액: FILL(ctx.total, '[총액: 미확인]'),
    상황: FILL(ctx.when, '[저장해 둘 상황]')
  };
  const fill = (s) => String(s || '').replace(/\{([^}]+)\}/g, (_, k) => payload[k.trim()] || `[${k.trim()}]`);

  const beats = (preset.beats || []).map((b) => ({
    role: b.role,
    label: b.label,
    start: b.start,
    end: b.end,
    timecode: `${b.start.toFixed(1)}–${b.end.toFixed(1)}초`,
    speech: fill(b.speech),
    guide: b.guide || '',
    screen: b.screen,
    caption: b.caption,
    sound: b.sound,
    note: b.note
  }));

  const rateMap = preset.speech_rate_eopm || {};
  const rate = typeof rateMap === 'number' ? rateMap : (Number(preset.speech_rate_eopm) || 150);
  const trackRate = typeof preset.speech_rate_eopm === 'object' && preset.tracks && preset.tracks[0]
    ? (preset.speech_rate_eopm[preset.tracks[0]] || 150)
    : rate;
  const unitCount = beats.reduce((a, b) => a + b.speech.replace(/\(무내레이션\)\s*자막:\s*/, '').trim().split(/\s+/).filter(Boolean).length, 0);
  const slot = preset.slot_seconds || preset.beats[preset.beats.length - 1].end;
  const speechSec = preset.silent ? slot : (unitCount / trackRate) * 60;

  return {
    preset_id: preset.id,
    preset_name: preset.name,
    silent: !!preset.silent,
    is_variant: !!preset.is_variant,
    beats,
    eojeol: unitCount,
    rate: trackRate,
    speech_seconds: Number(speechSec.toFixed(1)),
    slot_seconds: slot,
    over: !!(preset.silent ? false : speechSec > slot + 1),
    cuts_expected: preset.cut_rhythm ? preset.cut_rhythm.cuts_per_25s.join('~') : '-',
    angle_seconds_avg: preset.cut_rhythm ? preset.cut_rhythm.avg_cut_seconds.join('~') : '-'
  };
}

export function scriptToText(result) {
  const lines = [];
  lines.push(`# ${result.preset_name} 대본 뼈대 (${result.preset_id})`);
  lines.push(result.silent
    ? `무내레이션 · 자막 ${result.eojeol}어절 · 슬롯 ${result.slot_seconds}초 · 예상 컷 ${result.cuts_expected}개`
    : `말 ${result.eojeol}어절 · ${result.speech_seconds}초(분당 ${result.rate}어절) · 슬롯 ${result.slot_seconds}초 · 예상 컷 ${result.cuts_expected}개`);
  lines.push('');
  lines.push('구간\t말\t지시\t화면(ON SCREEN)\t자막·배치');
  result.beats.forEach((b) => {
    lines.push(`${b.timecode}\t${b.speech}\t${b.guide}\t${b.screen}\t${b.caption}`);
  });
  lines.push('');
  lines.push('컷 리듬: 평균 ' + result.angle_seconds_avg + '초, 첫 컷 1.0초 안, 한 샷 3초 넘기지 않기');
  return lines.join('\n');
}
