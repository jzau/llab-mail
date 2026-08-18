import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { pool } from '../db.js';
import { config } from '../config.js';
import { domainPattern, normalizeDomain, normalizeEmail } from '../lib/normalize.js';
import { getCloudflareSettings, getPublicBrevoSettings, getPublicCloudflareSettings, saveBrevoSettings, saveCloudflareSettings } from '../services/settings.js';
import { queueAccountRouting, requeueUnfinishedRouting } from '../services/routing-worker.js';
import { CloudflareClient } from '../services/cloudflare.js';

export const adminRouter = express.Router();
const COOKIE = 'relay_admin';
const domainSchema = z.object({ name: z.string().transform(normalizeDomain).refine((v) => domainPattern.test(v), 'Invalid domain') });
const accountSchema = z.object({
  localPart: z.string().trim().min(1, 'Name is required').max(64).refine((value) => !value.includes('@'), 'Enter only the name before @'),
  domain: z.string().transform(normalizeDomain).refine((value) => domainPattern.test(value), 'Invalid domain'),
  forwardTo: z.string().trim().email('Invalid forwarding email').max(90),
  password: z.string().min(1, 'Password is required').max(200),
});
const brevoSchema = z.object({
  host: z.string().trim().min(1).max(253),
  port: z.coerce.number().int().min(1).max(65535),
  login: z.string().trim().min(1).max(320),
  key: z.string().max(500).optional().default(''),
});
const cloudflareSchema = z.object({
  accountId: z.string().trim().min(1).max(32),
  apiToken: z.string().trim().max(500).optional().default(''),
});

function token() {
  return jwt.sign({ role: 'admin' }, config.sessionSecret, { expiresIn: '12h', issuer: 'qq-mail-relay' });
}

function requireAdmin(req, res, next) {
  try {
    jwt.verify(req.cookies[COOKIE], config.sessionSecret, { issuer: 'qq-mail-relay' });
    next();
  } catch {
    res.status(401).json({ error: 'Authentication required' });
  }
}

function mutationOrigin(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const origin = req.get('origin');
  const host = req.get('host');
  try {
    if (origin && new URL(origin).host !== host) return res.status(403).json({ error: 'Invalid origin' });
  } catch {
    return res.status(403).json({ error: 'Invalid origin' });
  }
  next();
}

adminRouter.post('/login', async (req, res) => {
  const candidate = typeof req.body?.password === 'string' ? req.body.password : '';
  const valid = config.adminPasswordHash
    ? await bcrypt.compare(candidate, config.adminPasswordHash)
    : candidate.length > 0 && candidate === config.adminPassword;
  if (!valid) return res.status(401).json({ error: 'Invalid password' });
  res.cookie(COOKIE, token(), { httpOnly: true, sameSite: 'strict', secure: config.production, maxAge: 12 * 60 * 60 * 1000, path: '/' });
  res.json({ ok: true });
});

adminRouter.post('/logout', (_req, res) => {
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

adminRouter.use(requireAdmin, mutationOrigin);
adminRouter.get('/me', (_req, res) => res.json({ authenticated: true }));

adminRouter.get('/state', async (_req, res) => {
  const [domainsResult, accountsResult, brevo, cloudflare] = await Promise.all([
    pool.query('SELECT id, name, enabled, created_at AS "createdAt" FROM domains ORDER BY name'),
    pool.query(`SELECT id, email, forward_to AS "forwardTo", routing_status AS "routingStatus",
      routing_verified_at AS "routingVerifiedAt", routing_expires_at AS "routingExpiresAt",
      routing_last_error AS "routingError", enabled, created_at AS "createdAt" FROM accounts ORDER BY email`),
    getPublicBrevoSettings(),
    getPublicCloudflareSettings(),
  ]);
  res.json({ domains: domainsResult.rows, accounts: accountsResult.rows, brevo, cloudflare });
});

adminRouter.post('/domains', async (req, res) => {
  const parsed = domainSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  try {
    const result = await pool.query('INSERT INTO domains (name) VALUES ($1) RETURNING id, name', [parsed.data.name]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(409).json({ error: error.code === '23505' ? 'Domain already exists' : 'Could not add domain' });
  }
});

adminRouter.patch('/domains/:id', async (req, res) => {
  const enabled = typeof req.body?.enabled === 'boolean' ? req.body.enabled : null;
  if (enabled === null) return res.status(400).json({ error: 'enabled must be a boolean' });
  const result = await pool.query('UPDATE domains SET enabled = $1 WHERE id = $2', [enabled, req.params.id]);
  result.rowCount ? res.json({ ok: true }) : res.status(404).json({ error: 'Domain not found' });
});

adminRouter.delete('/domains/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM domains WHERE id = $1', [req.params.id]);
    result.rowCount ? res.json({ ok: true }) : res.status(404).json({ error: 'Domain not found' });
  } catch (error) {
    if (error.code === '23503') return res.status(409).json({ error: 'Delete this domain’s accounts first' });
    throw error;
  }
});

