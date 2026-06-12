# MediNote(내 약 노트) 기술 구성 문서

복약 관리 PWA "내 약 노트"의 기술 구성을 정리한 문서입니다.

---

## 1. 개요

- **목적**: 약·영양제 기록, 리마인더, LINE / 브라우저 알림, AI 약 사진 인식, Google 드라이브 동기화를 제공하는 개인용 앱.
- **형태**: 설치 가능한 PWA(Progressive Web App). 프런트엔드는 단일 `index.html`(바닐라 JS).
- **지원 언어**: 일본어 / 한국어(화면 우측 상단의 국기로 전환. 설정은 `localStorage`에 저장).

---

## 2. 전체 아키텍처

```
┌──────────────────────────┐
│  브라우저 / iOS 홈 화면 PWA           │
│  index.html (바닐라 JS) + sw.js        │
│  - localStorage(기기 로컬 저장)          │
│  - Service Worker(오프라인/알림)         │
└───────┬───────────────┬──────────────┘
        │               │
        │ HTTPS         │ HTTPS(CORS)
        ▼               ▼
┌───────────────┐   ┌────────────────────────────┐
│ Firebase       │   │ Vercel 서버리스 함수 /api/*       │
│ Hosting        │   │  - /api/analyze(Claude Vision) │
│ (정적 배포)      │   │  - /api/schedule(KV 저장)        │
│ watashi-no-    │   │  - /api/cron(LINE push)         │
│ kusuri         │   │  - /api/line/*(LINE 로그인)       │
└───────────────┘   └──────┬──────────┬────────────┘
                            │          │
                  ┌─────────▼──┐   ┌───▼─────────────┐
                  │ Vercel KV   │   │ 외부 API          │
                  │ (Upstash    │   │ - LINE Messaging │
                  │  Redis)     │   │ - LINE Login     │
                  └─────────────┘   │ - Anthropic API  │
                                    └──────────────────┘
   ┌──────────────┐        ┌──────────────────┐
   │ cron-job.org  │ 30분마다│ Google Drive/Sheets│ ← 기기에서 직접 동기화
   │ → /api/cron   │───────▶│ (MediNote_Data)    │
   └──────────────┘        └──────────────────┘
```

- **프런트엔드 배포**: Firebase Hosting(프로젝트/사이트명 `watashi-no-kusuri`, `https://watashi-no-kusuri.web.app`).
- **백엔드 API**: Vercel 서버리스 함수(`https://project-53ect.vercel.app/api/*`). 프런트는 상수 `VERCEL_BASE`를 통해 호출(크로스 오리진, API 측에서 CORS 허용).

---

## 3. 프런트엔드

| 항목 | 내용 |
|------|------|
| 구성 | 단일 파일 `index.html`(HTML + CSS + 바닐라 JavaScript). 프레임워크 미사용. |
| 로컬 저장 | `localStorage`. `medinote_v1`(약·기록·리마인더·설정), `medinote_cfg_v1`(LINE 연동·언어 등), `medinote_gtoken_v1`(Google 토큰). |
| PWA | `manifest.json` + `sw.js`(Service Worker). `sw.js`는 **네트워크 우선·실패 시 캐시** 전략으로 오프라인 대응. 알림 클릭 처리, Web Push 수신, Notification Triggers(정시 알림) 지원. |
| 다국어 | `I18N` 사전(`ja` / `ko` 각 약 150키) + `t(key, ...args)`. 정적 HTML은 `data-i18n` / `data-i18n-html` / `data-i18n-ph` 속성, 동적 문자열은 `t()`로 전환. 언어는 `cfg.lang`에 저장. |
| 화면 구성 | 오늘(복약 체크) / 약(관리) / 리마인더 / 병원용 요약 / 계정·설정. |

### 상태 모델(`state`)

```js
state = {
  meds: [],      // {id, name, kind:'med'|'supple', dose, meal, timings:[], note}
  logs: {},      // {'YYYY-MM-DD': {morning:[medId..], noon:[], evening:[], bed:[]}}
  reminders: [], // {id, time:'HH:MM', slot, methods:[]}
  settings: { notif, snooze, snoozeMin },
  line: { userId, name }  // LINE 연동 정보(클라우드 동기화 대상)
}
```

---

