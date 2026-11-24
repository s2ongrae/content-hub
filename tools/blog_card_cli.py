#!/usr/bin/env python3
"""
tools/blog_card_cli.py — 초안 하나로 '린트 + 허브 카드 반영'을 한 번에 (2026-11-24)

왜 있나
  지금까지는 초안을 쓰고 → 따로 린트를 돌리고 → 따로 카드에 본문을 넣고 → 점수를 손으로 적었다.
  그래서 "허브에 안 들어간 글"(피클 체험기, 2026-11-23)이나 "옛 규칙 점수가 남은 카드"가 생겼다.
  이 명령 하나로 ①린트 ②카드 생성/갱신 ③blog.lint·quality_score 기록을 같이 한다.

사용
  # 이미 있는 카드에 초안을 반영 (본문·제목·해시태그·린트·점수)
  python3 tools/blog_card_cli.py draft.md --card DY-20261121-001 --photo 7 --env hub.env

  # 새 카드로 만들면서 바로 반영
  python3 tools/blog_card_cli.py draft.md --new --place "진미오겹살 본점" \
      --category "숯불구이 · 오겹살" --cluster "대전 맛집 · 괴정동 오겹살" \
      --keywords "대전 괴정동 맛집, 진미오겹살" --photo 7 --env hub.env

  # 서버에 쓰지 않고 린트만 (기본이 이쪽이다 — 쓰려면 --apply)
  python3 tools/blog_card_cli.py draft.md --card DY-20261121-001 --photo 7

  ※ 맛집(장소) 글이 아니면 핵심 태그(대전맛집·유성맛집·봉명동맛집)를 강제하지 않는다.

환경
  --env 파일에 URL=... / TOKEN=... (work/circus3/hub.env 와 같은 형식) 또는 HUB_URL·HUB_TOKEN 환경변수.

종료 코드
  0 = 린트 통과 + (쓰기를 했으면) 카드 반영 완료
  1 = 린트에 고칠 것 있음(카드는 --apply 면 반영됨)
  2 = 파일·설정·서버 오류
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from blog_lint_cli import lint, load_rules, split_draft  # 같은 규칙·같은 판정


# ────────────────────────── 허브(GAS) 호출 ──────────────────────────

def _env(path: str | None) -> tuple[str, str]:
    url = os.environ.get("HUB_URL", "")
    token = os.environ.get("HUB_TOKEN", "")
    if path:
        for line in Path(path).read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            if k.strip() == "URL":
                url = url or v.strip()
            elif k.strip() == "TOKEN":
                token = token or v.strip()
    if not url or not token:
        raise SystemExit("[err] 허브 주소·토큰이 없습니다 — --env 파일(URL=,TOKEN=) 또는 HUB_URL/HUB_TOKEN")
    return url, token


def hub_call(url: str, token: str, action: str, payload: dict | None = None, timeout: int = 180) -> dict:
    body = json.dumps({
        "action": action, "auth_token": token, "client_id": "blog-card-cli",
        "idempotency_key": "bc-%s-%d-%s" % (action, int(time.time() * 1000), os.urandom(3).hex()),
        "payload": payload or {},
    }, separators=(",", ":")).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "text/plain;charset=utf-8"})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        txt = res.read().decode()
    try:
        return json.loads(txt)
    except json.JSONDecodeError:
        return {"ok": False, "raw": txt[:400]}


# ────────────────────────── 본문 정리 ──────────────────────────

def hashtags_of(body: str) -> list[str]:
    out: list[str] = []
    for tok in str(body or "").split():
        if tok.startswith("#") and len(tok) > 1:
            tag = tok.lstrip("#").strip()
            if tag and tag not in out:
                out.append(tag)
    return out


def snapshot(result: dict, photo: int | None) -> dict:
    """카드 payload.blog.lint 에 남길 요약 — 화면(#/lint)과 같은 값."""
    st = result["stats"]
    ai = result.get("aiTone") or {}
    dia = ai.get("dia") or {}
    warn = [i for i in result["items"] if i["state"] == "warn"]
    verdict = "점수 %d / 100 — " % result["score"] + (
        "통과" if result["pass"] else "고칠 것 %d건: %s" % (len(warn), " · ".join(i["label"] for i in warn)))
    return {
        "tool": "content-hub tools/blog_card_cli.py → tools/blog_lint_cli.py (rules 2026w48)",
        "rules_version": result.get("version"),
        "checked_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "score": result["score"],
        "pass": result["pass"],
        "hold": bool(result.get("hold")),
        "hold_reasons": result.get("hold_reasons") or [],
        "summary": "제목 %d자 · 본문 %s자 · 사진 %d장 · 문단 평균 %s자 · 16자 이하 줄 %d개 · 해시태그 %d개" % (
            st["title_chars"], f"{st['body_chars']:,}", st["photos"], st["avg_line"], st["short_lines"], st["hashtags"]),
        "ai_tone": {"summary": ai.get("summary", ""), "count": ai.get("count", 0),
                    "hold": bool(ai.get("hold")), "dia": "%s/%s" % (dia.get("hits", 0), dia.get("total", 5))},
        "verdict": verdict,
        "items": [{"id": i["id"], "label": i["label"], "state": i["state"], "value": i["value"], "note": i["note"]}
                  for i in result["items"]],
    }


def print_summary(result: dict, snap: dict) -> None:
    print("발행 전 점검 · 점수 %d / 100 — %s" % (result["score"], "통과" if result["pass"] else "고칠 것 있음"))
    print("  " + snap["summary"])
    for it in result["items"]:
        if it["state"] == "warn":
            print("  ✗ %-10s %s — %s" % (it["label"], it["value"], it["fix"] or it["note"]))
    near = [it for it in result["items"] if it["state"] == "near"]
    if near:
        print("  △ 안내 %d건: %s" % (len(near), " · ".join(i["label"] for i in near)))
    if result.get("hold"):
        print("  ⛔ 발행 보류: " + " · ".join(result.get("hold_reasons") or []))


# ────────────────────────── main ──────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(description="초안 → 린트 + 허브 카드 반영 (한 번에)")
    ap.add_argument("draft", help="초안 md 경로 ('-' 이면 표준입력)")
    ap.add_argument("--card", default="", help="이미 있는 카드 id (예: DY-20261121-001)")
    ap.add_argument("--new", action="store_true", help="새 카드로 만든다")
    ap.add_argument("--brand", default="daejeon_youth", help="브랜드(기본 daejeon_youth)")
    ap.add_argument("--place", default="", help="place_name (새 카드면 필수)")
    ap.add_argument("--category", default="", help="카테고리")
    ap.add_argument("--cluster", default="", help="cluster_id")
    ap.add_argument("--region", default="", help="region_dong")
    ap.add_argument("--keywords", default="", help="노리는 검색어(쉼표) — 비우면 카드 값을 그대로 둔다")
    ap.add_argument("--photo", type=int, default=None, help="사진 수(없으면 본문의 ![]() 개수)")
    ap.add_argument("--env", default="", help="hub.env 경로(URL=,TOKEN=)")
    ap.add_argument("--apply", action="store_true", help="실제로 서버에 쓴다(없으면 린트만)")
    ap.add_argument("--json", action="store_true", help="결과를 JSON 으로")
    args = ap.parse_args()

    try:
        text = sys.stdin.read() if args.draft == "-" else Path(args.draft).read_text(encoding="utf-8")
    except OSError as exc:
        print("[err] 초안을 읽지 못했습니다: %s" % exc, file=sys.stderr)
        return 2

    title, body = split_draft(text)
    result = lint(title, body, args.photo, args.keywords or "", load_rules())
    snap = snapshot(result, args.photo)
    tags = hashtags_of(body)

    if not args.json:
        print_summary(result, snap)
        print("  해시태그 %d개: %s" % (len(tags), " ".join("#" + t for t in tags[:14])))

    if not args.apply:
        if args.json:
            print(json.dumps({"lint": result, "snapshot": snap, "hashtags": tags}, ensure_ascii=False, indent=1))
        print("\n(린트만 했습니다 — 카드에 쓰려면 --apply)")
        return 0 if result["pass"] else 1

    try:
        url, token = _env(args.env or None)
    except SystemExit as exc:
        print(str(exc), file=sys.stderr)
        return 2

    if not args.card and not args.new:
        print("[err] --card 또는 --new 중 하나가 필요합니다", file=sys.stderr)
        return 2
    if args.new and not args.place:
        print("[err] 새 카드는 --place 가 필요합니다", file=sys.stderr)
        return 2

    content_id = args.card
    if args.new:
        created = hub_call(url, token, "create_content", {
            "brand": args.brand, "place_name": args.place, "category": args.category,
            "cluster_id": args.cluster, "region_dong": args.region,
            "target_keywords": args.keywords,
        })
        if not created.get("ok"):
            print("[err] 카드 생성 실패: %s" % json.dumps(created.get("error") or created, ensure_ascii=False)[:300], file=sys.stderr)
            return 2
        content_id = created["data"]["content_id"]
        print("카드 생성: " + content_id)

    detail = hub_call(url, token, "get_content_detail", {"content_id": content_id})
    if not detail.get("ok"):
        print("[err] 카드를 읽지 못했습니다: %s" % json.dumps(detail.get("error") or detail, ensure_ascii=False)[:300], file=sys.stderr)
        return 2
    d = detail["data"]
    blog = dict((d.get("payload") or {}).get("blog") or {})
    blog.update({
        "title": title,
        "body": body,
        "hashtags": tags,
        "lint": snap,
        "lint_checked_at": snap["checked_at"],
    })
    patch_payload = {
        "content_id": content_id,
        "expected_version": d.get("version"),
        "blog_title": title,
        "quality_score": result["score"],
        "patch": {"blog": blog},
    }
    if args.keywords:
        patch_payload["target_keywords"] = args.keywords
    saved = hub_call(url, token, "update_content", patch_payload)
    if not saved.get("ok"):
        err = saved.get("error") or {}
        print("[err] 카드 반영 실패(%s): %s" % (err.get("code", ""), err.get("message", "")), file=sys.stderr)
        return 2
    print("카드 반영: %s v%s · 점수 %d · 본문 %d자" % (
        content_id, (saved.get("data") or {}).get("version"), result["score"], len(body)))
    return 0 if result["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
