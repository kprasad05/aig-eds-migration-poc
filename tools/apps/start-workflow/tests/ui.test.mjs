import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { regionalSheets } from './helpers.mjs';

const root = new URL('../../../../', import.meta.url);
const appUrl = 'https://workflow.test/tools/apps/start-workflow/start-workflow.html?org=org&site=site&ref=local';

async function browserFixture(t, {
  failGerman = false, translationConfig = regionalSheets(),
} = {}) {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext();
  const page = await context.newPage();
  const content = new Map([
    ['/en/fragments/a.html', '<html><body><main><p>Hello A</p><code>keep-me</code></main></body></html>'],
    ['/en/fragments/b.html', '<html><body><main><p>Hello B</p></main></body></html>'],
  ]);
  const projects = new Map();
  const calls = {
    translations: 0, destinations: 0, approval: 0, errors: [], stages: [],
  };
  page.on('pageerror', (error) => calls.errors.push(error.message));
  context.on('page', (next) => next.on('pageerror', (error) => calls.errors.push(error.message)));
  const state = { failGerman };
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const respond = (body, status = 200, type = 'application/json') => route.fulfill({
      status, body, contentType: type, headers: { 'Access-Control-Allow-Origin': '*' },
    });
    try {
      if (url.hostname === 'workflow.test') {
        if (url.pathname === '/tools/deps/rum.js') return await respond('', 200, 'application/javascript');
        const type = url.pathname.endsWith('.html') ? 'text/html' : url.pathname.endsWith('.css')
          ? 'text/css' : 'application/javascript';
        return await respond(await readFile(new URL(url.pathname.slice(1), root), 'utf8'), 200, type);
      }
      if (url.href === 'https://da.live/nx/utils/sdk.js') {
        return await respond('export default Promise.resolve({context:{org:"org",repo:"site"},token:"session"});', 200, 'application/javascript');
      }
      if (url.href === 'https://da.live/nx/utils/daFetch.js') {
        return await respond('export const daFetch = (url, options) => fetch(url, options);', 200, 'application/javascript');
      }
      if (url.pathname === '/app/org/site/tools/apps/request-publish-bulk/request-publish-bulk') {
        const target = `https://workflow.test/tools/apps/request-publish-bulk/request-publish-bulk.html${url.search}`;
        return await respond(`<html><script>location.replace(${JSON.stringify(target)})</script></html>`, 200, 'text/html');
      }
      if (url.href === 'https://da.live/nx2/public/utils/styles.js') {
        return await respond('export default async () => new CSSStyleSheet();', 200, 'application/javascript');
      }
      if (url.href === 'https://da.live/nx2/scripts/nx.js') {
        return await respond('export const loadStyle = async () => {}; export const getColorScheme = () => "light-scheme";', 200, 'application/javascript');
      }
      if (url.href === 'https://da.live/nx2/public/sl/components.js') {
        return await respond('', 200, 'application/javascript');
      }
      if (url.href === 'https://da.live/nx2/blocks/shared/toast/toast.js') {
        return await respond('export const showToast = () => {}; export const VARIANT_ERROR = "error"; export const VARIANT_WARNING = "warning";', 200, 'application/javascript');
      }
      if (url.hostname === 'da.live' && url.pathname.endsWith('.css')) return await respond('', 200, 'text/css');
      if (url.pathname.endsWith('/dnt/dnt.js')) {
        return await respond('export const addDnt = async (html) => html; export const removeDnt = async ({html}) => html;', 200, 'application/javascript');
      }
      if (url.pathname.endsWith('/regional-diff/regional-diff.js')) {
        return await respond(`export const removeLocTags = (document) => {
          document.querySelectorAll('da-loc-deleted, [loc-temp-dom]').forEach((el) => el.remove());
          document.querySelectorAll('[loc-added]').forEach((el) => el.removeAttribute('loc-added'));
        };`, 200, 'application/javascript');
      }
      if (request.method() === 'OPTIONS') return await respond('', 204);
      assert.equal(request.headers().authorization, 'Bearer session');
      if (url.hostname === 'ims-na1.adobelogin.com') return await respond('{"email":"author@example.com"}');
      if (url.hostname.endsWith('.workers.dev')) {
        calls.approval += 1;
        throw new Error('No approval-service request should occur merely by opening the handoff.');
      }
      if (url.hostname === 'translate.da.live') {
        assert.equal(url.pathname, '/translate/google/org/site');
        calls.translations += 1;
        const form = await new Request(url, {
          method: 'POST', headers: request.headers(), body: request.postDataBuffer(),
        }).formData();
        assert.equal(form.get('fromlang'), 'en');
        calls.stages.push(['translate', form.get('tolang')]);
        if (state.failGerman && form.get('tolang') === 'de' && form.get('data').includes('Hello B')) {
          return await respond('{"error":"test provider failure"}', 503);
        }
        return await respond(JSON.stringify({
          translated: form.get('data').replace('Hello', {
            fr: 'Bonjour', de: 'Hallo', es: 'Hola',
          }[form.get('tolang')] || 'Translated'),
        }));
      }
      assert.equal(url.hostname, 'admin.da.live');
      if (url.pathname === '/list/org/site/en/fragments') {
        return await respond(JSON.stringify(['a', 'b'].map((name) => ({
          name, ext: 'html', path: `/org/site/en/fragments/${name}.html`,
        }))));
      }
      if (url.pathname === '/list/org/site/.da/translation/active') {
        return await respond(JSON.stringify([...projects.keys()].map((path) => ({
          ext: 'json', path: `/org/site${path}`, lastModified: Date.now(),
        }))));
      }
      assert.ok(url.pathname.startsWith('/source/org/site/'));
      const path = url.pathname.slice('/source/org/site'.length);
      if (path === '/.da/translate.json') return await respond(JSON.stringify(translationConfig));
      if (request.method() === 'POST') {
        const form = await new Request(url, {
          method: 'POST', headers: request.headers(), body: request.postDataBuffer(),
        }).formData();
        const body = await form.get('data').text();
        if (path.startsWith('/.da/translation/active/')) projects.set(path, body);
        else {
          assert.match(path, /^\/(?:fr|de|en|es|zh)\/[a-z]+\/fragments\/[ab]\.html$/);
          calls.destinations += 1;
          calls.stages.push(['save', path, body]);
          content.set(path, body);
        }
        return await respond('{}');
      }
      const body = projects.get(path) || content.get(path);
      return await respond(body || '', body ? 200 : 404, path.endsWith('.json') ? 'application/json' : 'text/html');
    } catch (error) {
      calls.errors.push(error.message);
      return respond(JSON.stringify({ error: error.message }), 500);
    }
  });
  return { browser, page, content, projects, calls, state };
}

