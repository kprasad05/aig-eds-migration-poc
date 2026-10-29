import assert from 'node:assert/strict';
import { test } from 'node:test';
import { modules, regionalSheets, json } from './helpers.mjs';

const jobId = 'a'.repeat(32);
const progress = {
  jobId, org: 'org', site: 'site', total: 6, completed: 0,
  status: 'queued', stage: 'queued', items: [], nextOffset: null,
};

test('All Countries includes all configured eligible locales across languages, not stores', async () => {
  const { model, background } = await modules();
  const config = model.parseConfig(regionalSheets());
  assert.deepEqual([...background.allCountryTargets(config)].sort(),
    ['/de/de', '/en/pr', '/es/pr', '/fr/ca', '/fr/fr', '/zh/cn']);
  assert.throws(() => background.allCountryTargets({ targets: [] }), /No eligible/);
});

test('background submission uses the fixed Stage endpoint and passes reviewed configuration and confirmation', async () => {
  const { model, background } = await modules();
  const config = model.parseConfig(regionalSheets());
  const calls = [];
  const client = background.default('org', 'site', 'session', async (url, options) => {
    calls.push({ url, options });
    return json(progress, { status: 202 });
  });
  await client.submit({
    requestId: '00000000-0000-4000-8000-000000000001', title: 'All Countries',
    paths: ['/en/fragments/a.html'], config, overwriteConfirmed: true,
  });
  const [{ url, options }] = calls;
  assert.equal(url.hostname, '258616-aigdatranslationpoc-stage.adobeioruntime.net');
  assert.equal(options.headers.Authorization, 'Bearer session');
  assert.equal(options.headers['x-gw-ims-org-id'], '2FBC7B975CFE21C40A495FBB@AdobeOrg');
  assert.equal(options.redirect, 'error');
  const payload = JSON.parse(options.body);
  assert.equal(payload.confirm, 'start-all-countries');
  assert.equal(payload.mode, 'all-countries');
  assert.equal(payload.overwriteConfirmed, true);
  assert.equal(payload.targetIds.length, 6);
  assert.equal(payload.configHash, await model.fingerprint(JSON.stringify(config.sheets)));
});

test('stable background ID can be bookmarked even if submission response is lost', async () => {
  const { model, background } = await modules();
  const requestId = '00000000-0000-4000-8000-000000000001';
  assert.equal(await background.backgroundJobId(requestId, 'org', 'site'),
    (await model.fingerprint(`all-countries-v1\norg/site\n${requestId}`)).slice(0, 32));
});

test('status retrieval never submits or translates and preserves pagination', async () => {
  const { background } = await modules();
  const calls = [];
  const client = background.default('org', 'site', 'session', async (url, options) => {
    calls.push({ url, options });
    return json(progress);
  });
  await client.status(jobId, 50);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].url.searchParams.get('offset'), '50');
  assert.equal(calls[0].options.body, undefined);
  assert.throws(() => client.status('../other'), /valid background job/);
});

test('explicit recovery is separate from ordinary status reads', async () => {
  const { background } = await modules();
  let payload;
  const client = background.default('org', 'site', 'session', async (url, options) => {
    payload = JSON.parse(options.body);
    return json(progress);
  });
  await client.recover(jobId);
  assert.deepEqual(payload, { confirm: 'recover-all-countries', jobId });
});

test('permission failures and malformed successful responses are not hidden', async () => {
  const { background } = await modules();
  const denied = background.default('org', 'site', 'session', async () => json({ error: 'Grant configuration read access.' }, { status: 403 }));
  await assert.rejects(denied.status(jobId), /Grant configuration read/);
  const malformed = background.default('org', 'site', 'session', async () => json({ status: 'complete' }));
  await assert.rejects(malformed.status(jobId), /invalid job progress/);
});

test('publish handoff reads every page and excludes uncertain and unfinished saves', async () => {
  const { background } = await modules();
  const client = background.default('org', 'site', 'session', async (url) => {
    const offset = Number(url.searchParams.get('offset'));
    return json({
      ...progress, nextOffset: offset === 0 ? 50 : null,
      items: offset === 0 ? [
        { destination: '/es/pr/a.html', status: 'complete' },
        { destination: '/de/de/a.html', status: 'needs-review' },
      ] : [
        { destination: '/fr/fr/a.html', status: 'complete' },
        { destination: '/fr/ca/a.html', status: 'queued' },
      ],
    });
  });
  assert.deepEqual([...await client.completedPaths(jobId)], ['/es/pr/a', '/fr/fr/a']);
});
