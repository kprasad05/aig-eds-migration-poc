import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { sheets } from './helpers.mjs';

const root = new URL('../../../../', import.meta.url);
const appUrl = 'https://workflow.test/tools/apps/start-workflow/start-workflow.html?org=org&site=site';

async function browserFixture(t, { failGerman = false } = {}) {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const content = new Map([
    ['/en/fragments/a.html', '<html><body><main><p>Hello A</p><code>keep-me</code></main></body></html>'],
    ['/en/fragments/b.html', '<html><body><main><p>Hello B</p></main></body></html>'],
  ]);
  const projects = new Map();
  const calls = { translations: 0, destinations: 0, errors: [] };
  page.on('pageerror', (error) => calls.errors.push(error.message));
  const state = { failGerman };
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const respond = (body, status = 200, type = 'application/json') => route.fulfill({
      status, body, contentType: type, headers: { 'Access-Control-Allow-Origin': '*' },
    });
    try {
      if (url.hostname === 'workflow.test') {
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
      if (url.pathname.endsWith('/dnt/dnt.js')) {
        return await respond('export const addDnt = async (html) => html; export const removeDnt = async ({html}) => html;', 200, 'application/javascript');
      }
      if (request.method() === 'OPTIONS') return await respond('', 204);
      assert.equal(request.headers().authorization, 'Bearer session');
      if (url.hostname === 'translate.da.live') {
        assert.equal(url.pathname, '/translate/google/org/site');
        calls.translations += 1;
        const form = await new Request(url, {
          method: 'POST', headers: request.headers(), body: request.postDataBuffer(),
        }).formData();
        assert.equal(form.get('fromlang'), 'en');
        if (state.failGerman && form.get('tolang') === 'de' && form.get('data').includes('Hello B')) {
          return await respond('{"error":"test provider failure"}', 503);
        }
        return await respond(JSON.stringify({
          translated: form.get('data').replace('Hello', form.get('tolang') === 'fr' ? 'Bonjour' : 'Hallo'),
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
      if (path === '/.da/translate.json') return await respond(JSON.stringify(sheets()));
      if (request.method() === 'POST') {
        const form = await new Request(url, {
          method: 'POST', headers: request.headers(), body: request.postDataBuffer(),
        }).formData();
        const body = await form.get('data').text();
        if (path.startsWith('/.da/translation/active/')) projects.set(path, body);
        else {
          assert.match(path, /^\/(?:fr|de)\/fragments\/[ab]\.html$/);
          assert.equal(content.has(path), false, 'A destination must not be written twice.');
          calls.destinations += 1;
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

test('browser: multi-select, modal, real DOM status, partial failure, reload retrieval and idempotent retry', async (t) => {
  const f = await browserFixture(t, { failGerman: true });
  await f.page.goto(appUrl);
  await expect(f.page.getByRole('button', { name: 'Start Workflow (0)', exact: true })).toBeDisabled();
  await f.page.getByLabel('Select all pages in this folder').check();
  await f.page.getByRole('button', { name: 'Start Workflow (2)', exact: true }).click();
  const dialog = f.page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('/fr/fragments/a.html', { exact: true })).toBeVisible();
  await expect(dialog.getByText('/de/fragments/b.html', { exact: true })).toBeVisible();
  await dialog.getByLabel('Project title').fill('Browser POC');
  await dialog.getByRole('button', { name: 'Create project and run' }).click();
  await expect(f.page.getByRole('alert').filter({ hasText: 'Execution stopped. Progress is saved in DA.' })).toBeVisible();
  await expect(f.page.getByRole('status').filter({ hasText: '3/4 destinations saved' })).toBeVisible();
  assert.equal(f.calls.translations, 4);
  assert.equal(f.calls.destinations, 3);
  const persisted = JSON.parse([...f.projects.values()].at(-1));
  assert.equal(persisted.workflow.status, 'partial-failure');
  assert.equal(persisted.langs.find((lang) => lang.code === 'de').translation.saved, 1);
  assert.doesNotMatch([...f.projects.values()].join(''), /Bearer|session|Hello|Bonjour|Hallo/);

  await f.page.reload();
  await expect(f.page.getByRole('button', { name: persisted.id, exact: true })).toBeVisible();
  assert.equal(f.calls.translations, 4, 'Reopening must not resume execution.');
  await f.page.getByRole('button', { name: persisted.id, exact: true }).click();
  await expect(f.page.getByRole('heading', { name: 'Browser POC' })).toBeVisible();
  f.state.failGerman = false;
  await f.page.getByRole('button', { name: 'Resume / retry unfinished tasks', exact: true }).click();
  await expect(f.page.getByText('All translations were saved.', { exact: false })).toBeVisible();
  await expect(f.page.getByRole('status').filter({ hasText: '4/4 destinations saved' })).toBeVisible();
  assert.equal(f.calls.translations, 5);
  assert.equal(f.calls.destinations, 4);
  assert.equal(JSON.parse([...f.projects.values()].at(-1)).workflow.status, 'complete');
  assert.equal(f.content.get('/fr/fragments/a.html').includes('keep-me'), true);
  await expect(f.page.getByRole('button', { name: 'Resume / retry unfinished tasks' })).toBeDisabled();
  await f.page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.deepEqual(f.calls.errors, []);
});

test('browser: wizard cancellation and unsupported locale never start translation', async (t) => {
  const f = await browserFixture(t);
  await f.page.goto(appUrl);
  await f.page.getByLabel('/en/fragments/a.html', { exact: true }).check();
  await f.page.getByRole('button', { name: 'Start Workflow (1)', exact: true }).click();
  await f.page.getByRole('dialog').getByLabel('French: /fr').uncheck();
  await f.page.getByRole('dialog').getByLabel('German: /de').uncheck();
  await expect(f.page.getByRole('button', { name: 'Create project and run' })).toBeDisabled();
  await f.page.keyboard.press('Escape');
  await expect(f.page.getByRole('dialog')).not.toBeVisible();
  assert.equal(f.calls.translations, 0);
  assert.equal(f.projects.size, 0);
  assert.deepEqual(f.calls.errors, []);
});
