import { createClient } from '@supabase/supabase-js';
import { registrationError, usernameEmail, usernamePattern } from '../supabase/functions/_shared/credentials.js';

const url = WALLET_SUPABASE_URL;
const key = WALLET_SUPABASE_PUBLISHABLE_KEY;
const { auth } = createClient(url, key, { auth: { detectSessionInUrl: false } });

export const accountAuth = {
  async signIn(username, password) {
    if (!usernamePattern.test(username)) throw new Error('用户名或密码不正确。');
    const { error } = await auth.signInWithPassword({ email: usernameEmail(username), password });
    if (error?.status === 429) throw new Error('登录尝试过于频繁，请稍后再试。');
    if (error?.status === 400 || error?.status === 401 || error?.status === 403) {
      throw new Error('用户名或密码不正确。');
    }
    if (error) throw new Error('暂时无法登录，请稍后重试。');
  },
  async register(username, password) {
    const invalid = registrationError(username, password);
    if (invalid) throw new Error(invalid);
    await walletRequest('register', { username, password });
  },
  async signOut() {
    const { error } = await auth.signOut({ scope: 'local' });
    if (error) throw new Error('暂时无法退出登录，请稍后重试。');
  },
  onSignOut(listener) {
    auth.onAuthStateChange(event => {
      if (event === 'SIGNED_OUT') listener();
    });
  },
};

function apiError(message, status) {
  return Object.assign(new Error(message), { status });
}

async function walletRequest(path, data, token) {
  const headers = { apikey: key };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (data !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(url + '/functions/v1/wallet/' + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers,
    body: data === undefined ? undefined : JSON.stringify(data),
  }).catch(() => { throw new Error('无法连接到账本服务。'); });
  if (path === 'session' && response.status === 401) return { user: null };

  let result;
  try { result = await response.json(); } catch { throw new Error('账本服务返回了无效响应。'); }
  if (!response.ok) {
    const message = typeof result.error === 'string' ? result.error : '操作失败，请稍后重试。';
    throw apiError(message, response.status);
  }
  return result;
}

export async function api(path, data) {
  const { data: { session }, error } = await auth.getSession();
  if (error && (!error.status || error.status >= 500)) throw new Error('暂时无法验证登录状态。');
  if (session) return walletRequest(path, data, session.access_token);
  if (path === 'session') return { user: null };
  throw apiError('请先登录 Wallet。', 401);
}
