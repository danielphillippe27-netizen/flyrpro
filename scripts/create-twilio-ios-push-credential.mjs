#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import twilio from 'twilio';

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname, '..');
const envPath = path.join(repoRoot, '.env.local');

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, '');
  }
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function readPem({ valueEnv, pathEnv, label }) {
  const inline = process.env[valueEnv]?.trim();
  if (inline) return inline.replace(/\\n/g, '\n');

  const filePath = process.env[pathEnv]?.trim();
  if (!filePath) {
    throw new Error(`${label} is required. Set ${valueEnv} or ${pathEnv}.`);
  }

  return fs.readFileSync(path.resolve(filePath), 'utf8').trim();
}

function parseBoolean(value, fallback) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'sandbox', 'development'].includes(value.toLowerCase());
}

function updateEnvLocal(sid) {
  const nextLine = `TWILIO_IOS_PUSH_CREDENTIAL_SID="${sid}"`;
  const current = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const next = current.match(/^TWILIO_IOS_PUSH_CREDENTIAL_SID=.*$/m)
    ? current.replace(/^TWILIO_IOS_PUSH_CREDENTIAL_SID=.*$/m, nextLine)
    : `${current.trimEnd()}\n${nextLine}\n`;
  fs.writeFileSync(envPath, next);
}

loadDotEnv(envPath);

const accountSid = requiredEnv('TWILIO_ACCOUNT_SID');
const authToken = requiredEnv('TWILIO_AUTH_TOKEN');
const certificate = readPem({
  valueEnv: 'TWILIO_IOS_VOIP_CERTIFICATE',
  pathEnv: 'TWILIO_IOS_VOIP_CERTIFICATE_PATH',
  label: 'Apple VoIP certificate PEM',
});
const privateKey = readPem({
  valueEnv: 'TWILIO_IOS_VOIP_PRIVATE_KEY',
  pathEnv: 'TWILIO_IOS_VOIP_PRIVATE_KEY_PATH',
  label: 'Apple VoIP private key PEM',
});

if (!certificate.includes('BEGIN CERTIFICATE')) {
  throw new Error('The certificate must be PEM text containing BEGIN CERTIFICATE.');
}
if (!privateKey.includes('BEGIN') || !privateKey.includes('PRIVATE KEY')) {
  throw new Error('The private key must be PEM text containing BEGIN PRIVATE KEY or BEGIN RSA PRIVATE KEY.');
}

const friendlyName = process.env.TWILIO_IOS_PUSH_CREDENTIAL_NAME?.trim() || 'FLYR iOS VoIP';
const sandbox = parseBoolean(process.env.TWILIO_IOS_PUSH_SANDBOX, true);
const writeEnv = process.argv.includes('--write-env');

const client = twilio(accountSid, authToken);
const credential = await client.notify.v1.credentials.create({
  type: 'apn',
  friendlyName,
  certificate,
  privateKey,
  sandbox,
});

if (writeEnv) {
  updateEnvLocal(credential.sid);
}

console.log(`Created Twilio APN Push Credential: ${credential.sid}`);
console.log(`Sandbox: ${credential.sandbox}`);
console.log(writeEnv ? `Updated ${envPath}` : 'Set TWILIO_IOS_PUSH_CREDENTIAL_SID to this SID in your deployed web environment.');
