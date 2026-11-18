/**
 * js/daangnView.js — 당근 스토리 채널 조각
 *
 *  · 상세 시트 안의 '당근 수익화 트래커' 카드 (인정 스토리 N/5 · 유효 시청 N/2,000 · 달성 배지)
 *  · 발행 전 점검 3개 (직접 촬영·설명 30자·협찬 표기) — 이 기기 브라우저에만 저장
 *
 * 데이터: seeds/daangn_story_v1.json (수치·문구) + 성과 행(state.metrics, GAS list_metrics).
 * 원칙: 렌더링은 textContent/createElement 만. 수치를 모르면 0으로 두고 이유를 적는다(추측 금지).
 */

const SEED_URL = 'seeds/daangn_story_v1.json';
const CHECK_KEY = 'contenthub.daangn_checks.v1';

const FALLBACK = {
  channel: { key: 'daangn', label: '당근', full_label: '당근 스토리' },
  eligibility: { stories_per_month: 5, valid_views_per_month: 2000, min_duration_sec: 10,
    min_description_chars: 30, submit_within_days: 3, notify: '다음 날 오전 11시',
    submit_path: '당근폼 프로필 제출', keep_stories_per_month: 2 },
  reward: { base_per_video_krw: [100, 1000], performance: '다음 달 5일 전후 월 집계',
    performance_min_krw: 1000, payout: '당근페이 필수' },
  checks: [
    { id: 'shot', label: '직접 촬영 · 음성 포함 · 10초 이상', detail: '정지 이미지가 절반을 넘으면 제외됩니다.' },
    { id: 'desc', label: '설명 30자 이상 — AI가 쓴 문구 그대로 쓰지 않기', detail: 'AI 문구 적발 시 성과 보상 전액 미지급.' },
    { id: 'sponsor', label: '협찬이면 첫 줄에 #광고 #협찬 · 외부 링크 없음', detail: '표기 위치 위반은 보상 미지급·자격 해지.' }
  ],
  warnings: ['같은 달 같은 장소(가게) 태그는 1회만 인정']
};

let seedPromise = null;

export function loadDaangnSeed() {
  if (!seedPromise) {
    seedPromise = fetch(`${SEED_URL}?v=1`, { cache: 'no-cache' })
      .then((res) => (res.ok ? res.json() : FALLBACK))
      .then((json) => Object.assign({}, FALLBACK, json))
      .catch(() => FALLBACK);
  }
  return seedPromise;
}

/* ───────────── 이 기기에만 저장하는 점검 상태 ───────────── */

export function readChecks() {
  try { return JSON.parse(localStorage.getItem(CHECK_KEY)) || {}; } catch (e) { return {}; }
}

function writeChecks(all) {
  try { localStorage.setItem(CHECK_KEY, JSON.stringify(all)); } catch (e) { /* 용량 초과 무시 */ }
}

export function checksOf(contentId) {
  const all = readChecks();
  return all[contentId] || {};
}

/* ───────────── 성과 집계 ───────────── */

const KST_YM = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 7);

/**
 * 이번 달 당근 성과. 유효 시청·보상은 누적값이므로 스토리별 최댓값을 쓴 뒤 더한다
 * (D+1·D+7을 같이 넣어도 두 번 세지 않게).
 */
export function daangnMonth(rows, ym) {
  const month = ym || KST_YM();
  const list = (rows || []).filter((r) => r
    && String(r.channel) === 'daangn'
    && String(r.measured_at || '').slice(0, 7) === month);
  const per = new Map();
  list.forEach((r) => {
    const id = String(r.content_id || '');
    if (!id) return;
    const prev = per.get(id) || { valid: 0, reward: 0, likes: 0, at: '' };
    per.set(id, {
      valid: Math.max(prev.valid, Number(r.valid_views) || 0),
      reward: Math.max(prev.reward, Number(r.reward_krw) || 0),
      likes: Math.max(prev.likes, Number(r.likes_comments) || 0),
      at: String(r.measured_at || '') > prev.at ? String(r.measured_at || '') : prev.at
    });
  });
  let valid = 0;
  let reward = 0;
  per.forEach((v) => { valid += v.valid; reward += v.reward; });
  return { month, stories: per.size, valid, reward, per, rows: list };
}

