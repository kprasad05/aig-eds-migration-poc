import { isValidPath, validateSite } from '../request-publish-bulk/paths.js';

export const SOURCE = { name: 'English', code: 'en', location: '/en' };
export const TARGETS = [
  { name: 'French', code: 'fr', location: '/fr' },
  { name: 'German', code: 'de', location: '/de' },
];
export const PROJECT_PREFIX = '/.da/translation/active/';
export const MODE = 'interactive-google-v1';
export const LOCALE_MODE = 'interactive-google-locales-v2';

export function assertLocalePath(path) {
  if (typeof path !== 'string' || !/^\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(path)) {
    throw new Error(`Invalid regional locale path: ${path}`);
  }
}

export function assertDestination(path) {
  if (!isValidPath(path) || !/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)+\.html$/.test(path)) {
    throw new Error('Invalid workflow destination.');
  }
}

export function operationLabel(target) {
  return target.location === SOURCE.location ? 'Rollout only' : 'Rollout → Translate';
}

export function assertFolder(path) {
  if (!isValidPath(path) || !/^\/en(?:\/[A-Za-z0-9_-]+)*$/.test(path)) {
    throw new Error('Choose a folder under /en, without a trailing slash.');
  }
}

export function assertPage(path) {
  if (!isValidPath(path) || !/^\/en(?:\/[A-Za-z0-9_-]+)+\.html$/.test(path)) {
    throw new Error(`Unsupported source page: ${path}. Choose an HTML page under /en.`);
  }
}

export function projectPath(id) {
  if (!/^workflow-[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid workflow ID.');
  return `${PROJECT_PREFIX}${id}.json`;
}

export async function fingerprint(content) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function parseConfig(sheets) {
  if (!Array.isArray(sheets?.config?.data) || !Array.isArray(sheets?.languages?.data)) {
    throw new Error('Translation configuration must contain config and languages sheets.');
  }
  const config = Object.fromEntries(sheets.config.data.map(({ key, value }) => [key, value]));
  if (typeof config['translation.service.name'] !== 'string'
    || config['translation.service.name'].toLowerCase() !== 'google') {
    throw new Error('This POC requires the configured Google translation connector.');
  }
  const languages = sheets.languages.data;
  const source = languages.find((lang) => lang.name === config['source.language']);
  if (!source || source.code !== SOURCE.code || source.location !== SOURCE.location) {
    throw new Error('Configure source.language as English with code en and location /en.');
  }
  const targets = [];
  const locales = new Set();
  languages.forEach((lang) => {
    if (typeof lang.location !== 'string' || !/^\/[A-Za-z0-9_-]+$/.test(lang.location)
      || typeof lang.code !== 'string' || !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]+)*$/.test(lang.code)
      || typeof lang.name !== 'string' || !lang.name.trim()
      || typeof lang.locales !== 'string') {
      throw new Error(`Invalid language configuration for ${lang.name || 'unnamed row'}: check name, code, location and locales.`);
    }
    const actions = typeof lang.actions === 'string'
      ? lang.actions.split(',').map((action) => action.trim().toLowerCase()) : [];
    const sameLanguage = lang.location === SOURCE.location;
    const dependency = lang.source || lang['source language'];
    if (!actions.includes(sameLanguage ? 'rollout' : 'translate')
      || (dependency && dependency !== source.name)) return;
    const languageRows = languages.filter((row) => row.location === lang.location);
    const base = languageRows.find((row) => row.code === lang.location.slice(1))
      || languageRows[0];
    lang.locales.split(',').map((locale) => locale.trim()).filter(Boolean).forEach((locale) => {
      // The language-store source is not a regional rollout destination.
      if (locale === lang.location) return;
      assertLocalePath(locale);
      if (locales.has(locale)) {
        throw new Error(`Duplicate locale in translation configuration: ${locale}`);
      }
      locales.add(locale);
      targets.push({
        id: locale,
        name: lang.name,
        code: lang.code,
        location: lang.location,
        locale,
        translationCode: base.code,
        translate: !sameLanguage,
      });
    });
  });
  if (!targets.length) {
    throw new Error('Configure regional locales with Rollout for English or Translate for other languages and English as their source.');
  }
  return { source: SOURCE, targets, sheets };
}

