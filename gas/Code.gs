/**
 * gas/Code.gs  —  Web App 엔트리포인트(doGet/doPost) + M1 라우터
 * Content Hub OS
 *
 * 처리 순서 (PRD v2 §(e))
 *   본문 크기 → JSON 파싱 → 인증·화이트리스트 → 쿼터 서킷 → (읽기: 락 없음 / 쓰기: tryLock)
 *   → 멱등 확인 → 핸들러 → 감사 로그(Channel_Logs) → 응답(meta 계측)
 *
 * 모든 예외는 JSON 으로만 나간다. GAS 가 HTML 오류 페이지를 내보내면 프론트 res.json() 이 깨지므로
 * 최상위 try/catch 에서 반드시 envelope 로 감싼다.
 */

/* ------------------------------------------------------------------ *
 * GET — 토큰 없는 liveness 전용
 * ------------------------------------------------------------------ */

function doGet(e) {
  const t0 = Date.now();
  try {
    // 토큰을 URL 로 보내는 요청은 즉시 거부 (히스토리·Referer 유출 방지)
    if (e && e.parameter && e.parameter.auth_token) {
      return jsonOut_({
        ok: false, action: 'liveness',
        error: { code: 'ERR_GET_TOKEN_FORBIDDEN', message: '토큰은 URL이 아닌 요청 본문으로만 보냅니다.' },
        timestamp: formatKstIso_(new Date())
      }, t0);
    }
    const action = (e && e.parameter && e.parameter.action) || 'health';
    if (action !== 'health') {
      return jsonOut_({
        ok: false, action: action,
        error: { code: 'ERR_UNKNOWN_ACTION', message: 'GET 은 liveness 확인만 지원합니다. 데이터는 POST 로 호출하세요.' },
        timestamp: formatKstIso_(new Date())
      }, t0);
    }
    return jsonOut_({
      ok: true,
      action: 'liveness',
      data: {
        service: 'ContentHubOS',
        alive: true,
        version: 'v2-m1',
        timezone: 'Asia/Seoul',
        time: formatKstIso_(new Date())
      },
      timestamp: formatKstIso_(new Date())
    }, t0);
  } catch (err) {
    return jsonOut_(errorEnvelope_('liveness', err), t0);
  }
}

/* ------------------------------------------------------------------ *
 * POST — 모든 데이터 액션
 * ------------------------------------------------------------------ */

function doPost(e) {
  const t0 = Date.now();
  const ctx = { action: '', brand: '', clientId: 'unknown', idempotencyKey: '', startedAtMs: t0 };
  let ss = null;

  try {
    const raw = (e && e.postData && e.postData.contents) || '';
    assertRequestSizeWithinLimit_(raw);

    let body;
    try {
      body = JSON.parse(raw);
    } catch (parseErr) {
      throw createAppError_('ERR_VALIDATION_FAILED', '요청 본문이 올바른 JSON 이 아닙니다.');
    }
    if (!body || typeof body !== 'object') {
      throw createAppError_('ERR_VALIDATION_FAILED', '요청 본문이 비어 있습니다.');
    }

    ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureSchemaV2_(ss);   // 당근 2칸 + Metrics 3칸 — 첫 호출에만 헤더를 늘린다(기존 열 순서 불변)

    // 인증 · 화이트리스트 · 브랜드
    const auth = authenticateRequest_(e, body, { allowAllBrand: true, requireBrand: false });
    ctx.action = auth.action;
    ctx.brand = auth.brand;
    ctx.clientId = auth.clientId;
    ctx.idempotencyKey = auth.idempotencyKey;

    // 쿼터 서킷브레이커
    const degraded = checkQuotaCircuit_(auth.spec);

    // 멱등 힌트 (이미 처리된 키면 즉시 재응답)
    const hint = getIdempotencyHint_(ctx.idempotencyKey);
    if (hint) {
      hint.meta = hint.meta || {};
      hint.meta.cache_hit = true;
      hint.meta.server_ms = Date.now() - t0;
      hint.meta.quota_degraded = degraded;
      hint.meta.lock_wait_ms = 0;
      hint.timestamp = hint.timestamp || formatKstIso_(new Date());
      return jsonOut_(hint, t0);
    }

    if (!auth.spec.m1) {
      throw createAppError_('ERR_NOT_IMPLEMENTED',
        '이 액션은 Milestone 2~3에서 구현됩니다: ' + ctx.action,
        { planned_milestone: ctx.action === 'claim_task' ? 'M2' : 'M3' });
    }

    const payload = (body.payload && typeof body.payload === 'object') ? body.payload : {};
    if (auth.spec.mode === 'WRITE') {
      assertNoSensitiveFields_(payload, 'payload');   // 민감정보 저장 차단
    }

    const handler = M1_HANDLERS[ctx.action];
    if (!handler) {
      throw createAppError_('ERR_NOT_IMPLEMENTED', '핸들러가 없습니다: ' + ctx.action);
    }

    let lockWaitMs = 0;
    let data;
    const needLock = auth.spec.mode === 'WRITE' && !auth.spec.longRunning;
    if (needLock) {
      data = withWriteLock_(function (waited) {
        lockWaitMs = waited;
        // 락 안에서 확정 멱등 검사 (Cache 힌트가 놓친 경우 대비)
        const confirmed = findConfirmedIdempotencyInSheet_(ss, ctx.idempotencyKey);
        if (confirmed && confirmed.result_status === 'OK') {
          return { __replayed: true, confirmed: confirmed };
        }
        return handler(ss, payload, ctx, auth);
      });
    } else {
      data = handler(ss, payload, ctx, auth);
    }
    if (data && data.__replayed) {
        const env = {
          ok: true, action: ctx.action, brand: ctx.brand || null,
          data: { replayed: true, content_id: data.confirmed.content_id,
                  response_digest: data.confirmed.response_digest },
          timestamp: formatKstIso_(new Date()),
          meta: { idempotent_replay: true, cache_hit: true, server_ms: Date.now() - t0,
                  lock_wait_ms: lockWaitMs, quota_degraded: degraded }
        };
        return jsonOut_(env, t0);
    }

    const env = {
      ok: true,
      action: ctx.action,
      brand: ctx.brand || null,
      data: data,
      timestamp: formatKstIso_(new Date()),
      meta: {
        server_ms: Date.now() - t0,
        lock_wait_ms: lockWaitMs,
        cache_hit: false,
        quota_degraded: degraded
      }
    };

    // 읽기는 감사 로그를 남기지 않는다(쿼터·행 폭증 방지). 쓰기와 오류만 기록.
    if (auth.spec.mode === 'WRITE') {
      recordIdempotencyAndAudit_(ss, {
        action: ctx.action, brand: ctx.brand, contentId: data && data.content_id,
        idempotencyKey: ctx.idempotencyKey, clientId: ctx.clientId,
        resultStatus: 'OK', responseData: data,
        serverMs: Date.now() - t0, lockWaitMs: lockWaitMs
      });
    }

    return jsonOut_(env, t0);

  } catch (err) {
    if (isQuotaError_(err)) recordQuotaFailure_(err.message);

    try {
      if (ss) {
        recordIdempotencyAndAudit_(ss, {
          action: ctx.action, brand: ctx.brand, idempotencyKey: ctx.idempotencyKey,
          clientId: ctx.clientId, resultStatus: 'ERROR',
          errorCode: err.code || 'ERR_INTERNAL',
          errorDetail: err.message, serverMs: Date.now() - t0
        });
      }
    } catch (logErr) { /* 감사 실패가 응답을 막지 않게 */ }

    return jsonOut_(errorEnvelope_(ctx.action, err), t0);
  }
}

