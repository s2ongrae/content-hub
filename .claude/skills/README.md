# content-hub `.claude/skills/` — 유튜브·숏폼 스킬 (한국어판)

무료 MIT 저장소 `Jakeschincariol/youtube-agent-skill`의 11개 스킬과 게으른빌더 `social-media-skills`의
`voice-builder` 개념을 이 채널에 맞게 옮긴 것이다. **원본은 영어 채널 기준**이라 그대로 쓰면
한국어에서 점수가 이상하게 나온다. 여기서는 어절·폭·한국어 어휘로 다시 보정했다.

| 스킬 | 하는 일 | 도구 |
|---|---|---|
| `yt-hook` | 첫 문장 21공식 분류 + 5속성 채점 | `tools/yt/hookscore_ko.py` |
| `yt-script` | 당근 스타일 프리셋으로 대본 뼈대(타임코드·ON SCREEN·자막) | `seeds/skills/shorts_preset.json` |
| `yt-package` | 제목+썸네일 한 쌍 린터 | `tools/yt/title_ko.py` |
| `yt-edit` | SRT → 컷편집 리스트(DEAD·FILLER·REPEAT) | `tools/yt/edl_ko.py` |
| `yt-comment` | 댓글 4분류 + 답장 초안 + 고정 1개 | `seeds/skills/comment_triage.json` |
| `yt-viral` | 채널 중위수 대비 아웃라이어 | `tools/yt/swipe_ko.py` |
| `yt-shorts` | 긴 영상에서 숏폼 후보 + 새 첫 문장 | `yt-hook` |
| `yt-plan` | 주간 편성(앵커1·저비용1·숏폼3) | `content-hub #/series` |
| `yt-seo` | 설명·태그·검색어 3개 | — |
| `yt-audit` | 채널 진단 → 고칠 것 1개 | 위 도구 전부 |
| `yt-chapters` | 롱폼 챕터(유튜브 규칙 검증) | — |
| `yt-retention` | 지속률 내보내기 읽기 | — |

데이터(규칙)는 전부 `seeds/skills/`에 있고, 웹앱(`js/yt/*.js`)과 파이썬 도구(`tools/yt/*.py`)가
**같은 파일을 읽는다**. 규칙을 고치면 양쪽이 같이 바뀐다. 화면에서는 `#/series` → **🎬 숏폼 공방**.

## 노트북·클로드 코드에 붙이기 (1줄)

```bash
bash tools/yt/install_skills.sh          # content-hub 저장소 안에서 실행
```

스크립트는 이 폴더의 `yt-*`를 `~/.claude/skills/`로 복사한다(이미 있으면 덮어쓰기 전에 `.bak`).
복사 없이 쓰려면 저장소 안에서 그냥 클로드 코드를 열어도 된다 — 프로젝트 로컬 스킬로 잡힌다.

## 게이트 (원본과 동일)

- **아무것도 발행하지 않는다.** 스킬은 쓰고, 사람이 올린다.
- 숫자를 만들지 않는다. 확인 못 한 값은 `[채우기]`로 남긴다.
- 점수는 예측이 아니다. 낮으면 다시 보고, 높다고 터진다고 말하지 않는다.
