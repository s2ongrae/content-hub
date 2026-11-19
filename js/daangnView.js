/**
 * js/daangnView.js — 당근 스토리 데이터 (수치·문구)
 *
 * 2026-11-19 개편: 화면(수익화 트래커·'올리기 전 점검' 체크박스)은 걷어냈다.
 *  · 사용자는 점검 항목을 체크하지 않는다 — 카드 대본·영상 길이로 자동 판정하고,
 *    규칙을 어겼을 때만 경고 1줄이 뜬다(js/cardPerf.js daangnWarnings).
 *  · 수익화 진행(인정 스토리 N/5 · 유효시청 N/2,000)은 카드 상세의 당근 채널 타일과
 *    성과분석(#/perf) 월 KPI가 보여 준다(js/cardPerf.js daangnGoal).
 *
 * 데이터: seeds/daangn_story_v1.json — 수치·문구의 단일 출처.
 */

const SEED_URL = 'seeds/daangn_story_v1.json';

const FALLBACK = {
  channel: { key: 'daangn', label: '당근', full_label: '당근 스토리' },
  eligibility: { stories_per_month: 5, valid_views_per_month: 2000, min_duration_sec: 10,
    min_description_chars: 30, submit_within_days: 3, notify: '다음 날 오전 11시',
    submit_path: '당근폼 프로필 제출', keep_stories_per_month: 2 },
  reward: { base_per_video_krw: [100, 1000], performance: '다음 달 5일 전후 월 집계',
    performance_min_krw: 1000, payout: '당근페이 필수' },
  warnings: ['같은 달 같은 장소(가게) 태그는 1회만 인정']
};

let seedPromise = null;

export function loadDaangnSeed() {
  if (!seedPromise) {
    seedPromise = fetch(`${SEED_URL}?v=2`, { cache: 'no-cache' })
      .then((res) => (res.ok ? res.json() : FALLBACK))
      .then((json) => Object.assign({}, FALLBACK, json))
      .catch(() => FALLBACK);
  }
  return seedPromise;
}
