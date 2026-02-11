import { ECRClient, CreateRepositoryCommand, GetAuthorizationTokenCommand } from '@aws-sdk/client-ecr';
import { LambdaClient, CreateFunctionCommand, CreateFunctionUrlConfigCommand, AddPermissionCommand } from '@aws-sdk/client-lambda';
import { IAMClient, CreateRoleCommand, AttachRolePolicyCommand, CreatePolicyCommand } from '@aws-sdk/client-iam';
import prompts from 'prompts';
import ora from 'ora';
import chalk from 'chalk';
import { execa } from 'execa';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templatesDir = path.join(__dirname, '../templates');

export async function deploy({ dryRun = false }) {
  
  // ============================================
  // STEP 1: Get AWS Account Info
  // ============================================
  
  const spinner = ora('Detecting AWS account...').start();
  
  let accountId, region;
  try {
    const { stdout: stsOut } = await execa('aws', ['sts', 'get-caller-identity', '--query', 'Account', '--output', 'text']);
    accountId = stsOut.trim();
    
    const { stdout: regionOut } = await execa('aws', ['configure', 'get', 'region']);
    region = regionOut.trim() || 'us-east-2';
    
    spinner.succeed(`AWS Account: ${accountId} | Region: ${region}`);
  } catch (err) {
    spinner.fail('AWS CLI not configured');
    throw new Error('Run: aws configure');
  }
  
  // ============================================
  // STEP 2: Get config (defaults for dry run, prompts for real deploy)
  // ============================================
  
  let answers;
  if (dryRun) {
    answers = {
      functionName: 'flyr-slice-lambda',
      bucketName: 'flyr-pro-addresses-2025',
      memorySize: 2048,
      timeout: 30
    };
    console.log(chalk.cyan('\n🔍 DRY RUN - Using defaults:\n'));
    console.log(answers);
  } else if (process.env.KIMI_FUNCTION_NAME || process.env.KIMI_BUCKET || process.env.KIMI_BUCKET_NAME) {
    // Non-interactive mode via environment variables
    answers = {
      functionName: process.env.KIMI_FUNCTION_NAME || 'flyr-slice-lambda',
      bucketName: process.env.KIMI_BUCKET || process.env.KIMI_BUCKET_NAME || 'flyr-pro-addresses-2025',
      memorySize: parseInt(process.env.KIMI_MEMORY || process.env.KIMI_MEMORY_SIZE) || 2048,
      timeout: parseInt(process.env.KIMI_TIMEOUT) || 30
    };
    console.log(chalk.cyan('\n⚙️  Using environment variables:\n'));
    console.log(answers);
  } else {
    answers = await prompts([
      {
        type: 'text',
        name: 'functionName',
        message: 'Lambda function name?',
        initial: 'flyr-slice-lambda'
      },
      {
        type: 'text',
        name: 'bucketName',
        message: 'S3 bucket with Parquet data?',
        initial: 'flyr-pro-addresses-2025'
      },
      {
        type: 'number',
        name: 'memorySize',
        message: 'Lambda memory (MB)?',
        initial: 2048,
        min: 512,
        max: 10240
      },
      {
        type: 'number',
        name: 'timeout',
        message: 'Lambda timeout (seconds)?',
        initial: 30,
        min: 3,
        max: 900
      }
    ]);
  }

  const { functionName, bucketName, memorySize, timeout } = answers;
  const repoName = functionName;
  const imageUri = `${accountId}.dkr.ecr.${region}.amazonaws.com/${repoName}:latest`;
  const sharedSecret = crypto.randomBytes(32).toString('hex');

  if (dryRun) {
    console.log(chalk.yellow('\n🔍 DRY RUN - Would deploy:\n'));
    console.log({ functionName, bucketName, memorySize, timeout, imageUri });
    return;
  }
  
  // ============================================
  // STEP 3: Create ECR repository
  // ============================================
  
  const ecrClient = new ECRClient({ region });
  
  spinner.start('Creating ECR repository...');
  try {
    await ecrClient.send(new CreateRepositoryCommand({ repositoryName: repoName }));
    spinner.succeed(`ECR repo created: ${repoName}`);
  } catch (err) {
    if (err.name === 'RepositoryAlreadyExistsException') {
      spinner.info(`ECR repo already exists: ${repoName}`);
    } else {
      spinner.fail('Failed to create ECR repo');
      throw err;
    }
  }
  
  // ============================================
  // STEP 4: Docker login to ECR
  // ============================================
  
  spinner.start('Logging into ECR...');
  const { authorizationData } = await ecrClient.send(new GetAuthorizationTokenCommand({}));
  const authToken = Buffer.from(authorizationData[0].authorizationToken, 'base64').toString('utf-8');
  const [username, password] = authToken.split(':');
  
  await execa('docker', ['login', '--username', username, '--password-stdin', authorizationData[0].proxyEndpoint], {
    input: password
  });
  spinner.succeed('Logged into ECR');
  
  // ============================================
  // STEP 5: Copy templates to temp dir & build
  // ============================================
  
  const tempDir = path.join(process.cwd(), '.kimi-build');
  await fs.mkdir(tempDir, { recursive: true });
  
  spinner.start('Copying Lambda template...');
  await fs.cp(path.join(templatesDir, 'lambda'), tempDir, { recursive: true });
  spinner.succeed('Lambda template ready');
  
  spinner.start('Building Docker image...');
  await execa('docker', ['build', '-t', repoName, '.'], { cwd: tempDir, stdio: 'inherit' });
  spinner.succeed('Docker image built');
  
  spinner.start('Tagging image...');
  await execa('docker', ['tag', `${repoName}:latest`, imageUri]);
  spinner.succeed(`Tagged: ${imageUri}`);
  
  spinner.start('Pushing to ECR...');
  await execa('docker', ['push', imageUri], { stdio: 'inherit' });
  spinner.succeed('Image pushed to ECR');
  
  // Cleanup
  await fs.rm(tempDir, { recursive: true, force: true });
  
  // ============================================
  // STEP 6: Create IAM role for Lambda
  // ============================================
  
  const iamClient = new IAMClient({ region });
  const roleName = `${functionName}-role`;
  
  spinner.start('Creating IAM role...');
  
  let roleArn;
  try {
    const trustPolicy = {
      Version: '2012-10-17',
      Statement: [{
        Effect: 'Allow',
        Principal: { Service: 'lambda.amazonaws.com' },
        Action: 'sts:AssumeRole'
      }]
    };
    
    const { Role } = await iamClient.send(new CreateRoleCommand({
      RoleName: roleName,
      AssumeRolePolicyDocument: JSON.stringify(trustPolicy)
    }));
    roleArn = Role.Arn;
    
    // Attach basic Lambda execution policy
    await iamClient.send(new AttachRolePolicyCommand({
      RoleName: roleName,
      PolicyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'
    }));
    
    // Create S3 read policy
    const s3Policy = {
      Version: '2012-10-17',
      Statement: [{
        Effect: 'Allow',
        Action: ['s3:GetObject', 's3:ListBucket'],
        Resource: [
          `arn:aws:s3:::${bucketName}`,
          `arn:aws:s3:::${bucketName}/*`
        ]
      }]
    };
    
    const { Policy } = await iamClient.send(new CreatePolicyCommand({
      PolicyName: `${functionName}-s3-read`,
      PolicyDocument: JSON.stringify(s3Policy)
    }));
    
    await iamClient.send(new AttachRolePolicyCommand({
      RoleName: roleName,
      PolicyArn: Policy.Arn
    }));
    
    spinner.succeed(`IAM role created: ${roleName}`);
    
    // Wait for IAM propagation
    spinner.start('Waiting for IAM propagation (10s)...');
    await new Promise(resolve => setTimeout(resolve, 10000));
    spinner.succeed('IAM ready');
    
  } catch (err) {
    if (err.name === 'EntityAlreadyExistsException') {
      roleArn = `arn:aws:iam::${accountId}:role/${roleName}`;
      spinner.info(`IAM role already exists: ${roleName}`);
    } else {
      spinner.fail('Failed to create IAM role');
      throw err;
    }
  }
  
  // ============================================
  // STEP 7: Create Lambda function
  // ============================================
  
  const lambdaClient = new LambdaClient({ region });
  
  spinner.start('Creating Lambda function...');
  
  let functionArn;
  try {
    const { FunctionArn } = await lambdaClient.send(new CreateFunctionCommand({
      FunctionName: functionName,
      Role: roleArn,
      Code: { ImageUri: imageUri },
      PackageType: 'Image',
      MemorySize: memorySize,
      Timeout: timeout,
      Environment: {
        Variables: {
          AWS_REGION: region,
          SLICE_SHARED_SECRET: sharedSecret
        }
      }
    }));
    functionArn = FunctionArn;
    spinner.succeed(`Lambda created: ${functionName}`);
  } catch (err) {
    spinner.fail('Failed to create Lambda');
    throw err;
  }
  
  // ============================================
  // STEP 8: Create Function URL
  // ============================================
  
  spinner.start('Creating Function URL...');
  
  const { FunctionUrl } = await lambdaClient.send(new CreateFunctionUrlConfigCommand({
    FunctionName: functionName,
    AuthType: 'NONE'
  }));
  
  // Add public invoke permission
  await lambdaClient.send(new AddPermissionCommand({
    FunctionName: functionName,
    StatementId: 'FunctionURLAllowPublicAccess',
    Action: 'lambda:InvokeFunctionUrl',
    Principal: '*',
    FunctionUrlAuthType: 'NONE'
  }));
  
  spinner.succeed(`Function URL: ${FunctionUrl}`);
  
  // ============================================
  // STEP 9: Output Vercel env vars
  // ============================================
  
  console.log(chalk.bold.green('\n📋 Add these to Vercel:\n'));
  console.log(chalk.cyan('SLICE_LAMBDA_URL') + '=' + FunctionUrl);
  console.log(chalk.cyan('SLICE_SHARED_SECRET') + '=' + sharedSecret);
  
  console.log(chalk.bold.yellow('\n📝 Next steps:\n'));
  console.log('1. Copy env vars to Vercel dashboard');
  console.log('2. Add API route: app/api/slice/route.ts');
  console.log('3. Test with: curl -X POST https://your-domain.com/api/slice');
  
  // ============================================
  // STEP 10: Save Vercel route template
  // ============================================
  
  const routeTemplate = await fs.readFile(path.join(templatesDir, 'vercel/route.ts.template'), 'utf-8');
  const routePath = path.join(process.cwd(), 'app/api/slice/route.ts');
  
  await fs.mkdir(path.dirname(routePath), { recursive: true });
  await fs.writeFile(routePath, routeTemplate);
  
  console.log(chalk.green(`\n✅ Created: ${routePath}`));
}
