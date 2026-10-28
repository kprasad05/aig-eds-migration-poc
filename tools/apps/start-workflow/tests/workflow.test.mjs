import assert from 'node:assert/strict';
import { test } from 'node:test';
import { modules, sheets } from './helpers.mjs';

async function fixture({ paths = ['/en/fragments/a.html', '/en/fragments/b.html'], codes = ['fr', 'de'] } = {}) {
  const { model, workflow } = await modules();
  const config = model.parseConfig(sheets());
  const sources = new Map(paths.map((path) => [path, { content: `<main><p>${path}</p></main>`, modified: 'today' }]));
  const destinations = new Map();
  const saved = [];
  const calls = { translates: 0, writes: 0 };
  const io = {
    readSource: async (path) => sources.get(path) || null,
    readDestination: async (path) => destinations.get(path) || null,
    saveDestination: async (path, content) => {
      calls.writes += 1;
      destinations.set(path, { content });
    },
    saveProject: async (project) => { saved.push(structuredClone(project)); },
    translate: async (content, code) => {
      calls.translates += 1;
      return `${content}<span>${code}</span>`;
    },
  };
  const project = await model.createProject({
    org: 'org', site: 'site', title: 'Test', paths, codes, config, readSource: io.readSource,
  });
  return {
    model, workflow, project, config, sources, destinations, saved, io, calls,
    run: (options) => workflow.runProject(project, config, io, options),
  };
}

test('validates actual configured source, provider, targets, actions and chained sources', async () => {
  const { model } = await modules();
  assert.equal(model.parseConfig(sheets()).targets.length, 2);
  const wrongSource = sheets();
  wrongSource.config.data[1].value = 'German';
  assert.throws(() => model.parseConfig(wrongSource), /source.language/);
  const provider = sheets();
  provider.config.data[0].value = 'Other';
  assert.throws(() => model.parseConfig(provider), /Google/);
  const config = sheets();
  config.languages.data[1].location = '/fr/ca';
  assert.throws(() => model.parseConfig(config), /Invalid language configuration/);
  config.languages.data[1].location = '/fr';
  config.languages.data[1].actions = 'Skip';
  assert.deepEqual(Array.from(model.parseConfig(config).targets, (lang) => lang.code), ['de']);
  config.languages.data[2]['source language'] = 'French';
  assert.throws(() => model.parseConfig(config), /Configure regional locales/);
});

test('creates a native-shaped project, deduplicates pages and fingerprints source revisions', async () => {
  const f = await fixture({ paths: ['/en/fragments/a.html', '/en/fragments/a.html'] });
  assert.equal(f.project.urls.length, 1);
  assert.equal(f.project.workflow.items.length, 2);
  assert.equal(f.project.urls[0].basePath, '/fragments/a');
  assert.match(f.project.workflow.items[0].sourceHash, /^[a-f0-9]{64}$/);
  assert.equal(f.project.workflow.items[0].destination, '/fr/fragments/a.html');
  assert.ok(f.model.projectPath(f.project.id).startsWith('/.da/translation/active/workflow-'));
  assert.equal(f.project.options['source.language'].code, 'en');
  assert.equal(f.model.validateProject(f.project, 'org', 'site'), f.project);
});

test('rejects invalid paths, cross-site projects, altered destinations and missing tasks', async () => {
  const f = await fixture();
  for (const path of ['/enough/a.html', '/en/../a.html', '/en/a.json', '/en/a.html?x', '/en//a.html']) {
    assert.throws(() => f.model.assertPage(path), /Unsupported/);
  }
  assert.throws(() => f.model.validateProject(f.project, 'other', 'site'), /supported/);
  const changed = structuredClone(f.project);
  changed.workflow.items[0].destination = '/.da/translate.json';
  assert.throws(() => f.model.validateProject(changed, 'org', 'site'), /Invalid workflow task/);
  changed.workflow.items = [];
  assert.throws(() => f.model.validateProject(changed, 'org', 'site'), /incomplete/);
  await assert.rejects(f.model.createProject({
    org: 'org', site: 'site', title: 'Test', paths: [], codes: ['fr'],
    config: f.config, readSource: f.io.readSource,
  }), /between 1 and 25/);
});

test('translates all page/locale pairs, confirms actual saves and skips completed retries', async () => {
  const f = await fixture();
  await f.run();
  assert.equal(f.calls.translates, 4);
  assert.equal(f.calls.writes, 4);
  assert.equal(f.project.workflow.status, 'complete');
  assert.ok(f.project.workflow.items.every((item) => item.status === 'complete' && item.savedDate));
  assert.equal(f.project.langs[0].translation.saved, 2);
  assert.equal(f.project.langs[0].translation.status, 'complete');
  await f.run();
  assert.equal(f.calls.translates, 4);
  assert.equal(f.calls.writes, 4);
  assert.doesNotMatch(JSON.stringify(f.saved), /Bearer|accessToken|<main>/);
});

test('partial provider failures do not claim save completion and retry only unfinished tasks', async () => {
  const f = await fixture({ codes: ['fr'] });
  const translate = f.io.translate;
  let fail = true;
  f.io.translate = async (content, code) => {
    if (fail && content.includes('/b.html')) throw new Error('Provider unavailable');
    return translate(content, code);
  };
  await f.run();
  assert.equal(f.project.workflow.status, 'partial-failure');
  assert.equal(f.project.langs[0].translation.saved, 1);
  assert.equal(f.project.workflow.items[1].status, 'failed');
  fail = false;
  await f.run();
  assert.equal(f.calls.writes, 2);
  assert.equal(f.project.workflow.status, 'complete');
});

