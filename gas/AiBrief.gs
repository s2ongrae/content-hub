/**
 * ============================================================================
 * 콘텐츠 허브 · AI_Brief 야간 1줄 요약 모듈 (gas/AiBrief.gs)
 * ============================================================================
 * [설계 의도]
 * - 매일 새벽 GAS가 시트 원문(Contents·Metrics·Channel_Logs·Integrity_Logs 등)을
 *   항목당 120자·총 12,000자 이내로 압축해 Gemini 무료 티어로 1행 브리프를 생성한다.
 * - 비서 AI(피클)는 수십 KB 원문 대신 AI_Brief 시트의 최신 1행만 읽어 토큰을 절감한다.
 * - 유료 과금·할당량 초과·PII 유출을 막기 위해 10중 방어 가드를 내장한다.
 * ============================================================================
 */

// ----------------------------------------------------------------------------
// 1. 상수 및 허용 화이트리스트
// ----------------------------------------------------------------------------

const AI_BRIEF_SHEET_NAME_ = 'AI_Brief';
const AI_BRIEF_SCOPE_ = 'content-hub';
const AI_BRIEF_DEFAULT_KIND_ = 'daily_brief';

const GEMINI_MODELS_ = ['gemini-4-hydrogen', 'gemini-3.8-flash'];
const AI_BRIEF_DEFAULT_MODEL_ = 'gemini-4-hydrogen';

const AI_BRIEF_DAY_CAP_ = 80;
const AI_BRIEF_CACHE_TTL_SEC_ = 43200; // 12시간 캐시 (중복 호출 방지)
const AI_BRIEF_TIME_BUDGET_MS_ = 240000; // 240초 실행 예산 (GAS 6분 타임아웃 방어)
const AI_BRIEF_ITEM_MAX_CHARS_ = 120;
const AI_BRIEF_TOTAL_MAX_CHARS_ = 12000;

const AI_BRIEF_HEADERS_ = [
  'day',
  'scope',
  'kind',
  'model',
  'items_in',
  'items_out',
  'summary_json',
  'tokens_est',
  'status',
  'created_at'
];

const AI_BRIEF_SYSTEM_PROMPT_ =
  "너는 콘텐츠 운영 데이터 요약기다. 입력에 없는 사실·숫자를 만들지 마라. " +
  "발행·삭제·가격변경을 지시하지 말고 '할 일 후보'만 적어라. JSON만 출력. " +
  "headline 60자 이내 한 문장, topics 5개 이하, highlights 5개 이하(각 40자), action_needed 3개 이하(각 40자).";

// ----------------------------------------------------------------------------
// 2. 라우터 핸들러 (ai_brief_run / ai_brief_latest / ai_brief_budget)
// ----------------------------------------------------------------------------

/**
 * 야간 요약 실행 핸들러 (WRITE, longRunning: true)
 */
