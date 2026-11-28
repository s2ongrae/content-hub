/**
 * gas/IgCardDraft.gs — 인스타 피드 카드뉴스 초안 (2026-11-26, 1차 MVP)
 * ============================================================================
 * [무엇을 하는가]
 *   밤에 한 번(02:30 KST), Contents 시트에서 `ig_feed_status = 'queued'` 인 카드를 골라
 *   무료 Gemini 로 '슬라이드별 문구 · 캡션 · 해시태그' 초안 JSON 을 만들고,
 *   드라이브(ContentHubOS_Uploads/<content_id>/)에 초안 파일을 남긴 뒤
 *   `ig_feed_status = 'draft_ready'`, `status = 'REVIEW'` 로 넘긴다.
 *   사람은 폰 승인 탭에서 [승인](human_approved) 또는 [다시 쓰기](queued)만 누른다.
 *
 * [하지 않는 것 — 1차 MVP 의 경계]
 *   · Meta(인스타) API 로 자동 발행하지 않는다. 발행은 사람이 직접 한다(2단계 분리).
 *   · Slides API 로 이미지를 만들지 않는다. 화면(js/studioCanvas.js)이 4:5(1080×1350)·
 *     3:4(1080×1440) 로 미리보기만 그린다.
 *   · Contents 40칸에 새 열을 붙이지 않는다 — ig_feed_status · ig_carousel_count ·
 *     media_drive_url · payload_file_id 네 칸을 그대로 쓴다(Setup.gs 무변경).
 *   · 유료 모델·유료 API 를 쓰지 않는다(AI_Brief 와 같은 무료 모델 두 개만, 과금 인지 플래그 필수).
 *
 * [실행 경로]
 *   ① 야간 트리거   igCardDraftNightly_        (installIgCardDraftTrigger / removeIgCardDraftTrigger)
 *   ② API 액션      ig_card_draft_run          (사람이 화면에서 '지금 초안 만들기' — 선택)
 *   ③ API 액션      ig_card_review             (승인 human_approved / 반려 queued)
 * ============================================================================
 */

/* ── 상수 ─────────────────────────────────────────────────────────── */

const IG_CARD_SCOPE_ = 'content-hub';
const IG_CARD_MODELS_ = ['gemini-4-hydrogen', 'gemini-3.8-flash'];   // 무료 티어 모델만(유료 금지)
const IG_CARD_MODEL_DEFAULT_ = 'gemini-3.8-flash';
const IG_CARD_DAY_CAP_ = 12;                  // 하루 Gemini 호출 상한(카드 수, 캡션 재시도 포함해도 넘지 않게)
const IG_CARD_BATCH_MAX_ = 3;                 // 한 번에 다룰 카드 수 — 6분 타임아웃 안에서 끝나는 양
const IG_CARD_TIME_BUDGET_MS_ = 240000;       // 240초 실행 예산(AI_Brief 와 같은 값)
const IG_CARD_CLAIM_STALE_MS_ = 30 * 60 * 1000;   // 'drafting' 이 30분 넘게 멈춰 있으면 회수

const IG_CARD_MIN_SLIDES_ = 3;
const IG_CARD_MAX_SLIDES_ = 8;
const IG_CARD_CAPTION_MAX_ = 2200;            // 인스타 캡션 상한
const IG_CARD_HASHTAG_MAX_ = 10;
const IG_CARD_SLIDE_HEADLINE_MAX_ = 40;
const IG_CARD_SLIDE_BODY_MAX_ = 90;
const IG_CARD_SUMMARY_MAX_ = 80;
const IG_CARD_SOURCE_MAX_CHARS_ = 1600;       // 근거 글 발췌 상한(토큰·개인정보 절약)

const IG_CARD_STATUS_QUEUED_ = 'queued';
const IG_CARD_STATUS_DRAFTING_ = 'drafting';
const IG_CARD_STATUS_READY_ = 'draft_ready';
const IG_CARD_STATUS_APPROVED_ = 'human_approved';

const IG_CARD_DRAFT_FILE_ = 'ig_card_draft.json';
const IG_CARD_TRIGGER_HANDLER_ = 'igCardDraftNightly_';

/** 이 모듈이 쓰는 Contents 열 — 없으면 새로 붙이지 않고 시끄럽게 실패한다. */
const IG_CARD_REQUIRED_COLS_ = ['content_id', 'brand', 'status', 'ig_feed_status', 'ig_carousel_count', 'media_drive_url', 'payload_file_id'];

/** 초안을 만들 수 있는 카드 단계(이미 발행됐거나 사람 손이 필요한 카드는 건드리지 않는다). */
const IG_CARD_ELIGIBLE_STATUS_ = ['DRAFT', 'GENERATING', 'REVIEW', 'READY', 'EDITING'];

const IG_CARD_SYSTEM_PROMPT_ =
  '너는 대전 로컬 맛집·일상 계정의 인스타그램 피드 카드뉴스 편집자다. ' +
  '아래 규칙을 지키고 JSON 만 출력한다.\n' +
  '1. 근거에 없는 사실·숫자·가격·영업시간·후기·수치를 절대 만들지 마라. 모르는 항목은 빼라.\n' +
  '2. 슬라이드는 5~8장. 1장은 type="cover"(스크롤을 멈추게 하는 훅), 마지막 장은 type="cta"(저장을 권하는 마무리)다.\n' +
  '3. 가운데 장은 type="body" 이고, 그중 한 장은 type="quote" 로 썰 수 있는 한 문장(숫자·반전·대구)을 고른다.\n' +
  '   · cover: headline 은 가게 이름·핵심 훅 한 줄(14자 안팎, 두 줄을 넘기지 않는다). body 는 비우거나 짧게.\n' +
  '   · body: headline 은 핵심 한 줄(14자 안팎), body 는 60자 안팎 한두 문장이다.\n' +
  '   · quote: headline 이 곧 인용구다 — 20자 안팎 짧은 한 문장(한 줄로 읽힘), body 는 출처·상황 한 줄.\n' +
  '   · cta: headline 은 “저장해 두세요”처럼 저장을 부드럽게 권하는 말, body 는 다시 갈 때 틸킬 한 줄.\n' +
  '4. 카드 문법 — (a) 숫자는 그대로 쓰고 headline 앞에 둔다(예: “16,000원의 믿음”). ' +
  '   (b) 대구·대조(싸다/비싸다, 기다렸다/뿌듯했다)로 한 줄을 만든다. ' +
  '   (c) 반전은 마지막 3~4자에 둔다("대기 40분, 그래도 또 갑니다"). (d) 한 장에 한 가지 말만 한다.\n' +
  '5. 캡션은 3~5문장이고 마지막 문장은 저장·공유를 권한다. 해시태그는 5~8개다.\n' +
  '6. 협찬·광고 표시가 근거에 있을 때만 캡션 첫 줄에 [광고] 를 넣는다(없으면 넣지 않는다).\n' +
  '7. 반말·과장·감탄사 남발을 피하고, 실제로 겪은 사람이 쓴 담백한 문장으로 쓴다. ' +
  '   같은 종결(∼습니다·∼어요)이 세 번 이어지면 한 번은 다른 모양으로 끊는다.';

