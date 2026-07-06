# Signaly Webhook API マニュアル

外部サービスや CI/CD から Signaly に通知を送るための Webhook 仕様です。

**Discord Execute Webhook と同じ JSON 形式**で POST できます。既存の Signaly 形式（レガシー形式）も引き続き利用可能です。

---

## 概要

| 項目 | 内容 |
|------|------|
| メソッド | `POST` |
| エンドポイント | `/webhook/{channel_id}` |
| Content-Type | `application/json`（推奨）または `multipart/form-data`（`payload_json` フィールド） |
| 認証 | **不要**（URL に含まれる `channel_id` が宛先の識別子） |
| 文字コード | UTF-8 |
| 形式判定 | トップレベルに `content` / `embeds` / `username` などの Discord 系キーが**1つでもあれば** Discord 形式、なければレガシー形式として扱われる |

Webhook URL は Signaly にログイン後、**Webhook URL** 画面でチャンネルごとに確認できます。

```
https://<your-host>/webhook/<channel_id>
```

**内部データモデルについて:** 受信したペイロードは形式によらず、最終的に `title` / `message` / `level` / `color` / `fields` の5項目に正規化されて保存・配信されます。Discord 形式の `content` はそのままの形では保持されず、後述のルールで `title` / `message` に変換されます。

---

## Discord Webhook 形式（推奨）

