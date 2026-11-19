'use strict';
/**
 * tools/analytics/lib/estimate.js — 예상 수익 · 성과 점수
 *
 * 원칙: 실제 정산액이 아닌 값은 반드시 "추정"으로 표시한다(revenue_estimated = true).
 *  · 유튜브(수익화 전)  : 정산이 없으므로 확정 수익은 0원. 화면에는 조회수 × 가정 RPM 의 '추정'만 보여 준다.
 *  · 유튜브(수익화 후)  : Analytics API 가 준 estimatedRevenue 를 쓰고 추정 표시를 유지한다(구글도 추정치).
 *  · 인스타그램        : 조회 정산 개념이 없다 → 예상 수익은 숨기고(0), 확정 협찬액만 사람이 넣는다.
 */

/** 1,000회 조회당 가정 단가(원). 실제 정산과 다르므로 Config 로 바꿀 수 있게 둔다. */
const DEFAULT_RPM_KRW = {
  shorts: 30,       // 국내 쇼츠 실제 대역 15~60원의 중간값 — 150원은 과대 착시를 만든다
  longform: 2500,   // 롱폼 일반 대역(2,000~5,000)의 보수적 값
  reels: 0,         // 인스타는 조회 정산 없음
  feed: 0,
  channel: 0
};

const REVENUE_REASON = {
  MONETIZATION_NOT_ENABLED: '수익창출 전 채널 — 예상 수익만 표시(정산 없음)',
  NO_PAYOUT: '인스타그램은 조회 정산이 없어 예상 수익을 표시하지 않음',
  OK: '가정 RPM 기준 추정치 — 실제 정산과 다름'
};

function rpmFor(channel, table) {
  const t = Object.assign({}, DEFAULT_RPM_KRW, table || {});
  const n = Number(t[channel]);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * @param {{channel:string, views:number, monetized?:boolean, rpmTable?:object,
 *          confirmedRevenue?:number, source?:string}} opts
 * @returns {{krw:number, estimated:boolean, rpm:number, reason:string, label:string}}
 */
function estimateRevenue(opts) {
  const o = opts || {};
  const confirmed = Number(o.confirmedRevenue) || 0;
  if (o.source === 'instagram') {
    return { krw: confirmed, estimated: confirmed > 0, rpm: 0, reason: 'NO_PAYOUT', label: confirmed > 0 ? '협찬 확정' : '정산 없음' };
  }
  const rpm = rpmFor(o.channel, o.rpmTable);
  if (o.monetized && confirmed > 0) {
    return { krw: Math.round(confirmed), estimated: true, rpm, reason: 'OK', label: '추정' };
  }
  if (!o.monetized) {
    const views = Number(o.views) || 0;
    return { krw: Math.round((views / 1000) * rpm), estimated: true, rpm, reason: 'MONETIZATION_NOT_ENABLED', label: '예상(추정)' };
  }
  const views = Number(o.views) || 0;
  return { krw: Math.round((views / 1000) * rpm), estimated: true, rpm, reason: 'OK', label: '추정' };
}

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

module.exports = { DEFAULT_RPM_KRW, REVENUE_REASON, rpmFor, estimateRevenue, performanceScore, mediansByChannel };
