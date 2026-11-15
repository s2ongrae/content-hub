/**
 * gas/Notify.gs  —  헬스 경보 (Slack 웹훅 → 메일 폴백)
 *
 * 경보 3종
 *  - ALERT_BACKUP_FAIL      : 백업·트리거 실패 또는 최신 성공 백업이 48시간 초과
 *  - ALERT_QUOTA_80         : 일일 호출량이 한도(기본 20,000)의 80% 도달 → 폴링 감속 유도
 *  - ALERT_NEEDS_HUMAN_STALE: NEEDS_HUMAN 이 2건 이상이거나 2시간 이상 방치
 *
 *  - 같은 경보는 4시간 쿨다운(CacheService)으로 스팸 차단
 *  - Slack Webhook 미설정·실패 시 MailApp 폴백
 *  - 설정은 PropertiesService: SLACK_WEBHOOK_URL, ALERT_EMAIL(선택), DAILY_CALL_LIMIT(선택)
 */

const ALERT_COOLDOWN_SEC_ = 14400;   // 4시간
const DEFAULT_DAILY_CALL_LIMIT_ = 20000;

/** 15분 유지보수 트리거에서 호출 */
function checkAndNotifyHealth_() {
  const results = [];
  try { results.push(evaluateBackupAlert_()); } catch (e) { results.push({ type: 'ALERT_BACKUP_FAIL', skipped: 'error' }); }
  try { results.push(evaluateQuotaAlert_()); } catch (e) { results.push({ type: 'ALERT_QUOTA_80', skipped: 'error' }); }
  try { results.push(evaluateNeedsHumanAlert_()); } catch (e) { results.push({ type: 'ALERT_NEEDS_HUMAN_STALE', skipped: 'error' }); }
  return results;
}

/* ------------------------------------------------------------------ *
 * 경보 판정
 * ------------------------------------------------------------------ */

function evaluateBackupAlert_() {
  const props = PropertiesService.getScriptProperties();
  const lastOk = props.getProperty('LAST_BACKUP_OK_AT');
  const lastFail = props.getProperty('LAST_BACKUP_FAILURE_AT');
  const failMsg = props.getProperty('LAST_BACKUP_FAILURE_MSG') || '';

  let staleHours = null;
  if (lastOk) staleHours = Math.floor((nowMs_() - new Date(lastOk).getTime()) / 3600000);

  const failFresh = lastFail && (nowMs_() - new Date(lastFail).getTime()) < 24 * 3600000;
  const stale = staleHours === null || staleHours >= 48;

  if (!failFresh && !stale) return { type: 'ALERT_BACKUP_FAIL', sent: false };

  return notifyOnce_('ALERT_BACKUP_FAIL', {
    title: '백업 이상',
    severity: stale ? 'CRITICAL' : 'WARN',
    lines: [
      '마지막 성공 백업: ' + (lastOk || '없음') + (staleHours !== null ? ' (' + staleHours + '시간 전)' : ''),
      '마지막 실패: ' + (lastFail || '없음'),
      failMsg ? '사유: ' + failMsg : ''
    ].filter(Boolean)
  });
}

function evaluateQuotaAlert_() {
  const props = PropertiesService.getScriptProperties();
  const limit = Number(props.getProperty('DAILY_CALL_LIMIT') || DEFAULT_DAILY_CALL_LIMIT_);
  const calls = getDailyCallCount_();
  const ratio = limit > 0 ? calls / limit : 0;
  if (ratio < 0.8) return { type: 'ALERT_QUOTA_80', sent: false, calls: calls, limit: limit };

  // 폴링 감속 유도
  CacheService.getScriptCache().put('THROTTLE_MODE', 'true', 6 * 3600);

  return notifyOnce_('ALERT_QUOTA_80', {
    title: 'GAS 일일 호출량 80% 도달',
    severity: ratio >= 0.95 ? 'CRITICAL' : 'WARN',
    lines: [
      '오늘 호출: ' + calls + ' / ' + limit + ' (' + Math.round(ratio * 100) + '%)',
      '피클 폴링 간격을 5분 → 15분으로 늦춰 주세요 (THROTTLE_MODE=on)'
    ]
  });
}

