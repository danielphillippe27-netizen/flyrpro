import { existsSync } from 'node:fs';
import { config } from 'dotenv';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

config({ path: existsSync('.env.local') ? '.env.local' : '.env' });

type CloudflareCopyResponse = {
  success?: boolean;
  errors?: Array<{ message?: string }>;
  result?: {
    uid?: string;
    preview?: string;
    thumbnail?: string;
    readyToStream?: boolean;
    status?: { state?: string };
    meta?: Record<string, unknown>;
  };
};

type CliOptions = {
  bucket?: string;
  key?: string;
  region?: string;
  name: string;
};

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = { name: 'demo-video' };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === '--s3' && next) {
      const match = next.match(/^s3:\/\/([^/]+)\/(.+)$/);
      if (!match) {
        throw new Error('--s3 must look like s3://bucket/path/to/video.mp4');
      }
      options.bucket = match[1];
      options.key = decodeURIComponent(match[2]);
      index += 1;
      continue;
    }

    if (arg === '--bucket' && next) {
      options.bucket = next;
      index += 1;
      continue;
    }

    if (arg === '--key' && next) {
      options.key = next;
      index += 1;
      continue;
    }

    if (arg === '--region' && next) {
      options.region = next;
      index += 1;
      continue;
    }

    if (arg === '--name' && next) {
      options.name = next;
      index += 1;
    }
  }

  options.bucket ||= process.env.S3_BUCKET || process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME;
  options.region ||= process.env.AWS_REGION || process.env.AWS_S3_BUCKET_REGION || 'us-east-2';

  if (!options.bucket) {
    throw new Error('Missing S3 bucket. Pass --s3, --bucket, or set S3_BUCKET.');
  }
  if (!options.key) {
    throw new Error('Missing S3 key. Pass --s3 s3://bucket/key.mp4 or --key key.mp4.');
  }

  return options;
}

function getCloudflareCredentials() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN;

  if (!accountId) throw new Error('Missing CLOUDFLARE_ACCOUNT_ID.');
  if (!apiToken) throw new Error('Missing CLOUDFLARE_API_TOKEN.');

  return { accountId, apiToken };
}

async function copyToCloudflareStream({
  accountId,
  apiToken,
  sourceUrl,
  name,
}: {
  accountId: string;
  apiToken: string;
  sourceUrl: string;
  name: string;
}) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/copy`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: sourceUrl,
        meta: { name },
      }),
    }
  );

  const payload = (await response.json().catch(() => ({}))) as CloudflareCopyResponse;
  if (!response.ok || !payload.success || !payload.result?.uid) {
    const message = payload.errors?.map((error) => error.message).filter(Boolean).join('; ');
    throw new Error(message || `Cloudflare Stream copy failed with HTTP ${response.status}.`);
  }

  return payload.result;
}

async function getStreamVideo(accountId: string, apiToken: string, uid: string) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/${uid}`,
    {
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
    }
  );
  const payload = (await response.json().catch(() => ({}))) as CloudflareCopyResponse;
  if (!response.ok || !payload.success || !payload.result) {
    const message = payload.errors?.map((error) => error.message).filter(Boolean).join('; ');
    throw new Error(message || `Cloudflare Stream poll failed with HTTP ${response.status}.`);
  }
  return payload.result;
}

async function pollUntilReady(accountId: string, apiToken: string, uid: string) {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const video = await getStreamVideo(accountId, apiToken, uid);
    if (video.readyToStream || video.status?.state === 'ready') {
      return video;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  return getStreamVideo(accountId, apiToken, uid);
}

async function main() {
  const options = parseArgs();
  const { accountId, apiToken } = getCloudflareCredentials();

  const s3 = new S3Client({ region: options.region });
  const sourceUrl = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: options.bucket,
      Key: options.key,
    }),
    { expiresIn: 60 * 60 }
  );

  console.log(`Copying s3://${options.bucket}/${options.key} to Cloudflare Stream as ${options.name}...`);
  const copied = await copyToCloudflareStream({
    accountId,
    apiToken,
    sourceUrl,
    name: options.name,
  });

  console.log(`Cloudflare accepted video UID ${copied.uid}. Waiting for processing...`);
  const ready = await pollUntilReady(accountId, apiToken, copied.uid);

  console.log('\nStream video:');
  console.log(JSON.stringify({
    uid: ready.uid,
    readyToStream: ready.readyToStream,
    state: ready.status?.state,
    preview: ready.preview,
    thumbnail: ready.thumbnail,
    name: ready.meta?.name,
  }, null, 2));

  console.log('\nAdd these env vars:');
  console.log(`NEXT_PUBLIC_DIALER_STREAM_VIDEO_UID=${ready.uid}`);
  if (ready.thumbnail) {
    console.log(`NEXT_PUBLIC_DIALER_STREAM_POSTER_URL=${ready.thumbnail}`);
  }
  console.log('NEXT_PUBLIC_CLOUDFLARE_STREAM_CUSTOMER_CODE=<copy from your Stream iframe URL: customer-CODE.cloudflarestream.com>');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