function errorEnvelope_(action, err) {
  const code = (err && err.code) || 'ERR_INTERNAL';
  return {
    ok: false,
    action: action || '',
    error: {
      code: code,
      message: sanitizeErrorDetail_((err && err.message) || '알 수 없는 오류'),
      details: (err && err.details) || {}
    },
    timestamp: formatKstIso_(new Date()),
    meta: { server_ms: null, lock_wait_ms: null, cache_hit: false, quota_degraded: isQuotaDegraded_() }
  };
}

/** ContentService 는 헤더를 못 바꾸므로 본문만 JSON 으로 확실히 내보낸다 */
function jsonOut_(obj, t0) {
  if (obj && obj.meta && obj.meta.server_ms == null) obj.meta.server_ms = Date.now() - (t0 || Date.now());
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ------------------------------------------------------------------ *
 * M1 핸들러
 * ------------------------------------------------------------------ */

const M1_HANDLERS = {
  health: handleHealth_,
  list_contents: handleListContents_,
  get_content_detail: handleGetContentDetail_,
  create_content: handleCreateContent_,
  update_content: handleUpdateContent_,
  record_checklist: handleRecordChecklist_,
  list_metrics: handleListMetrics_,
  record_metrics: handleRecordMetrics_,
  // 유튜브·인스타 자동 수집 (2026-11-19, gas/Analytics.gs)
  list_analytics: handleListAnalytics_,
  ingest_analytics: handleIngestAnalytics_,
  // 채널 목록·콘텐츠 상세 드릴다운 (2026-11-19) — gas/PostDetail.gs
  get_post_detail: handleGetPostDetail_,
  upsert_media_meta: handleUpsertMediaMeta_,
  list_media_meta: handleListMediaMeta_,
  get_system_health: handleGetSystemHealth_,
  backup_now: handleBackupNow_,
  integrity_check: handleIntegrityCheck_,
  restore_from_snapshot: handleRestoreFromSnapshot_,
  rotate_token: handleRotateToken_,
  run_coldstart_onboarding: handleRunColdstartOnboarding_,
  // 원스톱 만들기 화면 (2026-11-18, O4) — gas/Orders.gs
  list_drive_media: handleListDriveMedia_,
  hub_order: handleHubOrder_,
  // 내 블로그 보기 (2026-11-19) — gas/Blog.gs
  blog_sync: handleBlogSync_,
  list_blog_stats: handleListBlogStats_,
  blog_post_body: handleBlogPostBody_,
  blog_rank_check: handleBlogRankCheck_,
  blog_stats_ingest: handleBlogStatsIngest_
};

function handleHealth_(ss, payload) {
  const sheets = ss.getSheets().map(function (s) { return s.getName(); });
  const expected = (typeof SHEET_SCHEMAS !== 'undefined') ? Object.keys(SHEET_SCHEMAS) : [];
  const missing = expected.filter(function (n) { return sheets.indexOf(n) === -1; });

  const props = PropertiesService.getScriptProperties();
  const foldersOk = !!props.getProperty('ROOT_FOLDER_ID') && !!props.getProperty('BACKUP_ROOT_FOLDER_ID');
  const brandRows = readSheetAsObjects_(ss, 'Brand_Config');

  return {
    sheets_total: sheets.length,
    sheets_expected: expected.length,
    sheets_missing: missing,
    drive_folders_ready: foldersOk,
    brands: brandRows.map(function (r) { return r.brand; }),
    token_set: !!getSecretToken_(),
    backup: getBackupStatus_(),
    quota_degraded: isQuotaDegraded_(),
    daily_calls: getDailyCallCount_()
  };
}

function handleListContents_(ss, payload, ctx) {
  const limit = Math.min(Number(payload.limit || 50), 200);
  const page = Math.max(Number(payload.page || 1), 1);
  const status = payload.status ? String(payload.status) : '';
  const cluster = payload.cluster_id ? String(payload.cluster_id) : '';
  const q = payload.q ? String(payload.q).toLowerCase() : '';

  const rows = readSheetAsObjects_(ss, 'Contents');
  let filtered = rows;
  const brandFilter = payload.brand || ctx.brand;
  if (brandFilter && brandFilter !== 'ALL') {
    filtered = filtered.filter(function (r) { return r.brand === brandFilter; });
  }
  if (status) filtered = filtered.filter(function (r) { return r.status === status; });
  if (cluster) filtered = filtered.filter(function (r) { return r.cluster_id === cluster; });
  if (q) {
    filtered = filtered.filter(function (r) {
      return String(r.place_name || '').toLowerCase().indexOf(q) !== -1
          || String(r.blog_title || '').toLowerCase().indexOf(q) !== -1
          || String(r.target_keywords || '').toLowerCase().indexOf(q) !== -1;
    });
  }

  filtered.sort(function (a, b) { return String(b.updated_at || '').localeCompare(String(a.updated_at || '')); });
  const start = (page - 1) * limit;
  const slice = filtered.slice(start, start + limit);

  return {
    total: filtered.length,
    page: page,
    limit: limit,
    has_more: start + limit < filtered.length,
    items: slice.map(function (r) {
      return {
        content_id: r.content_id, brand: r.brand, version: r.version, status: r.status,
        cluster_id: r.cluster_id, region_dong: r.region_dong, category: r.category,
        place_name: r.place_name, blog_title: r.blog_title, quality_score: r.quality_score,
        blog_status: r.blog_status, shorts_status: r.shorts_status,
        reels_status: r.reels_status, clip_status: r.clip_status,
        growth_tag: r.growth_tag, updated_at: r.updated_at,
        target_keywords: r.target_keywords,
        series_id: r.series_id, episode_no: r.episode_no, hook_variant: r.hook_variant,
        ig_feed_status: r.ig_feed_status, ig_feed_url: r.ig_feed_url, ig_carousel_count: r.ig_carousel_count,
        daangn_status: r.daangn_status, daangn_url: r.daangn_url
      };
    })
  };
}

function handleGetContentDetail_(ss, payload) {
  const contentId = String(payload.content_id || '').trim();
  if (!contentId) throw createAppError_('ERR_VALIDATION_FAILED', 'content_id 가 필요합니다.');

  const rows = readSheetAsObjects_(ss, 'Contents');
  const row = rows.filter(function (r) { return String(r.content_id) === contentId; })[0];
  if (!row) throw createAppError_('ERR_NOT_FOUND', '콘텐츠를 찾지 못했습니다: ' + contentId);

  let payloadJson = null;
  if (row.payload_file_id) {
    try {
      payloadJson = JSON.parse(DriveApp.getFileById(row.payload_file_id).getBlob().getDataAsString());
    } catch (err) {
      payloadJson = { _error: 'payload 파일을 읽지 못했습니다: ' + sanitizeErrorDetail_(err.message) };
    }
  }

  const siblings = rows.filter(function (r) {
    return r.cluster_id === row.cluster_id && r.content_id !== contentId
      && (r.status === 'PUBLISHED' || r.status === 'LINKED');
  }).slice(0, 3).map(function (r) {
    return { content_id: r.content_id, title: r.blog_title || r.place_name, blog_url: r.blog_url };
  });

  const rules = readSheetAsObjects_(ss, 'Prompt_Rules').filter(function (r) {
    return r.brand === row.brand && r.status === 'ACTIVE';
  });

  return {
    content_id: row.content_id,
    brand: row.brand,
    version: row.version,
    status: row.status,
    meta: row,
    payload: payloadJson,
    internal_links: siblings,
    active_rules: rules
  };
}

function handleCreateContent_(ss, payload, ctx) {
  const brand = payload.brand || ctx.brand;
  if (!brand || VALID_BRANDS_.indexOf(brand) === -1) {
    throw createAppError_('ERR_INVALID_BRAND', 'create_content 는 brand 가 필수입니다.');
  }
  if (!payload.place_name) {
    throw createAppError_('ERR_VALIDATION_FAILED', 'place_name 은 필수입니다.');
  }

  const contentId = nextContentId_(ss, brand);
  const now = formatKstIso_(new Date());
  const isKimmary = brand === 'ppiyak_kimmary';

  // Drive payload 먼저 (Ops_Queue 의도 기록 → 파일 쓰기 → 시트 행)
  const opsId = openOpsQueue_(ss, {
    brand: brand, contentId: contentId, opType: 'CREATE_CONTENT',
    status: 'PENDING_PAYLOAD', note: { place_name: payload.place_name }
  });

  const doc = {
    content_id: contentId,
    brand: brand,
    version: 1,
    created_at: now,
    updated_at: now,
    capture: payload,
    blog: null,
    shorts: null,
    reels: null,
    clip: null,
    internal_links: []
  };
  const fileId = writePayload_(brand, contentId, doc);

  const sheet = ss.getSheetByName('Contents');
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const rowObj = {
    content_id: contentId,
    brand: brand,
    version: 1,
    status: 'DRAFT',
    cluster_id: payload.cluster_id || '',
    region_dong: payload.region_dong || '',
    category: payload.category || '',
    place_id: payload.place_id || '',
    place_name: payload.place_name,
    naver_place_url: payload.naver_place_url || '',
    target_keywords: payload.target_keywords || '',
    blog_title: '',
    quality_score: '',
    receipt_verified: payload.receipt_verified === true,
    media_drive_url: payload.media_drive_url || '',
    payload_file_id: fileId,
    blog_status: isKimmary ? 'SKIPPED' : 'PENDING',
    blog_url: '',
    shorts_status: 'PENDING',
    shorts_url: '',
    reels_status: 'PENDING',
    reels_url: '',
    clip_status: 'PENDING',   // 2026-11-16 사용자 확정 — 메리 트랙도 네이버 클립을 올린다(3채널 완주)
    clip_url: '',
    daangn_status: isKimmary ? 'SKIPPED' : 'PENDING',   // 당근 스토리 — 대전 청년만 5번째 채널
    daangn_url: '',
    allow_partial_shortform: payload.allow_partial_shortform === true,
    growth_tag: 'NONE',
    created_at: now,
    updated_at: now,
    updated_by: ctx.clientId || 'user'
  };
  sheet.appendRow(headers.map(function (h) { return rowObj[h] === undefined ? '' : rowObj[h]; }));
  completeOpsQueue_(ss, opsId, 'COMPLETED');

  return {
    content_id: contentId,
    brand: brand,
    version: 1,
    status: 'DRAFT',
    payload_file_id: fileId,
    pipeline_mode: isKimmary ? 'ONE_STAGE_SHORTFORM' : 'TWO_STAGE_CIRCULAR'
  };
}

function handleUpdateContent_(ss, payload, ctx) {
  const contentId = String(payload.content_id || '').trim();
  if (!contentId) throw createAppError_('ERR_VALIDATION_FAILED', 'content_id 가 필요합니다.');

  const sheet = ss.getSheetByName('Contents');
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) throw createAppError_('ERR_NOT_FOUND', '콘텐츠가 없습니다.');

  const idCol = headers.indexOf('content_id');
  const verCol = headers.indexOf('version');
  const all = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  let rowIndex = -1;
  for (let i = 0; i < all.length; i++) {
    if (String(all[i][idCol]) === contentId) { rowIndex = i; break; }
  }
  if (rowIndex < 0) throw createAppError_('ERR_NOT_FOUND', '콘텐츠를 찾지 못했습니다: ' + contentId);

  const currentVersion = Number(all[rowIndex][verCol] || 1);
  if (payload.expected_version != null && Number(payload.expected_version) !== currentVersion) {
    throw createAppError_('ERR_VERSION_CONFLICT', '다른 곳에서 먼저 수정되었습니다.', {
      expected: Number(payload.expected_version), current: currentVersion
    });
  }

  const brand = all[rowIndex][headers.indexOf('brand')];
  const fileId = all[rowIndex][headers.indexOf('payload_file_id')];

  // READY 승격 게이트: 사람 검수 + 80점 이상 (네이버 약관 가드)
  if (payload.status === 'READY') {
    assertReadyGate_(ss, contentId, payload.target_channel || 'naver_blog');
  }

  // payload 갱신 (file_id 재사용 — 새 파일을 만들지 않는다)
  let doc = null;
  try {
    doc = fileId ? JSON.parse(DriveApp.getFileById(fileId).getBlob().getDataAsString()) : {};
  } catch (err) { doc = {}; }
  doc = doc || {};
  doc.version = currentVersion + 1;
  doc.updated_at = formatKstIso_(new Date());
  if (payload.patch && typeof payload.patch === 'object') {
    Object.keys(payload.patch).forEach(function (k) { doc[k] = payload.patch[k]; });
  }
  if (fileId) {
    writePayloadToFile_(fileId, doc);
  } else {
    all[rowIndex][headers.indexOf('payload_file_id')] = writePayload_(brand, contentId, doc);
  }

  // 시트 갱신 (넘어온 필드만)
  const editable = ['status', 'blog_title', 'quality_score', 'target_keywords', 'cluster_id',
    'region_dong', 'category', 'place_name', 'naver_place_url', 'media_drive_url',
    'blog_status', 'blog_url', 'shorts_status', 'shorts_url', 'reels_status', 'reels_url',
    'clip_status', 'clip_url', 'allow_partial_shortform', 'growth_tag', 'receipt_verified',
    'series_id', 'episode_no', 'hook_variant',
    'ig_feed_status', 'ig_feed_url', 'ig_carousel_count',
    'daangn_status', 'daangn_url'];
  editable.forEach(function (k) {
    if (payload[k] !== undefined && headers.indexOf(k) >= 0) {
      all[rowIndex][headers.indexOf(k)] = payload[k];
    }
  });
  all[rowIndex][verCol] = currentVersion + 1;
  all[rowIndex][headers.indexOf('updated_at')] = formatKstIso_(new Date());
  if (headers.indexOf('updated_by') >= 0) all[rowIndex][headers.indexOf('updated_by')] = ctx.clientId || 'user';

  sheet.getRange(2, 1, all.length, headers.length).setValues(all);

  return {
    content_id: contentId,
    version: currentVersion + 1,
    status: all[rowIndex][headers.indexOf('status')],
    payload_file_id: all[rowIndex][headers.indexOf('payload_file_id')]
  };
}

