# Canva Bulk QR Generator

Server-side QR generation and S3 upload for Canva Bulk Create integration.

## Architecture

```
┌─────────────────┐      ┌──────────────────────┐      ┌─────────────┐
│   Client UI     │─────▶│  POST /api/canva/    │─────▶│   S3 Bucket │
│                 │      │  generate            │      │  qr-csv-flyr│
└─────────────────┘      └──────────────────────┘      └─────────────┘
                                │
                                ▼
                         ┌─────────────┐
                         │  Supabase   │
                         │  campaign_  │
                         │  addresses  │
                         └─────────────┘
```

## API Endpoint

### POST `/api/canva/generate`

Generates QR codes for Canva Bulk Create and returns a CSV with ImageURL column.

#### Request Body

```json
{
  "campaignId": "uuid-of-campaign",
  "baseUrl": "https://flyrpro.app/q/abc123",
  "rows": [
    {
      "AddressLine": "123 Main St",
      "City": "Toronto",
      "Province": "ON",
      "PostalCode": "M5V 3A8",
      "ImageFilename": "optional-custom-name.png"
    }
  ]
}
```

#### Response

Returns a CSV file download with headers:
- `Content-Type: text/csv; charset=utf-8`
- `Content-Disposition: attachment; filename="canva_bulk_{campaignId}.csv"`
- `X-Canva-Total: 10`
- `X-Canva-Uploaded: 8`
- `X-Canva-Existing: 1`
- `X-Canva-Failed: 1`

#### CSV Output Columns

Original columns preserved, plus added at end:
- `EncodedURL` - The full URL encoded in the QR
- `S3Key` - The S3 object key
- `ImageURL` - Public S3 URL for Canva
- `Error` - Error message if processing failed

## Environment Variables

```bash
# Required
AWS_REGION=us-east-2
S3_BUCKET=qr-csv-flyr

# Optional
QR_PREFIX=qr/  # S3 key prefix
```

## IAM Permissions Required

The server needs these AWS permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:HeadObject"
      ],
      "Resource": "arn:aws:s3:::qr-csv-flyr/qr/*"
    }
  ]
}
```

## S3 Bucket Policy (Required)

The bucket must allow public read on `qr/*`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::qr-csv-flyr/qr/*"
    }
  ]
}
```

**Note:** Object Ownership must be set to "Bucket owner enforced" (ACLs disabled).

## How to Test

### 1. Test the endpoint locally:

```bash
# Start dev server
pnpm dev

# In another terminal, send test request
curl -X POST http://localhost:3000/api/canva/generate \
  -H "Content-Type: application/json" \
  -H "Cookie: supabase-auth-token=YOUR_TOKEN" \
  -d '{
    "campaignId": "test-campaign",
    "baseUrl": "https://flyrpro.app/q/test",
    "rows": [
      {
        "AddressLine": "123 Test St",
        "City": "Toronto",
        "Province": "ON",
        "PostalCode": "M5V 3A8"
      }
    ]
  }'
```

### 2. Verify the uploaded QR:

```bash
# Get the ImageURL from the response CSV, then:
curl -I https://qr-csv-flyr.s3.us-east-2.amazonaws.com/qr/{userId}/{campaignId}/{filename}.png

# Should return HTTP/1.1 200 OK
```

### 3. Test in browser:

1. Open an incognito window
2. Paste the ImageURL directly
3. QR image should display

## Frontend Usage

```tsx
import { CanvaQRGenerator } from '@/components/canva/CanvaQRGenerator';

function MyPage() {
  const addresses = [
    { AddressLine: '123 Main St', City: 'Toronto', Province: 'ON', PostalCode: 'M5V 3A8' },
    // ...
  ];

  return (
    <CanvaQRGenerator
      campaignId="my-campaign-uuid"
      baseUrl="https://flyrpro.app/q/abc123"
      addresses={addresses}
      onSuccess={() => toast.success('CSV generated!')}
    />
  );
}
```

Or use the hook directly:

```tsx
import { useCanvaQRGenerator } from '@/lib/hooks/use-canva-qr-generator';

function MyComponent() {
  const { generateCSV, downloadCSV, isGenerating, error } = useCanvaQRGenerator();

  const handleGenerate = async () => {
    const result = await generateCSV({
      campaignId: 'uuid',
      baseUrl: 'https://flyrpro.app/q/xyz',
      rows: addresses,
    });

    if (result) {
      downloadCSV(result);
    }
  };
}
```

## S3 Key Structure

```
qr/{userId}/{campaignId}/{filename}.png

Example:
qr/user_abc123/campaign_xyz/123-Main-St-Toronto-ON-M5V3A8.png
```

## Features

- ✅ Server-side QR generation (no client secrets)
- ✅ Concurrent processing (5 rows at a time)
- ✅ Idempotent uploads (skips existing by default)
- ✅ Error handling per row (continues on failure)
- ✅ Database persistence (metadata stored in Supabase)
- ✅ Public S3 URLs (no presigned URLs needed)
- ✅ Progress tracking via response headers
- ✅ Row limit protection (max 300 per request)

## Limitations

- Max 300 rows per request (to avoid timeouts)
- QR codes are 512x512 PNG
- S3 upload is required (no local-only mode in API)
- Requires authenticated user
