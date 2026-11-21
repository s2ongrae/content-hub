/**
 * gas/Insight.gs — 네이버 데이터랩(검색어 트렌드 · 쇼핑 인사이트)을 콘텐츠 허브 안에서 본다 (2026-11-21)
 *
 * 왜 새 파일인가
 *   · Blog.gs 는 블로그 공개 데이터·순위만 다룬다. 여기는 NAVER API HUB(NCP)의 Data Lab 두 API 만 쓴다.
 *   · 키는 Blog.gs 와 같은 스크립트 속성 NAVER_CLIENT_ID · NAVER_CLIENT_SECRET 을 그대로 쓴다(저장소·시트 금지).
 *     NAVER_API_MODE = 'hub' | 'legacy' (비우면 hub 먼저, 401/403/404 면 legacy 한 번 더).
 *
 * 절대 규칙 — 유료 구간에 물리적으로 들어갈 수 없게 한다
 *   · 2026-11 기준 HUB 한도: 검색 카테고리 통합 월 775,000건, 검색어 트렌드·쇼핑 인사이트 각각 월 50,000건
 *     (일 단위가 아니라 월 단위 관리, 소진 시 자동 차단·초과 과금 없음, 현재 한시적 무료).
 *   · 그래도 우리가 스스로 훨씬 낮은 천장을 박는다. 카운터는 ScriptProperties 에 두고
 *     LockService 로 감싼 안에서 '확인 → 차감'을 한 번에 한다(동시 호출에도 안 샌다).
 *       트렌드   일 200건 · 월 2,000건  (월 한도의 4%)
 *       쇼핑인사이트 일 100건 · 월 1,000건 (월 한도의 2%)
 *       (블로그 순위 검색은 Blog.gs 담당 — 이 파일은 관여하지 않는다)
 *   · 같은 요청은 CacheService 에 12시간 보관한다. 캐시에 맞으면 카운터를 쓰지 않고 API 도 부르지 않는다.
 *   · 천장에 닿으면 ERR_INSIGHT_BUDGET 만 돌려주고 UrlFetchApp 을 부르지 않는다(호출 0회).
 *
 * 액션
 *   · insight_trend    : 주제어 묶음 최대 5개(묶음당 검색어 5개) → 기간별 상대지수 추이 + 최근 4구간 vs 직전 4구간
 *   · insight_shopping : 쇼핑 분야(카테고리 코드) 최대 3개 → 분야별 검색 클릭 추이
 *   · insight_budget   : 오늘·이번 달 사용량/천장 (화면 표시용, API 호출 없음)
 *
 * 읽는 법 — ratio 는 절대 검색량이 아니다. **주제어(묶음)마다** 그 묶음의 가장 높았던 구간을 100으로 둔 상대값이다
 *   (공식 문서: "구간별 결과에서 가장 큰 값을 100으로 설정한 상댓값"). 그래서 100·78 같은 크기는 키워드끼리 비교할 수 없다.
 *   비교할 수 있는 것은 모양뿐이다 — 최근 4구간 vs 직전 4구간 증감률, 성수기 여부.
 */

const INSIGHT_ENDPOINTS_ = {
  trend: {
    hub: 'https://naverapihub.apigw.ntruss.com/search-trend/v1/search',
    legacy: 'https://openapi.naver.com/v1/datalab/search'
  },
  shopping: {
    hub: 'https://naverapihub.apigw.ntruss.com/shopping/v1/categories',
    legacy: 'https://openapi.naver.com/v1/datalab/shopping/categories'
  }
};

/** 스스로 박는 천장 — HUB 월 한도(각 50,000건)의 2~4% */
const INSIGHT_CAPS_ = {
  trend: { day: 200, month: 2000 },
  shopping: { day: 100, month: 1000 }
};

