# GitHub Actions デプロイ用（1Password 参照）
# Vault: apps — signaly / DB / Server / githubaction-sshkey / discord_webhook

DISCORD_CI_WEBHOOK_URL=op://apps/discord_webhook/CI_URL
TARGET_DIR=op://apps/signaly/target-dir
DB_NAME=op://apps/signaly/db-name
DB_USER=op://apps/DB/db-user
DB_PASSWORD=op://apps/DB/db-password
DB_HOST=op://apps/DB/db-host
DB_PORT=op://apps/DB/db-port
SSH_PRIVATE_KEY=op://apps/githubaction-sshkey/private_key?ssh-format=openssh
HOST=op://apps/Server/host
USERNAME=op://apps/Server/username
SSH_PORT=op://apps/Server/ssh-port
