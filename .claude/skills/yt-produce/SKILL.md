---
name: yt-produce
description: 촬영 원본을 클린 마스터(`{content_id}_clean.mp4`)와 SRT 로 만든다 — 컷·9:16·음량 맞추기·검수를 ffmpeg 로, 말소리→SRT 를 Whisper 로. 자막 번인·TTS 는 표준상 예외 경로. "영상 편집", "자막 파일 만들어줘", "세로로 바꿔", "음량 맞춰", "렌더", "클린 마스터" 에 쓴다. 기획·대본은 yt-script, 컷 목록 계산은 yt-edit, 훅 채점은 yt-hook.
---

# yt-produce — 클린 마스터 + SRT 제작 (docs/CONTENT_STANDARD_v3 준수)

**먼저 `docs/CONTENT_STANDARD_v3.md` 의 선을 지킨다.** AI(이 스킬)는 *컷편집 · 음량 평탄화 · `.srt` 생성 · 검수*까지.
**자막 번인 · TTS 내레이션 · 효과음 · 로고 · 커버 선택은 하지 않는다**(사람이 캡컷에서 — 수정 가능성 때문). 번인·TTS 가 필요하면 §6 예외 경로로, 사용자가 명시했을 때만.
숫자가 어긋나면 `docs/CONTENT_STANDARD_v2.md`·`seeds/render_standard_v2.json` 이 우선.

출처: affaan-m/ECC `video-editing`(작업 층 구분) · remotion-dev/skills(자막 데이터 개념) · Whisper-TikTok(Apache-2.0, 구조만 참고). 코드를 가져다 붙이지 않았다.
**검증 상태(2026-11-19, 회사 PC, ffmpeg 9.0.2 + faster-whisper 1.x + Python 3.12)**: §2 클린 마스터 인코딩·음량 측정은 4.3초 샘플로 실제 실행해 통과. §3 Whisper 는 실행은 됐으나 §3 의 주의 때문에 품질은 **아직 재지 못했다**. §6 번인·TTS 와 §7 검수는 실행하지 않았다.

## 0. 층 (순서 고정)

기획(yt-hook→yt-script) → 컷 목록(yt-edit) → **클린 마스터(§2)** → **SRT(§3)** → 검수(§5) → *사람: 캡컷 7단계* → 발행(ecc-short-video-distribution).
이 스킬은 **업로드하지 않는다.** 결과 파일 경로와 확인 항목만 알린다.

## 1. 사전 확인

- **ffmpeg 8.0.3 이상**(7.x 는 알려진 취약점 CVE-2026-8461). 이 PC: `winget install --id Gyan.FFmpeg -e` 로 9.0.2.
- 새로 설치한 직후엔 터미널을 다시 열거나 PATH 를 새로 읽는다.
- **Whisper 는 Python 3.12 로**: 이 PC 기본 Python 3.15 에서는 `faster-whisper` 의존성(`av`)이 빌드되지 않는다 → `py -3.12 -m pip install faster-whisper`.
- 먼저 `ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate,duration -of default=nw=1 in.mp4` 로 입력을 읽는다(폰 영상은 HEVC·가변 프레임이 흔하다).

## 2. 클린 마스터 (표1 수치 그대로)

| 항목 | 값 |
|---|---|
| 해상도 | 1080×1920, 레터박스 금지 |
| 프레임 | 30fps CFR |
| 비디오 | H.264 High · CRF 18 · yuv420p · `+faststart` |
| 오디오 | AAC 256k · 48kHz · 스테레오 |
| 음량 | BGM·효과음을 얹을 때 **-16.0±0.5 LUFS, TP ≤ -2.0** / 자막만 얹을 때 **-14.0±0.5 LUFS, TP ≤ -1.8** |
| 길이 | 3.0~90.0초 |
| 금지 | 번인 자막·AI TTS·효과음·로고 |

**2-1. 음량은 2패스로**(1패스 `loudnorm` 은 목표에서 어긋난다). 한 번 재고, 재 값을 넣어 다시 돌린다:
```powershell
ffmpeg -hide_banner -i in.mp4 -af loudnorm=I=-14:TP=-2.0:LRA=11:print_format=json -f null - 2>&1   # input_i / input_tp / input_lra / input_thresh / target_offset 읽기
ffmpeg -y -i in.mp4 -vf "fps=30,scale=1080:1920,format=yuv420p" `
  -af "loudnorm=I=-14:TP=-2.0:LRA=11:measured_I=<input_i>:measured_TP=<input_tp>:measured_LRA=<input_lra>:measured_thresh=<input_thresh>:offset=<target_offset>:linear=true" `
  -c:v libx264 -profile:v high -crf 18 -preset medium -c:a aac -b:a 256k -ar 48000 -ac 2 -movflags +faststart clean.mp4
```
- **TP 목표를 -2.0 으로 잡는다.** 실측: 목표를 -1.8 로 주니 결과 true peak 가 -1.73 으로 한도를 살짝 넘었다. BGM 용(-16)이면 `I=-16:TP=-2.5` 처럼 여유를 둔다.
- 결과를 같은 방식으로 **다시 재서** `input_i` 가 목표±0.5, `input_tp` 가 한도 이하인지 확인한다(4.3초 샘플에서 -13.98 LUFS 로 통과).
- 원본이 몹시 조용하면(예: -42 LUFS) 증폭이 크다 — 잡음도 같이 커지니 사람이 한 번 듣는다.

