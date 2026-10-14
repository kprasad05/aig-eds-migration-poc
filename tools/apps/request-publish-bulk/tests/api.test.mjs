import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const sourceDate = 'Wed, 14 Oct 2026 14:29:26 GMT';
const apiSource = await readFile(new URL('../api.js', import.meta.url), 'utf8');
const pathsSource = await readFile(new URL('../paths.js', import.meta.url), 'utf8');

async function client(responses) {
  const calls = [];
  const logs = [];
  const mockFetch = async (url, opts) => {
    calls.push({ url, opts });
    const response = responses.shift();
    if (response instanceof Error) throw response;
    assert.ok(response, `Unexpected request to ${url}`);
    return response;
  };
  const context = vm.createContext({
    Response, URLSearchParams, URL,
    window: { location: { hostname: 'localhost', search: '?env=prod' } },
    console: { error: (...args) => logs.push(args) },
    fetch: mockFetch,
  });
  const da = new vm.SyntheticModule(['daFetch'], function initialize() {
    this.setExport('daFetch', mockFetch);
  }, { context });
  await da.link(() => {});
  await da.evaluate();
  const paths = new vm.SourceTextModule(pathsSource, { context });
  await paths.link(() => {});
  const module = new vm.SourceTextModule(apiSource, {
    context,
    importModuleDynamically: async () => da,
  });
  await module.link(() => paths);
  await module.evaluate();
  return { api: module.namespace, calls, logs };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

test('lists authenticated active project files, filters folders, and sorts newest first', async () => {
  const { api, calls } = await client([json([
    { path: '/org/site/.da/translation/active/1.json', ext: 'json', lastModified: 1 },
    { path: '/folder', ext: '', lastModified: 3 },
    { path: '/org/site/.da/translation/active/2.json', ext: 'json', lastModified: 2 },
  ])]);
  const result = await api.listTranslationProjects('org', 'site', 'test-token');
  assert.equal(result.length, 2);
  assert.ok(result[0].path.endsWith('2.json'));
  assert.equal(calls[0].url, 'https://admin.da.live/list/org/site/.da/translation/active');
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer test-token');
  assert.equal(calls[0].opts.headers['Content-Type'], undefined);
  assert.equal(calls[0].opts.cache, 'no-store');
});

test('duplicate lookup combines own requests and the approver inbox without duplicate paths', async () => {
  const { api, calls } = await client([
    json({ requests: [
      { path: '/fr/home', status: 'pending', requester: 'self@example.com' },
      { path: '/old', status: 'approved' },
    ] }),
    json({ requests: [
      { path: '/fr/home', status: 'pending', requester: 'self@example.com' },
      { path: '/en/ca/fragments/fragment-test', status: 'pending', requester: 'other@example.com' },
    ] }),
  ]);
  const result = await api.listPendingRequests('org', 'site', 'token');
  assert.equal(result.success, true);
  assert.equal(result.requests.length, 2);
  assert.equal(result.requests[1].requester, 'other@example.com');
  assert.ok(calls[0].url.endsWith('&role=requester'));
  assert.equal(new URL(calls[1].url).searchParams.has('role'), false);
  assert.ok(calls.every((call) => call.opts.cache === 'no-store'));
});

test('duplicate lookup fails explicitly if either queue is unavailable', async () => {
  const { api } = await client([json({ requests: [] }), json({}, 403)]);
  const result = await api.listPendingRequests('org', 'site', 'token');
  assert.equal(result.success, false);
  assert.match(result.error, /403/);
});

test('requester-only reconciliation does not query other authors requests', async () => {
  const { api, calls } = await client([json({ requests: [] })]);
  assert.equal((await api.listMyPendingRequests('org', 'site', 'token')).requests.length, 0);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.endsWith('&role=requester'));
});

test('reports list permission, invalid JSON, and response-shape errors', async () => {
  const { api } = await client([json({}, 403), new Response('not JSON'), json({ data: [] })]);
  await assert.rejects(api.listTranslationProjects('org', 'site', 'token'), /permission/);
  await assert.rejects(api.listTranslationProjects('org', 'site', 'token'), /invalid JSON/);
  await assert.rejects(api.listTranslationProjects('org', 'site', 'token'), /unexpected format/);
});

test('loads selected project from content.da.live and checks its site identity', async () => {
  const { api, calls } = await client([
    json({ org: 'org', site: 'site', title: 'Translation test' }),
    json({ org: 'other-org', site: 'site', title: 'Wrong site' }),
  ]);
  const path = '/org/site/.da/translation/active/123.json';
  const result = await api.loadTranslationProject('org', 'site', path, 'token');
  assert.equal(result.title, 'Translation test');
  assert.equal(calls[0].url, `https://content.da.live${path}`);
  await assert.rejects(api.loadTranslationProject('org', 'site', path, 'token'), /another site/);
  await assert.rejects(api.loadTranslationProject('org', 'site', '/other/site/123.json', 'token'), /outside/);
  await assert.rejects(api.loadTranslationProject('org', 'site', '/org/site/.da/translation/active/../123.json', 'token'), /outside/);
});

test('validation reads source and preview status without previewing or creating requests', async () => {
  const { api, calls } = await client([
    new Response('<html></html>', { headers: { 'Last-Modified': sourceDate } }),
    json({ preview: { status: 200, sourceLastModified: sourceDate, lastModified: sourceDate } }),
  ]);
  const result = await api.validateContent('org', 'site', '/fr/home', 'token');
  assert.equal(result.status, 'ready');
  assert.equal(calls[0].url, 'https://admin.da.live/source/org/site/fr/home.html');
  assert.ok(decodeURIComponent(calls[1].url).includes('/status/org/site/main/fr/home?editUrl=auto'));
  assert.ok(calls.every((call) => call.opts.method === 'GET'));
});

test('validation reports missing sources without querying preview status', async () => {
  const { api, calls } = await client([new Response(null, { status: 404 })]);
  assert.equal((await api.validateContent('org', 'site', '/missing', 'token')).status, 'missing');
  assert.equal(calls.length, 1);
});

test('validation preserves JSON paths and reports status service errors', async () => {
  const { api, calls } = await client([
    new Response('{}', { headers: { 'Last-Modified': sourceDate } }),
    json({}, 403),
  ]);
  await assert.rejects(api.validateContent('org', 'site', '/fr/data.json', 'token'), /403/);
  assert.ok(calls[0].url.endsWith('/fr/data.json'));
});

test('notification failure returned as 400 is ambiguous and must be reconciled', async () => {
  const { api } = await client([json({ error: 'Email send failed (custom API)' }, 400)]);
  const result = await api.submitPublishRequest({
    org: 'org', site: 'site', path: '/fr/home', comment: 'Test',
  }, 'token');
  assert.equal(result.success, false);
  assert.equal(result.ambiguous, true);
  assert.match(result.message, /Email send failed/);
});

test('malformed submission responses do not look successful or log tokens', async () => {
  const { api, logs } = await client([new Response('not JSON', { status: 200 })]);
  const result = await api.submitPublishRequest({
    org: 'org', site: 'site', path: '/fr/home', comment: 'Test',
  }, 'test-secret-token');
  assert.equal(result.success, false);
  assert.equal(result.ambiguous, true);
  assert.ok(logs.length > 0);
  assert.equal(JSON.stringify(logs).includes('test-secret-token'), false);
});
