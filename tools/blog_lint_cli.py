#!/usr/bin/env python3
"""
tools/blog_lint_cli.py — 발행 전 블로그 린터 (CLI)

웹앱(#/lint, js/blogLint.js)과 같은 규칙·같은 임계치를 쓴다.
규칙 원본: seeds/blog_lint_rules_2026w48.json · 기준 문서: docs/BLOG_STANDARD_v4.md

사용
  python3 tools/blog_lint_cli.py draft.md --photo 20 --keyword 봉명동맛집,삼겹살
  python3 tools/blog_lint_cli.py draft.md --json
  cat draft.md | python3 tools/blog_lint_cli.py - --photo 18

초안 형식
  # [봉명동 삼겹살] 미미삼겹 유성점 솔직후기 : …
  본문…
  (사진은 ![설명](경로) 로 세고, --photo 를 주면 그 값을 쓴다)

종료 코드: 0 = 통과(고칠 것 0), 1 = 고칠 것 있음, 2 = 파일/규칙 오류
"""

from __future__ import annotations

import argparse
import json
import re
import statistics
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RULES_PATH = ROOT / "seeds" / "blog_lint_rules_2026w48.json"

DEFAULT_TARGETS = {
    "title_window": 14,
    "title_len": [26, 45],
    "first_screen_chars": 400,
    "body_len": [1700, 2300],
    "body_warn": [1500, 2500],
    "photos_min": 16,
    "chars_per_photo": [85, 130],
    "chars_per_photo_max": 140,
    "avg_line_max": 20,
    "short_lines_min": 60,
    "short_lines_warn": 50,
    "rhythm_wrap_chars": 20,
    "short_block_max_chars": 44,
    "hashtag_count": [8, 14],
    "hashtag_warn_over": 15,
    "core_tags_required": 3,
    "short_line_max_chars": 16,
}
DEFAULT_CORE = ["대전맛집", "유성맛집", "봉명동맛집"]
DEFAULT_LEXICON = [
    "대전", "유성", "봉명동", "어은동", "궁동", "온천", "관평동", "둔산",
    "삼겹살", "칼국수", "고기", "맛집", "술집", "해장", "제육", "혼밥", "주차",
]

IMG_RE = re.compile(r"!\[[^\]]*\]\([^)]*\)")
HTML_ONLY_RE = re.compile(r"^</?(img|br|div|p|figure|figcaption)\b", re.I)
TAG_RE = re.compile(r"#[^\s#.,!?()\[\]{}\"'<>]+")
INFO_PATTERNS = [
    ("동", re.compile(r"[가-힣]{2,}동")),
    ("도로명", re.compile(r"[가-힣]{2,}로\s?\d|[가-힣]{2,}로\b")),
    ("시·구", re.compile(r"[가-힣]{2,}(시|구)\s")),
    ("시간", re.compile(r"\d{1,2}\s?:\s?\d{2}")),
    ("전화", re.compile(r"0\d{1,2}[-)\s]\s?\d{3,4}\s?-\s?\d{4}")),
    ("영업", re.compile(r"영업\s?시간|라스트\s?오더|브레이크\s?타임")),
]


def load_rules() -> dict:
    base = {
        "targets": dict(DEFAULT_TARGETS),
        "coreTags": DEFAULT_CORE,
        "titleLexicon": DEFAULT_LEXICON,
        "rules": [],
        "version": "기본값",
    }
    try:
        data = json.loads(RULES_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"[warn] 규칙 파일을 읽지 못해 기본값으로 검사합니다: {exc}", file=sys.stderr)
        return base
    base["targets"].update(data.get("targets") or {})
    base["coreTags"] = data.get("coreTags") or DEFAULT_CORE
    base["titleLexicon"] = data.get("titleLexicon") or DEFAULT_LEXICON
    base["rules"] = data.get("rules") or []
    base["version"] = data.get("version") or "2026w48"
    base["benchmark"] = data.get("benchmark")
    return base


def split_draft(text: str) -> tuple[str, str]:
    """첫 '# ' 줄을 제목으로, 나머지를 본문으로."""
    lines = text.splitlines()
    title = ""
    start = 0
    for i, raw in enumerate(lines):
        line = raw.strip()
        if not line:
            continue
        if line.startswith("#"):
            title = line.lstrip("#").strip()
            start = i + 1
        break
    body = "\n".join(lines[start:]).strip()
    return title, body


def prose_lines(body: str) -> list[str]:
    out = []
    for raw in body.splitlines():
        line = raw.strip()
        if not line:
            continue
        if IMG_RE.fullmatch(line) or HTML_ONLY_RE.match(line):
            continue
        out.append(line)
    return out


def photos_of(body: str, given: int | None) -> int:
    if given is not None:
        return max(0, int(given))
    return len(IMG_RE.findall(body or ""))


