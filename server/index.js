import { blankLedger, confirmLedgerDeletion, label, mutate, roles, WalletError } from './model.js';
import { assets } from './assets.js';

const security = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...security, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function visitor(request) {
  const id = request.headers.get('oai-authenticated-user-id');
  if (!id) return null;
  const email = request.headers.get('oai-authenticated-user-email') ?? '';
  let name = request.headers.get('oai-authenticated-user-full-name') ?? '';
  if (request.headers.get('oai-authenticated-user-full-name-encoding') === 'percent-encoded-utf-8') {
    try { name = decodeURIComponent(name); } catch { name = ''; }
  }
  return { id, name: (name.trim() || email.split('@')[0] || '账本成员').slice(0, 40) };
}

async function payload(request) {
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') throw new WalletError('请求格式不正确。', 415);
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) throw new WalletError('请在 Wallet 页面内完成操作。', 403);
  if (request.headers.get('sec-fetch-site') === 'cross-site') throw new WalletError('请在 Wallet 页面内完成操作。', 403);
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > 24576) throw new WalletError('请求数据过多。', 413);
  let data;
  try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new WalletError('请求格式不正确。'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new WalletError('请求格式不正确。');
  return data;
}

async function hash(code) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

function membersFor(db, id) {
  return db.prepare('SELECT user_id AS id, name, role, active FROM wallet_members WHERE ledger_id = ? ORDER BY joined_at, user_id').bind(id).all();
}

function readLedger(db, id, userId) {
  return db.prepare(
    'SELECT l.id, l.document, l.version, member.role FROM wallet_ledgers l JOIN wallet_members member ON member.ledger_id = l.id WHERE l.id = ? AND member.user_id = ? AND member.active = 1',
  ).bind(id, userId).first();
}

function manager(role) {
  return role === 'owner' || role === 'admin';
}

const updateGuard = 'EXISTS (SELECT 1 FROM wallet_members m WHERE m.ledger_id = wallet_ledgers.id AND m.user_id = ? AND m.role = ? AND m.active = 1)';

