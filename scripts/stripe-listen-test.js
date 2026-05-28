const { spawn } = require('node:child_process');
const dotenv = require('dotenv');

dotenv.config({ path: '.env.local', override: true });

if (process.argv.includes('--help')) {
  console.log('Usage: npm run stripe:listen:test');
  console.log('Forwards Stripe test-mode webhook events to localhost:3000.');
  process.exit(0);
}

const mode = (process.env.STRIPE_MODE || 'test').trim().toLowerCase();
const apiKey =
  process.env.STRIPE_SECRET_KEY_TEST ||
  (mode === 'test' ? process.env.STRIPE_SECRET_KEY : '');

if (mode !== 'test') {
  console.error('Refusing to start test listener because STRIPE_MODE is not "test".');
  process.exit(1);
}

if (!apiKey || !apiKey.startsWith('sk_test_')) {
  console.error('STRIPE_SECRET_KEY_TEST must be set to a sk_test_ key in .env.local.');
  process.exit(1);
}

const forwardTo =
  process.env.STRIPE_WEBHOOK_FORWARD_TO ||
  'localhost:3000/api/billing/stripe/webhook';

const events = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'account.updated',
].join(',');

console.log(`Starting Stripe test webhook listener -> ${forwardTo}`);
console.log('If Stripe prints a new whsec_, put it in STRIPE_WEBHOOK_SECRET_TEST and restart npm run dev.');

const child = spawn(
  'stripe',
  ['listen', '--api-key', apiKey, '--events', events, '--forward-to', forwardTo],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      STRIPE_API_KEY: apiKey,
    },
  }
);

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
