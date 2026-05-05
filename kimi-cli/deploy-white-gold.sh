#!/bin/bash
# Deploy or update the White Gold PMTiles build Lambda.

set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  echo "Usage: ./deploy-white-gold.sh"
  echo ""
  echo "Environment overrides:"
  echo "  WHITE_GOLD_LAMBDA_NAME   default: flyr-white-gold-build-lambda"
  echo "  WHITE_GOLD_MEMORY        default: 3008"
  echo "  WHITE_GOLD_TIMEOUT       default: 300"
  echo "  AWS_REGION            default: aws configure region or us-east-2"
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TEMPLATE_DIR="${SCRIPT_DIR}/templates/white-gold-lambda"
BUILD_DIR="${SCRIPT_DIR}/.white-gold-build"

read_env() {
  local key="$1"
  local value="${!key:-}"
  if [ -z "${value}" ] && [ -f "${REPO_ROOT}/.env.local" ]; then
    value="$(grep -E "^${key}=" "${REPO_ROOT}/.env.local" | tail -1 | cut -d= -f2- || true)"
  fi
  value="${value%\"}"
  value="${value#\"}"
  printf '%s' "${value}"
}

read_file_env() {
  local key="$1"
  local value=""
  if [ -f "${REPO_ROOT}/.env.local" ]; then
    value="$(grep -E "^${key}=" "${REPO_ROOT}/.env.local" | tail -1 | cut -d= -f2- || true)"
  fi
  value="${value%\"}"
  value="${value#\"}"
  printf '%s' "${value}"
}

LAMBDA_NAME="${WHITE_GOLD_LAMBDA_NAME:-flyr-white-gold-build-lambda}"
AWS_REGION="${AWS_REGION:-$(aws configure get region 2>/dev/null || echo 'us-east-2')}"
AWS_ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
ECR_REPO="${LAMBDA_NAME}"
ECR_URI="${AWS_ACCOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO}"
ROLE_NAME="${LAMBDA_NAME}-role"
MEMORY_SIZE="${WHITE_GOLD_MEMORY:-3008}"
TIMEOUT="${WHITE_GOLD_TIMEOUT:-300}"

SUPABASE_URL="$(read_env NEXT_PUBLIC_SUPABASE_URL)"
if [ -z "${SUPABASE_URL}" ]; then
  SUPABASE_URL="$(read_env SUPABASE_URL)"
fi
SUPABASE_SERVICE_ROLE_KEY="$(read_env SUPABASE_SERVICE_ROLE_KEY)"
DIAMOND_BUILD_WEBHOOK_SECRET="$(read_env DIAMOND_BUILD_WEBHOOK_SECRET)"
WHITE_GOLD_BUILD_WEBHOOK_SECRET="$(read_env WHITE_GOLD_BUILD_WEBHOOK_SECRET)"
if [ -z "${WHITE_GOLD_BUILD_WEBHOOK_SECRET}" ]; then
  WHITE_GOLD_BUILD_WEBHOOK_SECRET="${DIAMOND_BUILD_WEBHOOK_SECRET}"
fi
DIAMOND_BUCKET="$(read_env DIAMOND_GEOMETRY_BUCKET)"
if [ -z "${DIAMOND_BUCKET}" ]; then DIAMOND_BUCKET="$(read_env FLYR_SNAPSHOTS_BUCKET)"; fi
if [ -z "${DIAMOND_BUCKET}" ]; then DIAMOND_BUCKET="$(read_env AWS_BUCKET_NAME)"; fi
if [ -z "${DIAMOND_BUCKET}" ]; then DIAMOND_BUCKET="$(read_env AWS_S3_BUCKET)"; fi
if [ -z "${DIAMOND_BUCKET}" ]; then DIAMOND_BUCKET="flyr-pro-addresses-2025"; fi
APP_BASE_URL="$(read_env APP_BASE_URL)"
if [ -z "${APP_BASE_URL}" ]; then APP_BASE_URL="https://www.flyrpro.app"; fi
S3_UPLOAD_ACCESS_KEY_ID="$(read_file_env AWS_ACCESS_KEY_ID)"
S3_UPLOAD_SECRET_ACCESS_KEY="$(read_file_env AWS_SECRET_ACCESS_KEY)"
S3_UPLOAD_SESSION_TOKEN="$(read_file_env AWS_SESSION_TOKEN)"

if [ -z "${SUPABASE_URL}" ] || [ -z "${SUPABASE_SERVICE_ROLE_KEY}" ] || [ -z "${WHITE_GOLD_BUILD_WEBHOOK_SECRET}" ]; then
  echo "Missing required env. Need NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and WHITE_GOLD_BUILD_WEBHOOK_SECRET or DIAMOND_BUILD_WEBHOOK_SECRET."
  exit 1
fi

echo "Deploying White Gold Lambda: ${LAMBDA_NAME}"
echo "Region: ${AWS_REGION}"
echo "Bucket: ${DIAMOND_BUCKET}"
echo ""

