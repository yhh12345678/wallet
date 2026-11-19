import './build.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarDays } from '../public/calendar.js';
import { registrationError, usernameEmail } from '../supabase/functions/_shared/credentials.js';
import { allocate, balances, blankLedger, centsFromText, ledgerAccounts, mutate, suggestions, summarize } from '../supabase/functions/_shared/model.js';
import { walletHandler } from '../supabase/functions/wallet/ledger.js';
import { localDb } from './local-db.mjs';

const worker = (await import('../dist/server/index.js')).default;

test('月历按日期汇总收支，正确处理闰年、空白日期、回收站和还款', () => {
  const items = [
    { date: '2024-02-01', type: 'income', amount: 3000 },
    { date: '2024-02-01', type: 'income', amount: 502 },
    { date: '2024-02-01', type: 'income', amount: 9999, deleted: true },
    { date: '2024-02-01', type: 'expense', amount: 1001 },
    { date: '2024-02-01', type: 'repayment', amount: 1000 },
    { date: '2024-02-29', type: 'expense', amount: 165 },
    { date: '2024-03-01', type: 'expense', amount: 3000 },
  ];
  const { offset, days } = calendarDays(items, '2024-02');
  assert.equal(offset, 3);
  assert.equal(days.length, 29);
  assert.deepEqual(days[0], {
    date: '2024-02-01', income: 3502, spending: 1001, records: [items[0], items[1], items[3], items[4]],
  });
  assert.deepEqual(days[1], { date: '2024-02-02', income: 0, spending: 0, records: [] });
  assert.equal(days.at(-1).spending, 165);
  assert.equal(calendarDays(items, '2024-03').days[0].spending, 3000);
  assert.equal(calendarDays([], '2025-02').days.length, 28);
});

test('用户名密码注册允许站内访客，账本仍需登录', async () => {
  const origin = 'https://wallet.example';
  const credentials = { username: 'Wallet_01', password: 'Bookkeeper42!' };
  assert.equal(usernameEmail(credentials.username), 'wallet_01@accounts.wallet.invalid');
  assert.equal(registrationError(credentials.username, credentials.password), '');
  assert.ok(registrationError('用户1', credentials.password));
  assert.ok(registrationError(credentials.username, 'weakpass'));

  let registered = 0;
  const handler = walletHandler(null, async () => null, new Set([origin]), async data => {
    assert.deepEqual(data, credentials);
    registered++;
    return { username: data.username };
  });
  const register = headers => handler(new Request(origin + '/functions/v1/wallet/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(credentials),
  }));
  assert.equal((await register({})).status, 403);
  assert.equal((await register({ Origin: 'https://other.example' })).status, 403);
  assert.equal((await register({ Origin: origin })).status, 201);
  assert.equal((await handler(new Request(origin + '/functions/v1/wallet/ledgers', { headers: { Origin: origin } }))).status, 401);
  assert.equal(registered, 1);
});

test('分摊尾差、指定金额、比例和份数均保持整数分总额', () => {
  assert.equal(centsFromText('12.05'), 1205);
  assert.ok(Number.isNaN(centsFromText('1.001')));
  assert.deepEqual(allocate(100, 'equal', [{ id: 'a' }, { id: 'b' }, { id: 'c' }]).map(row => row.amount), [34, 33, 33]);
  assert.deepEqual(allocate(1251, 'fixed', [{ id: 'a', value: 1000 }, { id: 'b', value: 251 }]).map(row => row.amount), [1000, 251]);
  assert.deepEqual(allocate(101, 'percentage', [{ id: 'a', value: 8250 }, { id: 'b', value: 1750 }]).map(row => row.amount), [83, 18]);
  assert.deepEqual(allocate(9999999999, 'shares', [{ id: 'a', value: 1000000 }, { id: 'b', value: 1000000 }]).map(row => row.amount), [5000000000, 4999999999]);
  assert.throws(() => allocate(100, 'percentage', [{ id: 'a', value: 9999 }]), /100%/);
});

test('共享支出可省略分摊，编辑时可开启或关闭分摊', () => {
  const ledger = blankLedger('周末旅行');
  const members = [
    { id: 'owner', active: true, role: 'owner' },
    { id: 'guest', active: true, role: 'member' },
  ];
  const expense = {
    kind: 'record', type: 'expense', title: '车费', date: '2026-11-17', amount: 1001, category: 'transport',
    payments: [{ id: 'owner', amount: 900 }, { id: 'guest', amount: 101 }],
  };
  mutate(ledger, expense, members, 'owner');
  const [record] = ledger.records;
  assert.equal(record.method, 'none');
  assert.deepEqual(record.splits, []);
  assert.deepEqual(record.payments, expense.payments);
  assert.deepEqual(Object.entries(balances(ledger.records)), []);
  assert.equal(summarize(ledger, '2026-11').spending, 1001);

  const edit = { ...expense, id: record.id };
  assert.throws(() => mutate(ledger, { ...edit, method: 'equal', specifications: [] }, members, 'owner'), /至少选择一位/);
  mutate(ledger, { ...edit, method: 'equal', specifications: [{ id: 'owner' }, { id: 'guest' }] }, members, 'owner');
  assert.deepEqual(suggestions(ledger.records), [{ payer: 'guest', recipient: 'owner', amount: 400 }]);

  mutate(ledger, { ...edit, method: 'none' }, members, 'owner');
  assert.equal(ledger.records.length, 1);
  assert.deepEqual(ledger.records[0].specifications, []);
  assert.deepEqual(Object.entries(balances(ledger.records)), []);
  assert.equal(summarize(ledger, '2026-11').spending, 1001);
});