function handleAiBriefRun_(ssArg, payload) {
  const startMs = nowMs_();
  const req = payload || {};
  const scope = cleanText_(req.scope || AI_BRIEF_SCOPE_, 40);
  if (scope !== AI_BRIEF_SCOPE_) {
    throw createAppError_('ERR_SCOPE_NOT_ALLOWED', '허용되지 않은 scope입니다.', { scope: scope });
  }

  const kind = cleanText_(req.kind || AI_BRIEF_DEFAULT_KIND_, 40) || AI_BRIEF_DEFAULT_KIND_;
  const model = cleanText_(req.model || AI_BRIEF_DEFAULT_MODEL_, 60) || AI_BRIEF_DEFAULT_MODEL_;
  if (GEMINI_MODELS_.indexOf(model) === -1) {
    throw createAppError_('ERR_MODEL_NOT_ALLOWED', '허용되지 않은 Gemini 모델입니다.', {
      model: model,
      allowed: GEMINI_MODELS_
    });
  }

  const now = new Date();
  const day = cleanText_(req.day || kstDay_(now), 10) || kstDay_(now);
  const dayCompact = day.replace(/-/g, '');
  const ymCompact = dayCompact.slice(0, 6);
  const force = req.force === true;

  const ss = ssArg || aiBriefGetSpreadsheet_();
  // 시트가 이미 존재하면 스키마 10칸 정합성을 먼저 검증한다(불일치 시 덮어쓰기 금지)
  const existingSheet = ss ? ss.getSheetByName(AI_BRIEF_SHEET_NAME_) : null;
  if (existingSheet) {
    aiBriefValidateSheetHeader_(existingSheet);
  }

  // 가드 (j): 당일 동일 kind가 이미 OK로 적재되어 있고 force가 아니면 즉시 기존 행 반환
  if (!force && existingSheet) {
    const prevOk = aiBriefFindLatestRow_(existingSheet, {
      day: day,
      scope: scope,
      kind: kind,
      onlyOk: true
    });
    if (prevOk) {
      return aiBriefEnrichResponse_(prevOk, { reused: true });
    }
  }

  const props = PropertiesService.getScriptProperties();

  // 가드 (f): API 키 미설정 시 예외 없이 SKIPPED_NO_API_KEY 기록 후 정상 응답
  const apiKey = cleanText_(props.getProperty('GEMINI_API_KEY'), 256);
  if (!apiKey) {
    const noKeyRow = aiBriefBuildRecord_({
      day: day,
      scope: scope,
      kind: kind,
      model: model,
      items_in: 0,
      items_out: 0,
      summaryObj: { headline: '', topics: [], highlights: [], action_needed: [] },
      tokens_est: 0,
      status: 'SKIPPED_NO_API_KEY',
      created_at: formatKstIso_(now)
    });
    aiBriefLog_(ss, noKeyRow);
    return aiBriefEnrichResponse_(noKeyRow, {});
  }

  // 가드 (g): 0원 방어 — 당월 과금 인지 플래그(GEMINI_BILLING_ACK_YYYYMM) 없으면 호출 0회
  const billingAck = cleanText_(props.getProperty('GEMINI_BILLING_ACK_' + ymCompact), 16);
  if (!billingAck || (billingAck !== '1' && billingAck.toLowerCase() !== 'true')) {
    const noAckRow = aiBriefBuildRecord_({
      day: day,
      scope: scope,
      kind: kind,
      model: model,
      items_in: 0,
      items_out: 0,
      summaryObj: { headline: '', topics: [], highlights: [], action_needed: [] },
      tokens_est: 0,
      status: 'SKIPPED_NO_BILLING_ACK',
      created_at: formatKstIso_(now)
    });
    aiBriefLog_(ss, noAckRow);
    return aiBriefEnrichResponse_(noAckRow, {});
  }

  // 가드 (d): 당일 429 할당량 소진 플래그 확인 (재시도 0회)
  const exhaustedFlag = props.getProperty('GEMINI_EXHAUSTED_' + dayCompact);
  if (exhaustedFlag === '1') {
    const skip429Row = aiBriefBuildRecord_({
      day: day,
      scope: scope,
      kind: kind,
      model: model,
      items_in: 0,
      items_out: 0,
      summaryObj: { headline: '', topics: [], highlights: [], action_needed: [] },
      tokens_est: 0,
      status: 'SKIPPED_429',
      created_at: formatKstIso_(now)
    });
    aiBriefLog_(ss, skip429Row);
    return aiBriefEnrichResponse_(skip429Row, {});
  }

  // 입력 데이터 수집 및 120자/12,000자 압축 (가드 h: 240초 예산 감시 포함)
  const collected = aiBriefCollect_(ss, {
    startMs: startMs,
    dayCompact: dayCompact,
    props: props
  });

  // 가드 (i): 전송 직전 PII 스크러빙 및 잔존 패턴 차단
  const scrubbed = aiBriefScrubPii_(collected.text);
  if (scrubbed.blocked) {
    const piiRow = aiBriefBuildRecord_({
      day: day,
      scope: scope,
      kind: kind,
      model: model,
      items_in: collected.items_in,
      items_out: 0,
      summaryObj: {
        headline: '',
        blocked_patterns: scrubbed.remainingPatterns
      },
      tokens_est: 0,
      status: 'BLOCKED_PII',
      created_at: formatKstIso_(new Date())
    });
    aiBriefLog_(ss, piiRow);
    return aiBriefEnrichResponse_(piiRow, { blocked_patterns: scrubbed.remainingPatterns });
  }

  const prompt = AI_BRIEF_SYSTEM_PROMPT_ + '\n\n[운영 데이터 요약 입력]\n' + scrubbed.text;
  const cacheKey = 'AIBRIEF_' + sha256Hex_(model + '|' + kind + '|' + scrubbed.text);
  const cache = CacheService.getScriptCache();

  // 가드 (b): 12시간 캐시 적중 시 카운터·네트워크 호출 0회
  if (!force) {
    const cachedRaw = cache.get(cacheKey);
    if (cachedRaw) {
      const cachedRow = aiBriefSafeJsonParse_(cachedRaw, null);
      if (cachedRow && cachedRow.summary_json) {
        return aiBriefEnrichResponse_(cachedRow, { cached: true });
      }
    }
  }

  // 가드 (h): 호출 직전 240초 예산 초과 시 외부 호출 없이 PARTIAL 종료
  if (nowMs_() - startMs > AI_BRIEF_TIME_BUDGET_MS_) {
    props.setProperty('CURSOR_BRIEF_' + dayCompact, JSON.stringify({
      stage: 'pre_call_timeout',
      items_in: collected.items_in,
      saved_at: formatKstIso_(new Date())
    }));
    const timeoutRow = aiBriefBuildRecord_({
      day: day,
      scope: scope,
      kind: kind,
      model: model,
      items_in: collected.items_in,
      items_out: 0,
      summaryObj: { headline: '', topics: [], highlights: [], action_needed: [] },
      tokens_est: 0,
      status: 'PARTIAL',
      created_at: formatKstIso_(new Date())
    });
    aiBriefLog_(ss, timeoutRow);
    return aiBriefEnrichResponse_(timeoutRow, { timed_out: true });
  }

  // 가드 (c): LockService 안에서 일일 80콜 상한 확인 및 선차감
  aiBriefConsumeBudget_(dayCompact);

  // Gemini API 호출 (5xx 1회 재시도, 429 즉시 잠금 내장)
  const callRes = geminiCall_(model, prompt, apiKey);

  if (!callRes.ok) {
    if (callRes.status === 'SKIPPED_429') {
      props.setProperty('GEMINI_EXHAUSTED_' + dayCompact, '1');
      aiBriefRefundBudget_(dayCompact);
      const exhaustedRow = aiBriefBuildRecord_({
        day: day,
        scope: scope,
        kind: kind,
        model: model,
        items_in: collected.items_in,
        items_out: 0,
        summaryObj: { headline: '', topics: [], highlights: [], action_needed: [] },
        tokens_est: 0,
        status: 'SKIPPED_429',
        created_at: formatKstIso_(new Date())
      });
      aiBriefLog_(ss, exhaustedRow);
      return aiBriefEnrichResponse_(exhaustedRow, {});
    }

    // 통신/5xx 실패 시 차감한 1회 예산을 환불한다
    aiBriefRefundBudget_(dayCompact);
    const errRow = aiBriefBuildRecord_({
      day: day,
      scope: scope,
      kind: kind,
      model: model,
      items_in: collected.items_in,
      items_out: 0,
      summaryObj: { headline: '', error_code: callRes.httpCode || 0 },
      tokens_est: 0,
      status: 'ERROR',
      created_at: formatKstIso_(new Date())
    });
    aiBriefLog_(ss, errRow);
    return aiBriefEnrichResponse_(errRow, { http_code: callRes.httpCode || 0 });
  }

  // 응답 JSON 파싱 및 정규화
  const parsed = aiBriefParseResponse_(callRes.rawText);
  const tokensEst = callRes.totalTokenCount !== null
    ? callRes.totalTokenCount
    : Math.round((prompt.length + (callRes.rawText || '').length) / 3);

  let finalStatus = 'OK';
  if (!parsed.ok || collected.partial || nowMs_() - startMs > AI_BRIEF_TIME_BUDGET_MS_) {
    finalStatus = 'PARTIAL';
  }

  const itemsOut = parsed.ok
    ? (parsed.summary.topics.length + parsed.summary.highlights.length + parsed.summary.action_needed.length)
    : 0;

  const finalRow = aiBriefBuildRecord_({
    day: day,
    scope: scope,
    kind: kind,
    model: model,
    items_in: collected.items_in,
    items_out: itemsOut,
    summaryObj: parsed.summary,
    tokens_est: tokensEst,
    status: finalStatus,
    created_at: formatKstIso_(new Date())
  });

  aiBriefLog_(ss, finalRow);

  if (finalStatus === 'OK') {
    try {
      cache.put(cacheKey, JSON.stringify(finalRow), AI_BRIEF_CACHE_TTL_SEC_);
    } catch (ignoreCacheErr) {
      // CacheService 용량 초과 등 예외는 본 흐름에 영향을 주지 않는다
    }
  }

  return aiBriefEnrichResponse_(finalRow, {
    dropped: collected.dropped,
    counts: collected.counts
  });
}

