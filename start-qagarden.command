#!/bin/bash
set -e
cd "$(dirname "$0")"
printf '\nStarting QAGarden on http://localhost:3001\n\n'
(sleep 1; open http://localhost:3001 >/dev/null 2>&1 || true) &
node server.js
