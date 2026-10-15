import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const appSource = await readFile(new URL('../request-publish-bulk.js', import.meta.url), 'utf8');
const pathsSource = await readFile(new URL('../paths.js', import.meta.url), 'utf8');

async function createApp(overrides = {}) {
  const requests = [];
  const previews = [];
  const toasts = [];
  const logs = [];
  const api = {
    listMyPendingRequests: async () => ({ success: true, requests: [] }),
    listPendingRequests: async () => ({ success: true, requests: [] }),
    validateContent: async () => ({ status: 'ready', message: 'Current preview' }),
    previewContent: async (...args) => { previews.push(args); return { success: true }; },
    submitPublishRequest: async (...args) => { requests.push(args); return { success: true }; },
    getUserEmail: async () => 'test@example.com',
    listTranslationProjects: async () => [],
    loadTranslationProject: async () => ({}),
    ...overrides,
  };
  if (!overrides.listPendingRequests) api.listPendingRequests = api.listMyPendingRequests;
  let App;
  class LitElement {
    constructor() {
      this.shadowRoot = { adoptedStyleSheets: [] };
    }
  }
  const context = vm.createContext({
    URLSearchParams, URL,
    window: { location: { search: '', hostname: 'localhost' } },
    document: { documentElement: { style: {} } },
    customElements: { define: (_name, element) => { App = element; } },
    console: {
      error: (...args) => logs.push(args),
      warn: (...args) => logs.push(args),
    },
  });
  const synthetic = async (exports) => {
    const module = new vm.SyntheticModule(Object.keys(exports), function initialize() {
      Object.entries(exports).forEach(([name, value]) => this.setExport(name, value));
    }, { context });
    await module.link(() => {});
    await module.evaluate();
    return module;
  };
  const sdk = await synthetic({ default: new Promise(() => {}) });
  const lit = await synthetic({
    LitElement,
    html: (strings, ...values) => strings.reduce((text, part, index) => `${text}${part}${[].concat(values[index] ?? '').join('')}`, ''),
    nothing: '',
  });
  const toast = await synthetic({
    showToast: (options) => toasts.push(options),
    VARIANT_ERROR: 'error',
    VARIANT_WARNING: 'warning',
  });
  const helpers = await synthetic(api);
  const style = await synthetic({ default: async () => ({}) });
  const nx = await synthetic({ loadStyle: async () => {}, getColorScheme: () => 'light-scheme' });
  const components = await synthetic({});
  const paths = new vm.SourceTextModule(pathsSource, { context });
  await paths.link(() => {});
  const module = new vm.SourceTextModule(appSource, {
    context,
    importModuleDynamically: async (specifier) => {
      if (specifier.endsWith('/styles.js')) return style;
      if (specifier.endsWith('/nx.js')) return nx;
      return components;
    },
  });
  await module.link((specifier) => {
    if (specifier.endsWith('/sdk.js')) return sdk;
    if (specifier === 'da-lit') return lit;
    if (specifier.endsWith('/toast.js')) return toast;
    if (specifier === './api.js') return helpers;
    if (specifier === './paths.js') return paths;
    throw new Error(`Unexpected import: ${specifier}`);
  });
  await module.evaluate();
  const app = new App();
  app._org = 'org';
  app._site = 'site';
  app.token = 'test-secret-token';
  return { app, requests, previews, toasts, logs };
}

test('paste flow deduplicates paths and blocks missing, stale, and invalid pages', async () => {
  const { app, requests, previews, toasts } = await createApp({
    validateContent: async (_org, _site, path) => ({
      status: path === '/missing' ? 'missing' : 'stale',
    }),
  });
  app._pathsText = '/fr/home\n/fr/home.html\n/missing\n/../bad';
  await app.handleValidate();
  assert.equal(app._duplicates, 1);
  assert.equal(app._items.length, 3);
  assert.equal(app._submittable.length, 0);
  assert.equal(app._items[0].status, 'stale');
  assert.equal(app._items[1].status, 'missing');
  assert.equal(app._items[2].status, 'invalid');
  assert.equal(toasts[0].variant, 'warning');
  assert.equal(requests.length, 0);
  assert.equal(previews.length, 0);
});

