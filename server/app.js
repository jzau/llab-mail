import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { adminRouter } from './routes/admin.js';
import { invitationRouter } from './routes/invitations.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function createWebApp() {
  const app = express();
  app.set('trust proxy', 'loopback');
  app.use(helmet({ contentSecurityPolicy: { directives: { 'script-src': ["'self'"], 'style-src': ["'self'"], 'img-src': ["'self'", 'data:'] } } }));
  app.use(express.json({ limit: '32kb' }));
  app.use(cookieParser());
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/admin/login', rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false }));
  app.use('/api/invitations', rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false }), invitationRouter);
  app.use('/api/admin', adminRouter);

  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(root, 'dist'), { index: false, maxAge: '1h' }));
    app.get('/{*splat}', (_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')));
  }

  app.use((error, _req, res, _next) => {
    console.error('Web request failed:', error?.message || error);
    res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}
