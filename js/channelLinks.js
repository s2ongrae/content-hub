/**
 * js/channelLinks.js — 4채널(블로그·쇼츠·릴스·클립) 발행 링크 파서 · 무결성 점검 (2026-11-26)
 *
 * 왜 이 파일이 있나 (keyring Q-20261126-133433-06n9)
 *   · 채널에 올린 뒤 주소를 시트에 적는 일이 사람 손에 남아 있었다. 주소를 안 적으면
 *     자동 수집기가 그 영상을 찾지 못하고, '발행 완료'로 넘겨도 채널 칸은 비어 있다.
 *   · 그래서 ① 붙여넣은 링크의 도메인만 보고 채널을 알아서 고르고,
 *     ② '전 채널 발행 완료'를 누를 때 비어 있는 채널을 먼저 알려 주고,
 *     ③ 링크가 4채널 모두 채워졌는지를 같은 규칙으로 판정한다.
 *
 * 규칙은 gas/Setup.gs 의 CONTENT_LINK_RULES(시트 유효성 검사)와 같은 주소·같은 정규식이다.
 *   한쪽만 고치면 test/run.js 의 '프론트·GAS 규칙 대조'가 깨진다.
 *
 * 브라우저 전용 API 를 쓰지 않는다 — 노드에서 그대로 불러 시험한다.
 */

import { trackChannelsOf, STATUS_COLUMN, DONE_STATES, CHANNEL_LABEL } from './trackChannels.js?v=20261123c';

/** 주소를 적는 4채널 — 이 순서로 화면에 놓는다 */
export const LINK_CHANNELS = ['blog', 'shorts', 'reels', 'clip'];

export const LINK_LABEL = Object.assign({}, CHANNEL_LABEL, { feed: '인스타 피드', daangn: '당근' });

/** 채널 키 → Contents 열 이름(주소) */
export const URL_COLUMN = {
  blog: 'blog_url', shorts: 'shorts_url', reels: 'reels_url',
  feed: 'ig_feed_url', clip: 'clip_url', daangn: 'daangn_url'
};

/**
 * 채널별 주소 규칙 — 프론트(이 파일)와 GAS(gas/Setup.gs CONTENT_LINK_RULES)가 같은 값을 쓴다.
 *   host: www. 를 뗀 호스트 | path: 경로 정규식(있으면 경로까지 본다)
 */