## 4. 백엔드(Vercel 서버리스 함수 `/api`)

| 엔드포인트 | 메서드 | 역할 |
|------------|--------|------|
| `/api/analyze` | POST | 이미지(base64) + 프롬프트 + JSON 스키마를 받아 **Anthropic Claude Vision**을 호출해 약 정보를 추출. API 키는 서버 측 `ANTHROPIC_API_KEY`에 은닉. 모델 `claude-opus-4-8`. |
| `/api/schedule` | POST | 리마인더 스케줄을 Vercel KV에 저장. `{userId, reminders, tzOffset, authoritative}`. `authoritative=false`(자동 전송)로 빈 배열이 와도 기존을 지우지 않는 안전장치 포함. |
| `/api/cron` | GET | cron-job.org가 30분마다 호출. 각 사용자의 복약 시각이 되면 **LINE Messaging API**로 push. 진단 정보 `diag` 반환. |
| `/api/line/login` | GET | LINE Login 인가 화면으로 리다이렉트(`bot_prompt=aggressive`로 친구 추가도 유도). |
| `/api/line/callback` | GET | 인가 코드→액세스 토큰→`userId` 취득→KV 등록→앱으로 복귀. 링크 코드에 결과 저장(10분 만료). |
| `/api/line/status` | GET | 링크 코드에 해당하는 연동 결과 반환(PWA가 폴링으로 취득. 일회용). |
| `/api/debug` | GET | 등록 사용자·저장 스케줄 확인(`?clean=1`로 테스트 데이터 삭제). |
| `/api/test` | GET | 등록된 모든 사용자에게 즉시 테스트 전송 후 LINE API 응답 반환. |
| `_kv.js` | — | `@vercel/kv` 클라이언트. `KV_REST_API_*` / `UPSTASH_REDIS_REST_*` 어느 환경 변수로도 동작. |

---

## 5. 데이터 스토어

| 스토어 | 용도 | 키 / 형식 |
|--------|------|-----------|
| **Vercel KV(Upstash Redis)** | LINE 알림용 스케줄·사용자 집합·연동 코드 | `medinote:users`(Set), `medinote:sched:<userId>`, `medinote:sent:<userId>:<날짜>:<slot>:<time>`(중복 전송 방지·26h), `medinote:link:<code>`(연동 코드·10분) |
| **Google 드라이브 / 스프레드시트** | 사용자 데이터(약·기록·리마인더)의 기기 간 동기화 | `MediNote_Data` 시트의 A1 셀에 `state`를 JSON 문자열로 저장. 기기에서 직접 Sheets API 호출(`drive.file` 범위). |
| **localStorage** | 기기 로컬 1차 저장 | 위 "프런트엔드" 참조. |

---

## 6. 알림 동작 방식

### 6.1 LINE 알림(앱을 닫아도 도착)

- **트리거**: cron-job.org의 1개 작업이 **30분 간격(`*/30`)**으로 `/api/cron`을 GET.
  (Vercel Cron은 Hobby 플랜에서 하루 1회만 동작하므로 미사용.)
- **판정**: 각 사용자의 `tzOffset`(`getTimezoneOffset()` 값, JST=`-540`)으로 현지 시각을 계산하고, 각 리마인더 시각과의 차이 `diff`가 `0 ~ WINDOW(35분)` 이내면 전송.
  - `local = new Date(nowUtc - tzOffset*60000)` → `getUTCHours()/getUTCMinutes()`로 현지 벽시계.
  - `diff`는 날짜 경계(자정)를 넘는 경우에 대비해 `-720~720`으로 정규화.
- **중복 전송 방지**: `medinote:sent:...` 키를 **전송 성공 시에만** 설정(실패 시 다음 tick에서 재시도).

### 6.2 브라우저 알림 / 정시 알림

- 알림 권한은 시작 후 첫 탭에서 자동 요청(iOS는 user gesture 내에서만 허용 가능).
- Notification Triggers 지원 브라우저에서는 향후 14일분의 정시 알림을 Service Worker에 예약(백그라운드 전송). iOS Safari는 미지원이라 앱이 열려 있는 동안만 동작.

---

## 7. AI 사진 인식

