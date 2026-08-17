function int(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${name} must be a valid TCP port`);
  }
  return value;
}

export const config = {
  production: process.env.NODE_ENV === 'production',
  webHost: process.env.WEB_HOST || '127.0.0.1',
  webPort: int('WEB_PORT', 3000),
  pop3Host: process.env.POP3_HOST || '0.0.0.0',
  pop3Port: int('POP3_PORT', 995),
  smtpHost: process.env.SMTP_HOST || '0.0.0.0',
  smtpPort: int('SMTP_PORT', 587),
  tlsCertPath: process.env.TLS_CERT_PATH,
  tlsKeyPath: process.env.TLS_KEY_PATH,
  databaseUrl: process.env.DATABASE_URL,
  databaseSsl: process.env.DATABASE_SSL === 'true',
  sessionSecret: process.env.SESSION_SECRET,
  encryptionKey: process.env.APP_ENCRYPTION_KEY,
  adminPassword: process.env.ADMIN_PASSWORD,
  adminPasswordHash: process.env.ADMIN_PASSWORD_HASH,
  allowInsecureLocal: process.env.ALLOW_INSECURE_LOCAL === 'true',
  maxMessageBytes: 20 * 1024 * 1024,
};

export function validateConfig() {
  const missing = [];
  if (!config.databaseUrl) missing.push('DATABASE_URL');
  if (!config.sessionSecret || config.sessionSecret.length < 32) missing.push('SESSION_SECRET (at least 32 characters)');
  if (!config.encryptionKey || !/^[a-fA-F0-9]{64}$/.test(config.encryptionKey)) missing.push('APP_ENCRYPTION_KEY (64 hex characters)');
  if (!config.adminPassword && !config.adminPasswordHash) missing.push('ADMIN_PASSWORD or ADMIN_PASSWORD_HASH');
  if ((!config.tlsCertPath || !config.tlsKeyPath) && !config.allowInsecureLocal) missing.push('TLS_CERT_PATH and TLS_KEY_PATH');
  if (missing.length) throw new Error(`Missing or invalid configuration: ${missing.join(', ')}`);
}
