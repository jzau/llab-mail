import { pool } from '../db.js';
import { decrypt, encrypt } from '../lib/crypto.js';

export async function getBrevoSettings() {
  const result = await pool.query(`SELECT key, value FROM settings
    WHERE key IN ('brevo_host', 'brevo_port', 'brevo_login', 'brevo_key')`);
  const values = Object.fromEntries(result.rows.map((row) => [row.key, row.value]));
  return {
    host: values.brevo_host || 'smtp-relay.brevo.com',
    port: Number(values.brevo_port || 587),
    login: values.brevo_login || null,
    key: values.brevo_key ? decrypt(values.brevo_key) : null,
  };
}

export async function getPublicBrevoSettings() {
  const value = await getBrevoSettings();
  return { host: value.host, port: value.port, login: value.login || '', keyConfigured: Boolean(value.key) };
}

export async function saveBrevoSettings({ host, port, login, key }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const values = [['brevo_host', host], ['brevo_port', String(port)], ['brevo_login', login]];
    if (key) values.push(['brevo_key', encrypt(key)]);
    for (const [setting, value] of values) {
      await client.query(`INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`, [setting, value]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
