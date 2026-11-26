/**
 * gas/Setup.gs
 * - 23개 시트 스키마 생성 및 헤더 스타일링
 * - Drive 브랜드별 Payload 폴더 + 비공개 Backup 폴더 생성 (ID는 PropertiesService 전용)
 * - 32바이트 base64url 토큰 최초 발급 (시트·로그에 평문 미기록)
 * - 전역 Config, Brand_Config(대전청년/삐약김메리), Prompt_Rules v1.0 시딩
 * - 일일/주간/월간 백업 + 15분 리스 회수 트리거 자동 설치
 */

const SHEET_SCHEMAS = {
  Contents: [
    'content_id', 'brand', 'version', 'status', 'cluster_id', 'region_dong', 'category',
    'place_id', 'place_name', 'naver_place_url', 'target_keywords', 'blog_title', 'quality_score',
    'receipt_verified', 'media_drive_url', 'payload_file_id', 'blog_status', 'blog_url',
    'shorts_status', 'shorts_url', 'reels_status', 'reels_url', 'clip_status', 'clip_url',
    'allow_partial_shortform', 'growth_tag', 'created_at', 'updated_at', 'updated_by',
    // M2 — 시리즈 진행률(발행 n/5)과 훅 유형 비교
    'series_id', 'episode_no', 'hook_variant',
    // 인스타 표면 분리 — 릴스(reels_*)와 피드 카드뉴스(ig_feed_*)는 노출 엔진·지표가 다르다
    'ig_feed_status', 'ig_feed_url', 'ig_carousel_count',
    // 당근 스토리 — 대전 청년 5번째 채널(2026-11-18). 기존 35칸 순서·이름 불변, 뒤에만 덧붙임
    'daangn_status', 'daangn_url',
    // 사진 카드 클립 — 실제 Contents 시트 1행 헤더(40칸)와 일치시킨다(2026-11-25). 앞 37칸 순서·이름 불변
    'photo_clip_status', 'photo_clip_url', 'photo_clip_uploaded_at'
  ],
  Channel_Logs: [
    'log_id', 'brand', 'content_id', 'channel', 'task_type', 'idempotency_key', 'client_id',
    'lease_token', 'lease_expires_at', 'result_status', 'retry_count', 'error_code',
    'error_detail', 'created_at', 'response_digest', 'server_ms'
  ],
  Metrics: [
    'metric_id', 'brand', 'content_id', 'checkpoint', 'channel', 'views', 'avg_dwell_sec',
    'search_inflow_pct', 'smartblock_exposed', 'likes_comments', 'recorded_at',
    // 성과분석(#/perf) — 채널별 최소 입력(2026-11-18, 뒤에만 덧붙임)
    'valid_views', 'saves', 'reward_krw'
  ],
  Config: [
    'config_key', 'config_group', 'config_value', 'description', 'updated_at'
  ],
  Brand_Config: [
    'brand', 'brand_name', 'niche_summary', 'active_channels_json', 'skipped_channels_json',
    'pipeline_mode', 'persona_json', 'format_rules_json', 'kpi_weights_json',
    'drive_subfolder_id', 'updated_at'
  ],
  Benchmarks: [
    'benchmark_id', 'brand', 'source_type', 'source_url', 'source_title', 'raw_content',
    'credibility_score', 'ad_hype_flag', 'extracted_rules_json', 'status', 'linked_rule_id',
    'collected_by', 'collected_at'
  ],
  Prompt_Rules: [
    'rule_id', 'brand', 'rule_scope', 'version_tag', 'status', 'rule_payload_json',
    'source_benchmark_id', 'experiment_id', 'control_avg_score', 'variant_avg_score',
    'prev_active_rule_id', 'approved_by', 'created_at', 'activated_at'
  ],
  Keywords: [
    'keyword_id', 'brand', 'keyword', 'cluster_id', 'monthly_search_vol', 'total_docs',
    'golden_ratio', 'golden_grade', 'data_source', 'assigned_content_id', 'updated_at'
  ],
  Rank_Log: [
    'rank_log_id', 'brand', 'content_id', 'keyword', 'surface', 'rank_pos', 'index_status',
    'bldex_grade', 'check_method', 'note', 'checked_at'
  ],
  Metrics_Same_Age: [
    'same_age_id', 'brand', 'content_id', 'channel', 'age_bucket', 'views_or_plays',
    'impressions_or_shown', 'vvsa_or_3s_retention_pct', 'stayed_or_engaged_views',
    'avg_pct_viewed_or_dwell', 'replays', 'sends_per_reach_pct', 'saves_per_reach_pct',
    'clip_ctr_pct', 'new_viewer_pct', 'outlier_score', 'source_mode', 'recorded_at'
  ],
  Hooks: [
    'hook_id', 'brand', 'hook_type', 'hook_template', 'usage_count', 'avg_3s_retention_pct',
    'avg_outlier_score', 'status', 'source_benchmark_id', 'updated_at'
  ],
  Formats: [
    'format_id', 'brand', 'format_name', 'spec_json', 'sample_count', 'avg_outlier_72h',
    'lifecycle_status', 'decision_note', 'created_at', 'updated_at'
  ],
  Checklist_Runs: [
    'run_id', 'brand', 'content_id', 'target_channel', 'total_score', 'passed',
    'items_result_json', 'human_reviewed', 'ai_disclosure_checked', 'reviewer', 'checked_at'
  ],
  Challenge_Missions: [
    'mission_id', 'brand', 'week_key', 'mission_type', 'target_count', 'qualified_count',
    'excluded_ai_count', 'linked_content_ids', 'reward_krw', 'status', 'note', 'updated_at'
  ],
  Applications: [
    'app_id', 'brand', 'platform', 'campaign_name', 'exposure_score', 'status',
    'deadline_at', 'content_id', 'sponsor_disclosure', 'reward_value_krw', 'updated_at'
  ],
  Experiments: [
    'experiment_id', 'brand', 'exp_type', 'hypothesis', 'control_ref', 'variant_ref',
    'primary_metric', 'control_value', 'variant_value', 'winner', 'status', 'updated_at'
  ],
  Places: [
    'place_id', 'brand', 'place_name', 'region_dong', 'category', 'address', 'naver_place_url',
    'business_hours', 'signature_menus', 'parking_info', 'first_order_rule', 'visit_count', 'updated_at'
  ],
  Outreach: [
    'outreach_id', 'brand', 'date_kst', 'platform', 'target_account_or_url', 'comment_text',
    'char_count', 'execution_mode', 'reciprocal_visited', 'created_at'
  ],
  CTA_Log: [
    'cta_id', 'brand', 'content_id', 'channel', 'cta_slot', 'cta_copy', 'experiment_id',
    'ab_group', 'profile_visits_48h', 'new_follows_48h', 'blog_inflow_48h', 'captured_at'
  ],
  Content_Leases: [
    'lease_key', 'brand', 'content_id', 'channel', 'lease_token', 'lease_owner',
    'lease_expires_at_ms', 'renewed_at_ms', 'attempt_count', 'next_retry_at_ms'
  ],
  Ops_Queue: [
    'op_id', 'brand', 'content_id', 'op_type', 'target_file_id', 'status',
    'retry_count', 'payload_snapshot_json', 'last_error', 'created_at_ms', 'updated_at_ms'
  ],
  System_Health: [
    'event_id', 'event_type', 'status', 'snapshot_folder_name', 'sheets_copied',
    'payloads_copied', 'total_bytes', 'manifest_hash', 'actor', 'detail', 'created_at'
  ],
  Integrity_Logs: [
    'check_id', 'run_date', 'severity', 'issue_type', 'brand',
    'target_ref', 'detail', 'resolved', 'detected_at'
  ]
};

