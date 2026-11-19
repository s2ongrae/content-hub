'use strict';
/**
 * tools/analytics/lib/ids.js — 영상·게시물 주소 → API ID 정규화
 *
 * 사람은 주소를 붙여 넣는다(공유할 때 붙는 ?si= · ?igsh= 추적값 포함). API는 순수 ID 를 준다.
 * 그래서 설정(links)에 무엇이 들어와도 같은 키로 맞출 수 있게 여기서 한 번 정리한다.
 *  · 유튜브 : youtu.be/ID, /shorts/ID, /watch?v=ID, /embed/ID, /live/ID, 순수 11자 ID
 *  · 인스타 : /reel/CODE · /reels/CODE · /p/CODE  → 호스트·경로만 남긴 permalink 키
 *             (Graph API 는 숫자 media id 를 주므로, 주소로 연결할 때는 permalink 로 맞춘다)
 */

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

function youtubeIdOf(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  if (YT_ID.test(raw)) return raw;
  let url;
  try { url = new URL(raw); } catch (e) { return ''; }
  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  if (host === 'youtu.be') return cleanPathId(url.pathname);
  if (host !== 'youtube.com' && host !== 'm.youtube.com' && host !== 'music.youtube.com') return '';
  if (url.pathname === '/watch') return cleanId(url.searchParams.get('v'));
  const m = url.pathname.match(/^\/(shorts|embed|live|v)\/([^/?#]+)/);
  return m ? cleanId(m[2]) : '';
}

function cleanPathId(pathname) {
  const seg = String(pathname || '').split('/').filter(Boolean)[0] || '';
  return cleanId(seg);
}

function cleanId(v) {
  const s = String(v || '').trim();
  return YT_ID.test(s) ? s : '';
}

/** 인스타 주소 → 'instagram.com/reel/CODE' 형태의 키(추적값·끝 슬래시 제거). */
function instagramKeyOf(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  let url;
  try { url = new URL(raw); } catch (e) { return ''; }
  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  if (!/instagram\.com$/.test(host)) return '';
  const m = url.pathname.match(/^\/(reel|reels|p|tv)\/([^/?#]+)/);
  if (!m) return '';
  return 'instagram.com/' + (m[1] === 'reels' ? 'reel' : m[1]) + '/' + m[2];
}

function isInstagramHost(text) {
  try {
    return /instagram\.com$/i.test(new URL(String(text || '').trim()).hostname.replace(/^www\./, ''));
  } catch (e) { return false; }
}

/**
 * 설정 links 의 키를 정규화한다.
 * @returns {{type:'youtube'|'instagram'|'raw', key:string}}
 */
function normalizeLinkKey(text) {
  const raw = String(text || '').trim();
  const yt = youtubeIdOf(raw);
  if (yt) return { type: 'youtube', key: yt };
  const igKey = instagramKeyOf(raw);
  if (igKey) return { type: 'instagram', key: igKey };
  return { type: 'raw', key: raw };
}

/**
 * 설정 links 로 (외부ID·permalink) → 카드 연결을 찾는 함수를 만든다.
 * 우선순위: 순수 ID 직접 → 유튜브 주소에서 뽑은 ID → 인스타 permalink.
 */
function createLinker(config) {
  const links = (config && config.links) || {};
  const byId = new Map();
  const byPermalink = new Map();
  Object.keys(links).forEach((k) => {
    if (k === '_comment') return;
    const v = links[k];
    if (!v || typeof v !== 'object') return;
    const entry = { brand: String(v.brand || ''), content_id: String(v.content_id || '') };
    const nk = normalizeLinkKey(k);
    if (nk.type === 'instagram') byPermalink.set(nk.key, entry);
    else byId.set(nk.key, entry);
  });

  return function link(externalId, opts) {
    const o = opts || {};
    const id = String(externalId || '').trim();
    if (byId.has(id)) return byId.get(id);
    const yt = youtubeIdOf(id);
    if (yt && byId.has(yt)) return byId.get(yt);
    const permalink = instagramKeyOf(o.permalink || '');
    if (permalink && byPermalink.has(permalink)) return byPermalink.get(permalink);
    return { brand: o.fallbackBrand || '', content_id: '' };
  };
}

module.exports = { youtubeIdOf, instagramKeyOf, normalizeLinkKey, createLinker, isInstagramHost };