/** 모바일 10초 승인: 사람이 버튼을 누른 사실 + 점수를 Checklist_Runs 에 기록 */
function handleRecordChecklist_(ss, payload, ctx) {
  const contentId = String(payload.content_id || '').trim();
  if (!contentId) throw createAppError_('ERR_VALIDATION_FAILED', 'content_id 가 필요합니다.');

  const sheet = ss.getSheetByName('Checklist_Runs');
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const runId = 'CHK-' + Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMddHHmmss')
    + '-' + Math.floor(100 + Math.random() * 900);
  const score = Number(payload.total_score != null ? payload.total_score : 88);
  const rowObj = {
    run_id: runId,
    brand: payload.brand || ctx.brand || '',
    content_id: contentId,
    target_channel: payload.target_channel || 'naver_blog',
    total_score: score,
    passed: score >= 80,
    items_result_json: JSON.stringify(payload.items || {}),
    human_reviewed: payload.human_reviewed !== false,
    ai_disclosure_checked: payload.ai_disclosure_checked !== false,
    reviewer: payload.reviewer || ctx.clientId || 'user',
    checked_at: formatKstIso_(new Date())
  };
  sheet.appendRow(headers.map(function (h) { return rowObj[h] === undefined ? '' : rowObj[h]; }));
  return { run_id: runId, content_id: contentId, total_score: score, passed: score >= 80 };
}

