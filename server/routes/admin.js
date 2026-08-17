import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { pool } from '../db.js';
import { config } from '../config.js';
import { domainPattern, normalizeDomain, normalizeEmail } from '../lib/normalize.js';
import { getPublicBrevoSettings, saveBrevoSettings } from '../services/settings.js';

export const adminRouter = express.Router();
const COOKIE = 'relay_admin';
const domainSchema = z.object({ name: z.string().transform(normalizeDomain).refine((v) => domainPattern.test(v), 'Invalid domain') });
const accountSchema = z.object({ email: z.string().transform(normalizeEmail).refine(Boolean, 'Invalid email'), password: z.string().min(10).max(200) });
const brevoSchema = z.object({
  host: z.string().trim().min(1).max(253),
  port: z.coerce.number().int().min(1).max(65535),
  login: z.string().trim().min(1).max(320),
  key: z.string().max(500).optional().default(''),
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
  const [domainsResult, accountsResult, brevo] = await Promise.all([
    pool.query('SELECT id, name, enabled, created_at AS "createdAt" FROM domains ORDER BY name'),
    pool.query('SELECT id, email, enabled, created_at AS "createdAt" FROM accounts ORDER BY email'),
    getPublicBrevoSettings(),
  ]);
  res.json({ domains: domainsResult.rows, accounts: accountsResult.rows, brevo });
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
  const email = parsed.data.email;
  const domain = email.slice(email.lastIndexOf('@') + 1);
  const domainResult = await pool.query('SELECT id FROM domains WHERE name = $1', [domain]);
  if (!domainResult.rowCount) return res.status(400).json({ error: 'Add the domain first' });
  try {
    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const result = await pool.query(`INSERT INTO accounts (domain_id, email, password_hash)
      VALUES ($1, $2, $3) RETURNING id, email`, [domainResult.rows[0].id, email, passwordHash]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(409).json({ error: error.code === '23505' ? 'Account already exists' : 'Could not add account' });
  }
});

adminRouter.patch('/accounts/:id', async (req, res) => {
  if (typeof req.body?.password === 'string') {
    if (req.body.password.length < 10) return res.status(400).json({ error: 'Password must be at least 10 characters' });
    const hash = await bcrypt.hash(req.body.password, 12);
    const result = await pool.query('UPDATE accounts SET password_hash = $1 WHERE id = $2', [hash, req.params.id]);
    return result.rowCount ? res.json({ ok: true }) : res.status(404).json({ error: 'Account not found' });
  }
  const enabled = typeof req.body?.enabled === 'boolean' ? req.body.enabled : null;
  if (enabled === null) return res.status(400).json({ error: 'Provide a password or enabled boolean' });
  const result = await pool.query('UPDATE accounts SET enabled = $1 WHERE id = $2', [enabled, req.params.id]);
  result.rowCount ? res.json({ ok: true }) : res.status(404).json({ error: 'Account not found' });
});

adminRouter.delete('/accounts/:id', async (req, res) => {
  const result = await pool.query('DELETE FROM accounts WHERE id = $1', [req.params.id]);
  result.rowCount ? res.json({ ok: true }) : res.status(404).json({ error: 'Account not found' });
});

adminRouter.put('/brevo', async (req, res) => {
  const parsed = brevoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const current = await getPublicBrevoSettings();
  if (!parsed.data.key && !current.keyConfigured) return res.status(400).json({ error: 'SMTP key is required' });
  await saveBrevoSettings(parsed.data);
  res.json({ ok: true });
});
