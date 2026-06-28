# Signaly Webhook API マニュアル

外部サービスや CI/CD から Signaly に通知を送るための Webhook 仕様です。

**Discord Execute Webhook と同じ JSON 形式**で POST できます。既存の Signaly 形式も引き続き利用可能です。

---

## 概要

| 項目 | 内容 |
|------|------|
| メソッド | `POST` |
| エンドポイント | `/webhook/{channel_id}` |
| Content-Type | `application/json`（推奨）または `multipart/form-data`（`payload_json` フィールド） |
| 認証 | **不要**（URL に含まれる `channel_id` が宛先の識別子） |
| 文字コード | UTF-8 |

Webhook URL は Signaly にログイン後、**Webhook URL** 画面でチャンネルごとに確認できます。

```
https://<your-host>/webhook/<channel_id>
```

---

## Discord Webhook 形式（推奨）

[Discord Execute Webhook](https://discord.com/developers/docs/resources/webhook#execute-webhook) と同じペイロードをそのまま送れます。Discord の Webhook URL を Signaly の URL に差し替えるだけで、多くのツールがそのまま動作します。

### トップレベルフィールド

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `content` | string | プレーンテキスト本文（最大 2000 文字想定） |
| `embeds` | array | 埋め込みオブジェクト（最大 10 件想定） |
| `username` | string | Webhook 表示名の上書き（`embeds` がない場合のタイトルに使用） |
| `avatar_url` | string | アバター URL（現時点では表示には未使用） |
| `tts` | boolean | 無視 |
| `allowed_mentions` | object | 無視 |
| `components` | array | 無視 |
| `attachments` | array | 無視（ファイル添付は未対応） |

`content` と `embeds` の少なくとも一方を含めてください（Discord と同様）。

### `embeds[]` オブジェクト

| フィールド | 型 | Signaly での扱い |
|-----------|-----|-----------------|
| `title` | string | 通知タイトル（先頭 embed を優先） |
| `description` | string | 本文に結合 |
| `url` | string | タイトルを `[title](url)` リンク化 |
| `color` | integer | 左ボーダー色（**10進数**。例: `5763719` = `#57f287`） |
| `fields` | array | そのまま表示（`name` / `value` / `inline`） |
| `author` | object | `Author` フィールドとして追加 |
| `footer` | object | 末尾フィールドとして `footer.text` を追加 |
| `thumbnail` | object | `Thumbnail` フィールドとして URL を追加 |
| `image` | object | `Image` フィールドとして URL を追加 |
| `timestamp` | string | 無視（受信時刻をサーバーが付与） |

### リクエスト例

```bash
curl -X POST "https://example.com/webhook/abc123xyz" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "デプロイ完了",
    "embeds": [{
      "title": "v1.2.3",
      "description": "本番環境に反映しました",
      "color": 5763719,
      "fields": [
        {"name": "Branch", "value": "main", "inline": true},
        {"name": "Commit", "value": "`abc1234`", "inline": true}
      ],
      "footer": {"text": "CI bot"}
    }]
  }'
```

### `content` のみ

```bash
curl -X POST "https://example.com/webhook/abc123xyz" \
  -H "Content-Type: application/json" \
  -d '{"content": "Hello from Signaly!"}'
```

複数行の `content` は 1 行目がタイトル、2 行目以降が本文として表示されます。`**ラベル:** 値` 形式は自動ではフィールド化されません（Markdown テキストとして表示）。

フィールド表示が必要な場合は **`embeds` 形式**を使ってください（後述の SSH 通知例を参照）。

```bash
# 1 行目 → タイトル、2 行目以降 → 本文（プレーンテキスト）
curl -X POST "https://example.com/webhook/abc123xyz" \
  -H "Content-Type: application/json" \
  -d '{"content": "🚀 SSHログイン通知\nサーバー: myserver\nユーザー: root"}'
```

### shell スクリプトから送る場合

bash で JSON を手組みすると、ホスト名やユーザー名に `"` や `\` が含まれたとき JSON が壊れることがあります。**`jq` で JSON を生成してください。**

#### フィールド表示したい場合（`embeds` 推奨）

```bash
USER=$(whoami)
IP=$(echo "$SSH_CLIENT" | awk '{print $1}')
DATE=$(date "+%Y-%m-%d %H:%M:%S")
HOSTNAME=$(hostname)

jq -n \
  --arg user "$USER" \
  --arg ip "$IP" \
  --arg date "$DATE" \
  --arg host "$HOSTNAME" \
  '{
    embeds: [{
      title: "SSHログイン通知",
      color: 5763719,
      fields: [
        {name: "サーバー", value: $host, inline: true},
        {name: "ユーザー", value: $user, inline: true},
        {name: "接続元IP", value: $ip, inline: true},
        {name: "日時", value: $date, inline: false}
      ]
    }]
  }' | curl -fsS -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d @-
