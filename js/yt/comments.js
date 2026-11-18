/**
 * js/yt/comments.js — 댓글 4분류 + 답장 초안
 *
 * 원본: Jakeschincariol/youtube-agent-skill (MIT) skills/yt-comment
 *   댓글을 네 무더기로 나누고, 내 말투로 답을 쓰고, 그중 하나를 고정하라고 말한다.
 * 말투: seeds/skills/voice_kimseongrae.md — 담백한 해요체, 인사 한 줄 + 실제 답 한 줄.
 * 분류는 규칙 기반이라 틀릴 수 있다. 화면에도 '초안'이라고 적는다. 그대로 붙이지 않는다.
 */

const TRIAGE_URL = 'seeds/skills/comment_triage.json';
let cache = null;

export async function loadTriage(force) {
  if (cache && !force) return cache;
  const res = await fetch(`${TRIAGE_URL}?v=1`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`댓글 규칙을 불러오지 못했습니다 (HTTP ${res.status})`);
  cache = await res.json();
  return cache;
}

export function classifyComments(raw, triage) {
  const piles = triage.piles;
  const out = [];
  String(raw || '').split('\n').map((l) => l.trim()).filter(Boolean).forEach((text) => {
    let hit = null;
    for (const p of piles) {
      const matched = (p.match || []).some((pat) => {
        try { return new RegExp(pat, 'i').test(text); } catch (e) { return false; }
      });
      if (matched) { hit = p; break; }
    }
    const pile = hit || { id: 'praise', label: '기타 (짧게 고마움)' };
    out.push({ text, pile: pile.id, pile_label: pile.label });
  });
  const counts = {};
  out.forEach((r) => { counts[r.pile] = (counts[r.pile] || 0) + 1; });
  return { rows: out, counts };
}

export function draftReply(row, triage, ctx = {}) {
  const tpls = (triage.reply_templates[row.pile] || ['']).filter((t) => t);
  if (!tpls.length) return '';
  const tpl = tpls[0];
  const vals = {
    답: ctx.answer || '[확인한 답: 위치·가격·시간]',
    날짜: ctx.date || '[방문 날짜]',
    주의: ctx.care || '[주의 한 줄]',
    초: ctx.second || '[초]',
    다음소재: ctx.next || '[다음 소재]',
    한줄: ctx.one || '[한 줄]',
    확인한값: ctx.checked || '[확인한 값]'
  };
  return tpl.replace(/\{([^}]+)\}/g, (_, k) => vals[k.trim()] || `[${k.trim()}]`);
}

export function pickPin(classified, triage) {
  const priority = (triage.pin_rule && triage.pin_rule.priority) || ['question', 'info', 'praise', 'noise'];
  for (const key of priority) {
    const found = classified.rows.filter((r) => r.pile === key)[0];
    if (found) {
      const tpl = (triage.pin_rule && (key === 'question' ? triage.pin_rule.template_question : key === 'info' ? triage.pin_rule.template_info : '')) || '';
      return { pile: key, comment: found.text, template: tpl, why: (triage.pin_rule || {}).why };
    }
  }
  return null;
}
