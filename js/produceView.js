/**
 * js/produceView.js — 카드 상세 '제작' 탭 (제작 스텝퍼, 2026-11-19)
 *
 * 카드 하나를 ①재료 → ②기획 → ③컷 목록 → ④클린 마스터 → ⑤자막(AI 초안→사람 확정) → ⑥마무리(자막 굽기·BGM·커버) → ⑦사람 확인 순서로 따라간다.
 *  · 표준은 docs/CONTENT_STANDARD_v3.md §6 — 전 과정을 허브에서 한다. 자막은 사람이 확정한 것만 굽고, 발행은 사람이 한다.
 *    2026-11-20부터는 카드 payload 의 production.captions/narration 이 있으면 ④ 오더에 실어 **완제품(_final.mp4)** 까지 만든다
 *    (자막 번인 + TTS 내레이션 + 현장음 -15dB 덕킹 — docs/FINAL_RENDER_v1.md). 클린 마스터는 늘 함께 남는다.
 *  · ① 은 영상을 구글 드라이브(비공개 폴더)에 올린다(js/uploadVideo.js → gas/Upload.gs). 노트북이 렌더할 때 받아 간다.
 *  · ③ 은 타임코드 대본에서 컷 목록(무음·추임새·재시도)을 계산해 켜고 끌 수 있게 하고, ④ 오더에 cuts 로 실어 노트북이 실제로 자른다.
 *  · ④ 는 노트북에 영상 렌더 오더(hub_order · content_render)를 보낸다. 승인(15분) 뒤에만 실행된다.
 *    보낸 뒤에는 hub_order_status(읽기 전용)로 15초마다 진행 상태를 가져와 보여 준다(종료 상태·화면 이탈·탭 숨김이면 멈춤).
 *  · ⑤ 는 클린 마스터의 말소리를 Whisper 로 받아 쓴 초안(srt_draft)을 사람이 고쳐 확정(srt_final)한다. ⑥ 은 그 자막을 굽고 BGM·커버를 만든다(_finish.mp4).
 *    ④ 완제품(_final.mp4)은 카드 대본 기반, ⑤⑥ 은 말소리 기반 — 두 길은 서로 다른 파일을 만든다.
 *
 * 저장: Drive payload 의 최상위 키 `studio` 한 개. update_content 의 patch 로 저장한다(작성본 탭과 같은 경로,
 *   Contents 37칸·GAS 변경 없음). 저장이 실패하면 그 기기 localStorage 에 남겨 두고 다음에 다시 저장한다.
 * 렌더링은 createElement/textContent 만.
 */

import { api } from './api.js';
import { openSeriesTab } from './seriesView.js';
import { buildEDL } from './yt/edl.js?v=20261123k';
import { uploadVideo, listUploads, deleteUpload, uploadVoice } from './uploadVideo.js?v=20261123k';
import {
  STEPS, PROFILES, MAX_INPUTS, MAX_CUTS, finishOf, reviewSteps, normalizeState, parseInputs, buildRenderPayload,
  parseReport, reportIsFresh, compareStandard, stepStatus, orderStatusLabel, normalizeCues, SUB_STYLES, MAX_CUES_INLINE,
  isTerminalStatus, isNotDeployedCode, describeOrder, POLL_INTERVAL_MS, POLL_MAX_FAILS,
  cutsFromEdl, cutSummary, cutsForOrder, checkUploadFile, formatBytes,
  buildStagePayload, ORDER_KEY_OF_STEP, BGM_NAME_RE, BGM_QUICK_TERMS, fmtDuration, cleanBgmQuery, RESULT_NAME_RE,
  MOTION_IDS, MOTION_LABELS, buildRecordingCard, checkVoiceFile, voiceLengthGap, VOICE_GAP_S, VOICE_LONG_WARN_S,
  PACE_IDS, PACE_LABELS, PACE_NOTES
} from './produceLogic.js?v=20261123k';
import { analyzeSrt, textHash } from './srtRules.js?v=20261123k';
import { readStudio, mergeFormat } from './studioLogic.js?v=20261124';
import { TEMPLATE_IDS, TEMPLATE_LABELS, templateHint, HOOK_POSITIONS, HOOK_HOLDS, DEFAULT_HOOK_POS, DEFAULT_HOOK_HOLD, checkHookForm, HOOK_QUESTION } from './videoTemplate.js?v=20261123k';

const LS_PREFIX = 'contenthub.produce.v1.';
const SAVE_DELAY_MS = 600;

function lsGet(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } }
function lsSet(key, val) { try { window.localStorage.setItem(key, val); } catch (e) { /* 저장소가 막혀도 화면은 산다 */ } }
function lsDel(key) { try { window.localStorage.removeItem(key); } catch (e) { /* 위와 같다 */ } }

