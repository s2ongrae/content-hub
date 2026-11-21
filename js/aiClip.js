// js/aiClip.js — 무료 AI 클립(구글 Flow·허깅페이스) 프롬프트 빌더 (2026-11-21)
//
// 왜 필요한가: 구글 Flow 는 하루 50크레딧, 허깅페이스 Space 는 ZeroGPU 하루 5분이 공짜다.
//   둘 다 '영어 프롬프트 + 무자막' 규칙만 지키면 우리 숏폼에 쓸 짧은 컷이 나온다.
//   다만 한글·자막은 거의 항상 깨지고, 한국 계정 Flow 결과물엔 워터마크가 붙는다.
//   그래서 **AI 에서는 무자막 클립만 뽑고**, 자막·내레이션·템플릿은 노트북 렌더(content_render, 토큰 0)가 붙인다.
//
// 수치의 원본은 seeds/ai_video_free.json — 이 화면·노트북 도구(notebook-agent/tools/aiclip.js)·시험이 같은 표를 본다.
//   (Google Flow 고객센터 2026-11-21 확인 + Space 의 /gradio_api/info 실측)
// 원칙: textContent/createElement 만(h() 사용). innerHTML 금지. 폰 360px 가로 스크롤 0.
'use strict';

export const FLOW = {
  dailyCredits: 50,
  minSeconds: 3,
  maxSecondsFree: 10,
  creditsPerSecond: { '360p': 1, '720p': 3 },
  aspect: '9:16',
  peakBlockKst: 'KST 23:00~02:00',
  watermarkRegions: ['KR', 'IN', 'VN']
};

export const SPACES = {
  wan_i2v: {
    label: 'Wan2.2 14B Fast (사진 → 움직이는 컷)',
    repo: 'zerogpu-aoti/wan2-2-fp8da-aoti-faster',
    fn: '/generate_video',
    freeMinutesPerDay: 5
  },
  wan_animate: {
    label: 'Wan2.2 Animate (동작 입히기)',
    repo: 'alexnasa/Wan2.2-Animate-ZEROGPU',
    fn: '/animate_scene',
    freeMinutesPerDay: 5
  }
};

// 무자막 강제 접미사 — 이게 빠지면 영상 안에 글자가 그려진다.
export const NO_TEXT_SUFFIX = 'No text, no captions, no letters, no watermark, no logo, no on-screen graphics.';
export const NEGATIVE = 'text, captions, subtitles, letters, watermark, logo, UI overlay, extra limbs, deformed paws, fused toes, distorted face, multiple heads, flickering, morphing, jump cut, cartoon, 3d render, oversaturated, plastic skin, heavy vignette';

// 다시 뽑기 판정 5개 — 사람이 3초 안에 보는 것.
export const JUDGE = [
  '글자·숫자·로고가 1글자라도 보이면 버린다(한글은 거의 항상 깨진다).',
  '고양이라면 다리 개수·발가락·얼굴 윤곽을 먼저 본다. 3개 다리·합쳐진 발은 버린다.',
  '컷마다 피사체 무늬·눈색이 바뀌면 그 컷은 버린다(연속성이 깨진다).',
  '카메라가 튀거나 0.3초도 안 되는 컷이 섞이면 다시 뽑는다.',
  '템플릿 자막 자리(상단 240px·하단 500px)를 피사체가 가리면 다시 뽑는다.'
];

// 넣는 규격 — 360p·워터마크 클립은 1.25배 크롭해 1~2초만.
export const INSERT = {
  cropZoom: 1.18,
  minSeconds: 1.0,
  maxSeconds: 2.5,
  maxShareOfFinal: 0.2,
  maxShareOfFinalYouTube: 0.3
};

