#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="/etc/letsencrypt/live/mail-service.llab.so"
TARGET_DIR="/home/deploy/apps/llab-mail/tls"

install -d -m 750 -o deploy -g deploy "$TARGET_DIR"
install -m 640 -o deploy -g deploy "$SOURCE_DIR/fullchain.pem" "$TARGET_DIR/fullchain.pem"
install -m 600 -o deploy -g deploy "$SOURCE_DIR/privkey.pem" "$TARGET_DIR/privkey.pem"

if sudo -u deploy bash -lc 'source /home/deploy/.nvm/nvm.sh && pm2 describe qq-mail-relay >/dev/null 2>&1'; then
  sudo -u deploy bash -lc 'source /home/deploy/.nvm/nvm.sh && pm2 restart qq-mail-relay --update-env'
fi
