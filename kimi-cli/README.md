# KIMI - Keep It Moving, Idiot

Deploy your FLYR slice Lambda in under 5 minutes.

## Prerequisites

- AWS CLI configured (`aws configure`)
- Docker installed and running
- Node.js 18+

## Install

```bash
npm install -g kimi-deploy
```

Or use locally in FLYR-PRO:

```bash
cd kimi-cli
npm install
npm link
```

## Deploy

**First-time** (creates ECR repo, IAM role, Lambda, Function URL):

```bash
kimi-deploy
# or
npx kimi-deploy
```

Follow the prompts.

**Redeploy** (update Lambda code only, e.g. after changing `templates/lambda/index.js` for Silver provinces):

```bash
cd kimi-cli
./redeploy.sh
```

Requires AWS CLI and Docker. Override with `KIMI_FUNCTION_NAME`, `AWS_REGION` if needed. For non-interactive deploy (e.g. with admin profile), set env vars and run:

```bash
KIMI_FUNCTION_NAME=flyr-slice-lambda \
KIMI_BUCKET=flyr-pro-addresses-2025 \
KIMI_MEMORY=2048 \
KIMI_TIMEOUT=30 \
node bin/kimi.js
```

See [IAM_CREDENTIALS.md](./IAM_CREDENTIALS.md) if you hit IAM/permission errors (e.g. read-only credentials).

## What it does

1. Creates ECR repository
2. Builds Docker image with DuckDB
3. Pushes to ECR
4. Creates Lambda function with S3 permissions
5. Creates Function URL
6. Outputs Vercel env vars
7. Creates Vercel API route

## Cost

~$0.001 per slice request (2-3 seconds @ 2GB)

## Troubleshooting

**Docker not running:**
```bash
# Start Docker Desktop
```

**AWS not configured:**
```bash
aws configure
```

**Permission denied / read-only credentials:**  
You need admin-level AWS credentials to create Lambda, ECR, and IAM resources. See [IAM_CREDENTIALS.md](./IAM_CREDENTIALS.md) for options (admin user, profiles, or manual console setup).

## Dry Run

Test without deploying:

```bash
kimi-deploy --dry-run
```

## Support

Open an issue on GitHub.