rm -rf "${BUILD_DIR}"
mkdir -p "${BUILD_DIR}/scripts"
cp -R "${TEMPLATE_DIR}/"* "${BUILD_DIR}/"
cp "${TEMPLATE_DIR}/.dockerignore" "${BUILD_DIR}/" 2>/dev/null || true
cp "${REPO_ROOT}/scripts/build-white-gold-pmtiles.ts" "${BUILD_DIR}/scripts/build-white-gold-pmtiles.ts"

echo "Ensuring ECR repository..."
aws ecr describe-repositories --repository-names "${ECR_REPO}" --region "${AWS_REGION}" >/dev/null 2>&1 || \
  aws ecr create-repository --repository-name "${ECR_REPO}" --region "${AWS_REGION}" >/dev/null

echo "Logging into ECR..."
aws ecr get-login-password --region "${AWS_REGION}" | \
  docker login --username AWS --password-stdin "${ECR_URI}"

echo "Building image (linux/amd64 for Lambda)..."
docker buildx build \
  --platform linux/amd64 \
  --provenance=false \
  --sbom=false \
  -t "${ECR_REPO}:latest" \
  -f "${BUILD_DIR}/Dockerfile" \
  "${BUILD_DIR}" \
  --load
docker tag "${ECR_REPO}:latest" "${ECR_URI}:latest"

echo "Pushing image..."
docker push "${ECR_URI}:latest"

TRUST_POLICY="$(mktemp)"
cat > "${TRUST_POLICY}" <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "lambda.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
JSON

echo "Ensuring IAM role..."
if ! aws iam get-role --role-name "${ROLE_NAME}" >/dev/null 2>&1; then
  aws iam create-role \
    --role-name "${ROLE_NAME}" \
    --assume-role-policy-document "file://${TRUST_POLICY}" >/dev/null
  aws iam attach-role-policy \
    --role-name "${ROLE_NAME}" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  echo "Waiting for IAM propagation..."
  sleep 10
fi
ROLE_ARN="$(aws iam get-role --role-name "${ROLE_NAME}" --query Role.Arn --output text)"
rm -f "${TRUST_POLICY}"

INLINE_POLICY="$(mktemp)"
export DIAMOND_POLICY_BUCKET="${DIAMOND_BUCKET}"
export DIAMOND_POLICY_REGION="${AWS_REGION}"
export DIAMOND_POLICY_ACCOUNT="${AWS_ACCOUNT}"
export DIAMOND_POLICY_FUNCTION="${LAMBDA_NAME}"
node > "${INLINE_POLICY}" <<'NODE'
const bucket = process.env.DIAMOND_POLICY_BUCKET;
const region = process.env.DIAMOND_POLICY_REGION;
const account = process.env.DIAMOND_POLICY_ACCOUNT;
const fn = process.env.DIAMOND_POLICY_FUNCTION;
process.stdout.write(JSON.stringify({
  Version: "2012-10-17",
  Statement: [
    {
      Effect: "Allow",
      Action: ["s3:GetObject", "s3:PutObject", "s3:ListBucket"],
      Resource: [`arn:aws:s3:::${bucket}`, `arn:aws:s3:::${bucket}/*`]
    },
    {
      Effect: "Allow",
      Action: ["lambda:InvokeFunction"],
      Resource: `arn:aws:lambda:${region}:${account}:function:${fn}`
    }
  ]
}));
NODE
aws iam put-role-policy \
  --role-name "${ROLE_NAME}" \
  --policy-name "${LAMBDA_NAME}-white-gold-build" \
  --policy-document "file://${INLINE_POLICY}"
rm -f "${INLINE_POLICY}"

