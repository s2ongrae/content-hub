#!/usr/bin/env bash
# content-hub 스킬을 ~/.claude/skills/ 로 복사한다. (노트북·회사 PC 어디서든 1줄)
#   bash tools/yt/install_skills.sh
# 이미 있는 스킬은 덮어쓰기 전에 .bak-YYYYmmddHHMM 으로 남긴다.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEST="${HOME}/.claude/skills"
STAMP="$(date +%Y%m%d%H%M)"
mkdir -p "$DEST"

copy_dir() {
  local name="$1" from="$2" to="$3"
  if [ -d "$to" ]; then cp -r "$to" "${to}.bak-${STAMP}"; rm -rf "$to"; fi
  cp -r "$from" "$to"
  echo "  ✓ ${name}"
}

echo "content-hub 스킬 설치 → $DEST"
for d in "$SRC"/.claude/skills/yt-*; do
  [ -d "$d" ] || continue
  name="$(basename "$d")"
  copy_dir "$name" "$d" "$DEST/$name"
  # 설치본에서는 도구 경로를 절대경로로 바꿔 둔다(다른 폴더에서 실행해도 찾도록)
  if [ -f "$DEST/$name/SKILL.md" ]; then
    sed -i.bak "s#tools/yt/#${DEST}/yt-tools/#g" "$DEST/$name/SKILL.md" && rm -f "$DEST/$name/SKILL.md.bak"
  fi
done

TOOLS="$DEST/yt-tools"
if [ -d "$TOOLS" ]; then rm -rf "${TOOLS}.bak-${STAMP}"; mv "$TOOLS" "${TOOLS}.bak-${STAMP}"; fi
mkdir -p "$TOOLS/data"
cp "$SRC"/tools/yt/*.py "$TOOLS"/
cp "$SRC"/seeds/skills/*.json "$SRC"/seeds/skills/*.md "$TOOLS/data"/
echo "  ✓ yt-tools (파이썬 4개 + 규칙 데이터)"

echo
echo "확인:"
echo "  python3 ${TOOLS}/hookscore_ko.py --hook \"봉명동 1인 14,000원 냉삼, 웨이팅 16팀 뚫은 이유\""
