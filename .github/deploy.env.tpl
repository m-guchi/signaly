# GitHub Actions デプロイ用（1Password 参照）
# Vault: apps — signaly / DB / Server / githubaction-sshkey

SIGNALY_WEBHOOK_URL=op://apps/signaly/ci-webhook-url
TARGET_DIR=op://apps/signaly/target-dir
DB_NAME=op://apps/signaly/db-name
DB_USER=op://apps/DB/db-user
DB_PASSWORD=op://apps/DB/db-password
DB_HOST=op://apps/DB/db-host
DB_PORT=op://apps/DB/db-port
GOOGLE_CLIENT_ID=op://apps/signaly/google-client-id
GOOGLE_CLIENT_SECRET=op://apps/signaly/google-client-secret
GOOGLE_REDIRECT_URI=op://apps/signaly/google-redirect-uri
APP_URL=op://apps/signaly/app-url
ALLOWED_EMAILS=op://apps/signaly/allowed-emails
SECRET_KEY=op://apps/signaly/secret-key
LOGIN_WEBHOOK_URL=op://apps/signaly/login-webhook-url
VAPID_PUBLIC_KEY=op://apps/signaly/vapid-public-key
VAPID_PRIVATE_KEY=op://apps/signaly/vapid-private-key
VAPID_SUBJECT=op://apps/signaly/vapid-subject
SSH_PRIVATE_KEY=op://apps/githubaction-sshkey/private_key?ssh-format=openssh
HOST=op://apps/Server/host
USERNAME=op://apps/Server/username
SSH_PORT=op://apps/Server/ssh-port
