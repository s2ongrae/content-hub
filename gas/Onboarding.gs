/**
 * gas/Onboarding.gs  —  콜드스타트 위저드 (빈 시트에서 바로 쓰는 상태로)
 *
 * action: run_coldstart_onboarding
 *  - Hooks / Formats / Places / Keywords 시드
 *  - Contents 에 2주 발행 캘린더 10건(DRAFT) 생성 (DY 주3회 / KM 주2회)
 *  - 이미 데이터가 있으면 건너뛴다(멱등). force:true 로만 덮어쓴다.
 */

const COLDSTART_FLAG_ = 'COLDSTART_DONE_AT';

function handleRunColdstartOnboarding_(ss, payload, ctx) {
  const force = payload.force === true;
  const props = PropertiesService.getScriptProperties();
  const already = props.getProperty(COLDSTART_FLAG_);
  if (already && !force) {
    return { skipped: true, done_at: already, note: 'force:true 로 다시 실행할 수 있습니다.' };
  }

  const created = { hooks: 0, formats: 0, places: 0, keywords: 0, contents: 0 };

  created.hooks = seedHooks_(ss);
  created.formats = seedFormats_(ss);
  created.places = seedPlaces_(ss);
  created.keywords = seedKeywords_(ss);
  created.contents = seedCalendar_(ss, ctx);

  props.setProperty(COLDSTART_FLAG_, formatKstIso_(new Date()));
  return { skipped: false, created: created };
}

/* ------------------------------------------------------------------ *
 * 시드 데이터
 * ------------------------------------------------------------------ */

function seedHooks_(ss) {
  const existing = readSheetAsObjects_(ss, 'Hooks');
  if (existing.length > 0) return 0;

  const rows = [
    ['HOOK-DY-001', 'daejeon_youth', 'SELF_DEPRECATION', '계좌는 파란불인데 위장은 붉은 고기를 원해서 달려갔습니다', 'ACTIVE', ''],
    ['HOOK-DY-002', 'daejeon_youth', 'REALTIME', '금요일 19시, 대기 16번째. 번호표 들고 30분 존버 실황', 'ACTIVE', ''],
    ['HOOK-DY-003', 'daejeon_youth', 'KILLER_SIDE', '오이무침 하나로 소주 1병 순삭, 이 집은 반찬이 본체입니다', 'ACTIVE', ''],
    ['HOOK-KM-001', 'ppiyak_kimmary', 'AUDIO_REACTION', '0.1초 청각 반응 클로즈업 — 소리 먼저, 얼굴 나중', 'ACTIVE', ''],
    ['HOOK-KM-002', 'ppiyak_kimmary', 'BEAT_CUT', '다운비트 2분할 비포/애프터 — 박자에 맞춰 컷', 'ACTIVE', ''],
    ['HOOK-KM-003', 'ppiyak_kimmary', 'REVERSE', '집사 출근 배웅하다가 문 닫히는 순간 반전 표정', 'ACTIVE', '']
  ];
  appendRows_(ss, 'Hooks', rows.map(function (r) {
    return { hook_id: r[0], brand: r[1], hook_type: r[2], hook_template: r[3], usage_count: 0,
             avg_3s_retention_pct: '', avg_outlier_score: '', status: r[4],
             source_benchmark_id: r[5], updated_at: formatKstIso_(new Date()) };
  }));
  return rows.length;
}

function seedFormats_(ss) {
  const existing = readSheetAsObjects_(ss, 'Formats');
  if (existing.length > 0) return 0;

  const now = formatKstIso_(new Date());
  const rows = [
    {
      format_id: 'FMT-DY-001', brand: 'daejeon_youth', format_name: '로컬 노포 7단계 + AEO 팩트표',
      spec_json: JSON.stringify({
        steps: ['도입부썰', 'AEO 3줄요약+표', '외관&웨이팅', '메뉴판&가격', '기본찬&킬링반찬',
                '메인먹방', '필승먹조합', '총평박스+지도'],
        chars_no_space: [1500, 2500], keyword_repeat: [5, 7], min_photos: 5, min_videos: 1
      }),
      sample_count: 0, avg_outlier_72h: '', lifecycle_status: 'ACTIVE', decision_note: '시드',
      created_at: now, updated_at: now
    },
    {
      format_id: 'FMT-KM-001', brand: 'ppiyak_kimmary', format_name: '15초 다운비트 고양이 패러디',
      spec_json: JSON.stringify({
        aspect: '9:16', max_sec: 60, hook_window_sec: 3, beat_sync: 'downbeat',
        hashtag_count: 5, single_cta: true, thumbnail_style: 'cute_pastel_high_contrast'
      }),
      sample_count: 0, avg_outlier_72h: '', lifecycle_status: 'ACTIVE', decision_note: '시드',
      created_at: now, updated_at: now
    }
  ];
  appendRows_(ss, 'Formats', rows);
  return rows.length;
}

function seedPlaces_(ss) {
  const existing = readSheetAsObjects_(ss, 'Places');
  if (existing.length > 0) return 0;

  const now = formatKstIso_(new Date());
  const rows = [
    { place_id: 'PLC-0001', brand: 'daejeon_youth', place_name: '미미삼겹', region_dong: '봉명동',
      category: '고기/구이', address: '대전 유성구 봉명동', naver_place_url: '',
      business_hours: '17:00~24:00', signature_menus: '급랭 삼겹살 14,000 / 된장찌개 5,000',
      parking_info: '전용 주차 없음 · 공영주차장', first_order_rule: '3인분부터', visit_count: 0,
      updated_at: now },
    { place_id: 'PLC-0002', brand: 'daejeon_youth', place_name: '갈마동 야장 술집(예시)', region_dong: '갈마동',
      category: '노포/술집', address: '대전 서구 갈마동', naver_place_url: '',
      business_hours: '18:00~02:00', signature_menus: '야장 안주 세트', parking_info: '골목 주차',
      first_order_rule: '안주 1 + 주류 1', visit_count: 0, updated_at: now },
    { place_id: 'PLC-0003', brand: 'daejeon_youth', place_name: '둔산동 국밥집(예시)', region_dong: '둔산동',
      category: '국밥/해장', address: '대전 서구 둔산동', naver_place_url: '',
      business_hours: '06:00~21:00', signature_menus: '순대국밥 9,000', parking_info: '건물 지하',
      first_order_rule: '없음', visit_count: 0, updated_at: now }
  ];
  appendRows_(ss, 'Places', rows);
  return rows.length;
}