/**
 * 스프레드시트 상단 커스텀 메뉴 (토큰을 로그/시트에 남기지 않고 소유자 화면에만 표시)
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('ContentHub OS')
    .addItem('1. 초기 설치 실행 (Setup)', 'setupContentHubOS')
    .addItem('2. API 토큰 확인 (로그 미기록)', 'showTokenOnceInDialog')
    .addItem('3. 지금 수동 백업 실행', 'runManualBackupFromMenu')
    .addItem('4. 지금 무결성 점검 실행', 'runIntegrityCheckFromMenu')
    .addItem('5. 4채널 링크 규칙 적용 (유효성·조건부 서식)', 'applyContentLinkRulesFromMenu')
    .addItem('6. 4채널 링크 점검 → 일부 발행을 발행으로', 'syncPublishStatusFromMenu')
    .addToUi();
}

function showTokenOnceInDialog() {
  const token = PropertiesService.getScriptProperties().getProperty('API_SECRET_TOKEN');
  if (!token) {
    SpreadsheetApp.getUi().alert('토큰이 아직 생성되지 않았습니다. 먼저 초기 설치를 실행하세요.');
    return;
  }
  const html = HtmlService.createHtmlOutput(
    '<div style="font-family:sans-serif;padding:12px;">' +
    '<p style="margin:0 0 8px;font-weight:bold;">API_SECRET_TOKEN (시트·로그에 저장되지 않음)</p>' +
    '<input type="text" readonly value="' + token + '" style="width:100%;padding:8px;font-family:monospace;" onclick="this.select();" />' +
    '<p style="margin:8px 0 0;font-size:12px;color:#475569;">입력칸을 클릭해 복사한 뒤 웹앱 설정창에 붙여넣으세요.</p>' +
    '</div>'
  ).setWidth(460).setHeight(150);
  SpreadsheetApp.getUi().showModalDialog(html, 'ContentHub OS 보안 토큰');
}

function runManualBackupFromMenu() {
  const res = runBackupPipeline_('MANUAL', 'sheet-menu');
  SpreadsheetApp.getUi().alert('수동 백업 완료: ' + JSON.stringify(res));
}

function runIntegrityCheckFromMenu() {
  const res = runIntegrityCheck_('sheet-menu');
  SpreadsheetApp.getUi().alert(res.partial
    ? '무결성 점검을 이어서 하는 중이에요(지금까지 ' + res.total_issues + '건). 몇 분 뒤 Integrity_Logs 시트에서 확인하세요.'
    : '무결성 점검 완료: 총 ' + res.total_issues + '건 발견');
}

/**
 * 전체 시스템 초기 설치 (멱등 실행 가능)
 */
