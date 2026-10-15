import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normalizePath, isValidPath, validateSite, getTranslationDestinations, assessPreview,
} from '../paths.js';

const sourceDate = 'Wed, 14 Oct 2026 14:29:26 GMT';
const earlierDate = 'Mon, 12 Oct 2026 22:15:57 GMT';

function project(overrides = {}) {
  return {
    urls: [{ basePath: '/fragments/test', suppliedPath: '/en/us/fragments/test', checked: true }],
    options: { 'source.language': { location: '/en/us' } },
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
    ...overrides,
  };
}

test('normalizes URLs, HTML extensions, whitespace, query strings, and homepages', () => {
  assert.equal(normalizePath(' https://example.com/fr/test.html?x=1#anchor '), '/fr/test');
  assert.equal(normalizePath('fr//test.plain.html'), '/fr/test');
  assert.equal(normalizePath('/fr/'), '/fr/index');
  assert.equal(normalizePath('/'), '/index');
  assert.equal(normalizePath('/fr/data.json'), '/fr/data.json');
  assert.equal(normalizePath(' '), null);
});

test('rejects unsafe or non-content paths and malformed site values', () => {
  ['/a/../b', '/a/./b', '/.da/config', '/.snapshots/test/home', '/bad path', '/'].forEach((path) => {
    assert.equal(isValidPath(path), false, path);
  });
  assert.equal(isValidPath('/fr/ca/home'), true);
  assert.throws(() => validateSite('org', 'site/'), /without slashes/);
  assert.doesNotThrow(() => validateSite('org', 'site-name'));
});

test('builds country rollout paths and excludes intermediate language-only translations', () => {
  assert.deepEqual(getTranslationDestinations(project()).map((destination) => destination.paths), [
    ['/en/ca/fragments/test'], ['/fr/ca/fragments/test'],
  ]);
});

test('uses suppliedPath only when basePath is missing and respects prefix boundaries', () => {
  const data = project({ urls: [{ suppliedPath: '/en/us/home' }] });
  assert.equal(getTranslationDestinations(data)[0].paths[0], '/en/ca/home');
  data.urls = [{ suppliedPath: '/en/usa/home' }];
  assert.equal(getTranslationDestinations(data)[0].paths[0], '/en/ca/en/usa/home');
});

test('preserves sheets and maps trailing-slash pages to index', () => {
  const data = project({ urls: [{ basePath: '/' }, { basePath: '/data.json' }] });
  data.langs.forEach((lang) => {
    if (lang.translation) lang.translation.saved = 2;
    lang.rollout.saved = 2;
    lang.locales[0].saved = 2;
  });
  assert.deepEqual(getTranslationDestinations(data)[0].paths, ['/en/ca/index', '/en/ca/data.json']);
});

test('does not invent country pages or completed rollouts from language-only translated content', () => {
  const data = project();
  data.langs[0].rollout.status = 'not started';
  data.langs[1].translation.status = 'translated';
  data.langs[1].rollout.status = 'not started';
  assert.deepEqual(getTranslationDestinations(data), []);
});

test('includes a completed language/country translation even when rollout is not yet complete', () => {
  const data = project();
  data.langs = [data.langs[1]];
  data.langs[0].location = '/fr/ca';
  data.langs[0].rollout.status = 'not started';
  assert.deepEqual(getTranslationDestinations(data).map((destination) => destination.paths), [
    ['/fr/ca/fragments/test'],
  ]);
});

test('never substitutes a language-only translation for incomplete country rollouts', () => {
  const data = project();
  data.langs = [data.langs[1]];
  data.langs[0].rollout.status = 'not started';
  assert.deepEqual(getTranslationDestinations(data), []);
  data.langs[0].rollout.status = 'complete';
  data.langs[0].locales[0].saved = 0;
  assert.deepEqual(getTranslationDestinations(data), []);
  data.langs[0].locales[0].saved = 1;
  data.langs[0].locales[0].active = false;
  assert.deepEqual(getTranslationDestinations(data), []);
});

test('completed translations preserve countries already present in base paths without requiring rollout', () => {
  const data = project({
    urls: [
      { basePath: '/pr/press-release', suppliedPath: '/en/pr/press-release' },
      { basePath: '/pr/fragments/global-announcement', suppliedPath: '/en/pr/fragments/global-announcement' },
    ],
    options: { 'source.language': { location: '/en' } },
    langs: [{
      name: 'Spanish - Puerto Rico', action: 'translate', location: '/es',
      translation: { status: 'complete', saved: 2 },
      locales: [{ code: '/es/pr', active: true }],
    }],
  });
  const [destination] = getTranslationDestinations(data);
  assert.equal(destination.location, '/es/pr');
  assert.deepEqual(destination.paths, ['/es/pr/press-release', '/es/pr/fragments/global-announcement']);
  data.urls = data.urls.map(({ suppliedPath }) => ({ suppliedPath }));
  assert.deepEqual(getTranslationDestinations(data)[0].paths, destination.paths);
  data.langs[0].translation.status = 'translated';
  assert.deepEqual(getTranslationDestinations(data)[0].paths, destination.paths);
  assert.match(getTranslationDestinations(data)[0].label, /save unconfirmed/);
  data.langs[0].translation.status = 'complete';
  data.langs[0].translation.saved = 1;
  assert.deepEqual(getTranslationDestinations(data), []);
});