export function summarize(project) {
  const { items } = project.workflow;
  project.langs.forEach((lang) => {
    const languageItems = items.filter((item) => (project.workflow.mode === LOCALE_MODE
      ? item.targetId === lang.id : item.code === lang.code));
    const translated = languageItems.filter((item) => item.outputHash).length;
    const saved = languageItems.filter((item) => item.status === 'complete').length;
    lang.translation = {
      sent: languageItems.filter((item) => item.attempts > 0).length,
      translated,
      saved,
      status: saved === languageItems.length ? 'complete' : 'sent',
    };
    if (project.workflow.mode === LOCALE_MODE) {
      if (!lang.translate) {
        lang.translation = {
          sent: 0, translated: 0, saved: 0, status: 'not-required',
        };
      }
      lang.rollout = {
        saved: languageItems.filter((item) => item.rolloutStatus === 'complete').length,
        status: saved === languageItems.length ? 'complete' : 'pending',
      };
      lang.locales[0].saved = saved;
    }
  });
  const complete = items.filter((item) => item.status === 'complete').length;
  const problems = items.some((item) => ['failed', 'needs-review', 'save-unconfirmed'].includes(item.status));
  project.workflow.status = complete === items.length ? 'complete' : 'paused';
  if (problems) project.workflow.status = 'partial-failure';
  project.view = complete === items.length ? 'complete' : 'translate';
  project.modifiedDate = Date.now();
}

export async function createProject({
  org, site, title, paths, codes, targetIds, config, readSource,
}) {
  validateSite(org, site);
  if (!title.trim() || title.trim().length > 120) throw new Error('Enter a title of 1–120 characters.');
  const selected = [...new Set(paths)];
  if (!selected.length || selected.length > 25) throw new Error('Choose between 1 and 25 source pages.');
  const regional = targetIds !== undefined;
  const choices = regional ? targetIds : codes;
  if (!Array.isArray(choices) || !choices.length || new Set(choices).size !== choices.length
    || (!regional && choices.some((code) => !TARGETS.some((target) => target.code === code)))
    || choices.some((choice) => !config.targets.some((lang) => (
      regional ? lang.id === choice : lang.code === choice
    )))) {
    throw new Error('Choose at least one configured target locale.');
  }
  const langs = regional ? config.targets.filter((lang) => targetIds.includes(lang.id))
    .map((lang) => ({
      ...lang,
      action: lang.translate ? 'translate' : 'rollout',
      locales: [{ code: lang.locale, active: true }],
    })) : TARGETS.filter((lang) => codes.includes(lang.code))
    .map((lang) => ({ ...lang, action: 'translate', locales: [] }));
  selected.forEach((path) => {
    assertPage(path);
    langs.forEach((lang) => {
      const destination = `${regional ? lang.locale : lang.location}${path.slice(3)}`;
      if (selected.includes(destination)) throw new Error('A destination would overwrite a selected source page. Choose different targets.');
    });
  });
  const urls = [];
  // eslint-disable-next-line no-restricted-syntax -- Bound DA reads before creating the project.
  for (const path of selected) {
    assertPage(path);
    // Read all sources before creating a project or starting translation.
    // eslint-disable-next-line no-await-in-loop
    const source = await readSource(path);
    if (!source) throw new Error(`Source page not found: ${path}`);
    // eslint-disable-next-line no-await-in-loop
    const sourceHash = await fingerprint(source.content);
    urls.push({
      suppliedPath: path,
      basePath: path.slice(SOURCE.location.length).replace(/\.html$/, ''),
      checked: true,
      ext: 'html',
      sourceHash,
      sourceModified: source.modified,
    });
  }
  const project = {
    id: `workflow-${crypto.randomUUID()}`,
    org,
    site,
    title: title.trim(),
    createdDate: Date.now(),
    options: {
      'source.language': SOURCE,
      service: { name: 'Google', env: 'prod' },
      'translate.conflict.behavior': 'overwrite',
      ...(regional ? { 'rollout.conflict.behavior': 'overwrite' } : {}),
    },
    urls,
    langs,
    workflow: {
      mode: regional ? LOCALE_MODE : MODE,
      configHash: await fingerprint(JSON.stringify(config.sheets)),
      items: langs.flatMap((lang) => urls.map((url) => ({
        source: url.suppliedPath,
        destination: `${regional ? lang.locale : lang.location}${url.basePath}.html`,
        code: lang.code,
        ...(regional ? {
          targetId: lang.id,
          translationCode: lang.translationCode,
          translate: lang.translate,
          rolloutStatus: 'queued',
        } : {}),
        sourceHash: url.sourceHash,
        status: 'queued',
        attempts: 0,
        error: '',
      }))),
    },
  };
  summarize(project);
  return project;
}

