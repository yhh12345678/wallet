import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export function localDb(path = ':memory:') {
  const sql = new DatabaseSync(path);
  if (!sql.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'wallet_ledgers'").get()) {
    sql.exec(readFileSync(new URL('../drizzle/0000_wallet.sql', import.meta.url), 'utf8'));
  }
  return {
    prepare(query) {
      function statement(values) {
        const compiled = sql.prepare(query);
        return {
          first: async () => compiled.get(...values) ?? null,
          all: async () => ({ results: compiled.all(...values) }),
          run: async () => ({ meta: compiled.run(...values) }),
        };
      }
      return { ...statement([]), bind: (...values) => statement(values) };
    },
    async batch(statements) {
      sql.exec('BEGIN');
      try {
        const result = [];
        for (const statement of statements) result.push(await statement.run());
        sql.exec('COMMIT');
        return result;
      } catch (error) {
        sql.exec('ROLLBACK');
        throw error;
      }
    },
    close() { sql.close(); },
  };
}
