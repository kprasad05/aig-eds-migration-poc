import assert from 'node:assert/strict';
import { test } from 'node:test';
import { modules, json, sheets } from './helpers.mjs';

async function client(responses, options = {}) {
  const loaded = await modules({
    ...options,
    request: async (url, opts) => {
      const next = responses.shift();
      if (typeof next === 'function') return next(url, opts);
      if (next instanceof Error) throw next;
      assert.ok(next, `Unexpected request: ${url}`);
      return next;
    },
  });
  return { ...loaded, client: loaded.api.default('org', 'site', 'test-session') };
}

test('uses the DA session and only falls back to org config on site-config 404', async () => {
  const f = await client([new Response(null, { status: 404 }), json(sheets())]);
  assert.equal((await f.client.loadConfig()).targets.length, 2);
  assert.ok(f.calls[1].url.endsWith('/source/org/.da/translate.json'));
  assert.equal(f.calls[0].options.headers.Authorization, 'Bearer test-session');
  assert.equal(f.calls[0].options.cache, 'no-store');
  const denied = await client([new Response(null, { status: 403 })]);
  await assert.rejects(denied.client.loadConfig(), /permission/);
  assert.equal(denied.calls.length, 1);
});

test('lists all folder pages including continuation and excludes non-HTML resources', async () => {
  const f = await client([
    json([{ name: 'a', path: '/org/site/en/fragments/a.html', ext: 'html' }], {
      headers: { 'da-continuation-token': 'next' },
    }),
    json([
      { name: 'subfolder', path: '/org/site/en/fragments/subfolder', ext: '' },
      { name: 'image', path: '/org/site/en/fragments/image.png', ext: 'png' },
    ]),
  ]);
  const pages = await f.client.listPages('/en/fragments');
  assert.equal(pages.length, 2);
  assert.equal(pages[1].folder, true);
  assert.equal(f.calls[1].options.headers['da-continuation-token'], 'next');
  assert.equal(f.calls[1].options.headers.Authorization, 'Bearer test-session');
});

test('rejects unexpected list paths, repeated cursors and malformed JSON', async () => {
  const f = await client([
    json([{ path: '/other/site/en/fragments/a.html', ext: 'html' }]),
    json([], { headers: { 'da-continuation-token': 'same' } }),
    json([], { headers: { 'da-continuation-token': 'same' } }),
    new Response('not-json'),
  ]);
  await assert.rejects(f.client.listPages('/en/fragments'), /unexpected content path/);
  await assert.rejects(f.client.listPages('/en/fragments'), /repeated listing cursor/);
  await assert.rejects(f.client.loadConfig(), /invalid JSON/);
});

test('missing sources differ from session expiry; invalid paths never reach DA', async () => {
  const f = await client([new Response(null, { status: 404 }), new Response(null, { status: 401 })]);
  assert.equal(await f.client.readSource('/en/a.html'), null);
  await assert.rejects(f.client.readSource('/en/a.html'), /session expired/);
  assert.throws(() => f.client.readSource('/enough/a.html'), /Unsupported/);
  assert.throws(() => f.client.readDestination('/.da/translate.json'), /Invalid/);
  assert.equal(f.calls.length, 2);
});

test('saves HTML as DA multipart source data and surfaces write permission failures', async () => {
  const f = await client([new Response(null, { status: 200 }), new Response(null, { status: 403 })]);
  await f.client.saveDestination('/fr/a.html', '<main>bonjour</main>');
  const { options, url } = f.calls[0];
  assert.ok(url.endsWith('/source/org/site/fr/a.html'));
  assert.equal(options.method, 'POST');
  assert.equal(options.body.get('data').type, 'text/html');
  assert.equal(await options.body.get('data').text(), '<main>bonjour</main>');
  assert.equal(options.headers['Content-Type'], undefined);
  await assert.rejects(f.client.saveDestination('/de/a.html', '<main>Hallo</main>'), /permission/);
});

test('only lists this app projects and does not hide history permission failures', async () => {
  const id = 'workflow-00000000-0000-4000-8000-000000000000';
  const f = await client([
    json([
      { path: `/org/site/.da/translation/active/${id}.json`, ext: 'json', lastModified: 5 },
      { path: '/org/site/.da/translation/active/123.json', ext: 'json' },
      { path: `/other/site/.da/translation/active/${id}.json`, ext: 'json' },
    ]),
    new Response(null, { status: 404 }),
    new Response(null, { status: 403 }),
  ]);
  assert.equal((await f.client.listProjects())[0].id, id);
  assert.equal((await f.client.listProjects()).length, 0);
  await assert.rejects(f.client.listProjects(), /permission/);
});

const native = {
  'https://da.live/nx/blocks/loc/dnt/dnt.js': {
    addDnt: async (html) => html,
    removeDnt: async ({ html }) => html,
  },
  'https://da.live/nx/blocks/loc/connectors/google/splitHtml.js': {
    splitHtml: () => ['chunk1', 'chunk2'],
    rejoinHtml: () => '<main>rejoined</main>',
  },
};

test('Google uses configured site and correct multipart languages with native split/rejoin', async () => {
  const f = await client([
    json({ translated: '<main>part1</main>' }), json({ translated: '<main>part2</main>' }),
  ], { remote: native });
  const result = await f.client.translate(`<main>${'x'.repeat(6000)}</main>`, 'de', sheets());
  assert.equal(result, '<main>rejoined</main>');
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].url, 'https://translate.da.live/translate/google/org/site');
  assert.equal(f.calls[0].options.body.get('fromlang'), 'en');
  assert.equal(f.calls[0].options.body.get('tolang'), 'de');
  assert.equal(f.calls[0].options.body.get('data'), 'chunk1');
  assert.equal(f.calls[1].options.body.get('data'), 'chunk2');
});

test('provider failure, empty output and missing main are explicit errors, never successful translations', async () => {
  const f = await client([
    new Response(null, { status: 429 }), json({}), json({ translated: 'not an HTML document' }),
  ], { remote: native });
  await assert.rejects(f.client.translate('<main>a</main>', 'fr', sheets()), /Rate limited/);
  await assert.rejects(f.client.translate('<main>a</main>', 'fr', sheets()), /did not return/);
  await assert.rejects(f.client.translate('<main>a</main>', 'fr', sheets()), /missing its main/);
});
