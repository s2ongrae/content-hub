/**
 * gas/Backup.gs  —  자동 스냅샷 · 보존 정책 · 원클릭 복구 · 무결성 점검
 * Content Hub OS
 *
 * 트리거 (Setup.gs 가 설치)
 *  - runDailyBackupTrigger     매일 03:00 KST  : 시트 사본 + payload 배치 + 매니페스트 + 보존 정리
 *  - runIntegrityCheckTrigger  매일 05:00 KST  : 무결성 점검(백업과 분리 · 4분 30초마다 끊고 이어하기)
 *  - runWeeklyBackupTrigger    매주 일 03:30   : 주간 보관본
 *  - runMonthlyBackupTrigger   매월 1일 04:00  : 월간 보관본
 *  - runMaintenanceTrigger     15분마다        : 끊긴 백업 이어하기 · 만료 리스 회수 · Ops_Queue 재적용
 *
 * 설계 원칙
 *  - 시트는 새 스프레드시트에 시트별 copyTo — 수식·서식·모든 시트 보존, 6분 예산 안전.
 *    (파일 통째 makeCopy 는 컨테이너 바인딩 Apps Script 까지 복제해 백업 때마다 스크립트 사본이 쌓여 쓰지 않는다 — 2026-11-20)
 *  - payload는 폴더 복사 API가 없어 파일별 복사. 80개/배치 + 이어하기 커서.
 *  - 모든 스냅샷에 backup_manifest.json 을 남겨 복구 전에 기계 검증.
 *  - 원본 덮어쓰기 금지: 복구는 항상 "사본 + restored_YYYYMMDD/" 로만.
 *  - 토큰·민감정보는 스냅샷에 절대 포함하지 않는다(config_presets 는 토큰 키 제외).
 */

const BACKUP_KEEP_ = { DAILY: 14, WEEKLY: 8, MONTHLY: 6, MANUAL: 10 };
const BACKUP_BATCH_SIZE_ = 80;
const BACKUP_RESUME_DELAY_MIN_ = 5;

/* ------------------------------------------------------------------ *
 * 트리거 핸들러 (조용히 죽지 않게 — 실패도 기록)
 * ------------------------------------------------------------------ */

function runDailyBackupTrigger() {
  // 백업은 이미 약 4분을 쓴다 — 무결성 점검을 같은 실행에 이으면 6분 한도를 넘어 강제 종료된다(2026-11-20). 점검은 별도 트리거.
  runTriggerSafely_('DAILY', function () {
    return runBackupPipeline_('DAILY', 'trigger');
  });
}

/** 무결성 점검 트리거(매일 05:00 KST) — 한 번에 4분 30초까지만 돌고, 남으면 이어하기 트리거를 예약한다. */
function runIntegrityCheckTrigger() {
  runTriggerSafely_('INTEGRITY', function () {
    return runIntegrityCheck_('trigger');
  });
}

/** 무결성 점검 이어하기용 1회성 트리거 */
function runIntegrityResumeTrigger() {
  try {
    PropertiesService.getScriptProperties().deleteProperty('INTEGRITY_RESUME_SCHEDULED');
    // 이미 지나간 1회성 트리거가 쌓이지 않게 자기 자신 종류는 정리한다
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (t.getHandlerFunction() === 'runIntegrityResumeTrigger') {
        try { ScriptApp.deleteTrigger(t); } catch (e) { /* 이미 지워짐 */ }
      }
    });
    runIntegrityCheck_('resume');
  } catch (err) {
    recordBackupFailure_('INTEGRITY', err);
  }
}

function runWeeklyBackupTrigger() {
  runTriggerSafely_('WEEKLY', function () {
    return runBackupPipeline_('WEEKLY', 'trigger');
  });
}

function runMonthlyBackupTrigger() {
  runTriggerSafely_('MONTHLY', function () {
    return runBackupPipeline_('MONTHLY', 'trigger');
  });
}

function runMaintenanceTrigger() {
  try {
    continuePendingBackup_();
  } catch (err) {
    Logger.log('maintenance:continuePendingBackup 실패: ' + sanitizeErrorDetail_(err.message));
  }
  try {
    reapExpiredLeases_();
  } catch (err) {
    Logger.log('maintenance:reapExpiredLeases 실패: ' + sanitizeErrorDetail_(err.message));
  }
  try {
    drainOpsQueue_();
  } catch (err) {
    Logger.log('maintenance:drainOpsQueue 실패: ' + sanitizeErrorDetail_(err.message));
  }
  try {
    checkAndNotifyHealth_();   // Notify.gs — 백업 실패·쿼터 80%·NEEDS_HUMAN 적체
  } catch (err) {
    Logger.log('maintenance:checkAndNotifyHealth 실패: ' + sanitizeErrorDetail_(err.message));
  }
}

/** 이어하기용 1회성 트리거 */
function runBackupResumeTrigger() {
  try {
    continuePendingBackup_();
  } catch (err) {
    recordBackupFailure_('RESUME', err);
  }
}

function runTriggerSafely_(tier, fn) {
  try {
    fn();
  } catch (err) {
    recordBackupFailure_(tier, err);
  }
}

