export function calendarDays(records, month) {
  const first = new Date(month + '-01T00:00:00Z');
  const last = new Date(first);
  last.setUTCMonth(first.getUTCMonth() + 1, 0);
  const offset = (first.getUTCDay() + 6) % 7;
  const days = Array.from({ length: last.getUTCDate() }, (_, index) => ({
    date: month + '-' + String(index + 1).padStart(2, '0'),
    income: 0,
    spending: 0,
    records: [],
  }));

  for (const record of records) {
    const day = days[Number(record.date.slice(8)) - 1];
    if (record.deleted || day?.date !== record.date) continue;
    if (record.type === 'income') day.income += record.amount;
    if (record.type === 'expense') day.spending += record.amount;
    day.records.push(record);
  }
  return { offset, days };
}
