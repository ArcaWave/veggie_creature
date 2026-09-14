#!/bin/bash
# One-time setup for the local animation server (Meta AnimatedDrawings, MIT).
# Usage: cd animator && bash setup.sh
set -e
cd "$(dirname "$0")"

if [ ! -d AnimatedDrawings ]; then
  echo "── cloning AnimatedDrawings…"
  git clone --depth 1 https://github.com/facebookresearch/AnimatedDrawings.git
fi

if [ ! -d venv ]; then
  echo "── creating venv…"
  python3 -m venv venv
fi

echo "── installing deps (torch download takes a few minutes)…"
./venv/bin/pip install --quiet --upgrade pip
./venv/bin/pip install --quiet -e ./AnimatedDrawings
./venv/bin/pip install --quiet fastapi uvicorn pillow

echo "✅ done. start the server with:  bash animator/run.sh"
