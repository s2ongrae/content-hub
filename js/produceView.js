/**
 * js/produceView.js — 카드 상세 '제작' 탭 (제작 스텝퍼, 2026-11-19)
 *
 * 카드 하나를 ①재료 → ②기획 → ③컷 목록 → ④클린 마스터 → ⑤자막 파일 → ⑥검수·마무리 순서로 따라간다.
 *  · 표준은 docs/CONTENT_STANDARD_v3.md — AI 는 클린 마스터(컷·9:16·음량)까지, 자막 번인·TTS·BGM·커버는 사람이 캡컷에서.
 *    2026-11-20부터는 카드 payload 의 production.captions/narration 이 있으면 ④ 오더에 실어 **완제품(_final.mp4)** 까지 만든다
 *    (자막 번인 + TTS 내레이션 + 현장음 -15dB 덕킹 — docs/FINAL_RENDER_v1.md). 클린 마스터는 늘 함께 남는다.
 *  · ① 은 영상을 구글 드라이브(비공개 폴더)에 올린다(js/uploadVideo.js → gas/Upload.gs). 노트북이 렌더할 때 받아 간다.
 *  · ③ 은 타임코드 대본에서 컷 목록(무음·추임새·재시도)을 계산해 켜고 끌 수 있게 하고, ④ 오더에 cuts 로 실어 노트북이 실제로 자른다.
 *  · ④ 는 노트북에 영상 렌더 오더(hub_order · content_render)를 보낸다. 승인(15분) 뒤에만 실행된다.
 *    보낸 뒤에는 hub_order_status(읽기 전용)로 15초마다 진행 상태를 가져와 보여 준다(종료 상태·화면 이탈·탭 숨김이면 멈춤).
 *  · ⑤ 자막 파일(Whisper)은 아직 없다 — '준비 중'으로만 표시하고 누를 수 있는 버튼은 만들지 않는다.
 *
 * 저장: Drive payload 의 최상위 키 `studio` 한 개. update_content 의 patch 로 저장한다(작성본 탭과 같은 경로,
 *   Contents 37칸·GAS 변경 없음). 저장이 실패하면 그 기기 localStorage 에 남겨 두고 다음에 다시 저장한다.
 * 렌더링은 createElement/textContent 만.
 */

