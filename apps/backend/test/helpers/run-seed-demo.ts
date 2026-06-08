import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import pg from 'pg';

/** Carga seed demo en Postgres (misma lógica que `scripts/seed-demo.mjs`). */
export async function runSeedDemo(): Promise<void> {
  const sqlPath = join(__dirname, '..', '..', 'database', 'seed-demo.sql');
  const sql = readFileSync(sqlPath, 'utf8');

  const client = new pg.Client({
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number.parseInt(process.env.DB_PORT ?? '5432', 10),
    user: process.env.DB_USER ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
    database: process.env.DB_NAME ?? 'smartstock_backend',
  });

  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end().catch(() => {});
  }
}