test('validation and submission both skip existing pending requests', async () => {
  const { app, requests } = await createApp({
    listMyPendingRequests: async () => ({ success: true, requests: [{ path: '/fr/home' }] }),
  });

  app._pathsText = '/fr/home';
  await app.handleValidate();
  assert.equal(app._items[0].status, 'already-pending');
  app._items = [{ path: '/fr/home', status: 'ready' }];
  await app.handleSubmit();
  assert.equal(app._items[0].status, 'already-pending');
  assert.equal(requests.length, 0);
});

test('another author request visible in the approver inbox blocks validation and submission', async () => {
  const { app, requests, previews } = await createApp({
    listMyPendingRequests: async () => ({ success: true, requests: [] }),
    listPendingRequests: async () => ({
      success: true,
      requests: [{ path: '/en/ca/fragments/fragment-test', requester: 'another-author@example.com' }],
    }),
  });
  app._pathsText = '/en/ca/fragments/fragment-test';
  await app.handleValidate();
  assert.equal(app._items[0].status, 'already-pending');
  assert.equal(app._submittable.length, 0);
  assert.match(app._items[0].message, /approver inbox/);
  app._items = [{ path: '/en/ca/fragments/fragment-test', status: 'ready' }];
  await app.handleSubmit();
  assert.equal(app._items[0].status, 'already-pending');
  assert.equal(requests.length, 0);
  assert.equal(previews.length, 0);
});

for (const [status, label] of [
  ['ready', 'Preview current'],
  ['stale', 'Preview out of date'],
  ['needs-preview', 'Not previewed'],
  ['unverified', 'Freshness unknown'],
  ['missing', 'Page not found'],
  ['error', 'Validation failed'],
]) {
  test(`pending pages show ${status} validation results without allowing resubmission`, async () => {
    let checks = 0;
    const { app, requests, previews } = await createApp({
      listPendingRequests: async () => ({ success: true, requests: [{ path: '/fr/home' }] }),
      validateContent: async () => {
        checks += 1;
        if (status === 'error') throw new Error('Preview status denied (403)');
        return {
          status,
          message: `Content check: ${status}`,
          sourceModified: '2026-10-14T12:00:00Z',
          previewModified: '2026-10-13T12:00:00Z',
          previewSourceModified: '2026-10-13T11:00:00Z',
        };
      },
    });
    app._pathsText = '/fr/home';
    await app.handleValidate();
    assert.equal(checks, 1);
    assert.equal(app._items[0].status, 'already-pending');
    assert.equal(app._items[0].validationStatus, status);
    if (['stale', 'needs-preview', 'unverified'].includes(status)) {
      assert.match(app._items[0].message, /approval/);
    }
    assert.equal(app._submittable.length, 0);
    const rendered = app.renderItems();
    assert.match(rendered, /Already pending/);
    assert.ok(rendered.includes(label));
    if (status === 'error') assert.match(rendered, /403/);
    else assert.match(rendered, /Source included in preview/);
    assert.equal(rendered.includes('this.handlePreview'), ['stale', 'needs-preview', 'unverified'].includes(status));
    assert.equal(app._message.type, status === 'ready' ? 'success' : 'warning');
    await app.handleSubmit();
    assert.equal(requests.length, 0);
    assert.equal(previews.length, 0);
  });
}

test('pending requests discovered before submission are checked for stale previews and never resubmitted', async () => {
  const { app, requests, previews } = await createApp({
    listPendingRequests: async () => ({ success: true, requests: [{ path: '/fr/home' }] }),
    validateContent: async () => ({ status: 'stale', message: 'Source changed' }),
  });
  app._items = [{ path: '/fr/home', status: 'ready' }];
  await app.handleSubmit();
  assert.equal(app._items[0].status, 'already-pending');
  assert.equal(app._items[0].validationStatus, 'stale');
  assert.equal(app._message.type, 'warning');
  assert.equal(requests.length, 0);
  assert.equal(previews.length, 0);
});

