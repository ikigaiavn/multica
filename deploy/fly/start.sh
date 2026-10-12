#!/bin/sh
# Runs migrations, then the backend, the web app and Caddy in one machine.
# If any of them exits, the others are stopped so Fly restarts the machine.
set -eu

cd /app/server
echo "Running database migrations..."
attempt=0
until ./migrate up; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 10 ]; then
    echo "migrations failed after $attempt attempts" >&2
    exit 1
  fi
  echo "migrate failed; retrying in 5s ($attempt/10)" >&2
  sleep 5
done

PORT=8081 ./server &
backend_pid=$!

cd /app/web
PORT=3000 HOSTNAME=127.0.0.1 REMOTE_API_URL=http://127.0.0.1:8081 node apps/web/server.js &
web_pid=$!

caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &
caddy_pid=$!

shutdown() {
  kill -TERM "$caddy_pid" "$web_pid" "$backend_pid" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap 'shutdown; exit 143' TERM INT

# POSIX sh has no `wait -n`; poll until one child is gone.
while kill -0 "$backend_pid" 2>/dev/null && kill -0 "$web_pid" 2>/dev/null && kill -0 "$caddy_pid" 2>/dev/null; do
  sleep 2
done
echo "a process exited; stopping the machine" >&2
shutdown
exit 1
