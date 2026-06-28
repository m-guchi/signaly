#!/usr/bin/env bash
# デプロイユーザーの user systemd ユニットを更新して signaly を再起動する（sudo 不要）。
set -euo pipefail

TARGET_DIR="${1:?TARGET_DIR を指定してください}"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT_FILE="${UNIT_DIR}/signaly.service"
UID_NUM="$(id -u)"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/${UID_NUM}}"

if [[ ! -d "$XDG_RUNTIME_DIR" ]]; then
  echo "error: user systemd が使えません。VPS で次を実行してください: sudo loginctl enable-linger $(whoami)" >&2
  exit 1
fi

mkdir -p "$UNIT_DIR"
sed "s|{{TARGET_DIR}}|${TARGET_DIR}|g" "${TARGET_DIR}/deploy/signaly.service.template" \
  > "$UNIT_FILE"

systemctl --user daemon-reload
systemctl --user enable signaly
systemctl --user restart signaly
