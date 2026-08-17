# QQ Mail POP3 + Brevo SMTP Relay

A small self-hosted service for using company addresses from QQ Mail when real inbound mail is forwarded elsewhere (for example, Cloudflare Email Routing).

- POP3/POP3S authenticates employee credentials and always presents an empty mailbox.
- SMTP submission authenticates the same credentials, prevents sender spoofing, and relays through Brevo.
- The React admin dashboard manages multiple company domains, individual employee accounts, and the Brevo SMTP login/key.
- PostgreSQL stores configuration. Employee passwords use bcrypt; the Brevo key uses AES-256-GCM encryption.

This service does **not** receive or store real inbound email. Keep inbound delivery pointed at Cloudflare Email Routing (or your existing forwarding provider).

## Architecture

```text
Inbound sender -> Cloudflare Email Routing -> employee's QQ inbox

QQ external mailbox check -> this server :995 -> authenticated, 0 messages
QQ send as company address -> this server :587 -> Brevo -> recipient
```

All company domains can use one stable service hostname such as `mail.yourservice.com`. You do not need a POP3/SMTP subdomain for every customer domain.

## Local setup

Requires Node.js 20 or newer.

```bash
npm install
cp .env.example .env
openssl rand -hex 32   # use once for SESSION_SECRET
openssl rand -hex 32   # use again for APP_ENCRYPTION_KEY
npm run dev
```

For local-only testing, set `ALLOW_INSECURE_LOCAL=true`, use high ports, and do not expose them publicly. The Vite dashboard runs at `http://localhost:5173`.

## VPS deployment with PM2

1. Point a DNS-only A/AAAA record such as `mail.yourservice.com` to the VPS. If using Cloudflare DNS, do not enable the orange-cloud proxy for POP3/SMTP.
2. Obtain a certificate that covers the hostname. One certificate can be used by both POP3S and SMTP STARTTLS.
3. Copy `.env.example` to `.env`, use strong random secrets, and set the certificate paths.
4. Install, build, and start:

```bash
npm ci
npm run build
pm2 start ecosystem.config.cjs
pm2 save
```

### PostgreSQL database

The application expects a dedicated PostgreSQL database and login. On this VPS, use the system cluster on `127.0.0.1:5433` rather than the unrelated service listening on port 5432.

As a root-capable administrator, open PostgreSQL:

```bash
sudo -u postgres psql -p 5433
```

Then create the isolated login and database. `\password` prompts without putting the password into shell history:

```sql
CREATE ROLE llab_mail LOGIN;
\password llab_mail
CREATE DATABASE llab_mail OWNER llab_mail;
\q
```

Use the generated password in `.env`. Percent-encode characters that have special meaning in a URL, or generate a hex-only password with `openssl rand -hex 24`.

```env
DATABASE_URL=postgresql://llab_mail:YOUR_PASSWORD@127.0.0.1:5433/llab_mail
DATABASE_SSL=false
```

The connection remains on VPS loopback, so PostgreSQL does not need a public firewall port. The application creates its tables and index on first startup.

Ports 995 and 587 are privileged on Linux. Prefer granting the Node executable only the bind capability instead of running PM2 as root:

```bash
sudo setcap 'cap_net_bind_service=+ep' "$(readlink -f "$(command -v node)")"
getcap "$(readlink -f "$(command -v node)")"
```

Reapply this after replacing/upgrading the Node binary. Open TCP 995 and 587 in the VPS firewall. Keep the dashboard bound to `127.0.0.1:3000` and expose it through an HTTPS reverse proxy such as Nginx. Do not expose port 3000 directly.

Example Nginx site for `relay-admin.yourservice.com`:

```nginx
server {
    listen 443 ssl http2;
    server_name relay-admin.yourservice.com;
    ssl_certificate /etc/letsencrypt/live/relay-admin.yourservice.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/relay-admin.yourservice.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

Use `pm2 restart qq-mail-relay` after certificate renewal so the mail listeners load the new certificate.

## Production credentials

Generate the two secrets with `openssl rand -hex 32`. Keep `APP_ENCRYPTION_KEY` backed up securely: without it, the stored Brevo key cannot be decrypted.

For the admin dashboard, a bcrypt hash avoids keeping the admin password in `.env`:

```bash
npm run hash-password -- "a long unique admin password"
```

Put the result in `ADMIN_PASSWORD_HASH` and remove `ADMIN_PASSWORD`. The dashboard intentionally has no username and issues a 12-hour, HTTP-only, SameSite cookie.

## First configuration

1. Open the HTTPS admin dashboard and sign in.
2. Add every company domain that Brevo has authenticated.
3. Add employee addresses and give each employee their generated password.
4. Enter Brevo's **SMTP Login** and **SMTP Key** under “Brevo relay”. The login is not the employee's From address.

Recommended employee password generation:

```bash
openssl rand -base64 24
```

QQ configuration for each employee:

```text
Email / username: alice@company.com
Password:         the employee password from the dashboard
POP3 server:      mail.yourservice.com
POP3 port:        995, SSL/TLS enabled
SMTP server:      mail.yourservice.com
SMTP port:        587, STARTTLS/TLS enabled
SMTP username:    alice@company.com (QQ normally reuses it)
SMTP password:    the same employee password
```

The relay rejects a message if its SMTP envelope sender or `From:` header differs from the authenticated employee address. This prevents one employee from impersonating another.

## Operations

```bash
pm2 status
pm2 logs qq-mail-relay
curl http://127.0.0.1:3000/health
npm test
```

Back up PostgreSQL, `.env`, and especially `APP_ENCRYPTION_KEY`. A simple logical backup is:

```bash
pg_dump --dbname="$DATABASE_URL" --format=custom --file="llab-mail-$(date +%F).dump"
```

Copy backups off the VPS and periodically test restoration. Restrict backup and `.env` file permissions because they contain account hashes and encrypted credentials.

## Important limits

- Maximum message size: 20 MB.
- Maximum recipients per message: 50.
- No mail queue is stored locally. If Brevo is unavailable, SMTP returns a temporary failure and QQ should retry.
- There is one global Brevo relay credential set. It can send for multiple domains authenticated in that Brevo account.
- This is an authenticated submission relay, not a general-purpose inbound SMTP server.