function setupContentHubOS() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const props = PropertiesService.getScriptProperties();

  // 1. Drive 비공개 폴더 계층 생성 (ID는 PropertiesService에만 저장)
  const payloadRoot = getOrCreatePrivateFolder_(DriveApp.getRootFolder(), 'ContentHubOS_Payloads');
  const dyFolder = getOrCreatePrivateFolder_(payloadRoot, 'daejeon_youth');
  const kmFolder = getOrCreatePrivateFolder_(payloadRoot, 'ppiyak_kimmary');
  const bmkFolder = getOrCreatePrivateFolder_(payloadRoot, 'benchmarks');

  const backupRoot = getOrCreatePrivateFolder_(DriveApp.getRootFolder(), 'ContentHubOS_Backups');
  const dailyBackupFolder = getOrCreatePrivateFolder_(backupRoot, 'daily');
  const weeklyBackupFolder = getOrCreatePrivateFolder_(backupRoot, 'weekly');
  const monthlyBackupFolder = getOrCreatePrivateFolder_(backupRoot, 'monthly');
  const restoredFolder = getOrCreatePrivateFolder_(backupRoot, 'restored');

  props.setProperties({
    ROOT_FOLDER_ID: payloadRoot.getId(),
    FOLDER_DAEJEON_YOUTH: dyFolder.getId(),
    FOLDER_PPIYAK_KIMMARY: kmFolder.getId(),
    FOLDER_BENCHMARKS: bmkFolder.getId(),
    BACKUP_ROOT_FOLDER_ID: backupRoot.getId(),
    BACKUP_DAILY_FOLDER_ID: dailyBackupFolder.getId(),
    BACKUP_WEEKLY_FOLDER_ID: weeklyBackupFolder.getId(),
    BACKUP_MONTHLY_FOLDER_ID: monthlyBackupFolder.getId(),
    BACKUP_RESTORED_FOLDER_ID: restoredFolder.getId()
  });

  // 2. 32바이트 랜덤 base64url 토큰 발급 (평문 로그/시트 저장 절대 금지)
  let token = props.getProperty('API_SECRET_TOKEN');
  if (!token) {
    token = generateSecureToken_();
    props.setProperty('API_SECRET_TOKEN', token);
  }
  const tokenHashPrefix = sha256Hex_(token).slice(0, 8);

  // 3. 23개 시트 생성 및 헤더 정렬
  Object.keys(SHEET_SCHEMAS).forEach((sheetName) => {
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
    }
    const headers = SHEET_SCHEMAS[sheetName];
    sheet.getRange(1, 1, 1, headers.length)
      .setValues([headers])
      .setBackground('#0F172A')
      .setFontColor('#F8FAFC')
      .setFontWeight('bold');
    sheet.setFrozenRows(1);
  });

  const defaultSheet = ss.getSheetByName('시트1') || ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 1) {
    ss.deleteSheet(defaultSheet);
  }

  const now = formatKstIso_(new Date());

  // 4. 전역 Config 시딩 (토큰 평문 미포함)
  const configSheet = ss.getSheetByName('Config');
  if (configSheet.getLastRow() === 1) {
    const configRows = [
      ['API_SECRET_TOKEN_STATUS', 'SYSTEM', 'SET (sha256:' + tokenHashPrefix + ')', '실제 토큰은 ScriptProperties에만 보관', now],
      ['LEASE_MINUTES', 'SYSTEM', '30', 'AI 비서 작업 선점 리스 유효 시간(분)', now],
      ['MAX_PAYLOAD_BYTES', 'SYSTEM', '204800', '단일 Drive payload JSON 최대 바이트(200KB)', now],
      ['MAX_REQUEST_BYTES', 'SYSTEM', '524288', '단일 POST 요청 본문 최대 바이트(512KB)', now],
      ['TOS_DAILY_OUTREACH_MAX', 'TOS_GUARD', '20', '사람 소통 댓글 일일 최대 상한(건)', now],
      ['TOS_OUTREACH_CHAR_RANGE', 'TOS_GUARD', '150,260', '소통 댓글 권장 글자 수 범위', now],
      ['CLIP_AI_MAX_RATIO', 'TOS_GUARD', '0.49', '네이버 클립 챌린지 인정 AI 비중 상한', now],
      ['COST_FREE_TRIAL_WEEKS', 'COST_POLICY', '4', '무료 도구 조합 우선 운영 기간(주)', now]
    ];
    configSheet.getRange(2, 1, configRows.length, 5).setValues(configRows);
  }

  // 5. Brand_Config 시딩 (트랙 A & 트랙 B 완전 분리)
  const brandSheet = ss.getSheetByName('Brand_Config');
  if (brandSheet.getLastRow() === 1) {
    const brandRows = [
      [
        'daejeon_youth',
        '대전 청년',
        '대전 로컬 맛집·술집·일상·자동차 리뷰 (2030 남성 70% · 여성 30%)',
        JSON.stringify({
          naver_blog: 'youth-daejeon',
          youtube_shorts: '@daejeon_daily',
          instagram_reels: '@daejeon_daily',
          naver_clip: '38cj7vrin2',
          daangn: 'daangn_story'
        }),
        JSON.stringify([]),
        'TWO_STAGE_CIRCULAR',
        JSON.stringify({
          nickname: '대전청년',
          tone: '충청도식 유쾌한 입담 + 현실 자폭 유머(주식 파란불·마이너스 통장·웨이팅) + 솔직한 단점 1개 필수',
          banned_phrases: ['결론적으로', '다양한 매력을 지닌', '입안 가득 퍼지는 황홀한', '방문해 보시는 건 어떨까요', '총평하자면']
        }),
        JSON.stringify({
          title_formula: '[지역 + 동네 + 메인메뉴/맛집키워드] 상호명 + 솔직후기/방문기 : "본문 핵심 썰 / 찰진 자폭 감성 한 줄 카피"',
          steps: ['01.도입부썰', '01-B.AEO30초팩트표+FAQ', '02.외관&웨이팅', '03.메뉴판&가격', '04.기본찬&킬링반찬', '05.메인먹방', '06.필승먹조합', '07.총평박스+지도+내부링크'],
          chars_no_space: [1500, 2500],
          keyword_repeat: [5, 7],
          clip_rules: { aspect: '9:16', min_sec: 3, max_sec: 90, max_hashtags: 5, body_max_chars: 3000 }
        }),
        JSON.stringify({
          primary: ['search_rank', 'place_inflow_pct', 'avg_dwell_sec', 'reviewnote_score', 'clip_mission'],
          outlier_threshold: 1.5
        }),
        dyFolder.getId(),
        now
      ],
      [
        'ppiyak_kimmary',
        '삐약 김메리',
        '반려묘 숏폼 (고양이 일상·패러디·챌린지, 다운비트 박자 싱크)',
        JSON.stringify({
          youtube_shorts: '@m2owmari',
          instagram_reels: '@m2ow.mari',
          naver_clip: ''   // 2026-11-16: 메리 트랙도 클립 업로드 대상. 채널 ID는 업로드 단계에서 채운다
        }),
        JSON.stringify(['naver_blog', 'daangn']),
        'ONE_STAGE_SHORTFORM',
        JSON.stringify({
          character: '삐약 김메리',
          tone: '집사 시점의 귀여운 주접 + 반전 자막 + 다운비트 박자 컷편집',
          banned_phrases: ['결론적으로', '다양한 매력을 지닌']
        }),
        JSON.stringify({
          aspect: '9:16',
          min_sec: 3,
          max_sec: 60,
          beat_sync: 'downbeat',
          hashtag_count: 5,
          single_cta_per_video: true,
          thumbnail_style: 'cute_pastel_high_contrast'
        }),
        JSON.stringify({
          primary: ['vvsa_or_3s_retention_pct', 'avg_pct_viewed_or_dwell', 'sends_per_reach_pct', 'saves_per_reach_pct', 'new_follows_48h'],
          outlier_threshold: 1.5
        }),
        kmFolder.getId(),
        now
      ]
    ];
    brandSheet.getRange(2, 1, brandRows.length, 11).setValues(brandRows);
  }

  // 6. Prompt_Rules v1.0 초기 시딩
  const rulesSheet = ss.getSheetByName('Prompt_Rules');
  if (rulesSheet.getLastRow() === 1) {
    const ruleRows = [
      [
        'RULE-DY-001', 'daejeon_youth', 'BLOG_PROMPT', 'v1.0', 'ACTIVE',
        JSON.stringify({ enforce_aeo_table: true, enforce_eeat_con: true, min_photos: 5, min_videos: 1 }),
        '', '', '', '', '', 'system', now, now
      ],
      [
        'RULE-KM-001', 'ppiyak_kimmary', 'SHORTFORM_PROMPT', 'v1.0', 'ACTIVE',
        JSON.stringify({ hook_window_sec: 3, sync: 'downbeat', max_hashtags: 5, single_cta: true }),
        '', '', '', '', '', 'system', now, now
      ]
    ];
    rulesSheet.getRange(2, 1, ruleRows.length, 14).setValues(ruleRows);
  }

  // 7. 백업 및 유지보수 트리거 설치
  installSystemTriggers_();

  Logger.log('ContentHubOS setup completed. Use Spreadsheet menu [ContentHub OS > 2. API 토큰 확인] to view token.');
}

