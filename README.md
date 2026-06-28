# Signaly

Webhook で受け取った通知をリアルタイム表示するプライベート通知ハブ（PWA 対応）です。CI/CD や外部サービスから POST した内容をブラウザで確認でき、Web Push でスマホにも届きます。

- **バックエンド**: FastAPI + Uvicorn（Python）
- **フロントエンド**: Vanilla JS（PWA）
- **DB**: MySQL + SQLAlchemy
- **認証**: Google OAuth（ブラウザ）/ API キー（スクリプト）
- **本番**: systemd + Apache リバースプロキシ（`/signaly/` → `127.0.0.1:8002`）

## 主な機能

- Webhook 受信（Discord Webhook 形式 / Signaly 独自形式）
- チャンネル・グループ管理（作成・名前変更・削除・並び替え）
- SSE によるリアルタイム通知フィード
- Web Push（アプリ終了中もスマホに通知）
- チャンネル・グループごとの通知オン/オフ
- チャンネル URL の共有（`?channel=`）と前回チャンネルの復元

## プロジェクト構成

```
signaly/
├── backend/              # FastAPI API
│   ├── main.py
│   ├── database.py
│   ├── auth.py
│   ├── push.py
│   ├── webhook.py
│   └── requirements.txt
├── frontend/             # 静的 UI（PWA）
│   ├── app.js
│   ├── changelog.js
│   └── ...
├── deploy/               # 本番設定
│   ├── setup.sh
│   ├── signaly.service.template
│   └── apache.conf
├── docs/
│   └── webhook.md        # Webhook API マニュアル
├── scripts/
│   ├── dev.sh            # ローカル開発起動
│   ├── setup-tunnel.sh   # Cloudflare Tunnel 初回設定
│   ├── bump_version.py   # バージョン管理
│   └── gen_vapid_keys.py # Web Push 用キー生成
├── .env.example          # 環境変数一覧（値なし）
├── .env.tpl              # 1Password 参照（本番用）
└── version.json
```

## ローカル開発

### 前提条件

- Python 3.9+
- MySQL（WSL ローカル推奨）
- [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)（OAuth / Web Push / スマホ確認用）

### 初回セットアップ

```bash
cd signaly
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
cp .env.example .env.local   # 値を編集（git 管理外）
```

`.env.local` に DB 接続情報・Google OAuth・`SECRET_KEY` などを設定します。詳細は `.env.example` を参照してください。

Web Push を使う場合:

```bash
python scripts/gen_vapid_keys.py mailto:you@example.com
# 出力された VAPID_* を .env.local に追加
```

### 起動（推奨）

固定 URL（Named Tunnel）を使う場合は初回のみ:

```bash
bash scripts/setup-tunnel.sh dev.<your-domain>
```

日常の開発:

```bash
bash scripts/dev.sh
```

- ローカル: `http://127.0.0.1:8001`
- トンネル: `https://dev.<your-domain>/`（OAuth / PWA / Web Push はこちら）
- 停止: `Ctrl+C`

同一 LAN から HTTP のみ確認する場合（OAuth / Push 不可）:

```bash
bash scripts/portforward.sh
```

### テスト

```bash
.venv/bin/python -m unittest discover -s backend -p 'test_*.py'
```

## 環境変数

| 変数 | 用途 |
|------|------|
| `DB_*` | MySQL 接続 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `GOOGLE_REDIRECT_URI` / `APP_URL` | リダイレクト先・ベース URL |
| `ALLOWED_EMAILS` | ログイン許可メール（カンマ区切り） |
| `SECRET_KEY` | セッション Cookie 署名 |
| `VAPID_*` | Web Push |
| `TUNNEL_NAME` / `TUNNEL_HOSTNAME` | Cloudflare Named Tunnel（開発用） |

本番 VPS では `.env.tpl` 経由で 1Password から注入します。デプロイ時に DB 接続情報は GitHub Actions が `.env` に同期します。

## Webhook

外部サービスからの POST 仕様は [docs/webhook.md](./docs/webhook.md) を参照してください。Discord Execute Webhook と同じ JSON 形式で送信できます。

```
POST https://<your-host>/webhook/<channel_id>
```

Webhook URL はログイン後の **Webhook URL** 画面で確認できます。

## デプロイ

`main` ブランチへの push（または Actions から手動実行）で GitHub Actions が VPS へ rsync デプロイします（[DESIGN_GUIDE](../_docs/DESIGN_GUIDE.md) 参照）。

```
main へ push / workflow_dispatch
    ├─ tag      … version.json から v{version} タグを作成
    ├─ deploy   … rsync → systemd restart
    ├─ release  … GitHub Release を自動生成
    ├─ notify   … デプロイ結果を Discord へ通知
    └─ notify-release … リリース結果を Discord へ通知
```

**注意:** 同じバージョンのタグが別コミットに既にある場合、workflow はエラーで止まります。`python scripts/bump_version.py` で version を上げてから `main` へマージしてください。

### 1Password

| アイテム | フィールド | 用途 |
|---------|-----------|------|
| `signaly` | `target-dir` | デプロイ先パス（`TARGET_DIR`、例: `/apps/signaly`） |
| `signaly` | `db-name` 他 | アプリ固有シークレット |
| `DB` | `db-user` 等 | MySQL 共通接続情報 |
| `Server` | `host` / `username` / `ssh-port` | SSH 接続 |
| `githubaction-sshkey` | `private_key` | GitHub Actions 用 SSH 秘密鍵 |
| `discord_webhook` | `CI_URL` | デプロイ通知 |

GitHub Actions は `.github/deploy.env.tpl` から上記を読み込みます。`known_hosts` は 1Password ではなく `ssh-keyscan` で取得します。

GitHub Secrets には `OP_SERVICE_ACCOUNT_TOKEN` のみ登録します。

### VPS 初回セットアップ

```bash
op run --env-file=.env.tpl -- bash deploy/setup.sh
```

Apache には `deploy/apache.conf` を VirtualHost に追記してください（本番ポート **8002**）。

### ポート

| 環境 | ポート |
|------|--------|
| ローカル開発 | 8001 |
| 本番（systemd） | 8002 |

## リリース手順

`develop` でバージョンを上げ、`main` へ PR マージします。

```bash
python scripts/bump_version.py patch   # 1.0.0 → 1.0.1
python scripts/bump_version.py minor   # 1.0.0 → 1.1.0
python scripts/bump_version.py major   # 1.0.0 → 2.0.0
```

`frontend/changelog.js` に追加されたスタブの `changes` を編集してからコミットします。

```bash
git commit -m "v1.0.1 をリリースする。"
```

## スクリプト一覧

| コマンド | 説明 |
|---------|------|
| `bash scripts/dev.sh` | cloudflared + uvicorn 起動（開発） |
| `bash scripts/setup-tunnel.sh <hostname>` | Named Tunnel 初回設定 |
| `bash scripts/portforward.sh` | WSL → Windows ポートフォワード |
| `python scripts/bump_version.py [patch\|minor\|major]` | バージョン bump |
| `python scripts/gen_vapid_keys.py <mailto:...>` | VAPID キー生成 |
| `bash scripts/test-notify.sh` | テスト通知送信 |

## 設計ガイド

VPS 構成・ポート規則・1Password 運用など共通ルールは [../_docs/DESIGN_GUIDE.md](../_docs/DESIGN_GUIDE.md) を参照してください。
