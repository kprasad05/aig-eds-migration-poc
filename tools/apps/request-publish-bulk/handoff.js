import { isValidPath, validateSite } from './paths.js';

const PARAM = 'workflowHandoff';
const MAX_LENGTH = 7000;

function validatePayload(payload, org, site) {
  validateSite(org, site);
  if (!payload || ![1, 2].includes(payload.version) || payload.org !== org || payload.site !== site
    || !/^workflow-[0-9a-f-]{36}$/.test(payload.workflowId)
    || !Array.isArray(payload.paths) || !payload.paths.length || payload.paths.length > 50
    || new Set(payload.paths).size !== payload.paths.length
    || payload.paths.some((path) => !isValidPath(path)
      || !(payload.version === 1 ? /^\/(?:fr|de)(?:\/[A-Za-z0-9_-]+)+$/
        : /^\/[A-Za-z][A-Za-z0-9_-]*\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)+$/).test(path))) {
    throw new Error('Invalid workflow handoff: expected 1-50 unique supported destination paths for this site.');
  }
  return payload;
}

export function readWorkflowHandoff(search, org, site) {
  const params = new URLSearchParams(search);
  if (!params.has(PARAM)) return null;
  if (search.length > MAX_LENGTH || params.getAll(PARAM).length !== 1) {
    throw new Error('The workflow handoff is too large or contains duplicate parameters.');
  }
  let payload;
  try {
    payload = JSON.parse(params.get(PARAM));
  } catch {
    throw new Error('The workflow handoff contains invalid JSON.');
  }
  return validatePayload(payload, org, site);
}

export function createWorkflowHandoffUrl({
  org, site, workflowId, paths, location, version = 1,
}) {
  const payload = validatePayload({
    version, org, site, workflowId, paths,
  }, org, site);
  const params = new URLSearchParams(location.search);
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  let ref = local ? 'local' : params.get('ref');
  if (!ref) {
    const suffixes = ['.aem.live', '.aem.page'].map((suffix) => `--${site}--${org}${suffix}`);
    const suffix = suffixes.find((value) => location.hostname.endsWith(value));
    if (suffix) ref = location.hostname.slice(0, -suffix.length);
  }
  if (!ref || !/^[A-Za-z0-9_-]+$/.test(ref)) {
    throw new Error('Cannot determine the app code reference. Open this app through DA with ref=local or your branch name.');
  }
  const env = params.get('env') || 'prod';
  if (!['prod', 'ci'].includes(env)) throw new Error('The publish-request environment must be prod or ci.');
  const url = new URL(`https://da.live/app/${org}/${site}/tools/apps/request-publish-bulk/request-publish-bulk`);
  url.searchParams.set('ref', ref);
  url.searchParams.set('env', env);
  url.searchParams.set('org', org);
  url.searchParams.set('site', site);
  url.searchParams.set(PARAM, JSON.stringify(payload));
  if (url.href.length > MAX_LENGTH) {
    throw new RangeError('The handoff URL is too long. Continue in smaller batches.');
  }
  return url.href;
}

export function createWorkflowHandoffBatches(options) {
  const batches = [];
  let paths = [];
  let url;
  options.paths.forEach((path) => {
    if (paths.length === 50) {
      batches.push({ url, count: paths.length });
      paths = [];
    }
    try {
      url = createWorkflowHandoffUrl({ ...options, paths: [...paths, path] });
    } catch (error) {
      if (!(error instanceof RangeError) || !paths.length) throw error;
      batches.push({ url, count: paths.length });
      paths = [];
      url = createWorkflowHandoffUrl({ ...options, paths: [path] });
    }
    paths.push(path);
  });
  if (paths.length) batches.push({ url, count: paths.length });
  return batches;
}
