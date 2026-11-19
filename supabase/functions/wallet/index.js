import postgres from 'postgres';
import { WalletError } from '../_shared/model.js';
import { walletHandler } from './ledger.js';

function required(name) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

const url = new URL('/auth/v1/user', required('SUPABASE_URL'));
const publishableKeys = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') ?? '{}');
const apiKey = publishableKeys.default ?? required('SUPABASE_ANON_KEY');
const origins = new Set(required('WALLET_ALLOWED_ORIGINS').split(',').map(value => new URL(value.trim()).origin));
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
  if (user.aud !== 'authenticated' || user.is_anonymous || !user.email_confirmed_at || !user.id) return null;
  const name = Array.from(user.email?.split('@')[0]?.trim() || '账本成员').slice(0, 40).join('');
  return { id: user.id, name };
}

Deno.serve(walletHandler(db, authenticate, origins));
