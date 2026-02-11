#!/usr/bin/env node

import { deploy } from '../src/deploy.js';
import chalk from 'chalk';

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');

console.log(chalk.bold.cyan(`
╔═══════════════════════════════════╗
║   KIMI - Keep It Moving, Idiot    ║
║   Lambda Slice Engine Deployer    ║
╚═══════════════════════════════════╝
`));

deploy({ dryRun: isDryRun })
  .then(() => {
    console.log(chalk.green.bold('\n✅ Deployment complete!\n'));
    process.exit(0);
  })
  .catch((err) => {
    console.error(chalk.red.bold('\n❌ Deployment failed:'), err.message);
    console.error(chalk.gray(err.stack));
    process.exit(1);
  });
