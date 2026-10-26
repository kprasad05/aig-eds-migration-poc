import assert from 'node:assert/strict';
import { test } from 'node:test';
import { modules } from './helpers.mjs';

const payload = {
  version: 1, org: 'org', site: 'site',
  workflowId: 'workflow-00000000-0000-4000-8000-000000000000',
  paths: ['/fr/fragments/a', '/de/fragments/b'],
};

function search(data = payload) {
  return `?${new URLSearchParams({ workflowHandoff: JSON.stringify(data) })}`;
}

test('local handoff preserves the DA app shell, site, workflow, paths and explicit production service', async () => {
  const { handoff } = await modules();
  const url = new URL(handoff.createWorkflowHandoffUrl({
    ...payload, location: { hostname: 'localhost', search: '' },
  }));
  assert.equal(url.origin, 'https://da.live');
  assert.equal(url.pathname, '/app/org/site/tools/apps/request-publish-bulk/request-publish-bulk');
  assert.equal(url.searchParams.get('ref'), 'local');
  assert.equal(url.searchParams.get('env'), 'prod');
  assert.equal(url.searchParams.get('org'), 'org');
  assert.equal(url.searchParams.get('site'), 'site');
  assert.equal(JSON.stringify(handoff.readWorkflowHandoff(url.search, 'org', 'site')), JSON.stringify(payload));
  assert.doesNotMatch(url.href, /Bearer|token|accessToken/);
});

test('branch reference and CI service survive the handoff; local host always stays local', async () => {
  const { handoff } = await modules();
  for (const suffix of ['page', 'live']) {
    const url = new URL(handoff.createWorkflowHandoffUrl({
      ...payload, location: { hostname: `poc-workflow--site--org.aem.${suffix}`, search: '?env=ci' },
    }));
    assert.equal(url.searchParams.get('ref'), 'poc-workflow');
    assert.equal(url.searchParams.get('env'), 'ci');
  }
  const explicit = new URL(handoff.createWorkflowHandoffUrl({
    ...payload, location: { hostname: 'example.test', search: '?ref=poc-workflow' },
  }));
  assert.equal(explicit.searchParams.get('ref'), 'poc-workflow');
  const local = new URL(handoff.createWorkflowHandoffUrl({
    ...payload, location: { hostname: '127.0.0.1', search: '?ref=main' },
  }));
  assert.equal(local.searchParams.get('ref'), 'local');
  assert.throws(() => handoff.createWorkflowHandoffUrl({
    ...payload, location: { hostname: 'unknown.test', search: '' },
  }), /Cannot determine/);
  assert.throws(() => handoff.createWorkflowHandoffUrl({
    ...payload, location: { hostname: 'localhost', search: '?env=unknown' },
  }), /prod or ci/);
});

test('receiver rejects wrong site, traversal, arbitrary URLs, source paths, duplicates and malformed payloads', async () => {
  const { handoff } = await modules();
  assert.equal(handoff.readWorkflowHandoff('?org=org&site=site', 'org', 'site'), null);
  for (const data of [
    { ...payload, version: 2 },
    { ...payload, org: 'other' },
    { ...payload, site: 'other' },
    { ...payload, workflowId: '../config' },
    { ...payload, paths: [] },
    { ...payload, paths: ['/fr/a', '/fr/a'] },
    ...['/en/a', '/fr/../a', '/fr/.da/config', 'https://evil.test/a', '/fr/a?x', '/fr/a.html', '/fr//a', null]
      .map((path) => ({ ...payload, paths: [path] })),
    null,
  ]) {
    assert.throws(() => handoff.readWorkflowHandoff(search(data), 'org', 'site'), /Invalid workflow handoff/);
  }
  assert.throws(() => handoff.readWorkflowHandoff('?workflowHandoff=not-json', 'org', 'site'), /invalid JSON/);
  assert.throws(() => handoff.readWorkflowHandoff(`${search()}&workflowHandoff={}`, 'org', 'site'), /duplicate/);
});

test('enforces the 50-path and bounded URL limits without silently dropping paths', async () => {
  const { handoff } = await modules();
  const paths = Array.from({ length: 50 }, (_, i) => `/fr/page-${i}`);
  const url = new URL(handoff.createWorkflowHandoffUrl({
    ...payload, paths, location: { hostname: 'localhost', search: '' },
  }));
  assert.equal(handoff.readWorkflowHandoff(url.search, 'org', 'site').paths.length, 50);
  assert.throws(() => handoff.readWorkflowHandoff(search({
    ...payload, paths: [...paths, '/de/page-51'],
  }), 'org', 'site'), /1.50/);
  assert.throws(() => handoff.createWorkflowHandoffUrl({
    ...payload, paths: [`/fr/${'x'.repeat(7000)}`],
    location: { hostname: 'localhost', search: '' },
  }), /too long/);
  assert.throws(() => handoff.readWorkflowHandoff(`?workflowHandoff=${'x'.repeat(7000)}`, 'org', 'site'), /too large/);
});
