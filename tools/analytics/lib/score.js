'use strict';
/**
 * tools/analytics/lib/score.js — 성과 점수(파생 지표)
 *
 * 원칙: 여기서 돈을 만들지 않는다.
 *  · 수익(revenue_krw)은 플랫폼이 보고한 값(YPP)이나 사람이 확정한 협찬·제휴액만 쓴다.
 *  · 조회수 × 가정 단가 같은 계산은 두지 않는다 — 실제 데이터가 아니기 때문이다.
 *  · 이 파일은 실제 수집값만으로 계산되는 점수만 남긴다(같은 표면 중위수 대비 조회·반응·저장).
 */

/**
 * 성과 점수 0~100 — 같은 표면 안에서 중위수 대비 조회(60) + 반응률(30) + 저장·공유(10).
 * 중위수가 없으면 조회 항목은 0으로 두고 반응률만 반영한다(절대 점수로 오해하지 않게 note 로 알린다).
 */
function performanceScore(row, opts) {
  const o = opts || {};
  const views = Number(row.views) || 0;
  const median = Number(o.medianViews) || 0;
  const interactions = (Number(row.likes) || 0) + (Number(row.comments) || 0);
  const deep = ((Number(row.saves) || 0) + (Number(row.shares) || 0)) * 2;

  const viewPart = median > 0 ? Math.min(60, (views / median) * 30) : 0;
  const base = Math.max(views, Number(row.reach) || 0, 1);
  const engageRate = Math.min(0.15, interactions / base);
  const engagePart = (engageRate / 0.15) * 30;
  const deepRate = Math.min(0.05, deep / base);
  const deepPart = (deepRate / 0.05) * 10;

  return Math.round(Math.min(100, viewPart + engagePart + deepPart) * 10) / 10;
}

/** 표면별 중위 조회수 — 점수 계산 기준. */
function mediansByChannel(rows) {
  const groups = {};
  (rows || []).forEach((r) => {
    if (!r || !r.channel) return;
    if (['channel'].indexOf(r.channel) >= 0) return;
    const v = Number(r.views) || 0;
    if (!v) return;
    (groups[r.channel] = groups[r.channel] || []).push(v);
  });
  const out = {};
  Object.keys(groups).forEach((ch) => {
    const list = groups[ch].slice().sort((a, b) => a - b);
    const mid = Math.floor(list.length / 2);
    out[ch] = list.length % 2 ? list[mid] : Math.round((list[mid - 1] + list[mid]) / 2);
  });
  return out;
}

module.exports = { performanceScore, mediansByChannel };
