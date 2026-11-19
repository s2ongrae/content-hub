#!/usr/bin/env bash
# 영상 제작 스킬(외부 오픈소스)을 ~/.claude/skills/ 에 설치한다. 노트북·회사 PC 어디서든 1회.
#   bash tools/video/install_video_skills.sh
#
# 왜 저장소에 코드를 넣지 않고 스크립트로 두나: ffmpeg-skill(약 3MB)·remotion 스킬(수백 파일)은 남의 코드다.
# 공개 레포에 복사해 두지 않고, **버전을 고정해서** 이 스크립트가 같은 것을 내려받게 한다.
# 이미 있는 스킬은 덮어쓰기 전에 ~/.claude/skills-backup-<시각>/ 으로 옮긴다(스킬 폴더 밖이라 목록에 중복으로 안 잡힌다).
#
# 검증 이력(2026-11-19, 회사 PC): 설치 전 npm 패키지·저장소 스크립트에서 설치 훅·네트워크 호출 없음 확인.
set -euo pipefail

FFMPEG_SKILL_VERSION="3.14.1"          # kajisho5/ffmpeg-skill (MIT)
REMOTION_SKILLS_COMMIT="6f55706"       # remotion-dev/skills — 고정한 커밋
REMOTION_PICK="remotion-best-practices remotion-captions remotion-markup remotion-render remotion-license remotion-create"

DEST="${HOME}/.claude/skills"
BACKUP="${HOME}/.claude/skills-backup-$(date +%Y%m%d%H%M)"
mkdir -p "$DEST"

backup() { [ -d "$DEST/$1" ] && { mkdir -p "$BACKUP"; mv "$DEST/$1" "$BACKUP/$1"; echo "  (기존 $1 → $BACKUP)"; } || true; }

echo "[0] 사전 확인"
command -v node >/dev/null   || { echo "node 가 없습니다(winget install OpenJS.NodeJS.LTS)"; exit 1; }
command -v ffmpeg >/dev/null || { echo "ffmpeg 가 없습니다(winget install --id Gyan.FFmpeg -e) — 8.0.3 이상"; exit 1; }
ffmpeg -version | head -1

echo "[1] ffmpeg-skill ${FFMPEG_SKILL_VERSION}"
backup ffmpeg-skill
npx --yes "ffmpeg-skill@${FFMPEG_SKILL_VERSION}"

echo "[2] remotion-dev/skills @ ${REMOTION_SKILLS_COMMIT}"
TMP="$(mktemp -d)"
git clone --quiet https://github.com/remotion-dev/skills.git "$TMP/rs"
git -C "$TMP/rs" checkout --quiet "$REMOTION_SKILLS_COMMIT"
for s in $REMOTION_PICK; do
  backup "$s"
  cp -r "$TMP/rs/skills/$s" "$DEST/$s"
  echo "  ✓ $s"
done
rm -rf "$TMP"

echo "[3] 스모크: ffmpeg-skill doctor"
python "$DEST/ffmpeg-skill/scripts/_contract.py" doctor 2>&1 | grep -E "^ok:|missing required" || python3 "$DEST/ffmpeg-skill/scripts/_contract.py" doctor | grep -E "^ok:|missing required"

echo
echo "끝. 새 세션부터 스킬 목록에 잡힙니다. Remotion 으로 실제 렌더하려면 영상 프로젝트 폴더에서 별도로 'npm i' 가 필요합니다."
