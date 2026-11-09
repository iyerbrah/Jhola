#!/bin/bash
# One-time setup of PostgreSQL for Jhola's request log. Run on the server as root:
#
#   sudo bash setup-postgres.sh
#
# It installs PostgreSQL (listening on this machine only), creates the "jhola" role and database
# with a random password, sets up nightly backups, writes DATABASE_URL and VISITOR_SECRET into
# /opt/jhola/.env.production.local and restarts the app. The app creates its own tables on first use.
#
# Safe to run again: it keeps the database and its data, sets a new password and updates the secrets file.

set -euo pipefail

if [[ $(id -u) -ne 0 ]]; then
  echo "Run this with sudo: sudo bash $0" >&2
  exit 1
fi
SECRETS=/opt/jhola/.env.production.local
if [[ ! -f $SECRETS ]]; then
  echo "$SECRETS doesn't exist. Set up the app first (deploy/README.md, step 5)." >&2
  exit 1
fi

echo "→ Installing PostgreSQL"
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql > /dev/null
systemctl enable --now postgresql

echo "→ Listening on this machine only"
CONF=$(sudo -u postgres psql -tAc "show config_file")
if ! grep -qE "^[[:space:]]*listen_addresses[[:space:]]*=[[:space:]]*'localhost'" "$CONF"; then
  sed -i -E "s/^[#[:space:]]*listen_addresses[[:space:]]*=.*/listen_addresses = 'localhost'/" "$CONF"
  systemctl restart postgresql
fi

echo "→ Creating the jhola role and database"
PASS=$(openssl rand -hex 24)
# The password goes in through stdin, so it never shows up in the process list.
sudo -u postgres psql -q -v ON_ERROR_STOP=1 -v pass="$PASS" <<'SQL'
SELECT format('CREATE ROLE jhola LOGIN PASSWORD %L', :'pass') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jhola') \gexec
SELECT format('ALTER ROLE jhola LOGIN PASSWORD %L', :'pass') \gexec
SQL
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = 'jhola'" | grep -q 1; then
  sudo -u postgres createdb -O jhola jhola
fi

echo "→ Nightly backups to /var/backups/jhola (the last 7 days are kept)"
install -d -o postgres -g postgres -m 700 /var/backups/jhola
cat > /etc/cron.d/jhola-pg-backup <<'CRON'
# Nightly dump of Jhola's database at 03:15 server time, keeping 7 days. Restore: see deploy/README.md.
15 3 * * * postgres pg_dump -Fc jhola > /var/backups/jhola/jhola-$(date +\%F).dump && find /var/backups/jhola -name 'jhola-*.dump' -mtime +7 -delete
CRON

echo "→ Writing DATABASE_URL and VISITOR_SECRET into $SECRETS"
# Keep an existing VISITOR_SECRET, so today's visitor counts stay consistent across re-runs.
SECRET=$(grep -E '^VISITOR_SECRET=' "$SECRETS" | head -n 1 | cut -d= -f2- || true)
[[ -n $SECRET ]] || SECRET=$(openssl rand -hex 32)
sed -i -E '/^(DATABASE_URL|VISITOR_SECRET)=/d' "$SECRETS"
printf 'DATABASE_URL=postgres://jhola:%s@127.0.0.1:5432/jhola\nVISITOR_SECRET=%s\n' "$PASS" "$SECRET" >> "$SECRETS"
chown jhola:jhola "$SECRETS"
chmod 600 "$SECRETS"

echo "→ Restarting the app so it picks them up"
systemctl restart jhola
for _ in $(seq 1 30); do
  curl -fs -o /dev/null http://127.0.0.1:3000/ && break
  sleep 1
done
curl -fsS -o /dev/null -w "→ App answered: HTTP %{http_code}\n" http://127.0.0.1:3000/

echo "✓ PostgreSQL is ready. The app creates its tables the first time it saves a request."
