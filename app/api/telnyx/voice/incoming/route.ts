import { handleTelnyxVoiceWebhook } from '@/app/api/telnyx/voice/_lib/handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handleTelnyxVoiceWebhook;
