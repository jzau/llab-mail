import express from 'express';
import { z } from 'zod';
import { completeInvitation, inspectInvitation } from '../services/invitations.js';

export const invitationRouter = express.Router();
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Invalid or expired setup link');
const completeSchema = z.object({
  token: tokenSchema,
  password: z.string().min(1, 'Password is required').max(200),
});

invitationRouter.post('/inspect', async (req, res) => {
  const parsed = tokenSchema.safeParse(req.body?.token);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid or expired setup link' });
  const invitation = await inspectInvitation(parsed.data);
  if (!invitation) return res.status(400).json({ error: 'Invalid or expired setup link' });
  res.json(invitation);
});

invitationRouter.post('/complete', async (req, res) => {
  const parsed = completeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const account = await completeInvitation(parsed.data.token, parsed.data.password);
  if (!account) return res.status(400).json({ error: 'Invalid or expired setup link' });
  res.json({ ok: true, email: account.email });
});