function getOrCreatePrivateFolder_(parent, name) {
  const iter = parent.getFoldersByName(name);
  const folder = iter.hasNext() ? iter.next() : parent.createFolder(name);
  try {
    folder.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  } catch (e) {
    // Workspace 도메인 정책에 의해 PRIVATE가 이미 기본값인 경우 무시
  }
  return folder;
}

/**
 * 트리거만 다시 설치한다(편집기 함수 목록에서 고를 수 있는 공개 함수). 시트·폴더·토큰은 건드리지 않는다.
 * 백업·무결성 점검 일정이 바뀐 새 버전을 배포한 뒤 한 번 실행한다. 여러 번 실행해도 중복되지 않는다.
 */
function reinstallSystemTriggers() {
  installSystemTriggers_();
  Logger.log('시스템 트리거를 다시 설치했습니다.');
}

function installSystemTriggers_() {
  const managedHandlers = [
    'runDailyBackupTrigger',
    'runWeeklyBackupTrigger',
    'runMonthlyBackupTrigger',
    'runIntegrityCheckTrigger',
    'runMaintenanceTrigger'
  ];
  ScriptApp.getProjectTriggers().forEach((t) => {
    if (managedHandlers.indexOf(t.getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(t);
    }
  });

  // 일일 백업 (매일 03:00 KST)
  ScriptApp.newTrigger('runDailyBackupTrigger')
    .timeBased()
    .everyDays(1)
    .atHour(3)
    .inTimezone('Asia/Seoul')
    .create();

  // 무결성 점검 (매일 05:00 KST) — 백업(03:00~)·주간(일 03:30)·월간(1일 04:00)과 1시간 이상 떨어뜨린다.
  // 한 번에 4분 30초까지만 돌고 남으면 2분 뒤 이어서 한다(runIntegrityResumeTrigger).
  ScriptApp.newTrigger('runIntegrityCheckTrigger')
    .timeBased()
    .everyDays(1)
    .atHour(5)
    .inTimezone('Asia/Seoul')
    .create();

  // 주간 백업 (매주 일요일 03:30 KST)
  ScriptApp.newTrigger('runWeeklyBackupTrigger')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY)
    .atHour(3)
    .nearMinute(30)
    .inTimezone('Asia/Seoul')
    .create();

  // 월간 백업 (매월 1일 04:00 KST)
  ScriptApp.newTrigger('runMonthlyBackupTrigger')
    .timeBased()
    .onMonthDay(1)
    .atHour(4)
    .inTimezone('Asia/Seoul')
    .create();

  // 만료 리스 회수(reap) 및 Ops_Queue 복구 (15분마다)
  ScriptApp.newTrigger('runMaintenanceTrigger')
    .timeBased()
    .everyMinutes(15)
    .create();
}

