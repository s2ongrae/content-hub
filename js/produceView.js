/**
 * js/produceView.js — 카드 상세 '제작' 탭 (제작 스텝퍼, 2026-11-19)
 *
 * 카드 하나를 ①재료 → ②기획 → ③컷 목록 → ④클린 마스터 → ⑤자막 파일 → ⑥검수·마무리 순서로 따라간다.
 *  · 표준은 docs/CONTENT_STANDARD_v3.md — AI 는 클린 마스터(컷·9:16·음량)와 SRT 까지, 자막 번인·TTS·BGM·커버는 사람이 캡컷에서.
 *  · ④ 는 노트북에 영상 렌더 오더(hub_order · content_render)를 보낸다. 승인(15분) 뒤에만 실행된다.
 *    보낸 뒤에는 hub_order_status(읽기 전용)로 15초마다 진행 상태를 가져와 보여 준다(종료 상태·화면 이탈·탭 숨김이면 멈춤).
 *  · ⑤ 자막 파일(Whisper)은 아직 없다 — '준비 중'으로만 표시하고 누를 수 있는 버튼은 만들지 않는다.
 *  · 영상이 노트북 inbox 로 들어오는 방법은 아직 정해지지 않았다 → 이 화면은 파일을 올리지 않는다(안내만).
 *
 * 저장: Drive payload 의 최상위 키 `studio` 한 개. update_content 의 patch 로 저장한다(작성본 탭과 같은 경로,
 *   Contents 37칸·GAS 변경 없음). 저장이 실패하면 그 기기 localStorage 에 남겨 두고 다음에 다시 저장한다.
 * 렌더링은 createElement/textContent 만.
 */

import { api } from './api.js';
import { openSeriesTab } from './seriesView.js';
import {
  STEPS, PROFILES, MAX_INPUTS, finishOf, reviewSteps, normalizeState, parseInputs, buildRenderPayload,
  parseReport, compareStandard, stepStatus, orderStatusLabel,
  isTerminalStatus, isNotDeployedCode, describeOrder, POLL_INTERVAL_MS, POLL_MAX_FAILS
} from './produceLogic.js?v=20261119y';

const LS_PREFIX = 'contenthub.produce.v1.';
const SAVE_DELAY_MS = 600;

function lsGet(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } }
function lsSet(key, val) { try { window.localStorage.setItem(key, val); } catch (e) { /* 저장소가 막혀도 화면은 산다 */ } }
function lsDel(key) { try { window.localStorage.removeItem(key); } catch (e) { /* 위와 같다 */ } }

