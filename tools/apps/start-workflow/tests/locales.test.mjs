import assert from 'node:assert/strict';
import { test } from 'node:test';
import { modules, regionalSheets } from './helpers.mjs';

async function fixture(targetIds = ['/en/pr', '/es/pr']) {
  const { model, workflow } = await modules();
  const config = model.parseConfig(regionalSheets());
  const path = '/en/fragments/a.html';
  const sources = new Map([[path, { content: '<main>Hello</main>' }]]);
  const destinations = new Map();
  const events = [];
  const snapshots = [];
  const io = {
    readSource: async (source) => sources.get(source) || null,
    readDestination: async (destination) => destinations.get(destination) || null,
    prepareRollout: async (content) => content,
    saveDestination: async (destination, content) => {
      events.push(['save', destination, content]);
      destinations.set(destination, { content });
    },
    saveProject: async (project) => { snapshots.push(structuredClone(project)); },
    translate: async (content, code) => {
      events.push(['translate', code]);
      return `<main>${code}: translated</main>`;
    },
  };
  const project = await model.createProject({
    org: 'org', site: 'site', title: 'Regional workflow', paths: [path],
    targetIds, config, readSource: io.readSource,
  });
  return {
    model, workflow, config, project, io, sources, destinations, events, snapshots,
    run: (options) => workflow.runProject(project, config, io, options),
  };
}

test('reads locations and locale rows, preserves regional codes, and selects the provider language code', async () => {
  const f = await fixture(['/fr/fr', '/fr/ca', '/zh/cn']);
  assert.equal(f.config.targets.length, 6);
  const canada = f.config.targets.find((target) => target.id === '/fr/ca');
  assert.equal(canada.code, 'fr-ca');
  assert.equal(canada.translationCode, 'fr');
  assert.equal(f.config.targets.find((target) => target.id === '/en/pr').translate, false);
  assert.equal(f.config.targets.find((target) => target.id === '/zh/cn').location, '/zh-hans');
  assert.equal(f.project.workflow.items[2].destination, '/zh/cn/fragments/a.html');
  assert.equal(f.model.validateProject(f.project, 'org', 'site'), f.project);
});

test('one workflow rolls out English and rolls out then translates Spanish, overwriting existing destinations', async () => {
  const f = await fixture();
  f.destinations.set('/en/pr/fragments/a.html', { content: '<main>old regional edit</main>' });
  f.destinations.set('/es/pr/fragments/a.html', { content: '<main>old translation</main>' });
  await f.run();
  assert.deepEqual(f.events, [
    ['save', '/en/pr/fragments/a.html', '<main>Hello</main>'],
    ['save', '/es/pr/fragments/a.html', '<main>Hello</main>'],
    ['translate', 'es'],
    ['save', '/es/pr/fragments/a.html', '<main>es: translated</main>'],
  ]);
  assert.ok(f.project.workflow.items.every((item) => item.status === 'complete' && item.rolloutStatus === 'complete'));
  assert.equal(f.project.workflow.status, 'complete');
  assert.equal(f.project.workflow.mode, f.model.LOCALE_MODE);
  assert.ok(f.snapshots.some((project) => project.workflow.items[1].rolloutStatus === 'complete'
    && project.workflow.items[1].status === 'translating'));
  assert.doesNotMatch(JSON.stringify(f.snapshots), /<main>|Bearer/);
  await f.run();
  assert.equal(f.events.length, 4);
});

test('same provider language across multiple locales has independent counts and destinations', async () => {
  const f = await fixture(['/fr/fr', '/fr/ca']);
  await f.run();
  assert.equal(f.project.workflow.items.length, 2);
  assert.deepEqual(f.events.filter(([type]) => type === 'translate'), [['translate', 'fr'], ['translate', 'fr']]);
  assert.ok(f.project.langs.every((lang) => lang.translation.saved === 1 && lang.rollout.saved === 1));
});

test('translation failure leaves only rollout complete, is not publishable, and retry does not repeat rollout', async () => {
  const f = await fixture(['/es/pr']);
  const translate = f.io.translate;
  f.io.translate = async () => { throw new Error('Google unavailable'); };
  await f.run();
  assert.equal(f.project.workflow.items[0].status, 'failed');
  assert.equal(f.project.workflow.items[0].rolloutStatus, 'complete');
  assert.equal(f.project.langs[0].rollout.status, 'pending');
  assert.equal(f.project.langs[0].translation.saved, 0);
  assert.equal(f.destinations.get('/es/pr/fragments/a.html').content, '<main>Hello</main>');
  f.io.translate = translate;
  await f.run();
  assert.equal(f.events.filter(([type]) => type === 'save').length, 2);
  assert.equal(f.project.workflow.status, 'complete');
});

test('ambiguous rollout saves reconcile before proceeding, for English and Spanish', async () => {
  for (const locale of ['/en/pr', '/es/pr']) {
    const f = await fixture([locale]);
    const save = f.io.saveDestination;
    f.io.saveDestination = async (...args) => {
      await save(...args);
      throw new Error('Connection lost after rollout write');
    };
    await f.run();
    assert.equal(f.project.workflow.items[0].rolloutStatus, 'save-unconfirmed');
    assert.notEqual(f.project.workflow.items[0].status, 'complete');
    assert.equal(f.events.some(([type]) => type === 'translate'), false);
    f.io.saveDestination = save;
    await f.run();
    assert.equal(f.project.workflow.status, 'complete');
    assert.equal(f.events.filter(([type]) => type === 'save').length, locale === '/en/pr' ? 1 : 2);
  }
});

