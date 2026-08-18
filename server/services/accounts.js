import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { normalizeEmail } from '../lib/normalize.js';

export async function authenticateAccount(username, password) {
  const email = normalizeEmail(username);
  if (!email || typeof password !== 'string') return null;
  const result = await pool.query(`
    SELECT a.email, a.password_hash
    FROM accounts a
    JOIN domains d ON d.id = a.domain_id
    WHERE a.email = $1 AND a.enabled = TRUE AND d.enabled = TRUE
  `, [email]);
  const account = result.rows[0];
  if (!account?.password_hash || !(await bcrypt.compare(password, account.password_hash))) return null;
  return account.email.toLowerCase();
}
