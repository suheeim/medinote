# MediNote — お薬管理Webアプリ

`index.html` 1ファイルだけで動作する、スマホ対応のお薬管理アプリです。GitHub Pages にそのまま置けます。

## 機能
- 📅 **今日の服薬チェック** — 朝・昼・夜・寝る前。各タイミングに「まとめて完了」ボタン。達成率リング表示
- 💊 **お薬の設定** — 服用タイミング / 食前・食後・食間 / 服用量 / メモ
- 📷 **写真からAI読み取り** — お薬手帳・処方箋の写真をClaude APIで解析し、お薬を一括登録
- ⏰ **リマインダー** — 時刻指定・再通知（スヌーズ）・ブラウザ通知 / LINE通知
- 🏥 **病院用まとめ** — お薬一覧と過去14日の服薬率。印刷／PDF保存対応
- ☁️ **Google同期** — ご自身のGoogleドライブのスプレッドシートに保存し、端末間で同期
- 日本語UI・レスポンシブ（モバイル下部ナビ）

## デプロイ（GitHub Pages）
1. このリポジトリを GitHub に push
2. Settings → Pages → Branch を `main` / `/root` に設定
3. 公開された `https://<ユーザー名>.github.io/<リポジトリ>/` にアクセス

## 初期設定（アプリ内「⚙️設定」画面で入力）

### 1. Google クライアントID（同期に必要）
1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成
2. 「APIとサービス」→ **Google Sheets API** と **Google Drive API** を有効化
3. 「認証情報」→ OAuth 2.0 クライアントID（種類：**ウェブアプリケーション**）を作成
4. **承認済みのJavaScript生成元** に公開URL（例 `https://<ユーザー名>.github.io`）を追加
5. 発行された `xxxxx.apps.googleusercontent.com` を設定画面に入力

> スコープは `drive.file`（アプリが作成したファイルのみ）。`MediNote_Data` という名前のスプレッドシートを自動作成し、そこにJSONとして保存します。

### 2. Claude API キー（写真読み取りに必要）
- [Anthropic Console](https://console.anthropic.com/) で APIキー（`sk-ant-...`）を発行し、設定画面に入力
- 画像解析は `claude-opus-4-8` を使用。ブラウザから直接呼び出します

### 3. LINE通知（任意）
- LINEへの送信はブラウザだけでは行えないため、**中継サーバー**（LINE Messaging API を呼ぶWebhookエンドポイントなどのURL）が必要です
- 設定すると、リマインダー時刻に `{"message": "..."}` をPOSTします

## 注意事項
- **APIキーの扱い**：Claude APIキー・Googleの情報はすべて**この端末のlocalStorage**にのみ保存され、外部サーバーには送られません（Claude/Google API除く）。個人利用向けの構成です
- **ブラウザ通知**：このページを開いている間のみ動作します（バックグラウンド配信には別途プッシュ基盤が必要）
- 未ログインでもローカル保存で全機能が使えます