/**
 * 최신 브리프 조회 핸들러 (READ) — 피클(비서 AI) 전용 1행 읽기
 */
function handleAiBriefLatest_(ssArg, payload) {
  const req = payload || {};
  const scope = cleanText_(req.scope || AI_BRIEF_SCOPE_, 40);
  if (scope !== AI_BRIEF_SCOPE_) {
    throw createAppError_('ERR_SCOPE_NOT_ALLOWED', '허용되지 않은 scope입니다.', { scope: scope });
  }

  const kind = cleanText_(req.kind || AI_BRIEF_DEFAULT_KIND_, 40) || AI_BRIEF_DEFAULT_KIND_;
  const day = cleanText_(req.day || '', 10);

  const ss = ssArg || aiBriefGetSpreadsheet_();
  const sh = ss ? ss.getSheetByName(AI_BRIEF_SHEET_NAME_) : null;
  if (!sh) {
    return {
      found: false,
      scope: scope,
      kind: kind,
      summary: { headline: '', topics: [], highlights: [], action_needed: [] },
      summary_1line: '',
      action_needed: []
    };
  }

  aiBriefValidateSheetHeader_(sh);
  const row = aiBriefFindLatestRow_(sh, {
    day: day,
    scope: scope,
    kind: kind,
    onlyOk: req.only_ok === true
  });

  if (!row) {
    return {
      found: false,
      scope: scope,
      kind: kind,
      summary: { headline: '', topics: [], highlights: [], action_needed: [] },
      summary_1line: '',
      action_needed: []
    };
  }

  return aiBriefEnrichResponse_(row, { found: true });
}

/**
 * 일일 예산·키·과금 인지 상태 조회 핸들러 (READ)
 */
