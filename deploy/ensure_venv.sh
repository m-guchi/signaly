#!/usr/bin/env bash
# Python 仮想環境を用意し、依存関係をインストールする。
# 実行: bash deploy/ensure_venv.sh /path/to/TARGET_DIR
set -euo pipefail

TARGET_DIR="${1:?TARGET_DIR を指定してください}"

cd "$TARGET_DIR"

if [ ! -x .venv/bin/pip ]; then
  python3 -m venv .venv
  .venv/bin/pip install --quiet --upgrade pip
fi

.venv/bin/pip install --quiet -r backend/requirements.txt
