#!/bin/sh
set -e
cd "$(dirname "$0")"
echo "Starting QAGarden on http://localhost:3001"
node server.js