function recordBackupFailure_(tier, err) {
  const p = PropertiesService.getScriptProperties();
  p.setProperty('LAST_BACKUP_FAILURE_AT', formatKstIso_(new Date()));
  p.setProperty('LAST_BACKUP_FAILURE_TIER', String(tier));
  p.setProperty('LAST_BACKUP_FAILURE_MSG', sanitizeErrorDetail_(err && err.message));
  // 5분 쿼터류 오류면 서킷브레이커 발동
  if (isQuotaError_(err)) recordQuotaFailure_(err.message);
  try {
    appendSystemHealth_({
      eventType: 'BACKUP_' + tier,
      status: 'FAILED',
      detail: sanitizeErrorDetail_(err && err.message)
    });
  } catch (e) { /* 로그 실패는 무시 */ }
}

/* ------------------------------------------------------------------ *
 * 폴더 보장
 * ------------------------------------------------------------------ */

function ensureBackupFolders_() {
  const props = PropertiesService.getScriptProperties();
  let rootId = props.getProperty('BACKUP_ROOT_FOLDER_ID');
  let root;
  try {
    root = rootId ? DriveApp.getFolderById(rootId) : null;
  } catch (err) { root = null; }

  if (!root) {
    const it = DriveApp.getRootFolder().getFoldersByName('ContentHubOS_Backups');
    root = it.hasNext() ? it.next() : DriveApp.getRootFolder().createFolder('ContentHubOS_Backups');
    rootId = root.getId();
    props.setProperty('BACKUP_ROOT_FOLDER_ID', rootId);
  }

  const need = { BACKUP_DAILY_FOLDER_ID: 'daily', BACKUP_WEEKLY_FOLDER_ID: 'weekly',
                 BACKUP_MONTHLY_FOLDER_ID: 'monthly', BACKUP_RESTORED_FOLDER_ID: 'restored' };
  const out = {};
  Object.keys(need).forEach(function (propKey) {
    const name = need[propKey];
    let id = props.getProperty(propKey);
    let folder = null;
    try { folder = id ? DriveApp.getFolderById(id) : null; } catch (err) { folder = null; }
    if (!folder) {
      const it = root.getFoldersByName(name);
      folder = it.hasNext() ? it.next() : root.createFolder(name);
      props.setProperty(propKey, folder.getId());
    }
    try { folder.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); } catch (err) { /* 이미 비공개 */ }
    out[name] = folder;
  });
  return out;
}

function payloadFolders_() {
  const p = PropertiesService.getScriptProperties();
  const ids = [
    p.getProperty('FOLDER_DAEJEON_YOUTH'),
    p.getProperty('FOLDER_PPIYAK_KIMMARY'),
    p.getProperty('FOLDER_BENCHMARKS')
  ].filter(Boolean);
  const out = [];
  ids.forEach(function (id) {
    try { out.push(DriveApp.getFolderById(id)); } catch (err) { /* 사라진 폴더는 무시 */ }
  });
  return out;
}

/* ------------------------------------------------------------------ *
 * 백업 본체
 * ------------------------------------------------------------------ */

/**
 * @param {'DAILY'|'WEEKLY'|'MONTHLY'|'MANUAL'} tier
 * @param {string} actor
 */
function runBackupPipeline_(tier, actor) {
  const started = nowMs_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const folders = ensureBackupFolders_();
  const folder = tier === 'WEEKLY' ? folders.weekly
    : tier === 'MONTHLY' ? folders.monthly : folders.daily;

  const stamp = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMdd_HHmmss');
  const snapshotName = 'SNAPSHOT_' + tier + '_' + stamp;

  // 1) 설정 프리셋 JSON (토큰 제외)
  exportConfigPresets_(ss, folder, snapshotName);

  // 2) 스프레드시트 사본 — 수식·서식·전 시트 보존, 바인딩된 Apps Script 는 복제하지 않는다
  //    (makeCopy 를 쓰면 백업 때마다 'ContentHub M1 API 사본' 프로젝트가 1개씩 쌓였다)
  let sheetCopy = null;
  let sheetCopyReport = null;
  try {
    const made = copySpreadsheetWithoutScript_(ss, snapshotName + '_SHEETS', folder);
    sheetCopy = made.file;
    sheetCopyReport = made.report;
  } catch (err) {
    recordBackupFailure_(tier, err);
    throw err;
  }

  // 3) payload 배치 복사 시작 (커서 저장)
  const state = {
    tier: tier,
    actor: actor || 'system',
    snapshotName: snapshotName,
    folderId: folder.getId(),
    sheetsFileId: sheetCopy.getId(),
    sheetsFileSize: sheetCopy.getSize(),
    sheetCopyReport: sheetCopyReport,
    payloadIndex: 0,
    copied: [],          // {name, size, fileId, fingerprint}
    startedAt: nowMs_(),
    totalPayloads: 0
  };
  saveBackupState_(state);

  const batch = copyPayloadBatch_(state, BACKUP_BATCH_SIZE_);
  state.copied = batch.copied;
  state.totalPayloads = batch.total;
  saveBackupState_(state);

  if (!batch.done) {
    // 6분 예산 보호: 남은 파일은 5분 뒤 이어하기
    scheduleResume_();
    appendSystemHealth_({
      eventType: 'BACKUP_' + tier,
      status: 'PARTIAL_CONTINUE',
      snapshotFolderName: snapshotName,
      sheetsCopied: 1,
      payloadsCopied: state.copied.length,
      detail: 'payload ' + state.copied.length + '/' + batch.total + ' 복사 후 이어하기 예약'
    });
    return { ok: true, partial: true, copied: state.copied.length, total: batch.total, snapshot: snapshotName };
  }

  // 4) 매니페스트 + 보존 정리 + 기록
  const manifest = writeManifest_(ss, folder, snapshotName, sheetCopy, state.copied, state.sheetCopyReport);
  applyRetention_(tier, folder);
  clearBackupState_();

  appendSystemHealth_({
    eventType: 'BACKUP_' + tier,
    status: 'SUCCESS',
    snapshotFolderName: snapshotName,
    sheetsCopied: 1,
    payloadsCopied: state.copied.length,
    totalBytes: manifest.total_bytes,
    manifestHash: manifest.manifest_hash,
    actor: state.actor,
    detail: 'sheets=' + sheetCopy.getId() + ' elapsed_ms=' + (nowMs_() - started)
  });

  PropertiesService.getScriptProperties().setProperty('LAST_BACKUP_OK_AT', formatKstIso_(new Date()));
  PropertiesService.getScriptProperties().setProperty('LAST_BACKUP_OK_TIER', tier);

  return { ok: true, partial: false, copied: state.copied.length, snapshot: snapshotName,
           manifest_hash: manifest.manifest_hash };
}