test('邀请隔离、多人付款、还款、回收站与观察者权限', async () => {
  const DB = localDb();
  async function call(path, user, body = undefined, expected = 200) {
    const headers = new Headers();
    if (user) headers.set('oai-authenticated-user-id', user);
    if (body !== undefined) headers.set('content-type', 'application/json');
    const response = await worker.fetch(new Request('https://wallet.example/api/' + path, {
      headers,
      method: body === undefined ? 'GET' : 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    }), { DB });
    const result = await response.json();
    assert.equal(response.status, expected, JSON.stringify(result));
    return result;
  }

  try {
    await call('ledgers', null, undefined, 401);
    const { id } = await call('ledgers', 'owner', { name: '周末旅行', kind: 'shared' }, 201);
    const link = 'ledgers/' + id;
    await call(link, 'outside', undefined, 404);
    const firstInvite = await call(link + '/invite', 'owner', {});
    const { code } = await call(link + '/invite', 'owner', {});
    await call('join', 'outside', { code: firstInvite.code }, 404);
    assert.equal((await call('join', 'guest', { code })).id, id);
    assert.equal((await call('join', 'guest', { code })).id, id);
    await call(link + '/invite', 'guest', {}, 403);
    let snapshot = await call(link, 'guest');
    assert.equal(snapshot.members.length, 2);
    const action = {
      kind: 'record', type: 'expense', title: '三明治', note: '', date: '2026-11-17', amount: 1001, category: 'dining',
      payments: [{ id: 'owner', amount: 900 }, { id: 'guest', amount: 101 }],
      method: 'equal', specifications: [{ id: 'owner' }, { id: 'guest' }],
    };
    snapshot = await call(link + '/actions', 'guest', { action, version: snapshot.version });
    const record = snapshot.state.records[0];
    assert.deepEqual(suggestions(snapshot.state.records), [{ payer: 'guest', recipient: 'owner', amount: 400 }]);
    await call(link + '/actions', 'owner', { action, version: snapshot.version - 1 }, 409);
    await call(link + '/actions', 'guest', { action: { kind: 'budget', month: '2026-11', amount: 5000 }, version: snapshot.version }, 403);
    const repayment = { kind: 'record', type: 'repayment', title: '还款结算', note: '', date: '2026-11-17', amount: 200, payer: 'guest', recipient: 'owner' };
    snapshot = await call(link + '/actions', 'owner', { action: repayment, version: snapshot.version });
    assert.deepEqual(suggestions(snapshot.state.records), [{ payer: 'guest', recipient: 'owner', amount: 200 }]);
    assert.equal(summarize(snapshot.state, '2026-11').spending, 1001);
    assert.equal(summarize(snapshot.state, '2026-11').income, 0);
    await call(link + '/actions', 'guest', { action: { ...repayment, amount: 201 }, version: snapshot.version }, 409);
    snapshot = await call(link + '/actions', 'guest', { action: { kind: 'delete', id: record.id }, version: snapshot.version });
    assert.equal(summarize(snapshot.state, '2026-11').spending, 0);
    snapshot = await call(link + '/actions', 'guest', { action: { kind: 'restore', id: record.id }, version: snapshot.version });
    assert.equal(summarize(snapshot.state, '2026-11').spending, 1001);
    await call(link + '/members', 'owner', { id: 'guest', role: 'viewer', active: true });
    snapshot = await call(link, 'guest');
    await call(link + '/actions', 'guest', { action, version: snapshot.version }, 403);
    await call(link + '/members', 'owner', { id: 'guest', role: 'viewer', active: false });
    await call(link, 'guest', undefined, 404);
    await call('join', 'guest', { code }, 404);
    const updated = await call(link, 'owner');
    assert.equal(updated.state.records.length, 2);
    await call(link + '/invite', 'owner', { revoke: true });
    await call('join', 'outside', { code }, 404);
  } finally {
    DB.close();
  }
});

