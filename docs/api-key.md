# Signaly API キー マニュアル

スクリプトや CI から Signaly の `/api/*` を呼ぶための認証方法です。

---

## 概要

| 項目 | 内容 |
|------|------|
| 発行方法 | 左上の「設定」（歯車アイコン）→「API キー」欄で発行 |
| 認証ヘッダー | `Authorization: Bearer <キー>`（`sk_` から始まる） |
| スコープ | **チャンネルに関わらず共通**（キーを発行したユーザーがログインした場合と同じ権限） |
| 表示回数 | 発行直後の**一度だけ**（再表示不可）。安全な場所に保存してください |
| 失効・削除 | 「設定」→「API キー」欄の一覧から「削除」でいつでも失効させられます |

キーはチャンネル単位ではなく**アカウント単位**の認証情報です。1つのキーで、そのユーザーがアクセスできる全チャンネルの `/api/*` を呼び出せます。CI や外部サービスに渡す際は、必要な権限だけに絞られていない点に注意してください。

---

## 使い方

```bash
curl -H "Authorization: Bearer sk_xxxxxxxxxxxxxxxx" \
  "https://<your-host>/api/channels"
```

### チャンネル一覧を取得

```bash
curl -H "Authorization: Bearer $SIGNALY_API_KEY" \
  "https://<your-host>/api/channels"
```

### 特定チャンネルの通知履歴を取得（直近から新しい順）

```bash
curl -H "Authorization: Bearer $SIGNALY_API_KEY" \
  "https://<your-host>/api/history/<チャンネル名>?limit=50"
```

`limit` は最大 500（省略時 200）。`before_timestamp` / `before_id` でページングできます。

### メッセージ検索

```bash
curl -H "Authorization: Bearer $SIGNALY_API_KEY" \
  "https://<your-host>/api/search?q=デプロイ&limit=20"
```

`channel` パラメータで対象チャンネルを絞り込めます（省略時は全チャンネル横断）。

---

## 主なエンドポイント一覧

読み取り専用の用途（監視パネル・ダッシュボードなど）で使うものが中心です。

| メソッド | パス | 内容 |
|---------|------|------|
| GET | `/api/channels` | チャンネル一覧（グループ構造含む） |
| GET | `/api/history/{channel_name}` | 指定チャンネルの通知履歴 |
| GET | `/api/search` | メッセージ全文検索 |
| GET | `/api/groups` | グループ一覧 |
| GET | `/api/notification-settings` | 通知オン/オフ設定の一覧 |
| DELETE | `/api/notifications` | 通知の削除（`ids` を指定） |

このほか、チャンネル・グループの作成/変更/削除、通知設定の変更などの書き込み系エンドポイントも同じ認証で呼び出せます。詳細はソースコード（`backend/main.py`）を参照してください。

---

## 通知の送信について

**通知を送るだけ**であれば API キーは不要です。チャンネルごとの Webhook URL（認証不要、`channel_id` が宛先の識別子）に直接 POST してください。詳しくは [Webhook API マニュアル](webhook-docs.html) を参照してください。

API キーは「Signaly に保存された通知を読み取る・管理する」側の用途（他システムからの参照、監視パネルへの表示など）で使うものです。
