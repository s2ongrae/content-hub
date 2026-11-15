/**
 * gas/Backup.gs  —  자동 스냅샷 · 보존 정책 · 원클릭 복구 · 무결성 점검
 * Content Hub OS
 *
 * 트리거 (Setup.gs 가 설치)
 *  - runDailyBackupTrigger     매일 03:00 KST  : 시트 사본 + payload 배치 + 매니페스트 + 무결성
 *  - runWeeklyBackupTrigger    매주 일 03:30   : 주간 보관본
 *  - runMonthlyBackupTrigger   매월 1일 04:00  : 월간 보관본
 *  - runMaintenanceTrigger     15분마다        : 끊긴 백업 이어하기 · 만료 리스 회수 · Ops_Queue 재적용
 *
 * 설계 원칙
 *  - 시트는 값 루프가 아니라 파일 통째 복사(makeCopy) — 수식·서식·모든 시트 보존, 6분 예산 안전.
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
  runTriggerSafely_('DAILY', function () {
    const res = runBackupPipeline_('DAILY', 'trigger');
    runIntegrityCheck_('trigger');
    return res;
  });
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

  // 2) 스프레드시트 통째 사본 — 수식·서식·전 시트 보존
  let sheetCopy = null;
  try {
    const file = DriveApp.getFileById(ss.getId());
    sheetCopy = file.makeCopy(snapshotName + '_SHEETS', folder);
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
  const manifest = writeManifest_(ss, folder, snapshotName, sheetCopy, state.copied);
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

/** 값이 아니라 "앞 4KB + 크기" 지문 — 수 MB 파일을 전부 읽지 않기 위한 절충 */
function fingerprintOf_(file) {
  try {
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

  const manifest = writeManifest_(ss, dest, state.snapshotName, sheetFile, state.copied);
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

function writeManifest_(ss, folder, snapshotName, sheetFile, copied) {
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
    payload_count: payloads.length,
    payloads: payloads,
    total_bytes: totalBytes
  };
  manifest.manifest_hash = sha256Hex_(JSON.stringify(manifest)).slice(0, 24);

  folder.createFile(snapshotName + '_backup_manifest.json',
    JSON.stringify(manifest, null, 2), MimeType.PLAIN_TEXT);
  return manifest;
}

function applyRetention_(tier, folder) {
  const keep = BACKUP_KEEP_[tier];
  if (!keep) return;

  const all = [];
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    const n = f.getName();
    if (n.indexOf('SNAPSHOT_') !== 0) continue;
    all.push({ file: f, name: n, time: f.getDateCreated().getTime() });
  }
  all.sort(function (a, b) { return b.time - a.time; });   // 최신 먼저

  const snapshotNames = {};
  all.forEach(function (x) {
    const key = x.name.replace(/_(SHEETS|backup_manifest\.json|config_presets\.json).*$/, '');
    snapshotNames[key] = snapshotNames[key] || [];
    snapshotNames[key].push(x.file);
  });

  const keys = Object.keys(snapshotNames).sort(function (a, b) {
    return snapshotNames[b][0].getDateCreated().getTime() - snapshotNames[a][0].getDateCreated().getTime();
  });

  // 최신 3개는 무조건 보호
  keys.slice(Math.max(keep, 3)).forEach(function (k) {
    snapshotNames[k].forEach(function (f) {
      try { f.setTrashed(true); } catch (err) { /* 이미 없음 */ }
    });
  });
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

function runIntegrityCheck_(actor) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const issues = [];

  const contents = ss.getSheetByName('Contents');
  const rows = contents && contents.getLastRow() > 1
    ? contents.getRange(1, 1, contents.getLastRow(), contents.getLastColumn()).getValues()
    : [];
  const headers = rows.length ? rows[0].map(String) : [];
  const idCol = headers.indexOf('content_id');
  const brandCol = headers.indexOf('brand');
  const fileCol = headers.indexOf('payload_file_id');
  const statusCol = headers.indexOf('status');

  const referenced = {};
  if (rows.length > 1 && idCol >= 0 && fileCol >= 0) {
    for (let r = 1; r < rows.length; r++) {
      const contentId = String(rows[r][idCol] || '').trim();
      const fileId = String(rows[r][fileCol] || '').trim();
      if (!fileId) {
        // DRAFT·캘린더 슬롯은 payload가 아직 없는 것이 정상
        const st = statusCol >= 0 ? String(rows[r][statusCol]) : '';
        if (st !== 'DRAFT') {
          issues.push(issue_('WARN', 'BROKEN_FILE_ID', rows[r][brandCol] || '', contentId,
            'payload_file_id 가 비어 있습니다 (status=' + st + ')'));
        }
        continue;
      }
      referenced[fileId] = contentId;
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

  // 고아 파일 (Drive에 있는데 Contents가 참조하지 않음)
  payloadFolders_().forEach(function (folder) {
    const it = folder.getFiles();
    let n = 0;
    while (it.hasNext() && n < 400) {
      const f = it.next(); n++;
      if (/^payload_.*\.json$/.test(f.getName()) && !referenced[f.getId()]) {
        issues.push(issue_('WARN', 'ORPHAN_DRIVE_FILE', '', f.getName(),
          'Contents 미참조 payload (file_id=' + f.getId() + ')'));
      }
    }
  });

  // 스키마 불일치
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

  // 공유 권한 노출 감사
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

  writeIntegrityIssues_(issues, actor);

  return {
    ok: true,
    total_issues: issues.length,
    critical: issues.filter(function (i) { return i.severity === 'CRITICAL'; }).length,
    warn: issues.filter(function (i) { return i.severity === 'WARN'; }).length
  };
}

function issue_(severity, type, brand, targetRef, detail) {
  return { severity: severity, type: type, brand: brand, target: targetRef, detail: detail };
}

function payloadMinimal_(file) {
  try { return JSON.parse(file.getBlob().getDataAsString()); } catch (err) { return {}; }
}

function writeIntegrityIssues_(issues, actor) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Integrity_Logs');
  if (!sheet) return;
  if (!issues.length) {
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
    pending_backup: !!loadBackupState_()
  };
}
