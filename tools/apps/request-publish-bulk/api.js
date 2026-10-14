/*
 * Copyright 2026 Adobe Systems Incorporated
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/* eslint-disable import/no-unresolved, no-console */
import { assessPreview, isValidPath, validateSite } from './paths.js';

const WORKER_URL = 'https://publish-requests.aem-poc-lab.workers.dev';
const CI_WORKER_URL = 'https://publish-requests-ci.aem-poc-lab.workers.dev';
const LOCAL_WORKER_URL = 'http://localhost:8787';
const CORS_PROXY = 'https://da-etc.adobeaem.workers.dev/cors';

const { daFetch } = await import('https://da.live/nx/utils/daFetch.js');
const DA_ADMIN = 'https://admin.da.live';
const DA_CONTENT = 'https://content.da.live';

function getOpts(token, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
    },
  };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  return opts;
}

function responseError(response, operation) {
  const hints = {
    401: 'Your session may have expired. Sign in to DA again.',
    403: 'Your account does not have permission for this operation.',
    404: 'The requested content was not found.',
    429: 'Too many requests. Wait a moment and try again.',
  };
  return new Error(`${operation} (${response.status}). ${hints[response.status] || 'Try again; if the problem continues, check the browser console.'}`);
}

async function readJson(url, token, operation) {
  const response = await daFetch(url, { ...getOpts(token), cache: 'no-store' });
  if (!response.ok) throw responseError(response, operation);
  try {
    return await response.json();
  } catch {
    throw new Error(`${operation}: the server returned invalid JSON.`);
  }
}

export async function listTranslationProjects(org, site, token) {
  validateSite(org, site);
  const entries = await readJson(`${DA_ADMIN}/list/${org}/${site}/.da/translation/active`, token, 'Could not list active translation projects');
  if (!Array.isArray(entries)) throw new Error('The translation list has an unexpected format.');
  return entries.filter((entry) => entry.ext === 'json')
    .sort((a, b) => b.lastModified - a.lastModified);
}

export async function loadTranslationProject(org, site, path, token) {
  validateSite(org, site);
  const prefix = `/${org}/${site}/.da/translation/active/`;
  if (typeof path !== 'string' || !path.startsWith(prefix)
    || !/^[A-Za-z0-9_-]+\.json$/.test(path.slice(prefix.length))) {
    throw new Error('The translation project path is outside this site or is invalid.');
  }
  const project = await readJson(`${DA_CONTENT}${path}`, token, 'Could not load the translation project');
  if (project.org !== org || project.site !== site || typeof project.title !== 'string') {
    throw new Error('The translation project has an unexpected format or belongs to another site.');
  }
  return project;
}

export async function validateContent(org, site, path, token) {
  validateSite(org, site);
  if (!isValidPath(path)) throw new Error('The content path is invalid.');
  const sourcePath = /\.[^/]+$/.test(path) ? path : `${path}.html`;
  // DA source GET supplies Last-Modified; HEAD is not supported by this API.
  const source = await daFetch(`${DA_ADMIN}/source/${org}/${site}${sourcePath}`, {
    ...getOpts(token), cache: 'no-store',
  });
  if (source.status === 404) {
    return { status: 'missing', message: 'This page does not exist in DA. Check its destination path.' };
  }
  if (!source.ok) throw responseError(source, 'Could not read the DA source');
  const sourceModified = source.headers.get('last-modified');
  const target = `https://admin.hlx.page/status/${org}/${site}/main${path}?editUrl=auto`;
  const status = await readJson(`${CORS_PROXY}?url=${encodeURIComponent(target)}`, token, 'Could not read the AEM preview status');
  return assessPreview(sourceModified, status.preview);
}

function getWorkerUrl() {
  const { hostname, search } = window.location;
  const env = new URLSearchParams(search).get('env');
  if (env === 'prod') return WORKER_URL;
  if (env === 'ci') return CI_WORKER_URL;
  if (hostname === 'localhost' || hostname === '127.0.0.1') return LOCAL_WORKER_URL;
  return WORKER_URL;
}

