#!/bin/zsh
# Deploy Jhola from this Mac to the live server: runs the tests, copies the code, builds it there,
# restarts the service and checks the public site. Run from anywhere in the project:
#
#   deploy/deploy.sh                    # deploys to ram@jhola.ramiyer.tech
#   deploy/deploy.sh other@some-host    # or somewhere else
#
# The server asks once for ram's own password (for sudo), not the root password.
# Secrets stay on the server in /opt/jhola/.env.production.local and are never copied.

set -euo pipefail
HOST=${1:-ram@jhola.ramiyer.tech}
SITE=https://jhola.ramiyer.tech
cd "${0:A:h}/.."
export PATH="$HOME/.local/node/bin:$PATH"

echo "→ Running tests"
npx vitest run --silent

echo "→ Copying code to $HOST"
# Into a staging folder in your home on the server first; the server then copies it into place.
rsync -az --delete \
  --include='.env.example' --exclude='.env*' \
  --exclude='node_modules' --exclude='.next' --exclude='.git' --exclude='.claude' \
  --exclude='.DS_Store' --exclude='start-jhola.command' \
  ./ "$HOST:jhola-src/"

echo "→ Building and restarting on $HOST (sudo asks for your server user's password)"
ssh -t "$HOST" 'set -e
  sudo rsync -a --delete --include=".env.example" --exclude=".env*" --exclude="node_modules" --exclude=".next" ~/jhola-src/ /opt/jhola/
  sudo chown -R jhola:jhola /opt/jhola
  cd /opt/jhola
  sudo -u jhola -H npm ci --no-audit --no-fund
  sudo -u jhola -H env NEXT_TELEMETRY_DISABLED=1 npm run build
  sudo cp deploy/jhola.service /etc/systemd/system/jhola.service
  sudo systemctl daemon-reload
  sudo systemctl enable --quiet jhola
  sudo systemctl restart jhola
  # Wait quietly for the app to come up (it takes a second or two after a restart).
  for i in {1..20}; do curl -fs -o /dev/null http://127.0.0.1:3000/ && break; sleep 1; done
  curl -fsS -o /dev/null -w "→ App answered on the server: HTTP %{http_code}\n" http://127.0.0.1:3000/'

if [[ "$HOST" == "ram@jhola.ramiyer.tech" ]]; then
  echo "→ Checking $SITE"
  curl -fsS -o /dev/null -w "→ Public site: HTTP %{http_code} in %{time_total}s\n" "$SITE/"
fi

echo "✓ Deployed"
