#!/usr/bin/env bash
# 開発環境起動スクリプト
# 起動順: cloudflared → URL 取得 → .env.local 更新 → uvicorn
# 終了: Ctrl+C
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
PORT=8001
ENV_LOCAL="$ROOT_DIR/.env.local"
CF_LOG="/tmp/signaly-cloudflared.log"
UV_LOG="/tmp/signaly-uvicorn.log"
UV_PID_FILE="/tmp/signaly.pid"

# ── cloudflared の確認 ────────────────────────────────────────────────────────

if ! command -v cloudflared &>/dev/null; then
  echo "==> cloudflared が見つかりません"
  echo "    sudo dpkg -i /tmp/cloudflared.deb を実行してインストールしてください"
  exit 1
fi

# ── 終了時クリーンアップ ──────────────────────────────────────────────────────

cleanup() {
  echo ""
  echo "==> 終了処理中..."
  [[ -f "$UV_PID_FILE" ]] && kill "$(cat "$UV_PID_FILE")" 2>/dev/null || true
  rm -f "$UV_PID_FILE"
  echo "==> 停止しました"
}
trap cleanup EXIT INT TERM

# ── 既存プロセスを停止 ────────────────────────────────────────────────────────

kill -9 "$(lsof -t -i:${PORT})" 2>/dev/null || true

# ── cloudflared を起動し URL を取得 ──────────────────────────────────────────

echo "==> Cloudflare Tunnel を起動します..."
rm -f "$CF_LOG"
cloudflared tunnel --url "http://127.0.0.1:${PORT}" --no-autoupdate > "$CF_LOG" 2>&1 &
CF_PID=$!

TUNNEL_URL=""
for i in {1..30}; do
  TUNNEL_URL=$(grep -oP 'https://[a-z0-9-]+\.trycloudflare\.com' "$CF_LOG" 2>/dev/null | head -1 || true)
  [[ -n "$TUNNEL_URL" ]] && break
  sleep 1
done

if [[ -z "$TUNNEL_URL" ]]; then
  echo "ERROR: Tunnel URL の取得に失敗しました"
  cat "$CF_LOG"
  exit 1
fi

echo "==> Tunnel URL: $TUNNEL_URL"

# ── .env.local を更新 ─────────────────────────────────────────────────────────

update_env() {
  local key="$1" val="$2"
  if grep -q "^${key}=" "$ENV_LOCAL" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_LOCAL"
  else
    echo "${key}=${val}" >> "$ENV_LOCAL"
  fi
}

update_env "GOOGLE_REDIRECT_URI" "${TUNNEL_URL}/auth/callback"
update_env "APP_URL"              "${TUNNEL_URL}/"

# ── uvicorn を起動 ────────────────────────────────────────────────────────────

echo "==> uvicorn を起動します..."
cd "$ROOT_DIR/backend"
set -a && source "$ENV_LOCAL" && set +a

setsid "$ROOT_DIR/.venv/bin/uvicorn" main:app \
  --host 127.0.0.1 --port "$PORT" \
  > "$UV_LOG" 2>&1 &
echo $! > "$UV_PID_FILE"
disown $!

for i in {1..15}; do
  curl -sf "http://127.0.0.1:${PORT}/api/channels" &>/dev/null && break
  sleep 1
done
echo "==> uvicorn 起動完了"

# ── 情報表示 ──────────────────────────────────────────────────────────────────

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Signaly 開発環境"
echo ""
echo "  ローカル:  http://127.0.0.1:${PORT}"
echo "  トンネル:  ${TUNNEL_URL}"
echo "             ↑ スマホ・OAuth・PWA 通知はこちら"
echo ""
echo "  Google Cloud Console に登録するリダイレクト URI:"
echo "  ${TUNNEL_URL}/auth/callback"
echo ""
echo "  Ctrl+C で終了"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# cloudflared が終了するまでここで待機
wait "$CF_PID"
