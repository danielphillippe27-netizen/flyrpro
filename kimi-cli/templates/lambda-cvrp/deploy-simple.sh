#!/bin/bash
# Simple deployment for CVRP Lambda

set -e

LAMBDA_NAME="flyr-cvrp-router"
AWS_REGION="us-east-2"

echo "🚀 Deploying CVRP Lambda..."

# Create temporary deployment package
echo "📦 Creating deployment package..."
cd /tmp
mkdir -p cvrp-lambda
cd cvrp-lambda

# Copy files
cp /Users/danielphillippe/Desktop/FLYR-PRO/kimi-cli/templates/lambda-cvrp/app.py .
cp /Users/danielphillippe/Desktop/FLYR-PRO/kimi-cli/templates/lambda-cvrp/requirements.txt .

# Install dependencies
pip3 install -r requirements.txt -t . --quiet

# Zip it up
zip -r /tmp/cvrp-deployment.zip . -x "*.pyc" -x "__pycache__/*" -x "*.dist-info/*" -q

echo "⬆️  Uploading to Lambda..."
aws lambda update-function-code \
  --function-name $LAMBDA_NAME \
  --region $AWS_REGION \
  --zip-file fileb:///tmp/cvrp-deployment.zip

echo "✅ Deployment complete!"
echo ""
echo "Lambda URL:"
aws lambda get-function-url-config \
  --function-name $LAMBDA_NAME \
  --region $AWS_REGION \
  --query FunctionUrl \
  --output text

# Cleanup
cd /
rm -rf /tmp/cvrp-lambda /tmp/cvrp-deployment.zip