test('explicitly refreshing a pending page keeps it pending even when its preview becomes current', async () => {
  let current = false;
  const { app, requests, previews } = await createApp({
    listPendingRequests: async () => ({ success: true, requests: [{ path: '/fr/home' }] }),
    validateContent: async () => ({ status: current ? 'ready' : 'stale', message: 'Preview checked' }),
  });
  app._pathsText = '/fr/home';
  await app.handleValidate();
  assert.match(app.render(), /Preview \/ refresh selected \(0\)/);
  current = true;
  await app.handlePreview(app._items);
  assert.equal(previews.length, 1);
  assert.equal(app._items[0].status, 'already-pending');
  assert.equal(app._items[0].validationStatus, 'ready');
  assert.equal(app._message.type, 'success');
  assert.equal(app._submittable.length, 0);
  assert.match(app.renderItems(), /Preview current/);
  assert.doesNotMatch(app.render(), /Preview \/ refresh selected/);
  await app.handleSubmit();
  assert.equal(requests.length, 0);
});

test('a failed explicit preview preserves pending status and surfaces the failure', async () => {
  const { app, requests, toasts } = await createApp({
    listPendingRequests: async () => ({ success: true, requests: [{ path: '/fr/home' }] }),
    validateContent: async () => ({ status: 'needs-preview', message: 'No preview exists' }),
    previewContent: async () => ({ success: false, error: 'Preview denied (403)' }),
  });
  app._pathsText = '/fr/home';
  await app.handleValidate();
  await app.handlePreview(app._items);
  assert.equal(app._items[0].status, 'already-pending');
  assert.equal(app._items[0].validationStatus, 'error');
  assert.match(app.renderItems(), /403/);
  assert.equal(toasts.at(-1).variant, 'error');
  assert.equal(app._submittable.length, 0);
  assert.equal(requests.length, 0);
});

test('source changed after validation blocks submission without automatically previewing', async () => {
  const { app, requests, previews } = await createApp({
    validateContent: async () => ({ status: 'stale', message: 'Source changed' }),
  });
  app._items = [{ path: '/fr/home', status: 'ready' }];
  await app.handleSubmit();
  assert.equal(app._items[0].status, 'stale');
  assert.equal(requests.length, 0);
  assert.equal(previews.length, 0);
  assert.equal(app._submitting, false);
});

test('explicit preview checks freshness again and enables the page only when current', async () => {
  const { app, previews, requests } = await createApp();
  app._items = [{ path: '/fr/home', status: 'needs-preview' }];
  await app.handlePreview(app._items);
  assert.equal(previews.length, 1);
  assert.equal(app._items[0].status, 'ready');
  assert.equal(requests.length, 0);
  await app.handleSubmit();
  assert.equal(requests.length, 1);
  assert.equal(app._items[0].status, 'submitted');
});

test('failed preview stays blocked and surfaces an error toast', async () => {
  const { app, requests, toasts } = await createApp({
    previewContent: async () => ({ success: false, error: 'Preview failed (403)' }),
  });
  app._items = [{ path: '/fr/home', status: 'needs-preview' }];
  await app.handlePreview(app._items);
  assert.equal(app._items[0].status, 'error');
  assert.match(app._items[0].message, /403/);
  assert.equal(app._submittable.length, 0);
  assert.equal(app._validating, false);
  assert.equal(requests.length, 0);
  assert.equal(toasts[0].variant, 'error');
});

