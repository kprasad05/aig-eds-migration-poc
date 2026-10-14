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

test('builds translation and rollout paths without doubling language prefixes', () => {
  assert.deepEqual(getTranslationDestinations(project()).map((destination) => destination.paths), [
    ['/en/ca/fragments/test'], ['/fr/fragments/test'], ['/fr/ca/fragments/test'],
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

test('does not infer saved translation or rollout from translated status alone', () => {
  const data = project();
  data.langs[0].rollout.status = 'not started';
  data.langs[1].translation.status = 'translated';
  data.langs[1].rollout.status = 'not started';
  assert.deepEqual(getTranslationDestinations(data), []);
});

test('includes a completed translation even when rollout is not yet complete', () => {
  const data = project();
  data.langs = [data.langs[1]];
  data.langs[0].rollout.status = 'not started';
  assert.deepEqual(getTranslationDestinations(data).map((destination) => destination.paths), [
    ['/fr/fragments/test'],
  ]);
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
    langs: [{ name: 'French', action: 'copy', location: '/fr', copy: { status: 'complete', saved: 1 } }],
  });
  assert.deepEqual(getTranslationDestinations(data)[0].paths, ['/fr/fragments/test']);
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
