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
    "layout_line_max": 54,
    "layout_blank_ratio_max": 0.5,
    "layout_group_max": 5,
    "layout_info_group_max": 6,
}
DEFAULT_CORE = ["대전맛집", "유성맛집", "봉명동맛집"]
DEFAULT_LEXICON = [
    "대전", "유성", "봉명동", "어은동", "궁동", "온천", "관평동", "둔산",
    "삼겹살", "칼국수", "고기", "맛집", "술집", "해장", "제육", "혼밥", "주차",
]

INFO_HEAD_RE = re.compile("^(?:\U0001F4CD|\u23F0|\U0001F697|\U0001F4B0|\U0001F4CA|\U0001F4C8|\U0001F3E6|\U0001F4A1|\U0001F4B3|\U0001F4DE|\u260E|\U0001F4CC|\u2714|\U0001F551|\U0001F550|\U0001F552|\U0001F17F|\u23F3|\U0001F374|\U0001F699|\U0001F39F)")
CAPTION_HEAD_RE = re.compile(r"^(?:\u25B2|\u25B3)")
HASHTAG_LINE_RE = re.compile(r"^#[^\s#]+(?:\s+#[^\s#]+)*$")
PHOTO_MARK_RE = re.compile(r"^(?:\[(?:사진|\U0001F4F8)[^\]]*\]|!\[[^\]]*\]\([^)]*\))$")
IMG_RE = re.compile(r"!\[[^\]]*\]\([^)]*\)")
LINK_CARD_RE = re.compile(r"^\[LINK_CARD:[^\]]*\]$")
LINK_CARD_TOKEN_RE = re.compile(r"\[LINK_CARD:[^\]]*\]")
PHOTO_LINE_RE = re.compile(r"^\[(?:사진|📸)[^\]]*\]$")
SUBHEAD_RE = re.compile(r"^(?:[▍■◆▶▸]|\*\*|#{1,6}\s|\d{1,2}[.)]\s|[①-⑳]|※)")
FOOD_HINT_RE = re.compile(r"(맛집|고기|술집|카페|식당|삼겹|오겹|국수|칼국수|해장|제육|혼밥|주차|야장|꼬치|찜|탕|분식|베이|디저트|와인|호프|파스타)")
# 2026-11-24: 정보 카드 머리 확장(📊🏦💡) — js/blogTone.js INFO_HEAD_RE 와 같은 목록