/**
 * 스프레드시트를 "바인딩된 Apps Script 없이" 복사한다.
 *  새 스프레드시트를 만들고 시트를 하나씩 copyTo(값·수식·서식·데이터 검증·조건부 서식·고정 행 유지) 한 뒤
 *  이름·순서를 원본과 맞추고 백업 폴더로 옮긴다. 도중에 실패하면 반쪽 사본은 휴지통으로 보낸다.
 * @return {{file: GoogleAppsScript.Drive.File, report: {sheets: number, mismatches: string[]}}}
 */
function copySpreadsheetWithoutScript_(srcSs, name, folder) {
  const target = SpreadsheetApp.create(name);
  const targetId = target.getId();
  try {
    const report = { sheets: 0, mismatches: [] };
    // 새 파일이 가진 기본 시트가 원본 시트 이름과 겹치지 않게 임시 이름을 붙여 두고, 끝나면 지운다
    const tmp = target.getSheets()[0];
    tmp.setName('__backup_tmp__');
    srcSs.getSheets().forEach(function (src) {
      const copy = src.copyTo(target);          // 이름이 'Copy of …' 로 만들어진다
      copy.setName(src.getName());
      if (src.isSheetHidden()) copy.hideSheet();
      report.sheets++;
      if (copy.getLastRow() !== src.getLastRow() || copy.getLastColumn() !== src.getLastColumn()) {
        report.mismatches.push(src.getName());
      }
    });
    target.deleteSheet(tmp);
    const file = DriveApp.getFileById(targetId);
    file.moveTo(folder);                        // 드라이브 루트에 남지 않게 백업 폴더로
    return { file: file, report: report };
  } catch (err) {
    try { DriveApp.getFileById(targetId).setTrashed(true); } catch (e) { /* 이미 없음 */ }
    throw err;
  }
}

function exportConfigPresets_(ss, folder, snapshotName) {
  const presets = { exported_at: formatKstIso_(new Date()), Config: [], Brand_Config: [], Prompt_Rules: [] };
  ['Config', 'Brand_Config', 'Prompt_Rules'].forEach(function (name) {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return;
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return;
    const values = sheet.getRange(1, 1, lastRow, sheet.getLastColumn()).getValues();
    const headers = values[0];
    presets[name] = values.slice(1).map(function (row) {
      const obj = {};
      headers.forEach(function (h, i) {
        if (/token|secret/i.test(String(h))) { obj[h] = '[EXCLUDED]'; return; }  // 토큰 절대 미포함
        obj[h] = row[i];
      });
      return obj;
    });
  });
  const json = JSON.stringify(presets, null, 2);
  folder.createFile(snapshotName + '_config_presets.json', json, MimeType.PLAIN_TEXT);
}

/* ------------------------------------------------------------------ *
 * payload 배치 복사 + 이어하기
 * ------------------------------------------------------------------ */

function copyPayloadBatch_(state, batchSize) {
  const dest = DriveApp.getFolderById(state.folderId);
  const sources = payloadFolders_();
  const all = [];
  sources.forEach(function (folder) {
    const it = folder.getFiles();
    while (it.hasNext()) all.push(it.next());
  });

  const total = all.length;
  let i = state.payloadIndex || 0;
  const copied = state.copied || [];
  const limit = Math.min(i + batchSize, total);

  for (; i < limit; i++) {
    const f = all[i];
    // 스냅샷별 고유 이름: 같은 파일을 매번 새로 복사하고, 보존정리 때 함께 지운다
    const name = state.snapshotName + '_' + f.getName();
    try {
      const existing = dest.getFilesByName(name);
      if (existing.hasNext()) {
        const ex = existing.next();
        copied.push({ name: name, size: ex.getSize(), fileId: ex.getId(), fingerprint: fingerprintOf_(ex) });
        continue;
      }
      const copy = f.makeCopy(name, dest);
      copied.push({ name: name, size: copy.getSize(), fileId: copy.getId(), fingerprint: fingerprintOf_(copy) });
    } catch (err) {
      copied.push({ name: name, size: 0, fileId: '', fingerprint: 'ERROR:' + sanitizeErrorDetail_(err.message) });
    }
  }

  state.payloadIndex = i;
  saveBackupState_(state);
  return { copied: copied, total: total, done: i >= total };
}

/** 값이 아니라 "앞 4KB + 크기" 지문 — 수 MB 파일을 전부 읽지 않기 위한 절충.
 *  주의: Apps Script Blob.getBytes()는 전체를 메모리에 올린 뒤 slice하므로,
 *  큰 파일에서는 getId()+크기 기반 경량 지문으로 전환해 OOM 을 막는다. */
