#!/bin/bash
# Deploy CVRP Lambda to AWS

set -e

LAMBDA_NAME="flyr-cvrp-router"
AWS_REGION="us-east-2"
ECR_REPO="flyr-cvrp-router"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Building CVRP Lambda Docker image...${NC}"

# Get AWS account ID
AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
ECR_URI="${AWS_ACCOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO}"

# Login to ECR
echo -e "${YELLOW}Logging into ECR...${NC}"
aws ecr get-login-password --region ${AWS_REGION} | \
    docker login --username AWS --password-stdin ${ECR_URI}

# Build and push
echo -e "${YELLOW}Building image...${NC}"
docker build -t ${ECR_REPO} .
docker tag ${ECR_REPO}:latest ${ECR_URI}:latest

echo -e "${YELLOW}Pushing to ECR...${NC}"
docker push ${ECR_URI}:latest

# Update Lambda function
echo -e "${YELLOW}Updating Lambda function...${NC}"
aws lambda update-function-code \
    --function-name ${LAMBDA_NAME} \
    --image-uri ${ECR_URI}:latest \
    --region ${AWS_REGION}

echo -e "${GREEN}Deploy complete!${NC}"
echo ""
echo "Function URL:"
aws lambda get-function-url-config \
    --function-name ${LAMBDA_NAME} \
    --region ${AWS_REGION} \
    --query FunctionUrl \
    --output text 2>/dev/null || echo "(No function URL configured)"