test('独立个人账本和并发写入防覆盖', async () => {
  const DB = localDb();
  const call = (path, body, method = 'POST') => worker.fetch(new Request('https://wallet.example/api/' + path, {
    method, headers: { 'oai-authenticated-user-id': 'a', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), { DB });
  try {
    const created = await call('ledgers', { name: '个人', kind: 'personal' });
    const { id } = await created.json();
    const link = 'ledgers/' + id;
    assert.equal((await call(link + '/invite', {})).status, 403);
    const base = { version: 0, action: { kind: 'budget', month: '2026-11', amount: 100 } };
    const responses = await Promise.all([call(link + '/actions', base), call(link + '/actions', { ...base, action: { ...base.action, amount: 200 } })]);
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
    const final = await (await call(link, undefined, 'GET')).json();
    assert.equal(final.version, 1);
    assert.ok([100, 200].includes(final.state.budgets['2026-11']));
  } finally {
    DB.close();
  }
});

test('创建者确认后可原子删除账本，撤销成员访问和邀请', async () => {
  const DB = localDb();
  async function call(path, user, body) {
    const headers = { 'content-type': 'application/json' };
    if (user) headers['oai-authenticated-user-id'] = user;
    const response = await worker.fetch(new Request('https://wallet.example/api/' + path, {
      method: body === undefined ? 'GET' : 'POST', headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }), { DB });
    return { status: response.status, data: await response.json() };
  }

  try {
    const { data: { id } } = await call('ledgers', 'owner', { name: '待删除的共享账本', kind: 'shared' });
    const { data: { id: personal } } = await call('ledgers', 'owner', { name: '独立账本', kind: 'personal' });
    const link = 'ledgers/' + id;
    const { data: { code } } = await call(link + '/invite', 'owner', {});
    await call('join', 'guest', { code });
    await call(link + '/members', 'owner', { id: 'guest', role: 'admin', active: true });
    const { data: { version, state } } = await call(link, 'owner');
    const confirmation = { version, name: state.name };

    assert.equal((await call(link + '/delete', null, confirmation)).status, 401);
    assert.equal((await call(link + '/delete', 'outside', confirmation)).status, 404);
    assert.equal((await call(link + '/delete', 'guest', confirmation)).status, 403);
    assert.equal((await call(link + '/delete', 'owner', { ...confirmation, name: '名称错误' })).status, 400);
    assert.equal((await call(link + '/delete', 'owner', { ...confirmation, version: version - 1 })).status, 409);
    assert.equal((await call(link, 'guest')).status, 200);

    const duplicate = await Promise.all([
      call(link + '/delete', 'owner', confirmation),
      call(link + '/delete', 'owner', confirmation),
    ]);
    assert.equal(duplicate.filter(result => result.data.deleted === true).length, 1);
    assert.ok(duplicate.some(result => [404, 409].includes(result.status)));
    assert.equal((await call(link, 'guest')).status, 404);
    assert.equal((await call('join', 'outsider', { code })).status, 404);
    assert.deepEqual((await call('ledgers', 'owner')).data.ledgers.map(item => item.id), [personal]);
    assert.deepEqual((await call('ledgers', 'guest')).data, { ledgers: [] });
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM wallet_members WHERE ledger_id = ?').bind(id).first()).n, 0);
    assert.deepEqual(await call('ledgers/' + personal + '/delete', 'owner', { version: 0, name: '独立账本' }),
      { status: 200, data: { deleted: true } });
  } finally {
    DB.close();
  }
});

test('账户期初余额、旧账单归集、转账手续费与收支统计隔离', () => {
  const state = blankLedger('账户测试');
  const members = [{ id: 'owner', role: 'owner', active: true }, { id: 'guest', role: 'viewer', active: true }];
  const base = { kind: 'record', title: '测试流水', date: '2026-11-18', note: '' };
  mutate(state, { ...base, type: 'income', category: 'income', payer: 'owner', amount: 9000 }, members, 'owner');
  assert.deepEqual(ledgerAccounts(state).map(item => item.balance), [9000]);
  assert.throws(() => mutate(state, { kind: 'account', name: '备用金', opening: 500 }, members, 'guest'), /权限/);
  mutate(state, { kind: 'account', name: '备用金', opening: 500 }, members, 'owner');
  const { id } = state.accounts[0];
  const move = { ...base, type: 'transfer', fromAccount: 'default', toAccount: id, amount: 2000, fee: 30 };
  assert.throws(() => mutate(state, { ...move, toAccount: 'default' }, members, 'owner'), /两个不同/);
  mutate(state, move, members, 'owner');
  const transfer = state.records[0].id;
  mutate(state, { ...base, type: 'expense', accountId: id, category: 'dining', amount: 760, payments: [{ id: 'owner', amount: 760 }] }, members, 'owner');
  assert.deepEqual(ledgerAccounts(state).map(item => item.balance), [6970, 1740]);
  const stats = summarize(state, '2026-11');
  assert.deepEqual([stats.income, stats.spending], [9000, 760]);
  assert.deepEqual(suggestions(state.records), []);
  mutate(state, { kind: 'delete', id: transfer }, members, 'owner');
  assert.deepEqual(ledgerAccounts(state).map(item => item.balance), [9000, -260]);
  mutate(state, { kind: 'restore', id: transfer }, members, 'owner');
  assert.deepEqual(ledgerAccounts(state).map(item => item.balance), [6970, 1740]);
});
