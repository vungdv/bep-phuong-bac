import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import { loadConfig } from '../config.js';
import { MIGRATIONS_DIR, MIGRATIONS_TABLE } from '../store/pool.js';

/** Applies pending forward-only migrations. Re-running is a no-op. */
export async function migrate(databaseUrl: string, dir: string = MIGRATIONS_DIR): Promise<string[]> {
  const applied = await runner({
    databaseUrl,
    dir,
    direction: 'up',
    migrationsTable: MIGRATIONS_TABLE,
    count: Infinity,
    log: () => {},
  });
  return applied.map((m) => m.name);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { databaseUrl } = loadConfig();
  migrate(databaseUrl)
    .then((names) => {
      console.log(JSON.stringify({ msg: 'migrations applied', applied: names }));
    })
    .catch((err: unknown) => {
      console.error(err);
      process.exit(1);
    });
}
