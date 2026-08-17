import fs from 'node:fs';
import { SMTPServer } from 'smtp-server';
import nodemailer from 'nodemailer';
import { simpleParser } from 'mailparser';
import { config } from '../config.js';
import { authenticateAccount } from './accounts.js';
import { getBrevoSettings } from './settings.js';
import { normalizeEmail } from '../lib/normalize.js';

function smtpError(message, responseCode = 550) {
  const error = new Error(message);
  error.responseCode = responseCode;
  return error;
}

async function collect(stream) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > config.maxMessageBytes) throw smtpError('Message exceeds 20 MB limit', 552);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function relay(raw, session) {
  const parsed = await simpleParser(raw, { skipHtmlToText: true, skipTextToHtml: true });
  const fromAddresses = parsed.from?.value?.map((item) => normalizeEmail(item.address)).filter(Boolean) || [];
  if (fromAddresses.length !== 1 || fromAddresses[0] !== session.user) {
    throw smtpError(`From header must be ${session.user}`);
  }

  const brevo = await getBrevoSettings();
  if (!brevo.login || !brevo.key) throw smtpError('Upstream SMTP is not configured', 451);
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
  await transporter.sendMail({
    envelope: {
      from: session.user,
      to: session.envelope.rcptTo.map((recipient) => recipient.address),
    },
    raw,
  });
}

export function createSmtpServer() {
  const options = {
    name: process.env.SMTP_BANNER_HOST || 'mail-relay.local',
    secure: false,
    authMethods: ['PLAIN', 'LOGIN'],
    allowInsecureAuth: config.allowInsecureLocal,
    hideSTARTTLS: config.allowInsecureLocal && !config.tlsCertPath,
    size: config.maxMessageBytes,
    maxClients: 100,
    socketTimeout: 120_000,
    closeTimeout: 30_000,
    onAuth(auth, session, callback) {
      authenticateAccount(auth.username, auth.password)
        .then((email) => email ? callback(null, { user: email }) : callback(smtpError('Invalid username or password', 535)))
        .catch(() => callback(smtpError('Authentication unavailable', 454)));
    },
    onMailFrom(address, session, callback) {
      const sender = normalizeEmail(address.address);
      if (!session.user || sender !== session.user) return callback(smtpError(`Envelope sender must be ${session.user || 'the authenticated account'}`));
      callback();
    },
    onRcptTo(_address, session, callback) {
      if (!session.user) return callback(smtpError('Authentication required', 530));
      if (session.envelope.rcptTo.length >= 50) return callback(smtpError('Too many recipients', 452));
      callback();
    },
    onData(stream, session, callback) {
      collect(stream).then((raw) => relay(raw, session)).then(() => callback()).catch((error) => {
        if (error.responseCode) return callback(error);
        console.error('Brevo relay failed:', error?.message || error);
        callback(smtpError('Upstream delivery failed; try again later', 451));
      });
    },
    logger: false,
  };
  if (config.tlsCertPath && config.tlsKeyPath) {
    options.cert = fs.readFileSync(config.tlsCertPath);
    options.key = fs.readFileSync(config.tlsKeyPath);
    options.minVersion = 'TLSv1.2';
  }
  return new SMTPServer(options);
}