/* formatKstIso_ / sha256Hex_ / generateSecureToken_ 은 Auth.gs 에 정의되어 있다 (중복 정의 방지) */

/* ================================================================== *
 * 4채널 발행 링크 — 시트 유효성 규칙 · 기록 점검 (2026-11-26)
 *
 * keyring Q-20261126-133433-06n9: 클립·쇼츠·릴스·블로그에 올린 주소가 시트에
 *   비어 있으면 자동 수집기가 그 영상을 찾지 못하고, '발행 완료'로 넘겨도 채널 칸이 빈다.
 *   프론트(js/channelLinks.js)와 같은 호스트·정규식으로 시트에서도 판정한다.
 *   · 링크가 4채널 모두 찼을 때만 상태를 'PUBLISHED'(일부 발행)로 올린다 — 내리는 일은 없다.
 *   · 메뉴에서 사람이 누를 때만 시트를 바꾼다(트리거 없음).
 * ================================================================== */

/** 채널 → 상태 열 · 주소 열 · 주소 규칙. js/channelLinks.js LINK_RULES 와 같아야 한다. */
const CONTENT_LINK_RULES = {
  blog: {
    label: '블로그', status: 'blog_status', url: 'blog_url',
    host: 'blog.naver.com',
    pattern: '^https?://(m\\.)?blog\\.naver\\.com/(PostView\\.naver|[A-Za-z0-9_.-]+/[0-9]+)'
  },
  shorts: {
    label: '쇼츠', status: 'shorts_status', url: 'shorts_url',
    host: 'youtube.com',
    pattern: '^https?://((www|m)\\.)?(youtube\\.com/(shorts/|watch)|youtu\\.be/)'
  },
  reels: {
    label: '릴스', status: 'reels_status', url: 'reels_url',
    host: 'instagram.com',
    /* 계정이 앞에 붙은 형태(instagram.com/{계정}/reel/…, …/{계정}/reels/…)도 받는다 */
    pattern: '^https?://(www\\.)?instagram\\.com/([A-Za-z0-9_.]+/)?reels?/'
  },
  clip: {
    label: '클립', status: 'clip_status', url: 'clip_url',
    host: 'clip.naver.com', alias_hosts: ['naver.me'],
    /* 발급 주소가 naver.me 단축주소로 적혀 있어도 같은 채널(2026-11-26 실 시트 9건) */
    pattern: '^https?://(www\\.)?(clip\\.naver\\.com|naver\\.me)/'
  }
};