function evaluateNeedsHumanAlert_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const rows = readSheetAsObjects_(ss, 'Contents');
  const stuck = rows.filter(function (r) { return String(r.status) === 'NEEDS_HUMAN'; });
  if (!stuck.length) return { type: 'ALERT_NEEDS_HUMAN_STALE', sent: false };

  const twoHoursAgo = nowMs_() - 2 * 3600000;
  const stale = stuck.filter(function (r) {
    const t = new Date(r.updated_at || 0).getTime();
    return !t || t < twoHoursAgo;
  });

  if (stuck.length < 2 && stale.length === 0) {
    return { type: 'ALERT_NEEDS_HUMAN_STALE', sent: false, count: stuck.length };
  }

  return notifyOnce_('ALERT_NEEDS_HUMAN_STALE', {
    title: '사람 개입 대기 적체',
    severity: stale.length ? 'CRITICAL' : 'WARN',
    lines: [
      'NEEDS_HUMAN: ' + stuck.length + '건 (2시간 이상 방치 ' + stale.length + '건)',
      stuck.slice(0, 5).map(function (r) {
        return '· ' + r.content_id + ' / ' + (r.place_name || '') + ' / ' + (r.brand || '');
      }).join('\n')
    ]
  });
}

/* ------------------------------------------------------------------ *
 * 발송 (쿨다운 · Slack → 메일 폴백)
 * ------------------------------------------------------------------ */

function notifyOnce_(alertType, content) {
  const cache = CacheService.getScriptCache();
  const coolKey = 'ALERT_COOLDOWN_' + alertType;
  if (cache.get(coolKey)) {
    return { type: alertType, sent: false, reason: 'cooldown' };
  }

  const text = formatAlertText_(alertType, content);
  let channel = 'none';

  const webhook = PropertiesService.getScriptProperties().getProperty('SLACK_WEBHOOK_URL');
  if (webhook) {
    try {
      UrlFetchApp.fetch(webhook, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({ text: text }),
        muteHttpExceptions: true
      });
      channel = 'slack';
    } catch (err) {
      channel = 'none';
    }
  }

  if (channel === 'none') {
    try {
      const to = PropertiesService.getScriptProperties().getProperty('ALERT_EMAIL')
        || Session.getEffectiveUser().getEmail();
      MailApp.sendEmail(to, '[' + alertType + '] ' + (content.title || 'ContentHub OS 알림'), text);
      channel = 'mail';
    } catch (err) {
      channel = 'none';
    }
  }

  if (channel !== 'none') {
    cache.put(coolKey, String(Date.now()), ALERT_COOLDOWN_SEC_);
    try {
      appendSystemHealth_({
        eventType: alertType, status: 'ALERT', actor: 'system',
        detail: channel + ' · ' + (content.title || '')
      });
    } catch (e) { /* 로그 실패 무시 */ }
  }

  return { type: alertType, sent: channel !== 'none', channel: channel };
}

function formatAlertText_(alertType, content) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const url = 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/edit';
  return [
    '[' + (content.severity || 'WARN') + '] ' + alertType,
    content.title || '',
    '',
    (content.lines || []).join('\n'),
    '',
    '시각: ' + formatKstIso_(new Date()),
    '시트: ' + url
  ].join('\n');
}

/* 관리자용 수동 테스트 */
function sendTestAlert() {
  return notifyOnce_('ALERT_TEST', {
    title: '테스트 경보',
    severity: 'INFO',
    lines: ['Slack 웹훅/메일 경로가 정상입니다.']
  });
}

function setAlertConfig(webhookUrl, email) {
  const props = PropertiesService.getScriptProperties();
  if (webhookUrl) props.setProperty('SLACK_WEBHOOK_URL', webhookUrl);
  if (email) props.setProperty('ALERT_EMAIL', email);
  return { slack: !!props.getProperty('SLACK_WEBHOOK_URL'), email: props.getProperty('ALERT_EMAIL') || '' };
}
