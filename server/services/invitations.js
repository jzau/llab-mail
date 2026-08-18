import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import { pool } from '../db.js';
import { config } from '../config.js';
import { getBrevoSettings } from './settings.js';

const INVITE_LIFETIME_MS = 24 * 60 * 60_000;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

export async function sendInvitationEmail({ personalEmail, workEmail, token }) {
  const brevo = await getBrevoSettings();
  if (!brevo.login || !brevo.key) throw new Error('Brevo SMTP is not configured');
  const transporter = nodemailer.createTransport({
    host: brevo.host,
    port: brevo.port,
    secure: brevo.port === 465,
    requireTLS: brevo.port !== 465 && !config.allowInsecureLocal,
    auth: { user: brevo.login, pass: brevo.key },
    tls: { minVersion: 'TLSv1.2', servername: brevo.host },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  });
  const setupUrl = `${config.publicBaseUrl.replace(/\/$/, '')}/set-password#token=${encodeURIComponent(token)}`;
  const safeWorkEmail = escapeHtml(workEmail);
  const safeSetupUrl = escapeHtml(setupUrl);
  await transporter.sendMail({
    from: { name: 'LLAB Mail', address: config.inviteSenderEmail },
    to: personalEmail,
    subject: `Set the password for ${workEmail}`,
    text: `Your company email account ${workEmail} is ready. Set your password within 24 hours:\n\n${setupUrl}\n\nCloudflare may also send a separate message asking you to verify this personal email for forwarding.`,
    html: `<p>Your company email account <strong>${safeWorkEmail}</strong> is ready.</p><p><a href="${safeSetupUrl}">Set your password</a> within 24 hours.</p><p>Cloudflare may also send a separate message asking you to verify this personal email for forwarding.</p><p>If you were not expecting this account, you can ignore this email.</p>`,
  });
}

export async function issueInvitation(accountId, { database = pool, deliver = sendInvitationEmail } = {}) {
  const account = await database.query(`SELECT email, forward_to AS "personalEmail"
    FROM accounts WHERE id = $1`, [accountId]);
  if (!account.rowCount || !account.rows[0].personalEmail) throw new Error('Account with personal email not found');

  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + INVITE_LIFETIME_MS);
  await database.query(`UPDATE accounts SET invite_token_hash = $1, invite_expires_at = $2,
    invite_sent_at = NULL, invite_last_error = NULL WHERE id = $3`, [tokenHash, expiresAt, accountId]);

  try {
    await deliver({ ...account.rows[0], workEmail: account.rows[0].email, token });
    await database.query(`UPDATE accounts SET invite_sent_at = CURRENT_TIMESTAMP, invite_last_error = NULL
      WHERE id = $1 AND invite_token_hash = $2`, [accountId, tokenHash]);
  } catch (error) {
    await database.query(`UPDATE accounts SET invite_last_error = $1
      WHERE id = $2 AND invite_token_hash = $3`, [String(error.message).slice(0, 1000), accountId, tokenHash]);
    throw error;
  }
  return { expiresAt };
}

export async function inspectInvitation(token, database = pool) {
  const result = await database.query(`SELECT email, invite_expires_at AS "expiresAt"
    FROM accounts WHERE invite_token_hash = $1 AND invite_expires_at > $2`, [hashToken(token), new Date()]);
  return result.rows[0] || null;
}

export async function completeInvitation(token, password, database = pool) {
  const passwordHash = await bcrypt.hash(password, 12);
  const result = await database.query(`UPDATE accounts SET password_hash = $1, password_set_at = CURRENT_TIMESTAMP,
      invite_token_hash = NULL, invite_expires_at = NULL, invite_last_error = NULL
    WHERE invite_token_hash = $2 AND invite_expires_at > $3 RETURNING email`,
  [passwordHash, hashToken(token), new Date()]);
  return result.rows[0] || null;
}
