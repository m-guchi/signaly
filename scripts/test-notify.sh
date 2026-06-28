#!/usr/bin/env bash
# テスト通知送信スクリプト（Discord Webhook 形式）
#
# 使い方:
#   bash scripts/test-notify.sh [channel_id] [mode]
#
#   channel_id : チャンネル ID（省略時: test-channel-id-1234）
#   mode       : embed | simple | warning | error（省略時: embed）
#
# 例:
#   bash scripts/test-notify.sh
#   bash scripts/test-notify.sh abc1234 embed
#   bash scripts/test-notify.sh abc1234 simple
#   bash scripts/test-notify.sh abc1234 error
#
# 環境変数:
#   SIGNALY_URL  送信先ベース URL（省略時: http://127.0.0.1:8001）

set -euo pipefail

BASE_URL="${SIGNALY_URL:-http://127.0.0.1:8001}"
CHANNEL_ID="${1:-test-channel-id-1234}"
MODE="${2:-embed}"

TIMESTAMP=$(date "+%Y-%m-%d %H:%M:%S")

# Discord embed color（10進数）: green=#57f287, yellow=#fbbf24, red=#ed4245
COLOR_GREEN=5763719   # 0x57f287
COLOR_YELLOW=16512804   # 0xfbbf24
COLOR_RED=15548997    # 0xed4245

# ── ペイロード生成 ─────────────────────────────────────────────────────────────

case "$MODE" in
  embed)
    PAYLOAD=$(python3 - <<PY
import json
print(json.dumps({
    "embeds": [{
        "title": "✅ [MyApp] CI 成功",
        "color": $COLOR_GREEN,
        "fields": [
            {"name": "App",        "value": "MyApp",                                        "inline": True},
            {"name": "Type",       "value": "CI",                                            "inline": True},
            {"name": "Repository", "value": "\`m-guchi/myapp\`",                            "inline": True},
            {"name": "Branch",     "value": "main",                                          "inline": True},
            {"name": "Commit",     "value": "\`abc1234\`",                                   "inline": True},
            {"name": "Actor",      "value": "m-guchi",                                       "inline": True},
            {"name": "Job",        "value": "backend, frontend",                             "inline": True},
            {"name": "Event",      "value": "push",                                          "inline": True},
            {"name": "Run",        "value": "[Workflow Run](https://github.com)", "inline": False},
        ],
        "footer": {"text": "$TIMESTAMP"},
    }],
}))
PY
)
    ;;

  warning)
    PAYLOAD=$(python3 -c "
import json
print(json.dumps({
    'content': 'これはテスト警告です — $TIMESTAMP',
    'embeds': [{
        'title': '⚠️ テスト警告',
        'color': $COLOR_YELLOW,
    }],
}))
")
    ;;

  error)
    PAYLOAD=$(python3 -c "
import json
print(json.dumps({
    'embeds': [{
        'title': '❌ [MyApp] デプロイ 失敗',
        'color': $COLOR_RED,
        'fields': [
            {'name': 'App',    'value': 'MyApp',      'inline': True},
            {'name': 'Type',   'value': 'デプロイ',   'inline': True},
            {'name': 'Status', 'value': '失敗',        'inline': True},
            {'name': 'Branch', 'value': 'main',        'inline': True},
            {'name': 'Commit', 'value': 'abc1234',     'inline': True},
            {'name': 'Actor',  'value': 'm-guchi',     'inline': True},
            {'name': 'Run',    'value': '[Workflow Run](https://github.com)', 'inline': False},
        ],
    }],
}))
")
    ;;

  simple)
    PAYLOAD=$(python3 -c "
import json
print(json.dumps({
    'content': 'テスト送信 — $TIMESTAMP',
    'embeds': [{
        'title': '✅ シンプル通知',
        'description': 'Discord Webhook 形式の content + embed です',
        'color': $COLOR_GREEN,
    }],
}))
")
    ;;

  *)
    echo "不明なモード: $MODE"
    echo "使用可能: embed | simple | warning | error"
    exit 1
    ;;
esac

# ── 送信 ──────────────────────────────────────────────────────────────────────

echo "送信先: ${BASE_URL}/webhook/${CHANNEL_ID}"
echo "モード: ${MODE}"
echo ""

curl -fsS \
  -X POST "${BASE_URL}/webhook/${CHANNEL_ID}" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD"

echo ""
echo "送信完了"
