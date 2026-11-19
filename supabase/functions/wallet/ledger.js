import { blankLedger, label, mutate, roles, WalletError } from '../_shared/model.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function displayName(data, user) {
  return data.displayName ? label(data.displayName, 40, '昵称需要 1 至 40 个字符。') : user.name;
}

async function digest(code) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function payload(request) {
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') throw new WalletError('请求格式不正确。', 415);
  if (Number(request.headers.get('content-length')) > 24576) throw new WalletError('请求数据过多。', 413);
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > 24576) throw new WalletError('请求数据过多。', 413);
  let data;
  try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new WalletError('请求格式不正确。'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new WalletError('请求格式不正确。');
  return data;
}

async function createLedger(db, data, user) {
  const state = blankLedger(data.name, data.kind);
  const name = displayName(data, user);
  const id = crypto.randomUUID();
  const time = Date.now();
  state.audit.push({ id: crypto.randomUUID(), actor: user.id, time, description: '创建了账本' });
  await db.begin(async sql => {
    await sql`insert into wallet.ledgers (id, document) values (${id}, ${sql.json(state)})`;
    await sql`insert into wallet.members (ledger_id, user_id, name, role, joined_at)
              values (${id}, ${user.id}, ${name}, 'owner', ${time})`;
  });
  return { id };
}

async function joinLedger(db, data, user) {
  const code = label(data.code, 45, '请输入有效的邀请码。').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(code)) throw new WalletError('请输入有效的邀请码。');
  const name = displayName(data, user);
  const hash = await digest(code);
  return await db.begin(async sql => {
    const unavailable = () => new WalletError('邀请码已失效、账本已满，或你的成员权限已被移除。', 404);
    const [ledger] = await sql`select id, invite_until from wallet.ledgers
      where invite_hash = ${hash} and document->>'kind' = 'shared' for update`;
    if (!ledger || Number(ledger.invite_until) <= Date.now()) throw unavailable();
    const { id } = ledger;
    const [member] = await sql`select active from wallet.members where ledger_id = ${id} and user_id = ${user.id}`;
    if (member?.active) return { id };
    if (member) throw unavailable();
    const [{ size }] = await sql`select count(*)::int as size from wallet.members where ledger_id = ${id}`;
    if (size >= 60) throw unavailable();
    await sql`insert into wallet.members (ledger_id, user_id, name, role, joined_at)
              values (${id}, ${user.id}, ${name}, 'member', ${Date.now()})`;
    return { id };
  });
}

async function readLedger(db, id, userId) {
  const [ledger] = await db`select l.id, l.version, l.document as state,
    (select jsonb_agg(jsonb_build_object('id', m.user_id, 'name', m.name, 'role', m.role, 'active', m.active)
                       order by m.joined_at, m.user_id)
     from wallet.members m where m.ledger_id = l.id) as members
    from wallet.ledgers l
    where l.id = ${id} and exists (
      select 1 from wallet.members m where m.ledger_id = l.id and m.user_id = ${userId} and m.active
    )`;
  if (!ledger) throw new WalletError('你没有访问该账本的权限。', 404);
  return ledger;
}

