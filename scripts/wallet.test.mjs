import './build.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { allocate, balances, blankLedger, centsFromText, mutate, suggestions, summarize } from '../public/model.js';
import { localDb } from './local-db.mjs';

const worker = (await import('../dist/server/index.js')).default;

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
