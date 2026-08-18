import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'pg-mem';
process.env.APP_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
process.env.SESSION_SECRET = crypto.randomBytes(32).toString('hex');
process.env.ADMIN_PASSWORD = 'test-admin-password';
process.env.ALLOW_INSECURE_LOCAL = 'true';

const { pool, initDb, closeDb } = await import('../server/db.js');
const { completeInvitation, inspectInvitation, issueInvitation } = await import('../server/services/invitations.js');
const { authenticateAccount } = await import('../server/services/accounts.js');

await initDb();
const domain = await pool.query('INSERT INTO domains (name) VALUES ($1) RETURNING id', ['example.com']);

test('stores only an invite hash and activates credentials exactly once', async () => {
  const account = await pool.query(`INSERT INTO accounts (domain_id, email, forward_to)
    VALUES ($1, $2, $3) RETURNING id`, [domain.rows[0].id, 'alice@example.com', 'alice@personal.test']);
  let delivered;
  await issueInvitation(account.rows[0].id, { database: pool, deliver: async (message) => { delivered = message; } });

  assert.equal(delivered.personalEmail, 'alice@personal.test');
  assert.equal(delivered.workEmail, 'alice@example.com');
  assert.match(delivered.token, /^[A-Za-z0-9_-]{43}$/);
  const stored = await pool.query(`SELECT invite_token_hash AS "tokenHash", invite_sent_at AS "sentAt",
    password_hash AS "passwordHash" FROM accounts WHERE id = $1`, [account.rows[0].id]);
  assert.equal(stored.rows[0].tokenHash, crypto.createHash('sha256').update(delivered.token).digest('hex'));
  assert.notEqual(stored.rows[0].tokenHash, delivered.token);
  assert.ok(stored.rows[0].sentAt);
  assert.equal(stored.rows[0].passwordHash, null);

  const invitation = await inspectInvitation(delivered.token, pool);
  assert.equal(invitation.email, 'alice@example.com');
  const completed = await completeInvitation(delivered.token, 'employee-choice', pool);
  assert.equal(completed.email, 'alice@example.com');
  assert.equal(await inspectInvitation(delivered.token, pool), null);
  assert.equal(await completeInvitation(delivered.token, 'second-use', pool), null);
  assert.equal(await authenticateAccount('alice@example.com', 'employee-choice'), 'alice@example.com');
  assert.equal(await authenticateAccount('alice@example.com', 'second-use'), null);
});

test('a resent invitation invalidates the previous token', async () => {
  const account = await pool.query(`INSERT INTO accounts (domain_id, email, forward_to)
    VALUES ($1, $2, $3) RETURNING id`, [domain.rows[0].id, 'bob@example.com', 'bob@personal.test']);
  const tokens = [];
  const options = { database: pool, deliver: async ({ token }) => { tokens.push(token); } };
  await issueInvitation(account.rows[0].id, options);
  await issueInvitation(account.rows[0].id, options);
  assert.equal(await inspectInvitation(tokens[0], pool), null);
  assert.equal((await inspectInvitation(tokens[1], pool)).email, 'bob@example.com');
});

test.after(() => closeDb());
