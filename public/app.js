import { allocate, balances, categories, centsFromText, dateKey, expenseCategories, incomeCategories, methods, monthShift, mutate, roles, suggestions, summarize } from './model.js';
import { avatar, decimal, demoLedger, escape as e, icon, money, monthLabel, shortDate } from './ui.js';
import { api as requestApi, accountAuth } from './backend.js';
import { calendarDays } from './calendar.js';

const app = document.querySelector('#app');
const modal = document.querySelector('#modal');
const demo = loadDemo();
const moment = dateKey().slice(0, 7);
let ledger = demo;
let user = null;
let ledgers = [];
let page = 'overview';
let month = moment;
let menu = '';
let query = '';
let typeFilter = 'all';
let categoryFilter = 'all';
let showDeleted = false;
let issue = '';
let busy = false;
let loadSequence = 0;
let sessionVersion = 0;
let invitation = '';
const pages = {
  overview: ['账本总览', 'grid', '查看收支、预算和待结算款项。'],
  records: ['收支明细', 'list', '查找账单、核对付款与分摊金额。'],
  settlements: ['分摊结算', 'arrows', '查看成员净余额并登记已完成的还款。'],
  analytics: ['统计预算', 'chart', '查看支出构成和月度预算使用情况。'],
  members: ['账本成员', 'people', '管理共享账本的成员、角色与操作记录。'],
};
const typeLabels = { expense: '支出', income: '收入', repayment: '还款' };
const compactCalendarMoney = new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 });
const sharePercent = new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: 1 });

function loadDemo() {
  try {
    const saved = JSON.parse(localStorage.getItem('wallet-demo-v1'));
    if (saved?.updatedMonth === dateKey().slice(0, 7)) return saved.ledger;
  } catch { /* The demo also works without storage. */ }
  return demoLedger();
}

function saveDemo() {
  try { localStorage.setItem('wallet-demo-v1', JSON.stringify({ ledger: demo, updatedMonth: moment })); } catch { /* In-memory demo remains available. */ }
}

function remember(id) {
  try { localStorage.setItem('wallet-last-ledger', id); } catch { /* Selection remains available for this page. */ }
}

function storedLedger() {
  try { return localStorage.getItem('wallet-last-ledger'); } catch { return null; }
}

function member(id) { return ledger.members.find(item => item.id === id) ?? { name: '未知成员', role: 'viewer' }; }
function who() { return ledger.id === 'demo' ? 'demo-you' : user?.id; }
function myRole() { return member(who()).role; }
function canManage() { return ['owner', 'admin'].includes(myRole()); }
function canDeleteLedger() { return ledger.id !== 'demo' && myRole() === 'owner'; }
function canWrite() { return myRole() !== 'viewer'; }
function isShared() { return ledger.state.kind === 'shared'; }
function activeMembers() { return ledger.members.filter(item => item.active); }
function person(id, extra) { return avatar(member(id).name, Math.max(0, ledger.members.findIndex(item => item.id === id)), extra); }
function signedMoney(amount) { return (amount < 0 ? '−' : '') + money(amount); }

function button(label, action, symbol, kind = 'outline', data = '') {
  return '<button type="button" class="btn ' + kind + '" data-action="' + action + '" ' + data + '>' + (symbol ? icon(symbol, 15) : '') + e(label) + '</button>';
}

function iconButton(label, action, symbol, data = '') {
  return '<button type="button" class="icon-button" aria-label="' + e(label) + '" title="' + e(label) + '" data-action="' + action + '" ' + data + '>' + icon(symbol, 16) + '</button>';
}

function empty(message, symbol = 'inbox') {
  return '<div class="empty">' + icon(symbol, 22) + '<strong>' + e(message) + '</strong></div>';
}

function tag(text, live = false) {
  return '<span class="tag' + (live ? ' live' : '') + '"><i class="status-dot"></i>' + e(text) + '</span>';
}

function nav() {
  return Object.entries(pages).filter(([id]) => isShared() || id !== 'settlements').map(([id, [title, symbol]]) =>
    '<button type="button" data-action="page" data-page="' + id + '" class="nav-item' + (page === id ? ' active' : '') + '" aria-label="' + title + '"' + (page === id ? ' aria-current="page"' : '') + '>' + icon(symbol, 17) + '<span>' + title + '</span></button>',
  ).join('');
}

function switcher(location) {
  const items = [...ledgers, { id: 'demo', name: '四人宿舍账本（示例）', kind: 'shared' }];
  const other = items.map(item => button(item.name, 'switch', item.kind === 'shared' ? 'people' : 'wallet', '', 'data-id="' + e(item.id) + '"' + (item.id === ledger.id ? ' aria-current="true"' : ''))).join('');
  const remove = canDeleteLedger() ? '<div class="separator"></div>' + button('删除当前账本', 'delete-ledger', '', 'danger') : '';
  return '<button type="button" class="ledger-switch" data-action="ledger-menu" data-location="' + location + '" aria-label="切换账本" aria-expanded="' + String(menu === location) + '">' +
    '<span class="ledger-symbol">' + icon(isShared() ? 'home' : 'wallet', 18) + '</span><span><b>' + e(ledger.state.name) + '</b><small>' + (isShared() ? '共享账本' : '个人账本') + ' · ' + activeMembers().length + ' 位成员</small></span>' + icon('down', 14) + '</button>' +
    (menu === location ? '<div class="ledger-popup">' + other + '<div class="separator"></div>' + button('创建账本', 'create', 'plus', '') + button('加入账本', 'join', 'person', '') + remove + '</div>' : '');
}

function memberStrip() {
  const members = activeMembers();
  return '<div class="member-strip"><div class="avatar-stack">' + members.slice(0, 4).map(item => person(item.id)).join('') + '</div><span>' + members.length + ' 位成员</span></div>';
}

function monthControl() {
  return '<div class="month">' + iconButton('上个月', 'month', 'left', 'data-delta="-1"') + '<span class="name">' + icon('calendar', 15) + e(monthLabel(month)) + '</span>' + iconButton('下个月', 'month', 'chevron', 'data-delta="1"') + '</div>';
}

function panel(title, description, body, trailing = '', extra = '') {
  return '<section class="card panel ' + extra + '"><header class="panel-head"><div><h2>' + title + '</h2>' + (description ? '<p>' + description + '</p>' : '') + '</div>' + trailing + '</header>' + body + '</section>';
}

function metric(title, value, detail, symbol, color, { leading = false, type = '' } = {}) {
  const tag = type ? 'button' : 'section';
  const action = type ? ' type="button" data-action="month-analysis" data-type="' + type + '" aria-haspopup="dialog"' : '';
  const hint = type ? '<span class="metric-hint">查看分析</span>' : '';
  return '<' + tag + ' class="card metric' + (leading ? ' leading' : '') + (type ? ' metric-interactive' : '') + '"' + action +
    '><span class="metric-top"><span>' + title + '</span><span class="metric-icon ' + color + '">' + icon(symbol, 17) +
    '</span></span><span class="metric-value num">' + value + '</span><span class="metric-foot"><span>' + detail +
    '</span>' + hint + '</span></' + tag + '>';
}

