/**
 * Se ejecuta antes de cargar los `.e2e-spec.ts`.
 * Debe cumplir `env.validation.ts` (JWT + Postgres) para poder levantar `AppModule`.
 */
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
