# MediNote（わたしの薬ノート）技術構成ドキュメント

服薬管理 PWA「わたしの薬ノート」の技術構成をまとめたドキュメントです。

---

## 1. 概要

- **目的**: 服薬・サプリの記録、リマインダー、LINE / ブラウザ通知、AI による薬の写真読み取り、Google ドライブ同期を提供する個人向けアプリ。
- **形態**: インストール可能な PWA（Progressive Web App）。フロントエンドは単一の `index.html`（バニラ JS）。
- **対応言語**: 日本語 / 한국어（UI 右上の国旗で切り替え。設定は `localStorage` に保存）。

---

## 2. 全体アーキテクチャ

```
┌──────────────────────────┐
│  ブラウザ / iOS ホーム画面PWA          │
│  index.html (バニラJS) + sw.js          │
│  - localStorage（端末ローカル保存）       │
│  - Service Worker（オフライン/通知）      │
└───────┬───────────────┬──────────────┘
        │               │
        │ HTTPS         │ HTTPS（CORS）
        ▼               ▼
┌───────────────┐   ┌────────────────────────────┐
│ Firebase       │   │ Vercel サーバーレス関数 /api/*    │
│ Hosting        │   │  - /api/analyze（Claude Vision）│
│ (静的配信)      │   │  - /api/schedule（KV保存）       │
│ watashi-no-    │   │  - /api/cron（LINE push）        │
│ kusuri         │   │  - /api/line/*（LINEログイン）     │
└───────────────┘   └──────┬──────────┬────────────┘
                            │          │
                  ┌─────────▼──┐   ┌───▼─────────────┐
                  │ Vercel KV   │   │ 外部API           │
                  │ (Upstash    │   │ - LINE Messaging │
                  │  Redis)     │   │ - LINE Login     │
                  └─────────────┘   │ - Anthropic API  │
                                    └──────────────────┘
   ┌──────────────┐        ┌──────────────────┐
   │ cron-job.org  │ 30分毎 │ Google Drive/Sheets│ ← 端末から直接同期
   │ → /api/cron   │───────▶│ (MediNote_Data)    │
   └──────────────┘        └──────────────────┘
```

- **フロントエンド配信**: Firebase Hosting（プロジェクト/サイト名 `watashi-no-kusuri`、`https://watashi-no-kusuri.web.app`）。
- **バックエンドAPI**: Vercel サーバーレス関数（`https://project-53ect.vercel.app/api/*`）。フロントは定数 `VERCEL_BASE` 経由で呼び出す（クロスオリジン、API 側で CORS 許可）。

---

## 3. フロントエンド

| 項目 | 内容 |
|------|------|
| 構成 | 単一ファイル `index.html`（HTML + CSS + バニラ JavaScript）。フレームワーク不使用。 |
| ローカル保存 | `localStorage`。`medinote_v1`（薬・記録・リマインダー・設定）、`medinote_cfg_v1`（LINE連携・言語等）、`medinote_gtoken_v1`（Googleトークン）。 |
| PWA | `manifest.json` + `sw.js`（Service Worker）。`sw.js` は **ネットワーク優先・失敗時キャッシュ**戦略でオフライン対応。通知クリック処理、Web Push 受信、Notification Triggers（定刻通知）に対応。 |
| 多言語 | `I18N` 辞書（`ja` / `ko` 各約150キー）＋ `t(key, ...args)`。静的 HTML は `data-i18n` / `data-i18n-html` / `data-i18n-ph` 属性、動的文字列は `t()` で切替。言語は `cfg.lang` に保存。 |
| 画面構成 | 今日（服薬チェック）/ お薬（管理）/ リマインダー / 病院用まとめ / アカウント・設定。 |

### 状態モデル（`state`）

```js
state = {
  meds: [],      // {id, name, kind:'med'|'supple', dose, meal, timings:[], note}
  logs: {},      // {'YYYY-MM-DD': {morning:[medId..], noon:[], evening:[], bed:[]}}
  reminders: [], // {id, time:'HH:MM', slot, methods:[]}
  settings: { notif, snooze, snoozeMin },
  line: { userId, name }  // LINE連携情報（クラウド同期対象）
}
```

