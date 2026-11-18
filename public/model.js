export const categories = {
  dining: { name: '餐饮美食', icon: 'dining', color: 'violet' },
  groceries: { name: '日用采购', icon: 'bag', color: 'orange' },
  transport: { name: '交通出行', icon: 'car', color: 'blue' },
  housing: { name: '房租水电', icon: 'home', color: 'green' },
  fun: { name: '休闲娱乐', icon: 'sparkle', color: 'pink' },
  other: { name: '其他支出', icon: 'dots', color: 'slate' },
  contribution: { name: '成员缴费', icon: 'wallet', color: 'green' },
  income: { name: '其他收入', icon: 'arrow-down', color: 'green' },
  repayment: { name: '还款结算', icon: 'arrows', color: 'blue' },
};

export const expenseCategories = ['dining', 'groceries', 'transport', 'housing', 'fun', 'other'];
export const incomeCategories = ['contribution', 'income'];
export const roles = { owner: '创建者', admin: '管理员', member: '成员', viewer: '观察者' };
export const methods = { equal: '平均分摊', fixed: '按金额', percentage: '按比例（%）', shares: '按份数' };
export const maxCents = 9999999999;
const maxRecords = 2500;

export class WalletError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function ensure(condition, message, status) {
  if (!condition) throw new WalletError(message, status);
}

export function label(value, max, message, optional = false) {
  ensure(typeof value === 'string', message);
  const trimmed = value.trim();
  ensure((optional || trimmed.length > 0) && trimmed.length <= max, message);
  return trimmed;
}

export function centsFromText(value) {
  const trimmed = String(value).trim();
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(trimmed)) return NaN;
  const [whole, fractional = ''] = trimmed.split('.');
  return Number(whole) * 100 + Number(fractional.padEnd(2, '0'));
}

export function dateKey(date = new Date()) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

export function monthShift(month, delta) {
  const [year, number] = month.split('-').map(Number);
  return dateKey(new Date(year, number - 1 + delta, 1)).slice(0, 7);
}

function amountValid(amount) {
  return Number.isSafeInteger(amount) && amount > 0 && amount <= maxCents;
}

function dateValid(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < '1900-01-01') return false;
  const test = new Date(date + 'T00:00:00Z');
  return !Number.isNaN(test.getTime()) && test.toISOString().slice(0, 10) === date;
}

export function allocate(total, method, specifications) {
  ensure(amountValid(total), '请输入有效金额，最多保留两位小数。');
  ensure(Object.hasOwn(methods, method), '请选择一种分摊方式。');
  ensure(Array.isArray(specifications) && specifications.length > 0 && specifications.length <= 60, '请至少选择一位分摊成员。');
  ensure(new Set(specifications.map(item => item.id)).size === specifications.length, '分摊成员重复。');

  if (method === 'fixed') {
    ensure(specifications.every(item => Number.isSafeInteger(item.value) && item.value >= 0 && item.value <= total), '请填写有效的分摊金额。');
    ensure(specifications.reduce((sum, item) => sum + item.value, 0) === total, '分摊金额之和应等于账单金额。');
    return specifications.map(item => ({ id: item.id, amount: item.value }));
  }

  const weighted = specifications.map(item => ({ id: item.id, weight: method === 'equal' ? 1 : item.value }));
  ensure(weighted.every(item => Number.isSafeInteger(item.weight) && item.weight >= 0 && item.weight <= 1000000), '请填写有效的比例或份数。');
  const sum = weighted.reduce((acc, item) => acc + item.weight, 0);
  ensure(method === 'percentage' ? sum === 10000 : sum > 0, method === 'percentage' ? '分摊比例之和应为 100%。' : '分摊份数之和必须大于 0。');

  const allocated = weighted.map(item => {
    const product = BigInt(total) * BigInt(item.weight);
    return { id: item.id, amount: Number(product / BigInt(sum)), remainder: Number(product % BigInt(sum)) };
  });
  const extra = total - allocated.reduce((acc, item) => acc + item.amount, 0);
  const ranked = [...allocated].sort((a, b) => b.remainder - a.remainder || a.id.localeCompare(b.id, 'en'));
  for (const item of ranked.slice(0, extra)) item.amount++;
  return allocated.map(({ id, amount }) => ({ id, amount }));
}

