# IAM & credentials for KIMI deploy

KIMI creates Lambda, ECR, and IAM resources. The **default** AWS CLI identity must have **admin-level** (or equivalent) permissions. Read-only credentials (e.g. `flyr-motherduck-reader`) are not enough.

---

## Solution 1: Use admin credentials (fastest)

```bash
aws configure
# Enter admin Access Key ID and Secret. Region: us-east-2, output: json

aws sts get-caller-identity
# Should show an admin user, not flyr-motherduck-reader

cd kimi-cli
KIMI_FUNCTION_NAME=flyr-slice-lambda \
KIMI_BUCKET=flyr-pro-addresses-2025 \
KIMI_MEMORY=2048 \
KIMI_TIMEOUT=30 \
node bin/kimi.js
```

---

## Solution 2: Use AWS profiles (keep both credentials)

Keep your default profile as read-only; use a separate profile for deploy:

```bash
# ~/.aws/credentials example:
# [default]
# aws_access_key_id = flyr-motherduck-reader-key
# aws_secret_access_key = ...

# [admin]
# aws_access_key_id = YOUR_ADMIN_KEY
# aws_secret_access_key = YOUR_ADMIN_SECRET
```

Deploy with the admin profile:

```bash
AWS_PROFILE=admin \
KIMI_FUNCTION_NAME=flyr-slice-lambda \
KIMI_BUCKET=flyr-pro-addresses-2025 \
KIMI_MEMORY=2048 \
KIMI_TIMEOUT=30 \
node bin/kimi.js
```

---

## Solution 3: Grant permissions to flyr-motherduck-reader

If you have AWS Console admin access, attach to the `flyr-motherduck-reader` user:

- **AWSLambda_FullAccess**
- **AmazonEC2ContainerRegistryFullAccess**
- **IAMFullAccess** (or a custom policy)

**Custom policy (more secure):**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecr:CreateRepository",
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:PutImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "iam:CreateRole",
        "iam:AttachRolePolicy",
        "iam:CreatePolicy",
        "iam:PassRole",
        "iam:GetRole"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "lambda:CreateFunction",
        "lambda:CreateFunctionUrlConfig",
        "lambda:AddPermission",
        "lambda:GetFunction",
        "lambda:UpdateFunctionConfiguration"
      ],
      "Resource": "*"
    }
  ]
}
```

---

## Solution 4: Manual setup in AWS Console

If you cannot use admin credentials or change IAM:

1. **ECR** – Create repository `flyr-slice-lambda`.
2. **IAM** – Create role `flyr-slice-lambda-role` (trust Lambda), attach `AWSLambdaBasicExecutionRole` and an inline S3 read policy for `flyr-pro-addresses-2025`.
3. **Docker** – Build, tag, and push the Lambda image to the ECR repo (use `aws ecr get-login-password` and the repo URI).
4. **Lambda** – Create function from that image, use the role above, memory 2048, timeout 30, env `AWS_REGION`, `SLICE_SHARED_SECRET` (e.g. `openssl rand -hex 32`).
5. **Function URL** – Create URL with auth NONE, copy URL.
6. **Vercel** – Set `SLICE_LAMBDA_URL` and `SLICE_SHARED_SECRET`.

---

## Environment variables (non-interactive deploy)

When these are set, KIMI skips prompts:

| Variable              | Example                    |
|-----------------------|----------------------------|
| `KIMI_FUNCTION_NAME`  | `flyr-slice-lambda`        |
| `KIMI_BUCKET` or `KIMI_BUCKET_NAME` | `flyr-pro-addresses-2025` |
| `KIMI_MEMORY` or `KIMI_MEMORY_SIZE` | `2048`              |
| `KIMI_TIMEOUT`        | `30`                       |

Use with **Solution 1** or **2** (e.g. `AWS_PROFILE=admin` + env vars).

---

## Security

- Do **not** commit `~/.aws/credentials` or `~/.aws/config`.
- Ensure `.gitignore` (or global gitignore) excludes them if they are ever in a project directory.