---

## 4. バックエンド（Vercel サーバーレス関数 `/api`）

| エンドポイント | メソッド | 役割 |
|----------------|----------|------|
| `/api/analyze` | POST | 画像（base64）+ プロンプト + JSON スキーマを受け取り、**Anthropic Claude Vision** を呼び出して薬情報を抽出。APIキーはサーバー側 `ANTHROPIC_API_KEY` に隠蔽。モデル `claude-opus-4-8`。 |
| `/api/schedule` | POST | リマインダーのスケジュールを Vercel KV に保存。`{userId, reminders, tzOffset, authoritative}`。`authoritative=false`（自動送信）で空配列が来ても既存を消さない安全策あり。 |
| `/api/cron` | GET | cron-job.org が 30 分ごとに呼ぶ。各ユーザーの服薬時刻が来ていれば **LINE Messaging API** で push。診断情報 `diag` を返す。 |
| `/api/line/login` | GET | LINE Login の認可画面へリダイレクト（`bot_prompt=aggressive` で友だち追加も促す）。 |
| `/api/line/callback` | GET | 認可コード→アクセストークン→`userId` 取得→KV 登録→アプリへ戻す。リンクコードに結果を保存（10分失効）。 |
| `/api/line/status` | GET | リンクコードに対応する連携結果を返す（PWA がポーリング取得。使い捨て）。 |
| `/api/debug` | GET | 登録ユーザー・保存スケジュールの確認（`?clean=1` でテストデータ削除）。 |
| `/api/test` | GET | 登録ユーザー全員へ即時テスト送信し LINE API の応答を返す。 |
| `_kv.js` | — | `@vercel/kv` クライアント。`KV_REST_API_*` / `UPSTASH_REDIS_REST_*` のどちらの環境変数でも動作。 |

---

## 5. データストア

| ストア | 用途 | キー / 形式 |
|--------|------|-------------|
| **Vercel KV（Upstash Redis）** | LINE通知用のスケジュール・ユーザー集合・連携コード | `medinote:users`（Set）、`medinote:sched:<userId>`、`medinote:sent:<userId>:<日付>:<slot>:<time>`（二重送信防止・26h）、`medinote:link:<code>`（連携コード・10分） |
| **Google ドライブ / スプレッドシート** | ユーザーデータ（薬・記録・リマインダー）の端末間同期 | `MediNote_Data` シートの A1 セルに `state` を JSON 文字列で保存。端末から直接 Sheets API を呼ぶ（`drive.file` スコープ）。 |
| **localStorage** | 端末ローカルの一次保存 | 上記「フロントエンド」参照。 |

---

## 6. 通知の仕組み

### 6.1 LINE 通知（アプリを閉じていても届く）

- **トリガー**: cron-job.org の 1 ジョブが **30 分間隔（`*/30`）** で `/api/cron` を GET。
  （Vercel Cron は Hobby プランだと 1 日 1 回しか動かないため不使用。）
- **判定**: 各ユーザーの `tzOffset`（`getTimezoneOffset()` の値、JST=`-540`）から現地時刻を算出し、各リマインダー時刻との差 `diff` が `0 〜 WINDOW(35分)` 以内なら送信。
  - `local = new Date(nowUtc - tzOffset*60000)` → `getUTCHours()/getUTCMinutes()` で現地壁時計。
  - `diff` は日付境界（深夜0時）をまたぐケースに備え `-720〜720` に正規化。
- **二重送信防止**: `medinote:sent:...` キーを **送信成功時のみ** セット（失敗時は次の tick で再試行）。

### 6.2 ブラウザ通知 / 定刻通知

- 通知許可は起動後の最初のタップで自動要求（iOS は user gesture 内でのみ許可可能なため）。
- Notification Triggers 対応ブラウザでは、先 14 日分の定刻通知を Service Worker に予約（バックグラウンド配信）。iOS Safari は非対応のため、開いている間のみ動作。

---

## 7. AI 写真読み取り

