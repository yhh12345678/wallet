import { registrationError, usernameEmail } from '../_shared/credentials.js';
import { WalletError } from '../_shared/model.js';

const windowMs = 15 * 60 * 1000;

async function consumeAttempt(sql, bucket, start, limit) {
  const [accepted] = await sql`insert into wallet.registration_limits as previous (bucket, window_start, attempts)
    values (${bucket}, ${start}, 1)
    on conflict (bucket) do update set
      window_start = excluded.window_start,
      attempts = case when previous.window_start < excluded.window_start then 1 else previous.attempts + 1 end
    where previous.window_start < excluded.window_start or previous.attempts < ${limit}
    returning attempts`;
  if (!accepted) throw new WalletError('注册尝试过于频繁，请稍后再试。', 429);
}

export function registrationHandler(db, adminUrl, adminHeaders) {
  return async (data, request) => {
    const username = typeof data.username === 'string' ? data.username.trim() : '';
    const password = typeof data.password === 'string' ? data.password : '';
    const invalid = registrationError(username, password);
    if (invalid) throw new WalletError(invalid);

    const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
    const ip = request.headers.get('cf-connecting-ip');
    const source = ip && /^[0-9a-f:.]{3,45}$/i.test(ip) ? ip : '';
    await db.begin(async sql => {
      await consumeAttempt(sql, 'project', windowStart, 100);
      if (source) await consumeAttempt(sql, source, windowStart, 5);
      await sql`delete from wallet.registration_limits where window_start < ${windowStart - windowMs}`;
    });

    const response = await fetch(adminUrl, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        email: usernameEmail(username),
        password,
        email_confirm: true,
        app_metadata: { wallet_username: username },
      }),
    });
    if (response.ok) return { username };

    const details = await response.json().catch(() => ({}));
    const code = details?.error_code;
    if (['email_exists', 'user_already_exists'].includes(code)) {
      throw new WalletError('这个用户名已被使用，请换一个试试。', 409);
    }
    if (code === 'weak_password') throw new WalletError('该密码强度不足，请换一个更复杂的密码。');
    if (response.status === 429) throw new WalletError('注册尝试过于频繁，请稍后再试。', 429);
    console.error('Wallet Auth registration failed', response.status, code ?? 'unknown');
    throw new WalletError('暂时无法注册，请稍后重试。', 503);
  };
}