const INSIGHT_CACHE_TTL_SEC_ = 43200;   // 12시간
const INSIGHT_MAX_GROUPS_ = 5;          // 검색어 트렌드: 요청 1회에 주제어 5쌍까지
const INSIGHT_MAX_KEYWORDS_ = 5;        // 주제어 1개에 검색어 5개까지(공식 가이드 기준)
const INSIGHT_MAX_CATEGORIES_ = 3;      // 쇼핑 인사이트: 분야 3쌍까지
const INSIGHT_MAX_PERIOD_POINTS_ = 60;  // 응답을 화면에 보낼 때 구간 수 상한(주간 12개월 ≈ 53)
const INSIGHT_SHEET_ = 'Insight_Log';
const INSIGHT_SHEET_HEAD_ = ['day', 'at', 'kind', 'api_mode', 'units', 'status', 'used_day', 'cap_day', 'used_month', 'cap_month', 'note'];

/* ------------------------------------------------------------------ *
 * ① 카운터 — 락 안에서 확인·차감
 * ------------------------------------------------------------------ */

function insightDayKey_(d) { return kstDay_(d || new Date()); }
function insightMonthKey_(d) { return kstDay_(d || new Date()).slice(0, 7); }

function insightCounterKeys_(kind, d) {
  const day = insightDayKey_(d), month = insightMonthKey_(d);
  return {
    day: 'INSIGHT_' + kind.toUpperCase() + '_D_' + day,
    month: 'INSIGHT_' + kind.toUpperCase() + '_M_' + month,
    dayNo: day, monthNo: month
  };
}

function insightReadCounter_(props, keys) {
  return {
    day: Number(props.getProperty(keys.day) || 0) || 0,
    month: Number(props.getProperty(keys.month) || 0) || 0
  };
}

/**
 * 호출 1회를 쓰기 전에 확인하고 미리 차감한다.
 * @return {{ok:boolean, reason?:string, used:Object, caps:Object}}
 *   ok=false 면 부르면 안 된다(천장). used 는 차감 전 값.
 */
function insightSpend_(kind, units) {
  const cap = INSIGHT_CAPS_[kind];
  if (!cap) throw createAppError_('ERR_INTERNAL', '알 수 없는 종류: ' + kind);
  const n = Math.max(1, Number(units) || 1);
  const lock = LockService.getScriptLock();
  let locked = false;
  try {
    locked = lock.tryLock(3000);
    if (!locked) throw createAppError_('ERR_BUSY', '다른 요청이 사용량을 계산하는 중입니다. 잠시 뒤 다시 시도해 주세요.');
    const props = PropertiesService.getScriptProperties();
    const keys = insightCounterKeys_(kind);
    const used = insightReadCounter_(props, keys);
    if (used.day + n > cap.day) {
      return { ok: false, reason: 'DAY_CAP', used: used, caps: cap, dayKey: keys.dayNo };
    }
    if (used.month + n > cap.month) {
      return { ok: false, reason: 'MONTH_CAP', used: used, caps: cap, dayKey: keys.dayNo };
    }
    props.setProperty(keys.day, String(used.day + n));
    props.setProperty(keys.month, String(used.month + n));
    return { ok: true, used: used, caps: cap, dayKey: keys.dayNo, monthKey: keys.monthNo };
  } finally {
    if (locked) { try { lock.releaseLock(); } catch (e) { /* 무시 */ } }
  }
}

/** 호출이 통신 오류로 끝났을 때 미리 차감한 1회를 돌려준다(실패한 호출은 한도에 안 잡히는 것이 보통). */
function insightRefund_(kind, units) {
  const n = Math.max(1, Number(units) || 1);
  const lock = LockService.getScriptLock();
  let locked = false;
  try {
    locked = lock.tryLock(3000);
    if (!locked) return false;
    const props = PropertiesService.getScriptProperties();
    const keys = insightCounterKeys_(kind);
    const used = insightReadCounter_(props, keys);
    props.setProperty(keys.day, String(Math.max(0, used.day - n)));
    props.setProperty(keys.month, String(Math.max(0, used.month - n)));
    return true;
  } finally {
    if (locked) { try { lock.releaseLock(); } catch (e) { /* 무시 */ } }
  }
}

