#!/bin/bash
# Start the local animation server on port 8765 (see setup.sh first).
cd "$(dirname "$0")"
exec ./venv/bin/python server.py