function handleAiBriefBudget_(ssArg, payload) {
  const req = payload || {};
  const scope = cleanText_(req.scope || AI_BRIEF_SCOPE_, 40);
  if (scope !== AI_BRIEF_SCOPE_) {
    throw createAppError_('ERR_SCOPE_NOT_ALLOWED', '허용되지 않은 scope입니다.', { scope: scope });
  }

  const now = new Date();
  const day = cleanText_(req.day || kstDay_(now), 10) || kstDay_(now);
  const dayCompact = day.replace(/-/g, '');
  const ymCompact = dayCompact.slice(0, 6);

  const props = PropertiesService.getScriptProperties();
  const used = cleanInt_(props.getProperty('AI_BRIEF_CNT_' + dayCompact)) || 0;
  const exhausted = props.getProperty('GEMINI_EXHAUSTED_' + dayCompact) === '1';
  const hasKey = Boolean(cleanText_(props.getProperty('GEMINI_API_KEY'), 256));
  const ackRaw = cleanText_(props.getProperty('GEMINI_BILLING_ACK_' + ymCompact), 16);
  const billingAck = Boolean(ackRaw && (ackRaw === '1' || ackRaw.toLowerCase() === 'true'));

  return {
    day: day,
    scope: scope,
    cap: AI_BRIEF_DAY_CAP_,
    used: used,
    remaining: Math.max(0, AI_BRIEF_DAY_CAP_ - used),
    exhausted_429: exhausted,
    has_api_key: hasKey,
    billing_ack: billingAck,
    billing_ack_key: 'GEMINI_BILLING_ACK_' + ymCompact,
    allowed_models: GEMINI_MODELS_.slice()
  };
}

// ----------------------------------------------------------------------------
// 3. 시트 관리 및 안전 로깅 (헤더 인덱스 매핑 + 쓰기 락)
// ----------------------------------------------------------------------------

function aiBriefGetSpreadsheet_() {
  try {
    return SpreadsheetApp.getActiveSpreadsheet();
  } catch (e) {
    return null;
  }
}

/**
 * AI_Brief 시트 헤더가 이미 존재할 때 10칸 규격과 정확히 일치하는지 검사한다.
 * 불일치 시 덮어쓰지 않고 ERR_BRIEF_SCHEMA_MISMATCH 예외를 발생시킨다.
 */
function aiBriefValidateSheetHeader_(sh) {
  if (!sh) return null;
  const lastCol = sh.getLastColumn();
  if (lastCol === 0) {
    return null;
  }
  const headerValues = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (v) {
    return String(v || '').trim();
  });

  const missing = [];
  for (let i = 0; i < AI_BRIEF_HEADERS_.length; i += 1) {
    if (headerValues.indexOf(AI_BRIEF_HEADERS_[i]) === -1) {
      missing.push(AI_BRIEF_HEADERS_[i]);
    }
  }

  if (lastCol !== AI_BRIEF_HEADERS_.length || missing.length > 0) {
    throw createAppError_('ERR_BRIEF_SCHEMA_MISMATCH', 'AI_Brief 시트 헤더가 10칸 규격과 다릅니다.', {
      expected_count: AI_BRIEF_HEADERS_.length,
      actual_count: lastCol,
      missing: missing
    });
  }

  const map = {};
  for (let j = 0; j < headerValues.length; j += 1) {
    map[headerValues[j]] = j;
  }
  return map;
}

/**
 * AI_Brief 시트를 가져오거나(없으면 생성 후 1행 헤더 기록) 반환한다.
 * 테스트 더블 등 insertSheet가 없는 환경에서는 null을 반환한다.
 */
function aiBriefSheet_(ss) {
  if (!ss) return null;
  let sh = ss.getSheetByName(AI_BRIEF_SHEET_NAME_);
  if (!sh) {
    if (typeof ss.insertSheet !== 'function') {
      return null;
    }
    sh = ss.insertSheet(AI_BRIEF_SHEET_NAME_);
    sh.getRange(1, 1, 1, AI_BRIEF_HEADERS_.length).setValues([AI_BRIEF_HEADERS_]);
    return sh;
  }
  if (sh.getLastColumn() === 0) {
    sh.getRange(1, 1, 1, AI_BRIEF_HEADERS_.length).setValues([AI_BRIEF_HEADERS_]);
  } else {
    aiBriefValidateSheetHeader_(sh);
  }
  return sh;
}

/**
 * withWriteLock_ 안에서 헤더 순서대로 1행을 추가한다. 로그 실패는 삼킨다.
 */
function aiBriefLog_(ss, rowObj) {
  if (!ss || !rowObj) return;
  try {
    withWriteLock_(function () {
      const sh = aiBriefSheet_(ss);
      if (!sh) return;
      const ordered = AI_BRIEF_HEADERS_.map(function (col) {
        return rowObj[col] !== undefined && rowObj[col] !== null ? rowObj[col] : '';
      });
      sh.appendRow(ordered);
    });
  } catch (ignoreLogErr) {
    // 시트 로깅 실패가 본 응답을 깨뜨리지 않도록 삼킨다
  }
}

/**
 * AI_Brief 시트에서 조건에 맞는 최신 1행을 헤더 이름 매핑으로 읽는다.
 */
function aiBriefFindLatestRow_(sh, filter) {
  const colMap = aiBriefValidateSheetHeader_(sh);
  if (!colMap) return null;
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return null;

  const values = sh.getRange(2, 1, lastRow - 1, AI_BRIEF_HEADERS_.length).getValues();
  for (let r = values.length - 1; r >= 0; r -= 1) {
    const line = values[r];
    const rowDay = String(line[colMap.day] || '').trim();
    const rowScope = String(line[colMap.scope] || '').trim();
    const rowKind = String(line[colMap.kind] || '').trim();
    const rowStatus = String(line[colMap.status] || '').trim();

    if (filter.scope && rowScope !== filter.scope) continue;
    if (filter.kind && rowKind !== filter.kind) continue;
    if (filter.day && rowDay !== filter.day) continue;
    if (filter.onlyOk && rowStatus !== 'OK') continue;

    return {
      day: rowDay,
      scope: rowScope,
      kind: rowKind,
      model: String(line[colMap.model] || '').trim(),
      items_in: cleanInt_(line[colMap.items_in]) || 0,
      items_out: cleanInt_(line[colMap.items_out]) || 0,
      summary_json: String(line[colMap.summary_json] || '{}'),
      tokens_est: cleanInt_(line[colMap.tokens_est]) || 0,
      status: rowStatus,
      created_at: String(line[colMap.created_at] || '').trim()
    };
  }
  return null;
}