/** 주소를 적는 4채널 — 이 순서로 유효성 규칙을 건다 */
const CONTENT_LINK_CHANNELS = ['blog', 'shorts', 'reels', 'clip'];

/** 올라간 것으로 치는 상태(js/trackChannels.js DONE_STATES 와 같다) */
const CONTENT_DONE_STATES = ['UPLOADED', 'DONE', 'PUBLISHED', 'LINKED'];

const CONTENT_ALL_STATUS_COL = {
  blog: 'blog_status', shorts: 'shorts_status', reels: 'reels_status',
  feed: 'ig_feed_status', clip: 'clip_status', daangn: 'daangn_status'
};
const CONTENT_ALL_URL_COL = {
  blog: 'blog_url', shorts: 'shorts_url', reels: 'reels_url',
  feed: 'ig_feed_url', clip: 'clip_url', daangn: 'daangn_url'
};

/** 그 채널의 주소가 규칙에 맞는가 — 빈 값은 false */
function linkUrlMatches_(channel, url) {
  const rule = CONTENT_LINK_RULES[channel];
  if (!rule) return true;
  const t = String(url == null ? '' : url).trim();
  if (!t) return false;
  try { return new RegExp(rule.pattern, 'i').test(t); } catch (e) { return false; }
}

/**
 * 카드 1장의 채널 기록 점검 — js/channelLinks.js auditLinks 와 같은 판정.
 * @param {Object} row Contents 한 행(열 이름 → 값)
 * @return {{complete:boolean, total:number, recorded:number, missing:Array, no_url:Array, bad_url:Array, items:Array}}
 */
