import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export function localDb(path = ':memory:') {
  const sql = new DatabaseSync(path);
  const runSync = Symbol('runSync');
  if (!sql.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'wallet_ledgers'").get()) {
    sql.exec(readFileSync(new URL('../drizzle/0000_wallet.sql', import.meta.url), 'utf8'));
  }
  return {
    prepare(query) {
      function statement(values) {
        const compiled = sql.prepare(query);
        const run = () => ({ meta: compiled.run(...values) });
        return {
          first: async () => compiled.get(...values) ?? null,
          all: async () => ({ results: compiled.all(...values) }),
          run: async () => run(),
          [runSync]: run,
        };
      }
      return { ...statement([]), bind: (...values) => statement(values) };
    },
    async batch(statements) {
      sql.exec('BEGIN');
      try {
        const result = statements.map(statement => statement[runSync]());
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