// ----------------------------------------------------------------------------
// 4. 입력 데이터 압축 수집 (순수 방어형 수집기)
// ----------------------------------------------------------------------------

/**
 * 시트 원문을 통째로 보내지 않고 핵심 필드만 뽑아 항목당 120자·총 12,000자로 접는다.
 * 시트가 없는 환경(테스트 더블 포함)에서도 예외 없이 빈 요약을 반환한다.
 */
function aiBriefCollect_(ss, opts) {
  const options = opts || {};
  const startMs = options.startMs || nowMs_();
  const dayCompact = options.dayCompact || kstDay_(new Date()).replace(/-/g, '');
  const props = options.props || null;

  const lines = [];
  const counts = {
    contents: 0,
    metrics: 0,
    channel_errors: 0,
    integrity: 0,
    blog_stats: 0
  };
  let itemsIn = 0;
  let dropped = 0;
  let totalChars = 0;
  let partial = false;

  const pushItem = function (section, idx, rawLine) {
    if (partial) {
      dropped += 1;
      return false;
    }
    if (nowMs_() - startMs > AI_BRIEF_TIME_BUDGET_MS_) {
      partial = true;
      dropped += 1;
      if (props) {
        try {
          props.setProperty('CURSOR_BRIEF_' + dayCompact, JSON.stringify({
            section: section,
            offset: idx,
            saved_at: formatKstIso_(new Date())
          }));
        } catch (ignorePropErr) {
          // 커서 기록 실패 무시
        }
      }
      return false;
    }

    const clipped = cleanText_(rawLine, AI_BRIEF_ITEM_MAX_CHARS_);
    if (!clipped) return false;
    const nextLen = totalChars + clipped.length + 1;
    if (nextLen > AI_BRIEF_TOTAL_MAX_CHARS_) {
      dropped += 1;
      return false;
    }
    lines.push(clipped);
    totalChars = nextLen;
    itemsIn += 1;
    return true;
  };

  if (!ss) {
    return { text: '(수집된 시트 없음)', items_in: 0, dropped: 0, counts: counts, partial: false };
  }

  // (1) Contents: updated_at 내림차순 30행
  const contentsRows = aiBriefReadTable_(ss.getSheetByName('Contents'));
  if (contentsRows.length > 0) {
    contentsRows.sort(function (a, b) {
      return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
    });
    const topContents = contentsRows.slice(0, 30);
    for (let i = 0; i < topContents.length; i += 1) {
      const c = topContents[i];
      const title = cleanText_(c.blog_title, 60);
      const line = '[C] ' +
        cleanText_(c.content_id, 20) + '|' +
        cleanText_(c.brand, 10) + '|' +
        cleanText_(c.status, 14) + '|B:' +
        cleanText_(c.blog_status, 10) + ',S:' +
        cleanText_(c.shorts_status, 10) + ',R:' +
        cleanText_(c.reels_status, 10) + ',CL:' +
        cleanText_(c.clip_status, 10) + ',D:' +
        cleanText_(c.daangn_status, 10) + '|' +
        title + '|' +
        cleanText_(c.updated_at, 19);
      if (pushItem('Contents', i, line)) {
        counts.contents += 1;
      }
    }
  }

  // (2) Metrics: 최근 7일 중 views 상위 10행
  const metricsRows = aiBriefReadTable_(ss.getSheetByName('Metrics'));
  if (metricsRows.length > 0) {
    const cutoff7d = new Date(Date.now() - 7 * 86400000);
    const cutoffIso = formatKstIso_(cutoff7d).slice(0, 10);
    const recentMetrics = metricsRows.filter(function (m) {
      const rec = String(m.recorded_at || '').trim();
      return !rec || rec.slice(0, 10) >= cutoffIso;
    });
    recentMetrics.sort(function (a, b) {
      return (cleanInt_(b.views) || 0) - (cleanInt_(a.views) || 0);
    });
    const topMetrics = recentMetrics.slice(0, 10);
    for (let j = 0; j < topMetrics.length; j += 1) {
      const m = topMetrics[j];
      const line = '[M] ' +
        cleanText_(m.content_id, 20) + '|' +
        cleanText_(m.channel, 12) + '|' +
        cleanText_(m.checkpoint, 10) + '|v:' +
        (cleanInt_(m.views) || 0) + '|lc:' +
        cleanText_(m.likes_comments, 20) + '|' +
        cleanText_(m.recorded_at, 19);
      if (pushItem('Metrics', j, line)) {
        counts.metrics += 1;
      }
    }
  }

  // (3) Channel_Logs: 최근 24시간 ERROR 건수 + 상위 5개 error_code
  const logRows = aiBriefReadTable_(ss.getSheetByName('Channel_Logs'));
  if (logRows.length > 0) {
    const cutoff24hMs = Date.now() - 86400000;
    const codeFreq = {};
    let errTotal = 0;
    for (let k = 0; k < logRows.length; k += 1) {
      const lg = logRows[k];
      if (String(lg.result_status || '').trim() !== 'ERROR') continue;
      const ts = Date.parse(String(lg.created_at || lg.recorded_at || lg.timestamp || ''));
      if (!isNaN(ts) && ts < cutoff24hMs) continue;
      errTotal += 1;
      const code = cleanText_(lg.error_code || 'UNKNOWN', 32) || 'UNKNOWN';
      codeFreq[code] = (codeFreq[code] || 0) + 1;
    }
    const topCodes = Object.keys(codeFreq)
      .sort(function (a, b) { return codeFreq[b] - codeFreq[a]; })
      .slice(0, 5)
      .map(function (c) { return c + '(' + codeFreq[c] + ')'; })
      .join(',');
    const errLine = '[ERR24H] count=' + errTotal + (topCodes ? ' top=' + topCodes : '');
    if (pushItem('Channel_Logs', 0, errLine)) {
      counts.channel_errors = errTotal;
    }
  }

  // (4) Integrity_Logs: 최근 1행 day, status
  const integRows = aiBriefReadTable_(ss.getSheetByName('Integrity_Logs'));
  if (integRows.length > 0) {
    const lastInteg = integRows[integRows.length - 1];
    const integLine = '[INT] day=' + cleanText_(lastInteg.day, 12) + ' status=' + cleanText_(lastInteg.status, 24);
    if (pushItem('Integrity_Logs', 0, integLine)) {
      counts.integrity = 1;
    }
  }

  // (5) Blog_Stats: 시트가 있으면 최근 1행 요약
  const blogStatRows = aiBriefReadTable_(ss.getSheetByName('Blog_Stats'));
  if (blogStatRows.length > 0) {
    const lastBlog = blogStatRows[blogStatRows.length - 1];
    const summaryPairs = Object.keys(lastBlog).slice(0, 6).map(function (key) {
      return key + ':' + cleanText_(lastBlog[key], 16);
    }).join(',');
    if (summaryPairs && pushItem('Blog_Stats', 0, '[BSTAT] ' + summaryPairs)) {
      counts.blog_stats = 1;
    }
  }

  return {
    text: lines.length > 0 ? lines.join('\n') : '(수집된 운영 데이터 0건)',
    items_in: itemsIn,
    dropped: dropped,
    counts: counts,
    partial: partial
  };
}