test('preview selection starts empty and select all only includes eligible pages', async () => {
  const { app, previews, requests } = await createApp();
  app._items = [
    { path: '/stale', status: 'stale' },
    { path: '/new', status: 'needs-preview' },
    { path: '/unknown', status: 'unverified' },
    { path: '/pending', status: 'already-pending', pending: true, validationStatus: 'stale' },
    { path: '/current', status: 'ready' },
    { path: '/pending-current', status: 'already-pending', validationStatus: 'ready' },
    { path: '/missing', status: 'missing' },
    { path: '/error', status: 'error' },
    { path: '/invalid', status: 'invalid' },
    { path: '/submitted', status: 'submitted', validationStatus: 'stale' },
  ];
  assert.equal(app._selectedPreviewItems.length, 0);
  assert.match(app.renderItems(), /Select all pages needing preview/);
  assert.equal((app.renderItems().match(/<sl-button/g) || []).length, 1);
  assert.doesNotMatch(app.renderItems(), /Preview page|Refresh preview/);
  app.handleSelectPreviews(true);
  assert.deepEqual(Array.from(app._selectedPreviewItems, (item) => item.path), ['/stale', '/new', '/unknown', '/pending']);
  assert.match(app.renderItems(), /Preview \/ refresh selected \(4\)/);
  assert.match(app.renderItems(), /aria-label=Select \/pending for preview/);
  app.handlePreviewSelection('/current', true);
  assert.equal(app._selectedPreviewPaths.size, 4);
  app.handlePreviewSelection('/new', false);
  assert.equal(app._selectedPreviewItems.length, 3);
  assert.match(app.renderItems(), /\.indeterminate=true/);
  app.handleSelectPreviews(false);
  assert.equal(app._selectedPreviewItems.length, 0);
  assert.match(app.renderItems(), /\.indeterminate=false/);
  assert.equal(previews.length, 0);
  assert.equal(requests.length, 0);
});

test('bulk preview only processes selected pages and preserves pending request protection', async () => {
  const { app, previews, requests } = await createApp();
  app._items = [
    { path: '/selected', status: 'needs-preview' },
    { path: '/unselected', status: 'stale' },
    { path: '/pending', status: 'already-pending', pending: true, validationStatus: 'stale' },
  ];
  app.handlePreviewSelection('/selected', true);
  app.handlePreviewSelection('/pending', true);
  await app.handlePreview(app._selectedPreviewItems);
  assert.deepEqual(previews.map((args) => args[2]).sort(), ['/pending', '/selected']);
  assert.equal(app._items[0].status, 'ready');
  assert.equal(app._items[1].status, 'stale');
  assert.equal(app._items[2].status, 'already-pending');
  assert.equal(app._items[2].validationStatus, 'ready');
  assert.equal(app._selectedPreviewPaths.size, 0);
  assert.equal(app._submittable.length, 1);
  assert.equal(requests.length, 0);
});

test('individual preview leaves other selections intact and uncertain pages remain selected', async () => {
  const { app, previews } = await createApp({
    validateContent: async (_org, _site, path) => ({ status: path === '/unknown' ? 'unverified' : 'ready' }),
  });
  app._items = [
    { path: '/individual', status: 'stale' },
    { path: '/other', status: 'needs-preview' },
    { path: '/unknown', status: 'unverified' },
  ];
  app.handleSelectPreviews(true);
  await app.handlePreview([app._items[0], app._items[2]]);
  assert.deepEqual(Array.from(app._selectedPreviewPaths), ['/other', '/unknown']);
  assert.deepEqual(previews.map((args) => args[2]).sort(), ['/individual', '/unknown']);
});

test('preview selection is locked while busy and cleared for changed input or fresh validation', async () => {
  const { app, previews } = await createApp();
  app._items = [{ path: '/stale', status: 'stale' }];
  app.handleSelectPreviews(true);
  for (const state of ['_validating', '_loadingProjects', '_submitting']) {
    app[state] = true;
    app.handleSelectPreviews(false);
    app.handlePreviewSelection('/stale', false);
    assert.equal(app._selectedPreviewPaths.size, 1);
    app[state] = false;
  }
  app._resetValidation();
  assert.equal(app._selectedPreviewPaths.size, 0);
  app._items = [{ path: '/stale', status: 'stale' }];
  app.handleSelectPreviews(true);
  app._pathsText = '/new';
  await app.handleValidate();
  assert.equal(app._selectedPreviewPaths.size, 0);
  await app.handlePreview(app._selectedPreviewItems);
  assert.equal(previews.length, 0);
});

