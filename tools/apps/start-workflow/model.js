import { isValidPath, validateSite } from '../request-publish-bulk/paths.js';

export const SOURCE = { name: 'English', code: 'en', location: '/en' };
export const TARGETS = [
  { name: 'French', code: 'fr', location: '/fr' },
  { name: 'German', code: 'de', location: '/de' },
];
export const PROJECT_PREFIX = '/.da/translation/active/';
export const MODE = 'interactive-google-v1';

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
  const targets = TARGETS.filter((target) => {
    const matches = languages.filter((lang) => lang.code === target.code);
    return matches.length === 1 && matches[0].location === target.location
      && typeof matches[0].actions === 'string'
      && matches[0].actions.split(',').some((action) => action.trim().toLowerCase() === 'translate')
      && (!matches[0]['source language'] || matches[0]['source language'] === source.name);
  });
  if (!targets.length) {
    throw new Error('Configure French (fr, /fr) or German (de, /de) with the Translate action and English as its source.');
  }
  return { source: SOURCE, targets, sheets };
}

export function summarize(project) {
  const { items } = project.workflow;
  project.langs.forEach((lang) => {
    const languageItems = items.filter((item) => item.code === lang.code);
    const translated = languageItems.filter((item) => item.outputHash).length;
    const saved = languageItems.filter((item) => item.status === 'complete').length;
    lang.translation = {
      sent: languageItems.filter((item) => item.attempts > 0).length,
      translated,
      saved,
      status: saved === languageItems.length ? 'complete' : 'sent',
    };
  });
  const complete = items.filter((item) => item.status === 'complete').length;
  const problems = items.some((item) => ['failed', 'needs-review', 'save-unconfirmed'].includes(item.status));
  project.workflow.status = complete === items.length ? 'complete' : 'paused';
  if (problems) project.workflow.status = 'partial-failure';
  project.view = complete === items.length ? 'complete' : 'translate';
  project.modifiedDate = Date.now();
}

export async function createProject({
  org, site, title, paths, codes, config, readSource,
}) {
  validateSite(org, site);
  if (!title.trim() || title.trim().length > 120) throw new Error('Enter a title of 1–120 characters.');
  const selected = [...new Set(paths)];
  if (!selected.length || selected.length > 25) throw new Error('Choose between 1 and 25 source pages.');
  if (!codes.length || new Set(codes).size !== codes.length
    || codes.some((code) => !config.targets.some((lang) => lang.code === code))) {
    throw new Error('Choose one or both configured target languages.');
  }
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
  const langs = config.targets.filter((lang) => codes.includes(lang.code))
    .map((lang) => ({ ...lang, action: 'translate', locales: [] }));
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
    },
    urls,
    langs,
    workflow: {
      mode: MODE,
      configHash: await fingerprint(JSON.stringify(config.sheets)),
      items: langs.flatMap((lang) => urls.map((url) => ({
        source: url.suppliedPath,
        destination: `${lang.location}${url.basePath}.html`,
        code: lang.code,
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
  if (project.org !== org || project.site !== site || project.workflow?.mode !== MODE
    || typeof project.title !== 'string'
    || !/^[a-f0-9]{64}$/.test(project.workflow.configHash)
    || !Array.isArray(project.urls) || !project.urls.length || project.urls.length > 25
    || !Array.isArray(project.langs) || !project.langs.length || project.langs.length > 2
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
    if (!TARGETS.some((target) => target.code === lang.code && target.location === lang.location)
      || codes.has(lang.code)) throw new Error('Invalid workflow language list.');
    codes.add(lang.code);
  });
  const keys = new Set();
  project.workflow.items.forEach((item) => {
    const target = TARGETS.find((lang) => lang.code === item.code);
    const key = `${item.code}:${item.source}`;
    if (!paths.has(item.source) || !codes.has(item.code)
      || item.destination !== `${target.location}${item.source.slice(3)}`
      || item.sourceHash !== paths.get(item.source)
      || (item.outputHash !== undefined && !/^[a-f0-9]{64}$/.test(item.outputHash))
      || (['saving', 'save-unconfirmed', 'complete'].includes(item.status) && !item.outputHash)
      || !['queued', 'translating', 'saving', 'complete', 'failed', 'needs-review', 'save-unconfirmed'].includes(item.status)
      || !Number.isInteger(item.attempts) || item.attempts < 0 || keys.has(key)) {
      throw new Error('Invalid workflow task. No content was written.');
    }
    keys.add(key);
  });
  if (keys.size !== paths.size * codes.size) throw new Error('The workflow task list is incomplete.');
  return project;
}