```

#### シンプルなテキスト通知（`content`）

```bash
jq -n \
  --arg user "$USER" \
  --arg ip "$IP" \
  --arg date "$DATE" \
  --arg host "$HOSTNAME" \
  '{
    content: (
      "🚀 **SSHログイン通知**\n" +
      "**サーバー:** \($host)\n" +
      "**ユーザー:** \($user)\n" +
      "**接続元IP:** \($ip)\n" +
      "**日時:** \($date)"
    )
  }' | curl -fsS -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d @-
```

`jq` がない場合は Python を使えます（`embeds` 版）。

```bash
python3 - <<'PY' | curl -fsS -X POST "$WEBHOOK_URL" -H "Content-Type: application/json" -d @-
import json, os, socket
from datetime import datetime
print(json.dumps({
    "embeds": [{
        "title": "SSHログイン通知",
        "color": 5763719,
        "fields": [
            {"name": "サーバー", "value": socket.gethostname(), "inline": True},
            {"name": "ユーザー", "value": os.getenv("USER", "unknown"), "inline": True},
            {"name": "日時", "value": datetime.now().strftime("%Y-%m-%d %H:%M:%S"), "inline": False},
        ],
    }],
}, ensure_ascii=False))
PY
```

### `embeds` のみ（CI 通知）

```bash
curl -X POST "https://example.com/webhook/abc123xyz" \
  -H "Content-Type: application/json" \
  -d '{
    "embeds": [{
      "title": "✅ [MyApp] CI 成功",
      "color": 5763719,
      "fields": [
        {"name": "Branch", "value": "main", "inline": true},
        {"name": "Run", "value": "[Workflow Run](https://github.com)", "inline": false}
      ]
    }]
  }'
```

### 色の指定（Discord 形式）

Discord と同様、**10進数の整数**で指定します。

| 色 | Hex | 10進数 (`color`) |
|----|-----|------------------|
| 緑 | `#57f287` | `5763719` |
| 黄 | `#fbbf24` | `16512804` |
| 赤 | `#ed4245` | `15548997` |

---

## Signaly レガシー形式

Discord 形式のキー（`content` / `embeds` 等）を含まない JSON は、従来の Signaly 形式として解釈されます。

| フィールド | 型 | デフォルト | 説明 |
|-----------|-----|-----------|------|
| `title` | string | `""` | タイトル |
| `message` | string | `""` | 本文 |
| `level` | string | `"info"` | `info` / `warning` / `error` |
| `color` | string | `null` | 左ボーダー色（CSS hex。例: `#57f287`） |
| `fields` | array | `null` | `[{name, value, inline}]` |

```bash
curl -X POST "https://example.com/webhook/abc123xyz" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "デプロイ完了",
    "message": "v1.2.3 を本番に反映しました",
    "level": "info"
  }'
```

---

## multipart/form-data

Discord と同様、ファイル添付時の `multipart/form-data` でも `payload_json` フィールドに JSON を入れれば受け付けます（ファイル本体は現時点では未処理）。

```bash
curl -X POST "https://example.com/webhook/abc123xyz" \
  -F 'payload_json={"content":"multipart からの通知"}'
```

---

## レスポンス

### 成功（200 OK）

```json
{
  "ok": true,
  "id": "550e8400-e29b-41d4-a716-446655440000"
}
```

Discord は `204 No Content` を返しますが、Signaly は通知 ID を返します。

### エラー

| HTTP ステータス | 条件 |
|----------------|------|
| `400 Bad Request` | JSON / `payload_json` が不正 |
| `404 Not Found` | `channel_id` が存在しない |
| `422 Unprocessable Entity` | リクエストボディが空で JSON パース不可（`Content-Type: application/json` かつ空ボディ時） |

---

## 表示について

- `content` と `embeds[].description` は本文として表示
- `embeds[].fields` は Discord 風の埋め込みフィールドとして表示
- 本文とフィールドは**両方とも表示**されます
- フィールドの `value` では `` `code` `` と `[link](url)` が使えます

---

## 受信後の動作

1. **DB に保存** — 通知履歴として永続化
2. **SSE で配信** — 該当チャンネルを開いているブラウザにリアルタイム表示
3. **Web Push** — VAPID が設定されていれば、登録済み端末へプッシュ通知

---

## ローカルでのテスト

```bash
bash scripts/test-notify.sh <channel_id> embed
bash scripts/test-notify.sh <channel_id> simple
bash scripts/test-notify.sh <channel_id> warning
bash scripts/test-notify.sh <channel_id> error
```

---

## 制限・注意事項

- Webhook エンドポイントは**認証なし**です。`channel_id` の漏洩に注意してください。
- ファイル添付（`files[n]`）は未対応です。
- `components`（ボタン等）・`poll` は未対応です。
- 同じ内容を複数回 POST すると、それぞれ別通知として保存されます。

---

## クイックリファレンス（Discord 形式）

```http
POST /webhook/{channel_id}
Content-Type: application/json

{
  "content": "optional plain text",
  "username": "optional override name",
  "embeds": [{
    "title": "string",
    "description": "string",
    "url": "https://...",
    "color": 5763719,
    "fields": [
      {"name": "string", "value": "string", "inline": true}
    ],
    "footer": {"text": "string"},
    "author": {"name": "string", "url": "https://..."}
  }]
}
```
