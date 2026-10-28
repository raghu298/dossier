#!/bin/zsh
# Starts Dossier at http://localhost:3000 (local only). Ctrl+C stops it.
cd ~/dossier && HOSTNAME=127.0.0.1 PORT=3000 exec node .next/standalone/server.js