[Discord Execute Webhook](https://discord.com/developers/docs/resources/webhook#execute-webhook) と同じペイロードをそのまま送れます。Discord の Webhook URL を Signaly の URL に差し替えるだけで、多くのツールがそのまま動作します。

### トップレベルフィールド

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `content` | string | プレーンテキスト本文（最大 2000 文字想定。文字数制限は Signaly 側では未チェック） |
| `embeds` | array | 埋め込みオブジェクト（最大 10 件想定。件数制限は Signaly 側では未チェック） |
| `username` | string | 送信者名の上書き。**`content` が空、かつどの `embeds[].title` も指定されていないときのみ**タイトルとして使われる（後述） |
| `avatar_url` | string | 無視（表示に一切使われない） |
| `tts` | boolean | 無視 |
| `allowed_mentions` | object | 無視 |
| `components` | array | 無視 |
| `attachments` | array | 無視（ファイル添付は未対応） |

`content` と `embeds` の少なくとも一方を含めてください（Discord と同様。どちらも省略するとタイトル・本文とも空の通知になります）。

### `content` / `embeds` から `title` / `message` への変換ルール（重要）

Signaly には `content` というフィールドは存在せず、常に `title`（タイトル）と `message`（本文）に変換されます。組み合わせによって挙動が変わるため注意してください。

| 入力の組み合わせ | `title` | `message` |
|---|---|---|
| `content` のみ・1 行 | `content` 全文 | `""`（**本文は空になり、タイトルだけの通知になる**） |
| `content` のみ・複数行 | 1 行目 | 2 行目以降 |
| `content` + `embeds` | 先頭 embed の `title`（無ければ `username` フォールバック） | `content` 全文 →（改行区切りで）→ 各 embed の `description`（配列の順） |
| `embeds` のみ | 先頭 embed の `title`（無ければ `username` フォールバック） | 各 embed の `description` を改行区切りで連結 |

つまり `content` と `embeds` を同時に使うと、**`content` が最初のパラグラフ、その下に `embeds[].description` が続く**形で本文に表示されます。タイトルは `content` の 1 行目からは取られず、embed 側（`embeds[0].title` 優先）が使われます。

`username` がタイトルに反映されるのは「`content` が空」かつ「どの embed にも `title` がない」場合のみです。実運用では `content` か `embeds[].title` のどちらかを指定することがほとんどのため、**`username` はほぼ常に無視されます**。Discord 本来の「送信者名」という意味合いとは異なる、フォールバック専用の値だと考えてください。

### `embeds[]` オブジェクト

| フィールド | 型 | Signaly での扱い |
|-----------|-----|-----------------|
| `title` | string | 通知タイトル（先頭 embed を優先。2 番目以降の `title` は無視） |
| `description` | string | 本文に結合（上表のルール参照） |
| `url` | string | 先頭 embed のみ、タイトルを `[title](url)` リンク化 |
| `color` | integer | 左ボーダー色（**10進数**。例: `5763719` = `#57f287`）。先頭 embed の値のみ採用 |
| `fields` | array | そのまま `fields` として表示（`name` / `value` / `inline`） |
| `author` | object | `{ "name": "string", "url": "https://..." }`。`icon_url` は無視。**通常の `fields` と同じ見た目**で `Author` という名前のフィールドとして追加される（Discord のような専用レイアウト・アイコン表示はない） |
| `footer` | object | `{ "text": "string" }`。名前のないフィールド（末尾）として `footer.text` を追加 |
| `thumbnail` | object | `{ "url": "https://..." }`。`Thumbnail` という名前のフィールドに **URL 文字列がそのまま** 入る（画像プレビューにもリンクにもならない）。`url` が `attachment://` で始まる場合は無視 |
| `image` | object | `{ "url": "https://..." }`。`Image` という名前のフィールドに同上 |
| `timestamp` | string | 無視（受信時刻をサーバーが付与） |

`author` / `footer` / `thumbnail` / `image` はいずれも**内部的には `fields` に変換されて追加される**だけで、Discord のような特別な見た目にはなりません。`fields` とまとめて `[]` 個の項目として上から順に表示されます。

**thumbnail / image をリンクにしたい場合:** 現状 URL がそのまま文字列として表示されるだけでクリックできません。クリック可能にしたい場合は `thumbnail` / `image` ではなく、`fields` に `[表示名](URL)` という Markdown リンク形式で指定してください（`fields[].value` は `` `code` `` と `[link](url)` に対応）。

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

上記の場合、タイトルは `"v1.2.3"`、本文は `"デプロイ完了\n\n本番環境に反映しました"` になります（`content` が先、`description` が後）。

### `content` のみ

```bash
curl -X POST "https://example.com/webhook/abc123xyz" \
  -H "Content-Type: application/json" \
  -d '{"content": "Hello from Signaly!"}'
```

1 行だけの `content` は**タイトルとして扱われ、本文は空**になります（上表参照）。複数行の `content` は 1 行目がタイトル、2 行目以降が本文として表示されます。`**ラベル:** 値` 形式は自動ではフィールド化されません（Markdown テキストとして表示）。

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

Discord と同様、**10進数の整数**で指定します。`embeds[0].color` のみが採用されます（2 番目以降の embed の `color` は無視）。

| 色 | Hex | 10進数 (`color`) |
|----|-----|------------------|
| 緑 | `#57f287` | `5763719` |
| 黄 | `#fbbf24` | `16512804` |
| 赤 | `#ed4245` | `15548997` |

---

## Signaly レガシー形式

Discord 形式のキー（`content` / `embeds` / `username` 等）を一つも含まない JSON は、従来の Signaly 形式として解釈されます。

| フィールド | 型 | デフォルト | 説明 |
|-----------|-----|-----------|------|
| `title` | string | `""` | タイトル |
| `message` | string | `""` | 本文 |
| `level` | string | `"info"` | `info` / `warning` / `error` |
| `color` | string | `null` | 左ボーダー色（CSS hex。例: `#57f287`）。指定時は `level` より優先される |
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

### `level` による自動色分け

`color` を指定しなかった場合のみ、`level` の値に応じて枠線の色が自動で決まります。`color` を指定すると `level` の値に関係なく常にそちらが優先されます。

| `level` | 色（変数） | 実際の色 |
|---|---|---|
| `info`（デフォルト） | `--info` | `#818cf8`（インディゴ） |
| `warning` | `--warning` | `#fbbf24`（アンバー） |
| `error` | `--error` | `#f87171`（レッド） |

この自動色分けは**レガシー形式の `level` にのみ**適用されます。Discord 形式で送信した通知は内部的に常に `level: "info"` になるため（`warning` / `error` を指定する項目が Discord 形式には存在しない）、Discord 形式で色を付けたい場合は `embeds[].color` を明示的に指定してください。

---

## Signaly レガシー形式と Discord 形式の違い

| 項目 | Discord 形式 | Signaly レガシー形式 |
|---|---|---|
| タイトルの入力 | `embeds[0].title` 優先 / `content` 1行のみの場合はそれ / なければ `username` | `title` を直接指定 |
| 本文の入力 | `content` + 各 `embeds[].description`（結合される） | `message` を直接指定 |
| 色の指定 | `embeds[0].color`（10進整数） | `color`（CSS hex 文字列）、未指定なら `level` から自動決定 |
| 重要度（`level`） | 概念なし。内部的に常に `"info"` | `info` / `warning` / `error` を指定可能 |
| 追加フィールド | `embeds[].fields` に加え `author` / `footer` / `thumbnail` / `image` も `fields` に変換されて連結 | `fields` をそのまま使用 |
| 形式の判定 | トップレベルに `content` / `embeds` / `username` 等のいずれかが存在する | 上記キーが一つもない |

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
| `400 Bad Request` | JSON / `payload_json` が不正、またはオブジェクトでない |
| `404 Not Found` | `channel_id` が存在しない |

**注意:** リクエストボディが空（`Content-Type: application/json` で本文なし、または `payload_json` が未指定）の場合はエラーにはならず、`title` / `message` とも `""` の空の通知として **200 OK** で保存されます。意図しない空通知が飛ぶ可能性があるため、送信側で本文を組み立ててから POST してください。

---

## 表示について

- `content` と `embeds[].description` は本文（`message`）として結合表示（結合順は上記の変換ルール参照）
- `embeds[].fields` と `author` / `footer` / `thumbnail` / `image` は同じ見た目の `fields` として一覧表示（特別なレイアウトの違いはない）
- 本文とフィールドは**両方とも表示**されます
- フィールドの `value` では `` `code` `` と `[link](url)` が使えます（`thumbnail` / `image` の URL 文字列自体はこの記法を通らないため、リンクにはなりません）

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
- `content` が 1 行のみの場合、本文は空になりタイトルだけの通知になります。
- `username` は `content` も `embeds[].title` もない場合のみタイトルに使われます（通常はほぼ発生しません）。
- `thumbnail` / `image` は URL 文字列がフィールドにそのまま表示されるだけで、画像プレビューにもリンクにもなりません。
- `author.icon_url` / トップレベルの `avatar_url` は無視されます（表示に使われません）。
- リクエストボディが空の場合はエラーにならず、空の通知として保存されます。

---

## クイックリファレンス（Discord 形式）

```http
POST /webhook/{channel_id}
Content-Type: application/json

{
  "content": "optional plain text",
  "username": "optional fallback title (content/embeds title がない場合のみ使用)",
  "embeds": [{
    "title": "string",
    "description": "string",
    "url": "https://...",
    "color": 5763719,
    "fields": [
      {"name": "string", "value": "string", "inline": true}
    ],
    "footer": {"text": "string"},
    "author": {"name": "string", "url": "https://..."},
    "thumbnail": {"url": "https://..."},
    "image": {"url": "https://..."}
  }]
}
```