function insightBudgetOf_(kind) {
  const props = PropertiesService.getScriptProperties();
  const keys = insightCounterKeys_(kind);
  const used = insightReadCounter_(props, keys);
  const cap = INSIGHT_CAPS_[kind];
  return {
    kind: kind, day: keys.dayNo, month: keys.monthNo,
    used_day: used.day, cap_day: cap.day, left_day: Math.max(0, cap.day - used.day),
    used_month: used.month, cap_month: cap.month, left_month: Math.max(0, cap.month - used.month)
  };
}

/* ------------------------------------------------------------------ *
 * ② 키 · 창구 · 호출
 * ------------------------------------------------------------------ */

function insightKeys_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('NAVER_CLIENT_ID');
  const secret = props.getProperty('NAVER_CLIENT_SECRET');
  if (!id || !secret) {
    throw createAppError_('ERR_NO_NAVER_KEY',
      '네이버 API 키가 없습니다. Apps Script [프로젝트 설정 → 스크립트 속성]에 '
      + 'NAVER_CLIENT_ID · NAVER_CLIENT_SECRET 을 넣어 주세요(NAVER API HUB · 현재 무료).');
  }
  return { id: id, secret: secret, mode: String(props.getProperty('NAVER_API_MODE') || '').toLowerCase() };
}

function insightCacheKey_(kind, body) {
  const raw = kind + '|' + JSON.stringify(body || {});
  return ('INSIGHT_V1_' + sha256Hex_(raw)).slice(0, 120);
}

function insightCacheGet_(key) {
  try {
    const hit = CacheService.getScriptCache().get(key);
    if (!hit) return null;
    const obj = JSON.parse(hit);
    return (obj && typeof obj === 'object') ? obj : null;
  } catch (e) { return null; }
}

function insightCachePut_(key, obj) {
  try {
    CacheService.getScriptCache().put(key, JSON.stringify(obj), INSIGHT_CACHE_TTL_SEC_);
  } catch (e) { /* 캐시 실패는 치명적이지 않다 — 그냥 다음에 또 부른다 */ }
}

/**
 * POST 1회. hub 키가 아니면 legacy 주소로 한 번 더 시도한다(키가 어느 창구 것인지 몰라도 되게).
 * @return {{code:number, json:Object|null, mode:string, networkError:string}}
 */
function insightPost_(kind, body, keys) {
  const spec = INSIGHT_ENDPOINTS_[kind];
  const payload = JSON.stringify(body);
  let order = ['hub', 'legacy'];
  if (keys.mode === 'hub') order = ['hub'];
  else if (keys.mode === 'legacy') order = ['legacy'];

  let last = { code: 0, json: null, mode: '', networkError: '' };
  for (let i = 0; i < order.length; i++) {
    const which = order[i];
    const url = spec[which];
    const headers = which === 'hub'
      ? { 'X-NCP-APIGW-API-KEY-ID': keys.id, 'X-NCP-APIGW-API-KEY': keys.secret }
      : { 'X-Naver-Client-Id': keys.id, 'X-Naver-Client-Secret': keys.secret };
    let res;
    try {
      res = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        headers: headers,
        payload: payload,
        muteHttpExceptions: true
      });
    } catch (err) {
      last = { code: 0, json: null, mode: which, networkError: String((err && err.message) || err) };
      continue;  // 통신 실패는 다음 창구를 시도할 가치가 있다
    }
    const code = res.getResponseCode();
    let json = null;
    try { json = JSON.parse(res.getContentText()); } catch (e) { json = null; }
    last = { code: code, json: json, mode: which, networkError: '' };
    // 키가 이 창구 것이 아니다(401/403) 또는 경로가 다르다(404) → 다음 창구 시도
    if (code === 401 || code === 403 || code === 404) continue;
    break;
  }
  return last;
}

