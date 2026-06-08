import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { DataSourceOptions } from 'typeorm';

const DEFAULT_PORT = 5432;

function parseDbPort(value: string | undefined): number {
  if (!value) return DEFAULT_PORT;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? DEFAULT_PORT : parsed;
}

function sslEnabled(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}

export function getTypeOrmOptions(): TypeOrmModuleOptions {
  return {
    type: 'postgres',
    host: process.env.DB_HOST ?? 'localhost',
    port: parseDbPort(process.env.DB_PORT),
    username: process.env.DB_USER ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
    database: process.env.DB_NAME ?? 'smartstock_backend',
    autoLoadEntities: true,
    synchronize: false,
    logging: process.env.DB_LOGGING === 'true',
    ...(sslEnabled(process.env.DB_SSL) ? { ssl: { rejectUnauthorized: false } } : {}),
  };
}

export function getDataSourceOptions(): DataSourceOptions {
  return {
    ...(getTypeOrmOptions() as DataSourceOptions),
    entities: ['src/**/*.entity.ts', 'dist/**/*.entity.js'],
    migrations: ['src/database/migrations/*.ts', 'dist/src/database/migrations/*.js'],
  };
}
