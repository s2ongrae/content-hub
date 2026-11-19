/**
 * js/cardPerf.js — 카드 1장의 통합 성과 (성과 화면과 분리된 순수 계산)
 *
 * 왜 따로 두나
 *  · 현황 보드 카드의 미니 뱃지와 카드 상세의 '종합 성과 + 채널 타일'이 같은 계산을 쓴다.
 *  · 화면 없이 시험할 수 있게 순수 함수만 둔다(innerHTML·DOM 없음).
 *
 * 데이터 두 갈래
 *  · metrics   : 사람이 넣는 숫자(GAS list_metrics) — 블로그·클립·당근, 숏폼 보조
 *  · analytics : 자동 수집(GAS list_analytics) — 유튜브 쇼츠, 인스타 릴스·피드
 *  같은 채널에 둘 다 있으면 자동 수집을 먼저 쓴다(더 자주 갱신되고 단위가 같다).
 *
 * 표기 원칙 (제미나이 확정 2026-11-19)
 *  · 조회 합 = 블로그·쇼츠·릴스 조회 + 피드 도달 + 당근 유효시청. 단위가 섞이므로 화면에 1줄 주석을 고정한다.
 *  · 반응 합 = 좋아요 + 댓글 + 저장 + 공유. 블로그 공감·댓글은 지금 수집 경로가 없어 세지 않는다(0으로 속이지 않음).
 *  · 숫자를 모르면 0이 아니라 null 로 두고 화면이 '수집 전'을 고른다.
 */

import { CHANNEL_LABEL, DONE_STATES, trackChannelsOf } from './trackChannels.js?v=20261119o';

const NF = (n) => (Number(n) || 0).toLocaleString('ko-KR');

/** 12,400 → '1.2만' (보드 뱃지처럼 좁은 자리) */
export function compact(n) {
  const v = Number(n) || 0;
  if (v >= 100000000) return (Math.round(v / 10000000) / 10) + '억';
  if (v >= 10000) return (Math.round(v / 1000) / 10) + '만';
  return NF(v);
}

const dayOf = (r) => String((r && (r.collected_date || r.measured_at || r.collected_at)) || '').slice(0, 10);
const stampOf = (r) => String((r && (r.collected_at || r.measured_at || r.collected_date)) || '');

/** 같은 채널의 기록을 날짜 오름차순으로 — 누적값이므로 마지막이 현재값 */
function series(list) {
  return (list || []).slice().sort((a, b) => {
    const da = dayOf(a), db = dayOf(b);
    if (da !== db) return da < db ? -1 : 1;
    return stampOf(a) < stampOf(b) ? -1 : (stampOf(a) > stampOf(b) ? 1 : 0);
  });
}

/** 마지막 값과 그 이전 값으로 증가율(%) — 비교할 이전 값이 없으면 null */
export function growthOf(points) {
  const list = (points || []).filter((p) => p && Number.isFinite(Number(p.value)));
  if (list.length < 2) return null;
  const last = Number(list[list.length - 1].value) || 0;
  const prev = Number(list[list.length - 2].value) || 0;
  if (!prev) return null;
  return Math.round(((last - prev) / prev) * 1000) / 10;
}

/** 마지막 값과 그 이전 값의 차이 — 수동 입력처럼 간격이 불규칙한 채널에 쓴다 */
export function deltaOf(points) {
  const list = (points || []).filter((p) => p && Number.isFinite(Number(p.value)));
  if (list.length < 2) return null;
  return (Number(list[list.length - 1].value) || 0) - (Number(list[list.length - 2].value) || 0);
}

/**
 * 카드 1장의 채널별 현재값.
 * @param {Object} card Contents 행
 * @param {Array} metrics list_metrics 정규화 행
 * @param {Array} analytics list_analytics 정규화 행
 * @param {String} brand 트랙
 * @returns {Array} [{channel, label, status, url, value, valueLabel, sub, trend, history, collected, source, external_id, noApi}]
 */
