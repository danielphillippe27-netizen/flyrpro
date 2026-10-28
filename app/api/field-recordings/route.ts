import { NextResponse } from 'next/server';

// Permanently retired. Never authenticate with a provider or accept queued uploads.
function retired() {
  return NextResponse.json({ error: 'Recording integration has been removed', code: 'INTEGRATION_RETIRED' }, { status: 410, headers: { 'Cache-Control': 'no-store' } });
}
export { retired as GET, retired as POST, retired as PUT, retired as PATCH, retired as DELETE };