adminRouter.post('/accounts', async (req, res) => {
  const parsed = accountSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const domain = parsed.data.domain;
  const email = normalizeEmail(`${parsed.data.localPart}@${domain}`);
  if (!email) return res.status(400).json({ error: 'Invalid account name' });
  const domainResult = await pool.query('SELECT id FROM domains WHERE name = $1', [domain]);
  if (!domainResult.rowCount) return res.status(400).json({ error: 'Add the domain first' });
  try {
    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const result = await pool.query(`INSERT INTO accounts (domain_id, email, password_hash, forward_to)
      VALUES ($1, $2, $3, $4) RETURNING id, email`, [domainResult.rows[0].id, email, passwordHash, parsed.data.forwardTo.toLowerCase()]);
    await queueAccountRouting(result.rows[0].id);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(409).json({ error: error.code === '23505' ? 'Account already exists' : 'Could not add account' });
  }
});

adminRouter.patch('/accounts/:id', async (req, res) => {
  if (typeof req.body?.password === 'string') {
    if (!req.body.password.length) return res.status(400).json({ error: 'Password is required' });
    const hash = await bcrypt.hash(req.body.password, 12);
    const result = await pool.query('UPDATE accounts SET password_hash = $1 WHERE id = $2', [hash, req.params.id]);
    return result.rowCount ? res.json({ ok: true }) : res.status(404).json({ error: 'Account not found' });
  }
  if (typeof req.body?.forwardTo === 'string') {
    const parsed = z.string().trim().email('Invalid forwarding email').max(90).safeParse(req.body.forwardTo);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const account = await pool.query('SELECT cloudflare_rule_id FROM accounts WHERE id = $1', [req.params.id]);
    if (!account.rowCount) return res.status(404).json({ error: 'Account not found' });
    if (account.rows[0].cloudflare_rule_id) return res.status(409).json({ error: 'An active route already exists; delete and recreate the account to change its destination' });
    await pool.query(`UPDATE accounts SET forward_to = $1, cloudflare_destination_id = NULL,
      routing_status = 'pending_verification', routing_last_error = NULL WHERE id = $2`, [parsed.data.toLowerCase(), req.params.id]);
    await queueAccountRouting(req.params.id);
    return res.json({ ok: true });
  }
  const enabled = typeof req.body?.enabled === 'boolean' ? req.body.enabled : null;
  if (enabled === null) return res.status(400).json({ error: 'Provide a password or enabled boolean' });
  const result = await pool.query('UPDATE accounts SET enabled = $1 WHERE id = $2', [enabled, req.params.id]);
  result.rowCount ? res.json({ ok: true }) : res.status(404).json({ error: 'Account not found' });
});

adminRouter.delete('/accounts/:id', async (req, res) => {
  const account = await pool.query(`SELECT a.cloudflare_rule_id AS "ruleId", d.cloudflare_zone_id AS "zoneId"
    FROM accounts a JOIN domains d ON d.id = a.domain_id WHERE a.id = $1`, [req.params.id]);
  if (!account.rowCount) return res.status(404).json({ error: 'Account not found' });
  if (account.rows[0].ruleId) {
    const settings = await getCloudflareSettings();
    if (!settings.accountId || !settings.apiToken || !account.rows[0].zoneId) {
      return res.status(409).json({ error: 'Cloudflare route could not be removed because Cloudflare is not configured' });
    }
    await new CloudflareClient(settings).deleteRoutingRule(account.rows[0].zoneId, account.rows[0].ruleId);
  }
  const result = await pool.query('DELETE FROM accounts WHERE id = $1', [req.params.id]);
  result.rowCount ? res.json({ ok: true }) : res.status(404).json({ error: 'Account not found' });
});

adminRouter.post('/accounts/:id/routing/retry', async (req, res) => {
  const result = await pool.query('SELECT 1 FROM accounts WHERE id = $1 AND forward_to IS NOT NULL', [req.params.id]);
  if (!result.rowCount) return res.status(404).json({ error: 'Account with forwarding address not found' });
  await queueAccountRouting(req.params.id);
  res.json({ ok: true });
});

adminRouter.put('/brevo', async (req, res) => {
  const parsed = brevoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const current = await getPublicBrevoSettings();
  if (!parsed.data.key && !current.keyConfigured) return res.status(400).json({ error: 'SMTP key is required' });
  await saveBrevoSettings(parsed.data);
  res.json({ ok: true });
});

adminRouter.put('/cloudflare', async (req, res) => {
  const parsed = cloudflareSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const current = await getPublicCloudflareSettings();
  if (!parsed.data.apiToken && !current.tokenConfigured) return res.status(400).json({ error: 'API token is required' });
  await saveCloudflareSettings(parsed.data);
  await requeueUnfinishedRouting();
  res.json({ ok: true });
});
