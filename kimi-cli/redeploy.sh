#!/bin/bash
# Redeploy slice Lambda (update code only). Use after changing templates/lambda/index.js
# (e.g. Silver province CSV). First-time deploy: use `node bin/kimi.js` instead.

set -e

LAMBDA_NAME="${KIMI_FUNCTION_NAME:-flyr-slice-lambda}"
AWS_REGION="${AWS_REGION:-$(aws configure get region 2>/dev/null || echo 'us-east-2')}"
ECR_REPO="${LAMBDA_NAME}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_DIR="${SCRIPT_DIR}/templates/lambda"
BUILD_DIR="${SCRIPT_DIR}/.kimi-build"

echo "Redeploying Lambda: ${LAMBDA_NAME} (region: ${AWS_REGION})"
echo "Template: ${TEMPLATE_DIR}"
echo ""

# Copy template (same as full deploy) so we don't build from repo root
rm -rf "${BUILD_DIR}"
mkdir -p "${BUILD_DIR}"
cp -R "${TEMPLATE_DIR}"/* "${BUILD_DIR}/"
cp "${TEMPLATE_DIR}"/.dockerignore "${BUILD_DIR}/" 2>/dev/null || true

# AWS account and ECR URI
AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
ECR_URI="${AWS_ACCOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO}"

echo "Logging into ECR..."
aws ecr get-login-password --region "${AWS_REGION}" | \
  docker login --username AWS --password-stdin "${ECR_URI}"

echo "Building image (linux/amd64 for Lambda)..."
docker buildx build --platform linux/amd64 --provenance=false --sbom=false -t "${ECR_REPO}:latest" -f "${BUILD_DIR}/Dockerfile" "${BUILD_DIR}" --load
docker tag "${ECR_REPO}:latest" "${ECR_URI}:latest"

echo "Pushing to ECR..."
docker push "${ECR_URI}:latest"

echo "Updating Lambda function code..."
aws lambda update-function-code \
  --function-name "${LAMBDA_NAME}" \
  --image-uri "${ECR_URI}:latest" \
  --region "${AWS_REGION}"

rm -rf "${BUILD_DIR}"
echo ""
echo "Done. Lambda ${LAMBDA_NAME} is now running the code from templates/lambda/index.js"