def hashtags_of(body: str, extra: str) -> list[str]:
    found = [t[1:] for t in TAG_RE.findall(body or "")]
    found += [t.strip() for t in (extra or "").split(",")]
    out: list[str] = []
    for tag in found:
        tag = tag.lstrip("#").strip()
        if tag and tag not in out:
            out.append(tag)
    return out


def judge(rule_id: str, title: str, body: str, photos: int, tags: list[str],
          keywords: list[str], t: dict, lexicon: list[str], core: list[str]) -> tuple[str, str, str]:
    """(state, value, note) — state 는 pass / near / warn"""
    if rule_id == "title_front":
        win = title[: t["title_window"]]
        if not win:
            return "warn", "제목 없음", "제목을 넣어 주세요"
        hit = [k for k in keywords if k and k in win] or [w for w in lexicon if w in win]
        if hit:
            return "pass", win, f"앞 {t['title_window']}자에 \"{hit[0]}\""
        later = [w for w in lexicon if w in title]
        if later:
            return "near", win, f"지역·메뉴가 \"{later[0]}\" 뒤쪽에 있음 — 앞으로 당기세요"
        return "warn", win, "지역명·메뉴명이 앞 14자에 없음"

    if rule_id == "title_len":
        n = len(title)
        lo, hi = t["title_len"]
        if n == 0:
            return "warn", "0자", "제목을 넣어 주세요"
        if lo <= n <= hi:
            return "pass", f"{n}자", f"{lo}~{hi}자"
        return "warn", f"{n}자", f"{lo - n}자 부족" if n < lo else f"{n - hi}자 초과"

    if rule_id == "first_screen":
        head = body[: t["first_screen_chars"]]
        if not head.strip():
            return "warn", "본문 없음", "본문을 넣어 주세요"
        hit = [name for name, rx in INFO_PATTERNS if rx.search(head)]
        if len(hit) >= 2:
            return "pass", "·".join(hit), f"앞 {t['first_screen_chars']}자에 {len(hit)}종"
        if hit:
            return "pass", hit[0], "1종(권장 3종: 위치·영업·주차)"
        return "warn", "없음", "주소·영업시간·전화가 첫 화면에 없음"

    if rule_id == "body_len":
        n = len(body.strip())
        lo, hi = t["body_len"]
        w_lo, w_hi = t["body_warn"]
        if lo <= n <= hi:
            return "pass", f"{n}자", f"{lo}~{hi}자"
        if n < w_lo:
            return "warn", f"{n}자", f"{w_lo - n}자 모자람"
        if n > w_hi:
            return "warn", f"{n}자", f"{n - w_hi}자 넘음"
        return "near", f"{n}자", f"목표보다 {lo - n}자 짧음" if n < lo else f"목표보다 {n - hi}자 김"

    if rule_id == "photo_density":
        if not photos:
            return "warn", "사진 0장", "사진 수를 넣어 주세요"
        per = round(len(body.strip()) / photos)
        lo, hi = t["chars_per_photo"]
        if photos >= t["photos_min"] and lo <= per <= hi:
            return "pass", f"{photos}장 · 장당 {per}자", f"목표 {t['photos_min']}장↑ · 장당 {lo}~{hi}자"
        if photos >= t["photos_min"] and hi < per <= t["chars_per_photo_max"]:
            return "near", f"{photos}장 · 장당 {per}자", "글자 덩어리가 아직 큼 — 목표 장당 110자"
        if photos >= t["photos_min"]:
            return "warn", f"{photos}장 · 장당 {per}자", "사진을 더 넣거나 글자를 줄이세요"
        if photos >= int(t["photos_min"] * 0.75) and per <= t["chars_per_photo_max"]:
            return "near", f"{photos}장 · 장당 {per}자", f"{t['photos_min'] - photos}장 모자람"
        return "warn", f"{photos}장 · 장당 {per}자", f"사진 {t['photos_min'] - photos}장 이상 부족"

    if rule_id == "line_rhythm":
        lines = prose_lines(body)
        if not lines:
            return "warn", "—", "본문을 넣어 주세요"
        # 문단 호흡 v5(2026-11-21): 문단이 모바일에서 몇 줄로 보이는지(20자/줄)로 환산한다.
        wrap = t.get("rhythm_wrap_chars", 20)
        counted = sum(max(1, -(-len(x) // wrap)) for x in lines)
        total = sum(len(x) for x in lines)
        avg = round(total / counted, 1) if counted else 0
        if avg <= t["avg_line_max"]:
            return "pass", f"{avg}자", f"모바일 줄 환산 평균 {avg}자 · 문단 {len(lines)}개"
        return "warn", f"{avg}자", "평균 목표 15~20자 — 문단 하나를 2줄(22~44자)로"

    if rule_id == "short_lines":
        lines = prose_lines(body)
        # 짧은 호흡 v5: '16자 이하 한 줄' 대신 '2줄(44자) 이하 문단'을 센다(사용자의 실제 호흡 단위).
        cap = t.get("short_block_max_chars", 44)
        short = sum(1 for x in lines if len(x) <= cap)
        if short >= t["short_lines_min"]:
            return "pass", f"{short}개", f"{cap}자 이하(2줄) 문단 {short}개"
        if short >= t["short_lines_warn"]:
            return "near", f"{short}개", f"{t['short_lines_min'] - short}개 부족"
        return "warn", f"{short}개", f"{cap}자 이하 문단이 {short}개뿐 — 목표 {t['short_lines_min']}개"

    if rule_id == "hashtags":
        n = len(tags)
        lo, hi = t["hashtag_count"]
        required = core[: t["core_tags_required"]]
        missing = [c for c in required if c not in tags]
        label = f"{n}개" + (f" · 빠진 핵심 {len(missing)}" if missing else " · 핵심 OK")
        if n > t["hashtag_warn_over"]:
            return "warn", label, "15개 초과 — 무관 태그는 스팸 필터 위험"
        if len(missing) >= 2:
            return "warn", label, "핵심 태그 " + "·".join(missing) + " 빠짐"
        if lo <= n <= hi and not missing:
            return "pass", label, f"권장 10~12개 · 핵심 {len(required)}개 포함"
        if n == 0:
            return "warn", label, "본문 끝에 해시태그를 붙이세요"
        if n < lo:
            return "near", label, f"{lo - n}개 부족"
        if n > hi:
            return "near", label, f"{n - hi}개 초과"
        return "near", label, "핵심 태그 1개 빠짐"

    return "warn", "—", "알 수 없는 규칙"


def lint(title: str, body: str, photo_count: int | None, keyword_csv: str, rules: dict) -> dict:
    t = dict(DEFAULT_TARGETS)
    t.update(rules["targets"])
    core = rules["coreTags"]
    lexicon = rules["titleLexicon"]
    keywords = [k.strip() for k in (keyword_csv or "").split(",") if k.strip()]
    photos = photos_of(body, photo_count)
    tags = hashtags_of(body, "")

    items = []
    for rule in rules["rules"]:
        state, value, note = judge(rule["id"], title, body, photos, tags, keywords, t, lexicon, core)
        items.append({
            "id": rule["id"],
            "label": rule.get("label") or rule["id"],
            "weight": float(rule.get("weight") or 0),
            "state": state,
            "value": value,
            "note": note,
            "fix": rule.get("fix") or "",
        })

    score = round(sum(it["weight"] * (1 if it["state"] == "pass" else 0.5 if it["state"] == "near" else 0)
                      for it in items))
    lines = prose_lines(body)
    stats = {
        "title_chars": len(title),
        "body_chars": len(body.strip()),
        "photos": photos,
        "lines": len(lines),
        "short_lines": sum(1 for x in lines if len(x) <= t["short_line_max_chars"]),
        "avg_line": round(statistics.mean(len(x) for x in lines), 1) if lines else 0,
        "hashtags": len(tags),
    }
    return {
        "version": rules.get("version"),
        "score": score,
        "pass": all(it["state"] != "warn" for it in items),
        "items": items,
        "stats": stats,
    }


MARK = {"pass": "✓", "near": "△", "warn": "✗"}


def print_report(result: dict) -> None:
    st = result["stats"]
    print(f"발행 전 린터 · 기준 {result['version']} · 점수 {result['score']} / 100 — "
          + ("통과" if result["pass"] else "고칠 것 있음"))
    print(f"제목 {st['title_chars']}자 · 본문 {st['body_chars']}자 · 사진 {st['photos']}장 · "
          f"문단 평균 {st['avg_line']}자 · 16자 이하 줄 {st['short_lines']}개 · 해시태그 {st['hashtags']}개")
    print("-" * 66)
    for it in result["items"]:
        print(f"{MARK.get(it['state'], '?')} {it['label']:<10} {it['value']:<26} {it['note']}")
    warn = [it for it in result["items"] if it["state"] == "warn"]
    if warn:
        print("-" * 66)
        for it in warn:
            print(f"→ {it['label']}: {it['fix']}")


def main() -> int:
    ap = argparse.ArgumentParser(description="대전청년 블로그 발행 전 린터 (8항목)")
    ap.add_argument("draft", help="초안 md 경로 ('-' 이면 표준입력)")
    ap.add_argument("--photo", type=int, default=None, help="촬영 사진 수(안 주면 본문의 ![]() 개수)")
    ap.add_argument("--keyword", default="", help="노리는 검색어, 쉼표 구분")
    ap.add_argument("--json", action="store_true", help="결과를 JSON 으로")
    args = ap.parse_args()

    try:
        if args.draft == "-":
            text = sys.stdin.read()
        else:
            text = Path(args.draft).read_text(encoding="utf-8")
    except OSError as exc:
        print(f"[err] 초안을 읽지 못했습니다: {exc}", file=sys.stderr)
        return 2

    title, body = split_draft(text)
    result = lint(title, body, args.photo, args.keyword, load_rules())
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print_report(result)
    return 0 if result["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