- 画面でモード（薬の写真 / 薬一覧テキスト）と画像を選び、`/api/analyze` に base64・プロンプト・JSON スキーマを送信。
- サーバーは Anthropic Messages API（`claude-opus-4-8`, `output_config.format=json_schema`）を呼び、薬ごとに「名前・服用量・食事との関係・服用タイミング・注意事項」を抽出。
- **プロンプトは選択中の言語**で出力するよう指示（日本語 / 한국어）。
- 画像入力は単一の `<input type="file" accept="image/*">`（`capture` なし）で、iOS のネイティブ選択（撮影 / フォトライブラリ / ファイル）を表示。

---

## 8. 認証・連携

| 連携 | 方式 | 備考 |
|------|------|------|
| **Google**（同期） | OAuth 2.0 トークンクライアント（`drive.file openid email profile`）。クライアント ID はフロントに埋め込み（公開前提の値）。 | トークンは `localStorage` に保存し PWA 再起動でも維持。`MediNote_Data` シートへ自動保存。 |
| **LINE Login**（通知連携） | `/api/line/login` → LINE 認可 → `/api/line/callback` → `userId` 取得。state にリンクコード・戻り先を埋め込み。 | iOS PWA では OAuth が別アプリ（Safari）で開くため、リンクコードを `/api/line/status` でポーリングして連携結果を取得。 |
| **LINE Messaging**（push 送信） | サーバーの `LINE_MESSAGING_ACCESS_TOKEN` で `/v2/bot/message/push`。 | — |

---

## 9. デプロイ / CI

- **フロントエンド**: GitHub Actions（`.github/workflows/firebase-hosting-deploy.yml`）。`main` への push で `FirebaseExtended/action-hosting-deploy` が Firebase Hosting（`watashi-no-kusuri`）の live チャネルへデプロイ。
  - 必要な Secret: `FIREBASE_SERVICE_ACCOUNT_WATASHI_NO_KUSURI`（サービスアカウント JSON）。
  - 設定: `firebase.json`（`public: "."`、`api/` 等を `ignore`）、`.firebaserc`（default プロジェクト `watashi-no-kusuri`）。
- **バックエンド**: Vercel（`api/*.js` をサーバーレス関数としてデプロイ）。
- **cron**: cron-job.org（30 分間隔で `/api/cron` を呼ぶ単一ジョブ）。

---

## 10. 環境変数

| 変数 | 用途 | 場所 |
|------|------|------|
| `ANTHROPIC_API_KEY` | Claude Vision 呼び出し | Vercel |
| `LINE_MESSAGING_ACCESS_TOKEN` | LINE push 送信 | Vercel |
| `LINE_LOGIN_CHANNEL_ID` | LINE Login チャネル ID | Vercel（既定値あり） |
| `LINE_LOGIN_CHANNEL_SECRET` | LINE Login シークレット | Vercel |
| `BASE_URL` | LINE コールバックの基底 URL | Vercel（既定 `https://project-53ect.vercel.app`） |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN`（または `UPSTASH_REDIS_REST_URL/TOKEN`） | Vercel KV 接続 | Vercel |
| `FIREBASE_SERVICE_ACCOUNT_WATASHI_NO_KUSURI` | Firebase デプロイ | GitHub Secrets |

---

## 11. ディレクトリ構成

```
medinote/
├── index.html              # フロントエンド本体（単一ファイル）
├── line-callback.html      # LINE連携完了の中継ページ
├── sw.js                   # Service Worker
├── manifest.json           # PWA マニフェスト
├── icon-*.png / *.svg      # アイコン
├── firebase.json           # Firebase Hosting 設定
├── .firebaserc             # Firebase プロジェクト設定
├── vercel.json             # Vercel 設定
├── package.json            # 依存（@vercel/kv）
├── .github/workflows/
│   └── firebase-hosting-deploy.yml   # 自動デプロイ
├── api/                    # Vercel サーバーレス関数
│   ├── analyze.js          # Claude Vision
│   ├── schedule.js         # KV 保存
│   ├── cron.js             # LINE push（cron）
│   ├── debug.js / test.js  # 診断
│   ├── _kv.js              # KV クライアント
│   └── line/
│       ├── login.js / callback.js / status.js
└── docs/                   # 本ドキュメント
```
