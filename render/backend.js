import { createClient } from '@supabase/supabase-js';

const url = WALLET_SUPABASE_URL;
const key = WALLET_SUPABASE_PUBLISHABLE_KEY;
const { auth } = createClient(url, key, { auth: { detectSessionInUrl: false } });

export const emailAuth = {
  async sendCode(email) {
    const { error } = await auth.signInWithOtp({ email });
    if (error?.status === 429) throw new Error('发送过于频繁，请稍后再试。');
    if (error) throw new Error('暂时无法发送验证码，请检查邮箱地址或稍后重试。');
  },
  async verifyCode(email, token) {
    const { error } = await auth.verifyOtp({ email, token, type: 'email' });
    if (error?.code === 'otp_expired' || error?.status === 403) throw new Error('验证码无效或已过期，请重新获取。');
    if (error) throw new Error('暂时无法验证邮箱，请稍后重试。');
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

export async function api(path, data) {
  const { data: { session }, error } = await auth.getSession();
  if (error && (!error.status || error.status >= 500)) throw new Error('暂时无法验证登录状态。');
  if (!session) {
    if (path === 'session') return { user: null };
    throw apiError('请先登录 Wallet。', 401);
  }

  const headers = { apikey: key, Authorization: 'Bearer ' + session.access_token };
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