/**
 * 시트의 1행 헤더를 기준으로 객체 배열로 안전하게 읽는다.
 */
function aiBriefReadTable_(sh) {
  if (!sh) return [];
  try {
    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    if (lastRow < 2 || lastCol < 1) return [];
    const raw = sh.getRange(1, 1, lastRow, lastCol).getValues();
    const headers = raw[0].map(function (h) { return String(h || '').trim(); });
    const out = [];
    for (let r = 1; r < raw.length; r += 1) {
      const obj = {};
      for (let c = 0; c < headers.length; c += 1) {
        if (headers[c]) {
          obj[headers[c]] = raw[r][c];
        }
      }
      out.push(obj);
    }
    return out;
  } catch (e) {
    return [];
  }
}

// ----------------------------------------------------------------------------
// 5. PII 스크러빙 · 일일 예산 카운터 · Gemini API 호출
// ----------------------------------------------------------------------------

/**
 * 전송 직전 개인정보 패턴(주민번호·휴대폰·12~16자리 숫자·이메일·도로명주소)을 치환하고,
 * 치환 후에도 잔존 패턴이 감지되면 전송을 차단한다.
 */
function aiBriefScrubPii_(inputText) {
  let text = String(inputText || '');

  const rules = [
    { name: 'rrn', replaceRe: /\d{6}-?\d{7}/g, testRe: /\d{6}-?\d{7}/ },
    { name: 'phone', replaceRe: /01\d-?\d{3,4}-?\d{4}/g, testRe: /01\d-?\d{3,4}-?\d{4}/ },
    { name: 'long_digits', replaceRe: /(^|\D)\d{12,16}(?=\D|$)/g, testRe: /(^|\D)\d{12,16}(?=\D|$)/, keepPrefix: true },
    { name: 'email', replaceRe: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, testRe: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/ },
    { name: 'road_address', replaceRe: /(?:[가-힣]{2,6}(?:시|도)\s*)?[가-힣]{1,6}(?:시|군|구)\s+[가-힣0-9]{1,10}(?:로|길)\s*\d+(?:-\d+)?/g, testRe: /(?:[가-힣]{2,6}(?:시|도)\s*)?[가-힣]{1,6}(?:시|군|구)\s+[가-힣0-9]{1,10}(?:로|길)\s*\d+(?:-\d+)?/ }
  ];

  for (let i = 0; i < rules.length; i += 1) {
    const r = rules[i];
    if (r.keepPrefix) {
      text = text.replace(r.replaceRe, '$1***');
    } else {
      text = text.replace(r.replaceRe, '***');
    }
  }

  const remaining = [];
  for (let j = 0; j < rules.length; j += 1) {
    if (rules[j].testRe.test(text)) {
      remaining.push(rules[j].name);
    }
  }

  return {
    text: text,
    blocked: remaining.length > 0,
    remainingPatterns: remaining
  };
}

