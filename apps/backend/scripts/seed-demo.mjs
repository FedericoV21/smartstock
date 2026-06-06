/**
 * Carga datos demo en Postgres (mismo DB_* que Nest / TypeORM).
 * Uso (desde apps/backend): node --env-file=.env scripts/seed-demo.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const sqlPath = join(root, 'database', 'seed-demo.sql');

function parseDbPort(value) {
  if (!value) return 5432;
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? 5432 : n;
}

const client = new pg.Client({
  host: process.env.DB_HOST ?? 'localhost',
  port: parseDbPort(process.env.DB_PORT),
  user: process.env.DB_USER ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',
  database: process.env.DB_NAME ?? 'smartstock_backend',
  ...(process.env.DB_SSL === '1' || process.env.DB_SSL === 'true'
    ? { ssl: { rejectUnauthorized: false } }
    : {}),
});

const sql = readFileSync(sqlPath, 'utf8');

try {
  await client.connect();
  await client.query(sql);
  // eslint-disable-next-line no-console
  console.log('Seed demo OK. Tenant JWT tenant_id:', '00000000-0000-4000-8000-000000000001');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
