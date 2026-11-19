# `.claude/skills/ecc-*` — ECC에서 골라 온 스킬 (2026-11-19)

원본: `affaan-m/ECC` **v2.2.3** — `skills/` 327종 · `rules/` 122파일 · `agents/` 72종 · `commands/` 98종 (커밋 `3f14a10`).
기존 `yt-*` 12종·`daejeon-content`와 **겹치지 않는 것만** 골라 `.claude/skills/ecc-<원본이름>/`로 넣었다.
본문은 영어 원문 그대로, 앞머리에 이 레포 기준 한국어 메모. **규칙이 부딪히면 `CLAUDE.md` §2(2트랙)·§3(READY 게이트)가 우선이다.**

| 스킬 | 원본 | 이 레포에서 쓰는 자리 | 주의 |
|---|---|---|---|
| `ecc-seo` | `seo` | 네이버 블로그 글·공개 페이지의 검색 노출 점검(1페이지 1의도·제목·내부링크) | 네이버 C-Rank/DIA는 범위 밖. 앱(`index.html`)은 색인 대상 아님 |
| `ecc-article-writing` | `article-writing` | 블로그 장문 초안 — 근거 먼저, AI 상투어 제거 | 초안·임시저장까지. 발행은 사용자 |
| `ecc-brand-voice` | `brand-voice` | 실제 발행 글에서 트랙별 VOICE PROFILE 뽑기 | 대전 청년/삐약 김메리 따로. 프로필은 repo에 커밋하지 않음 |
| `ecc-short-video-distribution` | `short-video-distribution` | 쇼츠·릴스·클립 발행 직전 — 플랫폼별 캡션·공개범위·광고표시·승인 | 네이버 클립은 수동 시트. 발행 순서는 `CLAUDE.md` §2 |

## 갱신·제거

- **갱신**: 원본 `skills/<이름>/SKILL.md`와 각 폴더 원문 본문(구분선 아래)을 비교해 바꾼다. 원본 SHA가 달라지면 `upstream_commit`도 같이.
- **제거**: `ecc-*` 폴더 삭제로 끝. `node test/run.js`는 이 폴더를 읽지 않는다(`tools/yt/install_skills.sh`는 `yt-*`만 복사).