// 장면 프리셋 — {소재} 자리에 사용자 입력이 들어간다.
export const PRESETS = {
  product_scene: {
    label: '상품 컷 (묘한살림)',
    subject: 'the product',
    scene: 'A single {subject} sits on a {surface} in a real Korean apartment corner. Soft window light from the left, gentle camera push-in, dust motes in the light, shallow depth of field, honest everyday look.',
    motion: 'slow dolly in, subtle parallax, product stays in frame the whole shot'
  },
  daily_broll: {
    label: '대전 일상 B롤',
    subject: 'a quiet street corner',
    scene: 'A {subject} in Daejeon before sunset, wet asphalt reflections, natural handheld feel, 26mm lens look, muted colors.',
    motion: 'slow handheld pan, tiny step forward, natural shake'
  },
  mary_action: {
    label: '메리 동작 (레퍼런스 춤)',
    subject: 'a British Shorthair cat',
    scene: 'A {subject} is the only character in a sunlit living room, soft natural light, candid home video look.',
    motion: 'the cat performs the dance moves of the reference clip: two front paws up, then body sway, then a small hop'
  }
};

export const MARY_FEATURES = 'round chubby cheeks, wide copper eyes, dense blue-gray coat with a lighter belly, small ears, short thick tail';
export const MARY_KEEP = 'keep the exact face shape, eye color, coat pattern, body proportion and tail length from the reference image in every frame';
export const MARY_ANATOMY = 'four legs only, two front paws with five toes each, one head, one tail, no extra limbs, no human hands, no anthropomorphic standing on two legs unless the reference pose requires it';

/** 초 × 해상도 → 크레딧. 모르는 해상도는 720p 로 본다(비싼 쪽). */
export function creditCost(seconds, resolution) {
  const sec = Number(seconds);
  const rate = FLOW.creditsPerSecond[resolution] || FLOW.creditsPerSecond['720p'];
  if (!isFinite(sec) || sec <= 0) return 0;
  return Math.round(sec * rate);
}

/** 그날 남은 크레딧으로 이 묶음을 몇 번 뽑을 수 있나. */
export function fitsBudget(clips, resolution) {
  const each = creditCost(clips.seconds, resolution);
  const total = each * Math.max(1, Number(clips.count) || 1);
  return { each, total, fits: total <= FLOW.dailyCredits, left: FLOW.dailyCredits - total };
}

/**
 * Flow 에 그대로 붙여넣을 프롬프트를 만든다.
 *  input: { preset, subject, surface, action, seconds, resolution }
 *  반환: { ok, prompt, negative, credits, seconds, notes[] }
 */
export function buildFlowPrompt(input) {
  const o = input || {};
  const key = PRESETS[o.preset] ? o.preset : 'product_scene';
  const p = PRESETS[key];
  const subject = String(o.subject == null ? '' : o.subject).trim() || p.subject;
  const surface = String(o.surface == null ? '' : o.surface).trim() || 'worn wooden side table';
  let seconds = Number(o.seconds);
  if (!isFinite(seconds) || seconds <= 0) seconds = 4;
  seconds = Math.min(FLOW.maxSecondsFree, Math.max(FLOW.minSeconds, Math.round(seconds)));
  const resolution = FLOW.creditsPerSecond[o.resolution] ? o.resolution : '720p';
  const action = String(o.action == null ? '' : o.action).trim() || p.motion;

  const scene = p.scene.replace(/\{subject\}/g, subject).replace(/\{surface\}/g, surface);
  const lines = [
    scene,
    'Motion: ' + action + '.',
    'Camera and framing: 9:16 vertical, subject centered, keep the top 240px and the bottom 500px visually calm (Korean captions go there later).',
    NO_TEXT_SUFFIX
  ];
  const notes = [];
  if (resolution === '360p') notes.push('360p 는 1080 폭으로 늘리면 흐려진다 — 꼭 필요한 재시도용으로만.');
  if (creditCost(seconds, resolution) > FLOW.dailyCredits) notes.push('하루 50크레딧을 넘는다 — 길이나 해상도를 낮춰라.');
  if (key === 'mary_action') notes.push('메리는 Flow Ingredients 에 메리 사진을 먼저 올리고, 아래 4단 프롬프트를 쓴다.');
  return {
    ok: true,
    preset: key,
    prompt: lines.join('\n'),
    negative: NEGATIVE,
    seconds,
    resolution,
    credits: creditCost(seconds, resolution),
    aspect: FLOW.aspect,
    notes
  };
}