import { api } from './api.js';
import { openSeriesTab } from './seriesView.js';
import { buildEDL } from './yt/edl.js?v=20261120d';
import { uploadVideo, listUploads, deleteUpload } from './uploadVideo.js?v=20261120d';
import {
  STEPS, PROFILES, MAX_INPUTS, MAX_CUTS, finishOf, reviewSteps, normalizeState, parseInputs, buildRenderPayload,
  parseReport, compareStandard, stepStatus, orderStatusLabel, normalizeCues, SUB_STYLES, MAX_CUES_INLINE,
  isTerminalStatus, isNotDeployedCode, describeOrder, POLL_INTERVAL_MS, POLL_MAX_FAILS,
  cutsFromEdl, cutSummary, cutsForOrder, checkUploadFile, formatBytes
} from './produceLogic.js?v=20261120d';

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
  // 완제품(2026-11-20): 카드 payload 의 production 에 저장된 자막·내레이션 대본을 읽는다(수정은 다른 화면 몫).
  const production = (detail.payload && detail.payload.production) || {};
  const cardCaptions = production.captions !== undefined ? production.captions : (detail.payload && detail.payload.captions);
  const cardNarration = production.narration !== undefined ? production.narration : (detail.payload && detail.payload.narration);
  let unsaved = false;
  try {
    const raw = lsGet(lsKey);
    if (raw) { state = normalizeState(JSON.parse(raw)); unsaved = true; }
  } catch (e) { lsDel(lsKey); }

  let renderWarn = null;      // 오더를 보낸 직후의 경고(다시 그려도 남도록 여기 둔다)
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

  /* ── ① 영상 올리기(구글 드라이브) ── */
  const up = { busy: false, cancel: false };
  const uploadAlive = () => {
    if (!wrap.isConnected) return false;
    const dlg = wrap.closest('dialog');
    return !(dlg && !dlg.open);                     // 상세 시트를 닫으면 올리기를 멈춘다
  };

  function uploadPanel(addInput) {
    const fileIn = h('input', { type: 'file', accept: '.mp4,.mov,.m4v,video/mp4,video/quicktime', class: 'pr-file', 'aria-label': '올릴 영상 고르기' });
    fileIn.multiple = true;
    const barIn = h('div', { class: 'pr-bar-in', style: 'width:0%' });
    const bar = h('div', { class: 'pr-bar', role: 'img', 'aria-label': '올리는 중', style: 'display:none' }, barIn);
    const line = h('div', { class: 'pr-upline', role: 'status', 'aria-live': 'polite' });
    const listHost = h('div', { class: 'pr-uplist' });
    const cancelBtn = h('button', { class: 'btn sm', type: 'button', text: '멈추기', style: 'display:none', onclick: () => { up.cancel = true; line.textContent = '멈추는 중…'; } });
    const setLine = (text, kind) => { line.textContent = text; line.className = 'pr-upline' + (kind ? ' ' + kind : ''); };
    const syncBusy = () => {
      if (up.busy) fileIn.setAttribute('disabled', ''); else fileIn.removeAttribute('disabled');
      cancelBtn.style.display = up.busy ? '' : 'none';
      bar.style.display = up.busy ? '' : 'none';
    };

    function errText(err) {
      const code = err && err.code;
      if (isNotDeployedCode(code)) return '서버(GAS)에 올리기 기능이 아직 없어요. Upload.gs 를 추가하고 새 버전으로 배포하면 켜져요.';
      if (code === 'ERR_NO_CONFIG') return '연결 설정이 없어요. ⚙︎ 에서 GAS 주소와 토큰을 넣어 주세요.';
      if (code === 'ERR_UNAUTHORIZED') return '토큰이 맞지 않아요. ⚙︎ 에서 다시 넣어 주세요.';
      if (code === 'ERR_PAYLOAD_TOO_LARGE') return '서버가 조각을 너무 크다고 거절했어요. GAS 를 새 버전으로 배포했는지 확인해 주세요.';
      return (err && err.message) || '알 수 없는 오류';
    }

    async function refreshList() {
      if (!uploadAlive()) return;
      listHost.replaceChildren(h('p', { class: 'hint', text: '올라온 영상을 확인하는 중…' }));
      let items;
      try { items = await listUploads(api, contentId); }
      catch (err) { if (uploadAlive()) listHost.replaceChildren(h('p', { class: 'pr-err', text: '목록을 가져오지 못했어요 — ' + errText(err) })); return; }
      if (!uploadAlive()) return;
      if (!items.length) { listHost.replaceChildren(h('p', { class: 'hint', text: '아직 이 카드로 올린 영상이 없어요.' })); return; }
      const rows = items.map((it) => {
        const used = state.inputs.indexOf(it.name) >= 0;
        const stateText = it.complete ? '올라옴' : '덜 올라옴(' + it.parts_found + '/' + it.parts + '조각)';
        const useBtn = h('button', { class: 'btn sm', type: 'button', text: used ? '쓰는 중' : '이 영상 쓰기', onclick: () => { addInput(it.name); refreshList(); } });
        if (used || !it.complete) useBtn.setAttribute('disabled', '');
        const delBtn = h('button', {
          class: 'btn sm', type: 'button', text: '지우기',
          onclick: async () => {
            if (!window.confirm(it.name + ' 을(를) 구글 드라이브에서 지울까요? (휴지통으로 가요)')) return;
            try { await deleteUpload(api, contentId, it.name); toast('지웠어요', 'ok'); } catch (err) { toast('지우지 못했어요 — ' + errText(err), 'err'); }
            refreshList();
          }
        });
        return h('div', { class: 'pr-uprow' },
          h('div', { class: 'pr-upinfo' }, h('strong', { text: it.name }), h('span', { class: 'pr-sub', text: formatBytes(it.size) + ' · ' + stateText })),
          h('div', { class: 'pr-row' }, useBtn, delBtn));
      });
      listHost.replaceChildren(...rows);
    }

    fileIn.addEventListener('change', async () => {
      const files = Array.from(fileIn.files || []);
      fileIn.value = '';
      if (!files.length || up.busy) return;
      up.busy = true; up.cancel = false; syncBusy();
      let okCount = 0;
      for (const f of files) {
        const chk = checkUploadFile({ name: f.name, size: f.size });
        if (!chk.ok) { setLine(chk.errors[0], 'err'); continue; }
        if (state.inputs.indexOf(chk.name) < 0 && state.inputs.length >= MAX_INPUTS) { setLine('영상은 ' + MAX_INPUTS + '개까지예요', 'err'); break; }
        barIn.style.width = '0%';
        setLine(chk.name + (chk.renamed ? ' (이름을 ' + chk.name + ' 로 바꿔 올려요)' : '') + ' — 올리는 중…', '');
        try {
          await uploadVideo({
            api, contentId, file: f, name: chk.name,
            shouldCancel: () => up.cancel || !uploadAlive(),
            onProgress: (p) => {
              barIn.style.width = Math.round((p.sent / p.total) * 100) + '%';
              setLine(chk.name + ' — ' + p.index + '/' + p.parts + ' 조각 · ' + formatBytes(p.sent) + ' / ' + formatBytes(p.total), '');
            }
          });
          addInput(chk.name);
          okCount += 1;
          if (uploadAlive()) setLine(chk.name + ' — 올렸어요', 'ok');
        } catch (err) {
          if (err && err.code === 'CANCELLED') { if (uploadAlive()) setLine('올리기를 멈췄어요. 올라간 일부 조각은 다음에 같은 이름으로 올리면 지워져요.', 'err'); break; }
          if (uploadAlive()) setLine(chk.name + ' — 올리지 못했어요: ' + errText(err), 'err');
          break;
        }
      }
      up.busy = false; up.cancel = false;
      if (uploadAlive()) { syncBusy(); if (okCount) toast(okCount + '개를 구글 드라이브에 올렸어요', 'ok'); refreshList(); }
    });

    syncBusy();
    refreshList();
    return h('div', { class: 'pr-up' },
      h('div', { class: 'pr-label', text: '영상 올리기 (구글 드라이브)' }),
      h('p', { class: 'hint', text: '골라서 올리면 구글 드라이브의 비공개 폴더에 저장돼요. 노트북이 ④에서 렌더할 때 알아서 받아 가요. 큰 영상은 몇 분 걸리니 이 창을 닫지 마세요. mov·mp4·m4v, 한 개 1.5GB까지.' }),
      h('div', { class: 'pr-row' }, fileIn, cancelBtn),
      bar, line,
      h('div', { class: 'pr-row' }, h('button', { class: 'btn sm', type: 'button', text: '올라온 영상 새로고침', onclick: refreshList })),
      listHost,
      h('p', { class: 'hint', text: '노트북 설정(처음 한 번): 노트북의 .env 에 CONTENT_HUB_GAS_URL 과 CONTENT_HUB_API_TOKEN 이 있어야 받아 가요. 없으면 예전처럼 노트북의 inbox 폴더에 직접 넣어도 돼요.' }));
  }

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

    const addInput = (name) => {
      if (state.inputs.indexOf(name) < 0 && state.inputs.length < MAX_INPUTS) change((s) => { s.inputs = s.inputs.concat([name]); });
      ta.value = state.inputs.join('\n');
      paintErr();
    };

    box.append(
      uploadPanel(addInput),
      note('아래 칸은 이 카드에서 쓸 영상 파일 이름이에요(위에서 올리면 자동으로 들어가요). 최대 ' + MAX_INPUTS + '개, mp4·mov·m4v. 폴더 경로는 적지 않아요.'),
      h('div', { class: 'pr-warnbox' },
        h('strong', { text: '직접 넣을 때: ' }),
        h('code', { text: 'inbox/' + contentId + '/' }),
        h('span', { text: ' (집 노트북). 구글 드라이브에 올리지 않고 노트북 폴더에 파일을 직접 넣었다면 그 이름을 아래에 적어요.' })),
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
  const cutMem = { src: '', floor: '0.6', srcLen: null };   // 붙여 넣은 자막은 이 화면에서만 들고 있다(서버·저장소에 남기지 않는다)
  const CUT_LABEL = { DEAD: '무음', FILLER: '추임새', REPEAT: '재시도' };
  function bodyCuts(box) {
    const ta = h('textarea', {
      class: 'pr-ta', rows: '6', spellcheck: 'false', autocomplete: 'off', 'aria-label': '타임코드 대본',
      placeholder: '원본 영상의 자막(SRT)이나 "00:12 말" 형식 대본을 붙여 넣어요'
    });
    ta.value = cutMem.src;
    ta.addEventListener('input', () => { cutMem.src = ta.value; });
    const floor = h('input', { class: 'pr-in', type: 'text', inputmode: 'decimal', value: cutMem.floor, 'aria-label': '무음 기준(초)' });
    const msg = h('div', { class: 'pr-err', role: 'alert' });
    const sumHost = h('div', { class: 'pr-banner', role: 'status', 'aria-live': 'polite' });
    const listHost = h('div', { class: 'pr-cutlist' });

    function paintSummary() {
      const sm = cutSummary(state.cut_list, cutMem.srcLen);
      if (!state.cut_list.length) { sumHost.style.display = 'none'; return; }
      sumHost.style.display = '';
      sumHost.replaceChildren(h('strong', { text: '자를 곳 ' + sm.count + '곳 · 약 ' + sm.seconds.toFixed(1) + '초 ' }),
        h('span', { text: sm.left !== null ? '→ 남는 길이 약 ' + sm.left.toFixed(1) + '초(규격 3~90초)' : '' }));
    }

    function paintCuts() {
      paintSummary();
      if (!state.cut_list.length) { listHost.replaceChildren(); return; }
      const t = h('table', { class: 'pr-tbl' }, h('thead', null, h('tr', null,
        h('th', { text: '자르기' }), h('th', { text: '종류' }), h('th', { text: '구간(초)' }), h('th', { text: '길이' }))));
      const tb = h('tbody');
      state.cut_list.forEach((c, i) => {
        const cb = h('input', { type: 'checkbox', 'aria-label': (i + 1) + '번 구간 자르기' });
        cb.checked = c.on !== false;
        cb.addEventListener('change', () => { change((s) => { s.cut_list[i].on = cb.checked; }); paintSummary(); });
        tb.appendChild(h('tr', null,
          h('td', null, cb), h('td', { text: CUT_LABEL[c.type] || c.type }),
          h('td', { text: c.from.toFixed(2) + ' → ' + c.to.toFixed(2) }), h('td', { text: (c.to - c.from).toFixed(2) })));
      });
      t.appendChild(tb);
      listHost.replaceChildren(h('div', { class: 'pr-tbl-wrap' }, t));
    }

    const makeBtn = h('button', {
      class: 'btn primary sm', type: 'button', text: '컷 목록 만들기',
      onclick: () => {
        msg.textContent = '';
        cutMem.floor = floor.value;
        const f = Number(String(floor.value).trim());
        if (!Number.isFinite(f) || f < 0.2 || f > 3) { msg.textContent = '무음 기준은 0.2~3 사이 숫자(초)로 적어 주세요'; return; }
        const res = buildEDL(ta.value, { floor: f });
        if (!res.ok) { msg.textContent = res.error; return; }
        let list = cutsFromEdl(res);
        if (!list.length) { msg.textContent = '자를 곳을 찾지 못했어요(무음 기준을 줄이면 더 찾아요)'; return; }
        if (list.length > MAX_CUTS) { msg.textContent = '자를 곳이 ' + list.length + '곳이라 앞 ' + MAX_CUTS + '곳만 담았어요'; list = list.slice(0, MAX_CUTS); }
        cutMem.srcLen = res.stats ? Math.round((res.stats.result_seconds + res.stats.cut_seconds) * 100) / 100 : null;
        change((s) => { s.cut_list = list; s.cuts = false; });
        paintCuts();
        paintList_checksOnly();
      }
    });
    const clearBtn = h('button', {
      class: 'btn sm', type: 'button', text: '목록 지우기',
      onclick: () => { change((s) => { s.cut_list = []; s.cuts = false; }); cutMem.srcLen = null; msg.textContent = ''; paintCuts(); paintList_checksOnly(); }
    });

    const kids = [
      note('원본 영상의 자막(SRT)이나 타임코드 대본을 넣으면 무음·추임새·재시도 구간을 초 단위로 뽑아 줘요. 끄고 싶은 구간은 체크를 풀어요. ④에서 노트북이 켜 둔 구간을 실제로 잘라요.'),
      h('div', { class: 'pr-warnbox' }, h('strong', { text: '시간은 원본 영상 기준이에요. ' }),
        h('span', { text: '이미 한 번 편집한 영상의 자막을 넣으면 엉뚱한 곳이 잘려요. 가장 위(①)에서 올린 원본의 자막을 쓰세요.' }))
    ];
    if (state.inputs.length > 1) {
      const sel = h('select', { class: 'pr-sel', 'aria-label': '컷을 적용할 영상' },
        h('option', { value: '', text: '어느 영상의 자막인가요?' }),
        ...state.inputs.map((n) => h('option', { value: n, text: n })));
      sel.value = state.inputs.indexOf(state.cut_input) >= 0 ? state.cut_input : '';
      sel.addEventListener('change', () => { change((s) => { s.cut_input = sel.value; }); });
      kids.push(h('label', { class: 'pr-field' }, h('span', { class: 'pr-label', text: '컷을 적용할 영상' }), sel),
        note('영상이 여러 개면 컷은 고른 영상 하나에만 적용돼요. 다른 영상의 컷은 영상마다 따로 계산해야 해서 지금은 지원하지 않아요.'));
    }
    kids.push(
      h('label', { class: 'pr-field' }, h('span', { class: 'pr-label', text: '타임코드 대본' }), ta),
      h('div', { class: 'pr-two' },
        h('label', { class: 'pr-field' }, h('span', { class: 'pr-label', text: '무음 기준(초) — 이보다 길게 조용하면 자를 곳' }), floor),
        h('div', { class: 'pr-row pr-end' }, makeBtn, clearBtn)),
      msg, sumHost, listHost,
      check('자를 구간을 정했어요', state.cuts, (v) => change((s) => { s.cuts = v; }),
        '체크한 구간만 ④ 오더에 실려요. 자를 곳이 없으면 이 칸만 체크해도 돼요(통째로 규격에 맞춰요)'));
    box.append(...kids);
    paintCuts();
  }

  /** 단계 라벨만 갱신(입력 중인 칸을 지키려고 목록 전체를 다시 그리지 않는다) */
  function paintList_checksOnly() { paintStates(); }

  /* ── ④ 클린 마스터 ── */
  function bodyRender(box) {
    stopPoll();
    statusHost = null;
    const cutRes = cutsForOrder(state, state.inputs);
    // 완제품 옵션 — 카드에 저장된 자막·내레이션을 오더에 실어 노트북이 번인·TTS·덕킹까지 마친다.
    const capRes = normalizeCues(cardCaptions, '자막');
    const narRes = normalizeCues(cardNarration, '내레이션', { tones: ['hype', 'calm'] });
    const built = buildRenderPayload({
      contentId, brand, inputs: state.inputs, profile: state.profile, cropX: state.crop_x,
      cuts: cutRes.ok ? cutRes.cuts : undefined,
      captions: capRes.cues.length ? capRes.cues : undefined,
      narration: state.narrate ? (narRes.cues.length ? narRes.cues : undefined) : undefined,
      burnSubtitles: state.burn, subStyle: state.sub_style,
      narrate: state.narrate && !narRes.cues.length, voice: state.voice || undefined
    });
    const sendable = built.ok && cutRes.ok;
    const p = PROFILES[state.profile];
    const cutSm = cutSummary(state.cut_list.filter((c) => c.on !== false), cutMem.srcLen);
    const capN = capRes.cues.length;
    const narN = narRes.cues.length;
    const willBurn = state.burn && (capN > 0 || (built.ok && built.payload.payload_source === 'drive'));
    const drive = built.ok && built.payload.payload_source === 'drive';

    box.append(
      note('노트북이 ' + (cutRes.ok && cutRes.cuts.length ? '정해 둔 컷 ' + cutRes.cuts.length + '곳(약 ' + cutSm.seconds.toFixed(1) + '초)을 먼저 잘라내고, ' : '') + '영상을 9:16(1080×1920)·30fps로 맞추고 음량을 ' + p.lufs.toFixed(0) + ' LUFS로 평탄화해요. ' +
        (state.burn ? '카드에 저장된 자막을 구워 완제품(_final.mp4)까지 만들어요. ' : '자막은 굽지 않고 클린 마스터만 만들어요. ') +
        (state.narrate ? '내레이션(TTS)은 그 구간만큼 현장음을 -15dB 덕킹해요.' : '내레이션은 넣지 않아요.')),
      h('div', { class: 'pr-pipe' },
        ...['정보 읽기'].concat(cutRes.ok && cutRes.cuts.length ? ['컷 편집'] : [], ['이어붙이기', '9:16 맞춤'])
          .concat(state.narrate ? ['내레이션', '음량 2회 측정'] : ['음량 2회 측정'])
          .concat(state.burn ? ['자막 굽기', '규격 검수'] : ['규격 검수'])
          .map((t, i) => h('span', { class: 'pr-pipe-i' }, h('b', { text: String(i + 1) }), t))));

    // 완제품 옵션 상자 — 몇 큐가 들어가는지·긴 영상이면 카드에서 읽는지 보여 준다
    box.append(h('div', { class: 'pr-field' },
      h('span', { class: 'pr-label', text: '완제품 옵션 (자막·내레이션)' }),
      check('자막을 구워서 완제품으로', state.burn, (v) => change((s) => { s.burn = v; }),
        capN ? '카드 자막 ' + capN + '큐 · 1080×1920 기준 · 하단 안전선 안 · 2줄까지' : '카드에 자막이 없어요 — 구울 것이 없습니다'),
      check('내레이션(TTS) 넣기', state.narrate, (v) => change((s) => { s.narrate = v; }),
        narN ? '카드 내레이션 ' + narN + '큐 (톤 hype/calm) · 현장음 -15dB 덕킹' : (capN ? '내레이션 대본이 없어 자막 문장을 차분하게 읽어요' : '자막도 내레이션도 없어 켜도 효과가 없어요')),
      h('div', { class: 'pr-two' },
        h('label', { class: 'pr-field' }, h('span', { class: 'pr-label', text: '자막 크기 기준' }),
          h('select', { class: 'pr-sel', 'aria-label': '자막 크기 기준', onchange: (e) => change((s) => { s.sub_style = e.target.value; }) },
            ...SUB_STYLES.map((v) => h('option', { value: v, selected: state.sub_style === v ? '' : null, text: v === 'auto' ? '자동(180초 기준)' : (v === 'shorts' ? '숏폼(68px·12자)' : '긴 영상(56px·16자)') }))))),
      h('span', { class: 'pr-check-s', text: drive
        ? '큐가 ' + MAX_CUES_INLINE + '개를 넘어 카드 payload 에서 읽어요(같은 결과).'
        : '카드 자막 ' + capN + '큐 · 내레이션 ' + narN + '큐 · 큐가 ' + MAX_CUES_INLINE + '개를 넘으면 카드에서 읽어요.' }),
      (capRes.errors.length || narRes.errors.length)
        ? h('span', { class: 'pr-check-s', text: '카드 자막·내레이션에 문제가 있어요: ' + (capRes.errors[0] || narRes.errors[0]) })
        : null));

    if (!built.ok) {
      box.appendChild(h('div', { class: 'pr-warnbox' },
        h('strong', { text: '① 재료부터 채워 주세요 — ' }),
        h('span', { text: built.errors[0] })));
    } else if (!cutRes.ok) {
      box.appendChild(h('div', { class: 'pr-warnbox' },
        h('strong', { text: '③ 컷 목록을 확인해 주세요 — ' }),
        h('span', { text: cutRes.error })));
    }

    /* 오더 보내기 */
    const sendBtn = h('button', { class: 'btn primary', type: 'button', text: '노트북에 렌더 오더 보내기' });
    if (!sendable) sendBtn.setAttribute('disabled', '');
    const banner = h('div', { class: 'pr-banner-host', role: 'status' });
    const showBanner = (kind, title, text) => {
      banner.replaceChildren(h('div', { class: 'pr-banner ' + kind }, h('strong', { text: title + ' ' }), h('span', { text })));
    };

    if (renderWarn) showBanner('warn', renderWarn.title, renderWarn.text);

    sendBtn.addEventListener('click', async () => {
      if (!sendable) return;
      sendBtn.setAttribute('disabled', '');
      sendBtn.textContent = '보내는 중…';
      banner.replaceChildren();
      renderWarn = null;
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
        const sentCuts = built.payload.cuts ? built.payload.cuts.length : 0;
        if (sentCuts && Number(d.cuts) !== sentCuts) {
          renderWarn = { title: '서버(GAS)가 컷을 아직 몰라요.', text: '컷 ' + sentCuts + '곳이 오더에 실리지 않았어요. 이대로 승인하면 자르지 않은 영상이 만들어져요 — 포털 오더함에서 거절하고, GAS 를 새 버전으로 배포한 뒤 다시 보내 주세요.' };
        } else if (!drive && capN > 0 && Number(d.captions) !== capN) {
          renderWarn = { title: '서버(GAS)가 자막을 아직 몰라요.', text: '자막 ' + capN + '큐가 오더에 실리지 않았어요. 이대로 승인하면 자막 없는 클린 마스터만 나와요 — 포털 오더함에서 거절하고, GAS 를 새 버전으로 배포한 뒤 다시 보내 주세요.' };
        }
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
      onclick: () => copyText(sendable ? JSON.stringify(Object.assign({ type: 'content_render' }, built.payload), null, 2) : '', '오더 내용을 복사했어요')
    });
    if (!sendable) copyBtn.setAttribute('disabled', '');

    box.append(
      h('div', { class: 'pr-row' }, sendBtn, copyBtn),
      note('위험 작업이라 승인 카드가 뜨고, 15분 안에 승인해야 실행돼요. 승인은 포털 오더함에서 하고, 진행 상태는 이 화면이 15초마다 알려 줘요.'),
      banner);

    if (sendable) {
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