test('ambiguous final translation saves reconcile without another provider call or content write', async () => {
  const f = await fixture(['/es/pr']);
  const save = f.io.saveDestination;
  f.io.saveDestination = async (path, content) => {
    await save(path, content);
    if (content.includes('translated')) throw new Error('Final save response lost');
  };
  await f.run();
  assert.equal(f.project.workflow.items[0].status, 'save-unconfirmed');
  const reopened = structuredClone(f.snapshots.at(-1));
  await f.workflow.runProject(reopened, f.config, f.io);
  assert.equal(reopened.workflow.status, 'complete');
  assert.equal(f.events.length, 3);
});

test('failed rollout blocks translation and partial progress preserves completed targets', async () => {
  const f = await fixture();
  const save = f.io.saveDestination;
  f.io.saveDestination = async (path, content) => {
    if (path.startsWith('/es/')) throw new Error('DA write forbidden');
    return save(path, content);
  };
  await f.run();
  assert.equal(f.project.workflow.items[0].status, 'complete');
  assert.equal(f.project.workflow.items[1].rolloutStatus, 'save-unconfirmed');
  assert.equal(f.project.workflow.items[1].status, 'failed');
  assert.match(f.project.workflow.items[1].error, /DA write forbidden/);
  assert.equal(f.events.some(([type]) => type === 'translate'), false);
});

test('source changes block writes, including changes while Google processes the rollout copy', async () => {
  const f = await fixture(['/es/pr']);
  f.io.translate = async () => {
    f.sources.set('/en/fragments/a.html', { content: '<main>New source</main>' });
    return '<main>translated</main>';
  };
  await f.run();
  assert.equal(f.project.workflow.items[0].status, 'needs-review');
  assert.equal(f.events.filter(([type]) => type === 'save').length, 1);
  assert.equal(f.project.langs[0].translation.saved, 0);
});

test('status persistence gates both rollout and translation writes', async () => {
  for (const status of ['rolling-out', 'translating', 'saving']) {
    const f = await fixture(['/es/pr']);
    const persist = f.io.saveProject;
    f.io.saveProject = async (project) => {
      if (project.workflow.items[0].status === status) throw new Error('Checkpoint failed');
      await persist(project);
    };
    await assert.rejects(f.run(), /Execution stopped/);
    assert.equal(f.events.filter(([type]) => type === 'save').length, status === 'rolling-out' ? 0 : 1);
  }
});

test('validates task identity, source safety and configuration drift before any write', async () => {
  const f = await fixture();
  const bad = structuredClone(f.project);
  bad.workflow.items[0].destination = '/en/fragments/a.html';
  assert.throws(() => f.model.validateProject(bad, 'org', 'site'), /Invalid workflow task/);
  bad.workflow.items[0] = { ...f.project.workflow.items[0], translate: true };
  assert.throws(() => f.model.validateProject(bad, 'org', 'site'), /Invalid workflow task/);
  f.config.sheets.languages.data[3].locales = '/en/us';
  await assert.rejects(f.run(), /configuration changed/);
  assert.equal(f.events.length, 0);
});

test('rejects duplicate locale definitions, traversal and unknown target selections', async () => {
  const { model } = await modules();
  const config = regionalSheets();
  config.languages.data.push({ ...config.languages.data[1] });
  assert.throws(() => model.parseConfig(config), /Duplicate locale/);
  config.languages.data.pop();
  config.languages.data[1].locales = '/fr/../private';
  assert.throws(() => model.parseConfig(config), /Invalid regional locale/);
  const f = await fixture();
  await assert.rejects(model.createProject({
    org: 'org', site: 'site', title: 'Invalid', paths: ['/en/fragments/a.html'],
    targetIds: ['/es/unknown'], config: f.config, readSource: f.io.readSource,
  }), /configured target locale/);
});

test('source and destination overlap is rejected before source reads or writes', async () => {
  const f = await fixture(['/en/pr']);
  let reads = 0;
  await assert.rejects(f.model.createProject({
    org: 'org', site: 'site', title: 'Overlap',
    paths: ['/en/fragments/a.html', '/en/pr/fragments/a.html'],
    targetIds: ['/en/pr'], config: f.config,
    readSource: async () => { reads += 1; return { content: '<main>Source</main>' }; },
  }), /overwrite a selected source/);
  assert.equal(reads, 0);
});

test('lost final checkpoint recovers from durable stage state without repeating confirmed writes', async () => {
  for (const locale of ['/en/pr', '/es/pr']) {
    const f = await fixture([locale]);
    const persist = f.io.saveProject;
    f.io.saveProject = async (project) => {
      if (project.workflow.items[0].status === 'complete') throw new Error('Final checkpoint lost');
      await persist(project);
    };
    await assert.rejects(f.run(), /Final checkpoint lost/);
    const reopened = structuredClone(f.snapshots.at(-1));
    const count = f.events.length;
    f.io.saveProject = persist;
    await f.workflow.runProject(reopened, f.config, f.io);
    assert.equal(reopened.workflow.status, 'complete');
    assert.equal(f.events.length, count);
  }
});

test('mismatched final readback is not complete and malformed rollout on retry is explicitly failed', async () => {
  const f = await fixture(['/es/pr']);
  const save = f.io.saveDestination;
  f.io.saveDestination = async (path, content) => {
    await save(path, content);
    if (content.includes('translated')) f.destinations.set(path, { content: '<main>normalized unexpectedly</main>' });
  };
  await f.run();
  assert.equal(f.project.workflow.items[0].status, 'save-unconfirmed');
  assert.equal(f.project.langs[0].translation.saved, 0);
  f.io.prepareRollout = async () => { throw new Error('Rollout source HTML is malformed'); };
  await f.run();
  assert.equal(f.project.workflow.items[0].status, 'failed');
  assert.match(f.project.workflow.items[0].error, /malformed/);
});
