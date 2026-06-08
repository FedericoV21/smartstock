/**
 * Se ejecuta antes de cargar los `.e2e-spec.ts`.
 * Debe cumplir `env.validation.ts` (JWT + Postgres) para poder levantar `AppModule`.
 */
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'e2e-test-jwt-secret-do-not-use-in-production-32';
process.env.DB_HOST = process.env.DB_HOST || '127.0.0.1';
process.env.DB_PORT = process.env.DB_PORT || '5432';
process.env.DB_USER = process.env.DB_USER || 'postgres';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'postgres';
process.env.DB_NAME = process.env.DB_NAME || 'smartstock_backend';
process.env.DB_SSL = process.env.DB_SSL || 'false';
process.env.DB_LOGGING = process.env.DB_LOGGING || 'false';
process.env.ARCA_ENCRYPTION_KEY =
  process.env.ARCA_ENCRYPTION_KEY || '01234567890123456789012345678901';
process.env.ARCA_WORKER_STUB = process.env.ARCA_WORKER_STUB || 'false';
process.env.CRON_SECRET = process.env.CRON_SECRET || 'e2e-cron-secret';