function channelLinkAudit_(row) {
  const r = row || {};
  const brand = r.brand || 'daejeon_youth';
  const track = (typeof TRACK_CHANNELS !== 'undefined' && TRACK_CHANNELS[brand]) || ['blog', 'shorts', 'reels', 'feed', 'clip', 'daangn'];
  const items = [];
  let missing = 0;
  for (let i = 0; i < track.length; i++) {
    const ch = track[i];
    const statusCol = CONTENT_ALL_STATUS_COL[ch];
    const urlCol = CONTENT_ALL_URL_COL[ch];
    const status = String(r[statusCol] || '');
    if (status === 'SKIPPED') continue;
    const url = String(r[urlCol] || '').trim();
    const done = CONTENT_DONE_STATES.indexOf(status) >= 0;
    const needsUrl = CONTENT_LINK_CHANNELS.indexOf(ch) >= 0;
    let state = 'ok';
    let note = '';
    if (!done) { state = 'no_status'; note = '기록 없음'; }
    else if (needsUrl && !url) { state = 'no_url'; note = '주소 없음'; }
    else if (needsUrl && url && !linkUrlMatches_(ch, url)) { state = 'bad_url'; note = '주소 확인'; }
    if (state !== 'ok') missing++;
    items.push({ channel: ch, label: (CONTENT_LINK_RULES[ch] || {}).label || ch, status: status, url: url, state: state, note: note });
  }
  const pick = function (st) {
    return items.filter(function (it) { return it.state === st; }).map(function (it) { return it.channel; });
  };
  return {
    complete: items.length > 0 && missing === 0,
    total: items.length,
    recorded: items.length - missing,
    missing: pick('no_status'),
    no_url: pick('no_url'),
    bad_url: pick('bad_url'),
    items: items
  };
}

/** 감사 결과 → '클립(주소 없음) · 릴스(기록 없음)' */
function channelLinkAuditText_(audit) {
  return ((audit && audit.items) || [])
    .filter(function (it) { return it.state !== 'ok'; })
    .map(function (it) { return it.label + '(' + (it.note || '확인') + ')'; })
    .join(' · ');
}