function insightAssertOk_(got) {
  if (got.networkError) {
    throw createAppError_('ERR_NAVER_UNREACHABLE', '네이버 데이터랩에 닿지 못했습니다: ' + got.networkError.slice(0, 120));
  }
  if (got.code === 401 || got.code === 403) {
    throw createAppError_('ERR_NO_NAVER_KEY',
      '네이버 키가 맞지 않거나 이 앱에 데이터랩(검색어 트렌드·쇼핑 인사이트) 사용이 켜져 있지 않습니다(HTTP ' + got.code + '). '
      + 'NCP 콘솔 → NAVER API HUB → Application 에서 API 를 추가하고, [인증 정보]의 Client ID·Secret 을 다시 넣어 주세요.');
  }
  if (got.code === 429) {
    throw createAppError_('ERR_QUOTA_EXCEEDED', '네이버가 호출 한도 초과(429)로 막았습니다. 잠시 뒤 다시 시도해 주세요.');
  }
  if (got.code !== 200 || !got.json) {
    const msg = (got.json && (got.json.errMsg || got.json.errorMessage || (got.json.error && got.json.error.message))) || '';
    throw createAppError_('ERR_NAVER_BAD_RESPONSE', '네이버 응답이 200이 아닙니다(HTTP ' + got.code + '). ' + String(msg).slice(0, 160));
  }
}

/* ------------------------------------------------------------------ *
 * ③ 감사 로그 — 실제로 밖에 나간 호출만 1줄
 * ------------------------------------------------------------------ */