/* ── 라우터 핸들러 (ig_card_draft_run / ig_card_review) ───────────── */

/**
 * 초안 만들기 실행 핸들러 (WRITE, longRunning: true)
 * payload = { limit?: 1~3, content_id?: '한 장만', model?: 허용 모델 }
 *   · 429 당일 잠금·과금 인지는 화면에서 풀 수 없다(0원 방어).
 */
function handleIgCardDraftRun_(ssArg, payload) {
  const req = payload || {};
  return igCardRun_(req, ssArg || igCardSpreadsheet_());
}

/**
 * 승인(human_approved) / 반려(queued) 핸들러 (WRITE)
 * payload = { content_id, decision: 'approve' | 'reject', reason? }
 */
function handleIgCardReview_(ssArg, payload, ctx) {
  const req = payload || {};
  const contentId = cleanText_(req.content_id, 64);
  if (!contentId) throw createAppError_('ERR_VALIDATION_FAILED', 'content_id 가 필요합니다.');

  const decision = cleanText_(req.decision, 16).toLowerCase();
  if (decision !== 'approve' && decision !== 'reject') {
    throw createAppError_('ERR_VALIDATION_FAILED', 'decision 은 approve 또는 reject 입니다.', { decision: decision });
  }

  const ss = ssArg || igCardSpreadsheet_();
  const sheet = ss ? ss.getSheetByName('Contents') : null;
  if (!sheet) throw createAppError_('ERR_NO_SHEET', 'Contents 시트를 찾지 못했습니다.');
  const headers = igCardHeaders_(sheet);
  const rowIndex = igCardRowIndex_(sheet, headers, contentId);
  if (rowIndex < 0) throw createAppError_('ERR_NOT_FOUND', '콘텐츠를 찾지 못했습니다: ' + contentId);

  const col = igCardCols_(headers);
  const target = decision === 'approve' ? IG_CARD_STATUS_APPROVED_ : IG_CARD_STATUS_QUEUED_;
  let current = '';

  /* 상태를 읽고 바꾸는 일은 락 안에서 한 번에(두 번 눌러도 한 번만 바뀐다).
     드라이브 쓰기(승인 메모)는 락 밖에서 — 이 액션이 longRunning 인 이유다. */
  const changed = withWriteLock_(function () {
    current = String(sheet.getRange(rowIndex, col.ig_feed_status + 1).getValue() || '').trim();
    if (current === target) return false;
    // 승인은 '초안이 준비된' 카드만. 반려는 승인을 뒤집을 수도 있다(승인 → queued → 다시 초안).
    const fromOk = decision === 'approve'
      ? [IG_CARD_STATUS_READY_]
      : [IG_CARD_STATUS_READY_, IG_CARD_STATUS_APPROVED_];
    if (fromOk.indexOf(current) < 0) {
      throw createAppError_('ERR_IG_CARD_NOT_READY',
        '초안이 준비된 카드만 승인·반려할 수 있습니다.', { content_id: contentId, ig_feed_status: current });
    }
    if (decision === 'approve') {
      const count = Number(sheet.getRange(rowIndex, col.ig_carousel_count + 1).getValue()) || 0;
      if (count < 1) {
        throw createAppError_('ERR_IG_CARD_NO_DRAFT',
          '카드뉴스 초안이 아직 없습니다. 초안을 먼저 만드세요.', { content_id: contentId });
      }
    }
    sheet.getRange(rowIndex, col.ig_feed_status + 1).setValue(target);
    return true;
  });

  // 같은 결정을 다시 눌러도 실패하지 않는다(중복 클릭·재시도 안전).
  if (!changed) {
    return { content_id: contentId, decision: decision, ig_feed_status: target, already: true, previous: current };
  }

  const brand = String(sheet.getRange(rowIndex, col.brand + 1).getValue() || '');

  // 초안 파일에 사람의 결정을 남긴다(실패해도 상태 전환은 되돌리지 않는다 — 파일은 참고용)
  try {
    igCardNoteReview_(sheet, headers, rowIndex, col, {
      decision: decision, reason: cleanText_(req.reason, 200), by: (ctx && ctx.clientId) || 'user'
    });
  } catch (ignoreNoteErr) { /* 메모 실패가 승인을 막지 않게 */ }

  igCardLog_(ss, {
    brand: brand,
    contentId: contentId,
    taskType: 'ig_card_review',
    status: 'OK',
    errorCode: '',
    detail: decision + (req.reason ? ': ' + cleanText_(req.reason, 80) : '')
  });

  return { content_id: contentId, decision: decision, ig_feed_status: target, previous: current };
}

/* ── 야간 실행 ────────────────────────────────────────────────────── */

/**
 * 야간 트리거 엔트리포인트 — 예외를 밖으로 던지지 않는다.
 */
