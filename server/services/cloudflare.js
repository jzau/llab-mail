const API_BASE = 'https://api.cloudflare.com/client/v4';

export class CloudflareClient {
  constructor({ accountId, apiToken, fetchFn = fetch }) {
    this.accountId = accountId;
    this.apiToken = apiToken;
    this.fetchFn = fetchFn;
  }

  async request(path, options = {}) {
    const response = await this.fetchFn(`${API_BASE}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.success === false) {
      const detail = body.errors?.map((error) => error.message).filter(Boolean).join('; ');
      const error = new Error(detail || `Cloudflare API returned HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return body;
  }

  async findZone(domain) {
    const query = new URLSearchParams({ name: domain, 'account.id': this.accountId, status: 'active', per_page: '50' });
    const body = await this.request(`/zones?${query}`);
    const zone = body.result?.find((item) => item.name?.toLowerCase() === domain.toLowerCase());
    if (!zone?.id) throw new Error(`Cloudflare zone not found for ${domain}`);
    return zone.id;
  }

  async ensureDestination(email, existingId = null) {
    if (existingId) {
      try {
        const body = await this.request(`/accounts/${this.accountId}/email/routing/addresses/${existingId}`);
        if (body.result?.email?.toLowerCase() === email.toLowerCase()) return body.result;
      } catch (error) {
        if (error.status !== 404) throw error;
      }
    }

    for (let page = 1; page <= 20; page += 1) {
      const query = new URLSearchParams({ page: String(page), per_page: '50' });
      const body = await this.request(`/accounts/${this.accountId}/email/routing/addresses?${query}`);
      const existing = body.result?.find((item) => item.email?.toLowerCase() === email.toLowerCase());
      if (existing) return existing;
      if (page >= (body.result_info?.total_pages || 1)) break;
    }

    const body = await this.request(`/accounts/${this.accountId}/email/routing/addresses`, {
      method: 'POST', body: JSON.stringify({ email }),
    });
    return body.result;
  }

  async ensureRoutingRule(zoneId, sourceEmail, destinationEmail) {
    for (let page = 1; page <= 20; page += 1) {
      const query = new URLSearchParams({ page: String(page), per_page: '50' });
      const body = await this.request(`/zones/${zoneId}/email/routing/rules?${query}`);
      const existing = body.result?.find((rule) => rule.matchers?.some((matcher) =>
        matcher.type === 'literal' && matcher.field === 'to' && matcher.value?.toLowerCase() === sourceEmail.toLowerCase()));
      if (existing) {
        const sameDestination = existing.actions?.some((action) =>
          action.type === 'forward' && action.value?.some((value) => value.toLowerCase() === destinationEmail.toLowerCase()));
        if (!sameDestination) throw new Error(`A different Cloudflare routing rule already exists for ${sourceEmail}`);
        return existing;
      }
      if (page >= (body.result_info?.total_pages || 1)) break;
    }

    const body = await this.request(`/zones/${zoneId}/email/routing/rules`, {
      method: 'POST',
      body: JSON.stringify({
        name: `Mail Relay: ${sourceEmail}`,
        enabled: true,
        matchers: [{ type: 'literal', field: 'to', value: sourceEmail }],
        actions: [{ type: 'forward', value: [destinationEmail] }],
      }),
    });
    return body.result;
  }

  async deleteRoutingRule(zoneId, ruleId) {
    try {
      await this.request(`/zones/${zoneId}/email/routing/rules/${ruleId}`, { method: 'DELETE' });
    } catch (error) {
      if (error.status !== 404) throw error;
    }
  }
}
