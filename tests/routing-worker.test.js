import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'pg-mem';
process.env.APP_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
process.env.SESSION_SECRET = crypto.randomBytes(32).toString('hex');
process.env.ADMIN_PASSWORD = 'test-admin-password';
process.env.ALLOW_INSECURE_LOCAL = 'true';

const { pool, initDb, closeDb } = await import('../server/db.js');
const { processRoutingQueue, queueAccountRouting } = await import('../server/services/routing-worker.js');

await initDb();

test('polls destination verification and creates a route when verified', async () => {
  const domain = await pool.query('INSERT INTO domains (name) VALUES ($1) RETURNING id', ['example.com']);
  const account = await pool.query(`INSERT INTO accounts (domain_id, email, password_hash, forward_to)
    VALUES ($1, $2, $3, $4) RETURNING id`, [domain.rows[0].id, 'alice@example.com', 'hash', 'alice@qq.com']);
  await queueAccountRouting(account.rows[0].id);

  let verified = null;
  let ruleCalls = 0;
  const fakeClient = {
    findZone: async () => 'zone-1',
    ensureDestination: async () => ({ id: 'destination-1', email: 'alice@qq.com', verified }),
    ensureRoutingRule: async () => {
      ruleCalls += 1;
      return { id: 'rule-1' };
    },
  };
  const run = () => processRoutingQueue({
    database: pool,
    settings: { accountId: 'account-1', apiToken: 'token-1' },
    clientFactory: () => fakeClient,
  });

  await run();
  let state = await pool.query(`SELECT routing_status AS status, cloudflare_destination_id AS "destinationId"
    FROM accounts WHERE id = $1`, [account.rows[0].id]);
  assert.equal(state.rows[0].status, 'pending_verification');
  assert.equal(state.rows[0].destinationId, 'destination-1');
  assert.equal(ruleCalls, 0);

  verified = new Date().toISOString();
  await pool.query('UPDATE accounts SET routing_next_check_at = $1 WHERE id = $2', [new Date(), account.rows[0].id]);
  await run();
  state = await pool.query(`SELECT routing_status AS status, cloudflare_rule_id AS "ruleId",
    routing_next_check_at AS "nextCheck" FROM accounts WHERE id = $1`, [account.rows[0].id]);
  assert.equal(state.rows[0].status, 'active');
  assert.equal(state.rows[0].ruleId, 'rule-1');
  assert.equal(state.rows[0].nextCheck, null);
  assert.equal(ruleCalls, 1);
});

test.after(() => closeDb());