function igCardDraftNightly_() {
  try {
    return igCardRun_({}, igCardSpreadsheet_());
  } catch (err) {
    Logger.log('igCardDraftNightly_ failed: ' + ((err && err.code) || 'ERR_UNKNOWN'));
    return { ok: false, error: (err && err.code) || 'ERR_UNKNOWN' };
  }
}

/**
 * 초안 만들기 본체. 트리거와 API 가 함께 쓴다.
 * @return {{ok:boolean, day:string, drafted:Array, failed:Array, skipped:number, remaining_queued:number, status:string}}
 */
function igCardRun_(req, ss) {
  const options = req || {};
  const startMs = nowMs_();
  const now = new Date();
  const day = kstDay_(now);
  const dayCompact = day.replace(/-/g, '');
  const ymCompact = dayCompact.slice(0, 6);
  const props = PropertiesService.getScriptProperties();

  const model = cleanText_(options.model || IG_CARD_MODEL_DEFAULT_, 60) || IG_CARD_MODEL_DEFAULT_;
  if (IG_CARD_MODELS_.indexOf(model) === -1) {
    throw createAppError_('ERR_MODEL_NOT_ALLOWED', '허용되지 않은 Gemini 모델입니다.', {
      model: model, allowed: IG_CARD_MODELS_
    });
  }
  const scope = cleanText_(options.scope || IG_CARD_SCOPE_, 40) || IG_CARD_SCOPE_;
  if (scope !== IG_CARD_SCOPE_) {
    throw createAppError_('ERR_SCOPE_NOT_ALLOWED', '허용되지 않은 scope 입니다.', { scope: scope });
  }

  const result = {
    ok: true, day: day, model: model, drafted: [], failed: [], skipped: 0,
    remaining_queued: 0, status: 'OK', budget: { used: igCardBudgetUsed_(dayCompact), cap: IG_CARD_DAY_CAP_ }
  };

  if (!ss) {
    result.ok = false;
    result.status = 'ERR_NO_SHEET';
    return result;
  }
  const sheet = ss.getSheetByName('Contents');
  if (!sheet) {
    result.ok = false;
    result.status = 'ERR_NO_SHEET';
    return result;
  }

  const headers = igCardHeaders_(sheet);
  const col = igCardCols_(headers);   // 없는 열이면 여기서 ERR_IG_CARD_SCHEMA

  /* 선점 청소(2026-11-28) — 지난 실행이 6분 한도에 잘려 catch 를 못 타면 카드가 'drafting' 으로 남는다.
     회수는 '다음 실행이 있을 때' 일어나는데, 그 다음 실행이 이른불에 후보를 읽기 전에 먼저 풀어 준다.
     · 30분 넘은 drafting · 선점 기록이 아예 없는 drafting → queued 로 되돌리고 결과에 몇 장을 풀었는지 남긴다. */
  let swept = 0;
  try {
    swept = igCardSweepStale_(sheet, col);
  } catch (sweepErr) {
    swept = 0;   // 청소가 실패해도 이번 실행은 산다(후보 선택이 다시 회수 대상으로 잡는다)
  }
  result.swept = swept;

  const rows = igCardReadRows_(sheet, headers);

  // 손대지 않고 남겨 둘 카드 수(사람이 볼 수 있게 같이 돌려준다)
  result.remaining_queued = rows.filter(function (r) {
    return String(r.values[col.ig_feed_status] || '').trim() === IG_CARD_STATUS_QUEUED_;
  }).length;

  const onlyId = cleanText_(options.content_id, 64);
  const limit = Math.max(1, Math.min(IG_CARD_BATCH_MAX_, Number(options.limit) || IG_CARD_BATCH_MAX_));

  const candidates = rows.filter(function (r) {
    const v = r.values;
    if (onlyId && String(v[col.content_id] || '').trim() !== onlyId) return false;
    if (!igCardTrackAllows_(String(v[col.brand] || ''))) return false;      // 트랙 B 는 피드를 운영하지 않는다
    const stage = String(v[col.status] || '').trim().toUpperCase();
    if (IG_CARD_ELIGIBLE_STATUS_.indexOf(stage) < 0) return false;
    const feed = String(v[col.ig_feed_status] || '').trim();
    if (feed === IG_CARD_STATUS_QUEUED_) return true;
    // 실행이 죽어 'drafting' 으로 멈춘 카드는 30분 뒤 회수한다(영구히 잠기지 않게)
    if (feed === IG_CARD_STATUS_DRAFTING_) return igCardClaimStale_(String(v[col.content_id] || ''));
    return false;
  }).slice(0, limit);

  if (!candidates.length) {
    result.status = 'NO_QUEUED';
    return result;
  }

  // 키·과금 인지·429 잠금은 카드를 건드리기 전에 먼저 본다(queued 그대로 두고 사유만 남긴다).
  const apiKey = cleanText_(props.getProperty('GEMINI_API_KEY'), 256);
  if (!apiKey) {
    result.status = 'SKIPPED_NO_API_KEY';
    return result;
  }
  const ackRaw = cleanText_(props.getProperty('GEMINI_BILLING_ACK_' + ymCompact), 16);
  if (!ackRaw || (ackRaw !== '1' && ackRaw.toLowerCase() !== 'true')) {
    result.status = 'SKIPPED_NO_BILLING_ACK';
    return result;
  }
  if (props.getProperty('GEMINI_EXHAUSTED_' + dayCompact) === '1') {
    result.status = 'SKIPPED_429';
    return result;
  }

  let usedBefore = igCardBudgetUsed_(dayCompact);
  if (usedBefore >= IG_CARD_DAY_CAP_) {
    result.status = 'SKIPPED_BUDGET';
    return result;
  }

  for (let i = 0; i < candidates.length; i += 1) {
    const cand = candidates[i];
    const contentId = String(cand.values[col.content_id] || '').trim();

    if (nowMs_() - startMs > IG_CARD_TIME_BUDGET_MS_) {
      result.status = 'PARTIAL';
      break;                                   // 남은 카드는 queued 로 남는다(다음 밤에 이어서)
    }
    if (igCardBudgetUsed_(dayCompact) >= IG_CARD_DAY_CAP_) {
      result.status = 'SKIPPED_BUDGET';
      break;
    }

    // 선점 — 아직 queued(또는 회수 대상 drafting)일 때만 내 것으로 만든다.
    let claimed = false;
    try {
      claimed = igCardClaim_(sheet, col, cand.rowIndex, contentId);
    } catch (claimErr) {
      claimed = false;   // 락 대기 초과 등 — 이 카드는 건드리지 않고 다음 카드로 간다(다음 밤에 다시)
    }
    if (!claimed) {
      result.skipped += 1;
      continue;
    }

    let draft = null;
    try {
      const row = igCardRowObject_(headers, cand.values);
      const source = igCardSourceOf_(row);
      const scrubbed = igCardScrub_(source.text);
      if (scrubbed.blocked) {
        throw createAppError_('ERR_BLOCKED_PII', '개인정보로 보이는 값이 있어 전송하지 않았습니다.', {
          patterns: scrubbed.remainingPatterns
        });
      }

      igCardConsumeBudget_(dayCompact);
      const callRes = igCardGeminiCall_(model, igCardPrompt_(row, scrubbed.text), apiKey);
      if (!callRes.ok) {
        if (callRes.status === 'SKIPPED_429') {
          props.setProperty('GEMINI_EXHAUSTED_' + dayCompact, '1');
          igCardRefundBudget_(dayCompact);
          result.status = 'SKIPPED_429';
          throw createAppError_('ERR_GEMINI_QUOTA', '무료 한도를 다 써서 초안을 만들지 못했습니다.', {});
        }
        igCardRefundBudget_(dayCompact);
        throw createAppError_('ERR_GEMINI_CALL', '초안 생성 호출이 실패했습니다.', { http_code: callRes.httpCode || 0 });
      }

      const parsed = igCardParseDraft_(callRes.rawText, row);
      if (!parsed.ok) {
        throw createAppError_('ERR_IG_CARD_DRAFT_INVALID', '초안 JSON 을 해석하지 못했습니다.', { reason: parsed.reason });
      }
      draft = parsed.draft;
      draft.tokens_est = callRes.totalTokenCount || 0;
      draft.flags = draft.flags || {};
      draft.flags.pii_masked = scrubbed.text !== source.text;

      const saved = igCardSaveDraft_(sheet, headers, col, cand.rowIndex, row, draft);
      draft.draft_file_id = saved.file_id;
      draft.draft_url = saved.draft_url;
      draft.carousel_count = draft.slides.length;

      // 시트 반영 — 넘어온 4칸만 쓴다(40칸 불변)
      sheet.getRange(cand.rowIndex, col.payload_file_id + 1).setValue(saved.payload_file_id || '');
      if (!String(cand.values[col.media_drive_url] || '').trim() && saved.folder_url) {
        sheet.getRange(cand.rowIndex, col.media_drive_url + 1).setValue(saved.folder_url);
      }
      sheet.getRange(cand.rowIndex, col.ig_carousel_count + 1).setValue(draft.slides.length);
      const stage = String(cand.values[col.status] || '').trim().toUpperCase();
      if (stage === 'DRAFT' || stage === 'GENERATING' || stage === '') {
        sheet.getRange(cand.rowIndex, col.status + 1).setValue('REVIEW');
      }
      sheet.getRange(cand.rowIndex, col.ig_feed_status + 1).setValue(IG_CARD_STATUS_READY_);

      props.deleteProperty('IG_CARD_CLAIM_' + contentId);

      result.drafted.push({
        content_id: contentId,
        carousel_count: draft.slides.length,
        summary: draft.summary,
        model: model
      });
      igCardLog_(ss, {
        brand: row.brand, contentId: contentId, taskType: 'ig_card_draft', status: 'OK',
        errorCode: '', detail: 'slides=' + draft.slides.length + ' tokens=' + draft.tokens_est
      });
    } catch (err) {
      const code = (err && err.code) || 'ERR_IG_CARD_DRAFT';
      igCardRestore_(sheet, col, cand.rowIndex, contentId);
      result.failed.push({ content_id: contentId, code: code, message: sanitizeErrorDetail_((err && err.message) || '') });
      igCardLog_(ss, {
        brand: String(cand.values[col.brand] || ''), contentId: contentId, taskType: 'ig_card_draft',
        status: 'ERROR', errorCode: code, detail: (err && err.message) || ''
      });
      if (result.status === 'SKIPPED_429') break;
    }
  }

  result.budget = { used: igCardBudgetUsed_(dayCompact), cap: IG_CARD_DAY_CAP_ };
  if (result.failed.length && !result.drafted.length && result.status === 'OK') result.status = 'FAILED';
  result.remaining_queued = igCardReadRows_(sheet, headers).filter(function (r) {
    return String(r.values[col.ig_feed_status] || '').trim() === IG_CARD_STATUS_QUEUED_;
  }).length;
  return result;
}