test('translated results can be validated without saved or rollout counts but not before translation finishes', () => {
  const data = project({
    urls: [{ basePath: '/ca/fragments/global-announcement' }],
    langs: [{
      name: 'French - Canada', action: 'translate', location: '/fr',
      translation: { status: 'translated', sent: 1, translated: 1 },
      locales: [{ code: '/fr/ca', active: true }],
    }],
  });
  assert.deepEqual(getTranslationDestinations(data)[0].paths, ['/fr/ca/fragments/global-announcement']);
  data.langs[0].translation.saved = 0;
  assert.equal(getTranslationDestinations(data).length, 1);
  data.langs[0].translation.translated = 0;
  assert.deepEqual(getTranslationDestinations(data), []);
  delete data.langs[0].translation.translated;
  assert.equal(getTranslationDestinations(data).length, 1);
  for (const status of ['created', 'starting', 'saving', 'error', 'not started']) {
    data.langs[0].translation.status = status;
    assert.deepEqual(getTranslationDestinations(data), [], status);
  }
});

test('directly saved country paths group only under configured active locales and ignore rollout counts', () => {
  const data = project({
    urls: [
      { basePath: '/ca/home' }, { basePath: '/pr/home' },
      { basePath: '/cafe/home' }, { basePath: '/fragments/home' },
    ],
    langs: [{
      name: 'French', action: 'copy', location: '/fr/',
      copy: { status: 'complete', saved: 4 },
      rollout: { status: 'not started' },
      locales: [
        { code: '/fr/ca', active: true, saved: 0 },
        { code: '/fr/pr/', active: true },
        { code: '/fr/cafe', active: false },
        { code: '/es/pr', active: true },
      ],
    }],
  });
  assert.deepEqual(getTranslationDestinations(data).map(({ paths }) => paths), [
    ['/fr/ca/home'], ['/fr/pr/home'],
  ]);
  data.langs[0].locales = [];
  assert.deepEqual(getTranslationDestinations(data), []);
});

test('only offers two-segment destination folders for translations, copies, and rollouts', () => {
  for (const location of ['/fr', '/de', '/fr/ca/nested']) {
    const data = project({
      langs: [{
        name: 'French', action: 'copy', location, copy: { status: 'complete', saved: 1 },
        rollout: { status: 'complete', saved: 1 },
        locales: [{ code: location, active: true, saved: 1 }],
      }],
    });
    assert.deepEqual(getTranslationDestinations(data), [], location);
  }
});

test('excludes unchecked sources, inactive locales, and incomplete saved counts', () => {
  const data = project();
  data.urls.push({ basePath: '/unchecked', checked: false });
  data.langs[0].locales[0].active = false;
  data.langs[1].translation.saved = 0;
  data.langs[1].locales[0].saved = 0;
  assert.deepEqual(getTranslationDestinations(data), []);
});

test('handles copy destinations and optional locale lists', () => {
  const data = project({
    langs: [{ name: 'French', action: 'copy', location: '/fr/ca/', copy: { status: 'complete', saved: 1 } }],
  });
  assert.deepEqual(getTranslationDestinations(data)[0].paths, ['/fr/ca/fragments/test']);
});

test('rejects unsupported or malformed projects instead of inventing paths', () => {
  assert.throws(() => getTranslationDestinations({}), /URL and language list/);
  assert.throws(() => getTranslationDestinations(project({ snapshot: 'draft' })), /Snapshot/);
  assert.throws(() => getTranslationDestinations(project({ urls: [] })), /no selected/);
  assert.throws(() => getTranslationDestinations(project({ urls: [{}] })), /missing/);
  assert.throws(() => getTranslationDestinations(project({ urls: [{ basePath: '/../config' }] })), /Invalid generated/);
});

test('deduplicates generated paths', () => {
  const data = project();
  data.urls.push({ ...data.urls[0] });
  data.langs.forEach((lang) => {
    if (lang.translation) lang.translation.saved = 2;
    lang.rollout.saved = 2;
    lang.locales[0].saved = 2;
  });
  assert.deepEqual(getTranslationDestinations(data)[0].paths, ['/en/ca/fragments/test']);
});

test('current preview compares its source version, not its generation time', () => {
  assert.equal(assessPreview(sourceDate, {
    status: 200, sourceLastModified: sourceDate, lastModified: sourceDate,
  }).status, 'ready');
  assert.equal(assessPreview(sourceDate, {
    status: 200, sourceLastModified: earlierDate, lastModified: 'Thu, 15 Oct 2026 14:29:26 GMT',
  }).status, 'stale');
});

test('blocks missing previews and missing timestamps', () => {
  assert.equal(assessPreview(sourceDate, { status: 404 }).status, 'needs-preview');
  assert.equal(assessPreview(sourceDate, { status: 200 }).status, 'unverified');
  assert.equal(assessPreview(null, { status: 200, sourceLastModified: sourceDate }).status, 'unverified');
  assert.equal(assessPreview('invalid', { status: 200, sourceLastModified: sourceDate }).status, 'unverified');
  assert.throws(() => assessPreview(sourceDate, { status: 403 }), /403/);
});