test('retry reconciles saved requests after notification failures instead of duplicating them', async () => {
  let pending = [];
  let calls = 0;
  const { app } = await createApp({
    listMyPendingRequests: async () => ({ success: true, requests: pending }),
    submitPublishRequest: async ({ path }) => {
      calls += 1;
      pending = [{ path }];
      return { success: false, ambiguous: true, message: 'Email send failed (custom API)' };
    },
  });
  app._items = [{ path: '/fr/home', status: 'ready' }];
  await app.handleSubmit();
  assert.equal(app._items[0].status, 'failed');
  await app.handleRetry();
  assert.equal(calls, 1);
  assert.equal(app._items[0].status, 'submitted');
  assert.match(app._items[0].message, /saved despite/);
  assert.equal(app._submitting, false);
});

test('retry stops if the pending queue cannot be checked', async () => {
  const { app, requests } = await createApp({
    listMyPendingRequests: async () => ({ success: false, error: 'Access denied' }),
  });
  app._items = [{ path: '/fr/home', status: 'failed', ambiguous: true }];
  await app.handleRetry();
  assert.equal(requests.length, 0);
  assert.equal(app._submitting, false);
  assert.match(app._message.text, /Retry stopped/);
});

test('submissions are sequential and one failure does not prevent other pages from being submitted', async () => {
  let active = 0;
  let maximum = 0;
  let calls = 0;
  const { app } = await createApp({
    submitPublishRequest: async () => {
      calls += 1;
      active += 1;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      active -= 1;
      return calls === 1
        ? { success: false, ambiguous: true, message: 'Notification failed' }
        : { success: true };
    },
  });
  app._items = [{ path: '/fr/a', status: 'ready' }, { path: '/fr/b', status: 'ready' }];
  await app.handleSubmit();
  assert.equal(maximum, 1);
  assert.equal(calls, 2);
  assert.equal(app._items[0].status, 'failed');
  assert.equal(app._items[1].status, 'submitted');
});

test('project loading preserves readable titles and reports partial failures', async () => {
  const { app, toasts } = await createApp({
    listTranslationProjects: async () => [
      { path: '/project/a', name: 'a' }, { path: '/project/b', name: 'b' },
    ],
    loadTranslationProject: async (_org, _site, path) => {
      if (path.endsWith('/b')) throw new Error('Project access denied (403)');
      return {
        title: 'Completed French',
        urls: [{ basePath: '/home' }],
        langs: [{
          name: 'French', action: 'translate', location: '/fr/ca',
          translation: { status: 'complete', saved: 1 },
        }],
      };
    },
  });
  await app.handleFlowChange('translations');
  assert.equal(app._projects[0].title, 'Completed French');
  assert.equal(app._projects[0].available, true);
  assert.equal(app._projects[1].available, false);
  assert.equal(toasts[0].variant, 'warning');
  await app.handleProjectSelect('/project/a');
  assert.equal(app._generatedPaths[0], '/fr/ca/home');
  app.handleDestinationChange(app._destinations[0].id, false);
  assert.equal(app._generatedPaths.length, 0);
  assert.equal(app._loadingProjects, false);
});