function fingerprintOf_(file) {
  try {
    const size = file.getSize();
    if (size > 5 * 1024 * 1024) {
      return 'LARGE:' + file.getId().slice(-8) + ':' + size;
    }
    const blob = file.getBlob();
    const bytes = blob.getBytes();
    const head = bytes.slice(0, Math.min(4096, bytes.length));
    const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, head);
    return sha256Hex_(digest.join(',') + ':' + bytes.length).slice(0, 16);
  } catch (err) {
    return 'FP_ERR';
  }
}

function saveBackupState_(state) {
  PropertiesService.getScriptProperties().setProperty('BACKUP_STATE', JSON.stringify(state));
}

function loadBackupState_() {
  const raw = PropertiesService.getScriptProperties().getProperty('BACKUP_STATE');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (err) { return null; }
}

function clearBackupState_() {
  PropertiesService.getScriptProperties().deleteProperty('BACKUP_STATE');
  PropertiesService.getScriptProperties().deleteProperty('BACKUP_RESUME_SCHEDULED');
}

function continuePendingBackup_() {
  const state = loadBackupState_();
  if (!state) return null;

  const batch = copyPayloadBatch_(state, BACKUP_BATCH_SIZE_);
  state.copied = batch.copied;
  if (!batch.done) {
    scheduleResume_();
    return { ok: true, partial: true, copied: batch.copied.length, total: batch.total };
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dest = DriveApp.getFolderById(state.folderId);
  let sheetFile = null;
  try { sheetFile = DriveApp.getFileById(state.sheetsFileId); } catch (err) { sheetFile = null; }

  const manifest = writeManifest_(ss, dest, state.snapshotName, sheetFile, state.copied, state.sheetCopyReport);
  applyRetention_(state.tier, dest);
  appendSystemHealth_({
    eventType: 'BACKUP_' + state.tier,
    status: 'SUCCESS',
    snapshotFolderName: state.snapshotName,
    sheetsCopied: 1,
    payloadsCopied: state.copied.length,
    totalBytes: manifest.total_bytes,
    manifestHash: manifest.manifest_hash,
    actor: state.actor,
    detail: 'resumed_elapsed_ms=' + (nowMs_() - (state.startedAt || nowMs_()))
  });
  clearBackupState_();
  PropertiesService.getScriptProperties().setProperty('LAST_BACKUP_OK_AT', formatKstIso_(new Date()));
  return { ok: true, partial: false, copied: state.copied.length, snapshot: state.snapshotName };
}

function scheduleResume_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('BACKUP_RESUME_SCHEDULED') === '1') return;
  const soon = new Date(Date.now() + BACKUP_RESUME_DELAY_MIN_ * 60 * 1000);
  ScriptApp.newTrigger('runBackupResumeTrigger').timeBased().at(soon).create();
  props.setProperty('BACKUP_RESUME_SCHEDULED', '1');
}

/* ------------------------------------------------------------------ *
 * 매니페스트 · 보존
 * ------------------------------------------------------------------ */

function writeManifest_(ss, folder, snapshotName, sheetFile, copied, sheetCopyReport) {
  const sheets = ss.getSheets().map(function (sh) {
    const headers = sh.getLastColumn() > 0
      ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String)
      : [];
    return {
      name: sh.getName(),
      rows: Math.max(0, sh.getLastRow() - 1),
      cols: sh.getLastColumn(),
      header_hash: sha256Hex_(headers.join('|')).slice(0, 12)
    };
  });

  const payloads = (copied || []).map(function (c) {
    return { name: c.name, size: c.size, fingerprint: c.fingerprint, file_id: c.fileId };
  });
  const totalBytes = payloads.reduce(function (s, p) { return s + (p.size || 0); }, 0)
    + (sheetFile ? sheetFile.getSize() : 0);

  const manifest = {
    snapshot_name: snapshotName,
    created_at: formatKstIso_(new Date()),
    timezone: 'Asia/Seoul',
    schema_version: 'v2',
    sheet_file_id: sheetFile ? sheetFile.getId() : '',
    sheet_file_size: sheetFile ? sheetFile.getSize() : 0,
    sheets: sheets,
    sheet_copy_check: sheetCopyReport || null,
    payload_count: payloads.length,
    payloads: payloads,
    total_bytes: totalBytes
  };
  manifest.manifest_hash = sha256Hex_(JSON.stringify(manifest)).slice(0, 24);

  folder.createFile(snapshotName + '_backup_manifest.json',
    JSON.stringify(manifest, null, 2), MimeType.PLAIN_TEXT);
  return manifest;
}

/**
 * 파일 이름 → 스냅샷 묶음 키.  SNAPSHOT_DAILY_20261120_030015_SHEETS / _backup_manifest.json / _config_presets.json /
 * _payload_xxx.json 은 모두 같은 스냅샷 SNAPSHOT_DAILY_20261120_030015 이다. 규칙에 안 맞는 이름은 null(건드리지 않는다).
 */
function snapshotKeyOf_(name) {
  const m = String(name || '').match(/^(SNAPSHOT_(DAILY|WEEKLY|MONTHLY|MANUAL)_(\d{8}_\d{6}))(?:_|$)/);
  return m ? { key: m[1], tier: m[2], stamp: m[3] } : null;
}

