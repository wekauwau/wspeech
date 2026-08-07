#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load .env
if [ -f "$PROJECT_ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$PROJECT_ROOT/.env"
  set +a
fi

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${POSTGRES_USER:-wspeech}"
DB_PASS="${POSTGRES_PASSWORD:-wspeech}"
DB_NAME="${POSTGRES_DB:-wspeech}"

psql_cmd() {
  PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" "$@"
}

usage() {
  cat <<EOF
Usage: db.sh <command>

Commands:
  push      Apply schema migrations via Atlas
  reset     Drop and recreate schema, then push
  status    Show current migration status
  shell     Open psql shell
EOF
  exit 1
}

cmd_push() {
  echo "Applying schema..."
  cd "$PROJECT_ROOT"
  atlas schema apply \
    --url "postgres://$DB_USER:$DB_PASS@$DB_HOST:$DB_PORT/$DB_NAME?sslmode=disable&search_path=public" \
    --to file://schema \
    --dev-url "docker://postgres/17?search_path=public" \
    --auto-approve
}

cmd_reset() {
  echo "Dropping and recreating schema..."
  psql_cmd -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
  cmd_push
}

cmd_status() {
  echo "Migration status:"
  cd "$PROJECT_ROOT"
  atlas migrate status \
    --url "postgres://$DB_USER:$DB_PASS@$DB_HOST:$DB_PORT/$DB_NAME?sslmode=disable&search_path=public" \
    --dir file://schema/migrations \
    --dev-url "docker://postgres/17?search_path=public" 2>/dev/null || echo "(no migrations directory)"
}

cmd_shell() {
  psql_cmd
}

case "${1:-}" in
  push)   cmd_push ;;
  reset)  cmd_reset ;;
  status) cmd_status ;;
  shell)  cmd_shell ;;
  *)      usage ;;
esac
