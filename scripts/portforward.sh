#!/usr/bin/env bash
# Windows ポートフォワーディングを WSL から設定・解除するスクリプト
# 使い方:
#   bash scripts/portforward.sh        # 設定（UAC ダイアログが出る）
#   bash scripts/portforward.sh remove # 解除

set -euo pipefail

PORT=8001
ACTION="${1:-add}"
PS1_WSL="/mnt/c/Windows/Temp/signaly-portforward.ps1"
PS1_WIN="C:\\Windows\\Temp\\signaly-portforward.ps1"

if [[ "$ACTION" == "remove" ]]; then
  cat > "$PS1_WSL" << 'PSEOF'
netsh interface portproxy delete v4tov4 listenport=8001 listenaddress=0.0.0.0 2>$null | Out-Null
netsh advfirewall firewall delete rule name="Signaly Dev" 2>$null | Out-Null
Write-Host "ポートフォワーディングを解除しました" -ForegroundColor Yellow
Start-Sleep -Seconds 2
PSEOF
  echo "==> ポートフォワーディングを解除します（UAC ダイアログが出ます）"
  powershell.exe -Command "Start-Process powershell -Verb RunAs -Wait -ArgumentList '-ExecutionPolicy Bypass -File ${PS1_WIN}'"
  exit 0
fi

# WSL の IP を取得
WSL_IP=$(ip addr show eth0 | grep 'inet ' | awk '{print $2}' | cut -d/ -f1)

cat > "$PS1_WSL" << PSEOF
\$ErrorActionPreference = 'SilentlyContinue'

# 既存設定を削除してから追加
netsh interface portproxy delete v4tov4 listenport=${PORT} listenaddress=0.0.0.0 2>\$null | Out-Null
netsh interface portproxy add    v4tov4 listenport=${PORT} listenaddress=0.0.0.0 connectport=${PORT} connectaddress=${WSL_IP}
netsh advfirewall firewall delete rule name="Signaly Dev" 2>\$null | Out-Null
netsh advfirewall firewall add    rule  name="Signaly Dev" dir=in action=allow protocol=TCP localport=${PORT}

# WiFi IP を取得して表示
\$ip = (Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { \$_.PrefixOrigin -eq 'Dhcp' -and \$_.IPAddress -notmatch '^(127|169|172)' } |
  Select-Object -First 1).IPAddress

Write-Host ""
Write-Host "設定完了！" -ForegroundColor Green
if (\$ip) {
  Write-Host "スマホから開く: http://\${ip}:${PORT}" -ForegroundColor Cyan
} else {
  Write-Host "スマホから開く: http://<Windows の WiFi IP>:${PORT}" -ForegroundColor Cyan
  Write-Host "(ipconfig で Wi-Fi アダプターの IPv4 アドレスを確認してください)" -ForegroundColor Gray
}
Write-Host ""
Read-Host "Enter キーで閉じる"
PSEOF

# Windows の WiFi IP を事前に取得（昇格不要）
WIN_IP=$(powershell.exe -NoProfile -Command \
  "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { \$_.PrefixOrigin -eq 'Dhcp' -and \$_.IPAddress -notmatch '^(127|169|172)' } | Select-Object -First 1).IPAddress" \
  2>/dev/null | tr -d '\r\n')

echo "==> WSL IP: ${WSL_IP} → Windows ポート ${PORT} にフォワード"
echo "==> UAC ダイアログが表示されます。「はい」を押してください。"
powershell.exe -Command "Start-Process powershell -Verb RunAs -Wait -ArgumentList '-ExecutionPolicy Bypass -File ${PS1_WIN}'"

echo ""
echo "  スマホから開く: http://${WIN_IP}:${PORT}"
echo ""