/**
 * 보존 정리 — 스냅샷(타임스탬프까지 같은 파일들의 묶음) 단위로 keep 개만 남기고 오래된 묶음을 휴지통으로 보낸다.
 *  (2026-11-20 수정: 예전에는 payload 파일 하나하나가 스냅샷 하나로 세어져 14일 보관이 2일치로 줄었다)
 *  · 같은 tier 의 스냅샷만 센다(수동 백업이 일일 보관 칸을 차지하거나 지워지지 않게).
 *  · 최신 3개는 keep 이 얼마든 보호하고, 지금 이어하기 중인 스냅샷은 건드리지 않는다.
 * @return {{kept: string[], trashed: string[]}}
 */
function applyRetention_(tier, folder) {
  const keep = BACKUP_KEEP_[tier];
  if (!keep) return { kept: [], trashed: [] };

  const groups = {};
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    const parsed = snapshotKeyOf_(f.getName());
    if (!parsed || parsed.tier !== tier) continue;
    const g = groups[parsed.key] || (groups[parsed.key] = { stamp: parsed.stamp, files: [] });
    g.files.push(f);
  }

  // 최신 먼저 — 키의 타임스탬프(yyyyMMdd_HHmmss)는 글자 순서가 곧 시간 순서다
  const keys = Object.keys(groups).sort(function (a, b) {
    return groups[a].stamp < groups[b].stamp ? 1 : (groups[a].stamp > groups[b].stamp ? -1 : 0);
  });

  const pending = loadBackupState_();
  const pendingName = pending && pending.snapshotName ? String(pending.snapshotName) : '';
  const keepN = Math.max(keep, 3);
  const trashed = [];
  keys.slice(keepN).forEach(function (k) {
    if (k === pendingName) return;
    groups[k].files.forEach(function (f) {
      try { f.setTrashed(true); } catch (err) { /* 이미 없음 */ }
    });
    trashed.push(k);
  });
  return { kept: keys.slice(0, keepN), trashed: trashed };
}

function appendSystemHealth_(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('System_Health');
  if (!sheet) return;
  const id = 'SYS-' + Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMddHHmmss')
    + '-' + Math.floor(100 + Math.random() * 900);
  sheet.appendRow([
    id,
    payload.eventType || 'UNKNOWN',
    payload.status || 'INFO',
    payload.snapshotFolderName || '',
    payload.sheetsCopied || 0,
    payload.payloadsCopied || 0,
    payload.totalBytes || 0,
    payload.manifestHash || '',
    payload.actor || 'system',
    payload.detail || '',
    formatKstIso_(new Date())
  ]);
}

/* ------------------------------------------------------------------ *
 * 복구 — 원본 덮어쓰기 금지, 항상 사본으로
 * ------------------------------------------------------------------ */

/**
 * @param {string} snapshotDate YYYYMMDD
 * @param {string} confirmPhrase 'RESTORE_YYYYMMDD' (2단 확인)
 * @param {boolean} remapContents true면 Contents.payload_file_id 를 복원본으로 재매핑
 */
function restoreFromSnapshotCore_(snapshotDate, confirmPhrase, remapContents) {
  const date = String(snapshotDate || '').replace(/[^0-9]/g, '');
  if (!/^\d{8}$/.test(date)) {
    throw createAppError_('ERR_VALIDATION_FAILED', 'snapshot_date 는 YYYYMMDD 형식이어야 합니다.');
  }
  if (String(confirmPhrase || '') !== 'RESTORE_' + date) {
    throw createAppError_('ERR_VALIDATION_FAILED',
      '확인 문구가 일치하지 않습니다. confirm_phrase 에 RESTORE_' + date + ' 를 넣어 다시 호출하세요.');
  }

  const folders = ensureBackupFolders_();
  const target = findSnapshotFolder_(date, folders);
  if (!target) {
    throw createAppError_('ERR_BACKUP_STALE', date + ' 스냅샷을 찾지 못했습니다.');
  }

  // 0) 복구 직전 안전 스냅샷 (되돌리기용)
  const pre = runBackupPipeline_('MANUAL', 'system-pre-restore');

  // 1) 시트는 "사본"으로만 복원 — 원본 파일은 건드리지 않는다
  const restoredFolder = folders.restored;
  const stamp = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMdd_HHmmss');
  const restoredSsFile = target.sheetsFile.makeCopy('RESTORED_' + date + '_' + stamp, restoredFolder);

  // 2) payload 복원
  const destName = 'restored_' + date + '_' + stamp;
  const destFolder = restoredFolder.createFolder(destName);
  const map = {};
  target.payloadFiles.forEach(function (f) {
    try {
      const copy = f.makeCopy(f.getName(), destFolder);
      map[f.getName()] = copy.getId();
    } catch (err) { /* 개별 실패는 리포트에 남긴다 */ }
  });

  // 3) Contents 재매핑 (선택)
  let remapped = 0;
  if (remapContents) {
    remapped = remapContentsFromRestore_(map);
  }

  appendSystemHealth_({
    eventType: 'RESTORE',
    status: 'SUCCESS',
    snapshotFolderName: target.folder.getName(),
    sheetsCopied: 1,
    payloadsCopied: target.payloadFiles.length,
    actor: 'pickle-agent-01',
    detail: 'restored_ss=' + restoredSsFile.getId() + ' payload_folder=' + destName
      + ' remapped=' + remapped + ' pre_snapshot=' + pre.snapshot
  });

  return {
    restored_spreadsheet_id: restoredSsFile.getId(),
    restored_spreadsheet_url: restoredSsFile.getUrl(),
    restored_payload_folder: destName,
    payload_restored: Object.keys(map).length,
    payload_missing: target.payloadFiles.length - Object.keys(map).length,
    remapped_contents: remapped,
    pre_restore_snapshot: pre.snapshot
  };
}