export function blankLedger(name, kind = 'shared') {
  ensure(['personal', 'shared'].includes(kind), '请选择账本类型。');
  return { name: label(name, 40, '账本名称需要 1 至 40 个字符。'), kind, records: [], budgets: {}, audit: [] };
}

export function summarize(state, month) {
  const records = state.records.filter(record => !record.deleted && record.date.startsWith(month));
  const expenses = records.filter(record => record.type === 'expense');
  const income = records.filter(record => record.type === 'income').reduce((total, item) => total + item.amount, 0);
  const spending = expenses.reduce((total, item) => total + item.amount, 0);
  const byCategory = Object.fromEntries(expenseCategories.map(key => [key, 0]));
  for (const item of expenses) byCategory[item.category] += item.amount;
  const budget = state.budgets[month] ?? 0;
  return { records, income, spending, byCategory, budget, remaining: budget - spending };
}

export function balances(records) {
  const result = Object.create(null);
  const add = (id, amount) => { result[id] = (result[id] ?? 0) + amount; };
  for (const record of records) {
    if (record.deleted || record.type === 'income') continue;
    if (record.type === 'repayment') {
      add(record.payer, record.amount);
      add(record.recipient, -record.amount);
      continue;
    }
    for (const payment of record.payments) add(payment.id, payment.amount);
    for (const split of record.splits) add(split.id, -split.amount);
  }
  return result;
}

export function suggestions(records) {
  const sorted = Object.entries(balances(records)).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]) || a[0].localeCompare(b[0], 'en'));
  const debtors = sorted.filter(([, value]) => value < 0).map(([id, value]) => ({ id, amount: -value }));
  const creditors = sorted.filter(([, value]) => value > 0).map(([id, amount]) => ({ id, amount }));
  const result = [];
  let debit = 0;
  let credit = 0;
  while (debit < debtors.length && credit < creditors.length) {
    const sender = debtors[debit];
    const receiver = creditors[credit];
    const amount = Math.min(sender.amount, receiver.amount);
    result.push({ payer: sender.id, recipient: receiver.id, amount });
    sender.amount -= amount;
    receiver.amount -= amount;
    if (sender.amount === 0) debit++;
    if (receiver.amount === 0) credit++;
  }
  return result;
}

