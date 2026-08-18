import { pool } from '../db.js';
import { getCloudflareSettings } from './settings.js';
import { CloudflareClient } from './cloudflare.js';

const MINUTE = 60_000;
let running = false;

export async function queueAccountRouting(accountId, database = pool) {
  await database.query(`UPDATE accounts SET
    routing_status = 'pending_verification',
    routing_started_at = CURRENT_TIMESTAMP,
    routing_next_check_at = CURRENT_TIMESTAMP,
    routing_expires_at = CURRENT_TIMESTAMP + INTERVAL '24 hours',
    routing_verified_at = NULL,
    routing_last_error = NULL
    WHERE id = $1 AND forward_to IS NOT NULL`, [accountId]);
}

export async function requeueUnfinishedRouting(database = pool) {
  await database.query(`UPDATE accounts SET
    routing_status = 'pending_verification',
    routing_started_at = CURRENT_TIMESTAMP,
    routing_next_check_at = CURRENT_TIMESTAMP,
    routing_expires_at = CURRENT_TIMESTAMP + INTERVAL '24 hours',
    routing_last_error = NULL
    WHERE forward_to IS NOT NULL AND routing_status IN ('not_configured', 'error', 'expired')`);
}

export async function processRoutingQueue({ database = pool, settings = null, clientFactory = (value) => new CloudflareClient(value) } = {}) {
  if (running) return;
  running = true;
  try {
    const now = new Date();
    await database.query(`UPDATE accounts SET routing_status = 'expired', routing_next_check_at = NULL
      WHERE routing_status IN ('pending_verification', 'error') AND routing_expires_at <= $1`, [now]);
    const result = await database.query(`SELECT a.id, a.email, a.forward_to AS "forwardTo",
        a.cloudflare_destination_id AS "destinationId", d.id AS "domainId", d.name AS domain,
        d.cloudflare_zone_id AS "zoneId"
      FROM accounts a JOIN domains d ON d.id = a.domain_id
      WHERE a.enabled = TRUE AND d.enabled = TRUE AND a.forward_to IS NOT NULL
        AND a.routing_status IN ('pending_verification', 'error')
        AND a.routing_expires_at > $1
        AND a.routing_next_check_at <= $1
      ORDER BY a.routing_next_check_at LIMIT 25`, [now]);
    if (!result.rowCount) return;

    const cloudflare = settings || await getCloudflareSettings();
    if (!cloudflare.accountId || !cloudflare.apiToken) {
      for (const account of result.rows) await markError(database, account.id, 'Cloudflare is not configured', now);
      return;
    }
    const client = clientFactory(cloudflare);

    for (const account of result.rows) {
      try {
        await database.query('UPDATE accounts SET routing_next_check_at = $1 WHERE id = $2', [new Date(now.getTime() + MINUTE), account.id]);
        let zoneId = account.zoneId;
        if (!zoneId) {
          zoneId = await client.findZone(account.domain);
          await database.query('UPDATE domains SET cloudflare_zone_id = $1 WHERE id = $2', [zoneId, account.domainId]);
        }
        const destination = await client.ensureDestination(account.forwardTo, account.destinationId);
        await database.query('UPDATE accounts SET cloudflare_destination_id = $1 WHERE id = $2', [destination.id, account.id]);
        if (!destination.verified) {
          await database.query(`UPDATE accounts SET routing_status = 'pending_verification', routing_last_error = NULL WHERE id = $1`, [account.id]);
          continue;
        }
        const rule = await client.ensureRoutingRule(zoneId, account.email, account.forwardTo);
        await database.query(`UPDATE accounts SET routing_status = 'active', cloudflare_rule_id = $1,
          routing_verified_at = $2, routing_next_check_at = NULL, routing_last_error = NULL WHERE id = $3`,
        [rule.id, destination.verified, account.id]);
      } catch (error) {
        await markError(database, account.id, error.message, now);
      }
    }
  } finally {
    running = false;
  }
}

async function markError(database, accountId, message, now = new Date()) {
  await database.query(`UPDATE accounts SET routing_status = 'error', routing_last_error = $1,
    routing_next_check_at = $2 WHERE id = $3`, [String(message).slice(0, 1000), new Date(now.getTime() + MINUTE), accountId]);
}

export function startRoutingWorker() {
  const firstRun = setTimeout(() => processRoutingQueue().catch((error) => console.error('Routing worker failed:', error.message)), 2_000);
  const interval = setInterval(() => processRoutingQueue().catch((error) => console.error('Routing worker failed:', error.message)), MINUTE);
  interval.unref();
  return () => { clearTimeout(firstRun); clearInterval(interval); };
}