async function api(request, env, url) {
  const user = visitor(request);
  const { pathname } = url;
  const { method } = request;
  if (pathname === '/api/session' && method === 'GET') return json({ user });
  if (!user) throw new WalletError('请先使用 ChatGPT 登录。', 401);
  const db = env.DB;
  if (!db) throw new WalletError('账本服务正在准备中，请稍后重试。', 503);

  if (pathname === '/api/ledgers' && method === 'GET') {
    const { results } = await db.prepare(
      "SELECT l.id, json_extract(l.document, '$.name') AS name, json_extract(l.document, '$.kind') AS kind, m.role FROM wallet_members m JOIN wallet_ledgers l ON l.id = m.ledger_id WHERE m.user_id = ? AND m.active = 1 ORDER BY m.joined_at DESC",
    ).bind(user.id).all();
    return json({ ledgers: results });
  }

  if (pathname === '/api/ledgers' && method === 'POST') {
    const data = await payload(request);
    const document = blankLedger(data.name, data.kind);
    const name = data.displayName ? label(data.displayName, 40, '昵称需要 1 至 40 个字符。') : user.name;
    const id = crypto.randomUUID();
    document.audit.push({ id: crypto.randomUUID(), actor: user.id, time: Date.now(), description: '创建了账本' });
    await db.batch([
      db.prepare('INSERT INTO wallet_ledgers(id, document) VALUES (?, ?)').bind(id, JSON.stringify(document)),
      db.prepare("INSERT INTO wallet_members(ledger_id, user_id, name, role, joined_at) VALUES (?, ?, ?, 'owner', ?)").bind(id, user.id, name, Date.now()),
    ]);
    return json({ id }, 201);
  }

  if (pathname === '/api/join' && method === 'POST') {
    const data = await payload(request);
    const code = label(data.code, 45, '请输入有效的邀请码。').toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(code)) throw new WalletError('请输入有效的邀请码。');
    const name = data.displayName ? label(data.displayName, 40, '昵称需要 1 至 40 个字符。') : user.name;
    const digest = await hash(code);
    const now = Date.now();
    const result = await db.prepare(
      "INSERT INTO wallet_members(ledger_id, user_id, name, role, joined_at) SELECT l.id, ?, ?, 'member', ? FROM wallet_ledgers l WHERE l.invite_hash = ? AND l.invite_until > ? AND (SELECT count(*) FROM wallet_members m WHERE m.ledger_id = l.id) < 60 ON CONFLICT(ledger_id, user_id) DO NOTHING RETURNING ledger_id",
    ).bind(user.id, name, now, digest, now).first();
    if (result) return json({ id: result.ledger_id });
    const already = await db.prepare(
      'SELECT l.id FROM wallet_ledgers l JOIN wallet_members m ON m.ledger_id = l.id WHERE l.invite_hash = ? AND l.invite_until > ? AND m.user_id = ? AND m.active = 1',
    ).bind(digest, now, user.id).first();
    if (already) return json({ id: already.id });
    throw new WalletError('邀请码已失效、账本已满，或你的成员权限已被移除。', 404);
  }

  const match = pathname.match(/^\/api\/ledgers\/([0-9a-f-]{36})(?:\/(actions|invite|members|delete))?$/);
  if (!match) throw new WalletError('页面不存在。', 404);
  const [, id, endpoint] = match;
  const row = await readLedger(db, id, user.id);
  if (!row) throw new WalletError('你没有访问该账本的权限。', 404);

  if (!endpoint && method === 'GET') {
    const { results: members } = await membersFor(db, id);
    return json({ id, version: row.version, state: JSON.parse(row.document), members });
  }

  if (endpoint === 'delete' && method === 'POST') {
    const confirmation = await payload(request);
    confirmLedgerDeletion(row.role, JSON.parse(row.document).name, row.version, confirmation);
    // Defer the foreign key check until the authorized parent and its members are both removed.
    const [, removed] = await db.batch([
      db.prepare('PRAGMA defer_foreign_keys = ON'),
      db.prepare('DELETE FROM wallet_ledgers WHERE id = ? AND version = ? AND ' + updateGuard)
        .bind(id, row.version, user.id, 'owner'),
      db.prepare('DELETE FROM wallet_members WHERE ledger_id = ? AND NOT EXISTS (SELECT 1 FROM wallet_ledgers WHERE id = ?)')
        .bind(id, id),
    ]);
    if (removed.meta.changes !== 1) throw new WalletError('账本刚刚更新，请重新确认删除。', 409);
    return json({ deleted: true });
  }

  if (endpoint === 'invite' && method === 'POST') {
    const data = await payload(request);
    if (!manager(row.role) || JSON.parse(row.document).kind !== 'shared') throw new WalletError('只有共享账本管理员可以管理邀请。', 403);
    const active = data.revoke !== true;
    const code = active ? crypto.randomUUID().replaceAll('-', '') : null;
    const expires = active ? Date.now() + 7 * 86400000 : null;
    const digest = active ? await hash(code) : null;
    const changed = await db.prepare(
      'UPDATE wallet_ledgers SET invite_hash = ?, invite_until = ? WHERE id = ? AND ' + updateGuard,
    ).bind(digest, expires, id, user.id, row.role).run();
    if (changed.meta.changes !== 1) throw new WalletError('成员权限已变化，请刷新后再试。', 409);
    return json({ code, expires });
  }

  if (endpoint === 'members' && method === 'POST') {
    const data = await payload(request);
    if (row.role !== 'owner') throw new WalletError('只有账本创建者可以修改成员权限。', 403);
    if (data.id === user.id || typeof data.id !== 'string' || !Object.hasOwn(roles, data.role) || data.role === 'owner' || typeof data.active !== 'boolean') {
      throw new WalletError('请选择有效的成员权限。');
    }
    const state = JSON.parse(row.document);
    const { results: members } = await membersFor(db, id);
    const target = members.find(member => member.id === data.id);
    if (!target) throw new WalletError('成员不存在。', 404);
    state.audit.unshift({ id: crypto.randomUUID(), actor: user.id, time: Date.now(), description: (data.active ? '更新了成员权限 · ' : '移除了成员 · ') + target.name });
    state.audit = state.audit.slice(0, 100);
    const next = row.version + 1;
    const [changed] = await db.batch([
      db.prepare('UPDATE wallet_ledgers SET document = ?, version = ? WHERE id = ? AND version = ?').bind(JSON.stringify(state), next, id, row.version),
      db.prepare('UPDATE wallet_members SET role = ?, active = ? WHERE ledger_id = ? AND user_id = ? AND EXISTS (SELECT 1 FROM wallet_ledgers WHERE id = ? AND version = ? AND document = ?)').bind(data.role, Number(data.active), id, data.id, id, next, JSON.stringify(state)),
    ]);
    if (changed.meta.changes !== 1) throw new WalletError('账本刚刚更新，请刷新后重试。', 409);
    return json({ version: next });
  }

  if (endpoint === 'actions' && method === 'POST') {
    const { action, version } = await payload(request);
    if (!action || typeof action !== 'object' || Array.isArray(action)) throw new WalletError('请求格式不正确。');
    if (version !== row.version) throw new WalletError('账本刚刚更新，请刷新后重试。', 409);
    const { results: members } = await membersFor(db, id);
    const state = JSON.parse(row.document);
    mutate(state, action, members, user.id);
    const changed = await db.prepare(
      'UPDATE wallet_ledgers SET document = ?, version = version + 1 WHERE id = ? AND version = ? AND ' + updateGuard,
    ).bind(JSON.stringify(state), id, version, user.id, row.role).run();
    if (changed.meta.changes !== 1) throw new WalletError('账本刚刚更新，请刷新后重试。', 409);
    return json({ id, version: version + 1, state, members });
  }

  throw new WalletError('操作不存在。', 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await api(request, env, url);
      } catch (error) {
        if (error instanceof WalletError) return json({ error: error.message }, error.status);
        console.error('Wallet API error', error?.message ?? 'unknown error');
        return json({ error: '账本服务暂时不可用，请稍后重试。' }, 500);
      }
    }
    if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 });
    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    const asset = Object.hasOwn(assets, path) ? assets[path] : null;
    if (!asset) return new Response('页面不存在。', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    return new Response(request.method === 'HEAD' ? null : asset.body, {
      headers: { ...security, 'Content-Type': asset.type, 'Cache-Control': 'no-cache' },
    });
  },
};
