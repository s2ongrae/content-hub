/**
 * js/blogTrend.js — 키워드 트렌드 카드의 순수 계산 (화면 없이 시험할 수 있게 따로 둔다)
 *
 * 네이버 데이터랩 '검색어 트렌드'가 주는 값은 절대 검색량이 아니라
 * **주제어(묶음)마다 그 묶음의 가장 높았던 구간을 100으로 둔 상대값**이다.
 * (공식 문서: "구간별 결과에서 가장 큰 값을 100으로 설정한 상댓값")
 * 그래서 100·78 같은 크기는 **키워드끼리 비교할 수 없다** — 서로 다른 100의 기준이다.
 *  · 한 요청에 5개 주제어를 묶어 보내면 호출은 아껴지지만, 크기 비교가 되지는 않는다.
 *  · 비교할 수 있는 것은 모양뿐이다: 최근 4구간 vs 직전 4구간 증감률 · 성수기 여부.
 */

const MAX_KEYWORDS = 5;

/** '봉명동 냉삼, 대전 삼겹살' → ['봉명동 냉삼', '대전 삼겹살'] (중복 제거·5개까지) */
export function normalizeKeywords(text, max = MAX_KEYWORDS) {
  const out = [];
  String(text == null ? '' : text).split(/[,\n]/).forEach((x) => {
    const t = x.trim().slice(0, 40);
    if (t && !out.includes(t) && out.length < max) out.push(t);
  });
  return out;
}

/** +34.2% / −12% / 0% / 비교 전 */
export function deltaText(pct) {
  const n = Number(pct);
  if (pct == null || pct === '' || !Number.isFinite(n)) return '비교 전';
  if (n === 0) return '그대로';
  const v = Math.round(Math.abs(n) * 10) / 10;
  return (n > 0 ? '+' : '−') + v + '%';
}

/** 화면에 쓰는 한 단어 판정 */
export function trendWord(pct) {
  const n = Number(pct);
  if (pct == null || !Number.isFinite(n)) return '알 수 없음';
  if (n >= 15) return '오르는 중';
  if (n <= -15) return '내리는 중';
  return '비슷함';
}

/** 계절 뱃지 — 지금 값이 기간 최고점의 85% 이상이면 성수기, 30% 이하면 비수기 */
export function seasonWord(latest, peak) {
  const l = Number(latest), p = Number(peak);
  if (!Number.isFinite(l) || !Number.isFinite(p) || p <= 0) return '';
  if (l >= p * 0.85) return '성수기';
  if (l <= p * 0.3) return '비수기';
  return '';
}

/**
 * 막대 12칸 — 화면 폭 360px에서도 읽히는 가장 작은 그래프.
 * 높이는 그 묶음의 최고값 대비 %(최소 6%는 남겨 0과 '아주 작음'을 구분).
 */
export function sparkBars(series, count = 12) {
  const list = Array.isArray(series) ? series.slice(-count) : [];
  const max = Math.max(1, ...list.map((s) => Number(s && s.ratio) || 0));
  return list.map((s) => {
    const v = Number(s && s.ratio) || 0;
    return {
      pct: Math.max(6, Math.round((v / max) * 100)),
      value: v,
      period: String((s && s.period) || '')
    };
  });
}

/** 응답(groups) → 화면 줄 */
export function trendRows(data) {
  const groups = (data && Array.isArray(data.groups)) ? data.groups : [];
  return groups.map((g) => {
    const latest = g.latest == null ? null : Number(g.latest);
    const peak = g.peak == null ? null : Number(g.peak);
    // 서버가 한 자리 수(상대지수 10 미만)를 '표본 적음'으로 보내지만,
    // 예전에 배포된 서버 응답이나 캐시가 남아 있어도 화면이 같은 규칙을 지킨다.
    const thin = peak != null && peak < 10;
    return {
      title: String(g.title || ''),
      keywords: Array.isArray(g.keywords) ? g.keywords : [],
      delta: g.delta_pct == null ? null : Number(g.delta_pct),
      delta_text: deltaText(g.delta_pct),
      trend: thin ? '표본 적음' : (g.trend || trendWord(g.delta_pct)),
      season: thin ? '' : (g.season || seasonWord(latest, peak)),
      latest: latest,
      peak: peak,
      recent4: g.recent4 == null ? null : Number(g.recent4),
      bars: sparkBars(g.series)
    };
  });
}

/** '오늘 3/200회 · 이번 달 12/2,000회' */
export function budgetText(b) {
  if (!b) return '';
  const nf = (n) => Number(n || 0).toLocaleString('ko-KR');
  return '오늘 ' + nf(b.used_day) + '/' + nf(b.cap_day) + '회 · 이번 달 ' + nf(b.used_month) + '/' + nf(b.cap_month) + '회';
}

/** '12개월 · 주간' 처럼 기간 표기 */
export function rangeText(data) {
  if (!data) return '';
  const unit = data.time_unit === 'month' ? '월간' : '주간';
  const a = String(data.start_date || '').slice(2, 7).replace('-', '.');
  const b = String(data.end_date || '').slice(2, 7).replace('-', '.');
  return a && b ? a + '~' + b + ' · ' + unit : unit;
}
