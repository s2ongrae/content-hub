#!/usr/bin/env python3
"""
tools/channel_desc_cli.py — 클립·쇼츠·릴스 설명란 5블록 포맷터·린터 (CLI)

웹앱(js/channelDesc.js)과 같은 규칙·같은 임계치를 쓴다.
규칙 원본: seeds/channel_desc_rules_2026w48.json
근거: 성래 님이 손으로 고친 네이버 클립 설명(2026-11-22) + 제미니 협의 확정.

사용
  # 한 덩어리로 뭉친 설명란을 5블록으로 다시 접기
  python3 tools/channel_desc_cli.py format --channel clip --text "제목... 한 문단..."
  python3 tools/channel_desc_cli.py format --channel shorts --file draft.txt

  # 발행 전 점검 (종료 코드 0=통과, 1=고칠 것 있음)
  python3 tools/channel_desc_cli.py lint --channel reels --file caption.txt

  # 블록을 직접 지정해 만들기
  python3 tools/channel_desc_cli.py build --channel clip --title "..." --summary "..." \
      --info "매일 15:00~24:00" --info "대전 서구 용문로 41-80" --action "저장해 두고 오늘 밤 달려가세요!" \
      --hashtags "#대전맛집 #진미오겹살"

  # JSON 한 번에
  echo '{"channel":"clip","title":"...","summary":"...","info":["..."],"action":["..."],"hashtags":["#대전맛집"]}' \
    | python3 tools/channel_desc_cli.py build --json -
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RULES_PATH = ROOT / "seeds" / "channel_desc_rules_2026w48.json"

DEFAULT_RULES = {
    "layout": {
        "line_target": [22, 44], "line_max": 54, "group_min": 2, "group_max": 5,
        "info_group_max": 6, "blank_ratio_max": 0.5, "desc_title_max": 34, "desc_line_max": 54,
    },
    "info_emoji": {"hours": "⏰", "address": "📍", "parking": "🚗"},
    "channels": {
        "clip": {"label": "네이버 클립", "title_max": 34, "chars_max": 3000, "emoji": False},
        "shorts": {"label": "유튜브 쇼츠", "title_max": 34, "chars_max": 5000, "emoji": True},
        "reels": {"label": "인스타 릴스", "title_max": 34, "chars_max": 2200, "emoji": True},
        "ig_feed": {"label": "인스타 피드", "title_max": 34, "chars_max": 2200, "emoji": True},
        "daangn": {"label": "당근 스토리", "title_max": 40, "chars_max": 1000, "emoji": True},
    },
}

INFO_ORDER = ["hours", "address", "parking"]
TIME_RE = re.compile(r"(?:\d{1,2}\s?:\s?\d{2})|(?:\d{1,2}\s?시(?!간)(?:\s?~\s?\d{1,2}\s?시)?)")
ADDRESS_RE = re.compile(r"(?:[가-힣]+(?:시|도)\s*)?[가-힣]+(?:구|군)\s?[가-힣0-9]*[로길]\s?\d+|(?:[가-힣]+동)\s?\d+-\d+")
PARKING_RE = re.compile(r"주차")
HASHTAG_LINE_RE = re.compile(r"^#[^\s#]+(?:\s+#[^\s#]+)*$")
EMOJI_RE = re.compile("[\U0001F300-\U0001FAFF\u2600-\u27BF\u2B00-\u2BFF]")
EMOJI_HEAD_RE = re.compile("^(?:[\U0001F300-\U0001FAFF\u2600-\u27BF\u2B00-\u2BFF]\ufe0f?\\s*)+")
SENT_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")


def load_rules() -> dict:
    rules = json.loads(json.dumps(DEFAULT_RULES))
    try:
        data = json.loads(RULES_PATH.read_text(encoding="utf-8"))
    except Exception:
        return rules
    for k, v in data.items():
        if k == "channels" and isinstance(v, dict):
            for ch, cfg in v.items():
                rules["channels"].setdefault(ch, {}).update(cfg)
        elif k == "layout" and isinstance(v, dict):
            rules["layout"].update(v)
        else:
            rules[k] = v
    return rules


def channel_rules(rules: dict, channel: str) -> dict:
    return rules["channels"].get(channel) or rules["channels"]["clip"]


def blocks_of(text: str) -> list:
    """빈 줄 기준 덩어리 → 덩어리 안의 줄 배열."""
    out = []
    for g in re.split(r"\n{2,}", str(text or "").replace("\r\n", "\n")):
        lines = [l.strip() for l in g.split("\n") if l.strip()]
        if lines:
            out.append(lines)
    return out


def split_sentences(line: str, line_max: int) -> list:
    s = re.sub(r"\s+", " ", str(line or "")).strip()
    if not s:
        return []
    out = []
    for part in SENT_SPLIT_RE.split(s):
        part = part.strip()
        if not part:
            continue
        while len(part) > line_max:
            cut = -1
            for m in re.finditer(r"[.!?]\s|[,\u00b7:]\s", part):
                if m.end() >= 15 and len(part) - m.end() >= 15:
                    cut = m.end()
                    break
            if cut < 0:
                break
            out.append(part[:cut].strip())
            part = part[cut:].strip()
        if part:
            out.append(part)
    return out


def strip_emoji(s: str) -> str:
    return EMOJI_HEAD_RE.sub("", str(s or "")).strip()


def info_kind_of(line: str):
    s = str(line or "")
    if PARKING_RE.search(s):
        return "parking"
    if ADDRESS_RE.search(s):
        return "address"
    if TIME_RE.search(s):
        return "hours"
    return None


def tidy_info(text: str, kind: str) -> str:
    s = re.sub(r"\s+", " ", str(text or "")).strip()
    if kind == "address":
        s = re.sub(r"\s*\d+(?:\s?[·,-]\s?\d+)*호\.?$", "", s).strip()
    return re.sub(r"[.\s]+$", "", s)


def split_info_line(line: str) -> list:
    s = re.sub(r"\s+", " ", str(line or "")).strip()
    if not s:
        return []
    kinds = sum([bool(TIME_RE.search(s)), bool(ADDRESS_RE.search(s)), bool(PARKING_RE.search(s))])
    if kinds < 2:
        return [{"kind": info_kind_of(s) or "hours", "text": s}]
    out = []
    for p in re.split(r"\s*,\s*|\s{2,}", s):
        p = p.strip()
        if p:
            out.append({"kind": info_kind_of(p) or "hours", "text": p})
    return out


def is_action_line(line: str) -> bool:
    s = str(line or "").strip()
    return bool(re.search(r"(?:세요|해요|하세요|보세요|가세요|드세요|주문|저장|달려|방문|들러|예약)[!.~\s]*$", s)) or bool(
        re.match(r"^(?:저장|꼭 |한 번 |다음엔|다음에)", s)
    )


def with_emoji(kind: str, text: str, ch: dict, rules: dict) -> str:
    if not ch.get("emoji"):
        return text
    e = rules.get("info_emoji", {}).get(kind)
    if not e:
        return text
    return text if text.startswith(e) else f"{e} {text}"


def build_desc(obj: dict, rules: dict) -> str:
    channel = obj.get("channel") or "clip"
    ch = channel_rules(rules, channel)
    line_max = int(rules["layout"].get("desc_line_max", 54))
    blocks = []

    title = re.sub(r"\s+", " ", str(obj.get("title") or "")).strip()
    if title:
        blocks.append([title])

    summary = obj.get("summary") or ""
    summary_lines = []
    for line in (summary if isinstance(summary, list) else str(summary).split("\n")):
        summary_lines.extend(split_sentences(line, line_max))
    if summary_lines:
        blocks.append(summary_lines)

    info = obj.get("info") or []
    if isinstance(info, (str, dict)):
        info = [info]
    entries = []
    for it in info:
        if isinstance(it, dict):
            kind = it.get("kind") or info_kind_of(it.get("text")) or "hours"
            text = str(it.get("text") or "").strip()
        else:
            text = str(it).strip()
            kind = info_kind_of(text) or "hours"
        for part in split_info_line(text):
            t = tidy_info(part["text"], part["kind"])
            if t:
                entries.append({"kind": part["kind"], "text": t})
    if entries:
        ordered = []
        for k in INFO_ORDER:
            ordered.extend([e for e in entries if e["kind"] == k])
        ordered.extend([e for e in entries if e["kind"] not in INFO_ORDER])
        blocks.append([with_emoji(e["kind"], e["text"], ch, rules) for e in ordered])

    action = obj.get("action") or ""
    action_lines = []
    for line in (action if isinstance(action, list) else str(action).split("\n")):
        action_lines.extend(split_sentences(line, line_max))
    if action_lines:
        blocks.append(action_lines)

    tags = obj.get("hashtags") or []
    if isinstance(tags, str):
        tags = tags.split()
    clean = []
    for t in tags:
        t = str(t).strip()
        if not t:
            continue
        one = t if t.startswith("#") else "#" + t
        if one not in clean:
            clean.append(one)
    if clean:
        blocks.append([" ".join(clean)])

    return "\n\n".join("\n".join(b) for b in blocks if b)


def normalize_desc(text: str, channel: str, rules: dict) -> str:
    line_max = int(rules["layout"].get("desc_line_max", 54))
    ch_cfg = channel_rules(rules, channel)
    headline, info, body, tags = [], [], [], []
    for group in blocks_of(text):
        lines = []
        for l in group:
            lines.extend(split_sentences(l, line_max))
        for line in lines:
            flat = re.sub(r"\s+", " ", line).strip()
            if HASHTAG_LINE_RE.match(flat):
                for t in re.findall(r"#[^\s#]+", flat):
                    if t not in tags:
                        tags.append(t)
                continue
            kind = info_kind_of(strip_emoji(flat))
            if kind:
                for part in split_info_line(strip_emoji(flat)):
                    clean = tidy_info(part["text"], part["kind"])
                    if clean and not any(x["text"] == clean for x in info):
                        info.append({"kind": part["kind"], "text": clean})
                continue
            body.append(line)
    if body:
        first = body.pop(0)
        title_max = int(ch_cfg.get("title_max", 34))
        if len(first) > title_max:
            cut = -1
            for i in range(max(0, title_max - 6), min(len(first) - 1, title_max + 10) + 1):
                if first[i] == " ":
                    cut = i
                    break
            if cut > 0:
                rest = first[cut + 1:].strip()
                if rest:
                    body = split_sentences(rest, line_max) + body
                body.insert(0, first[:cut].strip())
                headline.append(body.pop(0))
            else:
                headline.append(first)
        else:
            headline.append(first)
    action = [l for l in body if is_action_line(l)]
    summary = [l for l in body if not is_action_line(l)]
    return build_desc({
        "channel": channel,
        "title": headline[0] if headline else "",
        "summary": summary[:2],
        "info": info,
        "action": action,
        "hashtags": tags,
    }, rules)


def lint_desc(text: str, channel: str, rules: dict) -> list:
    ch = channel_rules(rules, channel)
    line_max = int(rules["layout"].get("desc_line_max", 54))
    blank_max = float(rules["layout"].get("blank_ratio_max", 0.5))
    raw = str(text or "")
    if not raw.strip():
        return [{"code": "empty", "level": "warn", "text": "설명란이 비었습니다"}]
    issues = []
    chars = len(raw)
    if chars > int(ch.get("chars_max", 3000)):
        issues.append({"code": "chars_over", "level": "warn", "text": f"{chars}자 — 한도 {ch.get('chars_max')}자"})

    groups = blocks_of(raw)
    lines = [l for g in groups for l in g]
    title = groups[0][0] if groups else ""
    if len(groups) < 3:
        issues.append({"code": "run_on", "level": "warn", "text": f"블록 {len(groups)}개 — 제목/요약/정보/행동/해시태그를 빈 줄로 나누세요"})
    all_lines = raw.replace("\r\n", "\n").split("\n")
    blank_ratio = (sum(1 for l in all_lines if not l.strip()) / len(all_lines)) if all_lines else 0
    if len(all_lines) >= 6 and blank_ratio > blank_max:
        issues.append({"code": "blank_ratio", "level": "warn", "text": f"빈 줄 비율 {round(blank_ratio * 100)}% — 블록 사이에만 한 줄"})
    if len(title) > int(ch.get("title_max", 32)):
        issues.append({"code": "title_long", "level": "warn", "text": f"첫 줄 {len(title)}자 — {ch.get('title_max')}자 이내(피드에서 잘림)"})
    for l in lines:
        if len(l) > line_max:
            issues.append({"code": "line_long", "level": "warn", "text": f"{len(l)}자 줄 — {line_max}자 이내로: {l[:18]}…"})

    merged = [l for l in lines if sum([bool(TIME_RE.search(l)), bool(ADDRESS_RE.search(l)), bool(PARKING_RE.search(l))]) >= 2]
    if merged:
        issues.append({"code": "info_merged", "level": "warn", "text": f"정보 {len(merged)}줄에 두 가지 이상 — 영업시간·주소·주차를 한 줄에 하나씩"})
    info_groups = [g for g in groups if all(info_kind_of(strip_emoji(l)) for l in g)]
    if len(info_groups) > 1:
        issues.append({"code": "info_split", "level": "warn", "text": f"정보 줄이 블록 {len(info_groups)}개로 흩어짐 — 한 덩어리로"})
    last = re.sub(r"\s+", " ", lines[-1]).strip() if lines else ""
    if any(HASHTAG_LINE_RE.match(re.sub(r"\s+", " ", l).strip()) for l in lines) and not HASHTAG_LINE_RE.match(last):
        issues.append({"code": "hashtag_not_last", "level": "warn", "text": "해시태그가 마지막 줄이 아닙니다"})
    if not ch.get("emoji"):
        hit = next((l for l in lines if EMOJI_RE.search(l)), None)
        if hit:
            issues.append({"code": "emoji_in_clip", "level": "warn", "text": f"클립은 이모지 없이 담백하게: {hit[:20]}"})
    return issues


def read_text(args) -> str:
    if args.text:
        return args.text
    if args.file and args.file != "-":
        return Path(args.file).read_text(encoding="utf-8")
    return sys.stdin.read()


def main() -> int:
    ap = argparse.ArgumentParser(description="클립·쇼츠·릴스 설명란 5블록 포맷터·린터")
    sub = ap.add_subparsers(dest="cmd")

    for name in ("format", "lint"):
        p = sub.add_parser(name)
        p.add_argument("--channel", default="clip", choices=["clip", "shorts", "reels", "ig_feed", "daangn"])
        p.add_argument("--text", default="")
        p.add_argument("--file", default="-")
        p.add_argument("--json", action="store_true")

    b = sub.add_parser("build")
    b.add_argument("--channel", default="clip", choices=["clip", "shorts", "reels", "ig_feed", "daangn"])
    b.add_argument("--json", nargs="?", const="-", default=None, help="JSON 입력(- 이면 stdin)")
    b.add_argument("--title", default="")
    b.add_argument("--summary", action="append", default=[])
    b.add_argument("--info", action="append", default=[])
    b.add_argument("--action", action="append", default=[])
    b.add_argument("--hashtags", default="")

    args = ap.parse_args()
    rules = load_rules()
    if not args.cmd:
        ap.print_help()
        return 2

    if args.cmd == "build":
        if args.json:
            payload = json.loads(sys.stdin.read() if args.json == "-" else Path(args.json).read_text(encoding="utf-8"))
            payload.setdefault("channel", args.channel)
        else:
            payload = {
                "channel": args.channel, "title": args.title, "summary": args.summary,
                "info": args.info, "action": args.action, "hashtags": args.hashtags,
            }
        out = build_desc(payload, rules)
        print(out)
        return 0

    text = read_text(args)
    if args.cmd == "format":
        print(normalize_desc(text, args.channel, rules))
        return 0

    issues = lint_desc(text, args.channel, rules)
    if args.json:
        print(json.dumps({"channel": args.channel, "issues": issues, "ok": not issues}, ensure_ascii=False, indent=2))
    else:
        if not issues:
            print("✅ 설명란 규칙 통과")
        else:
            for it in issues:
                print(f"[{it['level']}] {it['code']}: {it['text']}")
    return 0 if not issues else 1


if __name__ == "__main__":
    sys.exit(main())