export function mutate(state, action, members, actor, now = Date.now()) {
  const me = members.find(member => member.id === actor && member.active);
  ensure(me && me.role !== 'viewer', '你没有权限修改这个账本。', 403);
  const manager = ['owner', 'admin'].includes(me.role);
  const active = new Set(members.filter(member => member.active).map(member => member.id));
  const existing = state.records.find(record => record.id === action.id);
  const recordAllowed = existing && (manager || existing.author === actor);
  const addAudit = (description) => {
    state.audit.unshift({ id: crypto.randomUUID(), actor, time: now, description });
    state.audit = state.audit.slice(0, 100);
  };

  if (action.kind === 'budget') {
    ensure(manager, '只有创建者或管理员可以设置预算。', 403);
    ensure(typeof action.month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(action.month), '请选择有效月份。');
    ensure(action.amount === 0 || amountValid(action.amount), '请输入有效预算。');
    if (action.amount) state.budgets[action.month] = action.amount;
    else delete state.budgets[action.month];
    addAudit('更新了 ' + action.month + ' 的预算');
    return;
  }

  if (action.kind === 'rename') {
    ensure(manager, '只有创建者或管理员可以修改账本名称。', 403);
    state.name = label(action.name, 40, '账本名称需要 1 至 40 个字符。');
    addAudit('修改了账本名称');
    return;
  }

  if (action.kind === 'delete' || action.kind === 'restore') {
    ensure(recordAllowed, '你没有权限修改这条记录。', 403);
    const deleting = action.kind === 'delete';
    ensure(Boolean(existing.deleted) !== deleting, '这条记录已经更新，请刷新后再试。', 409);
    existing.deleted = deleting;
    addAudit((deleting ? '删除了账单 · ' : '恢复了账单 · ') + existing.title);
    return;
  }

  ensure(action.kind === 'record', '未知的操作。');
  if (existing || action.id) ensure(recordAllowed && !existing.deleted, '账单已删除或你没有编辑权限。', 403);
  else ensure(state.records.length < maxRecords, '此账本已达到首版的记录上限。');
  ensure(amountValid(action.amount), '请输入有效金额，最多保留两位小数。');
  ensure(dateValid(action.date), '请选择有效日期。');
  ensure(['expense', 'income', 'repayment'].includes(action.type), '请选择账单类型。');
  ensure(!existing || action.type === existing.type, '编辑时请保留原账单类型。');
  const record = {
    id: existing?.id ?? crypto.randomUUID(),
    author: existing?.author ?? actor,
    created: existing?.created ?? now,
    title: label(action.title, 64, '摘要需要 1 至 64 个字符。'),
    note: label(action.note ?? '', 300, '备注最多 300 个字符。', true),
    date: action.date,
    amount: action.amount,
    type: action.type,
  };

  if (action.type === 'expense') {
    ensure(expenseCategories.includes(action.category), '请选择支出分类。');
    record.category = action.category;
    ensure(Array.isArray(action.payments) && action.payments.length > 0 && action.payments.length <= 60, '请填写付款人。');
    const previousPayees = new Set(existing?.payments.map(item => item.id));
    ensure(action.payments.every(item => item && (active.has(item.id) || previousPayees.has(item.id)) && amountValid(item.amount)), '请输入有效的付款人和实付金额。');
    ensure(new Set(action.payments.map(item => item.id)).size === action.payments.length, '付款成员重复。');
    ensure(action.payments.reduce((sum, item) => sum + item.amount, 0) === action.amount, '实付金额之和应等于账单金额。');
    const previousParticipants = new Set(existing?.splits.map(item => item.id));
    ensure(Array.isArray(action.specifications) && action.specifications.every(item => item && (active.has(item.id) || previousParticipants.has(item.id))), '请选择有效的分摊成员。');
    record.payments = action.payments.map(({ id, amount }) => ({ id, amount }));
    record.method = action.method;
    record.specifications = action.specifications.map(({ id, value }) => ({ id, value: action.method === 'equal' ? 1 : value }));
    record.splits = allocate(action.amount, record.method, record.specifications);
  } else {
    const known = new Set(members.map(member => member.id));
    ensure(active.has(action.payer) || action.payer === existing?.payer || (action.type === 'repayment' && known.has(action.payer)), '请选择有效成员。');
    record.payer = action.payer;
    if (action.type === 'repayment') {
      ensure(state.kind === 'shared' && known.has(action.recipient) && action.recipient !== action.payer, '请选择不同的付款和收款成员。');
      ensure(manager || [action.payer, action.recipient].includes(actor), '只有交易双方或管理员可以登记还款。', 403);
      const debt = balances(state.records.filter(item => item !== existing));
      const max = Math.min(-(debt[action.payer] ?? 0), debt[action.recipient] ?? 0);
      ensure(action.amount <= max, '还款金额超出当前可结算余额，请刷新后重试。', 409);
      record.recipient = action.recipient;
      record.category = 'repayment';
    } else {
      ensure(incomeCategories.includes(action.category), '请选择收入分类。');
      record.category = action.category;
    }
  }

  if (existing) state.records[state.records.indexOf(existing)] = record;
  else state.records.unshift(record);
  addAudit((existing ? '修改了账单 · ' : '新增了账单 · ') + record.title);
}
