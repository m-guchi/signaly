#!/usr/bin/env bash
# テスト通知送信スクリプト
#
# 使い方:
#   bash scripts/test-notify.sh [channel_id] [mode]
#
#   channel_id : channels.json のキー（省略時: test-channel-id-1234）
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

# ── ペイロード生成 ─────────────────────────────────────────────────────────────

case "$MODE" in
  embed)
    PAYLOAD=$(python3 - <<PY
import json, datetime
now = "$TIMESTAMP"
print(json.dumps({
    "title": "✅ [MyApp] CI 成功",
    "color": "#57f287",
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
}))
PY
)
    ;;

  warning)
    PAYLOAD=$(python3 -c "
import json
print(json.dumps({
    'title': '⚠️ テスト警告',
    'message': 'これはテスト警告です — $TIMESTAMP',
    'level': 'warning',
    'color': '#fbbf24',
}))
")
    ;;

  error)
    PAYLOAD=$(python3 -c "
import json
print(json.dumps({
    'title': '❌ [MyApp] デプロイ 失敗',
    'color': '#ed4245',
    'fields': [
        {'name': 'App',    'value': 'MyApp',      'inline': True},
        {'name': 'Type',   'value': 'デプロイ',   'inline': True},
        {'name': 'Status', 'value': '失敗',        'inline': True},
        {'name': 'Branch', 'value': 'main',        'inline': True},
        {'name': 'Commit', '\''value'\'': '\''abc1234'\'', 'inline': True},
        {'name': 'Actor',  'value': 'm-guchi',     'inline': True},
        {'name': 'Run',    'value': '[Workflow Run](https://github.com)', 'inline': False},
    ],
}))
")
    ;;

  simple)
    PAYLOAD=$(python3 -c "
import json
print(json.dumps({
    'title': '✅ シンプル通知',
    'message': 'テスト送信 — $TIMESTAMP',
    'level': 'info',
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
