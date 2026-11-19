import postgres from 'postgres';
import { usernameEmail, usernamePattern } from '../_shared/credentials.js';
import { WalletError } from '../_shared/model.js';
import { deploymentOrigins } from './deployment.js';
import { walletHandler } from './ledger.js';
import { registrationHandler } from './registration.js';

function required(name) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

const supabaseUrl = required('SUPABASE_URL');
const url = new URL('/auth/v1/user', supabaseUrl);
const adminUrl = new URL('/auth/v1/admin/users', supabaseUrl);
const publishableKeys = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') ?? '{}');
const apiKey = publishableKeys.default ?? required('SUPABASE_ANON_KEY');
const secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
const adminKey = secretKeys.default ?? required('SUPABASE_SERVICE_ROLE_KEY');
const adminHeaders = { apikey: adminKey, 'Content-Type': 'application/json' };
if (!adminKey.startsWith('sb_secret_')) adminHeaders.Authorization = 'Bearer ' + adminKey;

const configuredOrigins = Deno.env.get('WALLET_ALLOWED_ORIGINS') || deploymentOrigins;
if (!configuredOrigins.trim()) throw new Error('Missing Wallet origins');
const origins = new Set(configuredOrigins.split(',').map(value => new URL(value.trim()).origin));
const db = postgres(Deno.env.get('WALLET_DATABASE_URL') || required('SUPABASE_DB_URL'), {
  max: 1, prepare: false, idle_timeout: 20, connect_timeout: 10,
});

async function authenticate(request) {
  const authorization = request.headers.get('authorization');
  if (!authorization || !/^Bearer \S+$/i.test(authorization)) return null;
  const response = await fetch(url, { headers: { apikey: apiKey, Authorization: authorization } });
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw new WalletError('暂时无法验证登录状态，请稍后重试。', 503);
  const user = await response.json();
  const name = user.app_metadata?.wallet_username;
  if (user.aud !== 'authenticated' || user.is_anonymous || !user.email_confirmed_at || !user.id ||
      typeof name !== 'string' || !usernamePattern.test(name) || user.email !== usernameEmail(name)) return null;
  return { id: user.id, name };
}

Deno.serve(walletHandler(db, authenticate, origins, registrationHandler(db, adminUrl, adminHeaders)));