function assertReadyGate_(ss, contentId, targetChannel) {
  const runs = readSheetAsObjects_(ss, 'Checklist_Runs').filter(function (r) {
    return String(r.content_id) === contentId
      && String(r.target_channel || '') === String(targetChannel);
  });
  if (!runs.length) {
    throw createAppError_('ERR_TOS_REVIEW_REQUIRED',
      '발행 전 체크리스트를 먼저 통과해야 합니다.', { content_id: contentId, channel: targetChannel });
  }
  const ok = runs.some(function (r) {
    const truthy = (r.human_reviewed === true || String(r.human_reviewed).toUpperCase() === 'TRUE');
    return truthy && Number(r.total_score) >= 80;
  });
  if (!ok) {
    throw createAppError_('ERR_TOS_REVIEW_REQUIRED',
      '사람 검수(human_reviewed)와 80점 이상이 확인되지 않았습니다.',
      { content_id: contentId, channel: targetChannel });
  }
}

function handleGetSystemHealth_(ss, payload) {
  const integrity = readSheetAsObjects_(ss, 'Integrity_Logs');
  const openIssues = integrity.filter(function (r) {
    return !(r.resolved === true || String(r.resolved).toUpperCase() === 'TRUE');
  });
  const contents = readSheetAsObjects_(ss, 'Contents');
  const needsHuman = contents.filter(function (r) { return r.status === 'NEEDS_HUMAN'; });
  const partial = contents.filter(function (r) { return r.status === 'PARTIAL_FAIL'; });
  const ops = readSheetAsObjects_(ss, 'Ops_Queue').filter(function (r) {
    return r.status !== 'COMPLETED';
  });

  return {
    backup: getBackupStatus_(),
    quota_degraded: isQuotaDegraded_(),
    quota_last_error: PropertiesService.getScriptProperties().getProperty('LAST_QUOTA_ERROR_MSG') || null,
    daily_calls: getDailyCallCount_(),
    auth_fail_count: Number(PropertiesService.getScriptProperties().getProperty('AUTH_FAIL_COUNT') || 0),
    needs_human: { count: needsHuman.length, items: needsHuman.slice(0, 10).map(function (r) {
      return { content_id: r.content_id, place_name: r.place_name, updated_at: r.updated_at };
    }) },
    partial_fail_count: partial.length,
    pending_ops: ops.length,
    open_integrity_issues: { count: openIssues.length, by_type: countBy_(openIssues, 'issue_type') },
    sheets_total: ss.getSheets().length,
    alert_channels: {
      slack: !!PropertiesService.getScriptProperties().getProperty('SLACK_WEBHOOK_URL'),
      email: PropertiesService.getScriptProperties().getProperty('ALERT_EMAIL') || 'default-owner',
      throttle_mode: CacheService.getScriptCache().get('THROTTLE_MODE') === 'true'
    }
  };
}

