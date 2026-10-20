#!/usr/bin/env bash
# Run on the Linux server, from the project folder:  DOMAIN=attendance.example.com ./deploy/deploy.sh
# Optional: SEED_DB=/path/to/attendance.db copies an existing database into the data volume (first deploy only).
set -euo pipefail
cd "$(dirname "$0")/.."

: "${DOMAIN:?Set DOMAIN, e.g. DOMAIN=attendance.example.com ./deploy/deploy.sh}"
command -v docker >/dev/null || { echo "Docker is not installed."; exit 1; }

if [ ! -f .env ]; then
  ADMIN_PASSWORD="$(openssl rand -base64 12 | tr -d '/+=')"
  cat > .env <<EOF
DOMAIN=$DOMAIN
TRUST_PROXY=1
TZ=Africa/Addis_Ababa
ADMIN_USERNAME=admin
ADMIN_PASSWORD=$ADMIN_PASSWORD
EOF
  chmod 600 .env
  echo "Created .env. Admin login: admin / $ADMIN_PASSWORD  (change it after signing in)"
fi

if [ -n "${SEED_DB:-}" ]; then
  docker compose --profile https create app
  docker compose cp "$SEED_DB" app:/app/data/attendance.db
fi

docker compose --profile https up -d --build
echo "Deployed. Open https://$DOMAIN (the DNS A record must point to this server; ports 80/443 open)."
