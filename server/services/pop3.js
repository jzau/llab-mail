import fs from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';
import { config } from '../config.js';
import { authenticateAccount } from './accounts.js';

const MAX_LINE = 2048;

export function createPop3Server() {
  const handler = (socket) => {
    socket.setEncoding('utf8');
    socket.setTimeout(60_000, () => socket.destroy());
    let buffer = '';
    let username = null;
    let authenticated = false;
    let chain = Promise.resolve();

    const send = (line) => socket.writable && socket.write(`${line}\r\n`);
    const multi = (...lines) => send(`${lines.join('\r\n')}\r\n.`);

    async function command(line) {
      const separator = line.indexOf(' ');
      const verb = (separator === -1 ? line : line.slice(0, separator)).toUpperCase();
      const arg = separator === -1 ? '' : line.slice(separator + 1).trim();

      if (verb === 'QUIT') { send('+OK goodbye'); return socket.end(); }
      if (verb === 'CAPA') return multi('+OK Capability list follows', 'USER', 'UIDL', 'TOP');
      if (!authenticated && verb === 'USER') {
        username = arg;
        return send(username ? '+OK user accepted' : '-ERR username required');
      }
      if (!authenticated && verb === 'PASS') {
        const email = username && await authenticateAccount(username, arg);
        if (!email) return send('-ERR authentication failed');
        authenticated = true;
        username = email;
        return send('+OK mailbox locked and ready');
      }
      if (!authenticated) return send('-ERR authenticate first');

      switch (verb) {
        case 'STAT': return send('+OK 0 0');
        case 'LIST': return arg ? send('-ERR no such message') : multi('+OK 0 messages (0 octets)');
        case 'UIDL': return arg ? send('-ERR no such message') : multi('+OK unique-id listing follows');
        case 'NOOP':
        case 'RSET': return send('+OK');
        case 'RETR':
        case 'TOP':
        case 'DELE': return send('-ERR no such message');
        default: return send('-ERR unsupported command');
      }
    }

    socket.on('data', (chunk) => {
      buffer += chunk;
      if (buffer.length > MAX_LINE && !buffer.includes('\n')) return socket.destroy();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) {
        if (!line) continue;
        chain = chain.then(() => command(line)).catch(() => send('-ERR server error'));
      }
    });
    socket.on('error', () => {});
    send('+OK QQ Mail Relay POP3 ready');
  };

  if (config.tlsCertPath && config.tlsKeyPath) {
    return tls.createServer({
      cert: fs.readFileSync(config.tlsCertPath),
      key: fs.readFileSync(config.tlsKeyPath),
      minVersion: 'TLSv1.2',
    }, handler);
  }
  return net.createServer(handler);
}
