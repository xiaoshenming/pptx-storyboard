#!/bin/sh
set -eu

minimum_password_length=${APP_PASSWORD_MIN_LENGTH:-12}
if [ -z "${APP_PASSWORD:-}" ] || [ "${#APP_PASSWORD}" -lt "$minimum_password_length" ]; then
  echo "APP_PASSWORD must contain at least $minimum_password_length characters." >&2
  exit 1
fi
if [ -z "${APP_SESSION_SECRET:-}" ] || [ "${#APP_SESSION_SECRET}" -lt 32 ]; then
  echo 'APP_SESSION_SECRET must contain at least 32 characters.' >&2
  exit 1
fi

mkdir -p /data/tmp
cd /app/demos/demo-react
exec bun ./node_modules/vite/bin/vite.js preview --host 0.0.0.0 --port 4173 --strictPort