function insightSheet_(ss) {
  let sheet = ss.getSheetByName(INSIGHT_SHEET_);
  if (!sheet) {
    sheet = ss.insertSheet(INSIGHT_SHEET_);
    sheet.getRange(1, 1, 1, INSIGHT_SHEET_HEAD_.length).setValues([INSIGHT_SHEET_HEAD_]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function insightLog_(ss, row) {
  try {
    withWriteLock_(function () {
      const sheet = insightSheet_(ss);
      sheet.appendRow(INSIGHT_SHEET_HEAD_.map(function (h) {
        return Object.prototype.hasOwnProperty.call(row, h) ? row[h] : '';
      }));
    });
  } catch (e) { /* 로그 실패가 본 기능을 막지 않는다 */ }
}

/* ------------------------------------------------------------------ *
 * ④ 검색어 트렌드
 * ------------------------------------------------------------------ */

/** 입력 정리 — 화면이 무엇을 보내든 5묶음×5검색어로 자른다. */
function normalizeTrendGroups_(payload) {
  const raw = Array.isArray(payload && payload.groups) ? payload.groups : [];
  const out = [];
  raw.forEach(function (g) {
    const name = cleanText_(g && (g.name || g.groupName), 40);
    const list = Array.isArray(g && g.keywords) ? g.keywords : String((g && g.keywords) || '').split(/[,\n]/);
    const kws = [];
    list.forEach(function (k) {
      const t = cleanText_(k, 40);
      if (t && kws.indexOf(t) < 0 && kws.length < INSIGHT_MAX_KEYWORDS_) kws.push(t);
    });
    if (!name || !kws.length) return;
    if (out.length >= INSIGHT_MAX_GROUPS_) return;
    out.push({ groupName: name, keywords: kws });
  });
  return out;
}

/** 최근 4구간 vs 직전 4구간. 값이 모자라면 null 로 두고 화면이 '모름'으로 쓴다. */
function trendSummary_(data) {
  const list = (Array.isArray(data) ? data : []).map(function (d) {
    return { period: String((d && d.period) || ''), ratio: Math.max(0, Math.round(Number(d && d.ratio) || 0)) };
  });
  const n = list.length;
  const tail = list.slice(Math.max(0, n - 4));
  const prev = list.slice(Math.max(0, n - 8), Math.max(0, n - 4));
  const avg = function (arr) {
    if (!arr.length) return null;
    return Math.round(arr.reduce(function (s, x) { return s + x.ratio; }, 0) / arr.length * 10) / 10;
  };
  const recent4 = avg(tail), prev4 = avg(prev);
  let deltaPct = null;
  if (recent4 != null && prev4 != null && prev4 > 0) deltaPct = Math.round(((recent4 - prev4) / prev4) * 1000) / 10;
  const peak = n ? Math.max.apply(null, list.map(function (x) { return x.ratio; })) : null;
  const latest = n ? list[n - 1].ratio : null;
  // 상대지수는 이 요청의 최고점을 100으로 둔다. 그래서 peak 가 한 자리 수인 말은
  // '그 주제 안에서 거의 안 찾는 말'이라 오름/내림·계절을 판단할 표본이 안 된다.
  const thin = (peak != null && peak < 10);
  let trend = '알 수 없음';
  if (thin) trend = '표본 적음';
  else if (deltaPct != null) trend = deltaPct >= 15 ? '오르는 중' : deltaPct <= -15 ? '내리는 중' : '비슷함';
  let season = '';
  if (!thin && latest != null && peak) {
    if (latest >= peak * 0.85) season = '성수기';
    else if (latest <= peak * 0.3) season = '비수기';
  }
  const points = list.length > INSIGHT_MAX_PERIOD_POINTS_ ? list.slice(list.length - INSIGHT_MAX_PERIOD_POINTS_) : list;
  return {
    series: points, points: points.length,
    latest: latest, peak: peak,
    recent4: recent4, prev4: prev4, delta_pct: deltaPct,
    trend: trend, season: season
  };
}

function handleInsightTrend_(ss, payload, ctx) {
  const groups = normalizeTrendGroups_(payload);
  if (!groups.length) {
    throw createAppError_('ERR_VALIDATION_FAILED', '확인할 키워드를 하나 이상 적어 주세요(주제어 5묶음·묶음당 5개까지).');
  }
  const months = Math.min(24, Math.max(3, Number(payload && payload.months) || 12));
  const unit = (payload && payload.unit) === 'month' ? 'month' : 'week';

  const end = new Date(Date.now() - 86400000);          // 데이터랩은 당일 값이 비어 있다 → 어제까지
  const start = new Date(end.getTime() - Math.round(months * 30.4) * 86400000);
  const body = {
    startDate: kstDay_(start), endDate: kstDay_(end), timeUnit: unit,
    keywordGroups: groups
  };

  const cacheKey = insightCacheKey_('trend', body);
  const hit = insightCacheGet_(cacheKey);
  if (hit) {
    hit.cached = true;
    hit.budget = insightBudgetOf_('trend');
    return hit;
  }

  const keys = insightKeys_();
  const spend = insightSpend_('trend', 1);
  if (!spend.ok) {
    throw createAppError_('ERR_INSIGHT_BUDGET',
      (spend.reason === 'DAY_CAP'
        ? '오늘 트렌드 조회 상한(' + spend.caps.day + '회)을 다 썼습니다.'
        : '이번 달 트렌드 조회 상한(' + spend.caps.month + '회)을 다 썼습니다.')
      + ' 무료 한도(월 50,000건)에 닿지 않게 일부러 낮게 잡아 둔 값이라, 내일(또는 다음 달)에 다시 열립니다.');
  }

  let got;
  try {
    got = insightPost_('trend', body, keys);
  } catch (err) {
    insightRefund_('trend', 1);
    throw err;
  }
  if (got.networkError || got.code === 0) insightRefund_('trend', 1);
  try {
    insightAssertOk_(got);
  } catch (err) {
    insightLog_(ss, {
      day: spend.dayKey, at: formatKstIso_(new Date()), kind: 'trend', api_mode: got.mode, units: groups.length,
      status: 'HTTP ' + got.code, used_day: spend.used.day + 1, cap_day: spend.caps.day,
      used_month: spend.used.month + 1, cap_month: spend.caps.month, note: String((err && err.message) || '').slice(0, 160)
    });
    throw err;
  }

  const results = (got.json.results || []).map(function (r) {
    const sum = trendSummary_(r.data);
    return Object.assign({
      title: String(r.title || ''),
      keywords: Array.isArray(r.keywords) ? r.keywords.slice(0, INSIGHT_MAX_KEYWORDS_) : []
    }, sum);
  });

  const out = {
    start_date: body.startDate, end_date: body.endDate, time_unit: body.timeUnit,
    groups: results, requested: groups.length,
    note: '숫자는 절대 검색량이 아니라 주제어마다 그 묶음의 최고점을 100으로 둔 상대값입니다. 키워드끼리 크기를 비교하지 말고 증감·계절만 보세요.',
    cached: false, api_mode: got.mode,
    budget: insightBudgetOf_('trend')
  };

  insightCachePut_(cacheKey, out);
  insightLog_(ss, {
    day: spend.dayKey, at: formatKstIso_(new Date()), kind: 'trend', api_mode: got.mode, units: groups.length,
    status: 'OK', used_day: spend.used.day + 1, cap_day: spend.caps.day,
    used_month: spend.used.month + 1, cap_month: spend.caps.month, note: results.map(function (x) { return x.title; }).join(', ').slice(0, 120)
  });
  return out;
}

/* ------------------------------------------------------------------ *
 * ⑤ 쇼핑 인사이트 — 분야별 클릭 추이
 * ------------------------------------------------------------------ */

function normalizeShoppingCategories_(payload) {
  const raw = Array.isArray(payload && payload.categories) ? payload.categories : [];
  const out = [];
  raw.forEach(function (c) {
    const name = cleanText_(c && c.name, 30);
    const code = String((c && (c.code || c.param)) || '').replace(/[^0-9]/g, '').slice(0, 12);
    if (!name || !code) return;
    if (out.length >= INSIGHT_MAX_CATEGORIES_) return;
    out.push({ name: name, param: [code] });
  });
  return out;
}

function handleInsightShopping_(ss, payload, ctx) {
  const cats = normalizeShoppingCategories_(payload);
  if (!cats.length) {
    throw createAppError_('ERR_VALIDATION_FAILED',
      '쇼핑 분야를 하나 이상 적어 주세요(분야 이름 + 네이버쇼핑 cat_id, 최대 3개).');
  }
  const days = Math.min(180, Math.max(7, Number(payload && payload.days) || 30));
  const unit = (payload && payload.unit) === 'week' ? 'week' : 'date';
  const end = new Date(Date.now() - 86400000);
  const start = new Date(end.getTime() - days * 86400000);
  const body = { startDate: kstDay_(start), endDate: kstDay_(end), timeUnit: unit, category: cats };

  const cacheKey = insightCacheKey_('shopping', body);
  const hit = insightCacheGet_(cacheKey);
  if (hit) { hit.cached = true; hit.budget = insightBudgetOf_('shopping'); return hit; }

  const keys = insightKeys_();
  const spend = insightSpend_('shopping', 1);
  if (!spend.ok) {
    throw createAppError_('ERR_INSIGHT_BUDGET',
      (spend.reason === 'DAY_CAP'
        ? '오늘 쇼핑 인사이트 조회 상한(' + spend.caps.day + '회)을 다 썼습니다.'
        : '이번 달 쇼핑 인사이트 조회 상한(' + spend.caps.month + '회)을 다 썼습니다.')
      + ' 내일(또는 다음 달)에 다시 열립니다.');
  }

  let got;
  try {
    got = insightPost_('shopping', body, keys);
  } catch (err) {
    insightRefund_('shopping', 1);
    throw err;
  }
  if (got.networkError || got.code === 0) insightRefund_('shopping', 1);
  try {
    insightAssertOk_(got);
  } catch (err) {
    insightLog_(ss, {
      day: spend.dayKey, at: formatKstIso_(new Date()), kind: 'shopping', api_mode: got.mode, units: cats.length,
      status: 'HTTP ' + got.code, used_day: spend.used.day + 1, cap_day: spend.caps.day,
      used_month: spend.used.month + 1, cap_month: spend.caps.month, note: String((err && err.message) || '').slice(0, 160)
    });
    throw err;
  }

  const results = (got.json.results || []).map(function (r) {
    const sum = trendSummary_(r.data);
    return Object.assign({
      title: String(r.title || ''),
      category: Array.isArray(r.category) ? r.category : []
    }, sum);
  });

  const out = {
    start_date: body.startDate, end_date: body.endDate, time_unit: body.timeUnit,
    categories: results,
    note: '쇼핑 인사이트도 같은 요청 안의 최고점을 100으로 둔 상대값입니다. 이 숫자만으로 값·마진·순위를 판단하지 마세요(시세는 사람이 화면에서 실측).',
    cached: false, api_mode: got.mode,
    budget: insightBudgetOf_('shopping')
  };
  insightCachePut_(cacheKey, out);
  insightLog_(ss, {
    day: spend.dayKey, at: formatKstIso_(new Date()), kind: 'shopping', api_mode: got.mode, units: cats.length,
    status: 'OK', used_day: spend.used.day + 1, cap_day: spend.caps.day,
    used_month: spend.used.month + 1, cap_month: spend.caps.month, note: results.map(function (x) { return x.title; }).join(', ').slice(0, 120)
  });
  return out;
}

/* ------------------------------------------------------------------ *
 * ⑥ 사용량 보기 — API 호출 없음
 * ------------------------------------------------------------------ */

function handleInsightBudget_(ss, payload, ctx) {
  return {
    today: insightDayKey_(new Date()),
    month: insightMonthKey_(new Date()),
    trend: insightBudgetOf_('trend'),
    shopping: insightBudgetOf_('shopping'),
    cache_hours: INSIGHT_CACHE_TTL_SEC_ / 3600,
    note: '무료 한도(Data Lab 각 월 50,000건)의 2~4%로 일부러 낮게 잡은 천장입니다. 천장에 닿으면 API 를 부르지 않고 안내만 합니다.'
  };
}

/* ------------------------------------------------------------------ *
 * ⑦ 편집기에서 1회 실행하는 연결 점검 — 토큰 없이 키 상태만 본다
 *
 * Apps Script 편집기에서 이 함수를 고르고 [실행] → 실행 기록에서 결과를 본다.
 * 키 값은 절대 돌려주지 않는다(HTTP 코드·응답의 항목 수만).
 * ------------------------------------------------------------------ */

function insightSelfTest() {
  const out = { at: formatKstIso_(new Date()), keys: false, mode: '', trend: null, shopping: null };
  const props = PropertiesService.getScriptProperties();
  out.keys = !!(props.getProperty('NAVER_CLIENT_ID') && props.getProperty('NAVER_CLIENT_SECRET'));
  out.mode = String(props.getProperty('NAVER_API_MODE') || '(자동)');
  if (!out.keys) { Logger.log(JSON.stringify(out, null, 2)); return out; }

  const keys = insightKeys_();
  const end = new Date(Date.now() - 86400000);
  const start = new Date(end.getTime() - 28 * 86400000);
  try {
    const got = insightPost_('trend', {
      startDate: kstDay_(start), endDate: kstDay_(end), timeUnit: 'week',
      keywordGroups: [{ groupName: '연결점검', keywords: ['대전 맛집'] }]
    }, keys);
    out.trend = {
      code: got.code, mode: got.mode,
      results: got.json && Array.isArray(got.json.results) ? got.json.results.length : 0,
      points: got.json && got.json.results && got.json.results[0] && Array.isArray(got.json.results[0].data)
        ? got.json.results[0].data.length : 0,
      err: got.json ? String(got.json.errMsg || got.json.errorMessage || '').slice(0, 120) : ''
    };
  } catch (e) { out.trend = { error: String((e && e.message) || e) }; }

  try {
    const got = insightPost_('shopping', {
      startDate: kstDay_(start), endDate: kstDay_(end), timeUnit: 'week',
      category: [{ name: '반려동물', param: ['50000168'] }]
    }, keys);
    out.shopping = {
      code: got.code, mode: got.mode,
      results: got.json && Array.isArray(got.json.results) ? got.json.results.length : 0,
      err: got.json ? String(got.json.errMsg || got.json.errorMessage || '').slice(0, 120) : ''
    };
  } catch (e) { out.shopping = { error: String((e && e.message) || e) }; }

  Logger.log(JSON.stringify(out, null, 2));
  return out;
}