function seedKeywords_(ss) {
  const existing = readSheetAsObjects_(ss, 'Keywords');
  if (existing.length > 0) return 0;

  const now = formatKstIso_(new Date());
  const samples = [
    ['봉명동 냉삼', 7200, 18000, 'S'],
    ['대전 봉명동 맛집', 12100, 42000, 'A'],
    ['유성구 고기집', 5400, 26000, 'A'],
    ['대전 가성비 술집', 3900, 31000, 'B'],
    ['고양이 쇼츠 챌린지', 2100, 9800, 'B']
  ];
  const rows = samples.map(function (s, i) {
    const vol = s[1], docs = s[2];
    const ratio = docs > 0 ? (vol / docs) : 0;          // 검색량/문서수 = 황금비
    return {
      keyword_id: 'KW-' + ('000' + (i + 1)).slice(-4),
      brand: i >= 4 ? 'ppiyak_kimmary' : 'daejeon_youth',
      keyword: s[0], cluster_id: '', monthly_search_vol: vol, total_docs: docs,
      golden_ratio: Math.round(ratio * 1000) / 1000, golden_grade: s[3],
      data_source: 'SEED', assigned_content_id: '', updated_at: now
    };
  });
  appendRows_(ss, 'Keywords', rows);
  return rows.length;
}

/** 2주 캘린더: 트랙A 월·수·금, 트랙B 화·목 → 총 10건 DRAFT */
function seedCalendar_(ss, ctx) {
  const existing = readSheetAsObjects_(ss, 'Contents');
  if (existing.length > 0) return 0;

  const rows = [];
  const baseD = new Date();
  baseD.setHours(0, 0, 0, 0);

  function dateStr(offsetDays) {
    const d = new Date(baseD.getTime() + offsetDays * 86400000);
    return Utilities.formatDate(d, 'Asia/Seoul', 'yyyyMMdd');
  }
  function isoAt(offsetDays, hour) {
    const d = new Date(baseD.getTime() + offsetDays * 86400000);
    d.setHours(hour, 0, 0, 0);
    return Utilities.formatDate(d, 'Asia/Seoul', "yyyy-MM-dd'T'HH:mm:ssXXX");
  }

  const slots = [];
  // 14일 동안: 월/수/금 = 대전청년, 화/목 = 메리
  for (let day = 1; day <= 14; day++) {
    const d = new Date(baseD.getTime() + day * 86400000);
    const dow = d.getDay();  // 0=일
    if (dow === 1 || dow === 3 || dow === 5) slots.push({ brand: 'daejeon_youth', day: day, hour: 19 });
    else if (dow === 2 || dow === 4) slots.push({ brand: 'ppiyak_kimmary', day: day, hour: 12 });
  }
  const trimmed = slots.slice(0, 10);

  const counters = { DY: 0, KM: 0 };
  trimmed.forEach(function (s, i) {
    const isKm = s.brand === 'ppiyak_kimmary';
    const prefix = isKm ? 'KM' : 'DY';
    counters[prefix] += 1;
    const id = prefix + '-' + dateStr(s.day) + '-' + ('00' + counters[prefix]).slice(-3);
    rows.push({
      content_id: id,
      brand: s.brand,
      version: 1,
      status: 'DRAFT',
      cluster_id: isKm ? 'CLUSTER_MERRY_DAILY' : 'CLUSTER_BONGMYEONG_MEAT',
      region_dong: isKm ? '' : '봉명동',
      category: isKm ? '고양이일상' : '고기/구이',
      place_id: '',
      place_name: isKm ? '캘린더 슬롯 (주제 미정)' : '캘린더 슬롯 (가게 미정)',
      naver_place_url: '',
      target_keywords: '',
      blog_title: '',
      quality_score: '',
      receipt_verified: false,
      media_drive_url: '',
      payload_file_id: '',
      blog_status: isKm ? 'SKIPPED' : 'PENDING',
      blog_url: '',
      shorts_status: 'PENDING',
      shorts_url: '',
      reels_status: 'PENDING',
      reels_url: '',
      clip_status: 'PENDING',   // 2026-11-16 사용자 확정 — 메리 트랙도 클립 포함(블로그만 SKIPPED)
      clip_url: '',
      allow_partial_shortform: false,
      growth_tag: 'NONE',
      created_at: isoAt(s.day, s.hour),
      updated_at: isoAt(s.day, s.hour),
      updated_by: 'onboarding-wizard'
    });
  });

  appendRows_(ss, 'Contents', rows);
  return rows.length;
}

/* ------------------------------------------------------------------ *
 * 시트 일괄 추가 (헤더 매핑)
 * ------------------------------------------------------------------ */

function appendRows_(ss, sheetName, objs) {
  if (!objs || !objs.length) return 0;
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw createAppError_('ERR_SERVER_CONFIG', '시트가 없습니다: ' + sheetName);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const values = objs.map(function (o) {
    return headers.map(function (h) { return o[h] === undefined ? '' : o[h]; });
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, values.length, headers.length).setValues(values);
  return values.length;
}