test('translation project selection offers completed country rollouts but not language masters', async () => {
  const project = {
    title: 'us-fragment-update',
    urls: [{ basePath: '/fragments/fragment-test', suppliedPath: '/en/us/fragments/fragment-test', checked: true }],
    langs: [
      {
        name: 'English', action: 'rollout', location: '/en/us',
        rollout: { status: 'complete', saved: 1 },
        locales: [{ code: '/en/ca', active: true, saved: 1 }],
      },
      {
        name: 'French', action: 'translate', location: '/fr',
        translation: { status: 'complete', saved: 1 },
        rollout: { status: 'complete', saved: 1 },
        locales: [{ code: '/fr/ca', active: true, saved: 1 }],
      },
    ],
  };
  const { app } = await createApp({
    listTranslationProjects: async () => [{ path: '/project/test', name: 'test' }],
    loadTranslationProject: async () => project,
  });
  await app.handleFlowChange('translations');
  assert.equal(app._projects[0].available, true);
  await app.handleProjectSelect('/project/test');
  assert.deepEqual(Array.from(app._generatedPaths), [
    '/en/ca/fragments/fragment-test', '/fr/ca/fragments/fragment-test',
  ]);
  project.langs = [project.langs[1]];
  project.langs[0].rollout.status = 'not started';
  await app.handleLoadProjects();
  assert.equal(app._projects[0].available, false);
  assert.match(app._projects[0].reason, /language\/country/);
});

test('completed country translations are selectable without a separate rollout', async () => {
  const { app } = await createApp({
    listTranslationProjects: async () => [{ path: '/project/test', name: 'test' }],
    loadTranslationProject: async () => ({
      title: 'en-pr-to-es-pr',
      urls: [
        { basePath: '/pr/press-release' },
        { basePath: '/pr/fragments/global-announcement' },
      ],
      langs: [{
        name: 'Spanish - Puerto Rico', action: 'translate', location: '/es',
        translation: { status: 'complete', saved: 2 },
        locales: [{ code: '/es/pr', active: true }],
      }],
    }),
  });
  await app.handleFlowChange('translations');
  assert.equal(app._projects[0].available, true);
  await app.handleProjectSelect('/project/test');
  assert.deepEqual(Array.from(app._generatedPaths), [
    '/es/pr/press-release', '/es/pr/fragments/global-announcement',
  ]);
  assert.equal(app._destinations[0].location, '/es/pr');
});

test('changing site clears project selection and validation results', async () => {
  const { app } = await createApp();
  app._projectPath = '/old/project';
  app._project = { title: 'Old project' };
  app._projects = [{ title: 'Old project' }];
  app._projectEntries = [{ path: '/old/project' }];
  app._projectPage = 2;
  app._items = [{ path: '/fr/home', status: 'ready' }];
  app.handleSiteChange('_site', 'new-site');
  assert.equal(app._project, null);
  assert.equal(app._projects.length, 0);
  assert.equal(app._projectEntries.length, 0);
  assert.equal(app._projectPage, 0);
  assert.equal(app._items.length, 0);
});

function completedProject(title) {
  return {
    title,
    urls: [{ basePath: '/home' }],
    langs: [{
      name: 'French', action: 'translate', location: '/fr/ca',
      translation: { status: 'complete', saved: 1 },
    }],
  };
}

test('select all and deselect all update generated paths and clear old validation', async () => {
  const { app } = await createApp();
  app._destinations = [
    { id: 'fr', paths: ['/fr/home', '/shared'] },
    { id: 'de', paths: ['/de/home', '/shared'] },
  ];
  app._items = [{ path: '/old', status: 'ready' }];
  app.handleSelectDestinations(true);
  assert.equal(app._selectedDestinations.size, 2);
  assert.deepEqual(Array.from(app._generatedPaths), ['/fr/home', '/shared', '/de/home']);
  assert.equal(app._items.length, 0);

  app._items = [{ path: '/fr/home', status: 'ready' }];
  app.handleSelectDestinations(false);
  assert.equal(app._selectedDestinations.size, 0);
  assert.equal(app._generatedPaths.length, 0);
  assert.equal(app._items.length, 0);
});

test('destination selection cannot change during validation, loading, or submission', async () => {
  const { app } = await createApp();
  app._destinations = [{ id: 'fr', paths: ['/fr/home'] }];
  app.handleSelectDestinations(true);
  for (const state of ['_validating', '_loadingProjects', '_submitting']) {
    app[state] = true;
    app.handleSelectDestinations(false);
    app.handleDestinationChange('fr', false);
    assert.equal(app._selectedDestinations.size, 1);
    app[state] = false;
  }
});