function chart() {
  const months = Array.from({ length: 6 }, (_, index) => monthShift(month, index - 5));
  const summaries = months.map(key => summarize(ledger.state, key));
  const ceiling = Math.max(300, ...summaries.flatMap(item => [item.income, item.spending]));
  const unit = 10 ** Math.floor(Math.log10(ceiling / 3));
  const step = Math.ceil(ceiling / 3 / unit) * unit;
  const formatAxis = (cents) => '¥' + (cents / 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  const labels = [step * 3, step * 2, step, 0].map(cents => '<span>' + formatAxis(cents) + '</span>').join('');
  const columns = summaries.map((item, i) => '<div class="bar-group" title="' + e(monthLabel(months[i]) + ' · 收入 ' + money(item.income) + ' · 支出 ' + money(item.spending)) + '">' +
    '<i class="bar income" style="--bar:' + (item.income / (step * 3) * 100) + '%"></i><i class="bar" style="--bar:' + (item.spending / (step * 3) * 100) + '%"></i></div>').join('');
  const monthsLine = months.map((key, i) => '<span>' + (i === 5 ? '<strong>' : '') + Number(key.slice(5)) + '月' + (i === 5 ? '</strong>' : '') + '</span>').join('');
  const legend = '<div class="legend"><span><i class="light"></i>收入</span><span><i></i>支出</span></div>';
  const text = summaries.map((item, i) => monthLabel(months[i]) + '收入 ' + money(item.income) + '，支出 ' + money(item.spending)).join('。');
  return panel('收支趋势', '最近 6 个月', '<div class="chart" role="img" aria-label="' + e(text) + '"><div class="axis">' + labels + '</div><div class="plot">' + columns + '</div><div class="axis-months">' + monthsLine + '</div></div>', legend);
}

function calendarAmount(cents, type, sign) {
  if (!cents) return '';
  const narrow = cents >= 1000000 ? compactCalendarMoney.format(cents / 100) : String(cents / 100);
  return '<span class="calendar-amount ' + type + '"><span class="calendar-full">' + sign + money(cents) +
    '</span><span class="calendar-compact">' + sign + narrow + '</span></span>';
}

function dailyCalendar() {
  const { offset, days } = calendarDays(ledger.state.records, month);
  const today = dateKey();
  const weekdays = Array.from('一二三四五六日', day => '<span>周' + day + '</span>').join('');
  const blank = '<span class="calendar-blank"></span>';
  const cells = days.map(({ date, income, spending, records: items }) => {
    const label = shortDate(date) + '，收入 ' + money(income) + '，支出 ' + money(spending) + '，' + items.length + ' 笔账单';
    const amounts = calendarAmount(income, 'income', '+') + calendarAmount(spending, 'expense', '−');
    const content = amounts || '<span class="calendar-idle">' + (items.length ? '还款' : '—') + '</span>';
    return '<button type="button" class="calendar-day' + (items.length ? ' has-records' : '') +
      '" data-action="calendar-day" data-date="' + e(date) + '" aria-haspopup="dialog" aria-label="' + e(label) +
      '"' + (date === today ? ' aria-current="date"' : '') + ' title="' + e(label) + '">' +
      '<span class="calendar-number">' + Number(date.slice(8)) + '</span><span class="calendar-amounts" aria-hidden="true">' +
      content + '</span></button>';
  }).join('');
  const trailing = (7 - (offset + days.length) % 7) % 7;
  const legend = '<div class="calendar-legend"><span class="income">＋ 收入</span><span class="expense">− 支出</span></div>';
  const body = '<div class="calendar-weekdays" aria-hidden="true">' + weekdays + '</div>' +
    '<div class="calendar-grid">' + blank.repeat(offset) + cells + blank.repeat(trailing) + '</div>' + legend;
  return panel('收支日历', '点击日期查看当天账单', body, '<div class="calendar-month">' + monthControl() + '</div>', 'calendar-panel');
}

function calendarDayDialog(date) {
  const day = calendarDays(ledger.state.records, month).days[Number(date.slice(8)) - 1];
  if (day?.date !== date) return;
  const { income, spending, records: items } = day;
  const totals = '<div class="calendar-totals"><div><span>收入</span><strong class="num income">' + money(income) +
    '</strong></div><div><span>支出</span><strong class="num expense">' + money(spending) + '</strong></div></div>';
  dialog(shortDate(date) + '收支', date.slice(0, 4) + ' 年 · ' + items.length + ' 笔账单',
    totals + (items.length ? records(sortRecords(items)) : empty('当天暂无账单', 'calendar')), button('关闭', 'close', '', 'outline'));
}

function budget(stats) {
  const { budget: total, spending, remaining } = stats;
  const percent = total ? Math.round(spending / total * 100) : 0;
  const body = total ? '<div class="budget-body"><div class="ring" role="img" aria-label="预算已用 ' + percent + '%" style="--fill:' + Math.min(100, percent) + '%"><div class="ring-in"><strong class="num">' + percent + '%</strong><small>预算已用</small></div></div>' +
    '<div class="budget-info"><div><span>预算额度</span><strong class="num">' + money(total) + '</strong></div><div><span>已用</span><strong class="num">' + money(spending) + '</strong></div><div><span>' + (remaining >= 0 ? '可用余额' : '已超预算') + '</span><strong class="num">' + money(remaining) + '</strong></div></div></div>' :
    empty('本月还没有设置预算', 'target');
  return panel('月度预算', monthLabel(month), body, canManage() ? button(total ? '编辑' : '设置', 'budget', 'edit', 'text') : '');
}

function categoryIcon(key) {
  const { icon: symbol, color } = categories[key];
  return '<span class="category-icon ' + color + '">' + icon(symbol, 16) + '</span>';
}

function records(items) {
  if (!items.length) return empty(showDeleted && page === 'records' ? '回收站为空' : '该时段暂无匹配账单');
  return '<ul class="data-list">' + items.map(item => {
    const payer = item.type === 'expense' ? item.payments.map(payment => member(payment.id).name).join('、') : member(item.payer).name;
    return '<li><button class="record" type="button" data-action="details" data-id="' + e(item.id) + '"><span class="record-title">' + categoryIcon(item.category) + '<span><b>' + e(item.title) + '</b><small>' + categories[item.category].name + ' · ' + e(payer) + '</small></span></span>' +
      '<span class="record-date">' + shortDate(item.date) + '</span><span class="record-amount num ' + (item.type === 'income' ? 'positive' : '') + '">' + ({ expense: '−', income: '+', repayment: '' }[item.type]) + money(item.amount) + '</span></button></li>';
  }).join('') + '</ul>';
}

function sortRecords(items) { return [...items].sort((a, b) => b.date.localeCompare(a.date) || b.created - a.created); }

function settlementList(items, compact = false) {
  if (!items.length) return empty('目前款项已结清', 'check');
  return '<div class="settle-list' + (compact ? '' : ' settlement-table') + '">' + items.map(({ payer, recipient, amount }) => {
    const allowed = canWrite() && (canManage() || [payer, recipient].includes(who()));
    return '<div class="settle-item"><div class="settle-people">' + person(payer) + '<b>' + e(member(payer).name) + '</b>' + icon('chevron', 12) + person(recipient) + '<b>' + e(member(recipient).name) + '</b></div><strong class="num">' + money(amount) + '</strong>' +
      (!compact && allowed ? button('登记还款', 'repay', '', 'outline', 'data-payer="' + e(payer) + '" data-recipient="' + e(recipient) + '" data-amount="' + amount + '"') : '') + '</div>';
  }).join('') + '</div>';
}

function overview() {
  const stats = summarize(ledger.state, month);
  const previous = summarize(ledger.state, monthShift(month, -1));
  const percent = previous.spending ? Math.round((stats.spending - previous.spending) / previous.spending * 100) : null;
  const spendFoot = percent === null ? stats.records.filter(item => item.type === 'expense').length + ' 笔支出' : '较上月 <b>' + (percent > 0 ? '+' : '') + percent + '%</b>';
  const debt = suggestions(ledger.state.records);
  return '<div class="toolbar">' + monthControl() + memberStrip() + '</div><div class="cards">' +
    metric('本月支出', money(stats.spending), spendFoot, 'upRight', 'violet', { leading: true, type: 'expense' }) +
    metric('本月收入', money(stats.income), stats.records.filter(item => item.type === 'income').length + ' 笔入账', 'downLeft', 'green', { type: 'income' }) +
    metric('剩余预算', stats.budget ? signedMoney(stats.remaining) : '—', stats.budget ? '总预算 ' + money(stats.budget) : '预算待设置', 'wallet', 'blue') + '</div>' +
    '<div class="dashboard-row">' + chart() + budget(stats) + '</div>' + dailyCalendar() +
    '<div class="dashboard-row">' + panel('最近账单', '', records(sortRecords(stats.records).slice(0, 4)), button('查看明细', 'page', 'chevron', 'text', 'data-page="records"'), 'table-panel') +
    (isShared() ? panel('待结算款项', debt.length ? debt.length + ' 笔建议转账' : '按全部历史账单计算', settlementList(debt.slice(0, 3), true), button('查看', 'page', 'chevron', 'text', 'data-page="settlements"')) : panel('支出构成', monthLabel(month), breakdown(stats))) + '</div>';
}

function filteredRecords() {
  const needle = query.trim().toLocaleLowerCase('zh-CN');
  return sortRecords(ledger.state.records.filter(item => Boolean(item.deleted) === showDeleted &&
    (showDeleted || item.date.startsWith(month)) && (typeFilter === 'all' || typeFilter === item.type) &&
    (categoryFilter === 'all' || categoryFilter === item.category) &&
    (!needle || [item.title, item.note, categories[item.category].name].some(value => value.toLocaleLowerCase('zh-CN').includes(needle)))));
}

function options(items, selected) {
  return items.map(([key, text]) => '<option value="' + e(key) + '"' + (key === selected ? ' selected' : '') + '>' + e(text) + '</option>').join('');
}

function recordPage() {
  return '<div class="toolbar">' + (showDeleted ? '<strong>回收站</strong>' : monthControl()) + '<div class="inline-actions">' + button(showDeleted ? '返回账单' : '回收站', 'trash', 'history') + button('导出 CSV', 'export', 'download') + '</div></div>' +
    panel(showDeleted ? '已删除账单' : '账单列表', '', '<div class="filter-row"><div class="search-field">' + icon('search', 15) + '<input id="search" aria-label="搜索账单" placeholder="搜索摘要、备注或分类" value="' + e(query) + '"></div>' +
      '<select id="filter-type" aria-label="按账单类型筛选">' + options([['all', '全部类型'], ...Object.entries(typeLabels)], typeFilter) + '</select><select id="filter-category" aria-label="按分类筛选">' + options([['all', '全部分类'], ...Object.entries(categories).map(([key, category]) => [key, category.name])], categoryFilter) + '</select></div><div id="record-results">' + records(filteredRecords()) + '</div>');
}

function categoryBreakdown(byCategory, total, showShare = false) {
  return '<div class="category-breakdown">' + Object.entries(byCategory).filter(([, amount]) => amount > 0)
    .sort((a, b) => b[1] - a[1]).map(([key, amount]) => {
      const share = amount / total;
      const shareLabel = showShare ? '<small>' + e(share < .001 ? '<0.1%' : sharePercent.format(share)) + '</small>' : '';
      return '<div class="break-row"><span class="break-label">' + categoryIcon(key) + categories[key].name +
        '</span><div class="track" aria-hidden="true"><i style="--fill:' + (share * 100) + '%"></i></div>' +
        '<span class="break-amount"><strong class="num">' + money(amount) + '</strong>' + shareLabel + '</span></div>';
    }).join('') + '</div>';
}

function breakdown(stats) {
  return stats.spending ? categoryBreakdown(stats.byCategory, stats.spending) : empty('本月暂无支出', 'chart');
}

function monthlyAnalysis(type) {
  if (type !== 'income' && type !== 'expense') return;
  const stats = summarize(ledger.state, month);
  const items = sortRecords(stats.records.filter(item => item.type === type));
  const total = type === 'income' ? stats.income : stats.spending;
  const label = typeLabels[type];
  const totals = Object.create(null);
  let largest = 0;
  for (const item of items) {
    totals[item.category] = (totals[item.category] ?? 0) + item.amount;
    largest = Math.max(largest, item.amount);
  }
  const metrics = [
    [label + '总额', money(total)], ['账单笔数', items.length + ' 笔'],
    ['平均每笔', items.length ? money(Math.round(total / items.length)) : '—'],
    ['最大单笔', items.length ? money(largest) : '—'],
  ];
  const tiles = '<dl class="analysis-metrics">' + metrics.map(([name, value]) =>
    '<div><dt>' + name + '</dt><dd class="num">' + value + '</dd></div>').join('') + '</dl>';
  const content = items.length ?
    '<section class="analysis-section"><h3>分类占比</h3>' + categoryBreakdown(totals, total, true) + '</section>' +
    '<section class="analysis-section" data-summary-type="' + type + '"><h3>' + label + '明细</h3>' + records(items) + '</section>' :
    empty('该月暂无' + label, 'chart');
  dialog(label + '分析', monthLabel(month) + ' · ' + ledger.state.name, '<div class="monthly-analysis ' + type + '">' + tiles + content +
    '</div>', button('关闭', 'close', '', 'outline'));
}

function analytics() {
  const stats = summarize(ledger.state, month);
  return '<div class="toolbar">' + monthControl() + '</div><div class="dashboard-row">' + chart() + budget(stats) + '</div>' + dailyCalendar() +
    panel('分类支出', monthLabel(month), breakdown(stats));
}

function settlements() {
  const net = balances(ledger.state.records);
  const members = ledger.members.filter(item => item.active || net[item.id]);
  const status = '<div class="member-balance">' + members.map(({ id, name }) => {
    const amount = net[id] ?? 0;
    return '<div class="balance-card">' + person(id, 'avatar-lg') + '<div><b>' + e(name) + '</b><small class="' + (amount < 0 ? 'negative' : amount > 0 ? 'positive' : 'muted') + '">' + (amount < 0 ? '应付 ' : amount > 0 ? '应收 ' : '已结清 ') + money(amount) + '</small></div></div>';
  }).join('') + '</div>';
  const repayments = sortRecords(ledger.state.records.filter(item => !item.deleted && item.type === 'repayment'));
  return '<div class="stack">' + panel('成员净余额', '包含所有日期的共同支出和已登记还款。', status) +
    panel('建议转账', '实际转账完成后，可以在这里登记全部或部分还款。', settlementList(suggestions(ledger.state.records))) +
    panel('还款记录', '', records(repayments)) + '</div>';
}

function membersPage() {
  const roster = '<div class="member-list">' + ledger.members.map(item =>
    '<div class="member-row">' + person(item.id, 'avatar-lg') + '<div><b>' + e(item.name) + (item.id === who() ? ' · 我' : '') + '</b><small>' + (item.active ? roles[item.role] : '已移除') + '</small></div>' +
      (myRole() === 'owner' && item.id !== who() ? button(item.active ? '管理' : '恢复', 'role', 'edit', 'outline', 'data-id="' + e(item.id) + '"') : '') + '</div>',
  ).join('') + '</div>';
  const events = ledger.state.audit.length ? ledger.state.audit.map(item =>
    '<div class="audit-row">' + person(item.actor) + '<span><strong>' + e(member(item.actor).name) + '</strong> ' + e(item.description) + '</span><small>' + new Date(item.time).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + '</small></div>',
  ).join('') : empty('暂无操作记录', 'history');
  return '<div class="stack">' + panel('成员列表', activeMembers().length + ' 位成员', roster, canManage() ? button('编辑账本名称', 'rename', 'edit', 'outline') : '') +
    panel('操作记录', '最近 100 条', events) + (canDeleteLedger() ?
      panel('账本管理', '', button('删除账本', 'delete-ledger', '', 'danger')) : '') + '</div>';
}

function render() {
  const [heading, , description] = pages[page];
  const signed = user?.name ?? '';
  const accountLabel = accountAuth ? 'Wallet 账号' : 'ChatGPT 账号';
  const demoMode = ledger.id === 'demo';
  const title = page === 'overview' ? '账本总览' : heading;
  const upper = '<header class="top"><div class="breadcrumbs"><span>我的账本</span>' + icon('chevron', 13) + '<strong>' + e(ledger.state.name) + '</strong></div><div class="mobile-switch">' + switcher('mobile') +
    '</div><div class="top-meta">' + (demoMode ? tag('示例账本') + button('创建账本', 'create', 'plus', 'outline') : tag('云端账本', true)) + '</div></header>';
  const actions = (isShared() && canManage() ? button('邀请成员', 'invite', 'person', 'outline') : '') +
    (canWrite() ? button('记一笔', 'new', 'plus', 'primary') : '');
  const banner = issue ? '<div class="retry"><span>' + e(issue) + '</span>' + button('重试', 'retry', '', 'outline') + '</div>' : '';
  app.innerHTML = '<div class="shell"><aside class="side"><button class="brand" data-action="page" data-page="overview" aria-label="Wallet 账本总览"><span class="brand-mark"><svg aria-hidden="true" width="23" height="23" viewBox="0 0 24 24" fill="none"><path d="M3.5 6.5 7.3 18l4.7-8.1 4.7 8.1 3.8-11.5" stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span><b>Wallet</b><small>共享记账</small></span></button>' +
    '<div class="side-ledger">' + switcher('desktop') + '</div><div class="section-label">工作台</div><nav aria-label="主导航">' + nav() + '</nav><div class="side-foot">' + avatar(signed || member(who()).name, 0, 'avatar-lg') + '<div><strong>' + e(signed || member(who()).name) + '</strong><small>' + (signed ? accountLabel : '示例账本') + '</small></div>' +
    iconButton('账本与登录', 'account', 'dots') + '</div></aside><div class="workspace">' + upper + '<main class="main">' + banner +
    '<div class="page-head"><div><div class="eyebrow">' + (isShared() ? '共享账本' : '个人账本') + '</div><h1>' + title + '</h1><p>' + description + '</p></div><div class="head-actions">' + actions + '</div></div>' +
    ({ overview, records: recordPage, settlements, analytics, members: membersPage }[page]()) + '</main></div><nav class="mobile-tabs" aria-label="移动导航">' + nav() + '</nav></div>';
}

async function api(path, data) {
  const version = sessionVersion;
  const result = await requestApi(path, data);
  if (version !== sessionVersion) throw new Error('登录状态已变化，请重新操作。');
  return result;
}

function toast(message) {
  const node = document.createElement('div');
  node.className = 'toast';
  node.innerHTML = icon('info', 15) + '<span>' + e(message) + '</span>';
  document.querySelector('#notices').append(node);
  setTimeout(() => node.remove(), 4300);
}

async function listLedgers() {
  const account = user;
  if (!account) return;
  const result = await api('ledgers');
  if (account === user) ledgers = result.ledgers;
}

async function selectLedger(id, saveSelection = true) {
  const seq = ++loadSequence;
  const selected = id === 'demo' ? demo : await api('ledgers/' + id);
  if (seq !== loadSequence) return;
  ledger = selected;
  month = moment;
  page = 'overview';
  menu = '';
  query = '';
  showDeleted = false;
  typeFilter = 'all';
  categoryFilter = 'all';
  issue = '';
  if (saveSelection) remember(id);
  render();
}

function clearSession() {
  sessionVersion++;
  user = null;
  ledgers = [];
  modal.close();
  void selectLedger('demo', false);
}

async function refresh() {
  const id = ledger.id;
  if (id === 'demo' || modal.open || busy || document.hidden) return;
  try {
    const latest = await api('ledgers/' + id);
    if (ledger.id !== id || modal.open || busy) return;
    if (latest.version > ledger.version || JSON.stringify(latest.members) !== JSON.stringify(ledger.members)) {
      ledger = latest;
      if (document.activeElement?.id !== 'search') render();
      else document.querySelector('#record-results').innerHTML = records(filteredRecords());
    }
  } catch (error) {
    if (accountAuth && ledger.id === id && error.status === 401) {
      clearSession();
      toast('登录状态已失效，请重新登录。');
    }
    if (ledger.id === id && error.status === 404) {
      toast('你已无法访问该账本。');
      await listLedgers();
      await selectLedger('demo');
    }
  }
}

async function submitAction(action) {
  if (ledger.id === 'demo') {
    mutate(ledger.state, action, ledger.members, who());
    saveDemo();
    return;
  }
  try {
    ledger = await api('ledgers/' + ledger.id + '/actions', { version: ledger.version, action });
    if (action.kind === 'rename') {
      const listed = ledgers.find(item => item.id === ledger.id);
      if (listed) listed.name = ledger.state.name;
    }
  } catch (error) {
    if (error.status === 409) {
      try { ledger = await api('ledgers/' + ledger.id); } catch { /* Preserve the current view if refresh fails. */ }
      toast('账本刚刚更新，请重新打开当前表单。');
      modal.close();
      render();
    }
    throw error;
  }
}

function field(label, control) { return '<label class="form-field"><span>' + label + '</span>' + control + '</label>'; }
function input(name, value, attributes = '') { return '<input name="' + e(name) + '" value="' + e(value) + '" ' + attributes + '>'; }
function select(name, items, current, attributes = '') { return '<select name="' + name + '" ' + attributes + '>' + options(items, current) + '</select>'; }
function amountInput(name, amount, more = '') { return input(name, amount === '' ? '' : decimal(amount), 'inputmode="decimal" placeholder="0.00" ' + more); }
function choices(list = activeMembers()) { return list.map(item => [item.id, item.name + (item.active ? '' : '（已移除）')]); }

function dialog(title, description, body, footer = '', submit = null) {
  modal.innerHTML = '<form><div class="dialog-head"><div><h2 id="dialog-title">' + e(title) + '</h2>' + (description ? '<p>' + e(description) + '</p>' : '') + '</div>' +
    iconButton('关闭', 'close', 'close') + '</div><div class="dialog-content">' + body + '<div class="form-error" hidden role="alert"></div></div><div class="dialog-foot">' + footer + '</div></form>';
  if (!modal.open) modal.showModal();
  if (submit) {
    modal.querySelector('form').addEventListener('submit', async event => {
      event.preventDefault();
      if (busy) return;
      elementBusy(true);
      const form = event.currentTarget;
      const errorBox = form.querySelector('.form-error');
      errorBox.hidden = true;
      try {
        await submit(new FormData(form), event.submitter?.value);
      } catch (error) {
        if (modal.open && form.isConnected) {
          errorBox.textContent = error.message;
          errorBox.hidden = false;
        }
      } finally {
        elementBusy(false);
      }
    });
  }
}

function elementBusy(value) {
  busy = value;
  for (const button of modal.querySelectorAll('.dialog-foot button, .dialog-head button')) button.disabled = value;
}

modal.addEventListener('cancel', event => { if (busy) event.preventDefault(); });

function submitFooter(text = '保存', alternate = '') {
  return button('取消', 'close', '', 'outline') + alternate + '<button class="btn primary" type="submit">' + e(text) + '</button>';
}
function finish(text) { modal.close(); render(); if (text) toast(text); }

function passwordDialog(register, savedUsername = '') {
  const title = register ? '注册 Wallet' : '登录 Wallet';
  const description = register ? '密码需为 8–32 位，以字母或数字开头，并包含大写、小写、数字或符号中的至少三类。' : '';
  const passwordAttributes = register ? 'autocomplete="new-password" minlength="8"' : 'autocomplete="current-password"';
  const fields = field('用户名', input('username', savedUsername,
    'autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="24" required autofocus')) +
    field('密码', input('password', '', 'type="password" maxlength="32" required ' + passwordAttributes)) +
    (register ? field('确认密码', input('confirmation', '',
      'type="password" autocomplete="new-password" maxlength="32" required')) : '');
  const alternate = register ? button('返回登录', 'login', '', 'outline') : button('注册账号', 'register', '', 'outline');
  dialog(title, description, fields, submitFooter(register ? '注册' : '登录', alternate), async data => {
    const username = String(data.get('username')).trim();
    const password = String(data.get('password'));
    if (register) {
      if (password !== data.get('confirmation')) throw new Error('两次输入的密码不一致。');
      await accountAuth.register(username, password);
    }
    try {
      await accountAuth.signIn(username, password);
    } catch (error) {
      if (!register) throw error;
      passwordDialog(false, username);
      toast('账号已创建，请输入密码登录。');
      return;
    }
    modal.close();
    await initialize();
  });
}

function loginDialog() {
  if (accountAuth) return passwordDialog(false);
  const target = invitation ? '/?invite=' + encodeURIComponent(invitation) : '/';
  dialog('登录 Wallet', '使用 ChatGPT 账号创建、加入和同步账本。', '<a class="btn primary" target="_top" href="/signin-with-chatgpt?return_to=' +
    encodeURIComponent(target) + '">使用 ChatGPT 登录</a>', button('继续体验示例', 'close', '', 'outline'));
}

function createDialog() {
  if (!user) return loginDialog();
  dialog('创建账本', '创建后可在这里记账，共享账本还可以邀请其他成员。',
    field('账本名称', input('name', '', 'required maxlength="40" placeholder="例如：周末旅行" autofocus')) +
    field('账本类型', select('kind', [['shared', '共享账本'], ['personal', '个人账本']], 'shared')) +
    field('我的显示昵称', input('displayName', user.name, 'maxlength="40"')), submitFooter('创建账本'),
    async data => {
      const { id } = await api('ledgers', Object.fromEntries(data));
      await listLedgers();
      await selectLedger(id);
      finish('账本已创建');
    });
}

function joinDialog() {
  if (!user) return loginDialog();
  dialog('加入共享账本', '输入成员发给你的邀请码，或粘贴完整的邀请链接。',
    field('邀请码或链接', input('code', invitation, 'required maxlength="500" placeholder="粘贴邀请码或链接" autofocus')) +
    field('我的显示昵称', input('displayName', user.name, 'maxlength="40"')), submitFooter('加入账本'),
    async data => {
      let code = String(data.get('code')).trim();
      try {
        const url = new URL(code);
        code = new URLSearchParams(url.hash.slice(1)).get('invite') ?? url.searchParams.get('invite') ?? '';
      } catch { /* Raw code is also accepted. */ }
      const { id } = await api('join', { code, displayName: data.get('displayName') });
      invitation = '';
      const url = new URL(location.href);
      const fragment = new URLSearchParams(url.hash.slice(1));
      if (fragment.has('invite')) {
        fragment.delete('invite');
        url.hash = fragment.toString();
      }
      url.searchParams.delete('invite');
      history.replaceState({}, '', url);
      await listLedgers();
      await selectLedger(id);
      finish('已加入共享账本');
    });
}

function inviteDialog() {
  if (ledger.id === 'demo') {
    dialog('邀请成员', '示例账本可以体验分摊和结算。创建共享账本后，你就可以生成邀请码。',
      '', button('取消', 'close', '', 'outline') + button('创建共享账本', 'create', 'plus', 'primary'));
    return;
  }
  dialog('邀请成员', '邀请码有效期为 7 天。重新生成或撤销会让旧邀请码失效。',
    '<p class="small muted">受邀成员登录 Wallet 后，即可使用邀请码加入账本。' + (accountAuth ? '' : '如果站点采用私有访问，还需要先获准访问 Wallet。') + '</p>',
    button('关闭', 'close', '', 'outline') + '<button type="submit" class="btn danger" value="revoke">撤销现有邀请</button><button type="submit" class="btn primary">生成邀请链接</button>',
    async (_data, action) => {
      const result = await api('ledgers/' + ledger.id + '/invite', { revoke: action === 'revoke' });
      if (action === 'revoke') return finish('邀请码已撤销');
      const link = location.origin + '/#invite=' + result.code;
      dialog('邀请链接已生成', '将链接或邀请码发给要加入账本的成员。',
        field('邀请链接', input('link', link, 'readonly')) +
        field('邀请码', input('code', result.code, 'readonly')) +
        '<p class="small muted">有效期至 ' + e(new Date(result.expires).toLocaleString('zh-CN')) + '</p>',
        button('完成', 'close', '', 'outline') + button('复制邀请码', 'copy-code', '', 'outline') + button('复制邀请链接', 'copy-link', 'copy', 'primary'));
    });
}

function budgetDialog() {
  const budget = ledger.state.budgets[month];
  dialog(budget ? '编辑预算' : '设置预算', monthLabel(month),
    field('月度预算（元）', amountInput('amount', budget ?? '', 'required autofocus')) +
    '<p class="small muted">填写 0 可清除这个月份的预算。</p>', submitFooter(),
    async data => {
      const amount = centsFromText(data.get('amount'));
      await submitAction({ kind: 'budget', month, amount });
      finish(amount ? '预算已保存' : '已清除本月预算');
    });
}

function renameDialog() {
  dialog('编辑账本名称', '', field('名称', input('name', ledger.state.name, 'required maxlength="40" autofocus')), submitFooter(),
    async data => { await submitAction({ kind: 'rename', name: data.get('name') }); finish('账本名称已更新'); });
}

function deleteLedgerDialog() {
  if (!canDeleteLedger()) return;
  const { id, version, state } = ledger;
  const warning = state.kind === 'shared' ?
    '所有成员都会失去访问权限，邀请链接也会失效。' : '';
  dialog('永久删除账本？', state.name,
    '<p class="note-box">删除后，账单、预算和结算记录将永久清除，无法恢复。' + warning + '</p>' +
    field('输入完整账本名称以确认', input('name', '', 'required maxlength="40" autocomplete="off" spellcheck="false"')),
    button('取消', 'close', '', 'outline') + '<button type="submit" class="btn danger">确认删除</button>',
    async data => {
      const name = data.get('name');
      if (name !== state.name) throw new Error('请输入完整的账本名称以确认删除。');
      let message = '账本已删除';
      try {
        await api('ledgers/' + id + '/delete', { name, version });
      } catch (error) {
        if (error.status === 409) {
          ledger = await api('ledgers/' + id);
          deleteLedgerDialog();
          toast('账本刚刚更新，请重新确认删除。');
          return;
        }
        if (error.status !== 404) throw error;
        await listLedgers();
        if (ledgers.some(item => item.id === id)) throw error;
        message = '该账本已无法访问。';
      }
      ledgers = ledgers.filter(item => item.id !== id);
      modal.close();
      await selectLedger('demo');
      toast(message);
    });
}

function roleDialog(id) {
  const target = member(id);
  dialog('管理成员', target.name, field('账本角色', select('role', Object.entries(roles).filter(([role]) => role !== 'owner'), target.role)) +
    '<p class="small muted">观察者只能查看。移除成员后，他们之前的账单和结算记录仍会保留。</p>',
    submitFooter(target.active ? '保存角色' : '恢复成员', target.active ? '<button type="submit" class="btn danger" value="remove">移除成员</button>' : ''),
    async (data, action) => {
      const changed = { id, role: data.get('role'), active: action !== 'remove' };
      if (ledger.id === 'demo') {
        Object.assign(target, changed);
        ledger.state.audit.unshift({ id: crypto.randomUUID(), actor: who(), time: Date.now(), description: (changed.active ? '更新了成员权限 · ' : '移除了成员 · ') + target.name });
        saveDemo();
      } else {
        await api('ledgers/' + ledger.id + '/members', changed);
        ledger = await api('ledgers/' + ledger.id);
      }
      finish(changed.active ? '成员权限已更新' : '已移除成员');
    });
}

function details(id, analysisType) {
  const record = ledger.state.records.find(item => item.id === id);
  if (!record) return;
  const allowed = canWrite() && (canManage() || record.author === who());
  const payment = (id, amount) => e(member(id).name) + ' ' + money(amount);
  const safeLabels = {
    '金额': money(record.amount),
    '日期': e(record.date),
    '类型': typeLabels[record.type],
    '分类': categories[record.category].name,
    '记录人': e(member(record.author).name),
  };
  if (record.type === 'expense') {
    safeLabels['付款明细'] = record.payments.map(({ id, amount }) => payment(id, amount)).join('<br>');
    safeLabels['分摊明细'] = record.method === 'none' ? '不分摊' : record.splits.map(({ id, amount }) => payment(id, amount)).join('<br>');
  } else {
    safeLabels[record.type === 'repayment' ? '付款成员' : '入账成员'] = e(member(record.payer).name);
    if (record.type === 'repayment') safeLabels['收款成员'] = e(member(record.recipient).name);
  }
  const body = '<div class="details-grid">' + Object.entries(safeLabels).map(([label, value]) => '<span>' + label + '</span><strong>' + value + '</strong>').join('') + '</div>' +
    (record.note ? '<div class="note-box">' + e(record.note) + '</div>' : '');
  const data = 'data-id="' + e(id) + '"';
  const actions = record.deleted ? button('恢复账单', 'restore', 'history', 'primary', data) :
    button('删除账单', 'delete', '', 'danger', data) + (record.type === 'repayment' ? '' : button('编辑账单', 'edit', 'edit', 'primary', data));
  const back = analysisType ? button('返回分析', 'month-analysis', 'left', 'outline', 'data-type="' + e(analysisType) + '"') :
    button('关闭', 'close', '', 'outline');
  dialog(record.title, record.deleted ? '该账单在回收站中。' : '', body, back + (allowed ? actions : ''));
}

function deleteDialog(id, restoring) {
  const item = ledger.state.records.find(record => record.id === id);
  if (!item) return;
  dialog(restoring ? '恢复这条账单？' : '将这条账单移入回收站？', item.title,
    '<p class="small muted">' + (restoring ? '账单会重新参与统计和结算。' : '删除后会重新计算统计和结算。你可以在回收站恢复。') + '</p>',
    submitFooter(restoring ? '恢复账单' : '移入回收站'),
    async () => {
      await submitAction({ kind: restoring ? 'restore' : 'delete', id });
      finish(restoring ? '账单已恢复' : '账单已移入回收站');
    });
}

function repayDialog(payer, recipient, total) {
  dialog('登记还款', member(payer).name + ' → ' + member(recipient).name,
    '<p class="split-caption">最多可登记 ' + money(total) + '。款项由成员在线下转账。</p>' +
    '<div class="two-fields">' + field('还款金额（元）', amountInput('amount', total, 'required autofocus')) +
    field('还款日期', input('date', dateKey(), 'required type="date"')) + '</div>' +
    field('备注 <small>可选</small>', '<textarea name="note" maxlength="300" placeholder="例如：已通过微信转账"></textarea>'),
    submitFooter('登记还款'),
    async data => {
      await submitAction({ kind: 'record', type: 'repayment', title: '还款结算', payer, recipient, amount: centsFromText(data.get('amount')), date: data.get('date'), note: data.get('note') });
      finish('还款已登记');
    });
}

function recordDialog(record = null) {
  let type = record?.type ?? 'expense';
  let method = record?.method ?? 'none';
  const payerIds = new Set(record?.payments?.map(item => item.id) ?? []);
  const splitIds = new Set(record?.splits?.map(item => item.id) ?? []);
  const available = ledger.members.filter(item => item.active || payerIds.has(item.id) || splitIds.has(item.id) || record?.payer === item.id);
  let multi = payerIds.size > 1;
  const names = choices(available);
  const payAmounts = Object.fromEntries((record?.payments ?? []).map(item => [item.id, decimal(item.amount)]));
  const shares = Object.fromEntries((record?.specifications ?? []).map(({ id, value }) => [id, method === 'fixed' || method === 'percentage' ? decimal(value) : String(value)]));
  const enabled = new Set(method === 'none' ? activeMembers().map(item => item.id) : splitIds);
  let base = {
    title: record?.title ?? '', amount: record ? decimal(record.amount) : '', date: record?.date ?? dateKey(),
    note: record?.note ?? '', category: record?.category ?? 'dining', payer: record?.payer ?? record?.payments?.[0]?.id ?? who(),
  };
  let changed = false;

  function draw() {
    const tabs = record ? '' : '<div class="mode-tabs" aria-label="账单类型">' + ['expense', 'income'].map(key =>
      '<button type="button" data-mode="' + key + '" aria-pressed="' + String(type === key) + '" class="' + (type === key ? 'chosen' : '') + '">' + typeLabels[key] + '</button>',
    ).join('') + '</div>';
    const categoriesForType = (type === 'expense' ? expenseCategories : incomeCategories).map(key => [key, categories[key].name]);
    const paymentHeader = type === 'income' ? '入账成员' : '付款成员';
    const payment = multi && type === 'expense' ? '<div class="split-box">' + available.map(item => '<label class="split-line"><span>' + e(item.name) + '</span>' +
      input('payment:' + item.id, payAmounts[item.id] ?? '', 'inputmode="decimal" placeholder="实付金额" aria-label="' + e(item.name) + '实付金额"') + '</label>').join('') + '</div>' :
      field(paymentHeader, select('payer', names, base.payer));
    const payMode = type === 'expense' && names.length > 1 ? '<label class="split-line"><span>多人共同付款</span><input type="checkbox" id="multi-pay"' + (multi ? ' checked' : '') + '></label>' : '';
    const showSplitMode = type === 'expense' && isShared();
    const split = showSplitMode ? field('分摊方式 <small>可选</small>', select('method', [['none', '不分摊'], ...Object.entries(methods)], method)) : '';
    const splitDetails = showSplitMode && method !== 'none' ? '<div class="split-box">' + available.map(item => '<div class="split-line"><label><input type="checkbox" name="include:' + e(item.id) + '"' + (enabled.has(item.id) ? ' checked' : '') + '>' + person(item.id) + e(item.name) + '</label>' +
        (method === 'equal' ? '<strong data-preview="' + e(item.id) + '"></strong>' : input('share:' + item.id, shares[item.id] ?? (method === 'shares' ? '1' : ''), 'inputmode="' + (method === 'shares' ? 'numeric' : 'decimal') + '" placeholder="' + ({ fixed: '金额（元）', percentage: '比例（%）', shares: '份数' }[method]) + '" aria-label="' + e(item.name) + '分摊数值"')) +
        '</div>').join('') + '</div><div class="split-caption" id="split-summary" aria-live="polite"></div>' : '';
    const title = field('账单摘要', input('title', base.title, 'required maxlength="64" placeholder="例如：周末聚餐"' + (changed ? '' : ' autofocus')));
    dialog(record ? '编辑账单' : '记一笔', '', tabs + title +
      '<div class="two-fields">' + field('金额（元）', input('amount', base.amount, 'required inputmode="decimal" placeholder="0.00"')) + field('日期', input('date', base.date, 'required type="date"')) + '</div>' +
      field('分类', select('category', categoriesForType, base.category)) + payment + payMode + split + splitDetails +
      field('备注 <small>可选</small>', '<textarea name="note" maxlength="300" placeholder="添加备注">' + e(base.note) + '</textarea>'),
      submitFooter('保存账单'),
      async data => {
        storeForm(data);
        const amount = centsFromText(base.amount);
        const action = { kind: 'record', id: record?.id, type, title: base.title, amount, date: base.date, note: base.note, category: base.category };
        if (type === 'expense') {
          action.payments = multi ? available.filter(item => payAmounts[item.id]?.trim() && centsFromText(payAmounts[item.id]) !== 0)
            .map(item => ({ id: item.id, amount: centsFromText(payAmounts[item.id]) })) : [{ id: base.payer, amount }];
          action.method = isShared() ? method : 'equal';
          if (action.method !== 'none') action.specifications = isShared() ? specifications() : [{ id: who(), value: 1 }];
        } else action.payer = base.payer;
        await submitAction(action);
        if (page === 'overview' || (page === 'records' && !showDeleted)) month = action.date.slice(0, 7);
        finish(record ? '账单已更新' : '账单已保存');
      });
    const form = modal.querySelector('form');
    form.addEventListener('input', () => { storeForm(new FormData(form)); preview(); });
    form.addEventListener('change', event => {
      storeForm(new FormData(form));
      if (event.target.id === 'multi-pay') {
        multi = event.target.checked;
        if (multi && !Object.values(payAmounts).some(Boolean)) payAmounts[base.payer] = base.amount;
        changed = true;
        draw();
      } else if (event.target.name === 'method' && method !== event.target.value) {
        method = event.target.value;
        for (const key of Object.keys(shares)) delete shares[key];
        changed = true;
        draw();
        modal.querySelector('[name="method"]').focus();
      } else preview();
    });
    for (const tab of form.querySelectorAll('[data-mode]')) tab.addEventListener('click', () => {
      if (tab.dataset.mode === type) return;
      storeForm(new FormData(form));
      type = tab.dataset.mode;
      base.category = type === 'income' ? 'contribution' : 'dining';
      changed = true;
      draw();
      modal.querySelector('[data-mode="' + type + '"]').focus();
    });
    preview();
  }

  function storeForm(data) {
    for (const key of Object.keys(base)) if (data.has(key)) base[key] = data.get(key);
    if (type === 'expense') for (const item of available) {
      if (data.has('payment:' + item.id)) payAmounts[item.id] = String(data.get('payment:' + item.id));
      if (data.has('share:' + item.id)) shares[item.id] = String(data.get('share:' + item.id));
      if (data.has('method') && method !== 'none') {
        if (data.has('include:' + item.id)) enabled.add(item.id);
        else enabled.delete(item.id);
      }
    }
  }

  function specifications() {
    return available.filter(item => enabled.has(item.id)).map(item => {
      const value = (shares[item.id] ?? (method === 'shares' ? '1' : '')).trim();
      const numeric = method === 'equal' ? 1 : method === 'shares' ? (/^\d+$/.test(value) ? Number(value) : NaN) : centsFromText(value || '0');
      return { id: item.id, value: numeric };
    });
  }

  function preview() {
    const target = modal.querySelector('#split-summary');
    if (!target) return;
    const amount = centsFromText(base.amount);
    const lines = [...modal.querySelectorAll('[data-preview]')];
    for (const line of lines) line.textContent = enabled.has(line.dataset.preview) ? '—' : '';
    for (const item of available) {
      const input = modal.querySelector('[name="share:' + CSS.escape(item.id) + '"]');
      if (input) input.disabled = !enabled.has(item.id);
    }
    if (!amount) { target.textContent = '填写金额后可查看分摊结果。'; return; }
    try {
      const result = allocate(amount, method, specifications());
      const map = Object.fromEntries(result.map(item => [item.id, item.amount]));
      for (const line of lines) if (Object.hasOwn(map, line.dataset.preview)) line.textContent = money(map[line.dataset.preview]);
      target.textContent = method === 'equal' ? '已分摊 ' + money(amount) + ' · ' + result.length + ' 位成员' :
        result.map(item => member(item.id).name + ' ' + money(item.amount)).join(' · ');
    } catch (error) { target.textContent = error.message; }
  }

  draw();
}

function exportCsv() {
  const escapeCell = (value) => {
    let text = String(value ?? '');
    if (/^[\s\uFEFF]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  const headers = ['日期', '类型', '摘要', '分类', '金额（元）', '付款 / 入账成员（元）', '分摊 / 收款成员（元）', '备注'];
  const rows = filteredRecords().map(item => {
    const paymentInfo = item.type === 'expense' ? item.payments.map(({ id, amount }) => member(id).name + ' ' + decimal(amount)).join(' / ') : member(item.payer).name;
    const splitInfo = item.type === 'expense' ? item.splits.map(({ id, amount }) => member(id).name + ' ' + decimal(amount)).join(' / ') : item.recipient ? member(item.recipient).name : '';
    return [item.date, typeLabels[item.type], item.title, categories[item.category].name, decimal(item.amount), paymentInfo, splitInfo, item.note];
  });
  if (!rows.length) return toast('当前没有可导出的账单。');
  const text = [headers, ...rows].map(row => row.map(escapeCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF' + text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'Wallet-' + (showDeleted ? '回收站' : month) + '.csv';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('账单已导出');
}

function changePage(next) {
  if (Object.hasOwn(pages, next)) page = next;
  menu = '';
  render();
  window.scrollTo(0, 0);
}

const actions = {
  page: ({ page }) => changePage(page),
  'ledger-menu': ({ location }) => {
    menu = menu === location ? '' : location;
    render();
    app.querySelector('[data-location="' + location + '"]')?.focus();
  },
  switch: async ({ id }) => { try { await selectLedger(id); } catch (error) { toast(error.message); } },
  create: createDialog,
  login: loginDialog,
  register: () => { if (accountAuth) passwordDialog(true); },
  join: joinDialog,
  invite: inviteDialog,
  budget: budgetDialog,
  rename: renameDialog,
  'delete-ledger': deleteLedgerDialog,
  role: ({ id }) => roleDialog(id),
  'calendar-day': ({ date }) => calendarDayDialog(date),
  'month-analysis': ({ type }) => monthlyAnalysis(type),
  details: ({ id }, target) => details(id, target.closest('[data-summary-type]')?.dataset.summaryType),
  edit: ({ id }) => recordDialog(ledger.state.records.find(item => item.id === id)),
  delete: ({ id }) => deleteDialog(id, false),
  restore: ({ id }) => deleteDialog(id, true),
  repay: ({ payer, recipient, amount }) => repayDialog(payer, recipient, Number(amount)),
  new: () => recordDialog(),
  close: () => modal.close(),
  'copy-link': () => copy('link'),
  'copy-code': () => copy('code'),
  export: exportCsv,
  retry: () => initialize(),
  trash: () => { showDeleted = !showDeleted; query = ''; typeFilter = 'all'; categoryFilter = 'all'; render(); },
  month: ({ delta }, target) => {
    const section = target.closest('.calendar-month') ? '.calendar-month' : '.toolbar';
    month = monthShift(month, Number(delta));
    render();
    app.querySelector(section + ' [data-delta="' + delta + '"]')?.focus({ preventScroll: true });
  },
  account: () => {
    if (!user) return loginDialog();
    if (accountAuth) {
      return dialog('我的账号', user.name, '<p class="small muted">登录后可跨设备查看云端账本。</p>',
        submitFooter('退出登录'), async () => { await accountAuth.signOut(); if (user) clearSession(); });
    }
    dialog('我的账号', user.name, '<p class="small muted">使用共享账本可以在登录后跨设备查看记录。</p>', button('关闭', 'close', '', 'outline') +
      '<a class="btn outline" href="/signout-with-chatgpt?return_to=%2F" target="_top">退出登录</a>');
  },
};

async function copy(name) {
  const field = modal.querySelector('[name="' + name + '"]');
  try { await navigator.clipboard.writeText(field.value); toast('已复制'); }
  catch { field.select(); toast('内容已选中，可以手动复制。'); }
}

document.addEventListener('click', event => {
  const target = event.target.closest('[data-action]');
  if (target) {
    const command = actions[target.dataset.action];
    if (command && !busy) command(target.dataset, target);
    return;
  }
  if (menu && !event.target.closest('.ledger-popup') && !modal.open) { menu = ''; render(); }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && menu && !modal.open) { menu = ''; render(); }
});

function refreshRecords() { document.querySelector('#record-results').innerHTML = records(filteredRecords()); }
app.addEventListener('input', event => {
  if (event.target.id === 'search') { query = event.target.value; refreshRecords(); }
});
app.addEventListener('change', event => {
  if (event.target.id === 'filter-type') { typeFilter = event.target.value; refreshRecords(); }
  if (event.target.id === 'filter-category') { categoryFilter = event.target.value; refreshRecords(); }
});

async function initialize() {
  try {
    ({ user } = await api('session'));
    if (!user) {
      ledgers = [];
      if (ledger.id !== 'demo') await selectLedger('demo', false);
    }
    await listLedgers();
    issue = '';
    const last = storedLedger();
    const match = ledgers.find(item => item.id === last) ?? (last !== 'demo' ? ledgers[0] : null);
    if (match) await selectLedger(match.id);
    else render();
  } catch {
    issue = '暂时无法加载云端账本。可以继续体验示例账本。';
    render();
  }
  const params = new URLSearchParams(location.hash.slice(1));
  invitation = params.get('invite') ?? new URLSearchParams(location.search).get('invite') ?? '';
  if (invitation && !modal.open) joinDialog();
}

render();
accountAuth?.onSignOut(clearSession);
void initialize();
setInterval(() => { void refresh().catch(() => {}); }, 5000);
window.addEventListener('focus', () => { void refresh().catch(() => {}); });