/* ── 시트 읽기·쓰기 ───────────────────────────────────────────────── */

function igCardSpreadsheet_() {
  try {
    return SpreadsheetApp.getActiveSpreadsheet();
  } catch (e) {
    return null;
  }
}

function igCardHeaders_(sheet) {
  const lastCol = sheet.getLastColumn();
  if (!lastCol) throw createAppError_('ERR_IG_CARD_SCHEMA', 'Contents 시트 헤더가 비어 있습니다.');
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h || '').trim(); });
  return headers;
}

/** 열 이름 → 0부터 시작하는 자리. 하나라도 없으면 덮어쓰지 않고 멈춘다. */
function igCardCols_(headers) {
  const map = {};
  const missing = [];
  IG_CARD_REQUIRED_COLS_.forEach(function (name) {
    const idx = headers.indexOf(name);
    if (idx < 0) missing.push(name);
    map[name] = idx;
  });
  if (missing.length) {
    throw createAppError_('ERR_IG_CARD_SCHEMA',
      'Contents 시트에 필요한 열이 없습니다(새 열을 붙이지 않습니다): ' + missing.join(', '), { missing: missing });
  }
  return map;
}

/** [{rowIndex(1부터), values}] — 헤더 길이만큼 잘라 읽는다. */
function igCardReadRows_(sheet, headers) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  return values.map(function (line, i) {
    return { rowIndex: i + 2, values: line };
  });
}

