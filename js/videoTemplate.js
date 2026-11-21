// js/videoTemplate.js — 채널 시그니처 영상 템플릿(2026-11-21)
//   노트북 hub-agent/notebook-agent/lib/template.js 와 같은 값·같은 규칙의 허브 쪽 사본이다.
//   허브는 오더를 보내기 전에 문구를 다듬고(길이·제어문자), 노트북이 한 번 더 검사한다.
//   수치의 원본은 seeds/video_template.json — 화면과 노트북이 같은 표를 본다.
export const TEMPLATE_IDS = ['auto', 'none', 'daejeon_youth', 'ppiyak_kimmary'];
export const TEMPLATE_LABELS = {
  auto: '자동 (트랙 기본)',
  none: '없음 (예전처럼 자막만)',
  daejeon_youth: '대전 청년',
  ppiyak_kimmary: '삐약 김메리'
};
export const TEMPLATE_LIMITS = { title: 40, badge: 14, hook: 16, outro: 24 };
// 트랙별 기본값 — '자동'을 골랐을 때 화면에 미리 보여 준다.
export const TEMPLATE_DEFAULTS = {
  daejeon_youth: { badge: '지역 · 카테고리', hook: '핵심 키워드', outro: '다음 코스는? 구독' },
  ppiyak_kimmary: { badge: '', hook: '', outro: '메리 더 보기' }
};

const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g;

/** 한 줄로 다듬는다 — 제어문자 제거, 공백 정리, 길이 상한. 이모지는 노트북이 렌더에서 지운다. */
export function trimTemplateText(value, max) {
  const s = String(value == null ? '' : value).replace(CONTROL_RE, '').replace(/\r\n?/g, '\n').replace(/[\t ]+/g, ' ').trim();
  return s.length > max ? s.slice(0, max).trim() : s;
}

/**
 * 오더에 실을 템플릿 칸. template 은 항상 싣는다('auto' 포함) — 노트북이 브랜드 기본을 고른다.
 * 반환: { ok, fields, errors }
 */
export function buildTemplateFields({ template, title, badge, hook, outro } = {}) {
  const errors = [];
  const t = String(template == null || template === '' ? 'auto' : template).trim().toLowerCase();
  if (TEMPLATE_IDS.indexOf(t) < 0) errors.push('템플릿은 ' + TEMPLATE_IDS.join(' · ') + ' 중 하나여야 해요');
  const fields = { template: t };
  if (t !== 'none') {
    const vals = { title, badge, hook, outro };
    Object.keys(TEMPLATE_LIMITS).forEach((k) => {
      const v = trimTemplateText(vals[k], TEMPLATE_LIMITS[k]);
      if (v) fields[k] = v;
    });
  }
  return { ok: errors.length === 0, fields, errors };
}

/** 트랙·템플릿으로 화면에 보여 줄 기본 문구(빈 칸 placeholder). */
export function templateHint(brand, template) {
  const t = template === 'auto' || !template ? brand : template;
  const d = TEMPLATE_DEFAULTS[t];
  return d || null;
}