/**
 * LockService 안에서 일일 80콜 상한을 검사하고 1회를 선차감한다.
 */
function aiBriefConsumeBudget_(dayCompact) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) {
    throw createAppError_('ERR_BUSY', '다른 요약 작업이 실행 중입니다. 잠시 후 다시 시도하세요.');
  }
  try {
    const props = PropertiesService.getScriptProperties();
    const key = 'AI_BRIEF_CNT_' + dayCompact;
    const used = cleanInt_(props.getProperty(key)) || 0;
    if (used >= AI_BRIEF_DAY_CAP_) {
      throw createAppError_('ERR_GEMINI_BUDGET', '일일 Gemini 호출 상한을 초과했습니다.', {
        used: used,
        cap: AI_BRIEF_DAY_CAP_
      });
    }
    props.setProperty(key, String(used + 1));
    return used + 1;
  } finally {
    lock.releaseLock();
  }
}

/**
 * 네트워크/5xx 오류로 실패한 호출에 대해 선차감한 1회 예산을 환불한다.
 */
function aiBriefRefundBudget_(dayCompact) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) return;
  try {
    const props = PropertiesService.getScriptProperties();
    const key = 'AI_BRIEF_CNT_' + dayCompact;
    const used = cleanInt_(props.getProperty(key)) || 0;
    if (used > 0) {
      props.setProperty(key, String(used - 1));
    }
  } finally {
    lock.releaseLock();
  }
}

/**
 * Gemini REST API 단일 호출기 (x-goog-api-key 헤더 사용, 429 즉시 중단, 5xx 2초 후 1회 재시도)
 */
function geminiCall_(model, prompt, apiKey) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
    encodeURIComponent(model) + ':generateContent';

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 800,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          headline: { type: 'STRING' },
          topics: { type: 'ARRAY', items: { type: 'STRING' } },
          highlights: { type: 'ARRAY', items: { type: 'STRING' } },
          action_needed: { type: 'ARRAY', items: { type: 'STRING' } }
        },
        required: ['headline']
      }
    }
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(body),
    headers: { 'x-goog-api-key': apiKey },
    muteHttpExceptions: true
  };

  let lastHttpCode = 0;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let res = null;
    try {
      res = UrlFetchApp.fetch(url, options);
    } catch (netErr) {
      lastHttpCode = 0;
      if (attempt === 1) {
        Utilities.sleep(2000);
        continue;
      }
      return { ok: false, status: 'ERROR', httpCode: 0 };
    }

    const code = res.getResponseCode();
    lastHttpCode = code;
    const bodyText = res.getContentText() || '';

    // 429 또는 quota 초과 응답은 재시도 없이 즉시 SKIPPED_429 반환
    if (code === 429 || /RESOURCE_EXHAUSTED|quota/i.test(bodyText)) {
      return { ok: false, status: 'SKIPPED_429', httpCode: 429 };
    }

    if (code >= 200 && code < 300) {
      const parsedBody = aiBriefSafeJsonParse_(bodyText, null);
      if (!parsedBody || !parsedBody.candidates || !parsedBody.candidates[0]) {
        return { ok: true, rawText: bodyText, totalTokenCount: null };
      }
      const parts = (parsedBody.candidates[0].content && parsedBody.candidates[0].content.parts) || [];
      let joined = '';
      for (let p = 0; p < parts.length; p += 1) {
        if (parts[p] && typeof parts[p].text === 'string') {
          joined += parts[p].text;
        }
      }
      const totalTokens = parsedBody.usageMetadata && typeof parsedBody.usageMetadata.totalTokenCount === 'number'
        ? parsedBody.usageMetadata.totalTokenCount
        : null;
      return { ok: true, rawText: joined, totalTokenCount: totalTokens };
    }

    // 5xx 서버 오류만 2초 백오프 후 1회 재시도
    if (code >= 500 && attempt === 1) {
      Utilities.sleep(2000);
      continue;
    }

    return { ok: false, status: 'ERROR', httpCode: code };
  }

  return { ok: false, status: 'ERROR', httpCode: lastHttpCode };
}

// ----------------------------------------------------------------------------
// 6. 응답 정규화 및 헬퍼
// ----------------------------------------------------------------------------