function igCardRowObject_(headers, line) {
  const row = {};
  for (let i = 0; i < headers.length; i += 1) row[headers[i]] = line[i];
  return row;
}

function igCardRowIndex_(sheet, headers, contentId) {
  const idCol = headers.indexOf('content_id');
  if (idCol < 0) throw createAppError_('ERR_IG_CARD_SCHEMA', 'Contents 시트에 content_id 열이 없습니다.');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const ids = sheet.getRange(2, idCol + 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i += 1) {
    if (String(ids[i][0] || '').trim() === contentId) return i + 2;
  }
  return -1;
}

/** queued(또는 회수 대상 drafting)일 때만 drafting 으로 바꾼다 — 두 번 돌아도 한 번만 만든다. */
function igCardClaim_(sheet, col, rowIndex, contentId) {
  const props = PropertiesService.getScriptProperties();
  return withWriteLock_(function () {
    const cur = String(sheet.getRange(rowIndex, col.ig_feed_status + 1).getValue() || '').trim();
    const reclaim = cur === IG_CARD_STATUS_DRAFTING_ && igCardClaimStale_(contentId);
    if (cur !== IG_CARD_STATUS_QUEUED_ && !reclaim) return false;
    sheet.getRange(rowIndex, col.ig_feed_status + 1).setValue(IG_CARD_STATUS_DRAFTING_);
    props.setProperty('IG_CARD_CLAIM_' + contentId, String(nowMs_()));
    return true;
  });
}

function igCardClaimStale_(contentId) {
  const raw = PropertiesService.getScriptProperties().getProperty('IG_CARD_CLAIM_' + contentId);
  const at = Number(raw) || 0;
  return !at || (nowMs_() - at) > IG_CARD_CLAIM_STALE_MS_;
}

/**
 * 멈춘 'drafting' 을 queued 로 되돌린다(2026-11-28) — 다음 실행이 있어야만 풀리던 것을 실행 첫 보리에서 풀어 준다.
 * 기준: 선점 기록이 없거나 30분 넘은 카드. 사람이 방금 누른 실행(최근 30분)은 건드리지 않는다.
 * @returns {number} 풀어 준 장수
 */
function igCardSweepStale_(sheet, col) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const width = Math.max(col.ig_feed_status, col.content_id) + 1;
  const values = sheet.getRange(2, 1, lastRow - 1, width).getValues();
  let freed = 0;
  values.forEach(function (v, i) {
    const rowIndex = i + 2;
    if (String((v || [])[col.ig_feed_status] || '').trim() !== IG_CARD_STATUS_DRAFTING_) return;
    const contentId = String((v || [])[col.content_id] || '').trim();
    if (!contentId || !igCardClaimStale_(contentId)) return;
    withWriteLock_(function () {
      const cur = String(sheet.getRange(rowIndex, col.ig_feed_status + 1).getValue() || '').trim();
      if (cur !== IG_CARD_STATUS_DRAFTING_) return;
      sheet.getRange(rowIndex, col.ig_feed_status + 1).setValue(IG_CARD_STATUS_QUEUED_);
      PropertiesService.getScriptProperties().deleteProperty('IG_CARD_CLAIM_' + contentId);
    });
    freed += 1;
  });
  return freed;
}

/** 실패한 카드를 queued 로 되돌린다(drafting 인 것만 — 사람이 그새 바꾼 값은 건드리지 않는다). */
function igCardRestore_(sheet, col, rowIndex, contentId) {
  try {
    withWriteLock_(function () {
      const cur = String(sheet.getRange(rowIndex, col.ig_feed_status + 1).getValue() || '').trim();
      if (cur === IG_CARD_STATUS_DRAFTING_) {
        sheet.getRange(rowIndex, col.ig_feed_status + 1).setValue(IG_CARD_STATUS_QUEUED_);
      }
      PropertiesService.getScriptProperties().deleteProperty('IG_CARD_CLAIM_' + contentId);
    });
  } catch (ignoreRestoreErr) { /* 복구 실패는 아래 로그로만 남는다 */ }
}

/* ── 근거 글 · 프롬프트 ───────────────────────────────────────────── */

/** 인스타 피드를 운영하는 트랙인가 — 기준은 seeds/track_channels.json(코드마다 사본). */
function igCardTrackAllows_(brand) {
  const b = String(brand || '').trim();
  if (!b) return false;
  let sets = null;
  try { sets = (typeof TRACK_CHANNELS !== 'undefined') ? TRACK_CHANNELS : null; } catch (e) { sets = null; }
  if (!sets) sets = { daejeon_youth: ['blog', 'shorts', 'reels', 'feed', 'clip', 'daangn'], ppiyak_kimmary: ['shorts', 'reels', 'clip'] };
  const list = sets[b];
  if (!list) return false;                  // 모르는 브랜드는 만들지 않는다
  return list.indexOf('feed') >= 0;
}

/**
 * 근거 글 — 카드 payload 의 블로그 본문 발췌 + 시트의 사실 칸.
 * (없는 값을 지어내지 않도록 '있는 것만' 넘긴다.)
 */
function igCardSourceOf_(row) {
  const bits = [];
  bits.push('상호: ' + cleanText_(row.place_name, 60));
  if (cleanText_(row.category, 30)) bits.push('분류: ' + cleanText_(row.category, 30));
  if (cleanText_(row.region_dong, 30)) bits.push('동네: ' + cleanText_(row.region_dong, 30));
  if (cleanText_(row.target_keywords, 120)) bits.push('키워드: ' + cleanText_(row.target_keywords, 120));
  if (cleanText_(row.blog_title, 80)) bits.push('블로그 제목: ' + cleanText_(row.blog_title, 80));

  const bodyText = igCardPayloadBody_(row);
  if (bodyText) bits.push('본문 발췌: ' + bodyText);

  return { text: bits.join('\n').slice(0, IG_CARD_SOURCE_MAX_CHARS_) };
}

