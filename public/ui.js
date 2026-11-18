import { dateKey, monthShift } from './model.js';

const paths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  list: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6m-6 4h6m-6 4h4"/>',
  arrows: '<path d="M3 8h17m-4-4 4 4-4 4M21 16H4m4-4-4 4 4 4"/>',
  chart: '<path d="M4 3v17h17M9 16v-4m5 4V8m5 8V5"/>',
  people: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/><circle cx="9" cy="7" r="4"/>',
  person: '<circle cx="12" cy="7" r="4"/><path d="M5 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2m2-13v6m-3-3h6"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrowUp: '<path d="M12 19V5m-6 6 6-6 6 6"/>',
  'arrow-down': '<path d="M12 5v14m-6-6 6 6 6-6"/>',
  upRight: '<path d="M7 17 17 7M7 7h10v10"/>',
  downLeft: '<path d="M17 7 7 17m10 0H7V7"/>',
  wallet: '<rect x="3" y="5" width="18" height="15" rx="3"/><path d="M21 10h-5a2.5 2.5 0 0 0 0 5h5m-4-2.5h.01"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  home: '<path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zm6 11v-7h6v7"/>',
  bag: '<path d="M6 7h12l2 14H4L6 7zm3 2V6a3 3 0 0 1 6 0v3"/>',
  dining: '<path d="M4 3v6a3 3 0 0 0 6 0V3M7 3v18m12 0V3c-2 2-4 6-4 10h4"/>',
  car: '<path d="m5 11 1.5-4A2 2 0 0 1 8.4 6h7.2a2 2 0 0 1 1.9 1l1.5 4M5 11h14a2 2 0 0 1 2 2v4H3v-4a2 2 0 0 1 2-2zm0 6v3m14-3v3M7 14h.01m10 0h.01"/>',
  sparkle: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3z"/>',
  dots: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  history: '<path d="M3 12a9 9 0 1 1 2.5 6.2M3 5v7h7m2-5v5l3 2"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 4H6a2 2 0 0 0-2 2v10"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  edit: '<path d="m14.5 4.5 5 5M4 20l4.5-1 11-11a2.8 2.8 0 0 0-4-4l-11 11L4 20z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a13 13 0 0 1 0 18m0-18a13 13 0 0 0 0 18"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>',
  inbox: '<path d="m3 13 3-8h12l3 8v6H3v-6zm0 0h5l2 3h4l2-3h5"/>',
};

export function icon(name, size = 20) {
  return '<svg aria-hidden="true" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (paths[name] ?? paths.dots) + '</svg>';
}

export function escape(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

export const money = (cents) => '¥' + (Math.abs(cents) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const decimal = (cents) => (cents / 100).toFixed(2);
export const monthLabel = (month) => month.slice(0, 4) + ' 年 ' + Number(month.slice(5)) + ' 月';
export const shortDate = (date) => Number(date.slice(5, 7)) + '月' + Number(date.slice(8)) + '日';
const palette = ['violet', 'blue', 'orange', 'green', 'pink'];

export function avatar(name, index = 0, extra = '') {
  return '<span class="avatar ' + palette[index % palette.length] + ' ' + extra + '" title="' + escape(name) + '">' + escape(Array.from(name ?? '?')[0]?.toUpperCase() || '?') + '</span>';
}

export function demoLedger() {
  const members = [
    { id: 'demo-you', name: '小林', role: 'owner', active: true },
    { id: 'demo-zhou', name: '阿周', role: 'member', active: true },
    { id: 'demo-cheng', name: '程程', role: 'member', active: true },
    { id: 'demo-tang', name: '小唐', role: 'member', active: true },
  ];
  const ids = members.map(member => member.id);
  const month = dateKey().slice(0, 7);
  const day = Number(dateKey().slice(8));
  const state = { name: '四人宿舍账本', kind: 'shared', budgets: { [month]: 200000 }, records: [], audit: [] };
  function record(title, category, total, ago, payerIndex, offset = 0, income = false) {
    const date = monthShift(month, offset) + '-' + String(Math.max(1, Math.min(28, (offset ? 24 : day) - ago))).padStart(2, '0');
    const payer = ids[payerIndex];
    const id = 'demo-record-' + state.records.length;
    const entry = { id, date, title, category, amount: total, author: 'demo-you', note: '', created: Date.now() - ago * 3600000, type: income ? 'income' : 'expense' };
    if (income) entry.payer = payer;
    else Object.assign(entry, {
      payments: [{ id: payer, amount: total }],
      splits: ids.map(id => ({ id, amount: total / 4 })),
      specifications: ids.map(id => ({ id, value: 1 })),
      method: 'equal',
    });
    state.records.push(entry);
  }
  record('周末火锅聚餐', 'dining', 36800, 1, 0);
  record('超市日用品采购', 'groceries', 15680, 3, 1);
  record('宿舍电费', 'housing', 24000, 4, 2);
  record('宿舍公共基金', 'contribution', 180000, 5, 0, 0, true);
  record('外卖与饮品', 'dining', 12400, 7, 3);
  record('周末活动拼车', 'transport', 9600, 8, 0);
  record('公共清洁用品', 'groceries', 16720, 9, 0);
  record('电影之夜', 'fun', 13400, 10, 2);
  const history = [[58000, 100000], [92000, 125000], [74000, 112000], [107000, 145000], [102000, 156000]];
  history.forEach(([spend, income], i) => {
    record('上期共同支出', 'groceries', spend, 5, i % 4, i - 5);
    record('宿舍公共基金', 'contribution', income, 12, i % 4, i - 5, true);
  });
  state.audit = [{ id: 'demo-event', actor: 'demo-you', time: Date.now(), description: '创建了示例账本' }];
  return { id: 'demo', state, members, version: 0 };
}