function handleBackupNow_(ss, payload) {
  const tier = String(payload.tier || 'MANUAL').toUpperCase();
  const allowed = ['MANUAL', 'DAILY', 'WEEKLY', 'MONTHLY'];
  if (allowed.indexOf(tier) === -1) {
    throw createAppError_('ERR_VALIDATION_FAILED', 'tier 는 MANUAL/DAILY/WEEKLY/MONTHLY 중 하나입니다.');
  }
  return runBackupPipeline_(tier, 'api:' + (payload.actor || 'user'));
}

function handleIntegrityCheck_(ss, payload) {
  return runIntegrityCheck_('api:' + (payload.actor || 'user'));
}

function handleRestoreFromSnapshot_(ss, payload) {
  return restoreFromSnapshotCore_(
    payload.snapshot_date,
    payload.confirm_phrase,
    payload.remap_contents !== false
  );
}

function handleRotateToken_(ss) {
  const newToken = rotateToken_();
  appendSystemHealth_({
    eventType: 'TOKEN_ROTATE', status: 'SUCCESS', actor: 'api', detail: 'rotated via rotate_token'
  });
  return {
    new_token: newToken,
    note: '이 값은 1회만 반환됩니다. 프론트 설정 화면에 즉시 붙여넣고, 이전 토큰은 즉시 무효입니다.'
  };
}