function findSnapshotFolder_(date, folders) {
  const candidates = [folders.daily, folders.weekly, folders.monthly];
  for (let i = 0; i < candidates.length; i++) {
    const folder = candidates[i];
    const it = folder.getFiles();
    let sheetsFile = null;
    const payloadFiles = [];
    while (it.hasNext()) {
      const f = it.next();
      const n = f.getName();
      if (n.indexOf('SNAPSHOT_') !== 0) continue;
      if (n.indexOf(date) === -1) continue;
      if (/_SHEETS$/.test(n)) sheetsFile = f;
      else if (/_payload_.*\.json$/.test(n)) payloadFiles.push(f);
    }
    if (sheetsFile) return { folder: folder, sheetsFile: sheetsFile, payloadFiles: payloadFiles };
  }
  return null;
}

function remapContentsFromRestore_(fileIdByName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Contents');
  if (!sheet) return 0;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  return withWriteLock_(function () {
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    const idCol = headers.indexOf('content_id') + 1;
    const fileCol = headers.indexOf('payload_file_id') + 1;
    const updatedByCol = headers.indexOf('updated_by') + 1;
    const updatedAtCol = headers.indexOf('updated_at') + 1;
    if (idCol < 1 || fileCol < 1) return 0;

    const ids = sheet.getRange(2, idCol, lastRow - 1, 1).getValues();
    const files = sheet.getRange(2, fileCol, lastRow - 1, 1).getValues();
    let changed = 0;
    for (let i = 0; i < ids.length; i++) {
      const base = String(ids[i][0]).trim();
      // 복원 폴더의 파일명은 'SNAPSHOT_..._payload_{id}.json' 이므로 본문만 떼어 매칭
      const name = Object.keys(fileIdByName).filter(function (k) {
        return k === 'payload_' + base + '.json'
          || new RegExp('_payload_' + base.replace(/[^A-Za-z0-9_-]/g, '') + '\\.json$').test(k);
      })[0];
      if (name && fileIdByName[name]) {
        files[i][0] = fileIdByName[name];
        changed++;
      }
    }
    if (changed > 0) {
      sheet.getRange(2, fileCol, files.length, 1).setValues(files);
      if (updatedByCol > 0) {
        const by = [];
        for (let i = 0; i < ids.length; i++) by.push(['system-restore']);
        sheet.getRange(2, updatedByCol, by.length, 1).setValues(by);
      }
      if (updatedAtCol > 0) {
        const at = [];
        const now = formatKstIso_(new Date());
        for (let i = 0; i < ids.length; i++) at.push([now]);
        sheet.getRange(2, updatedAtCol, at.length, 1).setValues(at);
      }
    }
    return changed;
  });
}

/* ------------------------------------------------------------------ *
 * 무결성 점검 (6종)
 * ------------------------------------------------------------------ */

const INTEGRITY_BUDGET_MS_ = 270000;            // 한 번에 4분 30초까지만(6분 한도 안전 여유)
const INTEGRITY_RESUME_DELAY_MIN_ = 2;
const INTEGRITY_STALE_RUN_MS_ = 8 * 60 * 1000;  // 이보다 오래 '실행 중' 표시가 남아 있으면 죽은 실행으로 본다
const INTEGRITY_STATE_MAX_AGE_MS_ = 12 * 60 * 60 * 1000;
const INTEGRITY_MAX_ISSUES_ = 200;
const INTEGRITY_ORPHAN_SCAN_MAX_ = 400;         // 폴더 하나에서 훑는 파일 수

function loadIntegrityState_() {
  const raw = PropertiesService.getScriptProperties().getProperty('INTEGRITY_STATE');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (err) { return null; }
}

function saveIntegrityState_(st) {
  PropertiesService.getScriptProperties().setProperty('INTEGRITY_STATE', JSON.stringify(st));
}

function clearIntegrityState_() {
  const p = PropertiesService.getScriptProperties();
  p.deleteProperty('INTEGRITY_STATE');
  p.deleteProperty('INTEGRITY_RESUME_SCHEDULED');
}

function scheduleIntegrityResume_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('INTEGRITY_RESUME_SCHEDULED') === '1') return;
  const soon = new Date(Date.now() + INTEGRITY_RESUME_DELAY_MIN_ * 60 * 1000);
  ScriptApp.newTrigger('runIntegrityResumeTrigger').timeBased().at(soon).create();
  props.setProperty('INTEGRITY_RESUME_SCHEDULED', '1');
}

/** 본문 시트 행에서 payload_file_id → content_id 표(드라이브 호출 없음). 고아 파일 판정에 쓴다. */
function integrityReferenced_(rows) {
  const out = {};
  if (!rows.length) return out;
  const headers = rows[0].map(String);
  const idCol = headers.indexOf('content_id');
  const fileCol = headers.indexOf('payload_file_id');
  if (idCol < 0 || fileCol < 0) return out;
  for (let r = 1; r < rows.length; r++) {
    const fileId = String(rows[r][fileCol] || '').trim();
    if (fileId) out[fileId] = String(rows[r][idCol] || '').trim();
  }
  return out;
}

/**
 * 무결성 점검 (6종) — 4분 30초 안에 끝나지 않으면 상태를 저장하고 멈춘 뒤 2분 뒤 이어서 한다.
 *  단계: CONTENTS(행별 payload 파일 확인) → ORPHANS(고아 파일) → REST(스키마·공유 권한).
 *  상태는 PropertiesService(INTEGRITY_STATE)에 작게만 저장한다(찾은 문제는 그때그때 Integrity_Logs 에 적는다).
 * @return {{ok:true, partial:boolean, total_issues:number, critical:number, warn:number}}
 */