- 화면에서 모드(약 사진 / 약 목록 텍스트)와 이미지를 선택해 `/api/analyze`에 base64·프롬프트·JSON 스키마를 전송.
- 서버는 Anthropic Messages API(`claude-opus-4-8`, `output_config.format=json_schema`)를 호출해 약마다 "이름·복용량·식사와의 관계·복용 시점·주의사항"을 추출.
- **프롬프트는 선택된 언어**로 출력하도록 지시(일본어 / 한국어).
- 이미지 입력은 단일 `<input type="file" accept="image/*">`(`capture` 없음)로, iOS의 네이티브 선택(촬영 / 사진 보관함 / 파일)을 표시.

---

## 8. 인증·연동

| 연동 | 방식 | 비고 |
|------|------|------|
| **Google**(동기화) | OAuth 2.0 토큰 클라이언트(`drive.file openid email profile`). 클라이언트 ID는 프런트에 내장(공개 전제 값). | 토큰은 `localStorage`에 저장해 PWA 재시작에도 유지. `MediNote_Data` 시트에 자동 저장. |
| **LINE Login**(알림 연동) | `/api/line/login` → LINE 인가 → `/api/line/callback` → `userId` 취득. state에 링크 코드·복귀 주소를 포함. | iOS PWA에서는 OAuth가 별도 앱(Safari)에서 열리므로, 링크 코드를 `/api/line/status`로 폴링하여 연동 결과를 취득. |
| **LINE Messaging**(push 전송) | 서버의 `LINE_MESSAGING_ACCESS_TOKEN`으로 `/v2/bot/message/push`. | — |

---

## 9. 배포 / CI

- **프런트엔드**: GitHub Actions(`.github/workflows/firebase-hosting-deploy.yml`). `main`에 push하면 `FirebaseExtended/action-hosting-deploy`가 Firebase Hosting(`watashi-no-kusuri`)의 live 채널로 배포.
  - 필요한 Secret: `FIREBASE_SERVICE_ACCOUNT_WATASHI_NO_KUSURI`(서비스 계정 JSON).
  - 설정: `firebase.json`(`public: "."`, `api/` 등을 `ignore`), `.firebaserc`(default 프로젝트 `watashi-no-kusuri`).
- **백엔드**: Vercel(`api/*.js`를 서버리스 함수로 배포).
- **cron**: cron-job.org(30분 간격으로 `/api/cron`을 호출하는 단일 작업).

---

## 10. 환경 변수

| 변수 | 용도 | 위치 |
|------|------|------|
| `ANTHROPIC_API_KEY` | Claude Vision 호출 | Vercel |
| `LINE_MESSAGING_ACCESS_TOKEN` | LINE push 전송 | Vercel |
| `LINE_LOGIN_CHANNEL_ID` | LINE Login 채널 ID | Vercel(기본값 있음) |
| `LINE_LOGIN_CHANNEL_SECRET` | LINE Login 시크릿 | Vercel |
| `BASE_URL` | LINE 콜백의 기준 URL | Vercel(기본 `https://project-53ect.vercel.app`) |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN`(또는 `UPSTASH_REDIS_REST_URL/TOKEN`) | Vercel KV 연결 | Vercel |
| `FIREBASE_SERVICE_ACCOUNT_WATASHI_NO_KUSURI` | Firebase 배포 | GitHub Secrets |

---

## 11. 디렉터리 구성

```
medinote/
├── index.html              # 프런트엔드 본체(단일 파일)
├── line-callback.html      # LINE 연동 완료 중계 페이지
├── sw.js                   # Service Worker
├── manifest.json           # PWA 매니페스트
├── icon-*.png / *.svg      # 아이콘
├── firebase.json           # Firebase Hosting 설정
├── .firebaserc             # Firebase 프로젝트 설정
├── vercel.json             # Vercel 설정
├── package.json            # 의존성(@vercel/kv)
├── .github/workflows/
│   └── firebase-hosting-deploy.yml   # 자동 배포
├── api/                    # Vercel 서버리스 함수
│   ├── analyze.js          # Claude Vision
│   ├── schedule.js         # KV 저장
│   ├── cron.js             # LINE push(cron)
│   ├── debug.js / test.js  # 진단
│   ├── _kv.js              # KV 클라이언트
│   └── line/
│       ├── login.js / callback.js / status.js
└── docs/                   # 본 문서
```
