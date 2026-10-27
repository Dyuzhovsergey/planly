#!/bin/sh
# Create server-only secrets once; never replace an existing environment file.
set -eu

cd "$(dirname "$0")/.."
if [ -e .env.server ] || [ -L .env.server ]; then
    printf '%s\n' '.env.server already exists; keeping it unchanged.' >&2
    exit 1
fi
umask 077
server_env_tmp=$(mktemp .env.server.XXXXXX)
trap 'rm -f "$server_env_tmp"' EXIT
trap 'exit 1' HUP INT TERM
server_db_password=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')
if [ "${#server_db_password}" -ne 64 ]; then
    printf '%s\n' 'Could not generate the database password.' >&2
    exit 1
fi
cat > "$server_env_tmp" <<EOF
# HTTP is only for the first check through an SSH tunnel.
PLANLY_APP_ORIGIN=http://localhost:15173
PLANLY_COOKIE_SECURE=false
PLANLY_WEB_PORT=5173
PLANLY_POSTGRES_PASSWORD=$server_db_password
EOF
# An exclusive hard link prevents overwriting a file created concurrently.
ln "$server_env_tmp" .env.server
printf '%s\n' 'Created .env.server (mode 600). Keep it private and backed up.'
