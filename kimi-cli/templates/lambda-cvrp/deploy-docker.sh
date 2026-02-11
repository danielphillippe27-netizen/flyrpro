#!/bin/bash
# Deploy CVRP Lambda using Docker (builds for x86_64 architecture)

set -e

LAMBDA_NAME="flyr-cvrp-router"
AWS_REGION="us-east-2"
ECR_REPO="flyr-cvrp-router"

echo "🚀 Building CVRP Lambda with Docker..."

# Get AWS account ID
AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
ECR_URI="${AWS_ACCOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO}"

# Create ECR repo if it doesn't exist
echo "📦 Ensuring ECR repository exists..."
aws ecr describe-repositories --repository-names ${ECR_REPO} --region ${AWS_REGION} 2>/dev/null || \
  aws ecr create-repository --repository-name ${ECR_REPO} --region ${AWS_REGION}

# Login to ECR
echo "🔑 Logging into ECR..."
aws ecr get-login-password --region ${AWS_REGION} | \
    docker login --username AWS --password-stdin ${ECR_URI}

# Build and push
echo "🐳 Building Docker image for x86_64..."
docker build --platform linux/amd64 -t ${ECR_REPO}:latest .
docker tag ${ECR_REPO}:latest ${ECR_URI}:latest

echo "⬆️  Pushing to ECR..."
docker push ${ECR_URI}:latest

# Update Lambda to use container image
echo "🔄 Updating Lambda function..."
aws lambda update-function-code \
    --function-name ${LAMBDA_NAME} \
    --region ${AWS_REGION} \
    --image-uri ${ECR_URI}:latest

# Wait for update to complete
echo "⏳ Waiting for update to complete..."
aws lambda wait function-updated --function-name ${LAMBDA_NAME} --region ${AWS_REGION}

# Update configuration
echo "⚙️  Updating function configuration..."
aws lambda update-function-configuration \
    --function-name ${LAMBDA_NAME} \
    --region ${AWS_REGION} \
    --timeout 60 \
    --memory-size 2048

echo "✅ Deployment complete!"
echo ""
echo "Lambda URL:"
aws lambda get-function-url-config \
    --function-name ${LAMBDA_NAME} \
    --region ${AWS_REGION} \
    --query FunctionUrl \
    --output text