/** payload 파일에서 블로그 본문(또는 이미 있는 피드 초안 글)을 꺼낸다. 실패하면 빈 문자열. */
function igCardPayloadBody_(row) {
  const fileId = cleanText_(row.payload_file_id, 120);
  if (!fileId) return '';
  let doc = null;
  try {
    doc = JSON.parse(DriveApp.getFileById(fileId).getBlob().getDataAsString());
  } catch (e) {
    return '';
  }
  if (!doc || typeof doc !== 'object') return '';

  const pickText = function (obj) {
    if (!obj || typeof obj !== 'object') return '';
    const keys = ['body', 'text', 'script', 'caption', 'description'];
    for (let i = 0; i < keys.length; i += 1) {
      const v = obj[keys[i]];
      if (typeof v === 'string' && v.trim()) return v;
    }
    return '';
  };

  const fromBlog = pickText(doc.blog);
  if (fromBlog) return cleanText_(fromBlog.replace(/\s+/g, ' '), 1200);
  const studio = doc.studio && doc.studio.formats && doc.studio.formats.blog && doc.studio.formats.blog.draft;
  const fromStudio = pickText(studio);
  if (fromStudio) return cleanText_(fromStudio.replace(/\s+/g, ' '), 1200);
  return '';
}

function igCardPrompt_(row, sourceText) {
  return IG_CARD_SYSTEM_PROMPT_ +
    '\n\n[출력 JSON]\n' +
    '{"summary":"한 줄 요약(60자 이내)","hook":"1장 훅 한 줄",' +
    '"slides":[{"type":"cover|body|quote|cta","kicker":"구역 이름(예: 메뉴·가격)","headline":"핵심 한 줄","body":"보충 한두 문장"}],' +
    '"caption":"캡션 3~5문장","hashtags":["#태그"]}\n\n' +
    '[카드]\n' +
    'content_id: ' + cleanText_(row.content_id, 40) + '\n' +
    'brand: ' + cleanText_(row.brand, 20) + '\n\n' +
    '[근거 — 여기 없는 사실은 쓰지 않는다]\n' + sourceText;
}

/* ── Gemini 호출 ─────────────────────────────────────────────────── */

function igCardGeminiCall_(model, prompt, apiKey) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
    encodeURIComponent(model) + ':generateContent';

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.5,
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          summary: { type: 'STRING' },
          hook: { type: 'STRING' },
          slides: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                type: { type: 'STRING', enum: ['cover', 'body', 'quote', 'cta'] },
                kicker: { type: 'STRING' },
                headline: { type: 'STRING' },
                body: { type: 'STRING' }
              },
              required: ['headline']
            }
          },
          caption: { type: 'STRING' },
          hashtags: { type: 'ARRAY', items: { type: 'STRING' } }
        },
        required: ['summary', 'slides', 'caption']
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
      if (attempt === 1) { Utilities.sleep(2000); continue; }
      return { ok: false, status: 'ERROR', httpCode: 0 };
    }

    const code = res.getResponseCode();
    lastHttpCode = code;
    const bodyText = res.getContentText() || '';

    if (code === 429 || /RESOURCE_EXHAUSTED|quota/i.test(bodyText)) {
      return { ok: false, status: 'SKIPPED_429', httpCode: 429 };
    }
    if (code >= 200 && code < 300) {
      const parsed = aiBriefSafeJsonParse_(bodyText, null);
      const parts = (parsed && parsed.candidates && parsed.candidates[0] &&
        parsed.candidates[0].content && parsed.candidates[0].content.parts) || [];
      let joined = '';
      for (let p = 0; p < parts.length; p += 1) {
        if (parts[p] && typeof parts[p].text === 'string') joined += parts[p].text;
      }
      const total = parsed && parsed.usageMetadata && typeof parsed.usageMetadata.totalTokenCount === 'number'
        ? parsed.usageMetadata.totalTokenCount : 0;
      return { ok: true, rawText: joined, totalTokenCount: total };
    }
    if (code >= 500 && attempt === 1) { Utilities.sleep(2000); continue; }
    return { ok: false, status: 'ERROR', httpCode: code };
  }
  return { ok: false, status: 'ERROR', httpCode: lastHttpCode };
}

/* ── 응답 정규화 ─────────────────────────────────────────────────── */

const IG_CARD_SLIDE_TYPES_ = ['cover', 'body', 'quote', 'cta'];

/**
 * 슬라이드 type 자리 보정(2026-11-28) — AI 가 type 을 꽃도 지키고, 빼 먹어도 카드가 산다.
 *  · 첫 장은 반드시 cover, 마지막 장은 반드시 cta(사람이 보는 표지·마무리)
 *  · 가운데 장은 body 또는 quote 만 허용(cover·cta 중복 금지)
 */
function igCardAssignTypes_(slides) {
  for (let i = 0; i < slides.length; i += 1) {
    const s = slides[i];
    if (i === 0) { s.type = 'cover'; continue; }
    if (i === slides.length - 1) { s.type = 'cta'; continue; }
    if (s.type !== 'quote') s.type = 'body';
  }
  return slides;
}

