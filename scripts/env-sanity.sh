#!/usr/bin/env bash
# env-sanity.sh
# Checks only presence (not values) for critical vars in current shell.
set -euo pipefail

vars=(
  NEXT_PUBLIC_SUPABASE_URL
  NEXT_PUBLIC_SUPABASE_ANON_KEY
  SUPABASE_SERVICE_ROLE_KEY
  SUPABASE_JWT_SECRET
)

for v in "${vars[@]}"; do
  if [[ -n "${!v:-}" ]]; then
    echo "OK   $v is set"
  else
    echo "MISS $v is NOT set"
  fi
done