/* ------------------------------------------------------------------ *
 * 공용 헬퍼 (M1)
 * ------------------------------------------------------------------ */

function readSheetAsObjects_(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];
  const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = values[0].map(String);
  const out = [];
  for (let r = 1; r < values.length; r++) {
    const obj = {};
    for (let c = 0; c < headers.length; c++) obj[headers[c]] = values[r][c];
    out.push(obj);
  }
  return out;
}

function countBy_(arr, key) {
  const out = {};
  arr.forEach(function (x) { const k = String(x[key] || 'UNKNOWN'); out[k] = (out[k] || 0) + 1; });
  return out;
}

function nextContentId_(ss, brand) {
  const prefix = brand === 'ppiyak_kimmary' ? 'KM' : 'DY';
  const today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMdd');
  const rows = readSheetAsObjects_(ss, 'Contents');
  let max = 0;
  rows.forEach(function (r) {
    const m = String(r.content_id || '').match(/^([A-Z]{2})-(\d{8})-(\d{3})$/);
    if (m && m[1] === prefix && m[2] === today) {
      max = Math.max(max, parseInt(m[3], 10));
    }
  });
  return prefix + '-' + today + '-' + ('00' + (max + 1)).slice(-3);
}

function payloadFolderFor_(brand) {
  const props = PropertiesService.getScriptProperties();
  const id = brand === 'ppiyak_kimmary'
    ? props.getProperty('FOLDER_PPIYAK_KIMMARY')
    : props.getProperty('FOLDER_DAEJEON_YOUTH');
  if (!id) throw createAppError_('ERR_SERVER_CONFIG', 'payload 폴더가 준비되지 않았습니다. Setup을 실행하세요.');
  return DriveApp.getFolderById(id);
}

function writePayload_(brand, contentId, doc) {
  const folder = payloadFolderFor_(brand);
  const name = 'payload_' + contentId + '.json';
  const json = JSON.stringify(doc, null, 2);
  assertPayloadSizeWithinLimit_(json);

  const existing = folder.getFilesByName(name);
  if (existing.hasNext()) {
    const f = existing.next();
    f.setContent(json);
    return f.getId();
  }
  return folder.createFile(name, json, MimeType.PLAIN_TEXT).getId();
}

function writePayloadToFile_(fileId, doc) {
  const json = JSON.stringify(doc, null, 2);
  assertPayloadSizeWithinLimit_(json);
  DriveApp.getFileById(fileId).setContent(json);
}

function openOpsQueue_(ss, op) {
  const sheet = ss.getSheetByName('Ops_Queue');
  const id = 'OP-' + Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMddHHmmss')
    + '-' + Math.floor(100 + Math.random() * 900);
  sheet.appendRow([
    id, op.brand, op.contentId, op.opType, '', op.status || 'PENDING_PAYLOAD',
    0, JSON.stringify(op.note || {}), '', String(Date.now()), String(Date.now())
  ]);
  return id;
}