async function listRequests(org, site, token, role = '') {
  validateSite(org, site);
  const roleParam = role ? `&role=${role}` : '';
  const url = `${getWorkerUrl()}/api/requests?org=${encodeURIComponent(org)}&site=${encodeURIComponent(site)}${roleParam}`;
  const resp = await fetch(url, { ...getOpts(token), cache: 'no-store' });
  if (!resp.ok) throw responseError(resp, 'Could not load pending publish requests');
  const result = await resp.json();
  if (!Array.isArray(result.requests)) {
    throw new Error('The pending publish requests response has an unexpected format.');
  }
  return result.requests.filter((request) => request.status === 'pending');
}

/**
 * Only the caller's own requests may confirm whether their failed submission saved.
 */
export async function listMyPendingRequests(org, site, token) {
  try {
    return { success: true, requests: await listRequests(org, site, token, 'requester') };
  } catch (error) {
    console.error('[Request Publish Bulk] Requester queue check failed', { message: error.message });
    return { success: false, error: error.message || 'Could not load pending requests.' };
  }
}

/**
 * Duplicate detection combines the caller's queue and their approver inbox.
 * This is not a site-wide list: requests invisible to the caller remain unknown.
 */
export async function listPendingRequests(org, site, token) {
  try {
    const [own, inbox] = await Promise.all([
      listRequests(org, site, token, 'requester'),
      listRequests(org, site, token),
    ]);
    const byPath = new Map();
    [...own, ...inbox].forEach((request) => {
      if (!byPath.has(request.path)) byPath.set(request.path, request);
    });
    return { success: true, requests: [...byPath.values()] };
  } catch (error) {
    console.error('[Request Publish Bulk] Pending request check failed', { message: error.message });
    return { success: false, error: error.message || 'Could not load pending requests.' };
  }
}

/**
 * Preview a page via Helix Admin under the user's session.
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function previewContent(org, site, path) {
  try {
    const target = `https://admin.hlx.page/preview/${org}/${site}/main${path}`;
    const resp = await daFetch(`${CORS_PROXY}?url=${encodeURIComponent(target)}`, { method: 'POST' });
    if (!resp.ok) throw responseError(resp, `Preview failed for ${path}`);
    return { success: true };
  } catch (error) {
    console.error('[Request Publish Bulk] Preview failed', {
      org, site, path, message: error.message,
    });
    return { success: false, error: error.message || 'Preview failed' };
  }
}

/**
 * Submit one publish request. `ambiguous` marks failures where the worker may
 * have saved the request anyway (including notification failures returned as 400).
 * @returns {Promise<{success: boolean, message?: string, ambiguous?: boolean}>}
 */
export async function submitPublishRequest({
  org, site, path, comment,
}, token) {
  try {
    const resp = await fetch(`${getWorkerUrl()}/api/requests`, getOpts(token, 'POST', {
      org, site, path, comment,
    }));
    let result;
    try {
      result = await resp.json();
    } catch {
      console.error('[Request Publish Bulk] Submission returned invalid JSON', { path, status: resp.status });
      return { success: false, ambiguous: true, message: `Could not confirm submission (${resp.status}). Check pending requests before retrying.` };
    }
    if (!resp.ok) {
      return {
        success: false,
        ambiguous: true,
        message: result.error || `Failed to submit request (${resp.status})`,
      };
    }
    return { success: true };
  } catch (error) {
    return { success: false, ambiguous: true, message: error.message || 'Network error' };
  }
}

export async function getUserEmail(token) {
  try {
    const resp = await fetch('https://ims-na1.adobelogin.com/ims/profile/v1', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return '';
    const profile = await resp.json();
    return profile?.email || '';
  } catch {
    return '';
  }
}