/** 메리 사진에 동작을 입히는 4단 프롬프트 — ①장면 ②역할 ③특징 고정 ④유지. */
export function maryPrompt(input) {
  const o = input || {};
  const features = String(o.features == null ? '' : o.features).trim() || MARY_FEATURES;
  const motion = String(o.motion == null ? '' : o.motion).trim() || PRESETS.mary_action.motion;
  return [
    '[1. SCENE] Vertical 9:16 indoor living room shot, warm natural daylight, eye-level static camera, soft bokeh background.',
    '[2. ROLE] The uploaded image is the ONLY character reference (' + features + '). Copy its identity, not its pose. The reference clip supplies the motion only: ' + motion + '.',
    '[3. IDENTITY LOCK] ' + MARY_KEEP + '. Do not restyle the fur, do not change the pattern.',
    '[4. KEEP] ' + MARY_ANATOMY + '. Camera stays wide enough to see all four paws. ' + NO_TEXT_SUFFIX
  ].join('\n');
}

/** 완제품 길이에서 AI 클립이 차지해도 되는 초 — 네이버 클립은 20%, 유튜브만 30%. */
export function maxInsertSeconds(finalSeconds, platform) {
  const ratio = platform === 'youtube' ? INSERT.maxShareOfFinalYouTube : INSERT.maxShareOfFinal;
  const total = Number(finalSeconds);
  if (!isFinite(total) || total <= 0) return 0;
  return Math.floor(total * ratio * 10) / 10;
}

/* ────────────────────────── 화면 ────────────────────────── */

/**
 * 'AI 클립' 패널 — 제작 스튜디오 영상 화면에 붙는다.
 * 기존 클래스(.panel/.btn/.st-hint/.field)만 쓴다 — style.css 를 고치지 않는다(병렬 작업 충돌 방지).
 */