export function channelRows(card, metrics, analytics, brand) {
  const cid = String((card && card.content_id) || '');
  const b = brand || (card && card.brand) || '';
  const channels = trackChannelsOf(b);
  const COL = {
    blog: { st: 'blog_status', url: 'blog_url' },
    shorts: { st: 'shorts_status', url: 'shorts_url' },
    reels: { st: 'reels_status', url: 'reels_url' },
    feed: { st: 'ig_feed_status', url: 'ig_feed_url' },
    clip: { st: 'clip_status', url: 'clip_url' },
    daangn: { st: 'daangn_status', url: 'daangn_url' }
  };
  const mrows = (metrics || []).filter((r) => r && String(r.content_id) === cid);
  const arows = (analytics || []).filter((r) => r && String(r.content_id) === cid);
  const done = (s) => DONE_STATES.indexOf(String(s || '')) >= 0;

  return channels.map((ch) => {
    const col = COL[ch] || {};
    const status = (card && card[col.st]) || '';
    const url = (card && card[col.url]) || '';
    const out = {
      channel: ch, label: CHANNEL_LABEL[ch] || ch, status, url,
      value: null, valueLabel: '', sub: '', trend: null, history: [],
      collected: false, noApi: ch === 'clip' || ch === 'daangn', source: '', external_id: ''
    };

    /* ① 자동 수집(쇼츠·릴스·피드) — 있으면 먼저 */
    if (ch === 'shorts' || ch === 'reels' || ch === 'feed') {
      const rows = series(arows.filter((r) => r.channel === ch && r.external_id));
      const byId = new Map();
      rows.forEach((r) => {
        const key = r.external_id;
        const arr = byId.get(key) || [];
        arr.push(r);
        byId.set(key, arr);
      });
      let best = null;
      byId.forEach((list) => {
        const last = list[list.length - 1];
        if (!best || stampOf(last) > stampOf(best.last)) best = { list, last };
      });
      if (best) {
        const points = best.list.map((r) => ({ day: dayOf(r), value: ch === 'feed' ? r.reach : r.views }));
        out.collected = true;
        out.source = best.last.source;
        out.external_id = best.last.external_id;
        out.value = ch === 'feed' ? Number(best.last.reach) || 0 : Number(best.last.views) || 0;
        out.valueLabel = ch === 'feed' ? '도달' : '조회';
        out.history = points;
        out.trend = growthOf(points);
        out.trendKind = 'pct';
        if (ch === 'shorts') {
          const pct = Number(best.last.avg_view_pct) || 0;
          const likes = Number(best.last.likes) || 0;
          const comments = Number(best.last.comments) || 0;
          out.sub = [likes + comments ? '반응 ' + NF(likes + comments) : '', pct ? '시청지속 ' + Math.round(pct) + '%' : '']
            .filter(Boolean).join(' · ');
        } else if (ch === 'reels') {
          const saves = Number(best.last.saves) || 0;
          const shares = Number(best.last.shares) || 0;
          out.sub = (saves + shares) ? '저장·공유 ' + NF(saves + shares) : '';
        } else {
          const saves = Number(best.last.saves) || 0;
          out.sub = saves ? '저장 ' + NF(saves) : '';
        }
        return out;
      }
      /* 자동 수집이 없으면 사람이 넣은 숫자로 내려간다 */
    }

    /* ② 사람이 넣은 숫자(Metrics) */
    const mlist = series(mrows.filter((r) => r.channel === ch));
    if (mlist.length) {
      const last = mlist[mlist.length - 1];
      const points = mlist.map((r) => ({ day: dayOf(r), value: ch === 'daangn' ? r.valid_views : r.views }));
      out.collected = true;
      out.value = ch === 'daangn' ? Number(last.valid_views) || 0 : Number(last.views) || 0;
      out.valueLabel = ch === 'daangn' ? '유효시청' : '조회';
      out.history = points;
      out.trend = deltaOf(points);
      out.trendKind = 'diff';
      out.source = 'metrics';
      if (ch === 'blog') {
        out.sub = Number(last.search_inflow_pct) ? '검색유입 ' + Math.round(last.search_inflow_pct) + '%' : '';
      } else if (ch === 'shorts') {
        out.sub = Number(last.avg_dwell_sec) ? '시청 ' + last.avg_dwell_sec + '초' : '';
      } else if (ch === 'reels') {
        out.sub = Number(last.saves) ? '저장 ' + NF(last.saves) : '';
      } else if (ch === 'daangn') {
        out.sub = [
          Number(last.likes_comments) ? '좋아요 ' + NF(last.likes_comments) : '',
          Number(last.reward_krw) ? '보상 ' + NF(last.reward_krw) + '원' : ''
        ].filter(Boolean).join(' · ');
        out.reward = Number(last.reward_krw) || 0;
      }
    }
    return out;
  });
}

/**
 * 카드 1장 종합.
 * @returns {{views:number, reactions:number, comments:number, reward:number, done:number, total:number, share:Array, hasAny:boolean, measured:number}}
 */