async function addTarget(dialog, location, locale) {
  await dialog.getByLabel('Language / location', { exact: true }).selectOption(location);
  const summary = dialog.locator('.locale-picker summary');
  await summary.click();
  await dialog.getByRole('checkbox', { name: new RegExp(`\\(${locale}\\)$`) }).check();
  await summary.click();
}

test('browser: multi-select, modal, real DOM status, partial failure, reload retrieval and idempotent retry', async (t) => {
  const f = await browserFixture(t, { failGerman: true });
  await f.page.goto(appUrl);
  await expect(f.page.getByRole('button', { name: 'Start Workflow (0)', exact: true })).toBeDisabled();
  await f.page.getByLabel('Select all pages in this folder').check();
  await f.page.getByRole('button', { name: 'Start Workflow (2)', exact: true }).click();
  const dialog = f.page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await addTarget(dialog, '/fr', '/fr/fr');
  await addTarget(dialog, '/de', '/de/de');
  await expect(dialog.getByText('/fr/fr/fragments/a.html', { exact: true })).toBeVisible();
  await expect(dialog.getByText('/de/de/fragments/b.html', { exact: true })).toBeVisible();
  await dialog.getByLabel('Project title').fill('Browser POC');
  await expect(dialog.getByRole('button', { name: 'Create project and run' })).toBeDisabled();
  await dialog.getByLabel('I understand that existing destination content will be overwritten.').check();
  await dialog.getByRole('button', { name: 'Create project and run' }).click();
  await expect(f.page.getByRole('alert').filter({ hasText: 'Execution stopped. Progress is saved in DA.' })).toBeVisible();
  await expect(f.page.getByRole('status').filter({ hasText: '3/4 destinations saved' })).toBeVisible();
  assert.equal(f.calls.translations, 4);
  assert.equal(f.calls.destinations, 7);
  const persisted = JSON.parse([...f.projects.values()].at(-1));
  assert.equal(persisted.workflow.status, 'partial-failure');
  assert.equal(persisted.langs.find((lang) => lang.code === 'de').translation.saved, 1);
  assert.doesNotMatch([...f.projects.values()].join(''), /Bearer|session|Hello|Bonjour|Hallo/);

  await expect(f.page.getByRole('checkbox', { name: /Reviewed/ })).toHaveCount(0);
  await expect(f.page.getByRole('link', { name: 'Open /de/de/fragments/b.html in DA', exact: true })).toHaveCount(0);
  await expect(f.page.getByRole('link', { name: 'Open /fr/fr/fragments/a.html in DA', exact: true }))
    .toHaveAttribute('href', 'https://da.live/edit#/org/site/fr/fr/fragments/a');
  const continuation = f.page.getByRole('link', { name: 'Continue to Publish Request (3)', exact: true });
  const target = new URL(await continuation.getAttribute('href'));
  assert.equal(target.searchParams.get('ref'), 'local');
  assert.equal(target.searchParams.get('env'), 'prod');
  assert.deepEqual(JSON.parse(target.searchParams.get('workflowHandoff')).paths, [
    '/fr/fr/fragments/a', '/fr/fr/fragments/b', '/de/de/fragments/a',
  ]);
  assert.equal(JSON.parse(target.searchParams.get('workflowHandoff')).version, 2);
  const popupPromise = f.page.waitForEvent('popup');
  await continuation.click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(/workflow\.test\/tools\/apps\/request-publish-bulk\/request-publish-bulk\.html/);
  await popup.waitForLoadState();
  assert.deepEqual(f.calls.errors, [], `Unexpected browser errors at ${popup.url()}`);
  await expect(popup.getByRole('heading', { name: 'Request Publish for Multiple Pages' })).toBeVisible();
  await expect(popup.getByText('No requests have been submitted.', { exact: false })).toBeVisible();
  assert.equal(await popup.locator('#paths').evaluate((textarea) => textarea.value),
    '/fr/fr/fragments/a\n/fr/fr/fragments/b\n/de/de/fragments/a');
  await expect(popup.getByRole('radio', { name: 'Paste paths', exact: true })).toBeChecked();
  assert.equal(f.calls.approval, 0);

  await f.page.reload();
  await expect(f.page.getByRole('button', { name: persisted.id, exact: true })).toBeVisible();
  assert.equal(f.calls.translations, 4, 'Reopening must not resume execution.');
  await f.page.getByRole('button', { name: persisted.id, exact: true }).click();
  await expect(f.page.getByRole('heading', { name: 'Browser POC' })).toBeVisible();
  f.state.failGerman = false;
  await f.page.getByRole('button', { name: 'Resume / retry unfinished tasks', exact: true }).click();
  await expect(f.page.getByText('All destinations were saved.', { exact: false })).toBeVisible();
  await expect(f.page.getByRole('status').filter({ hasText: '4/4 destinations saved' })).toBeVisible();
  assert.equal(f.calls.translations, 5);
  assert.equal(f.calls.destinations, 8);
  assert.equal(JSON.parse([...f.projects.values()].at(-1)).workflow.status, 'complete');
  assert.equal(f.content.get('/fr/fr/fragments/a.html').includes('keep-me'), true);
  await expect(f.page.getByRole('button', { name: 'Resume / retry unfinished tasks' })).toBeDisabled();
  await f.page.getByRole('button', { name: 'Reload saved progress', exact: true }).click();
  await expect(f.page.getByRole('link', { name: 'Continue to Publish Request (4)', exact: true })).toBeVisible();
  await f.page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.deepEqual(f.calls.errors, []);
});