export function produceSection(ctx) {
  const { h, detail, meta, toast, onNavigate } = ctx;
  const contentId = detail.content_id || meta.content_id;
  const brand = meta.brand || ctx.brand;

  /* ── 상태: 서버(payload.studio) 기준, 그 기기에 못 올린 변경이 남아 있으면 그것을 먼저 ── */
  const lsKey = LS_PREFIX + contentId;
  let state = normalizeState(detail.payload && detail.payload.studio);
  let unsaved = false;
  try {
    const raw = lsGet(lsKey);
    if (raw) { state = normalizeState(JSON.parse(raw)); unsaved = true; }
  } catch (e) { lsDel(lsKey); }

  let version = detail.version;
  let openStep = null;
  let saveTimer = null;

  /* ── 오더 진행 상태 폴링 (④) ── */
  const poll = { timer: null, fails: 0, live: null, halted: '', busy: false, vis: false };
  let statusHost = null;
  let chain = Promise.resolve();
  const saveLine = h('span', { class: 'pr-save', 'aria-live': 'polite', text: '' });

  const wrap = h('div', { class: 'produce' });
  const head = h('div', { class: 'pr-head' });
  const list = h('div', { class: 'pr-list' });
  wrap.appendChild(head);
  wrap.appendChild(list);

  /* ── 저장 ── */
  function setSaveLine(text, kind) {
    saveLine.textContent = text;
    saveLine.className = 'pr-save' + (kind ? ' ' + kind : '');
  }

  async function pushToServer() {
    const body = () => ({ content_id: contentId, expected_version: version, patch: { studio: state } });
    let res;
    try {
      res = await api.updateContent(body());
    } catch (err) {
      if (err && err.code === 'ERR_VERSION_CONFLICT') {
        /* 다른 곳에서 카드가 바뀌었다 — studio 키만 보내는 저장이라 최신 버전으로 한 번 더 시도해도 남의 변경을 덮지 않는다 */
        const cur = await api.getContentDetail(contentId);
        version = (cur.data && cur.data.version) || version;
        res = await api.updateContent(body());
      } else {
        throw err;
      }
    }
    const d = (res && res.data) || {};
    if (d.version) { version = d.version; detail.version = d.version; }
  }

  function scheduleSave() {
    unsaved = true;
    lsSet(lsKey, JSON.stringify(state));
    setSaveLine('저장 대기…', '');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      chain = chain.then(async () => {
        setSaveLine('저장 중…', '');
        try {
          await pushToServer();
          unsaved = false;
          lsDel(lsKey);
          setSaveLine('저장됨', 'ok');
        } catch (err) {
          setSaveLine('서버 저장 실패 — 이 기기에 보관 중', 'err');
          toast('제작 진행 상태를 서버에 저장하지 못했어요. 이 기기에는 남아 있어요', 'err');
        }
      });
    }, SAVE_DELAY_MS);
  }

  function change(mutator) {
    mutator(state);
    scheduleSave();
    paintHead();
    paintStates();   // 목록을 다시 그리지 않는다 — 입력 중인 칸의 커서를 지키려고 라벨만 갱신
  }

  /* 서버에 못 올린 변경이 남은 채 열렸다면 바로 다시 올려 본다 */
  if (unsaved) scheduleSave();

  /* ── 머리: 진행 ── */
  function paintHead() {
    const st = stepStatus(state, brand);
    const doable = STEPS.filter((s) => !s.soon);
    const done = doable.filter((s) => st[s.key]).length;
    head.replaceChildren(
      h('div', { class: 'pr-prog' },
        h('strong', { text: doable.length + '단계 중 ' + done + '단계 완료' }),
        h('span', { class: 'pr-sub', text: '자막 파일(SRT)은 준비 중이라 세지 않아요' })),
      h('div', { class: 'pr-bar', role: 'img', 'aria-label': done + ' / ' + doable.length },
        h('div', { class: 'pr-bar-in', style: 'width:' + Math.round((done / doable.length) * 100) + '%' })),
      saveLine);
  }

  /* 단계 라벨(완료/진행 전)만 제자리에서 갱신 */
  function paintStates() {
    const st = stepStatus(state, brand);
    list.querySelectorAll('.pr-state[data-key]').forEach((el) => {
      const k = el.getAttribute('data-key');
      const soon = STEPS.find((x) => x.key === k).soon;
      el.textContent = soon ? '준비 중' : (st[k] ? '완료' : '진행 전');
      el.className = 'pr-state' + (st[k] ? ' done' : '');
    });
  }

  /* ── 단계 목록 ── */
  function paintList() {
    const st = stepStatus(state, brand);
    list.replaceChildren();
    STEPS.forEach((s) => {
      const isOpen = openStep === s.key;
      const stateText = s.soon ? '준비 중' : (st[s.key] ? '완료' : '진행 전');
      const btn = h('button', {
        type: 'button', class: 'pr-step-btn', 'aria-expanded': isOpen ? 'true' : 'false',
        onclick: () => { openStep = isOpen ? null : s.key; paintList(); }
      },
      h('span', { class: 'pr-no', text: String(s.no) }),
      h('span', { class: 'pr-title', text: s.title }),
      h('span', { class: 'pr-state' + (st[s.key] ? ' done' : ''), 'data-key': s.key, text: stateText }));
      const card = h('div', { class: 'pr-step' + (isOpen ? ' open' : '') }, btn);
      if (isOpen) {
        const body = h('div', { class: 'pr-body' });
        BODIES[s.key](body);
        card.appendChild(body);
      }
      list.appendChild(card);
    });
  }

  /* ── 오더 진행 상태 폴링 ── */
  function stopPoll() { if (poll.timer) { clearTimeout(poll.timer); poll.timer = null; } }
  function schedulePoll(ms) { stopPoll(); poll.timer = setTimeout(runPoll, ms); }
  /** ④ 가 펼쳐져 있고 이 화면이 아직 붙어 있고 보낸 오더가 있을 때만 의미가 있다. */
  function pollAlive() {
    if (!wrap.isConnected || openStep !== 'render' || !(state.render && state.render.order_id)) return false;
    const dlg = wrap.closest('dialog');                // 상세 시트를 닫으면 DOM 은 남아 있어도 '화면을 떠난 것'으로 본다
    return !(dlg && !dlg.open);
  }
  function currentStatus() { return (poll.live && poll.live.status) || (state.render && state.render.status) || ''; }

  async function fetchOrderStatus(id) {
    if (typeof api.hubOrderStatus === 'function') return api.hubOrderStatus(id);
    const res = await api.post('hub_order_status', { order_id: id });   // api.js 가 아직 옛 캐시일 때를 위한 대비
    return (res && res.data) || {};
  }

  function onVisible() {
    if (!wrap.isConnected) { document.removeEventListener('visibilitychange', onVisible); poll.vis = false; stopPoll(); return; }
    if (!document.hidden && pollAlive() && !poll.timer && !poll.busy && !poll.halted && !isTerminalStatus(currentStatus())) runPoll();
  }

  function paintOrderStatus() {
    if (!statusHost) return;
    const r = state.render || {};
    const live = poll.live || { status: r.status, approval_expires_at: r.approval_expires_at, created_at: r.sent_at, started_at: '', result: '', error: '' };
    const d = describeOrder(live, Date.now());
    const rows = [h('div', { class: 'pr-banner' + (d.kind === 'warn' || d.kind === 'err' ? ' ' + d.kind : '') },
      h('strong', { text: d.title + ' ' }), h('span', { text: d.text }))];
    if (String(live.status).toUpperCase() === 'DONE') {
      rows.push(h('p', { class: 'hint', text: '큐가 돌려주는 결과는 짧게 잘려 있어서 규격 대조 표를 만들 수 없어요. 포털 오더함의 결과(report)를 아래에 붙여 넣어 주세요.' }));
    }
    if (poll.halted) rows.push(h('p', { class: 'hint', text: poll.halted }));
    if (!isTerminalStatus(live.status) || poll.halted) {
      rows.push(h('div', { class: 'pr-row' }, h('button', {
        class: 'btn sm', type: 'button', text: poll.halted ? '다시 확인' : '지금 확인',
        onclick: () => { poll.fails = 0; poll.halted = ''; runPoll(); }
      })));
    }
    statusHost.replaceChildren(...rows);
  }

  async function runPoll() {
    stopPoll();
    if (poll.busy || !pollAlive()) return;
    if (document.hidden) return;                       // 숨겨진 탭은 쉰다 — 다시 보이면 onVisible 이 이어서 한다
    poll.busy = true;
    const orderId = state.render.order_id;
    try {
      const d = await fetchOrderStatus(orderId);
      if (!pollAlive() || state.render.order_id !== orderId) return;   // 기다리는 동안 화면을 떠났거나 다른 오더로 바뀜
      poll.fails = 0; poll.halted = ''; poll.live = d;
      if (d.status && d.status !== state.render.status) change((s) => { s.render.status = d.status; });
      paintOrderStatus();
      if (!isTerminalStatus(d.status)) schedulePoll(POLL_INTERVAL_MS);
    } catch (err) {
      const code = err && err.code;
      if (isNotDeployedCode(code)) {
        poll.halted = '서버(GAS)를 새 버전으로 재배포하면 이 상태 표시가 켜져요. 그때까지는 포털 오더함에서 진행을 확인해 주세요.';
      } else if (code === 'ERR_NOT_FOUND') {
        poll.halted = '최근 오더 20건 안에서 이 오더를 찾지 못했어요(목록에서 밀려났을 수 있어요). 포털 오더함에서 확인해 주세요.';
      } else if (code === 'ERR_NO_CONFIG') {
        poll.halted = '연결 설정이 없어요. ⚙︎ 에서 GAS 주소와 토큰을 넣어 주세요.';
      } else {
        poll.fails += 1;
        if (poll.fails >= POLL_MAX_FAILS) poll.halted = '상태를 가져오지 못했습니다. 잠시 뒤 [다시 확인]을 눌러 주세요.';
        else if (pollAlive()) schedulePoll(POLL_INTERVAL_MS);
      }
      if (pollAlive()) paintOrderStatus();
    } finally {
      poll.busy = false;
    }
  }

  /* ── 공통 조각 ── */
  const note = (text) => h('p', { class: 'hint', text });
  const check = (label, checked, onChange, sub) => {
    const cb = h('input', { type: 'checkbox' });
    cb.checked = !!checked;
    cb.addEventListener('change', () => onChange(cb.checked));
    return h('label', { class: 'pr-check' }, cb,
      h('span', null, h('span', { class: 'pr-check-t', text: label }), sub ? h('span', { class: 'pr-check-s', text: sub }) : null));
  };
  const goSeries = (tab, label) => h('button', {
    class: 'btn sm', type: 'button', text: label,
    onclick: () => { openSeriesTab(tab); if (onNavigate) onNavigate('#/series'); else location.hash = '#/series'; }
  });
  const copyText = (text, okMsg) => {
    const done = () => toast(okMsg, 'ok');
    const fallback = () => {
      const ta = h('textarea', { readonly: true, style: 'position:fixed;opacity:0' });
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      if (ok) done(); else toast('복사가 막혔어요 — 길게 눌러 직접 복사해 주세요', 'err');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(fallback);
    else fallback();
  };

  /* ── ① 재료 ── */
  function bodyMaterial(box) {
    const ta = h('textarea', {
      class: 'pr-ta', rows: '4', spellcheck: 'false', autocomplete: 'off',
      placeholder: '노트북 inbox 폴더에 넣은 영상 파일 이름을 한 줄에 하나씩 (예: 01_외관.mp4)', 'aria-label': '영상 파일 이름'
    });
    ta.value = state.inputs.join('\n');
    const errBox = h('div', { class: 'pr-err', role: 'alert' });
    const paintErr = () => {
      const r = parseInputs(ta.value);
      errBox.replaceChildren(...r.errors.map((e) => h('div', { text: e })));
      return r;
    };
    ta.addEventListener('input', () => {
      const r = paintErr();
      if (!r.errors.length) change((s) => { s.inputs = r.names; });
    });
    paintErr();

    const prof = h('select', { class: 'pr-sel', 'aria-label': '음량 프로필' },
      ...Object.keys(PROFILES).map((k) => h('option', { value: k, text: PROFILES[k].label + ' · ' + PROFILES[k].lufs.toFixed(0) + ' LUFS' })));
    prof.value = state.profile;
    prof.addEventListener('change', () => change((s) => { s.profile = prof.value; }));

    const crop = h('input', { class: 'pr-in', type: 'text', inputmode: 'decimal', placeholder: '비워 두면 가운데', 'aria-label': '크롭 위치 0~1', value: state.crop_x === '' ? '' : String(state.crop_x) });
    const cropErr = h('div', { class: 'pr-err', role: 'alert' });
    crop.addEventListener('input', () => {
      const raw = crop.value.trim();
      const n = Number(raw);
      if (raw === '') { cropErr.textContent = ''; change((s) => { s.crop_x = ''; }); }
      else if (!Number.isFinite(n) || n < 0 || n > 1) cropErr.textContent = '0~1 사이 숫자로 적어 주세요(0=왼쪽, 0.5=가운데, 1=오른쪽)';
      else { cropErr.textContent = ''; change((s) => { s.crop_x = n; }); }
    });

    box.append(
      note('이 카드의 원본 영상 파일 이름을 적어 두는 칸이에요. 최대 ' + MAX_INPUTS + '개, mp4·mov·m4v. 폴더 경로는 적지 않아요.'),
      h('div', { class: 'pr-warnbox' },
        h('strong', { text: '파일 넣는 곳: ' }),
        h('code', { text: 'inbox/' + contentId + '/' }),
        h('span', { text: ' (집 노트북). 영상을 이 화면에서 올리는 기능은 아직 없어요 — 먼저 그 폴더에 파일을 넣어 두세요.' })),
      h('label', { class: 'pr-field' }, h('span', { class: 'pr-label', text: '영상 파일 이름' }), ta),
      errBox,
      h('div', { class: 'pr-two' },
        h('label', { class: 'pr-field' }, h('span', { class: 'pr-label', text: '음량 프로필' }), prof),
        h('label', { class: 'pr-field' }, h('span', { class: 'pr-label', text: '9:16 크롭 위치(가로 영상일 때)' }), crop)),
      cropErr,
      note('세로 영상이면 크롭은 쓰이지 않아요. 간판·인물처럼 가운데가 아닌 곳을 살려야 할 때만 적어요.'));
  }

  /* ── ② 기획 ── */
  function bodyPlan(box) {
    box.append(
      note('첫 문장(훅)을 채점하고 대본 뼈대를 만드는 건 숏폼 공방에서 해요. 커버 문구와 첫 2초 자막의 숫자를 먼저 맞춰 둡니다.'),
      h('div', { class: 'pr-row' }, goSeries('studio', '숏폼 공방 열기 (훅 채점 · 대본)')),
      check('훅과 대본을 정했어요', state.plan, (v) => change((s) => { s.plan = v; }),
        '가격·시간처럼 확인 못 한 숫자는 [채우기]로 남겨 두고 촬영 날 채워요'));
  }

  /* ── ③ 컷 목록 ── */
  function bodyCuts(box) {
    box.append(
      note('자막(SRT)이나 타임코드 대본을 넣으면 무음·추임새·재시도 구간을 초 단위로 뽑아 줘요. 컷 목록은 "무엇을 자를지"까지만 정하고, 실제로 자르는 건 ④에서 해요.'),
      h('div', { class: 'pr-row' }, goSeries('studio', '숏폼 공방 열기 (컷 편집 리스트)')),
      check('자를 구간을 정했어요', state.cuts, (v) => change((s) => { s.cuts = v; }),
        '④ 오더는 아직 컷 목록을 받지 않아요 — 컷은 캡컷에서 이 목록대로 직접 다듬어요'));
  }

  /* ── ④ 클린 마스터 ── */
  function bodyRender(box) {
    stopPoll();
    statusHost = null;
    const built = buildRenderPayload({ contentId, brand, inputs: state.inputs, profile: state.profile, cropX: state.crop_x });
    const p = PROFILES[state.profile];

    box.append(
      note('노트북이 영상을 9:16(1080×1920)·30fps로 맞추고 음량을 ' + p.lufs.toFixed(0) + ' LUFS로 평탄화한 클린 마스터를 만들어요. 자막 번인·TTS·효과음·로고는 넣지 않아요(표준 v3).'),
      h('div', { class: 'pr-pipe' },
        ...['정보 읽기', '이어붙이기', '9:16 맞춤', '음량 2회 측정', '규격 검수'].map((t, i) => h('span', { class: 'pr-pipe-i' }, h('b', { text: String(i + 1) }), t))));

    if (!built.ok) {
      box.appendChild(h('div', { class: 'pr-warnbox' },
        h('strong', { text: '① 재료부터 채워 주세요 — ' }),
        h('span', { text: built.errors[0] })));
    }

    /* 오더 보내기 */
    const sendBtn = h('button', { class: 'btn primary', type: 'button', text: '노트북에 렌더 오더 보내기' });
    if (!built.ok) sendBtn.setAttribute('disabled', '');
    const banner = h('div', { class: 'pr-banner-host', role: 'status' });
    const showBanner = (kind, title, text) => {
      banner.replaceChildren(h('div', { class: 'pr-banner ' + kind }, h('strong', { text: title + ' ' }), h('span', { text })));
    };

    sendBtn.addEventListener('click', async () => {
      if (!built.ok) return;
      sendBtn.setAttribute('disabled', '');
      sendBtn.textContent = '보내는 중…';
      banner.replaceChildren();
      try {
        const res = await api.post('hub_order', Object.assign({ type: 'content_render' }, built.payload));
        const d = (res && res.data) || {};
        change((s) => {
          s.render = {
            order_id: String(d.order_id || ''), status: String(d.status || ''), sent_at: new Date().toISOString(),
            needs_approval: d.needs_approval === true, approval_expires_at: String(d.approval_expires_at || ''),
            note: String(d.note || ''), report: null
          };
        });
        toast('렌더 오더를 보냈어요', 'ok');
        poll.fails = 0; poll.halted = ''; poll.live = null;
        paintList();
      } catch (err) {
        const code = err && err.code;
        if (code === 'ERR_QUEUE_TYPE_UNKNOWN') {
          showBanner('warn', '노트북 큐가 아직 영상 렌더를 몰라요.',
            '큐(Apps Script) 새 버전 배포가 먼저 필요해요. 오더는 만들어지지 않았어요. 배포 뒤 다시 눌러 주세요.');
        } else if (code === 'ERR_VALIDATION_FAILED') {
          showBanner('err', '입력을 확인해 주세요.', (err && err.message) || '');
        } else if (code === 'ERR_NO_CONFIG') {
          showBanner('err', '연결이 안 돼 있어요.', 'GAS 주소·토큰을 먼저 설정해 주세요.');
        } else {
          showBanner('err', '오더를 보내지 못했어요.', ((err && err.message) || '알 수 없는 오류') + ' — 잠시 뒤 다시 눌러 주세요.');
        }
        sendBtn.removeAttribute('disabled');
        sendBtn.textContent = '노트북에 렌더 오더 보내기';
      }
    });

    const copyBtn = h('button', {
      class: 'btn sm', type: 'button', text: '오더 내용 복사',
      onclick: () => copyText(built.ok ? JSON.stringify(Object.assign({ type: 'content_render' }, built.payload), null, 2) : '', '오더 내용을 복사했어요')
    });
    if (!built.ok) copyBtn.setAttribute('disabled', '');

    box.append(
      h('div', { class: 'pr-row' }, sendBtn, copyBtn),
      note('위험 작업이라 승인 카드가 뜨고, 15분 안에 승인해야 실행돼요. 승인은 포털 오더함에서 하고, 진행 상태는 이 화면이 15초마다 알려 줘요.'),
      banner);

    if (built.ok) {
      box.appendChild(h('details', { class: 'pr-det' },
        h('summary', { text: '보낼 내용 보기' }),
        h('pre', { class: 'pr-pre', text: JSON.stringify(built.payload, null, 2) })));
    }

    /* 보낸 오더 */
    const r = state.render;
    if (r && r.order_id) {
      box.appendChild(h('dl', { class: 'kv pr-kv' },
        h('dt', { text: '오더 번호' }), h('dd', { text: r.order_id }),
        h('dt', { text: '접수 상태' }), h('dd', { text: orderStatusLabel(r.status) + (r.needs_approval && String(r.status).toUpperCase() === 'WAITING_APPROVAL' ? ' · 포털 오더함에서 승인해 주세요' : '') }),
        h('dt', { text: '보낸 때' }), h('dd', { text: r.sent_at ? new Date(r.sent_at).toLocaleString('ko-KR') : '-' }),
        r.approval_expires_at ? h('dt', { text: '승인 기한' }) : null,
        r.approval_expires_at ? h('dd', { text: new Date(r.approval_expires_at).toLocaleString('ko-KR') }) : null));
      if (r.note && !r.needs_approval) box.appendChild(note(r.note));
      statusHost = h('div', { class: 'pr-live', role: 'status', 'aria-live': 'polite' });
      box.appendChild(statusHost);
      paintOrderStatus();
      if (!poll.vis) { document.addEventListener('visibilitychange', onVisible); poll.vis = true; }
      if (!isTerminalStatus(currentStatus()) && !poll.halted) schedulePoll(400);   // 열자마자 한 번 확인하고, 이후 15초 간격
    }

    /* 결과 붙여넣기 → 표 */
    const rep = h('textarea', { class: 'pr-ta', rows: '4', spellcheck: 'false', placeholder: '포털 오더함의 결과(report.json)를 붙여 넣어요', 'aria-label': '렌더 결과 report' });
    const repErr = h('div', { class: 'pr-err', role: 'alert' });
    const repBtn = h('button', { class: 'btn sm', type: 'button', text: '결과 표로 보기' });
    repBtn.addEventListener('click', () => {
      const parsed = parseReport(rep.value.trim());
      if (!parsed.ok) { repErr.textContent = parsed.error; return; }
      repErr.textContent = '';
      change((s) => { s.render = Object.assign({ order_id: '', status: '', sent_at: '', needs_approval: false, approval_expires_at: '', note: '' }, s.render || {}, { report: parsed.report }); });
      paintList();
    });
    box.append(
      h('label', { class: 'pr-field' }, h('span', { class: 'pr-label', text: '렌더 결과' }), rep),
      repErr,
      h('div', { class: 'pr-row' }, repBtn));

    if (r && r.report) {
      const std = compareStandard(r.report, state.profile);
      box.appendChild(h('h4', { class: 'pr-h4', text: '표준 v3 표1 대조 (화면이 다시 계산)' }));
      box.appendChild(resultTable(std.map((x) => ({ name: x.label, status: x.status, msg: x.msg }))));
      if (r.report.checks.length) {
        box.appendChild(h('h4', { class: 'pr-h4', text: '노트북 검수 항목' }));
        box.appendChild(resultTable(r.report.checks.map((x) => ({ name: x.id || '-', status: x.status, msg: x.msg }))));
      }
      if (r.report.out) box.appendChild(note('결과 파일: ' + r.report.out + ' (노트북 out/' + contentId + '/)'));
    }
  }

  function resultTable(rows) {
    const t = h('table', { class: 'pr-tbl' }, h('thead', null, h('tr', null, h('th', { text: '항목' }), h('th', { text: '판정' }), h('th', { text: '값·메모' }))));
    const tb = h('tbody');
    rows.forEach((x) => tb.appendChild(h('tr', null,
      h('td', { text: x.name }),
      h('td', null, h('span', { class: 'pr-judge ' + x.status.toLowerCase(), text: x.status })),
      h('td', { text: x.msg || '' }))));
    t.appendChild(tb);
    return h('div', { class: 'pr-tbl-wrap' }, t);
  }

  /* ── ⑤ 자막 파일 ── */
  function bodySrt(box) {
    const f = finishOf(brand);
    box.append(
      h('p', { class: 'pr-soon', text: '다음 단계(준비 중) — 말소리를 글자로 바꿔 자막 파일(SRT)을 만드는 기능은 아직 연결되지 않았어요.' }),
      note('표준 v3 표2 규격: UTF-8(BOM 없음)·LF · 한 줄 ' + f.cpl + '자(공백 포함), 최대 2줄 · 1.0~3.5초 · 사이 간격 0.06초 이상 · ASS 태그·화자 표기·카라오케 금지.'),
      note('그때까지는 캡컷의 자동 자막을 쓰거나 직접 입력하고, 상호·메뉴·가격은 꼭 눈으로 대조해요. AI 가 자막을 만들었다면 ⑥ 5단계의 안내 문구를 넣어요.'));
  }

  /* ── ⑥ 검수·마무리 ── */
  function bodyFinish(box) {
    const f = finishOf(brand);
    box.append(
      note('캡컷에서 약 2분. 폰트·자막 스타일·안전영역·BGM·커버는 사람이 정해요(표준 v3 표3). 끝낸 단계를 눌러 표시해 두세요.'));
    reviewSteps(brand).forEach((rs, i) => {
      box.appendChild(check((i + 1) + '. ' + rs.title, state.review[rs.id] === true, (v) => change((s) => { s.review[rs.id] = v; }), rs.rule));
    });
    box.appendChild(h('p', { class: 'pr-brand', text: '이 카드의 트랙 값 — 글꼴 ' + f.font + ' · 강조색 ' + f.color + ' · 줄당 ' + f.cpl + '자' }));
    box.appendChild(note('발행(업로드·고정댓글·링크 삽입)은 사람이 해요. 이 화면은 어떤 것도 올리지 않아요.'));
  }

  const BODIES = { material: bodyMaterial, plan: bodyPlan, cuts: bodyCuts, render: bodyRender, srt: bodySrt, finish: bodyFinish };

  /* 처음엔 아직 안 끝난 첫 단계를 펼쳐 둔다 */
  const st0 = stepStatus(state, brand);
  const firstOpen = STEPS.find((s) => !s.soon && !st0[s.key]);
  openStep = firstOpen ? firstOpen.key : null;
  paintHead();
  paintList();
  return wrap;
}