function igCardParseDraft_(rawText, row) {
  const cleaned = String(rawText || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const obj = aiBriefSafeJsonParse_(cleaned, null);
  if (!obj || typeof obj !== 'object') return { ok: false, reason: 'not_json' };

  const rawSlides = Array.isArray(obj.slides) ? obj.slides : [];
  const slides = [];
  for (let i = 0; i < rawSlides.length && slides.length < IG_CARD_MAX_SLIDES_; i += 1) {
    const s = rawSlides[i] || {};
    const headline = cleanText_(s.headline, IG_CARD_SLIDE_HEADLINE_MAX_);
    if (!headline) continue;
    slides.push({
      no: slides.length + 1,
      type: cleanText_(s.type, 8).toLowerCase(),
      kicker: cleanText_(s.kicker, 18),
      headline: headline,
      body: cleanText_(s.body, IG_CARD_SLIDE_BODY_MAX_)
    });
  }
  if (slides.length < IG_CARD_MIN_SLIDES_) {
    return { ok: false, reason: 'too_few_slides(' + slides.length + ')' };
  }
  igCardAssignTypes_(slides);

  const summary = cleanText_(obj.summary, IG_CARD_SUMMARY_MAX_) || cleanText_(slides[0].headline, IG_CARD_SUMMARY_MAX_);
  const hook = cleanText_(obj.hook, 60) || cleanText_(slides[0].headline, 60);
  const hashtags = igCardTags_(obj.hashtags, row);
  let caption = cleanText_(obj.caption, IG_CARD_CAPTION_MAX_);
  if (!caption) caption = [hook, summary, hashtags.join(' ')].filter(Boolean).join('\n\n').slice(0, IG_CARD_CAPTION_MAX_);

  const sourceText = igCardSourceOf_(row).text;
  return {
    ok: true,
    draft: {
      kind: 'ig_card_draft',
      version: 2,
      generated_at: formatKstIso_(new Date()),
      brand: cleanText_(row.brand, 20),
      aspect: '4:5',
      aspect_options: ['4:5', '3:4'],
      card_types: ['cover', 'body', 'quote', 'cta'],
      carousel_count: slides.length,
      summary: summary,
      hook: hook,
      slides: slides,
      caption: caption,
      hashtags: hashtags,
      body: caption,                                   // 화면(draftView)이 읽는 본문 이름
      source: {
        content_id: cleanText_(row.content_id, 40),
        place_name: cleanText_(row.place_name, 60),
        title: cleanText_(row.blog_title, 80)
      },
      flags: {
        fact_placeholder: /\[[^\]]*\]|채우기/.test(sourceText),
        slides_trimmed: Math.max(0, rawSlides.length - slides.length) > 0
      }
    }
  };
}

/** 해시태그 — '#' 붙이고 공백·중복을 지운다. AI 가 안 줬으면 카드 키워드로 채운다. */
function igCardTags_(raw, row) {
  const out = [];
  const add = function (t) {
    const s = String(t == null ? '' : t).replace(/[^0-9A-Za-z가-힣_]/g, '');
    const tag = s ? '#' + s : '';
    if (tag && out.indexOf(tag) < 0 && out.length < IG_CARD_HASHTAG_MAX_) out.push(tag);
  };
  if (Array.isArray(raw)) raw.forEach(add);
  if (!out.length) {
    String((row && row.target_keywords) || '').split(/[,\s]+/).forEach(add);
  }
  if (!out.length) {
    const dong = cleanText_((row && row.region_dong) || '', 12);
    add(dong ? dong + '맛집' : '맛집');
  }
  return out;
}

/* ── 드라이브 저장 ───────────────────────────────────────────────── */

/**
 * 초안 JSON 을 두 곳에 남긴다.
 *  ① 카드 payload(Contents.payload_file_id)에 `ig_feed` 키로 — 화면이 get_content_detail 로 읽는다.
 *  ② ContentHubOS_Uploads/<content_id>/ig_card_draft.json — 사람이 드라이브에서 직접 열어 본다.
 * payload_file_id 는 있는 파일을 그대로 쓰고, 없으면 새 payload 를 만든다.
 */
function igCardSaveDraft_(sheet, headers, col, rowIndex, row, draft) {
  const contentId = cleanText_(row.content_id, 40);
  const payloadId = String(sheet.getRange(rowIndex, col.payload_file_id + 1).getValue() || '').trim();

  let doc = {};
  if (payloadId) {
    try { doc = JSON.parse(DriveApp.getFileById(payloadId).getBlob().getDataAsString()) || {}; } catch (e) { doc = {}; }
  }
  doc.ig_feed = draft;
  doc.updated_at = formatKstIso_(new Date());

  let fileId = payloadId;
  if (payloadId) {
    writePayloadToFile_(payloadId, doc);
  } else {
    try { fileId = writePayload_(row.brand, contentId, doc); } catch (e) { fileId = ''; }
  }

  let folderUrl = '';
  let draftFileId = '';
  try {
    const folder = uploadFolder_(contentId, true);
    folderUrl = 'https://drive.google.com/drive/folders/' + folder.getId();
    const old = folder.getFilesByName(IG_CARD_DRAFT_FILE_);
    while (old.hasNext()) { try { old.next().setTrashed(true); } catch (e) { /* 이미 지워짐 */ } }
    const file = folder.createFile(IG_CARD_DRAFT_FILE_, JSON.stringify(draft, null, 2), 'text/plain');
    draftFileId = file.getId();
  } catch (driveErr) {
    draftFileId = '';
  }

  return {
    payload_file_id: fileId,
    file_id: draftFileId,
    folder_url: folderUrl,
    draft_url: folderUrl
  };
}

/** 승인·반려 사실을 payload 의 ig_feed.review 에 한 줄 남긴다(실패는 위에서 삼킨다). */
function igCardNoteReview_(sheet, headers, rowIndex, col, note) {
  const payloadId = String(sheet.getRange(rowIndex, col.payload_file_id + 1).getValue() || '').trim();
  if (!payloadId) return false;
  let doc = {};
  try { doc = JSON.parse(DriveApp.getFileById(payloadId).getBlob().getDataAsString()) || {}; } catch (e) { return false; }
  if (!doc || typeof doc !== 'object') return false;
  const feed = (doc.ig_feed && typeof doc.ig_feed === 'object') ? doc.ig_feed : {};
  feed.review = {
    decision: note.decision,
    reason: note.reason || '',
    by: note.by || 'user',
    at: formatKstIso_(new Date())
  };
  doc.ig_feed = feed;
  writePayloadToFile_(payloadId, doc);
  return true;
}