export function produceSection(ctx) {
  const { h, detail, meta, toast, onNavigate } = ctx;
  const contentId = detail.content_id || meta.content_id;
  const brand = meta.brand || ctx.brand;

  /* ── 상태: 서버(payload.studio) 기준, 그 기기에 못 올린 변경이 남아 있으면 그것을 먼저 ──
   * 2026-11-21(제작 스튜디오 개편): 영상 상태의 자리가 studio.formats.video 로 옮겨졌다.
   *  · 읽기: studio.formats.video → 없으면 구 구조(studio 루트에 steps·inputs…) 폴백(readStudio).
   *  · 쓰기: 언제나 studio.formats.video 에만. 구 루트 키는 지우지 않고 남긴다(문제 시 읽기 우선순위 1줄 롤백).
   *  · studioRoot 를 들고 다니는 이유: GAS update_content 는 patch 의 최상위 키를 통째로 교체한다 —
   *    다른 포맷(blog·feed)의 초안을 덮지 않으려면 최신 studio 를 읽어 그 안에서 video 만 바꿔 보내야 한다. */
  const opened = readStudio(detail.payload);
  let studioRoot = opened.studio;
  const lsKey = LS_PREFIX + contentId;
  let state = normalizeState(opened.video);
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

  /* ── 오더 진행 상태(④⑤⑥ 공통) ── */
  const poll = { timer: null, fails: 0, live: null, halted: '', busy: false, vis: false, key: null, statusHost: null, onDone: null, refresh: null, done: {} };
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
    const body = () => ({ content_id: contentId, expected_version: version, patch: { studio: mergeFormat(studioRoot, 'video', state) } });
    let res;
    try {
      res = await api.updateContent(body());
    } catch (err) {
      if (err && err.code === 'ERR_VERSION_CONFLICT') {
        /* 다른 곳에서 카드가 바뀌었다 — 최신 studio 를 다시 읽어 video 하위 키만 갈아 끼운다(남의 포맷·초안을 덮지 않는다) */
        const cur = await api.getContentDetail(contentId);
        version = (cur.data && cur.data.version) || version;
        studioRoot = readStudio(cur.data && cur.data.payload).studio;
        res = await api.updateContent(body());
      } else {
        throw err;
      }
    }
    const d = (res && res.data) || {};
    if (d.version) { version = d.version; detail.version = d.version; }
    studioRoot = mergeFormat(studioRoot, 'video', state);
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
    if (poll.refresh) poll.refresh();   // 보낼 오더 내용·보내기 버튼을 새 값으로(입력할 때마다 낡지 않게)
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
        h('span', { class: 'pr-sub', text: '허브가 만들고, 사람이 확인해요' })),
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
    stopPoll();
    poll.refresh = null;
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

  /* ── 오더 진행 상태 폴링 (④ 클린 마스터 · ⑤ 자막 초안 · ⑥ 마무리 공통) ── */
  function orderOf(key) { return key ? state[key] : null; }
  function stopPoll() { if (poll.timer) { clearTimeout(poll.timer); poll.timer = null; } }
  function schedulePoll(ms) { stopPoll(); poll.timer = setTimeout(runPoll, ms); }
  /** 오더를 보내는 단계가 펼쳐져 있고 이 화면이 아직 붙어 있고 보낸 오더가 있을 때만 의미가 있다. */
  function pollAlive() {
    const o = orderOf(poll.key);
    if (!wrap.isConnected || !poll.key || ORDER_KEY_OF_STEP[openStep] !== poll.key || !(o && o.order_id)) return false;
    const dlg = wrap.closest('dialog');                // 상세 시트를 닫으면 DOM 은 남아 있어도 '화면을 떠난 것'으로 본다
    return !(dlg && !dlg.open);
  }
  function currentStatus() { const o = orderOf(poll.key) || {}; return (poll.live && poll.live.status) || o.status || ''; }

  async function fetchOrderStatus(id) {
    if (typeof api.hubOrderStatus === 'function') return api.hubOrderStatus(id);
    const res = await api.post('hub_order_status', { order_id: id });   // api.js 가 아직 옛 캐시일 때를 위한 대비
    return (res && res.data) || {};
  }

  function onVisible() {
    if (!wrap.isConnected) { document.removeEventListener('visibilitychange', onVisible); poll.vis = false; stopPoll(); return; }
    if (!document.hidden && pollAlive() && !poll.timer && !poll.busy && !poll.halted && !isTerminalStatus(currentStatus())) runPoll();
  }

  /** 오더가 DONE 이 되면(또는 이미 DONE 인 채 열리면) 그 단계의 결과를 한 번 가져온다. 실패하면 단계 안의 [다시 가져오기]로 한다. */
  function maybeDone() {
    const o = orderOf(poll.key);
    if (!o || !o.order_id || String(currentStatus()).toUpperCase() !== 'DONE') return;
    if (poll.done[poll.key] === o.order_id) return;
    poll.done[poll.key] = o.order_id;
    if (poll.onDone) poll.onDone();
  }

  function paintOrderStatus() {
    if (!poll.statusHost) return;
    const r = orderOf(poll.key) || {};
    const live = poll.live || { status: r.status, approval_expires_at: r.approval_expires_at, created_at: r.sent_at, started_at: '', result: '', error: '' };
    const d = describeOrder(live, Date.now());
    const rows = [h('div', { class: 'pr-banner' + (d.kind === 'warn' || d.kind === 'err' ? ' ' + d.kind : '') },
      h('strong', { text: d.title + ' ' }), h('span', { text: d.text }))];
    if (poll.halted) rows.push(h('p', { class: 'hint', text: poll.halted }));
    if (!isTerminalStatus(live.status) || poll.halted) {
      rows.push(h('div', { class: 'pr-row' }, h('button', {
        class: 'btn sm', type: 'button', text: poll.halted ? '다시 확인' : '지금 확인',
        onclick: () => { poll.fails = 0; poll.halted = ''; runPoll(); }
      })));
    }
    poll.statusHost.replaceChildren(...rows);
  }

  async function runPoll() {
    stopPoll();
    if (poll.busy) { poll.again = true; return; }      // 앞 단계 조회가 끝나면 이어서 한 번 더 확인한다(건너뛰고 잊지 않게)
    if (!pollAlive()) return;
    if (document.hidden) return;                       // 숨겨진 탭은 쉰다 — 다시 보이면 onVisible 이 이어서 한다
    poll.busy = true;
    poll.again = false;
    const key = poll.key;
    const orderId = state[key].order_id;
    try {
      const d = await fetchOrderStatus(orderId);
      if (!pollAlive() || poll.key !== key || state[key].order_id !== orderId) return;   // 기다리는 동안 화면을 떠났거나 다른 단계·다른 오더로 바뀜
      poll.fails = 0; poll.halted = ''; poll.live = d;
      if (d.status && d.status !== state[key].status) change((s) => { s[key].status = d.status; });
      paintOrderStatus();
      if (!isTerminalStatus(d.status)) schedulePoll(POLL_INTERVAL_MS);
      maybeDone();
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
      if (poll.again && pollAlive()) { poll.again = false; schedulePoll(400); }
    }
  }

  /* ── 허브 자산(자막·결과 보고)을 드라이브에서 읽고 쓰기 — gas/Upload.gs asset_get·asset_put ── */
  async function getAsset(kind) {
    const res = await api.post('asset_get', { content_id: contentId, kind });
    return (res && res.data) || {};
  }
  async function putAsset(kind, text) {
    const res = await api.post('asset_put', { content_id: contentId, kind, text });
    return (res && res.data) || {};
  }
  function assetErrText(err) {
    const code = err && err.code;
    if (isNotDeployedCode(code)) return '서버(GAS)에 자막·결과 저장 기능이 아직 없어요. 새 버전으로 배포하면 켜져요.';
    if (code === 'ERR_NO_CONFIG') return '연결 설정이 없어요. ⚙︎ 에서 GAS 주소와 토큰을 넣어 주세요.';
    return (err && err.message) || '알 수 없는 오류';
  }

  /* ── 오더 보내기 + 진행 상태 (④ ⑤ ⑥ 공통) ──
   *  opts: { sendText, compute(): { built(payload 만든 결과), ready(선행 조건), blockedText }, onDone, afterSend(d, payload) }
   *  compute 는 입력이 바뀔 때마다·보내는 순간마다 다시 부른다 — 화면에서 값을 고쳐도 보내는 내용이 낡지 않게.
   *  반환: 단계 본문에 붙일 노드 배열 */
  const ORDER_LABEL = { render: '렌더', order_tr: '자막 초안', order_fin: '마무리' };
  function orderBlock(key, opts) {
    stopPoll();
    if (poll.key !== key) { poll.live = null; poll.halted = ''; poll.fails = 0; }   // 다른 단계의 진행 상태를 이 단계 것으로 읽지 않게
    poll.key = key;
    poll.statusHost = null;
    poll.onDone = opts.onDone || null;
    let cur = opts.compute();
    const isSendable = (c) => !!(c && c.ready && c.built && c.built.ok);

    const sendBtn = h('button', { class: 'btn primary', type: 'button', text: opts.sendText });
    const copyBtn = h('button', { class: 'btn sm', type: 'button', text: '오더 내용 복사' });
    const banner = h('div', { class: 'pr-banner-host', role: 'status' });
    const warnHost = h('div', { class: 'pr-warn-host' });
    const preEl = h('pre', { class: 'pr-pre', text: '' });
    const showBanner = (kind, title, text) => {
      banner.replaceChildren(h('div', { class: 'pr-banner ' + kind }, h('strong', { text: title + ' ' }), h('span', { text })));
    };
    if (key === 'render' && renderWarn) showBanner('warn', renderWarn.title, renderWarn.text);

    function refresh() {
      cur = opts.compute();
      const ok = isSendable(cur);
      if (ok) { sendBtn.removeAttribute('disabled'); copyBtn.removeAttribute('disabled'); } else { sendBtn.setAttribute('disabled', ''); copyBtn.setAttribute('disabled', ''); }
      if (!cur.ready && cur.blockedText) warnHost.replaceChildren(h('div', { class: 'pr-warnbox' }, h('strong', { text: '먼저 — ' }), h('span', { text: cur.blockedText })));
      else if (cur.built && !cur.built.ok) warnHost.replaceChildren(h('div', { class: 'pr-warnbox' }, h('strong', { text: '확인해 주세요 — ' }), h('span', { text: cur.built.errors[0] })));
      else warnHost.replaceChildren();
      preEl.textContent = ok ? JSON.stringify(cur.built.payload, null, 2) : '';
    }
    poll.refresh = refresh;
    refresh();

    sendBtn.addEventListener('click', async () => {
      refresh();                                   // 보내는 순간의 값으로 다시 만든다
      if (!isSendable(cur)) return;
      const payload = cur.built.payload;
      sendBtn.setAttribute('disabled', '');
      sendBtn.textContent = '보내는 중…';
      banner.replaceChildren();
      if (key === 'render') renderWarn = null;
      try {
        const res = await api.post('hub_order', Object.assign({ type: 'content_render' }, payload));
        const d = (res && res.data) || {};
        change((s) => {
          s[key] = {
            order_id: String(d.order_id || ''), status: String(d.status || ''), sent_at: new Date().toISOString(),
            needs_approval: d.needs_approval === true, approval_expires_at: String(d.approval_expires_at || ''),
            note: String(d.note || '')
          };
          if (key === 'render') {
            s.render.report = null;
            // 클린 마스터를 다시 만들면 예전에 확정한 자막·마무리 결과는 새 영상과 시간이 어긋날 수 있다 → 다시 확인받는다
            if (s.srt && s.srt.confirmed) { s.srt.confirmed = false; s.srt.stale = true; }
            s.fin_report = null;
          }
        });
        delete poll.done[key];
        if (opts.afterSend) opts.afterSend(d, payload);
        toast(ORDER_LABEL[key] + ' 오더를 보냈어요', 'ok');
        poll.fails = 0; poll.halted = ''; poll.live = null;
        paintList();
      } catch (err) {
        const code = err && err.code;
        if (code === 'ERR_QUEUE_TYPE_UNKNOWN') {
          showBanner('warn', '노트북 큐가 아직 영상 렌더를 몰라요.',
            '큐(Apps Script) 새 버전 배포가 먼저 필요해요. 오더는 만들어지지 않았어요. 배포 뒤 다시 눌러 주세요.');
        } else if (code === 'ERR_VALIDATION_FAILED' || code === 'bad_request') {
          showBanner('err', '입력을 확인해 주세요.', (err && err.message) || '');
        } else if (code === 'ERR_NO_CONFIG') {
          showBanner('err', '연결이 안 돼 있어요.', 'GAS 주소·토큰을 먼저 설정해 주세요.');
        } else {
          showBanner('err', '오더를 보내지 못했어요.', ((err && err.message) || '알 수 없는 오류') + ' — 잠시 뒤 다시 눌러 주세요.');
        }
        sendBtn.textContent = opts.sendText;
        refresh();
      }
    });
    copyBtn.addEventListener('click', () => { refresh(); copyText(isSendable(cur) ? JSON.stringify(Object.assign({ type: 'content_render' }, cur.built.payload), null, 2) : '', '오더 내용을 복사했어요'); });

    const nodes = [
      warnHost,
      h('div', { class: 'pr-row' }, sendBtn, copyBtn),
      note('위험 작업이라 승인 카드가 뜨고, 15분 안에 승인해야 실행돼요. 승인은 포털 오더함에서 하고, 진행 상태는 이 화면이 15초마다 알려 줘요.'),
      banner,
      h('details', { class: 'pr-det' }, h('summary', { text: '보낼 내용 보기' }), preEl)
    ];

    const r = state[key];
    if (r && r.order_id) {
      nodes.push(h('dl', { class: 'kv pr-kv' },
        h('dt', { text: '오더 번호' }), h('dd', { text: r.order_id }),
        h('dt', { text: '접수 상태' }), h('dd', { text: orderStatusLabel(r.status) + (r.needs_approval && String(r.status).toUpperCase() === 'WAITING_APPROVAL' ? ' · 포털 오더함에서 승인해 주세요' : '') }),
        h('dt', { text: '보낸 때' }), h('dd', { text: r.sent_at ? new Date(r.sent_at).toLocaleString('ko-KR') : '-' }),
        r.approval_expires_at ? h('dt', { text: '승인 기한' }) : null,
        r.approval_expires_at ? h('dd', { text: new Date(r.approval_expires_at).toLocaleString('ko-KR') }) : null));
      if (r.note && !r.needs_approval) nodes.push(note(r.note));
      poll.statusHost = h('div', { class: 'pr-live', role: 'status', 'aria-live': 'polite' });
      nodes.push(poll.statusHost);
      paintOrderStatus();
      if (!poll.vis) { document.addEventListener('visibilitychange', onVisible); poll.vis = true; }
      if (!isTerminalStatus(currentStatus()) && !poll.halted) schedulePoll(400);   // 열자마자 한 번 확인하고, 이후 15초 간격
      else maybeDone();
    }
    return nodes;
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
      note('첫 문장(훅)을 채점하고 대본 뼈대를 만드는 건 숏폼 작업실에서 해요. 커버 문구와 첫 2초 자막의 숫자를 먼저 맞춰 둡니다.'),
      h('div', { class: 'pr-row' }, goSeries('studio', '숏폼 작업실 열기 (첫 문장 점검 · 대본)')),
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
        paintStates();
      }
    });
    const clearBtn = h('button', {
      class: 'btn sm', type: 'button', text: '목록 지우기',
      onclick: () => { change((s) => { s.cut_list = []; s.cuts = false; }); cutMem.srcLen = null; msg.textContent = ''; paintCuts(); paintStates(); }
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

  /* ── ④ 내 육성 녹음(2026-11-23) — 통녹음 1파일을 올려 TTS 대신 내 목소리로 ──
   *  3단계: ① 방식 고르기 → ② 카드 복사해서 폰으로 → ③ 파일 고르기(즉시 조각 업로드) → 미리듣기/다시 올리기.
   *  TTS 를 고른 지금 화면은 글자 하나 바뀌지 않는다(라디오만 추가). */
  const voiceUp = { busy: false, msg: '', kind: '', pct: 0, previewUrl: '', duration: null };

  function voicePanel(narN, capN) {
    const card = buildRecordingCard({ contentId, brand, narration: cardNarration });
    const cardHost = h('div', { class: 'pr-cardbox', style: 'display:none' });
    const cardBtn = h('button', {
      class: 'btn sm', type: 'button', text: '녹음 카드 보기',
      onclick: () => {
        if (!card.ok) { toast(card.error, 'err'); return; }
        cardHost.style.display = cardHost.style.display === 'none' ? '' : 'none';
        if (cardHost.style.display === '' && !cardHost.childElementCount) {
          cardHost.append(...card.parts.map((p, i) => h('div', { class: 'pr-field' },
            h('span', { class: 'pr-label', text: card.parts.length > 1 ? '파트 ' + p.no + ' (' + p.from + '~' + p.to + '번)' : '카드 전문' }),
            h('pre', { class: 'pr-card', text: p.text }))));
        }
      }
    });
    const copyBtn = h('button', {
      class: 'btn sm', type: 'button', text: '카드 복사',
      onclick: () => { if (!card.ok) { toast(card.error, 'err'); return; } copyText(card.text, () => toast('녹음 카드를 복사했어요 — 폰으로 붙여넣고 읽어 주세요', 'ok')); }
    });

    const fileIn = h('input', { type: 'file', accept: '.m4a,.mp3,.wav,audio/mp4,audio/mpeg,audio/wav', class: 'pr-file', 'aria-label': '녹음 파일 고르기' });
    const barIn = h('div', { class: 'pr-bar-in', style: 'width:0%' });
    const bar = h('div', { class: 'pr-bar', role: 'img', 'aria-label': '녹음 올리는 중', style: 'display:none' }, barIn);
    const line = h('div', { class: 'pr-upline', role: 'status', 'aria-live': 'polite' });
    const preview = h('audio', { controls: '', preload: 'none', style: 'width:100%;margin-top:6px' });
    const setLine = (text, kind) => { line.textContent = text; line.className = 'pr-upline' + (kind ? ' ' + kind : ''); };
    const meta = state.voice_meta || null;
    const gap = meta && meta.duration_s ? voiceLengthGap(card.seconds, meta.duration_s) : null;
    const info = [];
    if (state.voice_file) {
      info.push(h('div', { class: 'pr-uprow' },
        h('div', { class: 'pr-upinfo' },
          h('strong', { text: state.voice_file }),
          h('span', { class: 'pr-sub', text: (meta && meta.bytes ? formatBytes(meta.bytes) + ' · ' : '') + (meta && meta.duration_s ? meta.duration_s.toFixed(1) + '초' : '길이 모름') })),
        h('div', { class: 'pr-row' }, h('button', { class: 'btn sm', type: 'button', text: '다시 올리기', onclick: () => fileIn.click() }))));
      if (voiceUp.previewUrl) preview.src = voiceUp.previewUrl;
      else preview.style.display = 'none';
      info.push(preview);
      if (gap) {
        info.push(h('span', { class: 'pr-check-s', text: '대본 ' + gap.script_s.toFixed(1) + '초 · 녹음 ' + gap.voice_s.toFixed(1) + '초(' + (gap.pct >= 0 ? '+' : '') + gap.pct + '%)' +
          (gap.long ? ' — 20% 넘게 길어요. 빠르게 다시 읽거나 컷을 줄이는 게 좋아요(노트북이 1.15배까지만 당겨요).' : ' — 길이가 맞습니다.') }));
      }
    }
    const offset = h('input', { class: 'pr-in', type: 'number', min: '-3000', max: '3000', step: '100', value: String(state.voice_offset_ms || 0), 'aria-label': '녹음 앞 자를 길이(ms)',
      onchange: (e) => { const v = Math.round(Number(e.target.value) || 0); change((s) => { s.voice_offset_ms = Math.max(-3000, Math.min(3000, v)); }); } });

    fileIn.addEventListener('change', async () => {
      const f = (fileIn.files || [])[0];
      fileIn.value = '';
      if (!f || voiceUp.busy) return;
      const chk = checkVoiceFile({ name: f.name, size: f.size }, contentId);
      if (!chk.ok) { setLine(chk.errors[0], 'err'); return; }
      if (chk.warnings.length) setLine(chk.warnings[0], '');
      // 길이를 먼저 잡는다(미리듣기와 '대본 vs 녹음' 대조에 쓴다) — 실패해도 올리기는 계속
      voiceUp.duration = null;
      let url = '';
      try {
        url = URL.createObjectURL(f);
        voiceUp.duration = await new Promise((resolve) => {
          const a = new Audio();
          const done = (v) => resolve(Number.isFinite(v) && v > 0 ? Math.round(v * 10) / 10 : null);
          a.addEventListener('loadedmetadata', () => done(a.duration));
          a.addEventListener('error', () => resolve(null));
          setTimeout(() => resolve(null), 4000);
          a.src = url;
        });
      } catch (e) { /* 길이를 몰라도 올린다 */ }
      if (voiceUp.duration && voiceUp.duration > VOICE_LONG_WARN_S && !window.confirm('녹음이 ' + Math.round(voiceUp.duration) + '초예요. 쇼츠 내레이션은 보통 20~45초입니다. 이대로 올릴까요?')) {
        if (url) URL.revokeObjectURL(url);
        return;
      }
      voiceUp.busy = true; fileIn.setAttribute('disabled', '');
      bar.style.display = ''; barIn.style.width = '0%';
      setLine(chk.name + ' — 올리는 중…', '');
      try {
        await uploadVoice({
          api, contentId, file: f,
          onProgress: (p) => { barIn.style.width = Math.round((p.sent / p.total) * 100) + '%'; setLine(chk.name + ' — ' + p.index + '/' + p.parts + '조각 · ' + formatBytes(p.sent) + ' / ' + formatBytes(p.total), ''); }
        });
        if (voiceUp.previewUrl) URL.revokeObjectURL(voiceUp.previewUrl);
        voiceUp.previewUrl = url || '';
        change((s) => {
          s.voice_file = chk.name;
          s.voice_meta = { duration_s: voiceUp.duration, bytes: f.size, uploaded_at: new Date().toISOString() };
          s.voice_mode = 'human';
        });
        toast('녹음을 올렸어요 — ④ 오더를 보내면 이 목소리로 만들어요', 'ok');
      } catch (err) {
        if (url) URL.revokeObjectURL(url);
        const code = err && err.code;
        const text = isNotDeployedCode(code) ? '서버(GAS)에 녹음 올리기(voice_put)가 아직 없어요 — Bgm.gs 를 새 버전으로 배포하면 켜져요.'
          : (code === 'ERR_PAYLOAD_TOO_LARGE' ? '서버가 조각을 너무 크다고 거절했어요(GAS 재배포 확인).' : ((err && err.message) || '올리지 못했어요'));
        setLine(text, 'err');
      } finally {
        voiceUp.busy = false; fileIn.removeAttribute('disabled'); bar.style.display = 'none';
        paintList();
      }
    });

    // 3갈래 — 없음 / AI TTS / 내 목소리. 예전의 '내레이션(TTS) 넣기' 체크박스를 이 하나로 합쳤다(같은 state.narrate).
    const mode = state.voice_mode === 'human' ? 'human' : (state.narrate ? 'tts' : 'none');
    const pick = (v) => {
      change((s) => {
        s.voice_mode = v === 'human' ? 'human' : 'tts';
        s.narrate = v !== 'none';
      });
      paintList();   // 방식을 바꾸면 아래 내용(녹음 패널·안내)이 바로 바뀌어야 한다 — 입력 칸이 아니라서 잃을 커서가 없다
    };
    return h('div', { class: 'pr-field' },
      h('span', { class: 'pr-label', text: '내레이션' }),
      h('div', { class: 'pr-row', role: 'radiogroup', 'aria-label': '내레이션' },
        h('label', { class: 'pr-radio' }, h('input', { type: 'radio', name: 'voice-mode-' + contentId, value: 'none', checked: mode === 'none' ? '' : null, onchange: () => pick('none') }), h('span', { text: '없음' })),
        h('label', { class: 'pr-radio' }, h('input', { type: 'radio', name: 'voice-mode-' + contentId, value: 'tts', checked: mode === 'tts' ? '' : null, onchange: () => pick('tts') }), h('span', { text: 'AI TTS 목소리' })),
        h('label', { class: 'pr-radio' }, h('input', { type: 'radio', name: 'voice-mode-' + contentId, value: 'human', checked: mode === 'human' ? '' : null, onchange: () => pick('human') }), h('span', { text: '내 목소리(녹음)' }))),
      h('span', { class: 'pr-check-s', text: mode === 'human'
        ? '카드의 문장을 폰으로 읽어 통녹음 1파일(.m4a)로 올려요. 노트북이 잡음을 정리하고 대본에 맞춰 자막·큐 시각을 다시 계산해요.'
        : (mode === 'tts' ? (narN ? '카드 내레이션 ' + narN + '큐(톤 hype/calm) · 현장음 -15dB 덕킹 — 지금과 같아요.' : (capN ? '내레이션 대본이 없어 자막 문장을 차분하게 읽어요.' : '자막도 내레이션도 없어 켜도 효과가 없어요.')) : '내레이션은 넣지 않아요(자막만).')}),
      state.voice_mode === 'human' ? h('div', { class: 'pr-subbox' },
        h('div', { class: 'pr-row' }, cardBtn, copyBtn),
        cardHost,
        fileIn, bar, line,
        ...info,
        h('label', { class: 'pr-field' }, h('span', { class: 'pr-label', text: '녹음 앞 자를 길이(ms · 잡담·대기 제거 · +면 앞을 잘라요)' }), offset),
        check('실패하면 TTS 로 대신 넣기', state.voice_fallback_tts === true, (v) => change((s) => { s.voice_fallback_tts = v; }),
          '끄면 실패 시 오더가 반려되고 어느 큐가 어긋났는지 알려 줘요(권장). 켜면 실패한 것만 TTS 로 대신 넣어요.'),
        h('span', { class: 'pr-check-s', text: '자막은 AI 가 만든 대본을 씁니다 — 마무리에서 "AI 자막 보조"는 그대로 켜 둡니다.' }),
        h('span', { class: 'pr-check-s', text: '발행 표시: 음성은 내 목소리(육성)라 AI 가 아니에요 — 인스타 AI 표기는 끄고, 네이버 클립만 "AI 활용"을 켜요(유튜브는 그대로 아니요).' })
      ) : null);
  }

  /** 단계 라벨만 갱신(입력 중인 칸을 지키려고 목록 전체를 다시 그리지 않는다) */

  /* ── ④ 클린 마스터 ── */
  /** 질문형 훅 상태 한 줄(막지 않고 이유만) — 10편 중 7편 질문형, '?'로 끝나는 8~11자. */
  function hookLine(st) {
    const c = checkHookForm(st.hook);
    const sub = String(st.hook_sub || '').trim();
    const parts = [];
    if (c.form === 'question') parts.push('질문형 ' + c.chars + '자' + (c.ok ? ' ✓' : ''));
    else if (c.form === 'statement') parts.push('단언형 — ' + HOOK_QUESTION.cycle + '편 중 ' + Math.round(HOOK_QUESTION.cycle * HOOK_QUESTION.ratio) + '편은 질문형이 좋아요');
    else parts.push('훅을 넣으면 첫 1초를 글자로 잠급니다');
    if (c.form === 'question' && !c.ok && c.warnings.length) parts.push(c.warnings[0]);
    parts.push(sub ? '보조 "' + sub + '" ' + sub.length + '/6자' : '보조 글자를 비우면 질문만 나갑니다');
    return h('span', { class: 'pr-check-s', text: parts.join(' · ') });
  }

  function bodyRender(box) {
    const cutRes = cutsForOrder(state, state.inputs);
    // 완제품 옵션 — 카드에 저장된 자막·내레이션을 오더에 실어 노트북이 번인·TTS·덕킹까지 마친다.
    const capRes = normalizeCues(cardCaptions, '자막');
    const narRes = normalizeCues(cardNarration, '내레이션', { tones: ['hype', 'calm'] });
    const buildNow = () => {
      const cr = cutsForOrder(state, state.inputs);
      const human = state.voice_mode === 'human';
      const b = buildRenderPayload({
        contentId, brand, inputs: state.inputs, profile: state.profile, cropX: state.crop_x,
        cuts: cr.ok ? cr.cuts : undefined,
        captions: capRes.cues.length ? capRes.cues : undefined,
        narration: (human || state.narrate) ? (narRes.cues.length ? narRes.cues : undefined) : undefined,
        burnSubtitles: state.burn, subStyle: state.sub_style,
        narrate: !human && state.narrate && !narRes.cues.length, voice: state.voice || undefined,
        voiceMode: state.voice_mode, voiceFile: state.voice_file, voiceOffsetMs: state.voice_offset_ms, voiceFallback: state.voice_fallback_tts,
        template: state.template, title: state.title, badge: state.badge, hook: state.hook, hookSub: state.hook_sub, outro: state.outro,
        hookPos: state.hook_pos, hookHold: state.hook_hold,
        frameLock: state.frame_lock, frameLockImage: state.frame_lock_image, frameLockSeconds: state.frame_lock_seconds,
        motion: state.motion, motionQuality: state.motion_quality
        , pace: state.pace
      });
      return { cr, b };
    };
    const built = buildNow().b;
    const p = PROFILES[state.profile];
    const cutSm = cutSummary(state.cut_list.filter((c) => c.on !== false), cutMem.srcLen);
    const capN = capRes.cues.length;
    const narN = narRes.cues.length;
    const willBurn = state.burn && (capN > 0 || (built.ok && built.payload.payload_source === 'drive'));
    const drive = built.ok && built.payload.payload_source === 'drive';
    const human = state.voice_mode === 'human';

    box.append(
      note('노트북이 ' + (cutRes.ok && cutRes.cuts.length ? '정해 둔 컷 ' + cutRes.cuts.length + '곳(약 ' + cutSm.seconds.toFixed(1) + '초)을 먼저 잘라내고, ' : '') + '영상을 9:16(1080×1920)·30fps로 맞추고 음량을 ' + p.lufs.toFixed(0) + ' LUFS로 평탄화해요. ' +
        (state.burn ? '카드에 저장된 자막을 구워 완제품(_final.mp4)까지 만들어요. ' : '자막은 굽지 않고 클린 마스터만 만들어요. ') +
        (human ? '내 목소리(육성)는 잡음 정리·대본 강제정렬을 거쳐 같은 자리에 얹고, 그 구간만큼 현장음을 -15dB 덕킹해요.' : (state.narrate ? '내레이션(TTS)은 그 구간만큼 현장음을 -15dB 덕킹해요.' : '내레이션은 넣지 않아요.'))),
      h('div', { class: 'pr-pipe' },
        ...['정보 읽기'].concat(cutRes.ok && cutRes.cuts.length ? ['컷 편집'] : [], ['이어붙이기', '9:16 맞춤'])
          .concat(human ? ['육성 정렬', '내레이션', '음량 2회 측정'] : (state.narrate ? ['내레이션', '음량 2회 측정'] : ['음량 2회 측정']))
          .concat(state.burn ? ['자막 굽기', '규격 검수'] : ['규격 검수'])
          .map((t, i) => h('span', { class: 'pr-pipe-i' }, h('b', { text: String(i + 1) }), t))));

    // 완제품 옵션 상자 — 몇 큐가 들어가는지·긴 영상이면 카드에서 읽는지 보여 준다
    box.append(h('div', { class: 'pr-field' },
      h('span', { class: 'pr-label', text: '완제품 옵션 (자막·내레이션)' }),
      check('자막을 구워서 완제품으로', state.burn, (v) => change((s) => { s.burn = v; }),
        capN ? '카드 자막 ' + capN + '큐 · 1080×1920 기준 · 하단 안전선 안 · 2줄까지' : '카드에 자막이 없어요 — 구울 것이 없습니다'),
      voicePanel(narN, capN),
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

    // 채널 템플릿(2026-11-21) — 상단 뱃지·2줄 제목·오프닝 훅·아웃트로. ASS 한 장에 자막과 함께 굽는다.
    const tHint = templateHint(brand, state.template);
    const tInput = (key, label, ph, max) => h('label', { class: 'pr-field' },
      h('span', { class: 'pr-label', text: label }),
      h('input', { class: 'pr-in', type: 'text', maxlength: String(max), 'aria-label': label,
        value: state[key] || '', placeholder: ph || '',
        oninput: (e) => { const v = e.target.value; change((st) => { st[key] = v; }); } }));
    const hookPosShown = state.hook_pos || DEFAULT_HOOK_POS;
    const hookHoldShown = typeof state.hook_hold === 'number' ? state.hook_hold : DEFAULT_HOOK_HOLD;
    const tState = state.template === 'none'
      ? '템플릿 없이 자막만 굽습니다(예전 동작).'
      : ('트랙 기본값 — 뱃지 ' + (tHint && tHint.badge ? tHint.badge : '대전 청년') + ' · 아웃트로 ' + (tHint && tHint.outro ? tHint.outro : '다음 코스는? 구독') + '. 비운 칸은 기본값을 써요.');
    box.append(h('div', { class: 'pr-field' },
      h('span', { class: 'pr-label', text: '채널 템플릿 (뱃지 · 2줄 제목 · 오프닝 훅 · 아웃트로)' }),
      h('select', { class: 'pr-sel', 'aria-label': '채널 템플릿',
        onchange: (e) => change((st) => { st.template = e.target.value; }) },
        ...TEMPLATE_IDS.map((id) => h('option', { value: id, selected: state.template === id ? '' : null, text: TEMPLATE_LABELS[id] }))),
      h('div', { class: 'pr-two' },
        tInput('title', '2줄 임팩트 제목 (한 줄 10자)', tHint && tHint.title ? tHint.title : '예: 천장에 매달린 건', 40),
        tInput('badge', '카테고리 뱃지', tHint && tHint.badge ? tHint.badge : '예: 제주 · 서커스', 14)),
      h('div', { class: 'pr-two' },
        tInput('hook', '오프닝 훅 (0~' + hookHoldShown + '초 · 화면 ' + (hookPosShown === 'top' ? '상단' : '중앙') + ') · 질문형', tHint && tHint.hook ? tHint.hook : '예: 이 가격 실화냐?', 16),
        tInput('outro', '아웃트로 (마지막 1초)', tHint && tHint.outro ? tHint.outro : '예: 다음 코스는? 구독', 24)),
      // 무음 보조 글자 — 질문 바로 아래 6자. 소리를 꺼도 첫 1초에 결과 예고가 읽힌다.
      tInput('hook_sub', '무음 보조 글자 (질문 아래 6자)', tHint && tHint.hook_sub ? tHint.hook_sub : '예: 끝까지 보셈', 6),
      hookLine(state),
      state.template === 'none' ? null : h('div', { class: 'pr-two' },
        h('label', { class: 'pr-field' }, h('span', { class: 'pr-label', text: '훅 위치' }),
          h('select', { class: 'pr-sel', 'aria-label': '훅 위치', onchange: (e) => change((st) => { st.hook_pos = e.target.value; }) },
            ...HOOK_POSITIONS.map((p) => h('option', { value: p.id, selected: hookPosShown === p.id ? '' : null, text: p.label })))),
        h('label', { class: 'pr-field' }, h('span', { class: 'pr-label', text: '훅 유지' }),
          h('select', { class: 'pr-sel', 'aria-label': '훅 유지시간', onchange: (e) => change((st) => { st.hook_hold = Number(e.target.value); }) },
            ...HOOK_HOLDS.map((v) => h('option', { value: String(v), selected: hookHoldShown === v ? '' : null, text: v.toFixed(1) + '초' }))))),
      h('span', { class: 'pr-check-s', text: tState })));

    // 첫 프레임 잠금(2026-11-21) — AI 클립을 이어 붙일 때 얼굴·장면이 흔들리는 것을 막는다.
    //   기준 사진을 '참고'가 아니라 0.0초 첫 프레임으로 박고, 앞 클립 마지막 프레임을 다음 클립 첫 프레임으로 잇는다.
    const lockSec = typeof state.frame_lock_seconds === 'number' ? state.frame_lock_seconds : 0.04;
    box.append(h('div', { class: 'pr-field' },
      h('span', { class: 'pr-label', text: '첫 프레임 잠금 (AI 클립 이어 붙이기)' }),
      check('첫 프레임을 잠그기', state.frame_lock === true, (v) => change((st) => { st.frame_lock = v; }),
        '기준 사진을 0.0초 첫 프레임으로 박고, 둘째 클립부터는 앞 클립 마지막 프레임으로 이어 붙여요. 클립마다 재인코딩이 한 번 더 들어가요(컷당 2초 안쪽)'),
      state.frame_lock === true ? h('div', { class: 'pr-two' },
        tInput('frame_lock_image', '기준 사진 파일 이름 (inbox · 비우면 잇기만)', '예: mary_front.jpg', 80),
        h('label', { class: 'pr-field' }, h('span', { class: 'pr-label', text: '정지 길이(1프레임=0.04초)' }),
          h('select', { class: 'pr-sel', 'aria-label': '첫 프레임 정지 길이', onchange: (e) => change((st) => { st.frame_lock_seconds = Number(e.target.value); }) },
            ...[0.04, 0.1, 0.2, 0.5].map((v) => h('option', { value: String(v), selected: Math.abs(lockSec - v) < 0.001 ? '' : null, text: v.toFixed(2) + '초' }))))) : null,
      h('span', { class: 'pr-check-s', text: state.frame_lock === true
        ? '잠갔는데 0.0초에 보일 훅이 없으면 소용없어요 — 오프닝 훅이나 보조 글자를 같이 넣어 주세요.'
        : '여러 AI 클립을 이어 붙일 때만 켜세요. 일반 촬영본 한 개면 켜지 않아도 돼요.' })));

    // 자동 줌·모션(2026-11-21) — 영상을 준 그대로 쓰지 않고 클립마다 줌인/줌아웃을 번갈아 넣고 훅 끝에 펀치(점프컷).
    //   세로 변환 패스에 융합하므로 재인코딩 횟수는 그대로(fit·번인 2회). 기본 auto — 끄려면 '끔'.
    box.append(h('div', { class: 'pr-field' },
      h('span', { class: 'pr-label', text: '자동 줌·모션' }),
      h('select', { class: 'pr-sel', 'aria-label': '자동 줌·모션', onchange: (e) => change((st) => { st.motion = e.target.value; }) },
        ...MOTION_IDS.map((id) => h('option', { value: id, selected: state.motion === id ? '' : null, text: MOTION_LABELS[id] }))),
      h('span', { class: 'pr-check-s', text: state.motion === 'none'
        ? '모션 없이 지금과 똑같이 자르기만 해요(원본 그대로).'
        : '3초 이상 클립에 줌인·줌아웃을 번갈아 넣고, 훅 끝에 펀치줌 1회. 1080p 가로 원본은 최대 1.12배.' })));

    // 템포(2026-11-23) — 성래 님 v5 지적 "긴박함도 없다". 컷 리듬·자막 표시·TTS 속도·모션·블러 여백을 한 번에 바꾼다.
    box.append(h('div', { class: 'pr-field' },
      h('span', { class: 'pr-label', text: '템포 (숏폼 긴박함)' }),
      h('select', { class: 'pr-sel', 'aria-label': '템포', onchange: (e) => change((st) => { st.pace = e.target.value; }) },
        ...PACE_IDS.map((id) => h('option', { value: id, selected: state.pace === id ? '' : null, text: PACE_LABELS[id] }))),
      h('span', { class: 'pr-check-s', text: (PACE_NOTES[state.pace] || '') + (state.pace === 'fast' ? ' 컷 목록도 1~1.8초로 짧게 잡아야 긴박해져요.' : '') })));

    box.append(...orderBlock('render', {
      sendText: '노트북에 렌더 오더 보내기',
      compute: () => {
        const { cr, b } = buildNow();
        let blocked = '';
        if (!b.ok) blocked = '① 재료부터 채워 주세요 — ' + b.errors[0];
        else if (!cr.ok) blocked = '③ 컷 목록을 확인해 주세요 — ' + cr.error;
        else if (state.voice_mode === 'human' && !narRes.cues.length) blocked = '내 목소리로 만들려면 카드에 내레이션 대본이 있어야 해요 — 기획에서 대본을 먼저 만들어 주세요.';
        return { built: b, ready: b.ok && cr.ok, blockedText: blocked };
      },
      afterSend: (d, payload) => {
        const sentCuts = payload.cuts ? payload.cuts.length : 0;
        if (sentCuts && Number(d.cuts) !== sentCuts) {
          renderWarn = { title: '서버(GAS)가 컷을 아직 몰라요.', text: '컷 ' + sentCuts + '곳이 오더에 실리지 않았어요. 이대로 승인하면 자르지 않은 영상이 만들어져요 — 포털 오더함에서 거절하고, GAS 를 새 버전으로 배포한 뒤 다시 보내 주세요.' };
        } else if (!drive && capN > 0 && Number(d.captions) !== capN) {
          renderWarn = { title: '서버(GAS)가 자막을 아직 몰라요.', text: '자막 ' + capN + '큐가 오더에 실리지 않았어요. 이대로 승인하면 자막 없는 클린 마스터만 나와요 — 포털 오더함에서 거절하고, GAS 를 새 버전으로 배포한 뒤 다시 보내 주세요.' };
        } else if (payload.pace && d.pace !== payload.pace) {
          renderWarn = { title: '서버(GAS)가 템포를 아직 몰라요.', text: '고른 템포(' + payload.pace + ')가 오더에 실리지 않아 기본 템포로 렌더돼요 — 포털 오더함에서 거절하고, GAS 를 새 버전으로 배포한 뒤 다시 보내 주세요.' };
        }
      },
      onDone: async () => {
        // 노트북이 올려 둔 결과(report)를 가져와 규격 대조 표를 자동으로 채운다(붙여넣기는 실패했을 때를 위한 대비)
        try {
          const a = await getAsset('report_clean');
          if (!a.exists) return;
          if (!reportIsFresh(a.text, state.render && state.render.sent_at)) {
            if (wrap.isConnected) toast('노트북이 이번 결과를 허브에 올리지 못했어요(예전 결과만 있어요) — 포털 오더함의 결과를 아래에 붙여 넣어 주세요', 'err');
            return;
          }
          const parsed = parseReport(a.text);
          if (!parsed.ok || !wrap.isConnected) return;
          change((s) => { s.render = Object.assign({ order_id: '', status: '', sent_at: '', needs_approval: false, approval_expires_at: '', note: '' }, s.render || {}, { report: parsed.report }); });
          if (openStep === 'render') paintList();
        } catch (err) { if (wrap.isConnected) toast('결과를 자동으로 가져오지 못했어요 — ' + assetErrText(err) + ' 아래에 붙여 넣어도 돼요', 'err'); }
      }
    }));

    const r = state.render;
    /* 결과 붙여넣기 → 표 (자동으로 안 왔을 때 대비) */
    const rep = h('textarea', { class: 'pr-ta', rows: '4', spellcheck: 'false', placeholder: '(자동으로 안 보이면) 포털 오더함의 결과(report.json)를 붙여 넣어요', 'aria-label': '렌더 결과 report' });
    const repErr = h('div', { class: 'pr-err', role: 'alert' });
    const repBtn = h('button', { class: 'btn sm', type: 'button', text: '결과 표로 보기' });
    repBtn.addEventListener('click', () => {
      const parsed = parseReport(rep.value.trim());
      if (!parsed.ok) { repErr.textContent = parsed.error; return; }
      repErr.textContent = '';
      change((s) => { s.render = Object.assign({ order_id: '', status: '', sent_at: '', needs_approval: false, approval_expires_at: '', note: '' }, s.render || {}, { report: parsed.report }); });
      paintList();
    });
    if (!(r && r.report)) {
      box.append(
        h('details', { class: 'pr-det' }, h('summary', { text: '결과를 직접 붙여 넣기' }),
          h('label', { class: 'pr-field' }, h('span', { class: 'pr-label', text: '렌더 결과' }), rep), repErr, h('div', { class: 'pr-row' }, repBtn)));
    }

    if (r && r.report) {
      const std = compareStandard(r.report, state.profile);
      box.appendChild(h('h4', { class: 'pr-h4', text: '표준 v3 표1 대조 (화면이 다시 계산)' }));
      box.appendChild(resultTable(std.map((x) => ({ name: x.label, status: x.status, msg: x.msg }))));
      if (r.report.checks.length) {
        box.appendChild(h('h4', { class: 'pr-h4', text: '노트북 검수 항목' }));
        box.appendChild(resultTable(r.report.checks.map((x) => ({ name: x.id || '-', status: x.status, msg: x.msg }))));
      }
      if (r.report.cuts && r.report.cuts.applied) box.appendChild(note('컷 ' + r.report.cuts.applied + '곳 · ' + r.report.cuts.removed_seconds + '초를 잘랐어요.'));
      // 내 육성 녹음 결과(2026-11-23) — 썼는지·얼마나 잘 맞았는지·어느 큐가 어긋났는지
      const vr = r.report.voice;
      if (vr && vr.mode === 'human') {
        box.appendChild(h('h4', { class: 'pr-h4', text: '내 육성 녹음' }));
        box.appendChild(note(vr.used
          ? '내 목소리로 넣었어요 · 큐 ' + vr.cues + '개 · 평균 정렬 ' + (vr.score_avg === null ? '-' : vr.score_avg) +
            (vr.drift_ms_max === null ? '' : ' · 밀림 최대 ' + vr.drift_ms_max + 'ms') +
            (vr.snr_db === null ? '' : ' · 잡음 ' + vr.snr_db + 'dB') +
            (vr.tempo ? ' · ' + vr.tempo + '배로 당김' : '')
          : '내 목소리를 넣지 못했어요 — ' + (vr.error || vr.fallback_reason || '이유를 모름') + (vr.fallback_reason ? ' (TTS 로 대신 넣었어요)' : '')));
        if (vr.mismatch && vr.mismatch.length) box.appendChild(note('대본과 어긋난 큐: ' + vr.mismatch.map((i) => '#' + String(i + 1).padStart(2, '0')).join(' · ') + ' — 그 문장만 다시 녹음하면 돼요.'));
        if (vr.notes && vr.notes.length) vr.notes.forEach((t) => box.appendChild(note(t)));
      } else if (state.voice_mode === 'human') {
        box.appendChild(note('내 목소리를 골랐는데 결과는 TTS 로 나왔어요 — 서버(GAS)가 육성 녹음을 아직 모를 수 있어요. Bgm.gs 를 새 버전으로 배포한 뒤 다시 보내 주세요.'));
      }
      if (r.report.out) box.appendChild(note('결과 파일: ' + r.report.out + ' (노트북 out/' + contentId + '/)'));
      box.appendChild(resultFiles());
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

  /* ── ⑤ 자막 — AI 초안 → 사람 확정 ──
   *  Whisper 는 무음에서 문구를 지어내고 상호·메뉴·가격을 그럴듯하게 틀린다. 그래서 초안은 '초안'일 뿐이고,
   *  사람이 영상과 대조해 고친 뒤 [확정]을 눌러야 ⑥ 에서 굽는다. 규격 위반(FAIL)이 있으면 확정할 수 없다. */
  const srtMem = { id: '', text: '', draftText: '', meta: null, loaded: false, busy: false, msg: '' };

  async function loadSrt(preferDraft) {
    srtMem.busy = true; srtMem.msg = '';
    try {
      let text = null, from = '';
      if (!preferDraft) {
        const f = await getAsset('srt_final');
        if (f.exists && String(f.text || '').trim()) { text = f.text; from = '확정본'; }
      }
      const d = await getAsset('srt_draft');
      if (d.exists) srtMem.draftText = String(d.text || '');
      if (text === null && d.exists) { text = srtMem.draftText; from = 'AI 초안'; }
      try { const m = await getAsset('report_transcribe'); srtMem.meta = m.exists ? JSON.parse(m.text) : null; } catch (e) { srtMem.meta = null; }
      if (text !== null) { srtMem.text = text; srtMem.msg = from + '을 불러왔어요'; } else srtMem.msg = '아직 올라온 자막이 없어요 — 초안을 만들거나 직접 붙여 넣어요';
      srtMem.loaded = true;
    } catch (err) { srtMem.msg = '불러오지 못했어요 — ' + assetErrText(err); }
    srtMem.busy = false;
  }

  function bodySrt(box) {
    const st = stepStatus(state, brand);
    const cpl = finishOf(brand).cpl;
    if (srtMem.id !== contentId) { srtMem.id = contentId; srtMem.text = ''; srtMem.draftText = ''; srtMem.meta = null; srtMem.loaded = false; srtMem.msg = ''; }

    box.append(
      note('④ 클린 마스터의 말소리를 노트북이 Whisper 로 글자로 바꿔 자막 초안(SRT)을 만들어요. 표2 규격(한 줄 ' + cpl + '자·2줄·1.0~3.5초)에 맞춰 끊고, 말이 없는 구간에서 지어낸 문구는 빼서 따로 알려 줘요.'),
      h('div', { class: 'pr-warnbox' }, h('strong', { text: 'AI 초안은 틀려요. ' }),
        h('span', { text: '상호·메뉴·가격·숫자는 그럴듯하게 틀리는 대표 구간이에요. 영상을 보며 고친 뒤에만 확정할 수 있어요.' })),
      state.srt.stale && !state.srt.confirmed ? h('div', { class: 'pr-banner warn' }, h('strong', { text: '④를 다시 만들어서 확정이 풀렸어요. ' }),
        h('span', { text: '컷이 바뀌면 자막 시간이 어긋나요. 초안을 다시 만들거나 지금 영상에 맞게 고친 뒤 다시 확정해 주세요.' })) : '');
    box.append(...orderBlock('order_tr', {
      sendText: '자막 초안 만들기(노트북)',
      compute: () => ({ built: buildStagePayload('transcribe', { contentId, brand, state }), ready: stepStatus(state, brand).render, blockedText: '④ 클린 마스터를 먼저 완료해 주세요(초안은 그 영상의 말소리로 만들어요).' }),
      onDone: async () => {
        // 이미 확정했거나 고치던 중이면 그 내용을 AI 초안으로 덮지 않는다(초안·빼 둔 문구 목록만 새로 읽는다)
        const editing = String(srtMem.text || '').trim() && srtMem.text !== srtMem.draftText;
        if (state.srt.confirmed || editing) {
          const keep = srtMem.text;
          await loadSrt(false);
          if (String(keep || '').trim()) srtMem.text = keep;
        } else await loadSrt(true);
        if (wrap.isConnected && openStep === 'srt') paintList();
      }
    }));

    /* ── 편집기 ── */
    const ta = h('textarea', { class: 'pr-ta pr-srt', rows: '12', spellcheck: 'false', autocomplete: 'off', 'aria-label': '자막 SRT 편집', placeholder: '1\n00:00:01,000 --> 00:00:02,500\n안녕하세요\n\n(초안을 불러오거나 직접 붙여 넣어요)' });
    ta.value = srtMem.text;
    const msgLine = h('p', { class: 'hint', 'aria-live': 'polite', text: srtMem.msg });
    const anaHost = h('div', { class: 'pr-srt-ana', role: 'status', 'aria-live': 'polite' });
    const verify = h('input', { type: 'checkbox' });
    const aiBox = h('input', { type: 'checkbox' });
    aiBox.checked = state.srt.ai !== false;
    const confirmBtn = h('button', { class: 'btn primary', type: 'button', text: '이 자막으로 확정' });
    const confirmMsg = h('div', { class: 'pr-err', role: 'alert' });

    function analysis() { return analyzeSrt(ta.value, brand); }
    function paintAna() {
      const a = analysis();
      const rows = [];
      if (!String(ta.value).trim()) rows.push(h('p', { class: 'hint', text: '자막이 비어 있어요.' }));
      else {
        rows.push(h('div', { class: 'pr-banner' + (a.fail ? ' err' : (a.warn ? ' warn' : '')) },
          h('strong', { text: '자막 ' + a.cues.length + '개 · ' }),
          h('span', { text: a.fail ? '막힌 문제 ' + a.fail + '건(고쳐야 확정 가능)' : (a.warn ? '알림 ' + a.warn + '건(확정은 가능)' : '규격 문제 없음') })));
        const lines = a.errors.slice(0, 5).map((e) => h('li', { text: e.block + '번째 덩어리: ' + e.msg }))
          .concat(a.issues.slice(0, 12).map((i) => h('li', { class: i.level === 'FAIL' ? 'pr-i-fail' : '', text: i.cue + '번 · ' + (i.level === 'FAIL' ? '막힘 · ' : '알림 · ') + i.msg })));
        if (lines.length) rows.push(h('ul', { class: 'pr-issues' }, ...lines));
        if (a.issues.length + a.errors.length > 17) rows.push(note('…그 밖에 ' + (a.issues.length + a.errors.length - 17) + '건 더 있어요.'));
      }
      anaHost.replaceChildren(...rows);
      const okToConfirm = a.cues.length > 0 && a.fail === 0 && verify.checked;
      if (okToConfirm) confirmBtn.removeAttribute('disabled'); else confirmBtn.setAttribute('disabled', '');
      const confirmed = state.srt.confirmed && state.srt.hash === textHash(ta.value);
      confirmBtn.textContent = confirmed ? '확정됨 ✓ (다시 확정)' : '이 자막으로 확정';
      return a;
    }

    ta.addEventListener('input', () => {
      srtMem.text = ta.value;
      if (state.srt.confirmed && state.srt.hash !== textHash(ta.value)) {
        change((s) => { s.srt.confirmed = false; });
        confirmMsg.textContent = '고친 내용이 아직 확정되지 않았어요. 다시 [확정]을 눌러 주세요.';
      }
      paintAna();
    });
    verify.addEventListener('change', paintAna);

    confirmBtn.addEventListener('click', async () => {
      confirmMsg.textContent = '';
      const a = paintAna();
      if (!(a.cues.length > 0 && a.fail === 0 && verify.checked)) return;
      confirmBtn.setAttribute('disabled', '');
      confirmBtn.textContent = '저장 중…';
      try {
        const text = String(ta.value).replace(/\r\n?/g, '\n').trim() + '\n';
        await putAsset('srt_final', text);
        // ⑤ 의 'AI 초안을 바탕으로 했어요' 가 ⑥ 의 AI 안내 기본값이 된다(⑥ 에서 다시 바꿀 수 있다)
        change((s) => { s.srt = { confirmed: true, skipped: false, ai: aiBox.checked, hash: textHash(ta.value), cues: a.cues.length, at: new Date().toISOString() }; s.make.ai_notice = aiBox.checked; });
        toast('자막을 확정했어요(' + a.cues.length + '개)', 'ok');
        paintAna();
      } catch (err) {
        confirmMsg.textContent = '확정한 자막을 저장하지 못했어요 — ' + assetErrText(err);
        paintAna();
      }
    });

    const loadBtn = h('button', { class: 'btn sm', type: 'button', text: '허브에서 불러오기', onclick: async () => {
      loadBtn.setAttribute('disabled', '');
      await loadSrt(false);
      if (wrap.isConnected && openStep === 'srt') paintList();
    } });
    const draftBtn = h('button', { class: 'btn sm', type: 'button', text: 'AI 초안으로 되돌리기', onclick: () => {
      if (!srtMem.draftText) { toast('불러온 AI 초안이 없어요', 'err'); return; }
      if (String(ta.value).trim() && !window.confirm('지금 고친 내용이 사라져요. AI 초안으로 되돌릴까요?')) return;
      ta.value = srtMem.draftText; srtMem.text = ta.value; paintAna();
    } });
    const skipBtn = h('button', { class: 'btn sm', type: 'button', text: state.srt.skipped ? '자막 넣기로 되돌리기' : '자막 없이 진행', onclick: () => {
      if (state.srt.skipped) { change((s) => { s.srt.skipped = false; }); paintList(); return; }
      change((s) => { s.srt.skipped = true; s.srt.confirmed = false; s.make.burn = false; });
      toast('자막 없이 진행해요 — ⑥ 에서 자막을 굽지 않아요', 'ok');
      paintList();
    } });

    if (!srtMem.loaded && !srtMem.busy) {
      srtMem.busy = true;
      loadSrt(false).then(() => {
        if (!wrap.isConnected || openStep !== 'srt') return;
        if (!String(ta.value).trim() && srtMem.text) { ta.value = srtMem.text; msgLine.textContent = srtMem.msg; paintAna(); }
        else msgLine.textContent = srtMem.msg;
      });
    }

    const meta = srtMem.meta;
    const metaNodes = [];
    if (meta) {
      if (meta.speech_detected === false) metaNodes.push(h('div', { class: 'pr-warnbox' }, h('strong', { text: '말소리를 찾지 못했어요. ' }), h('span', { text: '없는 말을 지어내지 않았어요. 직접 자막을 넣거나 "자막 없이 진행"을 누르세요.' })));
      if (Array.isArray(meta.removed) && meta.removed.length) {
        metaNodes.push(h('details', { class: 'pr-det' }, h('summary', { text: '빼 둔 문구 ' + meta.removed.length + '개 (무음에서 지어낸 것으로 의심)' }),
          h('ul', { class: 'pr-issues' }, ...meta.removed.slice(0, 10).map((x) => h('li', { text: x.start + '~' + x.end + '초 · "' + x.text + '" — ' + x.reason })))));
      }
      if (Array.isArray(meta.notes) && meta.notes.length) metaNodes.push(note(meta.notes.slice(0, 3).join(' · ')));
    }

    box.append(
      h('div', { class: 'pr-row' }, loadBtn, draftBtn, skipBtn),
      msgLine,
      ...metaNodes,
      h('label', { class: 'pr-field' }, h('span', { class: 'pr-label', text: '자막(SRT) — 영상을 보며 고쳐요' }), ta),
      anaHost,
      check('상호·메뉴·가격·숫자를 영상과 대조해 고쳤어요', false, () => {}, '확인하지 못한 숫자는 [채우기]로 두고, 지어낸 가격·시간·웨이팅은 쓰지 않아요'),
      h('label', { class: 'pr-check' }, aiBox, h('span', null, h('span', { class: 'pr-check-t', text: 'AI 초안을 바탕으로 했어요 — 마지막 2초에 "AI 자막 보조" 안내를 넣어요' }),
        h('span', { class: 'pr-check-s', text: '네이버 클립은 AI 보조 사용 사실을 영상 안에 알려야 해요. 자막을 전부 직접 썼다면 끄세요.' }))),
      h('div', { class: 'pr-row' }, confirmBtn),
      confirmMsg,
      state.srt.skipped ? h('div', { class: 'pr-banner' }, h('strong', { text: '자막 없이 진행 중 ' }), h('span', { text: '⑥ 에서 자막을 굽지 않아요.' })) : '');
    // 확인 체크박스는 check() 가 만든 label 안의 input — 위 verify 와 이어 준다
    const vInput = box.querySelectorAll('.pr-check input')[0];
    if (vInput) { vInput.addEventListener('change', () => { verify.checked = vInput.checked; paintAna(); }); }
    paintAna();
  }


  /* ── 만든 파일 받기(④ 결과·⑥ 마무리) — gas/Result.gs ──
   *  노트북이 렌더 뒤에 최종 영상·커버를 허브(드라이브 비공개 폴더)에 올려 둔다. 여기서 2MB 조각을 받아 브라우저에서 이어 붙인다. */
  const resultMem = { id: '', items: null, err: '', busy: '', show: {}, urls: {} };
  function resultReset() {
    Object.keys(resultMem.urls).forEach((k) => { try { URL.revokeObjectURL(resultMem.urls[k]); } catch (e) { /* 이미 해제됨 */ } });
    resultMem.id = contentId; resultMem.items = null; resultMem.err = ''; resultMem.busy = ''; resultMem.show = {}; resultMem.urls = {};
  }
  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function resultErrText(err) {
    const code = err && err.code;
    if (isNotDeployedCode(code)) return '서버(GAS)에 결과 파일 보관 기능이 아직 없어요. 새 버전으로 배포하면 켜져요.';
    if (code === 'ERR_NO_CONFIG') return '연결 설정이 없어요. ⚙︎ 에서 GAS 주소와 토큰을 넣어 주세요.';
    return (err && err.message) || '알 수 없는 오류';
  }
  async function fetchResultBlob(it, onProgress) {
    const chunks = [];
    let total = 0;
    for (let i = 0; i < it.parts; i++) {
      const res = await api.post('result_fetch', { content_id: contentId, name: it.name, index: i, parts: it.parts });
      const bytes = b64ToBytes(String((res && res.data && res.data.data) || ''));
      chunks.push(bytes); total += bytes.length;
      if (onProgress) onProgress(i + 1, it.parts);
    }
    if (total !== it.size) throw new Error('받은 크기가 달라요(' + total + ' / ' + it.size + ') — 다시 눌러 주세요.');
    return new Blob(chunks, { type: it.kind === 'image' ? 'image/jpeg' : 'video/mp4' });
  }
  async function blobUrlOf(it, onProgress) {
    if (resultMem.urls[it.name]) return resultMem.urls[it.name];
    const url = URL.createObjectURL(await fetchResultBlob(it, onProgress));
    resultMem.urls[it.name] = url;
    return url;
  }

  function resultFiles() {
    if (resultMem.id !== contentId) resultReset();
    const host = h('div', { class: 'pr-res' });
    const alive = () => host.isConnected;
    const body = h('div', { class: 'pr-res-body', 'aria-live': 'polite' });

    async function load() {
      resultMem.err = '';
      try {
        const res = await api.post('result_list', { content_id: contentId });
        const items = (res && res.data && Array.isArray(res.data.items)) ? res.data.items : [];
        resultMem.items = items.filter((x) => x && RESULT_NAME_RE.test(String(x.name)));
      } catch (err) { resultMem.items = []; resultMem.err = resultErrText(err); }
      if (alive()) paint();
      // 커버 같은 작은 그림은 미리 받아 둔다
      (resultMem.items || []).filter((x) => x.kind === 'image' && x.complete && x.size <= 2 * 1024 * 1024 && !resultMem.urls[x.name]).forEach(async (x) => {
        try { await blobUrlOf(x); if (alive()) paint(); } catch (e) { /* 그림이 안 떠도 받기는 된다 */ }
      });
    }

    function paint() {
      const rows = [];
      if (resultMem.err) rows.push(h('p', { class: 'hint', text: resultMem.err }));
      if (resultMem.items === null) rows.push(h('p', { class: 'hint', text: '허브에 올라온 파일을 확인하는 중…' }));
      else if (!resultMem.items.length && !resultMem.err) rows.push(h('p', { class: 'hint', text: '허브에 올라온 파일이 아직 없어요. 노트북이 렌더 뒤에 올려 두면 여기에 나와요(옛 결과는 노트북 폴더에만 있어요).' }));
      (resultMem.items || []).forEach((it) => {
        const busy = resultMem.busy === it.name;
        const info = [formatBytes(it.size), it.updated_at ? new Date(it.updated_at).toLocaleString('ko-KR') : '', it.complete ? '' : '덜 올라옴(' + it.parts_found + '/' + it.parts + '조각)'].filter(Boolean).join(' · ');
        const dl = h('button', { class: 'btn sm primary', type: 'button', text: busy ? (resultMem.busyText || '받는 중…') : '내려받기' });
        if (!it.complete || resultMem.busy) dl.setAttribute('disabled', '');
        dl.addEventListener('click', async () => {
          resultMem.busy = it.name; resultMem.busyText = '받는 중…'; paint();
          try {
            const url = await blobUrlOf(it, (i, n) => { resultMem.busyText = '받는 중 ' + i + '/' + n; if (alive()) paint(); });
            const a = document.createElement('a');
            a.href = url; a.download = it.name; a.rel = 'noopener';
            document.body.appendChild(a); a.click(); a.remove();
            toast('내려받았어요 — ' + it.name, 'ok');
          } catch (err) { toast('받지 못했어요 — ' + resultErrText(err), 'err'); }
          resultMem.busy = ''; if (alive()) paint();
        });
        const actions = [dl];
        if (it.kind === 'video' && it.complete) {
          const view = h('button', { class: 'btn sm', type: 'button', text: resultMem.show[it.name] ? '보기 닫기' : '여기서 보기' });
          if (resultMem.busy && !resultMem.show[it.name]) view.setAttribute('disabled', '');
          view.addEventListener('click', async () => {
            if (resultMem.show[it.name]) { resultMem.show[it.name] = false; paint(); return; }
            resultMem.busy = it.name; resultMem.busyText = '받는 중…'; paint();
            try {
              await blobUrlOf(it, (i, n) => { resultMem.busyText = '받는 중 ' + i + '/' + n; if (alive()) paint(); });
              resultMem.show[it.name] = true;
            } catch (err) { toast('불러오지 못했어요 — ' + resultErrText(err), 'err'); }
            resultMem.busy = ''; if (alive()) paint();
          });
          actions.push(view);
        }
        const del = h('button', { class: 'btn sm', type: 'button', text: '지우기' });
        if (resultMem.busy) del.setAttribute('disabled', '');
        del.addEventListener('click', async () => {
          if (!window.confirm('허브에서 이 파일을 지울까요? (노트북 폴더의 원본은 그대로예요)\n' + it.name)) return;
          del.setAttribute('disabled', '');
          try {
            await api.post('result_delete', { content_id: contentId, name: it.name });
            if (resultMem.urls[it.name]) { try { URL.revokeObjectURL(resultMem.urls[it.name]); } catch (e) { /* 무시 */ } delete resultMem.urls[it.name]; }
            delete resultMem.show[it.name];
            toast('허브에서 지웠어요', 'ok');
            resultMem.items = null; paint(); load();
          } catch (err) { del.removeAttribute('disabled'); toast('지우지 못했어요 — ' + resultErrText(err), 'err'); }
        });
        actions.push(del);
        const kids = [h('div', { class: 'pr-bgm-row' },
          h('div', { class: 'pr-bgm-info' }, h('strong', { text: it.name }), h('span', { class: 'hint', text: info })),
          h('div', { class: 'pr-row' }, ...actions))];
        if (it.kind === 'image' && resultMem.urls[it.name]) kids.push(h('img', { class: 'pr-res-thumb', src: resultMem.urls[it.name], alt: '커버 미리보기' }));
        if (it.kind === 'video' && resultMem.show[it.name] && resultMem.urls[it.name]) kids.push(h('video', { class: 'pr-res-video', src: resultMem.urls[it.name], controls: true, playsinline: true, preload: 'metadata' }));
        rows.push(h('div', { class: 'pr-res-item' }, ...kids));
      });
      body.replaceChildren(...rows);
    }

    host.append(
      h('h4', { class: 'pr-h4', text: '만든 파일 (허브에 보관)' }),
      note('노트북이 렌더 뒤에 올려 둔 파일이에요. 폰에서도 여기서 바로 받거나 볼 수 있어요. 필요 없으면 지워도 돼요(노트북 폴더의 원본은 그대로).'),
      body,
      h('div', { class: 'pr-row' }, h('button', { class: 'btn sm', type: 'button', text: '목록 새로고침', onclick: () => { resultMem.items = null; paint(); load(); } })));
    paint();
    if (resultMem.items === null) load();
    else (resultMem.items || []).filter((x) => x.kind === 'image' && x.complete && x.size <= 2 * 1024 * 1024 && !resultMem.urls[x.name]).forEach(async (x) => { try { await blobUrlOf(x); if (alive()) paint(); } catch (e) { /* 무시 */ } });
    return host;
  }

  /* ── ⑥ 무료 BGM 찾기·고르기 — gas/Bgm.gs (Openverse 색인의 Jamendo 곡, CC0·퍼블릭 도메인·CC BY 만) ──
   *  곡은 서버가 드라이브 보관함(_bgm)에 내려받아 두고, 노트북은 오더에 실린 곡 '이름'으로 허브에서 받아 간다. */
  const bgmMem = { q: '', res: null, saved: null, busy: false, msg: '', picking: '' };
  let bgmAudio = null;
  let bgmPlaying = '';
  function stopBgmAudio() {
    if (bgmAudio) { try { bgmAudio.pause(); } catch (e) { /* 이미 멈춤 */ } bgmAudio = null; }
    bgmPlaying = '';
  }
  function bgmErrText(err) {
    const code = err && err.code;
    if (isNotDeployedCode(code)) return '서버(GAS)에 BGM 찾기 기능이 아직 없어요. 새 버전으로 배포하면 켜져요.';
    if (code === 'ERR_NO_CONFIG') return '연결 설정이 없어요. ⚙︎ 에서 GAS 주소와 토큰을 넣어 주세요.';
    return (err && err.message) || '알 수 없는 오류';
  }
  function useBgm(name, credit, required) {
    change((s) => { s.make.bgm = name; s.make.bgm_credit = String(credit || '').slice(0, 500); s.make.bgm_cr = !!required && !!credit; });
    paintList();
  }
  /** 영상 설명란에 넣을 출처 문구 상자(CC BY 는 꼭 넣어야 한다). */
  function creditBox(credit, required) {
    return h('div', { class: 'pr-warnbox' },
      h('strong', { text: required ? 'BGM 출처 표기가 필요해요 — ' : 'BGM 출처(표기 안 해도 되지만 넣어도 좋아요) — ' }),
      h('span', { text: required ? '영상 설명란에 아래 문구를 그대로 넣어 주세요(CC BY 라이선스 조건).' : '' }),
      h('code', { class: 'pr-credit', text: credit }),
      h('div', { class: 'pr-row' }, h('button', { class: 'btn sm', type: 'button', text: '출처 문구 복사', onclick: () => copyText(credit, '출처 문구를 복사했어요') })));
  }

  function bgmFinder() {
    const m = state.make;
    const host = h('div', { class: 'pr-bgm' });
    const input = h('input', { class: 'pr-in', type: 'text', maxlength: '40', placeholder: '찾을 말 — 영어 한 단어가 잘 맞아요 (예: calm)', 'aria-label': 'BGM 검색어', value: bgmMem.q });
    const goBtn = h('button', { class: 'btn sm primary', type: 'button', text: 'BGM 찾기' });
    const out = h('div', { class: 'pr-bgm-out', 'aria-live': 'polite' });
    const savedHost = h('div', { class: 'pr-bgm-saved' });
    const alive = () => host.isConnected && openStep === 'make';

    async function runSearch(q0) {
      const q = cleanBgmQuery(q0 !== undefined ? q0 : input.value);
      if (!q) { bgmMem.msg = '찾을 말을 적어 주세요(예: calm). 여러 단어는 전부 들어간 곡만 나와요.'; paintOut(); return; }
      bgmMem.q = q; input.value = q; bgmMem.busy = true; bgmMem.msg = '찾는 중…'; stopBgmAudio(); paintOut();
      try {
        const res = await api.post('bgm_search', { q });
        bgmMem.res = (res && res.data) || null;
        bgmMem.msg = bgmMem.res && bgmMem.res.items && bgmMem.res.items.length ? '' : '조건에 맞는 곡이 없어요 — 단어를 줄이거나(예: calm) 위의 빠른 버튼을 눌러 보세요.';
      } catch (err) { bgmMem.msg = '찾지 못했어요 — ' + bgmErrText(err); }
      bgmMem.busy = false;
      if (alive()) paintOut();
    }

    function paintOut() {
      if (bgmMem.busy) goBtn.setAttribute('disabled', ''); else goBtn.removeAttribute('disabled');
      const rows = [];
      if (bgmMem.msg) rows.push(h('p', { class: 'hint', text: bgmMem.msg }));
      const items = bgmMem.res && Array.isArray(bgmMem.res.items) ? bgmMem.res.items : [];
      items.forEach((it) => {
        const prev = h('button', { class: 'btn sm', type: 'button', text: bgmPlaying === it.id ? '■ 멈춤' : '▶ 미리듣기' });
        prev.addEventListener('click', () => {
          if (bgmPlaying === it.id) { stopBgmAudio(); paintOut(); return; }
          stopBgmAudio();
          const a = document.createElement('audio');
          a.src = it.preview_url;
          a.preload = 'none';
          a.addEventListener('ended', () => { stopBgmAudio(); if (alive()) paintOut(); });
          a.addEventListener('error', () => { stopBgmAudio(); bgmMem.msg = '미리듣기를 열지 못했어요 — 곡은 그래도 고를 수 있어요.'; if (alive()) paintOut(); });
          bgmAudio = a;
          bgmPlaying = it.id;
          const pr = a.play();
          if (pr && typeof pr.catch === 'function') pr.catch(() => { stopBgmAudio(); if (alive()) paintOut(); });
          paintOut();
        });
        const useBtn = h('button', { class: 'btn sm primary', type: 'button', text: bgmMem.picking === it.id ? '가져오는 중…' : '이 곡 쓰기' });
        if (bgmMem.picking) useBtn.setAttribute('disabled', '');
        useBtn.addEventListener('click', async () => {
          if (bgmMem.picking) return;
          bgmMem.picking = it.id; stopBgmAudio(); bgmMem.msg = '곡을 가져오는 중이에요(몇 초 걸려요)…'; paintOut();
          try {
            const res = await api.post('bgm_pick', { id: it.id });
            const d = (res && res.data) || {};
            const name = String(d.name || '');
            if (!BGM_NAME_RE.test(name)) throw new Error('서버가 돌려준 곡 이름이 이상해요.');
            bgmMem.picking = ''; bgmMem.msg = ''; bgmMem.saved = null;   // 보관함 목록은 다시 읽는다
            toast('BGM 을 골랐어요', 'ok');
            useBgm(name, String(d.credit || it.credit || ''), it.credit_required === true);
          } catch (err) {
            bgmMem.picking = ''; bgmMem.msg = '곡을 가져오지 못했어요 — ' + bgmErrText(err);
            if (alive()) paintOut();
          }
        });
        const meta = [it.creator, fmtDuration(it.duration_sec), it.license_label].concat((it.genres || []).slice(0, 2)).filter(Boolean).join(' · ');
        rows.push(h('div', { class: 'pr-bgm-row' },
          h('div', { class: 'pr-bgm-info' }, h('strong', { text: it.title }),
            h('span', { class: 'hint', text: meta + (it.credit_required ? ' · 출처 표기 필요' : ' · 표기 불필요') })),
          h('div', { class: 'pr-row' }, prev, useBtn)));
      });
      out.replaceChildren(...rows);
    }

    async function loadSaved() {
      try {
        const res = await api.post('bgm_list', {});
        bgmMem.saved = (res && res.data && Array.isArray(res.data.items)) ? res.data.items : [];
      } catch (err) { bgmMem.saved = []; }
      if (alive()) paintSaved();
    }
    function paintSaved() {
      if (bgmMem.saved === null) { savedHost.replaceChildren(h('p', { class: 'hint', text: '보관함을 불러오는 중…' })); return; }
      if (!bgmMem.saved.length) { savedHost.replaceChildren(); return; }
      const rows = [h('h4', { class: 'pr-h4', text: '내 BGM 보관함 (한 번 고른 곡)' })];
      bgmMem.saved.forEach((it) => {
        const useBtn = h('button', { class: 'btn sm primary', type: 'button', text: it.name === m.bgm ? '쓰는 중' : '쓰기', onclick: () => useBgm(it.name, it.credit, it.credit_required === true) });
        if (it.name === m.bgm) useBtn.setAttribute('disabled', '');
        const delBtn = h('button', { class: 'btn sm', type: 'button', text: '지우기', onclick: async () => {
          if (!window.confirm('보관함에서 이 곡을 지울까요?\n' + (it.title || it.name))) return;
          delBtn.setAttribute('disabled', '');
          try {
            await api.post('bgm_delete', { name: it.name });
            bgmMem.saved = bgmMem.saved.filter((x) => x.name !== it.name);
            if (state.make.bgm === it.name) change((s) => { s.make.bgm = ''; s.make.bgm_credit = ''; s.make.bgm_cr = false; });
            toast('보관함에서 지웠어요', 'ok');
            paintList();
          } catch (err) { delBtn.removeAttribute('disabled'); toast('지우지 못했어요 — ' + bgmErrText(err), 'err'); }
        } });
        rows.push(h('div', { class: 'pr-bgm-row' },
          h('div', { class: 'pr-bgm-info' }, h('strong', { text: it.title || it.name }),
            h('span', { class: 'hint', text: [it.creator, it.duration_sec ? fmtDuration(it.duration_sec) : '', it.license_label].filter(Boolean).join(' · ') + (it.credit_required ? ' · 출처 표기 필요' : '') })),
          h('div', { class: 'pr-row' }, useBtn, delBtn)));
      });
      savedHost.replaceChildren(...rows);
    }

    goBtn.addEventListener('click', () => runSearch());
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runSearch(); } });
    const chips = h('div', { class: 'pr-bgm-chips' },
      ...BGM_QUICK_TERMS.map((t) => h('button', { class: 'btn sm', type: 'button', text: t.label, title: t.q, onclick: () => runSearch(t.q) })));

    host.append(
      h('h4', { class: 'pr-h4', text: '무료 BGM 찾기' }),
      note('영상에 써도 되는 곡만 보여요(CC0·퍼블릭 도메인·CC BY). CC BY 곡은 영상 설명란에 출처를 적어야 하고, 그 문구는 곡을 고르면 만들어 드려요.'),
      h('div', { class: 'pr-row' }, input, goBtn),
      chips, out, savedHost);
    if (m.bgm) {
      host.append(h('p', { class: 'pr-bgm-now', text: '지금 고른 곡: ' + m.bgm }));
      if (m.bgm_credit) host.append(creditBox(m.bgm_credit, m.bgm_cr === true));
      host.append(h('div', { class: 'pr-row' }, h('button', { class: 'btn sm', type: 'button', text: 'BGM 빼기', onclick: () => {
        change((s) => { s.make.bgm = ''; s.make.bgm_credit = ''; s.make.bgm_cr = false; });
        paintList();
      } })));
    }
    paintOut();
    if (bgmMem.saved === null) { paintSaved(); loadSaved(); } else paintSaved();
    return host;
  }

  /* ── ⑥ 마무리 — 자막 굽기 · BGM · 커버 ── */
  function bodyMake(box) {
    const m = state.make;
    box.append(
      note('확정한 자막을 표3 안전영역(훅은 위쪽, 본문은 아래쪽)에 맞춰 영상에 굽고, BGM을 깔고, 최종 음량을 -14 LUFS 로 맞춘 뒤, 커버(1080×1080)를 뽑아요. 노트북이 만들고, 결과 파일은 노트북의 out 폴더에 생겨요.'),
      h('div', { class: 'pr-pipe' },
        ...['자막 굽기', 'BGM 깔기', '피크 다듬기', '최종 음량 -14', '규격 검수', '커버 뽑기'].map((t, i) => h('span', { class: 'pr-pipe-i' }, h('b', { text: String(i + 1) }), t))));

    const canBurn = state.srt.confirmed === true;
    const burnBox = check('자막 굽기', m.burn && canBurn, (v) => { change((s) => { s.make.burn = v; }); paintList(); },
      canBurn ? '⑤ 에서 확정한 자막 ' + state.srt.cues + '개를 굽는다' : (state.srt.skipped ? '자막 없이 진행 중이라 굽지 않아요' : '⑤ 에서 자막을 확정하면 켤 수 있어요'));
    if (!canBurn) burnBox.querySelector('input').setAttribute('disabled', '');
    const aiBox = check('마지막 2초 "AI 자막 보조" 안내', m.ai_notice && canBurn, (v) => { change((s) => { s.make.ai_notice = v; }); },
      'AI 가 만든 초안을 바탕으로 한 자막이면 켜 둬요(표4)');
    if (!canBurn) aiBox.querySelector('input').setAttribute('disabled', '');

    const bgm = h('input', { class: 'pr-in', type: 'text', placeholder: '비우면 BGM 없이 (예: 잔잔한곡.mp3)', 'aria-label': 'BGM 파일 이름', value: m.bgm, maxlength: '80' });
    const bgmErr = h('div', { class: 'pr-err', role: 'alert' });
    bgm.addEventListener('input', () => {
      const v = bgm.value.trim();
      if (v && (!BGM_NAME_RE.test(v) || v.indexOf('..') >= 0)) { bgmErr.textContent = 'mp3·wav·m4a·aac 파일 이름만 적어요(폴더 경로 불가)'; if (poll.refresh) poll.refresh(); }
      else { bgmErr.textContent = ''; change((s) => { if (v !== s.make.bgm) { s.make.bgm_credit = ''; s.make.bgm_cr = false; } s.make.bgm = v; }); }
    });
    const vol = h('select', { class: 'pr-sel', 'aria-label': 'BGM 볼륨' },
      h('option', { value: '', text: '자동 — 말소리 있으면 -24dB, 없으면 -16dB' }),
      ...[-16, -20, -24, -28].map((d) => h('option', { value: String(d), text: d + ' dB' })));
    vol.value = m.bgm_db === '' ? '' : String(m.bgm_db);
    vol.addEventListener('change', () => change((s) => { s.make.bgm_db = vol.value === '' ? '' : Number(vol.value); }));
    const cover = h('input', { class: 'pr-in', type: 'text', inputmode: 'decimal', 'aria-label': '커버 시점(초)', value: String(m.cover_t) });
    const coverErr = h('div', { class: 'pr-err', role: 'alert' });
    cover.addEventListener('input', () => {
      const n = Number(String(cover.value).trim());
      if (String(cover.value).trim() === '' || !Number.isFinite(n) || n < 0 || n > 3600) { coverErr.textContent = '0~3600 사이 숫자(초)로 적어 주세요'; if (poll.refresh) poll.refresh(); }
      else { coverErr.textContent = ''; change((s) => { s.make.cover_t = n; }); }
    });

    box.append(
      burnBox, aiBox,
      bgmFinder(),
      h('label', { class: 'pr-field' }, h('span', { class: 'pr-label', text: 'BGM 파일 이름 (위에서 고르면 자동으로 들어가요 · 직접 넣을 때는 노트북 render\\bgm 폴더에 둔 파일 이름)' }), bgm),
      bgmErr,
      note('내가 쓸 수 있는 음원만 넣어요. 남의 음원·저작권이 있는 곡은 쓰지 않아요. 곡이 짧으면 반복하고, 말소리가 나올 때는 자동으로 작아져요. 노트북 폴더에 없으면 허브 보관함에서 알아서 받아 가요.'),
      h('div', { class: 'pr-two' },
        h('label', { class: 'pr-field' }, h('span', { class: 'pr-label', text: 'BGM 볼륨' }), vol),
        h('label', { class: 'pr-field' }, h('span', { class: 'pr-label', text: '커버로 쓸 장면 시점(초)' }), cover)),
      coverErr);

    box.append(...orderBlock('order_fin', {
      sendText: '노트북에 마무리 오더 보내기',
      compute: () => {
        const cs = stepStatus(state, brand);
        const mm = state.make;
        const okSrt = state.srt.confirmed === true || state.srt.skipped || !mm.burn;
        // 화면 칸에 잘못된 값이 적혀 있으면(저장된 값은 예전 것) 보내지 않는다 — 보이는 값과 보내는 값이 다르면 안 된다
        const inputErr = bgmErr.textContent || coverErr.textContent;
        return {
          built: inputErr ? { ok: false, errors: [inputErr] } : buildStagePayload('finish', { contentId, brand, state }),
          ready: cs.render && okSrt,
          blockedText: cs.render ? '⑤ 에서 자막을 확정하거나 "자막 없이 진행"을 눌러 주세요.' : '④ 클린 마스터를 먼저 완료해 주세요.'
        };
      },
      onDone: async () => {
        try {
          const a = await getAsset('report_finish');
          if (!a.exists) return;
          if (!reportIsFresh(a.text, state.order_fin && state.order_fin.sent_at)) {
            if (wrap.isConnected) toast('노트북이 이번 마무리 결과를 허브에 올리지 못했어요(예전 결과만 있어요) — 포털 오더함에서 결과를 확인해 주세요', 'err');
            return;
          }
          const parsed = parseReport(a.text);
          if (!parsed.ok || !wrap.isConnected) return;
          change((s) => { s.fin_report = parsed.report; });
          if (openStep === 'make') paintList();
        } catch (err) { if (wrap.isConnected) toast('결과를 자동으로 가져오지 못했어요 — ' + assetErrText(err), 'err'); }
      }
    }));

    const fr = state.fin_report;
    if (fr) {
      box.appendChild(h('h4', { class: 'pr-h4', text: '최종본 규격 대조 (표준 v3 표3 ⑥ — 화면이 다시 계산)' }));
      box.appendChild(resultTable(compareStandard(fr, 'final').map((x) => ({ name: x.label, status: x.status, msg: x.msg }))));
      if (fr.checks.length) {
        box.appendChild(h('h4', { class: 'pr-h4', text: '노트북 검수 항목' }));
        box.appendChild(resultTable(fr.checks.map((x) => ({ name: x.id || '-', status: x.status, msg: x.msg }))));
      }
      const info = [];
      if (fr.burn) info.push('자막 ' + fr.burn.cues + '개 · 글꼴 ' + fr.burn.font);
      if (fr.burn && fr.burn.font_preferred_missing) info.push('⚠ 트랙 지정 글꼴(' + (fr.burn.font_preferred || '') + ')이 노트북에 없어 ' + fr.burn.font + ' 로 대신했어요 — 글꼴을 설치하면 정해진 글꼴로 나와요');
      if (fr.burn && fr.burn.warnings && fr.burn.warnings.length) info.push('자막 알림 ' + fr.burn.warnings.length + '건: ' + fr.burn.warnings.slice(0, 3).join(' / '));
      if (fr.bgm) info.push('BGM ' + fr.bgm.name + ' · ' + fr.bgm.volume_db + 'dB · 말소리에 맞춰 자동으로 낮춤 · 끝 1초 페이드아웃');
      if (fr.limiter) info.push('피크 다듬기: ' + fr.limiter.measured_lufs + ' LUFS → -14 로 올리려고 순간 피크를 ' + fr.limiter.ceiling_db + ' dB 아래로 눌렀어요');
      if (fr.ai_notice) info.push('마지막 2초 "AI 자막 보조" 안내 포함');
      info.forEach((t) => box.appendChild(note(t)));
      if (fr.bgm && fr.bgm.credit) box.appendChild(creditBox(fr.bgm.credit, fr.bgm.credit_required === true));
      if (fr.out) box.appendChild(h('div', { class: 'pr-warnbox' }, h('strong', { text: '결과 파일: ' }), h('code', { text: (fr.out_dir || ('out/' + contentId)) + '\\' + fr.out }),
        fr.cover ? h('span', { text: ' · 커버 ' + fr.cover }) : null));
      box.appendChild(resultFiles());
    }
  }

  /* ── ⑦ 사람 확인 ── */
  function bodyFinish(box) {
    const f = finishOf(brand);
    box.append(
      note('허브가 컷·9:16·음량·자막 굽기·BGM·커버까지 만들었어요. 마지막은 사람이 눈과 귀로 확인해요. 확인한 항목을 눌러 표시해 두세요.'));
    reviewSteps(brand, { voiceMode: state.voice_mode }).forEach((rs, i) => {
      box.appendChild(check((i + 1) + '. ' + rs.title, state.review[rs.id] === true, (v) => change((s) => { s.review[rs.id] = v; }), rs.rule));
    });
    if (state.make.bgm && state.make.bgm_credit) box.appendChild(creditBox(state.make.bgm_credit, state.make.bgm_cr === true));
    box.appendChild(h('p', { class: 'pr-brand', text: '이 카드의 트랙 값 — 글꼴 ' + f.font + ' · 강조색 ' + f.color + ' · 줄당 ' + f.cpl + '자' }));
    box.appendChild(note('발행(업로드·고정댓글·링크 삽입)은 사람이 해요. 이 화면은 어떤 것도 올리지 않아요. 효과음은 아직 허브가 하지 않아요. 내레이션(TTS·내 목소리 녹음)은 ④ 완제품 옵션에서만 넣어요(⑥ 은 클린 마스터에서 시작해서 ④ 의 내레이션이 들어가지 않아요).'));
  }

  const BODIES = { material: bodyMaterial, plan: bodyPlan, cuts: bodyCuts, render: bodyRender, srt: bodySrt, make: bodyMake, finish: bodyFinish };

  /* 처음엔 아직 안 끝난 첫 단계를 펼쳐 둔다 */
  const st0 = stepStatus(state, brand);
  const firstOpen = STEPS.find((s) => !s.soon && !st0[s.key]);
  openStep = firstOpen ? firstOpen.key : null;
  paintHead();
  paintList();
  return wrap;
}