test('browser: wizard cancellation, target removal and overwrite acknowledgement gate execution', async (t) => {
  const f = await browserFixture(t);
  await f.page.goto(appUrl);
  await f.page.getByLabel('/en/fragments/a.html', { exact: true }).check();
  await f.page.getByRole('button', { name: 'Start Workflow (1)', exact: true }).click();
  const dialog = f.page.getByRole('dialog');
  await expect(dialog.locator('.locale-picker summary')).toHaveAttribute('aria-disabled', 'true');
  await addTarget(dialog, '/en', '/en/pr');
  await expect(dialog.getByRole('button', { name: 'Create project and run' })).toBeDisabled();
  await dialog.getByLabel('I understand that existing destination content will be overwritten.').check();
  await expect(dialog.getByRole('button', { name: 'Create project and run' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Remove target /en/pr', exact: true }).click();
  await expect(f.page.getByRole('button', { name: 'Create project and run' })).toBeDisabled();
  await f.page.keyboard.press('Escape');
  await expect(f.page.getByRole('dialog')).not.toBeVisible();
  assert.equal(f.calls.translations, 0);
  assert.equal(f.projects.size, 0);
  assert.deepEqual(f.calls.errors, []);
});

test('browser: locale dropdown supports multiple checks, language switching, removal and keyboard navigation', async (t) => {
  const config = regionalSheets();
  config.languages.data.push(
    { name: 'English - Canada', code: 'en-ca', location: '/en', locales: '/en/ca', actions: 'Rollout' },
    { name: 'English - South Africa', code: 'en-za', location: '/en', locales: '/en/za', actions: 'Rollout' },
  );
  const f = await browserFixture(t, { translationConfig: config });
  await f.page.goto(appUrl);
  await f.page.getByLabel('/en/fragments/a.html', { exact: true }).check();
  await f.page.getByRole('button', { name: 'Start Workflow (1)', exact: true }).click();
  const dialog = f.page.getByRole('dialog');
  const picker = dialog.locator('.locale-picker');
  const summary = picker.locator('summary');
  await summary.click();
  await expect(picker).toHaveJSProperty('open', false);
  await dialog.getByLabel('Language / location', { exact: true }).selectOption('/en');
  await summary.focus();
  await f.page.keyboard.press('Enter');
  await expect(picker).toHaveJSProperty('open', true);
  const pr = picker.getByRole('checkbox', { name: 'pr — English - Puerto Rico (/en/pr)', exact: true });
  const ca = picker.getByRole('checkbox', { name: 'ca — English - Canada (/en/ca)', exact: true });
  const za = picker.getByRole('checkbox', { name: 'za — English - South Africa (/en/za)', exact: true });
  await f.page.keyboard.press('Tab');
  await expect(pr).toBeFocused();
  await f.page.keyboard.press('Space');
  await ca.check();
  await za.check();
  await expect(picker).toHaveJSProperty('open', true);
  await expect(summary).toHaveText('Choose regional locales (3 selected)');
  await expect(dialog.getByRole('button', { name: 'Add target locale', exact: true })).toHaveCount(0);
  for (const locale of ['pr', 'ca', 'za']) {
    await expect(dialog.getByText(`/en/${locale}/fragments/a.html`, { exact: true })).toBeVisible();
  }
  await ca.uncheck();
  await expect(dialog.getByRole('button', { name: 'Remove target /en/ca', exact: true })).toHaveCount(0);
  await expect(dialog.getByText('/en/ca/fragments/a.html', { exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Remove target /en/za', exact: true }).click();
  await expect(za).not.toBeChecked();
  await expect(summary).toHaveText('Choose regional locales (1 selected)');

  await dialog.getByLabel('Language / location', { exact: true }).selectOption('/fr');
  await expect(picker).toHaveJSProperty('open', false);
  await summary.click();
  await picker.getByRole('checkbox', { name: /\/fr\/fr/ }).check();
  await picker.getByRole('checkbox', { name: /\/fr\/ca/ }).check();
  await expect(summary).toHaveText('Choose regional locales (2 selected)');
  await dialog.getByLabel('Language / location', { exact: true }).selectOption('/en');
  await summary.click();
  await expect(pr).toBeChecked();
  await expect(ca).not.toBeChecked();
  await expect(za).not.toBeChecked();
  await ca.check();
  await za.check();
  await expect(dialog.getByRole('button', { name: /^Remove target / })).toHaveCount(5);
  await expect(dialog.getByText('/fr/ca/fragments/a.html', { exact: true })).toBeVisible();

  await pr.focus();
  await f.page.keyboard.press('Escape');
  await expect(picker).toHaveJSProperty('open', false);
  await expect(summary).toBeFocused();
  await expect(dialog).toBeVisible();
  await f.page.keyboard.press('Space');
  await expect(picker).toHaveJSProperty('open', true);
  await f.page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await f.page.keyboard.press('Escape');
  await f.page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  assert.equal(f.calls.translations, 0);
  assert.equal(f.calls.destinations, 0);
  assert.equal(f.calls.approval, 0);
  assert.equal(f.projects.size, 0);
  await f.page.getByRole('button', { name: 'Start Workflow (1)', exact: true }).click();
  await dialog.getByLabel('I understand that existing destination content will be overwritten.').check();
  await dialog.getByRole('button', { name: 'Create project and run' }).click();
  await expect(f.page.getByRole('status').filter({ hasText: '5/5 destinations saved' })).toBeVisible();
  assert.equal(f.projects.size, 1);
  const project = JSON.parse([...f.projects.values()][0]);
  assert.deepEqual(project.workflow.items.map((item) => item.targetId).sort(),
    ['/en/ca', '/en/pr', '/en/za', '/fr/ca', '/fr/fr']);
  assert.equal(f.calls.translations, 2);
  assert.equal(f.calls.destinations, 7);
  assert.equal(f.calls.approval, 0);
  await expect(f.page.getByRole('link', { name: 'Continue to Publish Request (5)', exact: true })).toBeVisible();
  assert.deepEqual(f.calls.errors, []);
});

test('browser: one English and Spanish workflow overwrites, cleans rollout metadata, and includes all successful paths', async (t) => {
  const f = await browserFixture(t);
  f.content.set('/en/fragments/a.html', `<body><main><p>Hello A</p><da-loc-deleted>Old</da-loc-deleted></main>
    <div class="da-metadata"><div><div>acceptedhashes</div><div>old-hash</div></div>
    <div><div>custom</div><div>keep metadata</div></div></div></body>`);
  f.content.set('/en/pr/fragments/a.html', '<main>Existing English regional edit</main>');
  f.content.set('/es/pr/fragments/a.html', '<main>Existing Spanish translation</main>');
  await f.page.goto(appUrl);
  await f.page.getByLabel('/en/fragments/a.html', { exact: true }).check();
  await f.page.getByRole('button', { name: 'Start Workflow (1)', exact: true }).click();
  const dialog = f.page.getByRole('dialog');
  await addTarget(dialog, '/en', '/en/pr');
  await addTarget(dialog, '/es', '/es/pr');
  await expect(dialog.getByText('/en/pr/fragments/a.html', { exact: true })).toBeVisible();
  await expect(dialog.getByText('/es/pr/fragments/a.html', { exact: true })).toBeVisible();
  await dialog.getByLabel('I understand that existing destination content will be overwritten.').check();
  await dialog.getByRole('button', { name: 'Create project and run' }).click();
  await expect(f.page.getByRole('status').filter({ hasText: '2/2 destinations saved' })).toBeVisible();
  assert.equal(f.calls.translations, 1);
  assert.equal(f.calls.destinations, 3);
  assert.deepEqual(f.calls.stages.map(([type, value]) => [type, value]), [
    ['save', '/en/pr/fragments/a.html'],
    ['save', '/es/pr/fragments/a.html'],
    ['translate', 'es'],
    ['save', '/es/pr/fragments/a.html'],
  ]);
  assert.match(f.content.get('/en/pr/fragments/a.html'), /Hello A/);
  assert.match(f.content.get('/es/pr/fragments/a.html'), /Hola A/);
  assert.match(f.content.get('/es/pr/fragments/a.html'), /keep metadata/);
  assert.doesNotMatch(f.content.get('/es/pr/fragments/a.html'), /acceptedhashes|old-hash|da-loc-deleted|Existing/);
  await expect(f.page.getByRole('link', { name: 'Continue to Publish Request (2)', exact: true })).toBeVisible();
  assert.equal(f.calls.approval, 0);
  assert.deepEqual(f.calls.errors, []);
});