test('source changes and pre-existing destination content require review with no write', async () => {
  const f = await fixture({ codes: ['fr'] });
  f.sources.set('/en/fragments/a.html', { content: '<main>changed</main>' });
  f.destinations.set('/fr/fragments/b.html', { content: '<main>existing</main>' });
  await f.run();
  assert.ok(f.project.workflow.items.every((item) => item.status === 'needs-review'));
  assert.equal(f.calls.translates, 0);
  assert.equal(f.calls.writes, 0);
  await f.run();
  assert.equal(f.calls.writes, 0);
});

test('detects source or destination changes while translation is running', async () => {
  for (const change of ['source', 'destination']) {
    const f = await fixture({ paths: ['/en/fragments/a.html'], codes: ['fr'] });
    f.io.translate = async () => {
      if (change === 'source') f.sources.set('/en/fragments/a.html', { content: '<main>changed</main>' });
      else f.destinations.set('/fr/fragments/a.html', { content: '<main>concurrent edit</main>' });
      return '<main>translated</main>';
    };
    await f.run();
    assert.equal(f.project.workflow.items[0].status, 'needs-review');
    assert.equal(f.calls.writes, 0);
  }
});

test('ambiguous destination save is reconciled after reopening without a second provider call/write', async () => {
  const f = await fixture({ paths: ['/en/fragments/a.html'], codes: ['fr'] });
  const write = f.io.saveDestination;
  f.io.saveDestination = async (...args) => {
    await write(...args);
    throw new Error('Connection lost after save');
  };
  await f.run();
  assert.equal(f.project.workflow.items[0].status, 'save-unconfirmed');
  assert.equal(f.project.langs[0].translation.saved, 0);
  const reopened = structuredClone(f.saved.at(-1));
  await f.workflow.runProject(reopened, f.config, f.io);
  assert.equal(reopened.workflow.status, 'complete');
  assert.equal(f.calls.translates, 1);
  assert.equal(f.calls.writes, 1);
});

test('status persistence failure stops execution instead of continuing writes', async () => {
  const f = await fixture();
  f.io.saveProject = async () => { throw new Error('Status ACL denied'); };
  await assert.rejects(f.run(), /Status ACL denied/);
  assert.equal(f.calls.translates, 0);
  assert.equal(f.calls.writes, 0);
  let saves = 0;
  f.io.saveProject = async () => {
    saves += 1;
    if (saves === 3) throw new Error('Status disk unavailable');
  };
  await assert.rejects(f.run(), /Execution stopped/);
  assert.equal(f.calls.translates, 1);
  assert.equal(f.calls.writes, 0);
});

test('a lost final checkpoint is reconciled from the last durable saving state', async () => {
  const f = await fixture({ paths: ['/en/fragments/a.html'], codes: ['fr'] });
  const persist = f.io.saveProject;
  f.io.saveProject = async (project) => {
    if (project.workflow.items[0].status === 'complete') throw new Error('Checkpoint lost');
    await persist(project);
  };
  await assert.rejects(f.run(), /Checkpoint lost/);
  const reopened = structuredClone(f.saved.at(-1));
  assert.equal(reopened.workflow.items[0].status, 'saving');
  f.io.saveProject = persist;
  await f.workflow.runProject(reopened, f.config, f.io);
  assert.equal(reopened.workflow.status, 'complete');
  assert.equal(f.calls.translates, 1);
  assert.equal(f.calls.writes, 1);
});

test('pause finishes the current task, persists progress, and requires explicit resume', async () => {
  const f = await fixture({ codes: ['fr'] });
  await f.run({ shouldStop: () => f.calls.writes === 1 });
  assert.equal(f.calls.writes, 1);
  assert.equal(f.saved.at(-1).workflow.items[1].status, 'queued');
  await f.run();
  assert.equal(f.calls.writes, 2);
});

test('configuration drift fails before any content writes or provider calls', async () => {
  const f = await fixture();
  f.config.sheets.config.data.push({ key: 'new-rule', value: 'changed' });
  await assert.rejects(f.run(), /configuration changed/);
  assert.equal(f.calls.translates, 0);
  assert.equal(f.calls.writes, 0);
});

test('enforces the exact 25-page and 120-character title limits before any source read', async () => {
  const paths = Array.from({ length: 25 }, (_, i) => `/en/fragments/page-${i}.html`);
  const f = await fixture({ paths, codes: ['fr'] });
  assert.equal(f.project.workflow.items.length, 25);
  let reads = 0;
  const input = {
    org: 'org', site: 'site', title: 'x'.repeat(120), paths, codes: ['fr'],
    config: f.config,
    readSource: async (path) => { reads += 1; return f.io.readSource(path); },
  };
  assert.equal((await f.model.createProject(input)).title.length, 120);
  assert.equal(reads, 25);
  reads = 0;
  await assert.rejects(f.model.createProject({ ...input, paths: [...paths, '/en/fragments/page-26.html'] }), /between 1 and 25/);
  await assert.rejects(f.model.createProject({ ...input, title: 'x'.repeat(121) }), /title/);
  assert.equal(reads, 0);
});

test('rejects missing save fingerprints and inconsistent source revision metadata', async () => {
  const f = await fixture();
  const item = f.project.workflow.items[0];
  item.status = 'complete';
  assert.throws(() => f.model.validateProject(f.project, 'org', 'site'), /Invalid workflow task/);
  item.status = 'queued';
  item.sourceHash = '0'.repeat(64);
  assert.throws(() => f.model.validateProject(f.project, 'org', 'site'), /Invalid workflow task/);
});
