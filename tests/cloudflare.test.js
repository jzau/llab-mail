import test from 'node:test';
import assert from 'node:assert/strict';
import { CloudflareClient } from '../server/services/cloudflare.js';

function response(result) {
  return { ok: true, status: 200, json: async () => ({ success: true, result }) };
}

test('creates a literal forwarding rule with the expected Cloudflare payload', async () => {
  const requests = [];
  const client = new CloudflareClient({
    accountId: 'account-1',
    apiToken: 'token-1',
    fetchFn: async (url, options) => {
      requests.push({ url, options });
      return requests.length === 1 ? response([]) : response({ id: 'rule-1' });
    },
  });

  const rule = await client.ensureRoutingRule('zone-1', 'alice@example.com', 'alice@qq.com');
  assert.equal(rule.id, 'rule-1');
  assert.match(requests[0].url, /\/zones\/zone-1\/email\/routing\/rules\?/);
  assert.equal(requests[1].options.method, 'POST');
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    name: 'Mail Relay: alice@example.com',
    enabled: true,
    matchers: [{ type: 'literal', field: 'to', value: 'alice@example.com' }],
    actions: [{ type: 'forward', value: ['alice@qq.com'] }],
  });
});
