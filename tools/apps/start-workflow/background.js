import { fingerprint } from './model.js';

const ENDPOINT = 'https://258616-aigdatranslationpoc-stage.adobeioruntime.net/api/v1/web/aig-da-translation-backend/bulk-workflow';
const IMS_ORG = '2FBC7B975CFE21C40A495FBB@AdobeOrg';

export function allCountryTargets(config) {
  const targets = config?.targets;
  if (!Array.isArray(targets) || !targets.length) throw new Error('No eligible regional countries are configured.');
  return new Set(targets.map((target) => target.id));
}

export async function backgroundJobId(requestId, org, site) {
  return (await fingerprint(`all-countries-v1\n${org}/${site}\n${requestId}`)).slice(0, 32);
}

export default function createBackgroundClient(org, site, token, request = fetch) {
  if (!token) throw new Error('A signed-in Adobe session is required for background jobs.');
  async function call(method, params) {
    const url = new URL(ENDPOINT);
    if (method === 'GET') Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    const response = await request(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'x-gw-ims-org-id': IMS_ORG,
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(method === 'POST' ? { body: JSON.stringify(params) } : {}),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(method === 'POST' ? 180000 : 30000),
    });
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error(`App Builder returned an invalid response (HTTP ${response.status}). Retrieve saved status before submitting again.`);
    }
    if (!response.ok) {
      throw new Error(result.error || `App Builder request failed (HTTP ${response.status}). Check your Adobe session and permissions; retrieve saved status before submitting again.`);
    }
    if (!/^[a-f0-9]{32}$/.test(result.jobId || '')
      || !['queued', 'running', 'complete', 'failed', 'needs-review'].includes(result.status)
      || !Number.isSafeInteger(result.total) || !Number.isSafeInteger(result.completed)
      || result.completed < 0 || result.completed > result.total || !Array.isArray(result.items)
      || result.org !== org || result.site !== site) {
      throw new Error('App Builder returned invalid job progress. Do not start another workflow; inspect the saved job.');
    }
    return result;
  }
  function status(jobId, offset = 0) {
    if (!/^[a-f0-9]{32}$/.test(jobId || '')) throw new Error('Enter a valid background job ID.');
    return call('GET', { jobId, offset });
  }
  return {
    status,
    async submit({
      requestId, title, paths, config, overwriteConfirmed,
    }) {
      return call('POST', {
        org,
        site,
        mode: 'all-countries',
        confirm: 'start-all-countries',
        requestId,
        title,
        paths,
        targetIds: [...allCountryTargets(config)],
        configHash: await fingerprint(JSON.stringify(config.sheets)),
        overwriteConfirmed,
      });
    },
    recover(jobId) {
      if (!/^[a-f0-9]{32}$/.test(jobId || '')) throw new Error('Enter a valid background job ID.');
      return call('POST', { confirm: 'recover-all-countries', jobId });
    },
    async completedPaths(jobId) {
      const paths = [];
      let offset = 0;
      const seen = new Set();
      do {
        if (seen.has(offset)) throw new Error('Background progress returned a repeated page.');
        seen.add(offset);
        // eslint-disable-next-line no-await-in-loop -- Keep progress pages ordered and bounded.
        const page = await status(jobId, offset);
        page.items.filter((item) => item.status === 'complete').forEach((item) => {
          paths.push(item.destination.replace(/\.html$/, ''));
        });
        offset = page.nextOffset;
        if (offset !== null && (!Number.isSafeInteger(offset) || offset < 0)) throw new Error('Invalid background progress pagination.');
      } while (offset !== null);
      return paths;
    },
  };
}
