#!/bin/zsh
# Daily Dossier auto-apply: inbox check, email applications with your own resume, summary mail to you.
export PATH=/Users/raghunath/.nvm/versions/node/v24.14.1/bin:/opt/homebrew/bin:/usr/bin:/bin
cd /Users/raghunath/dossier
mkdir -p node_modules/server-only && echo '{"name":"server-only","main":"index.js"}' > node_modules/server-only/package.json && : > node_modules/server-only/index.js
set -a; source .env; set +a
echo "=== $(date)"
yarn tsx --tsconfig tsconfig.json /Users/raghunath/dossier-data/auto-apply.mts
rm -rf node_modules/server-only
