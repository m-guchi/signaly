#!/usr/bin/env bash
# systemd ユニットを更新して signaly を再起動する（sudo で root 実行）。
# デプロイユーザーは deploy/signaly.sudoers.example の NOPASSWD 設定が必要。
set -euo pipefail

TARGET_DIR="${1:?TARGET_DIR を指定してください}"

sed "s|{{TARGET_DIR}}|${TARGET_DIR}|g" "${TARGET_DIR}/deploy/signaly.service.template" \
  > /etc/systemd/system/signaly.service

systemctl daemon-reload
systemctl enable signaly
systemctl restart signaly