function runIntegrityCheck_(actor) {
  const props = PropertiesService.getScriptProperties();
  const t0 = nowMs_();
  const runningAt = Number(props.getProperty('INTEGRITY_RUNNING_AT') || 0);
  if (runningAt && t0 - runningAt < INTEGRITY_STALE_RUN_MS_) {
    return { ok: true, partial: true, skipped: true, reason: 'already_running', total_issues: 0, critical: 0, warn: 0 };
  }
  props.setProperty('INTEGRITY_RUNNING_AT', String(t0));
  try {
    return runIntegrityStep_(actor, t0);
  } finally {
    props.deleteProperty('INTEGRITY_RUNNING_AT');
  }
}

function runIntegrityStep_(actor, t0) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let st = loadIntegrityState_();
  if (st && (!st.startedAt || t0 - st.startedAt > INTEGRITY_STATE_MAX_AGE_MS_)) st = null;   // 오래된 상태는 버리고 처음부터
  if (!st) {
    st = { v: 1, phase: 'CONTENTS', row: 1, orphanFolder: 0, orphanSkip: 0,
           total: 0, critical: 0, warn: 0, written: 0, runs: 0, startedAt: t0, actor: String(actor || 'system') };
  }
  st.runs = (st.runs || 0) + 1;
  const over = function () { return nowMs_() - t0 > INTEGRITY_BUDGET_MS_; };

  // 이번 실행에서 찾은 문제 — 멈추거나 끝낼 때 한 번에 시트에 적는다
  let issues = [];
  const flush = function () {
    if (!issues.length) return;
    issues.forEach(function (i) { st.total++; if (i.severity === 'CRITICAL') st.critical++; else st.warn++; });
    const room = Math.max(0, INTEGRITY_MAX_ISSUES_ - (st.written || 0));
    const toWrite = issues.slice(0, room);
    if (toWrite.length) writeIntegrityIssues_(toWrite, st.actor, true);
    st.written = (st.written || 0) + toWrite.length;
    issues = [];
  };
  const pause = function () {
    flush();
    saveIntegrityState_(st);
    scheduleIntegrityResume_();
    return { ok: true, partial: true, phase: st.phase, total_issues: st.total, critical: st.critical, warn: st.warn };
  };

  const contents = ss.getSheetByName('Contents');
  const rows = contents && contents.getLastRow() > 1
    ? contents.getRange(1, 1, contents.getLastRow(), contents.getLastColumn()).getValues()
    : [];

  /* 1) 행별 payload 파일 확인 — 행마다 드라이브를 부르므로 시간을 보며 간다 */
  if (st.phase === 'CONTENTS') {
    const headers = rows.length ? rows[0].map(String) : [];
    const idCol = headers.indexOf('content_id');
    const brandCol = headers.indexOf('brand');
    const fileCol = headers.indexOf('payload_file_id');
    const statusCol = headers.indexOf('status');
    const updatedByCol = headers.indexOf('updated_by');

    if (rows.length > 1 && idCol >= 0 && fileCol >= 0) {
      for (let r = st.row || 1; r < rows.length; r++) {
        if (over()) { st.row = r; return pause(); }
        const contentId = String(rows[r][idCol] || '').trim();
        const fileId = String(rows[r][fileCol] || '').trim();
        if (!fileId) {
          // DRAFT·캘린더 슬롯은 payload가 아직 없는 것이 정상
          const stt = statusCol >= 0 ? String(rows[r][statusCol]) : '';
          // 과거 발행분을 시트로만 가져온 행(published-import)은 payload 원본이 애초에 없다.
          // 이걸 WARN 으로 올리면 매 점검마다 같은 경고가 쌓여 진짜 문제를 가린다.
          const by = updatedByCol >= 0 ? String(rows[r][updatedByCol] || '') : '';
          if (stt !== 'DRAFT' && by !== 'published-import') {
            issues.push(issue_('WARN', 'BROKEN_FILE_ID', rows[r][brandCol] || '', contentId,
              'payload_file_id 가 비어 있습니다 (status=' + stt + ')'));
          }
          continue;
        }
        try {
          const f = DriveApp.getFileById(fileId);
          if (f.getSize() > MAX_PAYLOAD_BYTES_) {
            issues.push(issue_('WARN', 'OVERSIZED_PAYLOAD', rows[r][brandCol] || '', contentId,
              'payload ' + f.getSize() + ' bytes (>200KB)'));
          }
          f.getBlob().getDataAsString().slice(0, 16);   // 읽기 성공 = 파일 정상
        } catch (err) {
          issues.push(issue_('CRITICAL', 'BROKEN_FILE_ID', rows[r][brandCol] || '', contentId,
            'file_id 접근 실패: ' + sanitizeErrorDetail_(err.message)));
        }
      }
    }
    st.phase = 'ORPHANS'; st.orphanFolder = 0; st.orphanSkip = 0; st.row = 1;
  }

  /* 2) 고아 파일 (Drive에 있는데 Contents가 참조하지 않음) — 참조 표는 시트에서 다시 만든다(드라이브 호출 없음) */
  if (st.phase === 'ORPHANS') {
    const referenced = integrityReferenced_(rows);
    const folders = payloadFolders_();
    for (let fi = st.orphanFolder || 0; fi < folders.length; fi++) {
      const it = folders[fi].getFiles();
      let n = 0;
      // 이어하기: 앞서 훑은 만큼 건너뛴다(이름·ID 만 읽으므로 가볍다)
      const skip = fi === (st.orphanFolder || 0) ? (st.orphanSkip || 0) : 0;
      while (n < skip && it.hasNext()) { it.next(); n++; }
      while (it.hasNext() && n < INTEGRITY_ORPHAN_SCAN_MAX_) {
        if (over()) { st.orphanFolder = fi; st.orphanSkip = n; return pause(); }
        const f = it.next(); n++;
        if (/^payload_.*\.json$/.test(f.getName()) && !referenced[f.getId()]) {
          issues.push(issue_('WARN', 'ORPHAN_DRIVE_FILE', '', f.getName(),
            'Contents 미참조 payload (file_id=' + f.getId() + ')'));
        }
      }
    }
    st.phase = 'REST'; st.orphanFolder = 0; st.orphanSkip = 0;
  }

  /* 3) 스키마 불일치 · 공유 권한 노출 감사 — 가벼워서 한 번에 */
  if (over()) return pause();
  const schemas = (typeof SHEET_SCHEMAS !== 'undefined') ? SHEET_SCHEMAS : null;
  if (schemas) {
    Object.keys(schemas).forEach(function (name) {
      const sh = ss.getSheetByName(name);
      if (!sh) {
        issues.push(issue_('CRITICAL', 'SCHEMA_MISMATCH', '', name, '시트 없음'));
        return;
      }
      const head = sh.getLastColumn() > 0
        ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String) : [];
      if (head.join('|') !== schemas[name].join('|')) {
        issues.push(issue_('WARN', 'SCHEMA_MISMATCH', '', name, '헤더가 스키마와 다릅니다'));
      }
    });
  }

  try {
    const props = PropertiesService.getScriptProperties();
    ['ROOT_FOLDER_ID', 'BACKUP_ROOT_FOLDER_ID', 'BACKUP_DAILY_FOLDER_ID', 'FOLDER_DAEJEON_YOUTH']
      .forEach(function (k) {
        const id = props.getProperty(k);
        if (!id) return;
        try {
          const folder = DriveApp.getFolderById(id);
          const access = folder.getSharingAccess();
          if (access === DriveApp.Access.ANYONE_WITH_LINK || access === DriveApp.Access.ANYONE) {
            issues.push(issue_('CRITICAL', 'PUBLIC_SHARING_EXPOSED', '', k,
              'Drive 폴더가 ' + access + ' 로 공개되어 있습니다'));
          }
        } catch (err) { /* 접근 불가 폴더는 skip */ }
      });
    const ssAccess = DriveApp.getFileById(ss.getId()).getSharingAccess();
    if (ssAccess === DriveApp.Access.ANYONE_WITH_LINK || ssAccess === DriveApp.Access.ANYONE) {
      issues.push(issue_('CRITICAL', 'PUBLIC_SHARING_EXPOSED', '', 'SPREADSHEET',
        '스프레드시트가 공개 공유 상태입니다'));
    }
  } catch (err) { /* 권한 조회 실패는 skip */ }

  flush();
  if (st.total === 0) writeIntegrityIssues_([], st.actor);   // 문제 없음 한 줄(INFO)
  const result = { ok: true, partial: false, runs: st.runs, total_issues: st.total, critical: st.critical, warn: st.warn };
  clearIntegrityState_();
  return result;
}

