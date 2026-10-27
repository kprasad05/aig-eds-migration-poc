/* eslint-disable import/no-unresolved */
import { daFetch } from 'https://da.live/nx/utils/daFetch.js';
import { validateSite } from '../request-publish-bulk/paths.js';
import {
  assertDestination, assertFolder, assertPage, parseConfig,
  projectPath, PROJECT_PREFIX, validateProject,
} from './model.js';

const ADMIN = 'https://admin.da.live';

function failure(response, operation) {
  const hints = {
    401: 'Your DA session expired. Sign in again, reload this app, and retrieve the project.',
    403: 'Your DA account does not have permission for this operation.',
    429: 'Rate limited. Wait before retrying.',
  };
  return new Error(`${operation} (${response.status}). ${hints[response.status] || 'Check DA availability and your configuration, then retry.'}`);
}

async function json(response, operation) {
  if (!response.ok) throw failure(response, operation);
  try {
    return await response.json();
  } catch {
    throw new Error(`${operation}: invalid JSON response.`);
  }
}

export default function createClient(org, site, token) {
  validateSite(org, site);
  if (!token) throw new Error('A signed-in DA session is required.');
  const request = (path, opts = {}) => daFetch(`${ADMIN}${path}`, {
    ...opts,
    cache: 'no-store',
    signal: AbortSignal.timeout(120000),
    headers: { Authorization: `Bearer ${token}`, ...opts.headers },
  });
  const sourceUrl = (path) => `/source/${org}/${site}${path}`;
  const write = async (path, content, type) => {
    const body = new FormData();
    body.append('data', new Blob([content], { type }));
    const response = await request(sourceUrl(path), { method: 'POST', body });
    if (!response.ok) throw failure(response, `Could not save ${path}`);
  };
  const read = async (path) => {
    const response = await request(sourceUrl(path));
    if (response.status === 404) return null;
    if (!response.ok) throw failure(response, `Could not read ${path}`);
    return { content: await response.text(), modified: response.headers.get('last-modified') };
  };
  const list = async (path) => {
    const entries = [];
    let continuation;
    const seen = new Set();
    do {
      // eslint-disable-next-line no-await-in-loop
      const response = await request(`/list/${org}/${site}${path}`, {
        headers: continuation ? { 'da-continuation-token': continuation } : {},
      });
      if (response.status === 404 && path === PROJECT_PREFIX.slice(0, -1)) return [];
      // eslint-disable-next-line no-await-in-loop
      const page = await json(response, `Could not list ${path}`);
      if (!Array.isArray(page)) throw new Error(`Unexpected folder list for ${path}.`);
      entries.push(...page);
      continuation = response.headers.get('da-continuation-token');
      if (continuation && seen.has(continuation)) throw new Error('DA returned a repeated listing cursor.');
      seen.add(continuation);
    } while (continuation);
    return entries;
  };

  return {
    async loadConfig() {
      let response = await request(sourceUrl('/.da/translate.json'));
      if (response.status === 404) response = await request(`/source/${org}/.da/translate.json`);
      return parseConfig(await json(response, 'Could not load translation configuration'));
    },
    async listPages(folder) {
      assertFolder(folder);
      const prefix = `/${org}/${site}`;
      const entries = await list(folder);
      return entries.filter((entry) => entry.ext === 'html' || !entry.ext)
        .map((entry) => {
          if (typeof entry.path !== 'string' || !entry.path.startsWith(`${prefix}${folder}/`)
            || entry.path.slice(`${prefix}${folder}/`.length).includes('/')) {
            throw new Error('DA returned an unexpected content path.');
          }
          const path = entry.path.slice(prefix.length);
          if (entry.ext === 'html') assertPage(path);
          else assertFolder(path);
          return { path, name: entry.name, folder: !entry.ext };
        }).sort((a, b) => a.path.localeCompare(b.path));
    },
    readSource(path) {
      assertPage(path);
      return read(path);
    },
    readDestination(path) {
      assertDestination(path);
      return read(path);
    },
    async saveDestination(path, content) {
      assertDestination(path);
      await write(path, content, 'text/html');
    },
    async prepareRollout(content) {
      const document = new DOMParser().parseFromString(content, 'text/html');
      const main = document.querySelector('main');
      if (!main) throw new Error('Rollout source HTML is missing its main content.');
      const { removeLocTags } = await import('https://da.live/nx/blocks/loc/regional-diff/regional-diff.js');
      removeLocTags(document);
      const metadata = document.querySelector('body > .da-metadata');
      metadata?.querySelectorAll(':scope > div').forEach((row) => {
        if (['acceptedhashes', 'rejectedhashes'].includes(row.firstElementChild?.textContent.trim().toLowerCase())) {
          row.remove();
        }
      });
      return `<body><header></header><main>${main.innerHTML}</main>${metadata?.outerHTML || ''}<footer></footer></body>`;
    },
    async saveProject(project) {
      validateProject(project, org, site);
      await write(projectPath(project.id), JSON.stringify(project), 'application/json');
    },
    async loadProject(id) {
      const response = await request(sourceUrl(projectPath(id)));
      const project = validateProject(await json(response, 'Could not retrieve workflow'), org, site);
      if (project.id !== id) throw new Error('The retrieved workflow ID does not match.');
      return project;
    },
    async listProjects() {
      const entries = await list(PROJECT_PREFIX.slice(0, -1));
      const prefix = `/${org}/${site}${PROJECT_PREFIX}`;
      return entries.filter((entry) => entry.ext === 'json'
        && typeof entry.path === 'string' && entry.path.startsWith(`${prefix}workflow-`))
        .map((entry) => {
          const id = entry.path.slice(prefix.length).replace(/\.json$/, '');
          projectPath(id);
          return { id, modified: entry.lastModified };
        }).sort((a, b) => b.modified - a.modified);
    },
    async translate(content, code, sheets) {
      const configured = parseConfig(sheets).targets
        .some((target) => target.translate && target.translationCode === code);
      if (!configured) throw new Error('Unsupported target language in the current translation configuration.');
      // These native helpers preserve DA block names, icons, metadata and DNT rules.
      const { addDnt, removeDnt } = await import('https://da.live/nx/blocks/loc/dnt/dnt.js');
      const prepared = await addDnt(content, sheets, { fileType: 'html' });
      let chunks = [prepared];
      let rejoin = (html) => html;
      if (prepared.length > 5000) {
        const { splitHtml, rejoinHtml } = await import('https://da.live/nx/blocks/loc/connectors/google/splitHtml.js');
        chunks = splitHtml(prepared, 5000);
        rejoin = rejoinHtml;
      }
      const parts = [];
      // eslint-disable-next-line no-restricted-syntax -- Bound traffic and preserve chunk order.
      for (const chunk of chunks) {
        const body = new FormData();
        body.append('data', chunk);
        body.append('fromlang', 'en');
        body.append('tolang', code);
        // eslint-disable-next-line no-await-in-loop
        const response = await daFetch(`https://translate.da.live/translate/google/${org}/${site}`, {
          method: 'POST',
          body,
          signal: AbortSignal.timeout(120000),
          headers: { Authorization: `Bearer ${token}` },
        });
        // eslint-disable-next-line no-await-in-loop
        const result = await json(response, 'Google translation failed');
        if (typeof result.translated !== 'string' || !result.translated.trim()) {
          throw new Error('Google did not return translated HTML.');
        }
        parts.push(result.translated);
      }
      const output = await removeDnt({
        org, site, html: rejoin(parts.join('')), ext: 'html',
      });
      const document = new DOMParser().parseFromString(output, 'text/html');
      if (!document.querySelector('main')) throw new Error('Translated HTML is missing its main content.');
      return output;
    },
  };
}
