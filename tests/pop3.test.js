import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import crypto from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'pg-mem';
process.env.APP_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
process.env.SESSION_SECRET = crypto.randomBytes(32).toString('hex');
process.env.ADMIN_PASSWORD = 'test-admin-password';
process.env.ALLOW_INSECURE_LOCAL = 'true';

const { pool, initDb, closeDb } = await import('../server/db.js');
const bcrypt = (await import('bcryptjs')).default;
const { createPop3Server } = await import('../server/services/pop3.js');

await initDb();
const domain = await pool.query('INSERT INTO domains (name) VALUES ($1) RETURNING id', ['example.com']);
await pool.query('INSERT INTO accounts (domain_id, email, password_hash) VALUES ($1, $2, $3)', [
  domain.rows[0].id, 'alice@example.com', await bcrypt.hash('employee-password', 4),
]);

test('POP3 authenticates and exposes an empty mailbox', async (t) => {
  const server = createPop3Server();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  const transcript = await new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    let data = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      data += chunk;
      if (data.includes('ready\r\n')) socket.write('USER alice@example.com\r\nPASS employee-password\r\nSTAT\r\nQUIT\r\n');
    });
    socket.on('end', () => resolve(data));
    socket.on('error', reject);
  });
  assert.match(transcript, /\+OK mailbox locked and ready/);
  assert.match(transcript, /\+OK 0 0/);
});

test.after(() => closeDb());
