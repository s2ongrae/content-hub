# 숏폼 한 번에 돌리기 (토큰 아끼는 순서)

클로드가 매번 규칙을 다시 읽지 않도록, 아래 순서와 명령만 쓰면 된다.

```bash
# 1) 첫 문장 5개 채점 (파일로 넘기면 왕복이 없다)
python3 tools/yt/hookscore_ko.py hooks.txt

# 2) 제목·썸네일 한 쌍
python3 tools/yt/title_ko.py --title "…" --thumb "…"

# 3) 촬영본 자막이 있으면 컷 리스트
python3 tools/yt/edl_ko.py take01.srt --floor 0.5

# 4) 주간 성과에서 터진 편 찾기
python3 tools/yt/swipe_ko.py collected.tsv --min 2.0
```

- 대본은 `seeds/skills/shorts_preset.json`의 비트를 그대로 쓴다(새로 설계하지 않는다).
- 말투는 `seeds/skills/voice_kimseongrae.md`만 본다. 다른 문체 규칙을 덧붙이지 않는다.
- 웹앱에서 하려면 `#/series` → **🎬 숏폼 공방**. 같은 계산, 같은 데이터.