/** 1 → 'A', 27 → 'AA' */
function columnLetter_(n) {
  let v = Number(n) || 0;
  let out = '';
  while (v > 0) {
    const rem = (v - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    v = Math.floor((v - 1) / 26);
  }
  return out || 'A';
}

/**
 * Contents 의 4채널 주소 열에 걸 데이터 유효성 규칙 정의.
 *  · 빈 칸은 통과(아직 안 올린 채널), 값이 있으면 그 채널 주소 규칙에 맞아야 한다.
 *  · allowInvalid=true 라 기존에 잘못 적힌 값도 지우지 않고 경고만 남긴다.
 */
function contentLinkValidationSpec_(headers) {
  const hs = (headers || SHEET_SCHEMAS.Contents || []).map(String);
  const spec = [];
  CONTENT_LINK_CHANNELS.forEach(function (ch) {
    const rule = CONTENT_LINK_RULES[ch];
    const idx = hs.indexOf(rule.url);
    if (idx < 0) return;
    const letter = columnLetter_(idx + 1);
    spec.push({
      channel: ch,
      label: rule.label,
      column: rule.url,
      columnIndex: idx + 1,
      pattern: rule.pattern,
      formula: '=OR(ISBLANK(' + letter + '2),REGEXMATCH(TO_TEXT(' + letter + '2),"' + rule.pattern + '"))',
      help: rule.label + ' 주소를 넣으세요 (예: ' + [rule.host].concat(rule.alias_hosts || []).join('/… 또는 ') + '/…). 비워 두면 아직 안 올린 채널입니다.'
    });
  });
  return spec;
}

/**
 * 4채널 주소 열에 유효성 규칙 + 조건부 서식을 건다(멱등: 같은 규칙을 다시 걸어도 결과가 같다).
 * 시트를 실제로 바꾸는 함수라 메뉴에서 사람이 누를 때만 돈다.
 */
function applyContentLinkRules_(ss) {
  const book = ss || SpreadsheetApp.getActiveSpreadsheet();
  const sheet = book.getSheetByName('Contents');
  if (!sheet) throw new Error('Contents 시트가 없습니다. 먼저 초기 설치를 실행하세요.');
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const spec = contentLinkValidationSpec_(headers);
  const lastRow = Math.max(sheet.getMaxRows(), 2);
  spec.forEach(function (s) {
    const rule = SpreadsheetApp.newDataValidation()
      .requireFormulaSatisfied(s.formula)
      .setAllowInvalid(true)
      .setHelpText(s.help)
      .build();
    sheet.getRange(2, s.columnIndex, lastRow - 1, 1).setDataValidation(rule);
  });

  /* 조건부 서식 — '일부 발행·발행 완료'인데 4채널 주소가 비어 있는 행을 노랗게 */
  const statusIdx = headers.indexOf('status') + 1;
  const urlIdx = CONTENT_LINK_CHANNELS.map(function (ch) { return headers.indexOf(CONTENT_LINK_RULES[ch].url) + 1; })
    .filter(function (n) { return n > 0; });
  if (statusIdx > 0 && urlIdx.length) {
    const st = columnLetter_(statusIdx);
    const blanks = urlIdx.map(function (n) { return columnLetter_(n) + '2=""'; }).join(',');
    const formula = '=AND(OR($' + st + '2="PUBLISHED",$' + st + '2="LINKED"),OR(' + blanks + '))';
    const rule = SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(formula)
      .setBackground('#FFF4CE')
      .setRanges([sheet.getRange(2, 1, lastRow - 1, headers.length)])
      .build();
    /* 같은 규칙은 한 번만 — 예전에 같은 모양의 규칙이 있으면 지우고 새로 건다 */
    const keep = sheet.getConditionalFormatRules().filter(function (r) {
      try { return r.getBooleanCondition().getCriteriaValues().join('') !== formula; } catch (e) { return true; }
    });
    sheet.setConditionalFormatRules(keep.concat([rule]));
  }
  return { ok: true, columns: spec.map(function (s) { return s.column; }), rows: lastRow - 1 };
}

function applyContentLinkRulesFromMenu() {
  const res = applyContentLinkRules_();
  SpreadsheetApp.getUi().alert('4채널 주소 규칙을 적용했습니다: ' + (res.columns || []).join(', ') + ' (' + res.rows + '행)\n· 빈 칸은 그대로 두고, 값이 있으면 그 채널 주소만 통과시킵니다(경고만, 입력은 막지 않음).\n· 발행 상태인데 주소가 빈 행은 노랗게 보입니다.');
}

/**
 * 4채널 주소가 모두 찬 카드만 'PUBLISHING'(일부 발행) → 'PUBLISHED'(일부 발행 완료)로 올린다.
 * 내리는 일은 하지 않는다(DRAFT·REVIEW·LINKED 는 건드리지 않는다).
 * @param {Object} ss 스프레드시트 | @param {Object} opts {dryRun:boolean}
 */
function syncPublishStatus_(ss, opts) {
  const o = opts || {};
  const book = ss || SpreadsheetApp.getActiveSpreadsheet();
  const sheet = book.getSheetByName('Contents');
  if (!sheet) return { ok: false, error: 'Contents 시트가 없습니다.' };
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const lastRow = sheet.getLastRow();
  const statusAt = headers.indexOf('status');
  if (statusAt < 0 || lastRow < 2) return { ok: true, checked: 0, changed: 0, incomplete: 0, items: [] };

  const all = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const items = [];
  let changed = 0;
  let incomplete = 0;
  for (let i = 0; i < all.length; i++) {
    const row = {};
    for (let j = 0; j < headers.length; j++) row[headers[j]] = all[i][j];
    const status = String(row.status || '');
    if (status !== 'PUBLISHING' && status !== 'PUBLISHED' && status !== 'LINKED') continue;
    const audit = channelLinkAudit_(row);
    if (!audit.complete) {
      incomplete++;
      items.push({ content_id: row.content_id, status: status, note: channelLinkAuditText_(audit) });
      continue;
    }
    if (status !== 'PUBLISHING') continue;
    changed++;
    items.push({ content_id: row.content_id, from: status, to: 'PUBLISHED' });
    if (o.dryRun !== true) all[i][statusAt] = 'PUBLISHED';
  }
  if (o.dryRun !== true && changed > 0) {
    sheet.getRange(2, 1, all.length, headers.length).setValues(all);
  }
  return { ok: true, checked: all.length, changed: changed, incomplete: incomplete, items: items };
}

function syncPublishStatusFromMenu() {
  const res = syncPublishStatus_();
  SpreadsheetApp.getUi().alert('4채널 링크 점검\n· 일부 발행 → 발행으로 올린 카드: ' + res.changed + '건\n· 기록이 모자란 카드: ' + res.incomplete + '건');
}