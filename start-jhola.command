#!/bin/zsh
# Double-click to run Jhola on this Mac: starts the dev server and opens it in Safari.
# Stop it with Ctrl+C in the Terminal window, or by closing that window.

cd "${0:A:h}" || exit 1
export PATH="$HOME/.local/node/bin:$PATH"

if ! command -v npm >/dev/null; then
  echo "Node.js isn't installed. Install it from https://nodejs.org and try again."
  read -k1 "?Press any key to close."
  exit 1
fi

if ! grep -qsE '^OPENROUTER_API_KEY=.+' .env .env.local; then
  echo "Add your OpenRouter key to .env (OPENROUTER_API_KEY=...) first; the agent can't build carts without it."
  echo "Copy .env.example to .env if you haven't. The page still opens, but sending a message shows an error."
  echo
fi

[ -d node_modules ] || npm ci

# Already running (from another window, or a preview)? Open it instead of starting a second server:
# two dev servers share the .next folder and break each other's build cache.
if curl -s -o /dev/null http://localhost:3000; then
  echo "Jhola is already running at http://localhost:3000, so this just opens it."
  open -a Safari http://localhost:3000
  exit 0
fi

# Open Safari once the server answers.
(
  until curl -s -o /dev/null http://localhost:3000; do sleep 1; done
  open -a Safari http://localhost:3000
) &

npm run dev