const won = (n) => (Number(n) || 0).toLocaleString('ko-KR') + '원';

function bar(pct) {
  return { pct: Math.max(0, Math.min(100, pct)) };
}

/* ───────────── 상세 시트용 섹션 ───────────── */

/**
 * @param {{h:Function, item:Object, state:Object, seed?:Object}} ctx
 * @returns {HTMLElement|null} 메리 트랙이면 null
 */
export function renderDaangnSection(ctx) {
  const { h, item, state } = ctx;
  if (!item || item.brand === 'ppiyak_kimmary') return null;

  const seed = ctx.seed || FALLBACK;
  const el = seed.eligibility || FALLBACK.eligibility;
  const rw = seed.reward || FALLBACK.reward;
  const checks = seed.checks || FALLBACK.checks;

  const wrap = h('div', { class: 'dg' });

  /* ── 이 카드의 당근 상태 ── */
  const rawStatus = item.daangn_status || '';
  const done = ['UPLOADED', 'DONE', 'PUBLISHED', 'LINKED'].indexOf(rawStatus) >= 0;
  const head = h('div', { class: 'dg-head' },
    h('span', { class: 'dg-dot' + (done ? ' on' : '') }),
    h('span', { text: rawStatus ? (done ? '이 카드: 당근에 올림' : rawStatus === 'SKIPPED' ? '이 카드: 당근 건너뜀' : '이 카드: 당근 대기') : '이 카드: 당근 기록 없음' }));
  if (item.daangn_url) {
    head.appendChild(h('a', { href: item.daangn_url, target: '_blank', rel: 'noopener noreferrer', text: '스토리 열기' }));
  }
  wrap.appendChild(head);

  /* ── 이번 달 트래커 ── */
  const m = daangnMonth(state.metrics);
  const storyGoal = Number(el.stories_per_month) || 5;
  const viewGoal = Number(el.valid_views_per_month) || 2000;
  const storyPct = bar((m.stories / storyGoal) * 100);
  const viewPct = bar((m.valid / viewGoal) * 100);
  const achievedPct = Math.round(Math.min(storyPct.pct, viewPct.pct));
  const achieved = m.stories >= storyGoal && m.valid >= viewGoal;

  const tracker = h('section', { class: 'dg-tracker' },
    h('div', { class: 'dg-t-head' },
      h('span', { class: 'dg-t-title', text: m.month.slice(5) + '월 수익화 조건' }),
      h('span', { class: 'dg-badge' + (achieved ? ' on' : ''), text: achieved ? '조건 달성' : achievedPct + '%' })));

  const row = (label, valueText, pct, sub) => h('div', { class: 'dg-row' },
    h('div', { class: 'dg-k' }, h('span', { text: label }), h('b', { text: valueText })),
    h('div', { class: 'prog' }, h('i', { style: 'width:' + pct + '%' })),
    sub ? h('div', { class: 'dg-sub', text: sub }) : null);

  tracker.appendChild(row('인정 스토리', m.stories + ' / ' + storyGoal, storyPct.pct,
    Number(el.min_duration_sec) + '초·설명 ' + Number(el.min_description_chars) + '자를 채운 것만 인정'));
  tracker.appendChild(row('유효 시청', m.valid.toLocaleString('ko-KR') + ' / ' + viewGoal.toLocaleString('ko-KR'), viewPct.pct,
    '같은 스토리의 D+1·D+7을 같이 넣어도 두 번 세지 않아요'));
  tracker.appendChild(h('div', { class: 'dg-money' },
    h('div', null, h('span', { text: '확정 기본보상' }), h('b', { text: won(m.reward) })),
    h('div', null, h('span', { text: '영상 1건당' }), h('b', { text: (rw.base_per_video_krw || [100, 1000]).map((v) => Number(v).toLocaleString('ko-KR')).join('~') + '원' }))));

  const stateRows = h('div', { class: 'dg-note' });
  stateRows.appendChild(h('p', { text: '성과 보상: ' + (rw.performance || '다음 달 5일 전후 월 집계')
    + ' · 월 ' + won(rw.performance_min_krw || 1000) + ' 미만은 미지급 · ' + (rw.payout || '당근페이 필수') }));
  stateRows.appendChild(h('p', { text: (achieved ? '조건을 채웠어요 → ' : '조건을 채우면 ')
    + (el.notify || '다음 날 오전 11시') + ' 알림 → ' + (el.submit_within_days || 3) + '일 내 '
    + (el.submit_path || '당근폼 제출') + (achieved ? '' : ' → 배지') }));
  tracker.appendChild(stateRows);

  if (ctx.state.metricsError || !(state.metrics && state.metrics.length)) {
    tracker.appendChild(h('p', { class: 'dg-quiet', text: '성과 숫자를 아직 못 읽었어요 — 성과 탭에서 오늘 숫자를 넣으면 여기가 채워집니다. (GAS 성과 API는 재배포 후 동작)' }));
  }
  wrap.appendChild(tracker);

  /* ── 같은 달 같은 장소 경고 ── */
  const samePlace = (state.metrics || []).some((r) => r
    && String(r.channel) === 'daangn'
    && String(r.content_id) !== String(item.content_id)
    && String(r.measured_at || '').slice(0, 7) === m.month);
  if (samePlace && m.stories > 0) {
    const places = (state.contents || []).filter((c) => c.place_name && c.place_name === item.place_name
      && String(c.content_id) !== String(item.content_id) && c.daangn_status);
    if (places.length) {
      wrap.appendChild(h('p', { class: 'dg-warn', text: '이번 달 같은 장소(' + item.place_name + ') 스토리가 이미 있어요 — 같은 가게 태그는 한 달에 1회만 인정됩니다(동·구 태그는 중복 인정).' }));
    }
  }

  /* ── 발행 전 점검 3개 ── */
  const checkHost = h('div', { class: 'dg-checks' });
  const countEl = h('span', { class: 'dg-count' });
  wrap.appendChild(h('section', { class: 'dg-check-sec' },
    h('div', { class: 'dg-c-head' }, h('span', { text: '당근 올리기 전 점검' }), countEl),
    checkHost,
    h('p', { class: 'dg-quiet', text: '점검 표시는 이 기기 브라우저에만 저장됩니다.' })));

  function paintChecks() {
    const own = checksOf(item.content_id);
    clearNode(checkHost);
    let on = 0;
    checks.forEach((c) => {
      const box = h('input', { type: 'checkbox' });
      box.checked = !!own[c.id];
      if (box.checked) on += 1;
      box.addEventListener('change', () => {
        const all = readChecks();
        const cur = all[item.content_id] || {};
        cur[c.id] = box.checked;
        all[item.content_id] = cur;
        writeChecks(all);
        paintChecks();
      });
      checkHost.appendChild(h('label', { class: 'dg-check' }, box,
        h('span', null,
          h('span', { class: 'dg-c-label', text: c.label }),
          c.detail ? h('span', { class: 'dg-c-detail', text: c.detail }) : null)));
    });
    countEl.textContent = on + ' / ' + checks.length;
  }
  paintChecks();

  wrap.appendChild(h('p', { class: 'dg-quiet',
    text: '설명 틀: [동네 가게명] 대표메뉴·가격 1줄 + 직접 다녀온 팁 1줄 (30자 이상, AI 문구 금지) · 태그는 실제 방문 장소 1개 + 지역 태그 2~3개' }));

  return wrap;
}

function clearNode(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}