function issue_(severity, type, brand, targetRef, detail) {
  return { severity: severity, type: type, brand: brand, target: targetRef, detail: detail };
}

function payloadMinimal_(file) {
  try { return JSON.parse(file.getBlob().getDataAsString()); } catch (err) { return {}; }
}

function writeIntegrityIssues_(issues, actor, quiet) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Integrity_Logs');
  if (!sheet) return;
  if (!issues.length) {
    if (quiet) return;
    sheet.appendRow(['INT-' + Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMddHHmmss') + '-000',
      Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd'), 'INFO', 'SCHEMA_MISMATCH',
      '', 'ALL', '점검 완료 · 문제 없음 (' + (actor || 'system') + ')', true, formatKstIso_(new Date())]);
    return;
  }
  const today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  const rows = issues.slice(0, 200).map(function (i) {
    const id = 'INT-' + Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMddHHmmss')
      + '-' + Math.floor(100 + Math.random() * 900);
    return [id, today, i.severity, i.type, i.brand || '', i.target || '',
            sanitizeErrorDetail_(i.detail), false, formatKstIso_(new Date())];
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 9).setValues(rows);
}

/* ------------------------------------------------------------------ *
 * 백업 상태 요약 (health 응답용)
 * ------------------------------------------------------------------ */

function getBackupStatus_() {
  const props = PropertiesService.getScriptProperties();
  const lastOk = props.getProperty('LAST_BACKUP_OK_AT');
  let staleDays = null;
  if (lastOk) {
    const diff = nowMs_() - new Date(lastOk).getTime();
    staleDays = Math.floor(diff / (24 * 60 * 60 * 1000));
  }
  return {
    last_backup_at: lastOk || null,
    last_backup_tier: props.getProperty('LAST_BACKUP_OK_TIER') || null,
    backup_stale_days: staleDays,
    backup_stale: staleDays === null || staleDays >= 2,
    last_failure_at: props.getProperty('LAST_BACKUP_FAILURE_AT') || null,
    last_failure_msg: props.getProperty('LAST_BACKUP_FAILURE_MSG') || null,
    pending_backup: !!loadBackupState_(),
    pending_integrity: !!loadIntegrityState_()
  };
}