/* ── 예산 · 개인정보 · 로그 ──────────────────────────────────────── */

function igCardBudgetUsed_(dayCompact) {
  const raw = PropertiesService.getScriptProperties().getProperty('IG_CARD_CNT_' + dayCompact);
  return Number(raw) || 0;
}

function igCardConsumeBudget_(dayCompact) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) {
    throw createAppError_('ERR_BUSY', '다른 초안 작업이 실행 중입니다. 잠시 후 다시 시도하세요.');
  }
  try {
    const props = PropertiesService.getScriptProperties();
    const key = 'IG_CARD_CNT_' + dayCompact;
    const used = Number(props.getProperty(key)) || 0;
    if (used >= IG_CARD_DAY_CAP_) {
      throw createAppError_('ERR_IG_CARD_BUDGET', '오늘 초안 호출 상한을 넘었습니다.', { used: used, cap: IG_CARD_DAY_CAP_ });
    }
    props.setProperty(key, String(used + 1));
  } finally {
    lock.releaseLock();
  }
}

function igCardRefundBudget_(dayCompact) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) return;
  try {
    const props = PropertiesService.getScriptProperties();
    const key = 'IG_CARD_CNT_' + dayCompact;
    const used = Number(props.getProperty(key)) || 0;
    if (used > 0) props.setProperty(key, String(used - 1));
  } finally {
    lock.releaseLock();
  }
}

/** AI_Brief 의 스크러버를 그대로 쓴다(규칙을 두 벌로 두지 않는다). 없으면 그대로 통과. */
function igCardScrub_(text) {
  if (typeof aiBriefScrubPii_ === 'function') return aiBriefScrubPii_(text);
  return { text: String(text || ''), blocked: false, remainingPatterns: [] };
}

function igCardLog_(ss, entry) {
  const e = entry || {};
  try {
    withWriteLock_(function () {
      const sheet = ss.getSheetByName('Channel_Logs');
      if (!sheet) return;
      const now = new Date();
      sheet.appendRow([
        'LOG-' + Utilities.formatDate(now, 'Asia/Seoul', 'yyyyMMddHHmmss') + '-' + Math.floor(100 + Math.random() * 900),
        e.brand || 'SYSTEM',
        e.contentId || '',
        'feed',
        e.taskType || 'ig_card_draft',
        '',
        'ig-card',
        '',
        '',
        e.status || 'OK',
        0,
        e.errorCode || '',
        e.detail ? sanitizeErrorDetail_(e.detail) : '',
        formatKstIso_(now),
        '',
        0
      ]);
    });
  } catch (ignoreLogErr) { /* 로그 실패가 초안을 막지 않게 */ }
}

/* ── 트리거 (편집기에서 한 번 실행) ──────────────────────────────── */

/**
 * 매일 02:30 KST 초안 트리거를 설치한다(여러 번 실행해도 하나만 남는다).
 */
function installIgCardDraftTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i += 1) {
    if (triggers[i].getHandlerFunction() === IG_CARD_TRIGGER_HANDLER_) {
      return { installed: false, note: 'already_exists', schedule: '02:30 Asia/Seoul' };
    }
  }
  ScriptApp.newTrigger(IG_CARD_TRIGGER_HANDLER_)
    .timeBased()
    .inTimezone('Asia/Seoul')
    .atHour(2)
    .nearMinute(30)
    .everyDays(1)
    .create();
  return { installed: true, schedule: '02:30 Asia/Seoul' };
}

function removeIgCardDraftTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;
  for (let i = 0; i < triggers.length; i += 1) {
    if (triggers[i].getHandlerFunction() === IG_CARD_TRIGGER_HANDLER_) {
      ScriptApp.deleteTrigger(triggers[i]);
      removed += 1;
    }
  }
  return { removed: removed };
}

/** 외부 호출 없이 키·과금인지·트리거·대기 카드 수만 점검한다(키 값은 절대 돌려주지 않는다). */
function igCardSelfTest() {
  const now = new Date();
  const day = kstDay_(now);
  const dayCompact = day.replace(/-/g, '');
  const ymCompact = dayCompact.slice(0, 6);
  const props = PropertiesService.getScriptProperties();

  let queued = 0;
  let sheetStatus = 'NO_SHEET';
  const ss = igCardSpreadsheet_();
  const sheet = ss ? ss.getSheetByName('Contents') : null;
  if (sheet) {
    try {
      const headers = igCardHeaders_(sheet);
      const col = igCardCols_(headers);
      queued = igCardReadRows_(sheet, headers).filter(function (r) {
        return String(r.values[col.ig_feed_status] || '').trim() === IG_CARD_STATUS_QUEUED_;
      }).length;
      sheetStatus = 'OK';
    } catch (e) {
      sheetStatus = (e && e.code) || 'ERR_IG_CARD_SCHEMA';
    }
  }

  const ackRaw = cleanText_(props.getProperty('GEMINI_BILLING_ACK_' + ymCompact), 16);
  return {
    ok: true,
    day: day,
    has_api_key: Boolean(cleanText_(props.getProperty('GEMINI_API_KEY'), 256)),
    billing_ack: Boolean(ackRaw && (ackRaw === '1' || ackRaw.toLowerCase() === 'true')),
    billing_ack_key: 'GEMINI_BILLING_ACK_' + ymCompact,
    default_model: IG_CARD_MODEL_DEFAULT_,
    allowed_models: IG_CARD_MODELS_.slice(),
    used_today: igCardBudgetUsed_(dayCompact),
    cap_today: IG_CARD_DAY_CAP_,
    exhausted_429: props.getProperty('GEMINI_EXHAUSTED_' + dayCompact) === '1',
    trigger_installed: ScriptApp.getProjectTriggers().some(function (t) {
      return t.getHandlerFunction() === IG_CARD_TRIGGER_HANDLER_;
    }),
    queued_cards: queued,
    sheet_status: sheetStatus
  };
}