export function paintAiClip(host, ctx) {
  const { h, toast } = ctx;
  const wrap = h('div', { class: 'panel st-aiclip' },
    h('h3', null, '🪄 AI 클립 (구글 Flow · 허깅페이스, 무료)'),
    h('p', { class: 'st-hint', text: 'Flow 는 하루 50크레딧, 허깅페이스는 ZeroGPU 하루 5분이 공짜입니다. 여기서 만든 영어 프롬프트를 Flow 에 붙여넣고, 나온 무자막 클립을 ①영상 올리기로 가져오세요.' }));

  const presetSel = h('select', { class: 'input', 'aria-label': '장면 종류' });
  Object.keys(PRESETS).forEach((k) => presetSel.appendChild(h('option', { value: k, text: PRESETS[k].label })));
  const subjectIn = h('input', { class: 'input', placeholder: '소재 (영문 권장, 비우면 기본값)', autocomplete: 'off' });
  const secondsSel = h('select', { class: 'input', 'aria-label': '길이' });
  [3, 4, 5, 6, 8, 10].forEach((s) => secondsSel.appendChild(h('option', { value: String(s), text: s + '초', selected: s === 4 ? 'selected' : null })));
  const resSel = h('select', { class: 'input', 'aria-label': '해상도' });
  ['720p', '360p'].forEach((r) => resSel.appendChild(h('option', { value: r, text: r + (r === '720p' ? ' (권장)' : ' (재시도용)') })));

  wrap.appendChild(h('div', { class: 'st-field-row' }, h('span', { class: 'field-label', text: '장면' }), presetSel));
  wrap.appendChild(h('label', { class: 'field' }, h('span', { class: 'field-label', text: '소재' }), subjectIn));
  wrap.appendChild(h('div', { class: 'st-field-row' }, h('span', { class: 'field-label', text: '길이' }), secondsSel));
  wrap.appendChild(h('div', { class: 'st-field-row' }, h('span', { class: 'field-label', text: '해상도' }), resSel));

  const out = h('textarea', { class: 'input', rows: '7', readonly: 'readonly', 'aria-label': 'Flow 프롬프트' });
  const meta = h('p', { class: 'st-hint', text: '' });
  const notes = h('div', { class: 'st-hint' });

  const refresh = () => {
    const r = buildFlowPrompt({
      preset: presetSel.value, subject: subjectIn.value,
      seconds: secondsSel.value, resolution: resSel.value
    });
    out.value = r.prompt;
    meta.textContent = '이 클립 ' + r.credits + '크레딧 · 하루 50크레딧 중 (남는 만큼 다시 뽑기) · ' + r.aspect + ' ' + r.seconds + '초 · ' + r.resolution;
    notes.replaceChildren();
    r.notes.forEach((n) => notes.appendChild(h('p', { class: 'st-hint', text: '· ' + n })));
  };
  [presetSel, secondsSel, resSel].forEach((el) => el.addEventListener('change', refresh));
  subjectIn.addEventListener('input', refresh);

  const copyBtn = h('button', { class: 'btn sm', type: 'button', text: '프롬프트 복사' });
  copyBtn.addEventListener('click', async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(out.value);
        toast('프롬프트를 복사했습니다 — Flow 에 붙여넣으세요', 'ok');
      } else {
        out.select();
        toast('복사가 막혀 있어요 — 프롬프트를 길게 눌러 직접 복사하세요', '');
      }
    } catch (e) {
      out.select();
      toast('복사가 막혀 있어요 — 프롬프트를 길게 눌러 직접 복사하세요', '');
    }
  });

  const negBtn = h('button', { class: 'btn sm', type: 'button', text: '네거티브 복사' });
  negBtn.addEventListener('click', async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(NEGATIVE);
        toast('네거티브를 복사했습니다', 'ok');
      } else {
        toast('복사가 막혀 있어요', '');
      }
    } catch (e) { toast('복사가 막혀 있어요', ''); }
  });

  wrap.appendChild(out);
  wrap.appendChild(h('div', { class: 'row' }, copyBtn, negBtn));
  wrap.appendChild(meta);
  wrap.appendChild(notes);

  // 메리 4단 프롬프트 — 트랙 B 에서 특히 쓴다.
  const maryBox = h('textarea', { class: 'input', rows: '6', readonly: 'readonly', 'aria-label': '메리 4단 프롬프트' });
  maryBox.value = maryPrompt({});
  const maryCopy = h('button', { class: 'btn sm', type: 'button', text: '메리 4단 프롬프트 복사' });
  maryCopy.addEventListener('click', async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(maryBox.value);
        toast('메리 프롬프트를 복사했습니다', 'ok');
      } else { toast('복사가 막혀 있어요', ''); }
    } catch (e) { toast('복사가 막혀 있어요', ''); }
  });

  const details = h('details', null,
    h('summary', { class: 'st-hint', text: '메리 사진에 춤 동작 입히기 (4단 프롬프트 · Wan2.2 Animate)' }),
    h('p', { class: 'st-hint', text: '1차: Flow → Ingredients 에 메리 사진을 올리고 [2. ROLE] 의 동작 문장을 춤에 맞게 고쳐 뽑는다. 2차: 노트북이 허깅페이스 Wan2.2 Animate(Pose Retarget)로 춤 영상의 동작만 메리에 입힌다 — 2초에 GPU 3분이라 하루 1~2편.' }),
    maryBox, maryCopy);
  wrap.appendChild(details);

  // 다시 뽑기 판정 5개
  const judge = h('ul', { class: 'st-hint' });
  JUDGE.forEach((j) => judge.appendChild(h('li', { text: j })));
  wrap.appendChild(h('details', null, h('summary', { class: 'st-hint', text: '다시 뽑기 판정 5개 (3초 점검)' }), judge));

  wrap.appendChild(h('p', { class: 'st-hint', text: '넣는 규격: 1.18배 크롭으로 가장자리 워터마크를 잘라내고 1080×1920 에 1~2.5초만 넣습니다. AI 클립은 네이버 클립 기준 끝까지 20% 이하(유튜브는 30%), 소리는 버리고 렌더가 내레이션·자막을 붙입니다.' }));

  host.appendChild(wrap);
  refresh();
  return wrap;
}
