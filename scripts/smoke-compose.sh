#!/bin/sh

set -eu

max_health_attempts=40
health_interval_seconds=1

log() {
    printf '%s\n' "[smoke] $*"
}

fail() {
    printf '%s\n' "[smoke] ERROR: $*" >&2
    exit 1
}

require_command() {
    command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

container_id() {
    docker compose ps --all -q "$1"
}

wait_for_healthy() {
    service=$1
    attempt=1

    while [ "$attempt" -le "$max_health_attempts" ]; do
        id=$(container_id "$service")
        if [ -n "$id" ]; then
            status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id")
            if [ "$status" = "healthy" ]; then
                log "$service is healthy"
                return
            fi
        fi

        sleep "$health_interval_seconds"
        attempt=$((attempt + 1))
    done

    docker compose logs --tail 20 "$service" >&2 || true
    fail "$service did not become healthy"
}

published_url() {
    service=$1
    container_port=$2
    mapping=$(docker compose port "$service" "$container_port")
    [ -n "$mapping" ] || fail "no published port for $service:$container_port"
    port=${mapping##*:}
    printf 'http://127.0.0.1:%s' "$port"
}

expect_status() {
    expected=$1
    output_file=$2
    shift 2

    actual=$(curl --silent --show-error --output "$output_file" --write-out '%{http_code}' "$@")
    [ "$actual" = "$expected" ] || fail "expected HTTP $expected, got $actual for $*"
}

assert_non_root_read_only() {
    service=$1
    id=$(container_id "$service")
    uid=$(docker compose exec -T "$service" id -u | tr -d '\r')
    [ "$uid" != "0" ] || fail "$service runs as root"

    read_only=$(docker inspect --format '{{.HostConfig.ReadonlyRootfs}}' "$id")
    [ "$read_only" = "true" ] || fail "$service root filesystem is not read-only"

    log "$service runs as uid $uid with a read-only root filesystem"
}

require_command docker
require_command curl
require_command grep
require_command mktemp
require_command sed

docker compose version >/dev/null 2>&1 || fail "Docker Compose plugin is unavailable"
docker compose config --quiet

temporary_directory=$(mktemp -d)
trap 'rm -rf "$temporary_directory"' EXIT HUP INT TERM

if [ "${SMOKE_SKIP_BUILD:-false}" = "true" ]; then
    log "starting the Compose stack with existing images because SMOKE_SKIP_BUILD=true"
    start_stack() {
        docker compose up -d
    }
else
    log "building and starting the Compose stack"
    start_stack() {
        docker compose up -d --build
    }
fi

if ! start_stack >"$temporary_directory/compose-up.log" 2>&1; then
    cat "$temporary_directory/compose-up.log" >&2
    fail "Compose startup failed; stop Vite or another process using ports 5173/8080/5432 and retry"
fi

wait_for_healthy postgres
wait_for_healthy api
wait_for_healthy web

migrate_id=$(container_id migrate)
[ -n "$migrate_id" ] || fail "migrate container was not created"
migrate_state=$(docker inspect --format '{{.State.Status}}:{{.State.ExitCode}}' "$migrate_id")
[ "$migrate_state" = "exited:0" ] || fail "migrate finished with $migrate_state instead of exited:0"
log "migrate exited successfully"

api_url=$(published_url api 8080)
web_url=$(published_url web 8080)
api_id=$(container_id api)
allowed_origin=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$api_id" | sed -n 's/^APP_ORIGIN=//p')
[ -n "$allowed_origin" ] || fail "APP_ORIGIN is missing from the API container"

expect_status 200 "$temporary_directory/frontend" "$web_url/"
grep -qi '<div id="root"></div>' "$temporary_directory/frontend" || fail "frontend response is not the Vite application"
log "frontend returned the production application"

expect_status 200 "$temporary_directory/health" "$api_url/health"
expect_status 200 "$temporary_directory/ready" "$api_url/ready"
log "API health and readiness checks passed"

expect_status 401 "$temporary_directory/me" "$web_url/api/v1/me"
grep -q '"code":"authentication_required"' "$temporary_directory/me" || fail "proxy /api/v1/me returned an unexpected problem"
log "Nginx preserved the API path"

expect_status 422 "$temporary_directory/register" \
    --request POST \
    --header "Origin: $allowed_origin" \
    --header 'Content-Type: application/json' \
    --data '{}' \
    "$web_url/api/v1/auth/register"
grep -q '"code":"validation_failed"' "$temporary_directory/register" || fail "Origin check returned an unexpected problem"
log "Nginx preserved the allowed browser Origin"

assert_non_root_read_only api
assert_non_root_read_only web

log "all container stack smoke checks passed; services remain running"
