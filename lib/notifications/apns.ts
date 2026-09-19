import { createSign } from 'crypto';
import { connect } from 'node:http2';

type PushEnvironment = 'sandbox' | 'production';

type ApnsPayload = {
  aps: {
    alert: {
      title: string;
      body?: string;
    };
    sound?: string;
    'thread-id'?: string;
  };
  [key: string]: unknown;
};

type SendApnsNotificationInput = {
  token: string;
  environment: PushEnvironment;
  payload: ApnsPayload;
};

type ApnsConfig = {
  keyId: string;
  teamId: string;
  bundleId: string;
  privateKey: string;
};

let cachedJwt: { token: string; issuedAtSeconds: number; keyId: string } | null = null;

function apnsConfig(environment: PushEnvironment): ApnsConfig | null {
  const keyId = (environment === 'sandbox' ? process.env.APNS_SANDBOX_KEY_ID || process.env.APNS_KEY_ID : process.env.APNS_KEY_ID)?.trim();
  const teamId = process.env.APNS_TEAM_ID?.trim();
  const bundleId = process.env.APNS_BUNDLE_ID?.trim();
  const privateKey = (environment === 'sandbox' ? process.env.APNS_SANDBOX_PRIVATE_KEY || process.env.APNS_PRIVATE_KEY : process.env.APNS_PRIVATE_KEY)?.replace(/\\n/g, '\n').trim();

  if (!keyId || !teamId || !bundleId || !privateKey) {
    return null;
  }

  return { keyId, teamId, bundleId, privateKey };
}

function base64Url(value: Buffer | string): string {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function apnsJwt(config: ApnsConfig): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (cachedJwt && cachedJwt.keyId === config.keyId && nowSeconds - cachedJwt.issuedAtSeconds < 50 * 60) {
    return cachedJwt.token;
  }

  const header = base64Url(JSON.stringify({ alg: 'ES256', kid: config.keyId }));
  const claims = base64Url(JSON.stringify({ iss: config.teamId, iat: nowSeconds }));
  const signingInput = `${header}.${claims}`;
  const signer = createSign('SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign({
    key: config.privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  const token = `${signingInput}.${base64Url(signature)}`;
  cachedJwt = { token, issuedAtSeconds: nowSeconds, keyId: config.keyId };
  return token;
}

function apnsHost(environment: PushEnvironment): string {
  return environment === 'production'
    ? 'https://api.push.apple.com'
    : 'https://api.sandbox.push.apple.com';
}

export async function sendApnsNotification(input: SendApnsNotificationInput) {
  const config = apnsConfig(input.environment);
  if (!config) {
    throw new Error('APNs environment variables are not configured');
  }

  // APNs requires HTTP/2; Node fetch does not negotiate it reliably.
  await new Promise<void>((resolve, reject) => {
    const client = connect(apnsHost(input.environment));
    let finished = false;
    const finish = (error?: Error) => {
      if (finished) return; finished = true; clearTimeout(timeout); client.destroy();
      if (error) reject(error); else resolve();
    };
    const timeout = setTimeout(() => finish(new Error('APNs request timed out')), 7000);
    client.on('error', finish);
    const request = client.request({
      ':method': 'POST', ':path': `/3/device/${input.token}`,
      authorization: `bearer ${apnsJwt(config)}`,
      'apns-topic': config.bundleId, 'apns-push-type': 'alert', 'apns-priority': '10',
      'apns-collapse-id': String(input.payload.notification_id ?? '').slice(0, 64),
      'content-type': 'application/json',
    });
    let status = 0; let body = '';
    request.on('response', headers => { status = Number(headers[':status']); });
    request.setEncoding('utf8'); request.on('data', chunk => { body += chunk; });
    request.on('error', finish);
    request.on('end', () => finish(status === 200 ? undefined : new Error(`APNs ${status}: ${body}`)));
    request.end(JSON.stringify(input.payload));
  });
}
