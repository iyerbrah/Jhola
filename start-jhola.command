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
  echo "Add your OpenRouter key to .env (OPENROUTER_API_KEY=...) first; carts can't be built without it."
  echo "Copy .env.example to .env if you haven't. The page will still open, but building carts will show an error."
  echo
fi

[ -d node_modules ] || npm ci

# Open Safari once the server answers.
(
  until curl -s -o /dev/null http://localhost:3000; do sleep 1; done
  open -a Safari http://localhost:3000
) &

npm run dev
