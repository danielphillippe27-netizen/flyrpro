#!/bin/bash
# Run Supabase SQL migration using psql
# Usage: ./scripts/run-migration-psql.sh <migration-file>

set -e

# Load environment variables
if [ -f .env.local ]; then
  export $(cat .env.local | grep -v '^#' | xargs)
fi

MIGRATION_FILE=${1:-"20251207000004_add_campaign_id_to_buildings.sql"}
MIGRATION_PATH="supabase/migrations/${MIGRATION_FILE}"

if [ ! -f "$MIGRATION_PATH" ]; then
  echo "❌ Migration file not found: $MIGRATION_PATH"
  exit 1
fi

if [ -z "$DATABASE_URL" ]; then
  echo "❌ DATABASE_URL environment variable is not set"
  echo ""
  echo "Get your connection string from:"
  echo "  Supabase Dashboard > Settings > Database > Connection string (URI)"
  echo ""
  echo "Format: postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres"
  exit 1
fi

echo "📄 Running migration: $MIGRATION_PATH"
echo "🔗 Database: $(echo $DATABASE_URL | sed 's/:[^:]*@/:***@/')"
echo ""

psql "$DATABASE_URL" -f "$MIGRATION_PATH"

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ Migration completed successfully!"
else
  echo ""
  echo "❌ Migration failed!"
  exit 1
fi

