import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { SMTPServer } from 'smtp-server';
import nodemailer from 'nodemailer';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'pg-mem';
process.env.APP_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
process.env.SESSION_SECRET = crypto.randomBytes(32).toString('hex');
process.env.ADMIN_PASSWORD = 'test-admin-password';
process.env.ALLOW_INSECURE_LOCAL = 'true';

const { pool, initDb, closeDb } = await import('../server/db.js');
const bcrypt = (await import('bcryptjs')).default;
const { saveBrevoSettings } = await import('../server/services/settings.js');
const { createSmtpServer } = await import('../server/services/smtp.js');

await initDb();
const domain = await pool.query('INSERT INTO domains (name) VALUES ($1) RETURNING id', ['example.com']);
await pool.query('INSERT INTO accounts (domain_id, email, password_hash) VALUES ($1, $2, $3)', [
  domain.rows[0].id, 'alice@example.com', await bcrypt.hash('employee-password', 4),
]);

test('SMTP authenticates locally and relays through upstream credentials', async (t) => {
  let received = '';
  const upstream = new SMTPServer({
    secure: false,
    disabledCommands: ['STARTTLS'],
    allowInsecureAuth: true,
    authMethods: ['PLAIN', 'LOGIN'],
    onAuth(auth, _session, callback) {
      callback(null, auth.username === 'brevo-login' && auth.password === 'brevo-key' ? { user: auth.username } : false);
    },
    onData(stream, _session, callback) {
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => { received += chunk; });
      stream.on('end', callback);
    },
    logger: false,
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => upstream.close(resolve)));
  await saveBrevoSettings({ host: '127.0.0.1', port: upstream.server.address().port, login: 'brevo-login', key: 'brevo-key' });

  const relay = createSmtpServer();
  await new Promise((resolve) => relay.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => relay.close(resolve)));
  const transport = nodemailer.createTransport({
    host: '127.0.0.1', port: relay.server.address().port, secure: false, ignoreTLS: true,
    auth: { user: 'alice@example.com', pass: 'employee-password' },
  });
  await transport.sendMail({ from: 'Alice <alice@example.com>', to: 'recipient@example.net', subject: 'Relay test', text: 'It works.' });
  assert.match(received, /From: Alice <alice@example.com>/);
  assert.match(received, /Subject: Relay test/);
  await assert.rejects(
    transport.sendMail({ from: 'other@example.com', to: 'recipient@example.net', subject: 'Spoof', text: 'Blocked.' }),
    /Envelope sender must be alice@example.com/,
  );
});

test.after(() => closeDb());