export function cardTotals(rows, card, brand, analytics) {
  const list = rows || [];
  const channels = trackChannelsOf(brand || (card && card.brand) || '');
  const doneStatuses = { blog: 'blog_status', shorts: 'shorts_status', reels: 'reels_status', feed: 'ig_feed_status', clip: 'clip_status', daangn: 'daangn_status' };
  let views = 0, reward = 0, measured = 0;
  list.forEach((r) => {
    if (r.value == null) return;
    if (String((card && card[doneStatuses[r.channel]]) || '') === 'SKIPPED') return;
    views += Number(r.value) || 0;
    reward += Number(r.reward) || 0;
    measured += 1;
  });

  /* 반응 = 자동 수집분(좋아요·댓글·저장·공유) + 당근 좋아요 */
  const cid = String((card && card.content_id) || '');
  let reactions = 0, comments = 0;
  /* 채널별 최신 한 줄만 센다 — 누적값을 여러 날 더하면 부풀려진다 */
  const latestByVideo = new Map();
  (analytics || []).forEach((r) => {
    if (!r || String(r.content_id) !== cid || !r.external_id) return;
    const key = r.source + '|' + r.external_id + '|' + r.channel;
    const prev = latestByVideo.get(key);
    if (!prev || stampOf(r) >= stampOf(prev)) latestByVideo.set(key, r);
  });
  latestByVideo.forEach((r) => {
    reactions += (Number(r.likes) || 0) + (Number(r.comments) || 0) + (Number(r.saves) || 0) + (Number(r.shares) || 0);
    comments += Number(r.comments) || 0;
  });
  list.forEach((r) => {
    if (r.channel !== 'daangn' || !r.sub) return;
    const m = /좋아요 ([\d,]+)/.exec(r.sub);
    if (m) reactions += Number(m[1].replace(/,/g, '')) || 0;
  });

  const total = channels.length;
  let done = 0;
  channels.forEach((ch) => { if (DONE_STATES.indexOf(String((card && card[doneStatuses[ch]]) || '')) >= 0) done += 1; });
  const base = views || 1;
  const share = list.filter((r) => r.value > 0)
    .map((r) => ({ channel: r.channel, label: r.label, value: Number(r.value) || 0, pct: Math.round(((Number(r.value) || 0) / base) * 100) }))
    .sort((a, b) => b.value - a.value);
  return { views, reactions, comments, reward, done, total, share, hasAny: measured > 0 || reactions > 0, measured };
}

/* ───────────── 당근 자동 점검 (사람이 체크하지 않는다) ───────────── */

const ADS = /(^|\s)#(광고|협찬)/;

/**
 * 카드 대본·영상 메타로 발행 조건을 자동 판정한다.
 * 통과하면 아무것도 돌려주지 않는다(화면에 점검 UI 자체를 남기지 않는다 — 2026-11-19 제미나이 확정).
 * @returns {Array<{code:string, text:string}>} 실패·확인필요만
 */
export function daangnWarnings(payload, opts) {
  const o = opts || {};
  const warn = [];
  const dan = payload && payload.daangn;
  if (!dan || typeof dan !== 'object') return warn;   // 대본이 없는 카드는 판정하지 않는다(빈 경고)

  const desc = String(dan.description || '');
  const dur = Number(dan.duration_sec || o.duration_sec || 0);
  if (dur && dur < 10) warn.push({ code: 'DURATION', text: '영상 ' + dur + '초 — 10초 이상이어야 보상 인정' });
  if (desc && Array.from(desc.trim()).length < 30) {
    warn.push({ code: 'DESC', text: '설명 ' + Array.from(desc.trim()).length + '자 — 30자 이상이어야 보상 인정' });
  }
  if (desc && /https?:\/\//i.test(desc)) warn.push({ code: 'LINK', text: '설명에 외부 링크가 있어요 — 당근은 링크 유도를 금지합니다' });
  const sponsored = dan.sponsored === true || dan.is_sponsored === true
    || (payload && payload.facts && payload.facts.sponsored === true);
  if (sponsored && desc && !ADS.test(desc)) {
    warn.push({ code: 'AD', text: '협찬 카드인데 설명 첫 줄에 #광고·#협찬 표기가 없어요' });
  }
  return warn;
}

/** 당월 목표 진행 — 인정 스토리 n/5편 · 유효시청 n/2,000회 */
export function daangnGoal(rows, month, goals) {
  const g = goals || {};
  const storyGoal = Number(g.stories_per_month) || 5;
  const viewGoal = Number(g.valid_views_per_month) || 2000;
  const per = new Map();
  (rows || []).filter((r) => r && r.channel === 'daangn' && String(r.measured_at || '').slice(0, 7) === month)
    .forEach((r) => {
      const id = String(r.content_id || '');
      if (!id) return;
      const prev = per.get(id) || { valid: 0, reward: 0 };
      per.set(id, {
        valid: Math.max(prev.valid, Number(r.valid_views) || 0),
        reward: Math.max(prev.reward, Number(r.reward_krw) || 0)
      });
    });
  let valid = 0, reward = 0;
  per.forEach((v) => { valid += v.valid; reward += v.reward; });
  return { month, stories: per.size, storyGoal, valid, viewGoal, reward };
}