**2-2. 가로 원본 → 9:16**
```powershell
# 가운데 크롭
ffmpeg -i in.mp4 -vf "crop=ih*9/16:ih,scale=1080:1920" ...
# 피사체가 한쪽이면 x 지정: crop=ih*9/16:ih:x=(iw-ow)*0.3:y=0
```
크롭은 가로 폭의 약 70%를 버린다. 간판 전경·인물 전신처럼 버리면 안 되는 장면은 사람이 구도를 정한다(레터박스·블러 배경은 표1 금지).

**허브 경로(2026-11-20)**: 이 §2 의 컷·9:16·음량은 허브 제작 탭이 오더(`content_render` + `cuts`)로 노트북에 시킨다 — 영상 올리기는 허브 ①, 컷 목록은 ③, 실행은 ④(`hub-agent/notebook-agent/lib/render.js`, `cut.py --remove --smart` → `fit`/`join` → `loudness` → `check`). 손으로 돌릴 때는 아래 명령을 쓴다.

**2-3. 컷**: 정확한 컷은 재인코딩(`-ss … -to … -i` 뒤 libx264). `-c copy` 는 키프레임으로 밀려 어긋난다. 이어붙이기는 `concat` 목록. 무음 구간은 `-af silencedetect=n=-35dB:d=0.4` 로 찾고, 무엇을 자를지는 yt-edit 목록을 따른다.

## 3. SRT (표2 규격)

| 항목 | 값 |
|---|---|
| 형식 | UTF-8(BOM 없음) · LF |
| cue 길이 | 1.0~3.5초 |
| cue 간격 | ≥ 0.06초 |
| 줄당 글자 | 대전 청년 12자 / 메리 11자(공백 포함), 최대 2줄 |
| 문장부호 | 문장 끝 마침표만 제거 |
| 금지 | ASS 태그·화자 표기·`\k` 카라오케 |

**말소리 → 글자**
```powershell
ffmpeg -y -i clean.mp4 -vn -ac 1 -ar 16000 audio.wav
py -3.12 -c "<아래 스크립트>"
```
```python
import wave, numpy as np
from faster_whisper import WhisperModel
w = wave.open("audio.wav"); a = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32)/32768.0
m = WhisperModel("small", compute_type="int8")       # 정확도가 필요하면 large-v3(약 3GB 내려받기)
seg, _ = m.transcribe(a, language="ko", word_timestamps=True, vad_filter=True)
for s in seg: print(f"{s.start:.2f}-{s.end:.2f} | {s.text.strip()}")
```
- **오디오는 numpy 배열로 넘긴다.** 파일 경로로 넘기면 이 환경에서 `av` 오류가 났다(`metadata_errors`).
- **언어는 `ko` 고정, `vad_filter=True` 유지.** 거의 무음이거나 잡음뿐인 구간에서 Whisper 는 **"구독과 좋아요 부탁드려요" 같은 문구를 지어낸다**(유명한 환각). 샘플에서 VAD 를 끄고 증폭한 오디오를 돌렸더니 정확히 이 문장이 나왔고, 원본에 실제로 그 말이 있는지는 확인하지 못했다. **VAD 가 아무것도 못 찾았으면 '말 없음'으로 두고, 사람이 들어 확인하기 전에는 그 결과를 자막으로 쓰지 않는다.**
- 상호·메뉴·가격·숫자는 전사가 그럴듯하게 틀리는 대표 구간 → **사람이 대조**. 확인 못 한 숫자는 `[채우기]`.
- 큐 분할(12자·2줄·1.0~3.5초)은 단어 타임스탬프로 의미 단위에서 끊고, 규격을 어기는 큐를 목록으로 보고한다(자르기만 하고 말 바꾸지 않는다).
- 자막을 AI 가 만들었으면 표4: 클립 마지막 2초 우측 `AI 자막 보조` + 업로드 본문 "자막: AI 보조". 이 안내는 사람이 캡컷에서 넣는다.

## 4. 이 채널 자막 내용 규칙
- 첫 2초 자막 12자 이내, 커버 문구와 같은 숫자.
- 없는 가격·시간·웨이팅을 만들지 않는다. 실측값만.

## 5. 검수(렌더 뒤 반드시)
`ffprobe` 로 해상도·fps·코덱·샘플레이트·채널, `loudnorm` 재측정으로 LUFS·TP, 길이 3~90초, SRT 규격 위반 목록. 하나라도 어긋나면 "됐다"고 하지 않고 어긋난 항목을 보고한다. 프레임 몇 장을 뽑아(`ffmpeg -ss … -frames:v 1`) 눈으로 확인하는 것까지가 끝이다 *(이 단계는 이번에 실행하지 않았다)*.

## 6. 예외 경로 — 사용자가 명시했을 때만 *(미실행)*
- **번인**: 검수용·단발 요청에만. `ffmpeg -vf "subtitles=sub.srt:force_style='…'"`, 윈도우는 경로의 `C:` 를 `C\:` 로 이스케이프하거나 같은 폴더에서 상대경로. 발행 기본값으로 굽지 않는다. 폰트는 설치된 것만 적용된다.
- **TTS**: 표1 은 AI TTS 0초. 쓰더라도 네이버 클립 챌린지의 AI 비율 가드(전체·대부분 AI 면 심사·혜택 제외)와 'AI 활용' 표시를 먼저 확인한다. edge-tts 는 무료지만 비공식 경로라 약관·차단 위험이 있다.

## 7. 게이트
- 업로드·발행 금지. 광고·협찬·AI 활용 표시를 끄지 않는다.
- 남의 영상·음원 재사용, 태그만 바꾼 재업로드 금지.
- 확인하지 못한 것은 보고에 그대로 적는다.