async function writeLedger(db, id, endpoint, data, user) {
  return await db.begin(async sql => {
    // Serialize changes to the document, its membership, and its invitation.
    const [locked] = await sql`select id from wallet.ledgers where id = ${id} for update`;
    if (!locked) throw new WalletError('你没有访问该账本的权限。', 404);
    const ledger = await readLedger(sql, id, user.id);
    const { state, version, members } = ledger;
    const actor = members.find(member => member.id === user.id);

    if (endpoint === 'invite') {
      if (!['owner', 'admin'].includes(actor.role) || state.kind !== 'shared') {
        throw new WalletError('只有共享账本管理员可以管理邀请。', 403);
      }
      const code = data.revoke === true ? null : crypto.randomUUID().replaceAll('-', '');
      const expires = code ? Date.now() + 7 * 86400000 : null;
      const hash = code ? await digest(code) : null;
      await sql`update wallet.ledgers set invite_hash = ${hash}, invite_until = ${expires} where id = ${id}`;
      return { code, expires };
    }

    if (endpoint === 'members') {
      if (actor.role !== 'owner') throw new WalletError('只有账本创建者可以修改成员权限。', 403);
      if (typeof data.id !== 'string' || !uuid.test(data.id) || data.id === user.id ||
          !Object.hasOwn(roles, data.role) || data.role === 'owner' || typeof data.active !== 'boolean') {
        throw new WalletError('请选择有效的成员权限。');
      }
      const target = members.find(member => member.id === data.id);
      if (!target) throw new WalletError('成员不存在。', 404);
      state.audit.unshift({
        id: crypto.randomUUID(), actor: user.id, time: Date.now(),
        description: (data.active ? '更新了成员权限 · ' : '移除了成员 · ') + target.name,
      });
      state.audit = state.audit.slice(0, 100);
      await sql`update wallet.members set role = ${data.role}, active = ${data.active}
                where ledger_id = ${id} and user_id = ${target.id}`;
    } else {
      const { action } = data;
      if (!action || typeof action !== 'object' || Array.isArray(action)) throw new WalletError('请求格式不正确。');
      if (data.version !== version) throw new WalletError('账本刚刚更新，请刷新后重试。', 409);
      mutate(state, action, members, user.id);
    }

    await sql`update wallet.ledgers set document = ${sql.json(state)}, version = version + 1 where id = ${id}`;
    return endpoint === 'members' ? { version: version + 1 } : { ...ledger, version: version + 1 };
  });
}

export function walletHandler(db, authenticate, origins, register) {
  return async request => {
    const origin = request.headers.get('origin');
    const headers = new Headers({ 'Cache-Control': 'no-store', Vary: 'Origin' });
    const json = (body, status = 200) => Response.json(body, { status, headers });
    if (origin) {
      if (!origins.has(origin)) return json({ error: '请在 Wallet 页面内完成操作。' }, 403);
      headers.set('Access-Control-Allow-Origin', origin);
      headers.set('Access-Control-Allow-Headers', 'authorization, apikey, content-type');
      headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });

    try {
      const path = new URL(request.url).pathname.replace(/^(?:\/functions\/v1)?\/wallet(?=\/|$)/, '');
      const { method } = request;
      if (path === '/register' && method === 'POST') {
        if (!origin) throw new WalletError('请在 Wallet 页面内完成操作。', 403);
        return json(await register(await payload(request), request), 201);
      }
      const user = await authenticate(request);
      if (!user) throw new WalletError('请先登录 Wallet。', 401);
      if (path === '/session' && method === 'GET') return json({ user });
      if (path === '/ledgers' && method === 'GET') {
        const ledgers = await db`select l.id, l.document->>'name' as name, l.document->>'kind' as kind, m.role
          from wallet.members m join wallet.ledgers l on l.id = m.ledger_id
          where m.user_id = ${user.id} and m.active order by m.joined_at desc, l.id`;
        return json({ ledgers });
      }
      if (path === '/ledgers' && method === 'POST') return json(await createLedger(db, await payload(request), user), 201);
      if (path === '/join' && method === 'POST') return json(await joinLedger(db, await payload(request), user));

      const [, id, endpoint] = path.match(/^\/ledgers\/([^/]+)(?:\/(actions|invite|members))?$/) ?? [];
      if (id && uuid.test(id)) {
        if (!endpoint && method === 'GET') return json(await readLedger(db, id, user.id));
        if (endpoint && method === 'POST') return json(await writeLedger(db, id, endpoint, await payload(request), user));
      }
      return json({ error: '操作不存在。' }, 404);
    } catch (error) {
      if (error instanceof WalletError) return json({ error: error.message }, error.status);
      console.error('Wallet Edge Function error', error?.code ?? error?.name ?? 'unknown');
      return json({ error: '账本服务暂时不可用，请稍后重试。' }, 500);
    }
  };
}