test('loads only three project files per page and handles a partial final page', async () => {
  const loaded = [];
  let listCalls = 0;
  const { app } = await createApp({
    listTranslationProjects: async () => {
      listCalls += 1;
      return Array.from({ length: 7 }, (_, index) => ({
        path: `/project/${7 - index}`, name: String(7 - index),
      }));
    },
    loadTranslationProject: async (_org, _site, path) => {
      loaded.push(path);
      return completedProject(path);
    },
  });
  await app.handleFlowChange('translations');
  assert.deepEqual(loaded, ['/project/7', '/project/6', '/project/5']);
  assert.equal(app._projectPageCount, 3);
  assert.equal(app._projectPage, 0);
  assert.equal(app._projects.length, 3);

  await app.handleProjectPage(1);
  assert.deepEqual(loaded.slice(3), ['/project/4', '/project/3', '/project/2']);
  assert.equal(app._projectPage, 1);
  assert.equal(listCalls, 1);

  await app.handleProjectPage(2);
  assert.deepEqual(loaded.slice(6), ['/project/1']);
  assert.equal(app._projects.length, 1);
  await app.handleProjectPage(3);
  await app.handleProjectPage(-1);
  await app.handleProjectPage(0.5);
  assert.equal(loaded.length, 7);
  assert.equal(app._projectPage, 2);

  await app.handleProjectPage(0);
  assert.equal(loaded.length, 10);
  assert.equal(app._projects[0].path, '/project/7');
  assert.equal(listCalls, 1);
});

test('shows loading state until asynchronous page reads finish and prevents overlapping requests', async () => {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const { app } = await createApp({
    listTranslationProjects: async () => [{ path: '/project/a', name: 'a' }],
    loadTranslationProject: async () => pending,
  });
  const loading = app.handleLoadProjects();
  assert.equal(app._loadingProjects, true);
  assert.equal(app._busy, true);
  assert.equal(app._projects.length, 0);
  await app.handleProjectPage(0);
  finish(completedProject('Loaded asynchronously'));
  await loading;
  assert.equal(app._loadingProjects, false);
  assert.equal(app._projects[0].title, 'Loaded asynchronously');
});

test('changing project pages clears selection and validated paths before loading the next page', async () => {
  const { app } = await createApp({
    listTranslationProjects: async () => Array.from({ length: 4 }, (_, index) => ({
      path: `/project/${index}`, name: String(index),
    })),
    loadTranslationProject: async () => completedProject('Translation'),
  });
  await app.handleLoadProjects();
  await app.handleProjectSelect('/project/0');
  app._items = [{ path: '/fr/home', status: 'ready' }];
  await app.handleProjectPage(1);
  assert.equal(app._project, null);
  assert.equal(app._projectPath, '');
  assert.equal(app._generatedPaths.length, 0);
  assert.equal(app._items.length, 0);
  assert.equal(app._projects[0].path, '/project/3');
  await app.handleLoadProjects();
  assert.equal(app._projectPage, 0);
  assert.equal(app._projects.length, 3);
});

test('empty lists and list failures clear the spinner and do not leave stale page metadata', async () => {
  let fail = false;
  const { app } = await createApp({
    listTranslationProjects: async () => {
      if (fail) throw new Error('Translation list denied (403)');
      return [];
    },
  });
  await app.handleLoadProjects();
  assert.equal(app._projectPageCount, 0);
  assert.equal(app._loadingProjects, false);
  assert.match(app._message.text, /No active/);
  fail = true;
  await app.handleLoadProjects();
  assert.equal(app._loadingProjects, false);
  assert.equal(app._projects.length, 0);
  assert.equal(app._projectEntries.length, 0);
  assert.equal(app._message.type, 'error');
});