function aiBriefParseResponse_(rawText) {
  const cleaned = String(rawText || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const obj = aiBriefSafeJsonParse_(cleaned, null);
  if (!obj || typeof obj !== 'object' || typeof obj.headline !== 'string') {
    return {
      ok: false,
      summary: {
        headline: '',
        raw_excerpt: cleanText_(cleaned, 300)
      }
    };
  }

  const normalizeList = function (arr, maxItems, maxChars) {
    if (!Array.isArray(arr)) return [];
    const out = [];
    for (let i = 0; i < arr.length && out.length < maxItems; i += 1) {
      const item = cleanText_(arr[i], maxChars);
      if (item) out.push(item);
    }
    return out;
  };

  return {
    ok: true,
    summary: {
      headline: cleanText_(obj.headline, 60),
      topics: normalizeList(obj.topics, 5, 40),
      highlights: normalizeList(obj.highlights, 5, 40),
      action_needed: normalizeList(obj.action_needed, 3, 40)
    }
  };
}

function aiBriefBuildRecord_(spec) {
  return {
    day: spec.day,
    scope: spec.scope,
    kind: spec.kind,
    model: spec.model,
    items_in: spec.items_in || 0,
    items_out: spec.items_out || 0,
    summary_json: JSON.stringify(spec.summaryObj || { headline: '' }),
    tokens_est: spec.tokens_est || 0,
    status: spec.status,
    created_at: spec.created_at
  };
}

function aiBriefEnrichResponse_(row, extra) {
  const summary = aiBriefSafeJsonParse_(row.summary_json, {
    headline: '',
    topics: [],
    highlights: [],
    action_needed: []
  });
  const out = {
    day: row.day,
    scope: row.scope,
    kind: row.kind,
    model: row.model,
    items_in: row.items_in,
    items_out: row.items_out,
    summary_json: row.summary_json,
    summary: summary,
    summary_1line: summary.headline || '',
    action_needed: Array.isArray(summary.action_needed) ? summary.action_needed : [],
    tokens_est: row.tokens_est,
    status: row.status,
    created_at: row.created_at
  };
  if (extra) {
    const keys = Object.keys(extra);
    for (let i = 0; i < keys.length; i += 1) {
      out[keys[i]] = extra[keys[i]];
    }
  }
  return out;
}

function aiBriefSafeJsonParse_(str, fallback) {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch (e) {
    return fallback;
  }
}

// ----------------------------------------------------------------------------
// 7. Apps Script 편집기용 공개 함수 (트리거 설치/제거/실행/자가진단)
// ----------------------------------------------------------------------------

/**
 * 매일 03:30 KST 야간 요약 트리거를 설치한다. 이미 있으면 중복 설치하지 않는다.
 */
function installAiBriefTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i += 1) {
    if (triggers[i].getHandlerFunction() === 'runAiBriefTrigger') {
      return { installed: false, note: 'already_exists' };
    }
  }
  ScriptApp.newTrigger('runAiBriefTrigger')
    .timeBased()
    .inTimezone('Asia/Seoul')
    .atHour(3)
    .nearMinute(30)
    .everyDays(1)
    .create();
  return { installed: true, schedule: '03:30 Asia/Seoul' };
}

/**
 * 등록된 야간 요약 트리거를 모두 제거한다.
 */
function removeAiBriefTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;
  for (let i = 0; i < triggers.length; i += 1) {
    if (triggers[i].getHandlerFunction() === 'runAiBriefTrigger') {
      ScriptApp.deleteTrigger(triggers[i]);
      removed += 1;
    }
  }
  return { removed: removed };
}

/**
 * 시간 기반 트리거 엔트리포인트 (예외를 밖으로 던지지 않고 로그만 남긴다)
 */
function runAiBriefTrigger() {
  try {
    return handleAiBriefRun_(null, { scope: AI_BRIEF_SCOPE_, kind: AI_BRIEF_DEFAULT_KIND_ });
  } catch (e) {
    const code = e && e.code ? e.code : 'ERR_UNKNOWN';
    Logger.log('runAiBriefTrigger failed: ' + code);
    return null;
  }
}

/**
 * 외부 API 호출 없이 키·과금인지·모델·오늘 사용량·시트 헤더만 점검한다(키 값 노출 금지).
 */
function aiBriefSelfTest() {
  const now = new Date();
  const day = kstDay_(now);
  const dayCompact = day.replace(/-/g, '');
  const ymCompact = dayCompact.slice(0, 6);

  const props = PropertiesService.getScriptProperties();
  const hasKey = Boolean(cleanText_(props.getProperty('GEMINI_API_KEY'), 256));
  const ackRaw = cleanText_(props.getProperty('GEMINI_BILLING_ACK_' + ymCompact), 16);
  const billingAck = Boolean(ackRaw && (ackRaw === '1' || ackRaw.toLowerCase() === 'true'));
  const used = cleanInt_(props.getProperty('AI_BRIEF_CNT_' + dayCompact)) || 0;
  const exhausted = props.getProperty('GEMINI_EXHAUSTED_' + dayCompact) === '1';

  let sheetStatus = 'NOT_CREATED';
  const ss = aiBriefGetSpreadsheet_();
  const sh = ss ? ss.getSheetByName(AI_BRIEF_SHEET_NAME_) : null;
  if (sh) {
    try {
      aiBriefValidateSheetHeader_(sh);
      sheetStatus = 'OK_10_COLS';
    } catch (e) {
      sheetStatus = e && e.code ? e.code : 'ERR_BRIEF_SCHEMA_MISMATCH';
    }
  }

  return {
    ok: true,
    day: day,
    has_api_key: hasKey,
    billing_ack: billingAck,
    billing_ack_key: 'GEMINI_BILLING_ACK_' + ymCompact,
    default_model: AI_BRIEF_DEFAULT_MODEL_,
    allowed_models: GEMINI_MODELS_.slice(),
    used_today: used,
    cap_today: AI_BRIEF_DAY_CAP_,
    exhausted_429: exhausted,
    sheet_status: sheetStatus
  };
}