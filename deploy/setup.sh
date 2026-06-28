#!/usr/bin/env bash
# VPS 初回セットアップスクリプト
# 実行: op run --env-file=.env.tpl -- bash deploy/setup.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/apps/signaly}"

install_systemd_service() {
  sed "s|{{APP_DIR}}|${APP_DIR}|g" \
    "${APP_DIR}/deploy/signaly.service.template" | sudo tee /etc/systemd/system/signaly.service > /dev/null
}

echo "==> ディレクトリ作成 (${APP_DIR})"
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

echo "==> MySQL データベースを作成（存在しない場合のみ）"
echo "  !! DATABASE_URL 環境変数が設定されていることを確認してください"
mysql -u root -e "CREATE DATABASE IF NOT EXISTS app_signaly CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" 2>/dev/null || \
  echo "  !! DB 作成をスキップ（手動で実行してください）: CREATE DATABASE app_signaly CHARACTER SET utf8mb4;"

echo "==> systemd サービスを登録 (port 8002)"
install_systemd_service
sudo systemctl daemon-reload
sudo systemctl enable signaly
sudo systemctl restart signaly
sudo systemctl status signaly --no-pager

echo "==> 完了"
echo "  Apache 設定は deploy/apache.conf を VirtualHost に追記してください"
