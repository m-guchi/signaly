#!/usr/bin/env bash
# VPS 初回セットアップスクリプト
# 実行: bash deploy/setup.sh
set -euo pipefail

APP_DIR="/apps/signaly"

echo "==> ディレクトリ作成"
sudo mkdir -p "$APP_DIR"
sudo chown "$USER":"$USER" "$APP_DIR"

echo "==> ファイルをコピー"
rsync -az --delete \
  --exclude='.git' \
  --exclude='.venv' \
  --exclude='backend/data/' \
  --exclude='backend/channels.json' \
  ./ "$APP_DIR/"

echo "==> Python 仮想環境を作成"
python3 -m venv "$APP_DIR/.venv"
"$APP_DIR/.venv/bin/pip" install --quiet --upgrade pip
"$APP_DIR/.venv/bin/pip" install --quiet -r "$APP_DIR/backend/requirements.txt"

echo "==> channels.json が存在しない場合は例をコピー"
if [[ ! -f "$APP_DIR/backend/channels.json" ]]; then
  cp "$APP_DIR/channels.example.json" "$APP_DIR/backend/channels.json"
  echo "  !! backend/channels.json を編集してチャンネルIDを設定してください"
fi

echo "==> data ディレクトリ作成"
mkdir -p "$APP_DIR/backend/data"
sudo chown -R www-data:www-data "$APP_DIR/backend/data"

echo "==> systemd サービスを登録"
sudo cp "$APP_DIR/deploy/signaly.service" /etc/systemd/system/signaly.service
sudo systemctl daemon-reload
sudo systemctl enable signaly
sudo systemctl restart signaly
sudo systemctl status signaly --no-pager

echo "==> 完了"
echo "  Apache 設定は deploy/apache.conf を VirtualHost に追記してください"