ENV_JSON="$(mktemp)"
export LAMBDA_ENV_AWS_S3_BUCKET_REGION="${AWS_REGION}"
export LAMBDA_ENV_SUPABASE_URL="${SUPABASE_URL}"
export LAMBDA_ENV_SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY}"
export LAMBDA_ENV_DIAMOND_BUILD_WEBHOOK_SECRET="${DIAMOND_BUILD_WEBHOOK_SECRET}"
export LAMBDA_ENV_WHITE_GOLD_BUILD_WEBHOOK_SECRET="${WHITE_GOLD_BUILD_WEBHOOK_SECRET}"
export LAMBDA_ENV_DIAMOND_GEOMETRY_BUCKET="${DIAMOND_BUCKET}"
export LAMBDA_ENV_APP_BASE_URL="${APP_BASE_URL}"
export LAMBDA_ENV_S3_UPLOAD_ACCESS_KEY_ID="${S3_UPLOAD_ACCESS_KEY_ID}"
export LAMBDA_ENV_S3_UPLOAD_SECRET_ACCESS_KEY="${S3_UPLOAD_SECRET_ACCESS_KEY}"
export LAMBDA_ENV_S3_UPLOAD_SESSION_TOKEN="${S3_UPLOAD_SESSION_TOKEN}"
node > "${ENV_JSON}" <<'NODE'
process.stdout.write(JSON.stringify({
  Variables: {
    AWS_S3_BUCKET_REGION: process.env.LAMBDA_ENV_AWS_S3_BUCKET_REGION,
    NEXT_PUBLIC_SUPABASE_URL: process.env.LAMBDA_ENV_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.LAMBDA_ENV_SUPABASE_SERVICE_ROLE_KEY,
    DIAMOND_BUILD_WEBHOOK_SECRET: process.env.LAMBDA_ENV_DIAMOND_BUILD_WEBHOOK_SECRET,
    WHITE_GOLD_BUILD_WEBHOOK_SECRET: process.env.LAMBDA_ENV_WHITE_GOLD_BUILD_WEBHOOK_SECRET,
    DIAMOND_GEOMETRY_BUCKET: process.env.LAMBDA_ENV_DIAMOND_GEOMETRY_BUCKET,
    WHITE_GOLD_GEOMETRY_BUCKET: process.env.LAMBDA_ENV_DIAMOND_GEOMETRY_BUCKET,
    APP_BASE_URL: process.env.LAMBDA_ENV_APP_BASE_URL,
    S3_UPLOAD_ACCESS_KEY_ID: process.env.LAMBDA_ENV_S3_UPLOAD_ACCESS_KEY_ID,
    S3_UPLOAD_SECRET_ACCESS_KEY: process.env.LAMBDA_ENV_S3_UPLOAD_SECRET_ACCESS_KEY,
    S3_UPLOAD_SESSION_TOKEN: process.env.LAMBDA_ENV_S3_UPLOAD_SESSION_TOKEN,
    TIPPECANOE_BIN: "/usr/local/bin/tippecanoe",
    OVERTUREMAPS_BIN: "/usr/local/bin/overturemaps",
    HOME: "/tmp",
    XDG_CACHE_HOME: "/tmp",
    XDG_CONFIG_HOME: "/tmp"
  }
}));
NODE

if aws lambda get-function --function-name "${LAMBDA_NAME}" --region "${AWS_REGION}" >/dev/null 2>&1; then
  echo "Updating Lambda function code..."
  aws lambda update-function-code \
    --function-name "${LAMBDA_NAME}" \
    --image-uri "${ECR_URI}:latest" \
    --region "${AWS_REGION}" >/dev/null
  aws lambda wait function-updated --function-name "${LAMBDA_NAME}" --region "${AWS_REGION}"

  echo "Updating Lambda configuration..."
  aws lambda update-function-configuration \
    --function-name "${LAMBDA_NAME}" \
    --memory-size "${MEMORY_SIZE}" \
    --timeout "${TIMEOUT}" \
    --environment "file://${ENV_JSON}" \
    --region "${AWS_REGION}" >/dev/null
  aws lambda wait function-updated --function-name "${LAMBDA_NAME}" --region "${AWS_REGION}"
else
  echo "Creating Lambda function..."
  aws lambda create-function \
    --function-name "${LAMBDA_NAME}" \
    --role "${ROLE_ARN}" \
    --code "ImageUri=${ECR_URI}:latest" \
    --package-type Image \
    --memory-size "${MEMORY_SIZE}" \
    --timeout "${TIMEOUT}" \
    --environment "file://${ENV_JSON}" \
    --region "${AWS_REGION}" >/dev/null
  aws lambda wait function-active --function-name "${LAMBDA_NAME}" --region "${AWS_REGION}"
fi
rm -f "${ENV_JSON}"

FUNCTION_URL="$(aws lambda get-function-url-config --function-name "${LAMBDA_NAME}" --region "${AWS_REGION}" --query FunctionUrl --output text 2>/dev/null || true)"
if [ -z "${FUNCTION_URL}" ] || [ "${FUNCTION_URL}" = "None" ]; then
  FUNCTION_URL="$(aws lambda create-function-url-config \
    --function-name "${LAMBDA_NAME}" \
    --auth-type NONE \
    --region "${AWS_REGION}" \
    --query FunctionUrl \
    --output text)"
fi

aws lambda add-permission \
  --function-name "${LAMBDA_NAME}" \
  --statement-id FunctionURLAllowPublicAccess \
  --action lambda:InvokeFunctionUrl \
  --principal '*' \
  --function-url-auth-type NONE \
  --region "${AWS_REGION}" >/dev/null 2>&1 || true

aws lambda add-permission \
  --function-name "${LAMBDA_NAME}" \
  --statement-id FunctionURLAllowPublicInvoke \
  --action lambda:InvokeFunction \
  --principal '*' \
  --invoked-via-function-url \
  --region "${AWS_REGION}" >/dev/null 2>&1 || true

rm -rf "${BUILD_DIR}"

echo ""
echo "White Gold Lambda is ready:"
echo "${FUNCTION_URL}"
echo ""
echo "Set Vercel WHITE_GOLD_BUILD_WEBHOOK_URL to:"
echo "${FUNCTION_URL}"
