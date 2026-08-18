import 'dotenv/config';
import { config, validateConfig } from './config.js';
import { createWebApp } from './app.js';
import { createPop3Server } from './services/pop3.js';
import { createSmtpServer } from './services/smtp.js';
import { closeDb, initDb } from './db.js';
import { startRoutingWorker } from './services/routing-worker.js';

validateConfig();
await initDb();

const web = createWebApp().listen(config.webPort, config.webHost, () => {
  console.log(`Admin web listening on http://${config.webHost}:${config.webPort}`);
});
const pop3 = createPop3Server().listen(config.pop3Port, config.pop3Host, () => {
  console.log(`POP3${config.tlsCertPath ? 'S' : ''} listening on ${config.pop3Host}:${config.pop3Port}`);
});
const smtp = createSmtpServer();
smtp.listen(config.smtpPort, config.smtpHost, () => {
  console.log(`SMTP submission listening on ${config.smtpHost}:${config.smtpPort}`);
});
const stopRoutingWorker = startRoutingWorker();

let stopping = false;
function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  stopRoutingWorker();
  console.log(`${signal} received, shutting down`);
  const timer = setTimeout(() => process.exit(1), 10_000).unref();
  let open = 3;
  const done = () => {
    if (--open === 0) {
      clearTimeout(timer);
      closeDb().then(() => process.exit(0));
    }
  };
  web.close(done);
  pop3.close(done);
  smtp.close(done);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