HTML_ONLY_RE = re.compile(r"^</?(img|br|div|p|figure|figcaption)\b", re.I)
TAG_RE = re.compile(r"#[^\s#.,!?()\[\]{}\"'<>]+")
INFO_PATTERNS = [
    ("동", re.compile(r"[가-힣]{2,}동")),
    ("도로명", re.compile(r"[가-힣]{2,}(?:로|길)\s?\d")),
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
        "aiTone": dict(AI_TONE_DEFAULTS),
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
    base["aiTone"] = data.get("aiTone") or dict(AI_TONE_DEFAULTS)
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


def layout_groups(body: str) -> list[list[str]]:
    """빈 줄 기준 덩어리 → 덩어리 안의 줄 배열(줄바꿈 배치 판정용)."""
    out: list[list[str]] = []
    for g in re.split(r"\n{2,}", str(body or "").replace("\r\n", "\n")):
        lines = [l.strip() for l in g.split("\n") if l.strip()]
        if lines:
            out.append(lines)
    return out


def layout_kind(lines: list[str]) -> str:
    first = lines[0].strip() if lines else ""
    if PHOTO_MARK_RE.match(first):
        return "photo"
    if CAPTION_HEAD_RE.match(first):
        return "caption"
    if len(lines) == 1 and HASHTAG_LINE_RE.match(first):
        return "hashtag"
    if all(INFO_HEAD_RE.match(l.strip()) for l in lines):
        return "info"
    if len(lines) == 1 and (re.match(r"^\*\*[^*].*\*\*$", first) or re.match(r"^#{1,6}\s", first)):
        return "heading"
    return "prose"


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


PAID_HINT_RE = re.compile(r"(체험단|협찬|제공\s*받|무상\s*으로?\s*제공|서비스\s*이용권|제품을\s*제공|원고료|광고비)")
PAID_NOTICE_RE = re.compile(r"(경제적\s*대가|제공\s*받아\s*작성|대가를\s*받|무상으로\s*제공\s*받|협찬\s*받아\s*작성|본\s*게시물은.{0,20}제공\s*받)")
PROFIT_NOTICE_RE = re.compile(r"(쇼핑\s*커넥트|크리에이터샵|커넥트\s*활동|쿠팡\s*파트너스|파트너스\s*활동|수수료를?\s*(?:제공|지급)\s*받|일정액의?\s*수수료|제휴\s*마케팅)")
OWN_MONEY_RE = re.compile(r"내돈내산")
PROFIT_LINK_RE = re.compile(r"https?://[^\s]*(?:(?:connect|shopping)\.naver\.com|smartstore\.naver\.com|brand\.naver\.com|naver\.me/|link\.coupang\.com|coupang\.com/vp|partners\.coupang\.com|aliexpress\.com/item)[^\s]*", re.I)
NATIVE_FEATURE_RE = re.compile(r"(내돈내산|글감|블로그씨|미션위젯|챌린지\s*프로그램|위젯)")


def _compliance(body: str) -> dict:
    """공개 표시 3항목 — js/blogCompliance.js analyzeCompliance 와 같은 판정."""
    text = str(body or "")
    paid_text = "\n".join(l for l in text.split("\n") if not PROFIT_NOTICE_RE.search(l))
    return {
        "paid": bool(PAID_HINT_RE.search(paid_text)),
        "profit_notice": bool(PROFIT_NOTICE_RE.search(text)),
        "notice_anywhere": bool(PAID_NOTICE_RE.search(text)),
        "notice_top": bool(PAID_NOTICE_RE.search(text[:400])),
        "own_money": len(OWN_MONEY_RE.findall(text)),
        "profit_links": list(dict.fromkeys(PROFIT_LINK_RE.findall(text))),
        "conflict": bool(OWN_MONEY_RE.search(text)) and bool(PROFIT_LINK_RE.search(text)),
        "native": bool(NATIVE_FEATURE_RE.search(text)),
    }


def _keyword_tokens(keywords: list[str]) -> list[str]:
    """키워드 문구 전체 + 낱말 단위 — "스마트스토어 개인판매자 개설" → "스마트스토어"."""
    out: list[str] = []
    for k in keywords or []:
        k = (k or "").strip()
        if not k:
            continue
        if k not in out:
            out.append(k)
        for w in k.split():
            if len(w) >= 2 and w not in out:
                out.append(w)
    return out


def _is_place_post(title: str, keywords: list[str], lexicon: list[str]) -> bool:
    """지역 + 메뉴(고기·술집·카페…)가 함께 있는 '장소 글'인가. 아니면 맛집 기준을 강제하지 않는다."""
    text = f"{title or ''} {' '.join(keywords or [])}"
    region = any(w in text for w in (lexicon or []))
    return bool(region and FOOD_HINT_RE.search(text))


def _is_structural_line(line: str) -> bool:
    s = (line or "").strip()
    if not s:
        return True
    if HASHTAG_LINE_RE.match(s) or LINK_CARD_RE.match(s) or PHOTO_LINE_RE.match(s) or PHOTO_MARK_RE.match(s):
        return True
    if SUBHEAD_RE.match(s) or s[0] in "━─╌":
        return True
    return False


def judge(rule_id: str, title: str, body: str, photos: int, tags: list[str],
          keywords: list[str], t: dict, lexicon: list[str], core: list[str]) -> tuple[str, str, str]:
    """(state, value, note) — state 는 pass / near / warn"""
    if rule_id == "title_front":
        win = title[: t["title_window"]]
        if not win:
            return "warn", "제목 없음", "제목을 넣어 주세요"
        tokens = _keyword_tokens(keywords)
        hit = [k for k in tokens if k and k in win] or [w for w in lexicon if w in win]
        if hit:
            return "pass", win, f"앞 {t['title_window']}자에 \"{hit[0]}\""
        later = [w for w in lexicon if w in title]
        if later:
            return "near", win, f"지역·메뉴가 \"{later[0]}\" 뒤쪽에 있음 — 앞으로 당기세요"
        if not _is_place_post(title, keywords, lexicon):
            return "near", win, "주제어를 앞 14자에 — 지역·메뉴 글이 아니어서 경고는 아니에요"
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
        if not _is_place_post(title, keywords, lexicon):
            return "near", "해당 없음", "장소 글이 아니어서 위치·영업 정보는 필요 없습니다"
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

    if rule_id == "line_layout":
        lines = prose_lines(body)
        if not lines:
            return "warn", "—", "본문을 넣어 주세요"
        # 2026-11-22 성래 님 실측: 한 줄 22~44자(상한 54) · 2~5줄을 붙여 덩어리 · 빈 줄은 덩어리 사이에만.
        line_max = int(t.get("layout_line_max", 54))
        blank_max = float(t.get("layout_blank_ratio_max", 0.5))
        groups = layout_groups(body)
        kinds = [layout_kind(g) for g in groups]
        # 2026-11-24: 해시태그·링크카드·사진·소제목·구분선은 글자 길이·덩어리 판정에서 뺀다(js/blogLint.js 와 같음)
        over = sum(1 for l in lines if not _is_structural_line(l) and len(l) > line_max)
        info_gap = sum(1 for i, k in enumerate(kinds) if i > 0 and k == "info" and kinds[i - 1] == "info")
        orphans = sum(1 for i, g in enumerate(groups)
                      if len(g) == 1 and kinds[i] == "prose"
                      and not _is_structural_line(g[0]) and not g[0].strip().startswith(("(", "[", "（")))
        all_lines = str(body or "").replace("\r\n", "\n").split("\n")
        blank_ratio = (sum(1 for l in all_lines if not l.strip()) / len(all_lines)) if all_lines else 0
        bad = []
        if over:
            bad.append(f"{line_max}자 초과 {over}줄")
        if info_gap:
            bad.append(f"정보 줄이 빈 줄로 끊김 {info_gap}곳")
        if len(lines) >= 8 and blank_ratio > blank_max:
            bad.append(f"빈 줄 {round(blank_ratio * 100)}%")
        if len(lines) >= 6 and orphans >= 2:
            bad.append(f"한 줄 덩어리 {orphans}개")
        if not bad:
            return "pass", f"{len(groups)}덩어리", f"덩어리 {len(groups)}개 · 줄 {len(lines)}개"
        if len(bad) == 1:
            return "near", bad[0], "줄을 붙여 덩어리로 만들면 한 번에 해결됩니다"
        return "warn", " · ".join(bad[:2]), f"한 줄 {line_max}자 이내 · 2~5줄을 붙여 덩어리 · 빈 줄은 덩어리 사이에만."

    if rule_id == "hashtags":
        n = len(tags)
        lo, hi = t["hashtag_count"]
        place = _is_place_post(title, keywords, lexicon)
        required = core[: t["core_tags_required"]]
        missing = [c for c in required if c not in tags]
        strict = place          # 장소 글일 때만 핵심 태그를 강제한다(2026-11-24)
        label = f"{n}개" + (f" · 빠진 핵심 {len(missing)}" if (missing and strict) else "")
        if n > t["hashtag_warn_over"]:
            return "warn", label, "15개 초과 — 무관 태그는 스팸 필터 위험"
        if n == 0:
            return "warn", label, "본문 끝에 해시태그를 붙이세요"
        if strict and len(missing) >= 2:
            return "warn", label, "핵심 태그 " + "·".join(missing) + " 빠짐"
        if lo <= n <= hi and (not missing or not strict):
            return "pass", label, (f"권장 10~12개 · 핵심 {len(required)}개 포함" if strict else "권장 10~12개")
        if n < lo:
            return "near", label, f"{lo - n}개 부족"
        if n > hi:
            return "near", label, f"{n - hi}개 초과"
        return "near", label, "핵심 태그 1개 빠짐"

    if rule_id == "link_card":
        stripped = LINK_CARD_TOKEN_RE.sub("", body)
        cards = len(LINK_CARD_TOKEN_RE.findall(body))
        if re.search(r"https?://", stripped):
            return "warn", "줄글 URL 있음", "링크 카드로 바꾸세요"
        if cards == 0:
            return "near", "카드 0개", "관련 내 글 1개를 링크 카드로 넣으세요"
        if cards > 2:
            return "warn", f"{cards}개", "링크 카드는 1~2개를 권장합니다"
        return "pass", f"{cards}개", "카드 1개 = URL 1개"

    if rule_id == "link_anchor":
        bad, n = [], 0
        for m in LINK_CARD_TOKEN_RE.finditer(body):
            n += 1
            before = [x.strip() for x in body[: m.start()].split("\n") if x.strip()]
            prev = re.sub(r"^[>*\-\s]+", "", before[-1]) if before else ""
            if len(prev) < 5 or re.search(r"여기|링크|클릭|참고|바로가기", prev):
                bad.append(prev or "(설명 없음)")
        if not n:
            return "near", "카드 없음", "카드 앞에 글 제목을 그대로 쓴 한 줄을 두세요"
        if bad:
            return "warn", f"{len(bad)}건", "카드 앞 설명에 글 핵심 주제를 적으세요"
        return "pass", "OK", "카드 앞 한 줄 설명 있음"

    if rule_id == "link_embed_hint":
        n = len(LINK_CARD_TOKEN_RE.findall(body))
        if not n:
            return "near", "—", "카드가 없으면 안내도 필요 없습니다"
        return "pass", "안내 표시", "URL 붙여넣고 Enter → 카드만 남기기"

    if rule_id in ("disclosure_paid", "own_money_conflict", "native_features"):
        a = _compliance(body)
        if rule_id == "disclosure_paid":
            if a["paid"]:
                if a["notice_top"]:
                    return "pass", "상단 표기 있음", "앞 400자에 경제적 대가 표기"
                if a["notice_anywhere"]:
                    return "near", "본문 뒤쪽 표기", "표시는 본문 맨 위(앞 400자)에 두세요"
                return "warn", "표기 없음", "대가를 받은 글은 본문 맨 위에 “경제적 대가를 제공받아 작성” 문구를 넣으세요"
            if a["profit_notice"]:
                return "pass", "제휴 고지 있음", "쇼핑 커넥트·파트너스 고지 문구 — ‘대가 표시’는 따로 필요 없습니다"
            return "near", "대가 표현 없음", "체험·협찬 글에만 표시가 필요합니다"
        if rule_id == "own_money_conflict":
            if a["conflict"]:
                return "warn", f"내돈내산 {a['own_money']}회 + 수익 링크 {len(a['profit_links'])}개", "한 글에 함께 쓰면 운영정책·표시광고법 위반입니다 — 둘 중 하나를 빼세요"
            if a["profit_links"]:
                return "near", f"수익 링크 {len(a['profit_links'])}개", "제휴 링크 글은 내돈내산 인증을 붙이지 마세요"
            if a["own_money"]:
                return "pass", "내돈내산만", "수익 링크가 없어 함께 쓰기 위험 없음"
            return "near", "해당 없음", "내돈내산 인증을 붙일 글인지 한 번 확인하세요"
        if a["native"]:
            return "pass", "흔적 있음", "네이버 네이티브 기능(내돈내산·글감·블로그씨·위젯) 중 하나를 씁니다"
        return "near", "없음", "발행 전 확인: 내돈내산 인증 · 글감 카드 · 블로그씨 · 미션위젯"

    return "warn", "—", "알 수 없는 규칙"


# 링크 카드 3 + 공개 표시 3 — 웹(#/lint)과 같은 항목. 가중치 0(점수에 넣지 않는다).
EXTRA_RULES = [
    {"id": "link_card", "label": "링크 카드", "weight": 0, "fix": "줄글 주소 대신 [LINK_CARD: URL] 표시로 바꾸세요."},
    {"id": "link_anchor", "label": "링크 문구", "weight": 0, "fix": "카드 앞 한 줄에 글 제목을 그대로 쓰세요(여기·링크·클릭 금지)."},
    {"id": "link_embed_hint", "label": "붙이는 순서", "weight": 0, "fix": "URL을 붙여넣고 Enter → 카드가 뜨면 남은 URL 글자를 지우세요."},
    {"id": "disclosure_paid", "label": "대가 표시", "weight": 0, "policy": True, "fix": "대가를 받은 글은 본문 맨 위에 “경제적 대가를 제공받아 작성했습니다”를 텍스트로 넣으세요."},
    {"id": "own_money_conflict", "label": "내돈내산·제휴", "weight": 0, "policy": True, "fix": "내돈내산 인증과 수익형 링크는 한 글에 같이 쓰지 마세요."},
    {"id": "native_features", "label": "네이버 기능", "weight": 0, "policy": True, "fix": "내돈내산·글감·블로그씨·미션위젯 중 하나를 발행 전에 확인하세요."},
]

AI_TONE_DEFAULTS = {
    "version": "2026w48b",
    "hold_at": 2,
    "intro_chars": 150,
    "first_chars": 400,
    "sd_min": 6.0,
    "sentence_min": 8,
    "number_ratio_min": 0.15,
    "number_blocks_min": 8,
    "headings_min": 3,
    "heading_spread_max": 4,
    "first_person_min": 2,
    "over_polite_max": 4,
    "translationese_min": 4,
    "translationese_near": 2,
    "translationese_min_chars": 300,
    "translationese_terms": [
        {"label": "~에 대해(서)", "pattern": "에 대해"},
        {"label": "~에 대한", "pattern": "에 대한"},
        {"label": "~에 있어(서)", "pattern": "에 있어"},
        {"label": "~를 통해(서)", "pattern": "를 통해"},
        {"label": "~에 의해", "pattern": "에 의해"},
        {"label": "~로 인해", "pattern": "로 인해"},
        {"label": "~할 수 있습니다", "pattern": "할 수 있"},
        {"label": "~것이 중요합니다", "pattern": "것이 중요하"},
        {"label": "~가지고 있다", "pattern": "가지고 있"},
        {"label": "~라는 점에서", "pattern": "라는 점에서"},
        {"label": "~경향이 있다", "pattern": "경향이 있"},
        {"label": "결론적으로", "pattern": "결론적으로"},
    ],
    "first_person_min_by_preset": {"jajo": 1, "review": 2, "info": 1},
    "keyword_count": [3, 5],
    "keyword_fail": 6,
    "regex": {
        "first_person": r"(?<![가-힣])(?:나|내|제|저|우리)(?=[는가도만한걸게에선를의]|[\s,.!?~…]|$)",
        "experience": r"(?:직접|실제로|써보니|써 보고|가보니|가 봤|먹어보니|먹어 봤|앉아보니|느꼈|느낀|개인적으로|내 기준|솔직히)",
        "cliche": r"(?:도움이 되셨|도움이 되었|기대해 봅니다|기대해봅니다|응원합니다|응원하겠습니다|마치겠습니다|마무리하겠습니다|알아보았습니다|이상으로 (?:마치|정리)|그럼 다음에)",
        "over_polite": r"(?:물론|다만|참고로|혹시라도|부담 없이|부담없이|편하게|편한 마음)",
        "translationese": r"(?:에 대해|에 대한|에 있어|를 통해|에 의해|로 인해|할 수 있|것이 중요하|가지고 있|라는 점에서|경향이 있|결론적으로)",
        "proper": r"(?:[가-힣]{2,}(?:동|구|시|역|점|로|길)|[A-Za-z]{2,})",
        "number": r"[0-9]",
        "dia_question": r"(?:\?|까\?|나요|인가요|을까|ㄹ까|궁금|고민|헷갈|모르겠|찾는다면|고를 때|정할 때|알아야)",
        "dia_answer": r"(?:답(?:이다|입니다|이에요)|정답|결론(?:은|부터|적)|바로 (?:이|그|여기)|추천(?:한다|합니다|해요|드립니다|이에요)|괜찮(?:다|습니다|아요|네요)|낫(?:다|습니다|아요)|만족|좋(?:다|습니다|았|네요))",
        "dia_condition": r"(?:면 |라면|경우|때 |한정|평일|주말|점심|저녁|예약|주차|가격|가성비|웨이팅|대기|영업)",
        "dia_target": r"(?:분들|분께|분이|분에게|초보|직장인|커플|혼밥|가족|친구|학생|손님|혼자|야근|퇴근|위한|하는 사람)",
        "dia_conclusion": r"(?:추천|비추|재방문|또 갈|다시 갈|괜찮|좋았|만족|아쉬|결론|정리|총평|한 줄|다음에|다음엔|또 오)",
    },
    "patterns": [
        {"id": "generic_intro", "no": 1, "label": "일반론 서론"},
        {"id": "symmetric_headings", "no": 2, "label": "대칭 소제목"},
        {"id": "cliche_ending", "no": 3, "label": "결말 상투어"},
        {"id": "uniform_sentences", "no": 4, "label": "균일 문장 길이"},
        {"id": "no_numbers", "no": 5, "label": "수치 없는 주장"},
        {"id": "first_person_absent", "no": 6, "label": "1인칭 부재"},
        {"id": "over_polite", "no": 7, "label": "과잉 친절"},
        {"id": "translationese", "no": 8, "label": "번역투"},
    ],
    "dia": {
        "label": "첫 400자 D.I.A.+",
        "elements": [
            {"id": "question", "label": "질문·문제", "regex": "dia_question"},
            {"id": "answer", "label": "답", "regex": "dia_answer"},
            {"id": "condition", "label": "조건", "regex": "dia_condition"},
            {"id": "target", "label": "대상", "regex": "dia_target"},
            {"id": "conclusion", "label": "결론", "regex": "dia_conclusion"},
        ],
    },
}

BLOCK_NOISE = re.compile(r"^(?:!\[[^\]]*\]\([^)]*\)|</?(?:img|br|div|p|figure|figcaption)\b|\[사진\]|▲)", re.I)
EMOJI_HEAD = re.compile(r"^[\U0001F300-\U0001FAFF\u2600-\u27BF\u2B00-\u2BFF]")


def to_blocks(text: str) -> list[str]:
    norm = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    return [b.strip() for b in re.split(r"\n{2,}", norm) if b.strip()]


def prose_blocks(text: str) -> list[str]:
    return [b for b in to_blocks(text) if not BLOCK_NOISE.match(b)]


def headings_of(blocks: list[str]) -> list[dict]:
    """소제목 — 우리 에디터는 `###`가 아니라 **굵은 한 줄**을 쓴다(js/blogAiTone.js 와 같은 규칙)."""
    out: list[dict] = []
    total = len(blocks)
    for i, raw in enumerate(blocks):
        s = raw.strip()
        if not s:
            continue
        if (re.fullmatch(r"\*\*[^*].*\*\*", s) or re.match(r"#{1,6}\s", s)
                or EMOJI_HEAD.match(s)):
            out.append({"text": re.sub(r"^#{1,6}\s*", "", s).replace("**", "").strip(), "kind": "strong"})
            continue
        if i == 0 or i == total - 1:
            continue
        if len(s) > 22 or len(s) < 3:
            continue
        if re.search(r"[.!?。？！]$", s):
            continue
        if "," in s or re.match(r"^[-*•·>▲▸]", s) or s.startswith("#"):
            continue
        if re.search(r"(?:다|요|까|죠|네|음|함|임|겠|습니다|해요|었다|았다)$", s):
            continue
        out.append({"text": s, "kind": "weak"})
    strong = [h for h in out if h["kind"] == "strong"]
    return strong if len(strong) >= 3 else out


def sentences_of(text: str) -> list[str]:
    flat = re.sub(r"\n+", " ", text or "")
    return [s.strip() for s in re.findall(r"[^.!?。？！]+[.!?。？！]?", flat) if len(s.strip()) >= 6]


def _pstdev(nums: list[int]) -> float:
    if len(nums) < 2:
        return 0.0
    return statistics.pstdev(nums)


def _count_re(text: str, src: str) -> int:
    try:
        return len(re.findall(src, text or ""))
    except re.error:
        return 0


def _has_re(text: str, src: str) -> bool:
    try:
        return re.search(src, text or "") is not None
    except re.error:
        return False


def _kw_list(keywords) -> list[str]:
    raw = keywords if isinstance(keywords, list) else str(keywords or "").split(",")
    out: list[str] = []
    for x in raw:
        s = str(x or "").strip().lstrip("#")
        if s and s not in out:
            out.append(s)
    return out


def _count_text(text: str, kw: str) -> int:
    s = re.sub(r"\s+", " ", text or "")
    k = re.sub(r"\s+", " ", str(kw or "").strip())
    if not k:
        return 0
    return s.count(k)


def ai_tone_scan(body: str, keywords, preset: str, cfg: dict) -> dict:
    c = dict(AI_TONE_DEFAULTS)
    c.update(cfg or {})
    c["regex"] = {**AI_TONE_DEFAULTS["regex"], **((cfg or {}).get("regex") or {})}
    c["first_person_min_by_preset"] = {**AI_TONE_DEFAULTS["first_person_min_by_preset"],
                                       **((cfg or {}).get("first_person_min_by_preset") or {})}
    rx = c["regex"]
    defs = cfg.get("patterns") if cfg and cfg.get("patterns") else AI_TONE_DEFAULTS["patterns"]
    fix_of = {p["id"]: p.get("fix", "") for p in (cfg or {}).get("patterns") or []}

    blocks = prose_blocks(body)
    text = "\n\n".join(blocks)
    total = len(text)
    stats = {"blocks": len(blocks), "chars": total, "headings": 0, "heading_spread": 0,
             "sentences": 0, "sentence_sd": 0.0, "first_person": 0, "experience": 0,
             "number_blocks": 0, "number_ratio": 0.0, "intro_chars": 0, "over_polite": 0,
             "translationese": 0}

    def item(pid: str, state: str, value: str, note: str) -> dict:
        d = next((p for p in defs if p["id"] == pid), {"id": pid, "no": 0, "label": pid})
        return {"id": pid, "no": d.get("no", 0), "label": d.get("label", pid),
                "state": state, "value": value, "note": note, "fix": fix_of.get(pid, "")}

    if not total:
        pats = [item(p["id"], "near", "—", "본문을 넣으면 검사합니다") for p in defs]
        return {"patterns": pats, "hits": [], "count": 0, "hold": False, "hold_reasons": [],
                "stats": stats, "summary": "본문 없음", "version": c.get("version", "2026w48")}

    pats: list[dict] = []

    # ① 일반론 서론
    intro = text[: int(c["intro_chars"])]
    fp = _count_re(intro, rx["first_person"])
    num = _count_re(intro, rx["number"])
    proper = _count_re(intro, rx["proper"]) + sum(_count_text(intro, k) for k in _kw_list(keywords))
    stats["intro_chars"] = len(intro)
    if stats["intro_chars"] < 40:
        pats.append(item("generic_intro", "near", f"앞 {stats['intro_chars']}자", "서론이 짧아 판정하지 않습니다"))
    elif fp + num + proper == 0:
        pats.append(item("generic_intro", "warn", "1인칭 0 · 숫자 0 · 고유명사 0",
                          "앞 150자가 일반론입니다 — 첫 문장에 내 경험이나 숫자를 넣으세요"))
    else:
        pats.append(item("generic_intro", "pass", f"1인칭 {fp} · 숫자 {num} · 고유명사 {proper}", "앞 150자에 근거가 있음"))

    # ② 대칭 소제목
    heads = headings_of(blocks)
    lens = [len(h["text"]) for h in heads]
    spread = (max(lens) - min(lens)) if lens else 0
    ends = [h["text"][-2:] for h in heads]
    same_end = len(heads) >= 3 and all(e == ends[0] for e in ends)
    stats["headings"] = len(heads)
    stats["heading_spread"] = spread
    if len(heads) < int(c["headings_min"]):
        pats.append(item("symmetric_headings", "near", f"소제목 {len(heads)}개", f"소제목 {c['headings_min']}개 이상이어야 판정합니다"))
    elif spread <= int(c["heading_spread_max"]) or same_end:
        why = f"글자수 편차 {spread}자" if spread <= int(c["heading_spread_max"]) else "모든 소제목이 같은 어미"
        pats.append(item("symmetric_headings", "warn", f"소제목 {len(heads)}개 · {why}", "소제목이 대칭입니다 — 하나를 질문·단언으로 바꾸세요"))
    else:
        pats.append(item("symmetric_headings", "pass", f"소제목 {len(heads)}개 · 편차 {spread}자", "소제목 길이가 들쭉날쭉 — 사람이 쓴 모양"))

    # ③ 결말 상투어
    tail = "\n".join(blocks[-2:])
    m = re.search(rx["cliche"], tail)
    if m:
        pats.append(item("cliche_ending", "fail", m.group(0), "마지막 문단이 인사말입니다 — 결론·다음 행동으로 끝내세요"))
    else:
        pats.append(item("cliche_ending", "pass", "없음", "결말에 상투어 없음"))

    # ④ 균일 문장 길이
    sent = sentences_of(text)
    sd = round(_pstdev([len(s) for s in sent]), 1)
    stats["sentences"] = len(sent)
    stats["sentence_sd"] = sd
    if len(sent) < int(c["sentence_min"]):
        pats.append(item("uniform_sentences", "near", f"문장 {len(sent)}개", f"문장 {c['sentence_min']}개 이상이어야 판정합니다"))
    elif sd < float(c["sd_min"]):
        pats.append(item("uniform_sentences", "warn", f"문장 {len(sent)}개 · SD {sd}",
                         f"문장 길이가 고릅니다(SD {sd} < {c['sd_min']}) — 단문 하나를 섞으세요"))
    else:
        pats.append(item("uniform_sentences", "pass", f"문장 {len(sent)}개 · SD {sd}", "문장 길이 편차가 있음"))

    # ⑤ 수치 없는 주장
    with_num = sum(1 for b in blocks if _has_re(b, rx["number"]))
    ratio = round(with_num / len(blocks), 2) if blocks else 0.0
    stats["number_blocks"] = with_num
    stats["number_ratio"] = ratio
    if len(blocks) < int(c["number_blocks_min"]):
        pats.append(item("no_numbers", "near", f"문단 {len(blocks)}개", f"문단 {c['number_blocks_min']}개 이상이어야 비율을 봅니다"))
    elif ratio < float(c["number_ratio_min"]):
        pats.append(item("no_numbers", "warn", f"{round(ratio * 100)}%",
                         f"숫자가 든 문단이 {round(ratio * 100)}% — 가격·시간·대기 같은 수치를 넣으세요"))
    else:
        pats.append(item("no_numbers", "pass", f"{round(ratio * 100)}%", f"숫자가 든 문단 {with_num}/{len(blocks)}"))

    # ⑥ 1인칭 부재 (FAIL 아니라 WARN)
    fp_all = _count_re(text, rx["first_person"])
    exp = _count_re(text, rx["experience"])
    fp_min = c["first_person_min_by_preset"].get(preset, c["first_person_min"])
    stats["first_person"] = fp_all
    stats["experience"] = exp
    if fp_all + exp >= fp_min:
        pats.append(item("first_person_absent", "pass", f"1인칭 {fp_all} · 경험 {exp}",
                         f"하한 {fp_min}회" + (f" ({preset})" if preset else "")))
    else:
        pats.append(item("first_person_absent", "warn", f"1인칭 {fp_all} · 경험 {exp}",
                         f"내가 본 것 한 줄을 넣으세요(하한 {fp_min}회" + (f" · {preset}" if preset else "") + ")"))

    # ⑦ 과잉 친절
    polite = _count_re(text, rx["over_polite"])
    stats["over_polite"] = polite
    if polite > int(c["over_polite_max"]):
        pats.append(item("over_polite", "warn", f"{polite}회", f"양보 접속사가 {polite}회 — 2회 이하로 덜어내세요"))
    else:
        pats.append(item("over_polite", "pass", f"{polite}회", f"상한 {c['over_polite_max']}회 이내"))

    # ⑧ 번역투 (2026-11-23)
    terms = c.get("translationese_terms") or AI_TONE_DEFAULTS["translationese_terms"]
    counts = []
    for t in terms:
        n = _count_re(text, re.escape(t["pattern"]))
        if n:
            counts.append((t["label"], n))
    counts.sort(key=lambda x: -x[1])
    hit = sum(n for _, n in counts)
    stats["translationese"] = hit
    top = " · ".join(f"{lb} {n}" for lb, n in counts[:2])
    if total < int(c.get("translationese_min_chars", 300)):
        pats.append(item("translationese", "near", f"본문 {total}자", "본문이 짧아 번역투를 판정하지 않습니다"))
    elif hit >= int(c.get("translationese_min", 4)):
        pats.append(item("translationese", "warn", f"{hit}회" + (f" · {top}" if top else ""),
                         f"번역투가 {hit}회 — 능동형으로 바꾸세요"))
    elif hit >= int(c.get("translationese_near", 2)):
        pats.append(item("translationese", "near", f"{hit}회" + (f" · {top}" if top else ""),
                         "두세 번은 괜찮습니다 — 한 번 더 줄여 보세요"))
    else:
        pats.append(item("translationese", "pass", f"{hit}회", "번역투 거의 없음"))

    hits = [p for p in pats if p["state"] in ("warn", "fail")]
    fails = [p for p in pats if p["state"] == "fail"]
    hold = bool(fails) or len(hits) >= int(c["hold_at"])
    reasons = []
    if fails:
        reasons.append("결말·과반복: " + "·".join(p["label"] for p in fails))
    if len(hits) >= int(c["hold_at"]):
        reasons.append(f"AI 티 {len(hits)}개 적발")
    summary = (f"AI 티 {len(hits)}개 — " + "·".join(p["label"] for p in hits)) if hits else (
        f"AI 티 0개 — 문장 {stats['sentences']}개 · SD {stats['sentence_sd']}" if stats["sentences"] else "AI 티 0개")
    return {"patterns": pats, "hits": [p["id"] for p in hits], "count": len(hits), "hold": hold,
            "hold_reasons": reasons, "stats": stats, "summary": summary, "version": c.get("version", "2026w48")}


def dia_gate(body: str, cfg: dict) -> dict:
    c = dict(AI_TONE_DEFAULTS)
    c.update(cfg or {})
    rx = {**AI_TONE_DEFAULTS["regex"], **((cfg or {}).get("regex") or {})}
    dia = {**AI_TONE_DEFAULTS["dia"], **((cfg or {}).get("dia") or {})}
    elements = dia.get("elements") or AI_TONE_DEFAULTS["dia"]["elements"]
    blocks = prose_blocks(body)
    text = "\n\n".join(blocks)
    head = text[: int(c["first_chars"])]
    tail = "\n".join(blocks[-2:])
    out = []
    for el in elements:
        src = rx.get(el.get("regex", ""), r"$^")
        in_head = _has_re(head, src)
        if el["id"] == "conclusion" and not in_head:
            in_tail = _has_re(tail, src)
            out.append({"id": el["id"], "label": el.get("label", el["id"]),
                        "state": "near" if in_tail else "warn",
                        "value": "본문 끝에만" if in_tail else "없음",
                        "note": "결론이 마지막 문단에만 있습니다 — 첫 400자에 한 줄 요약을 넣으세요" if in_tail else "결론이 없습니다"})
            continue
        out.append({"id": el["id"], "label": el.get("label", el["id"]),
                    "state": "pass" if in_head else "warn",
                    "value": "있음" if in_head else "없음",
                    "note": "첫 400자 안" if in_head else "첫 400자에 없음"})
    hits = sum(1 for e in out if e["state"] != "warn")
    state = "pass" if hits >= 4 else "near" if hits >= 3 else "warn"
    missing = [e["label"] for e in out if e["state"] == "warn"]
    summary = (f"5요소 중 {hits}개 — 첫 400자 의도가 잡힘" if state == "pass"
               else ("빠진 요소: " + "·".join(missing) if missing else f"5요소 중 {hits}개"))
    return {"elements": out, "hits": hits, "total": len(out), "state": state,
            "first_chars": len(head), "summary": summary, "version": c.get("version", "2026w48")}


def keyword_check(body: str, keywords, cfg: dict) -> dict:
    c = dict(AI_TONE_DEFAULTS)
    c.update(cfg or {})
    kws = _kw_list(keywords)
    if not kws:
        return {"items": [], "state": "near", "note": "노리는 검색어를 넣으면 본문 3~5회를 셉니다",
                "version": c.get("version", "2026w48")}
    blocks = prose_blocks(body)
    text = "\n\n".join(blocks)
    heads = " ".join(h["text"] for h in headings_of(blocks))
    lo, hi = c["keyword_count"]
    items = []
    for kw in kws:
        n = _count_text(text, kw)
        in_head = _count_text(heads, kw)
        state = "warn" if n == 0 else "fail" if n >= int(c["keyword_fail"]) else ("near" if n < lo else "pass")
        if n == 0:
            note = "본문에 없음 — 제목·첫 문단·소제목에 넣으세요"
        elif n >= int(c["keyword_fail"]):
            note = f"{n}회 — 과반복(권장 {lo}~{hi}회). 무관 문단의 반복을 지우세요"
        elif n < lo:
            note = f"{n}회 — {lo - n}회 더 넣어도 좋습니다"
        else:
            note = f"{n}회 — 권장 범위"
        items.append({"keyword": kw, "count": n, "headings": in_head, "state": state, "note": note})
    worst = ("fail" if any(i["state"] == "fail" for i in items)
             else "warn" if any(i["state"] == "warn" for i in items)
             else "near" if any(i["state"] == "near" for i in items) else "pass")
    return {"items": items, "state": worst, "note": f"키워드 {len(items)}개 · 권장 {lo}~{hi}회",
            "version": c.get("version", "2026w48")}


def lint_ai_tone(body: str, keywords, cfg: dict, preset: str = "") -> dict:
    tone = ai_tone_scan(body, keywords, preset, cfg)
    dia = dia_gate(body, cfg)
    kw = keyword_check(body, keywords, cfg)
    reasons = list(tone["hold_reasons"])
    if kw["state"] == "fail":
        bad = [f'"{i["keyword"]}" {i["count"]}회' for i in kw["items"] if i["state"] == "fail"]
        reasons.append("키워드 과반복: " + "·".join(bad))
    hold = bool(tone["hold"] or kw["state"] == "fail")
    return {"patterns": tone["patterns"], "hits": tone["hits"], "count": tone["count"],
            "hold": hold, "hold_reasons": reasons, "dia": dia, "keywords": kw,
            "stats": tone["stats"],
            "summary": tone["summary"] + f" · D.I.A.+ {dia['hits']}/{dia['total']}",
            "version": tone["version"]}


def lint(title: str, body: str, photo_count: int | None, keyword_csv: str, rules: dict) -> dict:
    t = dict(DEFAULT_TARGETS)
    t.update(rules["targets"])
    core = rules["coreTags"]
    lexicon = rules["titleLexicon"]
    keywords = [k.strip() for k in (keyword_csv or "").split(",") if k.strip()]
    photos = photos_of(body, photo_count)
    tags = hashtags_of(body, "")

    items = []
    rules_all = list(rules["rules"]) + EXTRA_RULES
    for rule in rules_all:
        state, value, note = judge(rule["id"], title, body, photos, tags, keywords, t, lexicon, core)
        items.append({
            "id": rule["id"],
            "label": rule.get("label") or rule["id"],
            "weight": float(rule.get("weight") or 0),
            "policy": bool(rule.get("policy")),
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
    ai = lint_ai_tone(body, keywords, rules.get("aiTone") or {})
    return {
        "version": rules.get("version"),
        "score": score,
        "pass": all(not (it["state"] == "warn" and (it["weight"] > 0 or it.get("policy"))) for it in items),
        "items": items,
        "stats": stats,
        "aiTone": ai,
        "hold": ai["hold"],
        "hold_reasons": ai["hold_reasons"],
    }


MARK = {"pass": "✓", "near": "△", "warn": "✗", "fail": "⛔"}


def print_report(result: dict) -> None:
    st = result["stats"]
    ai = result.get("aiTone") or {}
    hold = bool(ai.get("hold"))
    print(f"발행 전 린터 · 기준 {result['version']} · 점수 {result['score']} / 100 — "
          + ("통과" if result["pass"] else "고칠 것 있음")
          + (" · ⛔ AI 티 발행 보류" if hold else ""))
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

    if not ai:
        return
    print("-" * 66)
    print(f"AI 티 8패턴 — 적발 {ai.get('count', 0)}개" + (" (발행 보류)" if hold else ""))
    if hold:
        print("⛔ 발행 보류 — " + " · ".join(ai.get("hold_reasons") or []))
    for p in ai.get("patterns") or []:
        print(f"{MARK.get(p['state'], '?')} {p['no']}. {p['label']:<10} {p['value']:<24} {p['note']}")
    dia = ai.get("dia") or {}
    marks = "   ".join(("✓" if e["state"] == "pass" else "△" if e["state"] == "near" else "✗") + e["label"]
                      for e in (dia.get("elements") or []))
    print(f"{MARK.get(dia.get('state'), '?')} 첫 400자 D.I.A.+  {dia.get('hits', 0)}/{dia.get('total', 5)}   {marks}")
    for k in (ai.get("keywords") or {}).get("items") or []:
        print(f"{MARK.get(k['state'], '?')} 🔎 {k['keyword']:<10} {str(k['count']) + '회':<6} {k['note']}")


def main() -> int:
    ap = argparse.ArgumentParser(description="대전청년 블로그 발행 전 린터 (8항목 + AI 티 8패턴·D.I.A.+)")
    ap.add_argument("draft", help="초안 md 경로 ('-' 이면 표준입력)")
    ap.add_argument("--photo", type=int, default=None, help="촬영 사진 수(안 주면 본문의 ![]() 개수)")
    ap.add_argument("--keyword", default="", help="노리는 검색어, 쉼표 구분")
    ap.add_argument("--strict", action="store_true", help="AI 티 '발행 보류'도 실패(1)로 세기")
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
    if args.strict and result.get("hold"):
        return 1
    return 0 if result["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
