/**
 * frontend/js/mock.js — 데모(Mock) 백엔드
 *
 * GAS에 연결하기 전에 화면·기능을 그대로 체험할 수 있게, M1 액션 12종을 브라우저 안에서 흉내 낸다.
 *  · 저장 위치: localStorage 'contenthub.mock.v1' (이 브라우저에만)
 *  · 응답 봉투는 실제 GAS(Code.gs)와 같은 모양으로 돌려준다 → app.js는 실서버/데모를 구분하지 않는다.
 *  · 여기서 만든 데이터는 실제 시트와 무관하다. 데모를 끄면 즉시 사라진다.
 */

const MOCK_KEY = 'contenthub.mock.v1';
const NOW = () => new Date().toISOString().replace('Z', '+09:00');

function stamp(offsetMin = 0) {
  const d = new Date(Date.now() - offsetMin * 60000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00+09:00`;
}

function seedContents() {
  const rows = [
    {
      content_id: 'DY-20261115-001', brand: 'daejeon_youth', version: 3, status: 'REVIEW',
      cluster_id: '유성 삼겹살', region_dong: '봉명동', category: '한식·고기',
      place_id: 'PL-DY-004', place_name: '미미삼겹 유성점',
      naver_place_url: 'https://map.naver.com/p/entry/place/0000000000',
      target_keywords: '미미삼겹 유성, 봉명동 삼겹살, 유성 회식', blog_title: '봉명동 미미삼겹 솔직 후기 — 3시에 가도 웨이팅인 이유',
      quality_score: 86, receipt_verified: true, media_drive_url: '',
      blog_status: 'PENDING', blog_url: '', shorts_status: 'PENDING', shorts_url: '',
      reels_status: 'PENDING', reels_url: '', clip_status: 'PENDING', clip_url: '',
      allow_partial_shortform: false, growth_tag: 'SEARCH',
      created_at: stamp(1500), updated_at: stamp(42), updated_by: 'user',
      preview: {
        hook: '3시인데 웨이팅 4팀. 봉명동에서 이 집이 유일하게 그런 집이다.',
        facts: ['대기 22분 · 회전 9분/팀', '삼겹 1인 16,000원 · 목살 15,000원', '주차 3대(골목 공영 5분)'],
        weak: '기본찬 가지수가 적어 2인 방문엔 살짝 아쉬움'
      }
    },
    {
      content_id: 'DY-20261115-002', brand: 'daejeon_youth', version: 2, status: 'REVIEW',
      cluster_id: '유성 국밥', region_dong: '궁동', category: '한식·국밥',
      place_id: 'PL-DY-007', place_name: '궁동 순대국 24시',
      naver_place_url: '', target_keywords: '궁동 순대국, 유성 해장',
      blog_title: '새벽 4시 궁동 해장 — 순대국 24시 한 그릇',
      quality_score: 82, receipt_verified: true, media_drive_url: '',
      blog_status: 'PENDING', blog_url: '', shorts_status: 'PENDING', shorts_url: '',
      reels_status: 'SKIPPED', reels_url: '', clip_status: 'PENDING', clip_url: '',
      allow_partial_shortform: true, growth_tag: 'NONE',
      created_at: stamp(1600), updated_at: stamp(96), updated_by: 'pickle-agent-01',
      preview: {
        hook: '해장이 필요한 새벽 4시, 궁동에서 불 켜진 집은 여기뿐이었다.',
        facts: ['순대국 9,000원 · 24시간', '주차 골목 2대', '새벽엔 셀프 바뀜'],
        weak: '새벽엔 리필이 셀프라 처음 가면 헤맴'
      }
    },
    {
      content_id: 'DY-20261114-004', brand: 'daejeon_youth', version: 5, status: 'READY',
      cluster_id: '대전 노포', region_dong: '중구 은행동', category: '분식',
      place_id: 'PL-DY-002', place_name: '은행동 옛날 통닭',
      naver_place_url: '', target_keywords: '은행동 통닭, 대전 노포',
      blog_title: '은행동 40년 통닭집 — 튀김옷이 얇은 이유를 물었다',
      quality_score: 91, receipt_verified: true, media_drive_url: '',
      blog_status: 'PENDING', blog_url: '', shorts_status: 'UPLOADED', shorts_url: 'https://youtube.com/shorts/demo1',
      reels_status: 'UPLOADED', reels_url: 'https://instagram.com/reel/demo1', clip_status: 'UPLOADED', clip_url: '',
      allow_partial_shortform: false, growth_tag: 'SEARCH',
      created_at: stamp(2400), updated_at: stamp(230), updated_by: 'user',
      preview: {
        hook: '40년 동안 같은 기름을 쓴다는 말, 진짜인지 물어봤다.',
        facts: ['통닭 9,000원 · 감자튀김 서비스', '대기 10분 내외', '현금 5% 할인'],
        weak: '좌석 12석, 4인 이상은 힘들다'
      }
    },
    {
      content_id: 'DY-20261114-003', brand: 'daejeon_youth', version: 1, status: 'DRAFT',
      cluster_id: '유성 혼술', region_dong: '장대동', category: '주점',
      place_id: 'PL-DY-011', place_name: '장대동 혼술 하이볼바',
      naver_place_url: '', target_keywords: '유성 혼술, 장대동 하이볼',
      blog_title: '', quality_score: '', receipt_verified: false, media_drive_url: '',
      blog_status: 'PENDING', blog_url: '', shorts_status: 'PENDING', shorts_url: '',
      reels_status: 'PENDING', reels_url: '', clip_status: 'PENDING', clip_url: '',
      allow_partial_shortform: false, growth_tag: 'NONE',
      created_at: stamp(2800), updated_at: stamp(2600), updated_by: 'user'
    },
    {
      content_id: 'DY-20261113-002', brand: 'daejeon_youth', version: 7, status: 'PUBLISHED',
      cluster_id: '대전 축제', region_dong: '서구 둔산동', category: '축제·행사',
      place_id: 'PL-DY-001', place_name: '둔산동 야시장',
      naver_place_url: '', target_keywords: '대전 야시장, 둔산동 축제',
      blog_title: '둔산동 야시장 3일 다녀온 기록 — 줄 안 서는 동선',
      quality_score: 88, receipt_verified: false, media_drive_url: '',
      blog_status: 'PUBLISHED', blog_url: 'https://blog.naver.com/youth-daejeon/demo',
      shorts_status: 'UPLOADED', shorts_url: 'https://youtube.com/shorts/demo2',
      reels_status: 'UPLOADED', reels_url: '', clip_status: 'PENDING', clip_url: '',
      allow_partial_shortform: true, growth_tag: 'VIRAL',
      created_at: stamp(4300), updated_at: stamp(700), updated_by: 'pickle-agent-01'
    },
    {
      content_id: 'DY-20261112-001', brand: 'daejeon_youth', version: 4, status: 'NEEDS_HUMAN',
      cluster_id: '대전 카페', region_dong: '유성구 어은동', category: '카페',
      place_id: 'PL-DY-013', place_name: '어은동 루프탑 카페',
      naver_place_url: '', target_keywords: '어은동 카페, 유성 루프탑',
      blog_title: '어은동 루프탑 카페 — 노을 시간대만 노리는 법',
      quality_score: 79, receipt_verified: true, media_drive_url: '',
      blog_status: 'PENDING', blog_url: '', shorts_status: 'PENDING', shorts_url: '',
      reels_status: 'PENDING', reels_url: '', clip_status: 'PENDING', clip_url: '',
      allow_partial_shortform: false, growth_tag: 'NONE',
      created_at: stamp(5000), updated_at: stamp(900), updated_by: 'system',
      human_reason: '네이버 로그인 2차 인증(2FA) 요구 — 사람이 직접 처리해야 합니다.'
    },
    {
      content_id: 'KM-20261115-001', brand: 'ppiyak_kimmary', version: 3, status: 'REVIEW',
      cluster_id: '메리 일상', region_dong: '상대동', category: '고양이 일상',
      place_id: '', place_name: '화장실 물 마시는 메리',
      naver_place_url: '', target_keywords: '고양이 물 마시기, 브숏',
      blog_title: '', quality_score: 90, receipt_verified: false, media_drive_url: '',
      blog_status: 'SKIPPED', blog_url: '', shorts_status: 'PENDING', shorts_url: '',
      reels_status: 'PENDING', reels_url: '', clip_status: 'SKIPPED', clip_url: '',
      allow_partial_shortform: false, growth_tag: 'VIRAL',
      created_at: stamp(400), updated_at: stamp(25), updated_by: 'user',
      preview: {
        hook: '물그릇은 쳐다도 안 보더니 화장실 세면대만 노린다.',
        facts: ['3초 훅: 세면대 앞 대기', '다운비트 4번째 컷에 점프', 'CTA 1개: 팔로우'],
        weak: '마지막 0.5초 잘림 — 재렌더 필요'
      }
    },
    {
      content_id: 'KM-20261115-002', brand: 'ppiyak_kimmary', version: 2, status: 'READY',
      cluster_id: '메리 챌린지', region_dong: '상대동', category: '챌린지',
      place_id: '', place_name: 'L-O-V-E 챌린지 6탄 후보',
      naver_place_url: '', target_keywords: '고양이 챌린지, 브숏',
      blog_title: '', quality_score: 87, receipt_verified: false, media_drive_url: '',
      blog_status: 'SKIPPED', blog_url: '', shorts_status: 'PENDING', shorts_url: '',
      reels_status: 'PENDING', reels_url: '', clip_status: 'SKIPPED', clip_url: '',
      allow_partial_shortform: false, growth_tag: 'NONE',
      created_at: stamp(1200), updated_at: stamp(180), updated_by: 'pickle-agent-01',
      preview: {
        hook: '5탄 반응이 좋아서 6탄은 후렴부터 간다.',
        facts: ['비트: 0:12부터', '컷 18개 / 20초', '자막은 마지막 1줄만'],
        weak: '5탄 BGM과 너무 비슷해질 위험'
      }
    },
    {
      content_id: 'KM-20261113-001', brand: 'ppiyak_kimmary', version: 4, status: 'LINKED',
      cluster_id: '메리 일상', region_dong: '상대동', category: '고양이 일상',
      place_id: '', place_name: '택배 상자 개봉기',
      naver_place_url: '', target_keywords: '고양이 택배상자',
      blog_title: '', quality_score: 93, receipt_verified: false, media_drive_url: '',
      blog_status: 'SKIPPED', blog_url: '',
      shorts_status: 'UPLOADED', shorts_url: 'https://youtube.com/shorts/demo3',
      reels_status: 'UPLOADED', reels_url: 'https://instagram.com/reel/demo3',
      clip_status: 'SKIPPED', clip_url: '',
      allow_partial_shortform: false, growth_tag: 'VIRAL',
      created_at: stamp(3600), updated_at: stamp(1500), updated_by: 'user'
    },
    {
      content_id: 'KM-20261114-002', brand: 'ppiyak_kimmary', version: 1, status: 'DRAFT',
      cluster_id: '메리 일상', region_dong: '상대동', category: '고양이 일상',
      place_id: '', place_name: '창밖 새 구경하는 메리',
      naver_place_url: '', target_keywords: '고양이 창밖',
      blog_title: '', quality_score: '', receipt_verified: false, media_drive_url: '',
      blog_status: 'SKIPPED', blog_url: '', shorts_status: 'PENDING', shorts_url: '',
      reels_status: 'PENDING', reels_url: '', clip_status: 'SKIPPED', clip_url: '',
      allow_partial_shortform: false, growth_tag: 'NONE',
      created_at: stamp(2000), updated_at: stamp(1990), updated_by: 'user'
    }
  ];
  return rows;
}

function seedState() {
  return {
    contents: seedContents(),
    checklists: [],
    backups: [
      { tier: 'DAILY', at: stamp(13 * 60), snapshot: 'SNAPSHOT_DAILY_20261115_0300', copied: 10 },
      { tier: 'WEEKLY', at: stamp(13 * 60 + 30), snapshot: 'SNAPSHOT_WEEKLY_20261115_0330', copied: 10 }
    ],
    integrity: { last_run: stamp(13 * 60 + 5), issues: 1 },
    tokens: { rotated_at: null },
    ops: []
  };
}

function readState() {
  try {
    const raw = localStorage.getItem(MOCK_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && Array.isArray(s.contents)) return s;
    }
  } catch (e) { /* 손상 시 새로 시작 */ }
  const fresh = seedState();
  writeState(fresh);
  return fresh;
}

function writeState(s) {
  try { localStorage.setItem(MOCK_KEY, JSON.stringify(s)); } catch (e) { /* 용량 초과는 무시 */ }
}

export function resetMockData() {
  try { localStorage.removeItem(MOCK_KEY); } catch (e) { /* noop */ }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(code, message, details) {
  const err = new Error(message || code);
  err.code = code;
  err.details = details || {};
  return err;
}

function nextId(state, brand) {
  const prefix = brand === 'ppiyak_kimmary' ? 'KM' : 'DY';
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const n = state.contents.filter((c) => c.content_id.indexOf(prefix + '-' + today) === 0).length + 1;
  return `${prefix}-${today}-${String(n).padStart(3, '0')}`;
}

export class MockBackend {
  /** action 별 응답 data 를 만든다. 규약은 GAS Code.gs 와 동일. */
  async handle(action, payload) {
    await wait(180 + Math.random() * 320);
    const state = readState();
    const p = payload || {};

    switch (action) {
      case 'health':
        return {
          sheets_total: 23, sheets_expected: 23, sheets_missing: [],
          drive_folders_ready: true, brands: ['daejeon_youth', 'ppiyak_kimmary'],
          token_set: true, backup: backupStatus(state), quota_degraded: false, daily_calls: 12
        };

      case 'list_contents': {
        const limit = Math.min(Number(p.limit || 50), 200);
        const page = Math.max(Number(p.page || 1), 1);
        let rows = state.contents.slice();
        if (p.brand && p.brand !== 'ALL') rows = rows.filter((r) => r.brand === p.brand);
        if (p.status) rows = rows.filter((r) => r.status === p.status);
        if (p.q) {
          const q = String(p.q).toLowerCase();
          rows = rows.filter((r) => (r.place_name + ' ' + (r.blog_title || '') + ' ' + (r.target_keywords || '')).toLowerCase().indexOf(q) >= 0);
        }
        rows.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
        const start = (page - 1) * limit;
        return {
          total: rows.length, page, limit, has_more: start + limit < rows.length,
          items: rows.slice(start, start + limit)
        };
      }

      case 'get_content_detail': {
        const row = find(state, p.content_id);
        return {
          content_id: row.content_id, brand: row.brand, version: row.version,
          status: row.status, meta: row, payload: row.preview || null,
          internal_links: state.contents
            .filter((r) => r.cluster_id === row.cluster_id && r.content_id !== row.content_id && (r.status === 'PUBLISHED' || r.status === 'LINKED'))
            .map((r) => ({ content_id: r.content_id, title: r.blog_title || r.place_name, blog_url: r.blog_url })),
          active_rules: [{ rule_id: row.brand === 'ppiyak_kimmary' ? 'RULE-KM-001' : 'RULE-DY-001', version_tag: 'v1.0', status: 'ACTIVE' }]
        };
      }

      case 'create_content': {
        if (!p.place_name) throw fail('ERR_VALIDATION_FAILED', 'place_name 은 필수입니다.');
        const brand = p.brand || 'daejeon_youth';
        const id = nextId(state, brand);
        const isKm = brand === 'ppiyak_kimmary';
        const row = {
          content_id: id, brand, version: 1, status: 'DRAFT',
          cluster_id: p.cluster_id || '', region_dong: p.region_dong || '', category: p.category || '',
          place_id: p.place_id || '', place_name: p.place_name, naver_place_url: p.naver_place_url || '',
          target_keywords: p.target_keywords || '', blog_title: '', quality_score: '',
          receipt_verified: p.receipt_verified === true, media_drive_url: p.media_drive_url || '',
          blog_status: isKm ? 'SKIPPED' : 'PENDING', blog_url: '',
          shorts_status: 'PENDING', shorts_url: '', reels_status: 'PENDING', reels_url: '',
          clip_status: isKm ? 'SKIPPED' : 'PENDING', clip_url: '',
          allow_partial_shortform: p.allow_partial_shortform === true,
          growth_tag: 'NONE', created_at: NOW(), updated_at: NOW(), updated_by: 'web-admin'
        };
        state.contents.push(row);
        writeState(state);
        return {
          content_id: id, brand, version: 1, status: 'DRAFT',
          payload_file_id: 'MOCK_PAYLOAD_' + id,
          pipeline_mode: isKm ? 'ONE_STAGE_SHORTFORM' : 'TWO_STAGE_CIRCULAR'
        };
      }

      case 'update_content': {
        const row = find(state, p.content_id);
        if (p.expected_version != null && Number(p.expected_version) !== Number(row.version)) {
          throw fail('ERR_VERSION_CONFLICT', '다른 곳에서 먼저 수정되었습니다.', { expected: Number(p.expected_version), current: Number(row.version) });
        }
        if (p.status === 'READY') {
          const okRun = state.checklists.some((c) => c.content_id === row.content_id
            && String(c.target_channel) === String(p.target_channel || 'naver_blog')
            && c.human_reviewed === true && Number(c.total_score) >= 80);
          if (!okRun) {
            throw fail('ERR_TOS_REVIEW_REQUIRED', '발행 전 체크리스트를 먼저 통과해야 합니다.',
              { content_id: row.content_id, channel: p.target_channel || 'naver_blog' });
          }
        }
        const editable = ['status', 'blog_title', 'quality_score', 'target_keywords', 'cluster_id',
          'region_dong', 'category', 'place_name', 'naver_place_url', 'media_drive_url',
          'blog_status', 'blog_url', 'shorts_status', 'shorts_url', 'reels_status', 'reels_url',
          'clip_status', 'clip_url', 'allow_partial_shortform', 'growth_tag', 'receipt_verified'];
        editable.forEach((k) => { if (p[k] !== undefined) row[k] = p[k]; });
        if (p.patch && typeof p.patch === 'object') Object.assign(row, p.patch);
        row.version = Number(row.version) + 1;
        row.updated_at = NOW();
        row.updated_by = 'web-admin';
        writeState(state);
        return { content_id: row.content_id, version: row.version, status: row.status, payload_file_id: 'MOCK_PAYLOAD_' + row.content_id };
      }

      case 'record_checklist': {
        const row = find(state, p.content_id);
        const score = Number(p.total_score != null ? p.total_score : 88);
        const run = {
          run_id: 'CHK-' + Date.now(), brand: row.brand, content_id: row.content_id,
          target_channel: p.target_channel || 'naver_blog', total_score: score,
          passed: score >= 80, human_reviewed: p.human_reviewed !== false,
          reviewer: p.reviewer || 'web-admin', checked_at: NOW()
        };
        state.checklists.push(run);
        writeState(state);
        return { run_id: run.run_id, content_id: run.content_id, total_score: score, passed: run.passed };
      }

      case 'get_system_health': {
        const needsHuman = state.contents.filter((r) => r.status === 'NEEDS_HUMAN');
        return {
          backup: backupStatus(state), quota_degraded: false, quota_last_error: null,
          daily_calls: 12, auth_fail_count: 0,
          needs_human: { count: needsHuman.length, items: needsHuman.map((r) => ({ content_id: r.content_id, place_name: r.place_name, updated_at: r.updated_at })) },
          partial_fail_count: state.contents.filter((r) => r.status === 'PARTIAL_FAIL').length,
          pending_ops: 0,
          open_integrity_issues: { count: state.integrity.issues, by_type: { PUBLIC_SHARING_EXPOSED: 0, BROKEN_FILE_ID: 1 } },
          sheets_total: 23,
          alert_channels: { slack: false, email: 'demo@example.com', throttle_mode: false }
        };
      }

      case 'backup_now': {
        const tier = String(p.tier || 'MANUAL').toUpperCase();
        const snap = `SNAPSHOT_${tier}_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}_${Date.now() % 100000}`;
        state.backups.unshift({ tier, at: NOW(), snapshot: snap, copied: state.contents.length });
        state.backups = state.backups.slice(0, 8);
        writeState(state);
        return { ok: true, partial: false, copied: state.contents.length, snapshot: snap };
      }

      case 'integrity_check': {
        state.integrity = { last_run: NOW(), issues: 1 };
        writeState(state);
        return {
          total_issues: 1, critical: 0, warn: 1,
          issues: [{ severity: 'WARN', issue_type: 'SCHEMA_MISMATCH', ref: 'Benchmarks', detail: 'M1 데모: 샘플 이슈 1건' }]
        };
      }

      case 'restore_from_snapshot': {
        const date = String(p.snapshot_date || '').replace(/[^0-9]/g, '');
        if (!/^\d{8}$/.test(date)) throw fail('ERR_VALIDATION_FAILED', 'snapshot_date 는 YYYYMMDD 형식이어야 합니다.');
        if (String(p.confirm_phrase || '') !== 'RESTORE_' + date) {
          throw fail('ERR_VALIDATION_FAILED', '확인 문구가 일치하지 않습니다. confirm_phrase 에 RESTORE_' + date + ' 를 넣어 다시 호출하세요.');
        }
        return { ok: true, restored_sheet: 'RESTORED_' + date + '_MOCK', payloads_remapped: state.contents.length, safety_snapshot: 'SNAPSHOT_MANUAL_PRE_RESTORE' };
      }

      case 'rotate_token':
        return { new_token: 'DEMO-' + Math.random().toString(36).slice(2, 10).toUpperCase(), note: '데모 모드에서는 실제 토큰이 바뀌지 않습니다.' };

      case 'run_coldstart_onboarding': {
        if (state.contents.length && !p.force) {
          return { skipped: true, reason: '이미 콘텐츠가 있습니다 (멱등)', created: 0 };
        }
        return { skipped: false, created: 10, hooks: 6, formats: 2, places: 3, keywords: 5, message: '데모: 2주 캘린더 10건을 만들었습니다.' };
      }

      default:
        throw fail('ERR_NOT_IMPLEMENTED', '데모 모드에서 지원하지 않는 액션입니다: ' + action);
    }
  }
}

function find(state, contentId) {
  const id = String(contentId || '').trim();
  const row = state.contents.filter((r) => String(r.content_id) === id)[0];
  if (!row) throw fail('ERR_NOT_FOUND', '콘텐츠를 찾지 못했습니다: ' + id);
  return row;
}

function backupStatus(state) {
  const last = state.backups[0];
  const lastAt = last ? last.at : null;
  let staleDays = null;
  if (lastAt) staleDays = Math.floor((Date.now() - new Date(lastAt).getTime()) / 86400000);
  return {
    last_backup_at: lastAt,
    last_backup_tier: last ? last.tier : null,
    backup_stale_days: staleDays,
    backup_stale: staleDays === null || staleDays >= 2,
    last_failure_at: null,
    last_failure_msg: null,
    pending_backup: false
  };
}
