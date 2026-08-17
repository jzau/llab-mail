#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/home/deploy/apps/llab-mail"
cd "$APP_DIR"
source /home/deploy/.nvm/nvm.sh
umask 077

read -r -s -p 'PostgreSQL password for llab_mail: ' DB_PASSWORD
printf '\n'
read -r -s -p 'New admin dashboard password (12+ characters): ' ADMIN_PASSWORD
printf '\n'
read -r -s -p 'Repeat admin dashboard password: ' ADMIN_PASSWORD_REPEAT
printf '\n'

if [[ -z "$DB_PASSWORD" ]]; then
  echo 'Database password cannot be empty.' >&2
  exit 1
fi
if [[ ${#ADMIN_PASSWORD} -lt 12 ]]; then
  echo 'Admin password must be at least 12 characters.' >&2
  exit 1
fi
if [[ "$ADMIN_PASSWORD" != "$ADMIN_PASSWORD_REPEAT" ]]; then
  echo 'Admin passwords do not match.' >&2
  exit 1
fi

ENCODED_DB_PASSWORD="$(DB_PASSWORD="$DB_PASSWORD" node -e "process.stdout.write(encodeURIComponent(process.env.DB_PASSWORD))")"
ADMIN_PASSWORD_HASH="$(ADMIN_PASSWORD="$ADMIN_PASSWORD" node --input-type=module -e "import bcrypt from 'bcryptjs'; process.stdout.write(await bcrypt.hash(process.env.ADMIN_PASSWORD, 12))")"
SESSION_SECRET="$(openssl rand -hex 32)"
APP_ENCRYPTION_KEY="$(openssl rand -hex 32)"

ENV_TEMP="$(mktemp "$APP_DIR/.env.XXXXXX")"
cat > "$ENV_TEMP" <<EOF
NODE_ENV=production
WEB_HOST=127.0.0.1
WEB_PORT=3000
POP3_HOST=0.0.0.0
POP3_PORT=995
SMTP_HOST=0.0.0.0
SMTP_PORT=587
SMTP_BANNER_HOST=mail-service.llab.so
TLS_CERT_PATH=$APP_DIR/tls/fullchain.pem
TLS_KEY_PATH=$APP_DIR/tls/privkey.pem
DATABASE_URL=postgresql://llab_mail:${ENCODED_DB_PASSWORD}@127.0.0.1:5433/llab_mail
DATABASE_SSL=false
SESSION_SECRET=${SESSION_SECRET}
APP_ENCRYPTION_KEY=${APP_ENCRYPTION_KEY}
ADMIN_PASSWORD_HASH=${ADMIN_PASSWORD_HASH}
ALLOW_INSECURE_LOCAL=false
EOF

chmod 600 "$ENV_TEMP"
mv "$ENV_TEMP" "$APP_DIR/.env"
unset DB_PASSWORD ADMIN_PASSWORD ADMIN_PASSWORD_REPEAT ENCODED_DB_PASSWORD ADMIN_PASSWORD_HASH SESSION_SECRET APP_ENCRYPTION_KEY
echo "Created $APP_DIR/.env with mode 600."