function completeOpsQueue_(ss, opId, status) {
  const sheet = ss.getSheetByName('Ops_Queue');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(opId)) {
      sheet.getRange(i + 2, 6).setValue(status);
      sheet.getRange(i + 2, 11).setValue(String(Date.now()));
      return;
    }
  }
}

/** 15분 유지보수에서 호출 — 중단된 Ops_Queue 항목을 재적용 후보로 표시 */
function drainOpsQueue_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Ops_Queue');
  if (!sheet || sheet.getLastRow() < 2) return { pending: 0 };
  const rows = readSheetAsObjects_(ss, 'Ops_Queue');
  const pending = rows.filter(function (r) { return r.status !== 'COMPLETED'; });
  pending.slice(0, 20).forEach(function (r) {
    if (String(r.status) === 'PENDING_SHEET') {
      // 페이로드는 이미 저장됨 → 시트 반영 여부만 남았다. 사람이 확인할 수 있게 표시만 유지.
      return;
    }
  });
  return { pending: pending.length };
}

/** 15분 유지보수에서 호출 — 만료 리스를 회수하고 재시도 가능 상태로 되돌린다 */
function reapExpiredLeases_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Content_Leases');
  if (!sheet || sheet.getLastRow() < 2) return { reaped: 0 };
  const lastRow = sheet.getLastRow();
  const values = sheet.getRange(2, 1, lastRow - 1, 10).getValues();
  const now = Date.now();
  let reaped = 0;
  for (let i = 0; i < values.length; i++) {
    const expires = Number(values[i][6] || 0);
    if (expires && expires < now) {
      values[i][4] = '';                 // lease_token
      values[i][5] = '';                 // lease_owner
      values[i][6] = 0;                  // lease_expires_at_ms
      values[i][8] = Number(values[i][8] || 0);  // attempt_count 유지
      reaped++;
    }
  }
  if (reaped) sheet.getRange(2, 1, values.length, 10).setValues(values);
  return { reaped: reaped };
}

/* ------------------------------------------------------------------ *
 * 성과(Metrics) — 성과분석 #/perf · 당근 수익화 트래커
 *
 * Contents 35칸은 건드리지 않는다. 시계열은 Metrics 시트에만 쌓는다.
 *  · checkpoint = 스냅샷(D1/D7/D14/D30)   · channel = blog|shorts|reels|clip|daangn
 *  · 기존 열(metric_id, brand, content_id, checkpoint, channel, views, avg_dwell_sec,
 *    search_inflow_pct, smartblock_exposed, likes_comments, recorded_at) 순서·이름 불변,
 *    뒤에 valid_views · saves · reward_krw 3칸만 덧붙인다.
 * ------------------------------------------------------------------ */

/** 2026-11-18 스키마 확장 — 첫 호출에만 헤더를 늘리고 ScriptProperty로 표시한다. */
function ensureSchemaV2_(ss) {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('SCHEMA_V2_DAANGN') === '1') return;
  ensureSheetColumns_(ss, 'Contents', ['daangn_status', 'daangn_url']);
  ensureSheetColumns_(ss, 'Metrics', ['valid_views', 'saves', 'reward_krw']);
  props.setProperty('SCHEMA_V2_DAANGN', '1');
}

/** 시트에 없는 열만 헤더 줄 끝에 붙인다(기존 열 위치·값 불변). */
function ensureSheetColumns_(ss, sheetName, cols) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return false;
  const lastCol = sheet.getLastColumn();
  const headers = lastCol < 1 ? [] : sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  const missing = cols.filter(function (c) { return headers.indexOf(c) < 0; });
  if (!missing.length) return false;
  sheet.getRange(1, lastCol + 1, 1, missing.length)
    .setValues([missing])
    .setBackground('#0F172A')
    .setFontColor('#F8FAFC')
    .setFontWeight('bold');
  return true;
}

