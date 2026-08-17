import pg from 'pg';
import { config } from './config.js';

let pool;
if (process.env.NODE_ENV === 'test' && process.env.DATABASE_URL === 'pg-mem') {
  const { newDb } = await import('pg-mem');
  const memory = newDb({ autoCreateForeignKeyIndices: true });
  const adapter = memory.adapters.createPg();
  pool = new adapter.Pool();
} else {
  pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'qq-mail-relay',
    ssl: config.databaseSsl ? { rejectUnauthorized: true } : false,
  });
}

pool.on('error', (error) => console.error('Unexpected PostgreSQL pool error:', error.message));
export { pool };

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS domains (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(253) NOT NULL UNIQUE,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS accounts (
      id BIGSERIAL PRIMARY KEY,
      domain_id BIGINT NOT NULL REFERENCES domains(id) ON DELETE RESTRICT,
      email VARCHAR(320) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS accounts_domain_id_idx ON accounts(domain_id);
    CREATE TABLE IF NOT EXISTS settings (
      key VARCHAR(100) PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

export async function closeDb() {
  await pool.end();
}