export const LINK_RULES = {
  blog: { label: '블로그', host: 'blog.naver.com', path: /^\/(?:PostView\.naver|[A-Za-z0-9_.-]+\/\d+)/ },
  shorts: { label: '쇼츠', host: 'youtube.com', path: /^\/(?:shorts\/|watch)/ },
  reels: { label: '릴스', host: 'instagram.com', path: /^\/reels?\// },
  clip: { label: '클립', host: 'clip.naver.com', path: null }
};

/** 경로 정규식이 없는 채널은 호스트만 본다(클립은 발급 주소가 /info·/shorts 등으로 갈린다) */
const HOST_ONLY = ['clip.naver.com'];

/** 'clip.naver.com/x' 처럼 스킴 없이 붙여넣은 값을 URL 로 만든다 */
export function withScheme(raw) {
  const t = String(raw == null ? '' : raw).trim().replace(/^[<"'(]+|[>"'),.]+$/g, '');
  if (!t) return '';
  if (/^https?:\/\//i.test(t)) return t;
  if (/^[a-z0-9.-]+\.[a-z]{2,}(?:\/|$)/i.test(t)) return 'https://' + t;
  return t;
}

function hostPath(url) {
  const u = new URL(url);
  return { host: String(u.hostname || '').toLowerCase().replace(/^www\./, ''), path: String(u.pathname || '/') };
}

/**
 * 링크 하나 → 채널.
 * @returns {{ok:boolean, channel:string, url:string, label:string, reason:string}}
 */
export function identifyChannel(raw) {
  const url = withScheme(raw);
  if (!url) return { ok: false, channel: '', url: '', label: '', reason: '빈 칸' };
  let hp;
  try { hp = hostPath(url); } catch (e) { return { ok: false, channel: '', url, label: '', reason: '주소 형식이 아닙니다' }; }

  /* 유튜브는 짧은 주소(youtu.be)·모바일(m.youtube.com)·네이버 블로그는 m. 도 같은 채널로 본다 */
  let host = hp.host;
  if (host === 'm.youtube.com' || host === 'music.youtube.com') host = 'youtube.com';
  if (host === 'm.blog.naver.com') host = 'blog.naver.com';

  /* 인스타는 /p/ 가 피드(카드뉴스), /reel/ 이 릴스 — 채널 표보다 먼저 가른다 */
  if (host === 'instagram.com' && /^\/p\//.test(hp.path)) {
    return { ok: true, channel: 'feed', url, label: LINK_LABEL.feed, reason: '' };
  }
  const channel = Object.keys(LINK_RULES).filter((ch) => LINK_RULES[ch].host === host)[0] || '';

  if (channel) {
    const rule = LINK_RULES[channel];
    if (HOST_ONLY.indexOf(host) >= 0 || !rule.path || rule.path.test(hp.path) || (channel === 'shorts' && /^\/[A-Za-z0-9_-]{6,}$/.test(hp.path))) {
      return { ok: true, channel, url, label: rule.label, reason: '' };
    }
    return { ok: false, channel: '', url, label: rule.label, reason: rule.label + ' 주소가 아닙니다' };
  }
  if (host === 'youtu.be') return { ok: true, channel: 'shorts', url, label: LINK_RULES.shorts.label, reason: '' };
  if (host === 'instagram.com') return { ok: false, channel: '', url, label: '릴스', reason: '릴스(/reel/) 또는 피드(/p/) 주소를 넣어 주세요' };
  return { ok: false, channel: '', url, label: '', reason: '아는 채널 주소가 아닙니다' };
}

/** 그 채널에 맞는 주소인가 — 저장 전 확인용 */
export function matchesChannel(channel, raw) {
  const id = identifyChannel(raw);
  return id.ok && id.channel === channel;
}

/**
 * 여러 줄을 한 번에 붙여넣었을 때 — 줄(공백)마다 채널을 알아서 고른다.
 * 같은 채널이 두 번 나오면 첫 줄을 쓰고 나머지는 duplicates 로 알린다(덮어쓰지 않는다).
 */
export function parseLinkText(text) {
  const tokens = String(text == null ? '' : text).split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  const links = [];
  const unknown = [];
  const duplicates = [];
  const seen = {};
  tokens.forEach((tok) => {
    const id = identifyChannel(tok);
    if (!id.ok || !id.channel) { unknown.push({ text: tok, reason: id.reason || '아는 채널 주소가 아닙니다' }); return; }
    if (seen[id.channel]) { duplicates.push({ channel: id.channel, label: id.label, url: id.url }); return; }
    seen[id.channel] = true;
    links.push({ channel: id.channel, label: id.label, url: id.url });
  });
  return { links, unknown, duplicates };
}

/** 링크 저장 patch — 주소를 넣고, 그 채널 상태가 비어 있으면 '올림(UPLOADED)'으로 남긴다. */
export function linkPatch(links, row) {
  const patch = {};
  const changed = [];
  (links || []).forEach((l) => {
    const col = URL_COLUMN[l.channel];
    if (!col || !l.url) return;
    patch[col] = l.url;
    const st = STATUS_COLUMN[l.channel];
    const cur = String((row || {})[st] || '');
    if (st && DONE_STATES.indexOf(cur) < 0) patch[st] = 'UPLOADED';
    changed.push({ channel: l.channel, label: l.label || LINK_LABEL[l.channel] || l.channel, url: l.url });
  });
  return { patch, changed };
}

/**
 * 카드 1장의 발행 기록 점검.
 *   분모 = 트랙 채널 중 SKIPPED 를 뺀 것(카드가 실제로 올리는 채널)
 *   · 상태가 올라간 상태가 아니면 'no-status'(기록 없음)
 *   · 4채널인데 주소가 비면 'no-url'(주소 없음), 주소가 그 채널 것이 아니면 'bad-url'(주소 확인)
 */
export function auditLinks(row, brand) {
  const r = row || {};
  const b = r.brand || brand;
  const targets = trackChannelsOf(b).filter((ch) => String(r[STATUS_COLUMN[ch]] || '') !== 'SKIPPED');
  const items = targets.map((ch) => {
    const status = String(r[STATUS_COLUMN[ch]] || '');
    const url = String(r[URL_COLUMN[ch]] || '').trim();
    const done = DONE_STATES.indexOf(status) >= 0;
    const needsUrl = LINK_CHANNELS.indexOf(ch) >= 0;
    let state = 'ok';
    let note = '';
    if (!done) { state = 'no-status'; note = '기록 없음'; }
    else if (needsUrl && !url) { state = 'no-url'; note = '주소 없음'; }
    else if (needsUrl && url && !matchesChannel(ch, url)) { state = 'bad-url'; note = '주소 확인'; }
    return {
      channel: ch, label: LINK_LABEL[ch] || ch, status, url, done, needsUrl, state, note
    };
  });
  const incomplete = items.filter((it) => it.state !== 'ok');
  const pick = (st) => items.filter((it) => it.state === st).map((it) => it.channel);
  return {
    brand: b || '',
    items,
    incomplete,
    complete: items.length > 0 && incomplete.length === 0,
    total: items.length,
    recorded: items.length - incomplete.length,
    missing: pick('no-status'),
    noUrl: pick('no-url'),
    badUrl: pick('bad-url')
  };
}

/** '클립(주소 없음) · 릴스(기록 없음)' 처럼 한 줄로 */
export function auditSummary(audit) {
  const list = (audit && audit.incomplete) || [];
  if (!list.length) return '';
  return list.map((it) => it.label + '(' + (it.note || '확인') + ')').join(' · ');
}

/** 발행 완료로 넘겨도 되는가 — 화면·서버가 같은 판정을 쓴다 */
export function publishGuard(row, brand) {
  const audit = auditLinks(row, brand);
  return {
    ok: audit.complete,
    audit,
    headline: audit.complete
      ? '채널 기록이 모두 차 있어요'
      : '아직 기록이 없는 채널: ' + auditSummary(audit)
  };
}
