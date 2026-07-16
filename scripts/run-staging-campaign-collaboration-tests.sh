#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATION="$ROOT_DIR/supabase/migrations/20260716130000_campaign_collaboration_v2.sql"
TEST_FILE="$ROOT_DIR/supabase/tests/campaign_collaboration_v2.test.sql"
PRODUCTION_PROJECT_REF="${PRODUCTION_PROJECT_REF:-kfnsnwqylsdsbgnwgxva}"

if [[ -z "${STAGING_DATABASE_URL:-}" ]]; then
  echo "STAGING_DATABASE_URL is required." >&2
  exit 2
fi

if [[ "$STAGING_DATABASE_URL" == *"$PRODUCTION_PROJECT_REF"* ]]; then
  echo "Refusing to run campaign fixtures against the production Supabase project." >&2
  exit 3
fi

for command_name in psql pg_dump; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "$command_name is required." >&2
    exit 4
  fi
done

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
artifact_dir="$ROOT_DIR/artifacts/campaign-collaboration/$timestamp"
mkdir -p "$artifact_dir"

echo "Capturing the pre-migration staging schema..."
pg_dump "$STAGING_DATABASE_URL" \
  --schema-only \
  --schema=public \
  --no-owner \
  --no-privileges \
  > "$artifact_dir/staging-schema-before.sql"

echo "Applying the canonical collaboration migration to staging..."
psql "$STAGING_DATABASE_URL" \
  -X \
  -v ON_ERROR_STOP=1 \
  -f "$MIGRATION" \
  > "$artifact_dir/migration.log" 2>&1

echo "Running pgTAP acceptance contracts against staging..."
psql "$STAGING_DATABASE_URL" \
  -X \
  -v ON_ERROR_STOP=1 \
  -f "$TEST_FILE" \
  2>&1 | tee "$artifact_dir/pgtap.log"

if grep -Eq '(^|[[:space:]])not ok([[:space:]]|$)|Looks like you failed' "$artifact_dir/pgtap.log"; then
  echo "pgTAP reported at least one failed assertion." >&2
  exit 5
fi

echo "Staging collaboration acceptance suite passed."
echo "Evidence: $artifact_dir"