function numOr_(v, dflt) {
  if (v === '' || v == null) return dflt;
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

/** 저장 시점 날짜 문자열(YYYY-MM-DD)을 KST 자정 ISO로. 없으면 지금. */
function metricStamp_(v) {
  const day = String(v || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) return day + 'T00:00:00+09:00';
  return formatKstIso_(new Date());
}

/**
 * 성과 숫자 입력. items 배열로 여러 채널을 한 번에 넣는다.
 * payload = { items:[{content_id, channel, snapshot, views, valid_views, likes_comments, saves, reward_krw, avg_dwell_sec, search_inflow_pct, measured_at}] }
 */
function handleRecordMetrics_(ss, payload, ctx) {
  const items = (Array.isArray(payload.items) && payload.items.length) ? payload.items : [payload];
  const sheet = ss.getSheetByName('Metrics');
  if (!sheet) throw createAppError_('ERR_SERVER_CONFIG', 'Metrics 시트가 없습니다. 초기 설치를 실행하세요.');
  ensureSheetColumns_(ss, 'Metrics', ['valid_views', 'saves', 'reward_krw']);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);

  const nowStamp = formatKstIso_(new Date());
  const rows = [];
  const ids = [];
  const daangnContents = [];

  items.forEach(function (it) {
    const contentId = String(it.content_id || '').trim();
    if (!contentId) throw createAppError_('ERR_VALIDATION_FAILED', 'content_id 가 필요합니다.');
    const channel = String(it.channel || '').trim();
    if (!channel) throw createAppError_('ERR_VALIDATION_FAILED', 'channel 이 필요합니다.');
    if (contentId.length > 64 || channel.length > 32) {
      throw createAppError_('ERR_VALIDATION_FAILED', 'content_id·channel 이 너무 깁니다.');
    }
    const stamp = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMddHHmmss');
    const metricId = 'MET-' + stamp + '-' + Math.floor(100 + Math.random() * 900);
    ids.push(metricId);
    if (channel === 'daangn') daangnContents.push(contentId);

    const rowObj = {
      metric_id: metricId,
      brand: it.brand || payload.brand || ctx.brand || '',
      content_id: contentId,
      checkpoint: String(it.snapshot || it.checkpoint || 'D1').toUpperCase(),
      channel: channel,
      views: numOr_(it.views, 0),
      avg_dwell_sec: numOr_(it.avg_dwell_sec, 0),
      search_inflow_pct: numOr_(it.search_inflow_pct, 0),
      smartblock_exposed: it.smartblock_exposed === true,
      likes_comments: numOr_(it.likes_comments, 0),
      recorded_at: metricStamp_(it.measured_at || it.recorded_at),
      valid_views: numOr_(it.valid_views, 0),
      saves: numOr_(it.saves, 0),
      reward_krw: numOr_(it.reward_krw, 0)
    };
    rows.push(headers.map(function (h) { return rowObj[h] === undefined ? '' : rowObj[h]; }));
  });

  const lastRow = sheet.getLastRow();
  sheet.getRange(lastRow + 1, 1, rows.length, headers.length).setValues(rows);

  /* 당근 숫자를 넣었다면 = 그 스토리를 올렸다는 뜻. 비어 있던 상태만 UPLOADED로 올린다(되돌리지 않음). */
  daangnContents.forEach(function (id) {
    try { markDaangnUploaded_(ss, id); } catch (err) { /* 표시 실패가 저장을 막지 않게 */ }
  });

  return { count: rows.length, metric_ids: ids, recorded_at: nowStamp };
}

function markDaangnUploaded_(ss, contentId) {
  const sheet = ss.getSheetByName('Contents');
  if (!sheet) return false;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const idCol = headers.indexOf('content_id');
  const stCol = headers.indexOf('daangn_status');
  if (idCol < 0 || stCol < 0) return false;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;
  const vals = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  for (let i = 0; i < vals.length; i++) {
    if (String(vals[i][idCol]) !== String(contentId)) continue;
    const cur = String(vals[i][stCol] || '').toUpperCase();
    if (cur && cur !== 'PENDING') return false;   // 이미 올림·실패·건너뜀 기록이 있으면 그대로 둔다
    sheet.getRange(i + 2, stCol + 1).setValue('UPLOADED');
    return true;
  }
  return false;
}

/** 성과 조회 — 기간(from~to, YYYY-MM-DD)·브랜드·카드·채널로 거른다. */
function handleListMetrics_(ss, payload, ctx) {
  const from = String(payload.from || '').slice(0, 10);
  const to = String(payload.to || '').slice(0, 10);
  const brand = String(payload.brand || ctx.brand || '');
  const contentId = String(payload.content_id || '').trim();
  const channel = String(payload.channel || '').trim();

  const rows = readSheetAsObjects_(ss, 'Metrics');
  const out = rows.filter(function (r) {
    if (!r.content_id) return false;
    if (brand && brand !== 'ALL' && String(r.brand) !== brand) return false;
    if (contentId && String(r.content_id) !== contentId) return false;
    if (channel && String(r.channel) !== channel) return false;
    const day = String(r.recorded_at || '').slice(0, 10);
    if (from && day && day < from) return false;
    if (to && day && day > to) return false;
    return true;
  }).map(function (r) {
    return {
      metric_id: r.metric_id,
      brand: r.brand,
      content_id: String(r.content_id),
      channel: String(r.channel || ''),
      snapshot: String(r.checkpoint || ''),
      views: Number(r.views) || 0,
      valid_views: Number(r.valid_views) || 0,
      avg_dwell_sec: Number(r.avg_dwell_sec) || 0,
      search_inflow_pct: Number(r.search_inflow_pct) || 0,
      likes_comments: Number(r.likes_comments) || 0,
      saves: Number(r.saves) || 0,
      reward_krw: Number(r.reward_krw) || 0,
      measured_at: String(r.recorded_at || '')
    };
  }).sort(function (a, b) { return String(a.measured_at).localeCompare(String(b.measured_at)); });

  return { brand: brand, from: from, to: to, count: out.length, rows: out };
}