export function validateProject(project, org, site) {
  validateSite(org, site);
  projectPath(project?.id);
  const regional = project?.workflow?.mode === LOCALE_MODE;
  if (project.org !== org || project.site !== site
    || ![MODE, LOCALE_MODE].includes(project.workflow?.mode)
    || typeof project.title !== 'string'
    || !/^[a-f0-9]{64}$/.test(project.workflow.configHash)
    || !Array.isArray(project.urls) || !project.urls.length || project.urls.length > 25
    || !Array.isArray(project.langs) || !project.langs.length
    || (!regional && project.langs.length > 2)
    || !Array.isArray(project.workflow.items)) {
    throw new Error('This is not a supported workflow project for this site.');
  }
  const paths = new Map();
  project.urls.forEach((url) => {
    assertPage(url.suppliedPath);
    if (url.basePath !== url.suppliedPath.slice(3).replace(/\.html$/, '')
      || !/^[a-f0-9]{64}$/.test(url.sourceHash)
      || paths.has(url.suppliedPath)) throw new Error('Invalid workflow source list.');
    paths.set(url.suppliedPath, url.sourceHash);
  });
  const codes = new Set();
  project.langs.forEach((lang) => {
    if (regional) {
      assertLocalePath(lang.locale);
      if (lang.id !== lang.locale || !/^\/[A-Za-z0-9_-]+$/.test(lang.location)
        || typeof lang.code !== 'string' || !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]+)*$/.test(lang.code)
        || typeof lang.translationCode !== 'string' || !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]+)*$/.test(lang.translationCode)
        || lang.translate !== (lang.location !== SOURCE.location)
        || !Array.isArray(lang.locales) || lang.locales.length !== 1
        || lang.locales[0].code !== lang.locale || codes.has(lang.id)) {
        throw new Error('Invalid workflow locale list.');
      }
      codes.add(lang.id);
      return;
    }
    if (!TARGETS.some((target) => target.code === lang.code && target.location === lang.location)
      || codes.has(lang.code)) throw new Error('Invalid workflow language list.');
    codes.add(lang.code);
  });
  const keys = new Set();
  project.workflow.items.forEach((item) => {
    const target = regional ? project.langs.find((lang) => lang.id === item.targetId)
      : TARGETS.find((lang) => lang.code === item.code);
    const key = `${regional ? item.targetId : item.code}:${item.source}`;
    if (!paths.has(item.source) || !codes.has(regional ? item.targetId : item.code)
      || !target || item.destination !== `${regional ? target.locale : target.location}${item.source.slice(3)}`
      || paths.has(item.destination)
      || item.sourceHash !== paths.get(item.source)
      || (item.outputHash !== undefined && !/^[a-f0-9]{64}$/.test(item.outputHash))
      || (['saving', 'save-unconfirmed', 'complete'].includes(item.status) && !item.outputHash)
      || !['queued', ...(regional ? ['rolling-out'] : []), 'translating', 'saving', 'complete', 'failed', 'needs-review', 'save-unconfirmed'].includes(item.status)
      || (regional && (item.code !== target.code || item.translationCode !== target.translationCode
        || item.translate !== target.translate
        || !['queued', 'saving', 'complete', 'save-unconfirmed'].includes(item.rolloutStatus)
        || (item.rolloutHash !== undefined && !/^[a-f0-9]{64}$/.test(item.rolloutHash))
        || (item.rolloutStatus !== 'queued' && !item.rolloutHash)
        || (item.status === 'complete' && item.rolloutStatus !== 'complete')))
      || !Number.isInteger(item.attempts) || item.attempts < 0 || keys.has(key)) {
      throw new Error('Invalid workflow task. No content was written.');
    }
    keys.add(key);
  });
  if (keys.size !== paths.size * codes.size) throw new Error('The workflow task list is incomplete.');
  return project;
}
