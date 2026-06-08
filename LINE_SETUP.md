# LINE通知 セットアップ手順（Vercel）

服薬時間に LINE へ通知を送る仕組みです。構成は次の通りです。

```
アプリ(GitHub Pages) ──連携──▶ LINE Login ──▶ /api/line/callback ──▶ userId保存(KV)
アプリ ──リマインダー時刻送信──▶ /api/schedule ──▶ KVに保存
Vercel Cron(毎分) ──▶ /api/cron ──▶ 時刻一致でLINE Messaging APIへ push
```

## 0. 用意するもの

- **LINEログインチャネル**（Channel ID: `2010328955`）… ユーザー認証に使用
- **Messaging APIチャネル**（同じプロバイダー内に作成）… 通知の送信に使用
- **Vercelアカウント**（プロジェクト: `project-53ect` / URL: `https://project-53ect.vercel.app`）
- **Vercel KV**（データ保存用。Upstash Redis）

> ⚠️ LINEログインと Messaging API は**同じプロバイダー**に置いてください。userId が一致し、送信できるようになります。

## 1. LINE Developers の設定

### LINEログインチャネル（2010328955）
1. [LINE Developers](https://developers.line.biz/console/) → 該当チャネル
2. **LINEログイン設定** → **コールバックURL** に追加：
   ```
   https://project-53ect.vercel.app/api/line/callback
   ```
3. **チャネル基本設定** → **チャネルシークレット** をメモ

### Messaging APIチャネル
1. 同じプロバイダーに **Messaging API** チャネルを作成（既にあればそれを使用）
2. **Messaging API設定** → **チャネルアクセストークン（長期）** を発行してメモ
3. このチャネルの **ボットを友だち追加**（通知を受け取る本人が友だちになる必要あり）

## 2. Vercel KV を作成

1. Vercel ダッシュボード → プロジェクト `project-53ect` → **Storage** → **KV** を作成して接続
2. これで `KV_REST_API_URL` / `KV_REST_API_TOKEN` などが自動で環境変数に追加されます

## 3. Vercel の環境変数（Settings → Environment Variables）

| 変数名 | 値 |
|---|---|
| `LINE_LOGIN_CHANNEL_ID` | `2010328955` |
| `LINE_LOGIN_CHANNEL_SECRET` | LINEログインチャネルのチャネルシークレット |
| `LINE_MESSAGING_ACCESS_TOKEN` | Messaging APIの長期チャネルアクセストークン |
| `BASE_URL` | `https://project-53ect.vercel.app` |
| （KV系） | Vercel KV接続で自動追加 |

設定後、**再デプロイ**してください。

## 4. Cron（毎分実行）について

> ⚠️ **重要**：Vercel無料(Hobby)プランは「1日1回より頻繁なCron」を許可せず、`vercel.json` に毎分Cronを書くと**デプロイが失敗**します。
> そのため `vercel.json` にはCronを入れていません。**外部の無料Cronから毎分叩く**方式にします。

### 外部Cronの設定（無料・どのプランでもOK）

1. [cron-job.org](https://cron-job.org) に無料登録
2. 新しいCronジョブを作成：
   - **URL**：`https://project-53ect.vercel.app/api/cron`
   - **実行間隔**：毎分（every 1 minute）
3. 保存して有効化

これで毎分 `/api/cron` が呼ばれ、服薬時刻が一致したユーザーにLINE通知が送られます。

（Vercel Proプランなら、`vercel.json` に `{"crons":[{"path":"/api/cron","schedule":"* * * * *"}]}` を書けば外部Cron不要です）

## 5. 使い方（アプリ側）

1. アプリの **設定** → 「LINEで通知を受け取る」→ **「LINEと連携する」**
2. LINEログイン＆ボットを友だち追加 → アプリに戻ると「連携済み」表示
3. **リマインダー**で服薬時刻を登録（保存時に自動でサーバーへ送信されます）
4. 時刻になると LINE に通知が届きます

## デプロイ方法

このリポジトリを Vercel プロジェクト `project-53ect` に接続するだけです（`api/` 以下が自動でサーバーレス関数になります）。
ローカルから手動デプロイする場合：

```bash
npm i -g vercel
vercel --prod
```

## トラブルシュート

- 通知が来ない → Vercelの関数ログで `/api/cron` の応答（`sent` の数）を確認
- `LINE_MESSAGING_ACCESS_TOKEN が未設定です` → 環境変数を設定して再デプロイ
- push が 403/400 → ボットを**友だち追加**しているか、userId が Messaging API と同一プロバイダーか確認
