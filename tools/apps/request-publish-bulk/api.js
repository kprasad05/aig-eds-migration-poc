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

const WORKER_URL = 'https://publish-requests.aem-poc-lab.workers.dev';
const CI_WORKER_URL = 'https://publish-requests-ci.aem-poc-lab.workers.dev';
const LOCAL_WORKER_URL = 'http://localhost:8787';
const CORS_PROXY = 'https://da-etc.adobeaem.workers.dev/cors';

const { daFetch } = await import('https://da.live/nx/utils/daFetch.js');

function getWorkerUrl() {
  const { hostname, search } = window.location;
  const env = new URLSearchParams(search).get('env');
  if (env === 'prod') return WORKER_URL;
  if (env === 'ci') return CI_WORKER_URL;
  if (hostname === 'localhost' || hostname === '127.0.0.1') return LOCAL_WORKER_URL;
  return WORKER_URL;
}

function getOpts(token, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  return opts;
}

/**
 * List the caller's own pending requests for a site (single call).
 * @returns {Promise<{success: boolean, requests?: Object[], error?: string}>}
 */
export async function listMyPendingRequests(org, site, token) {
  try {
    const url = `${getWorkerUrl()}/api/requests?org=${encodeURIComponent(org)}&site=${encodeURIComponent(site)}&role=requester`;
    const resp = await fetch(url, getOpts(token));
    if (!resp.ok) {
      return {
        success: false,
        error: resp.status === 403
          ? 'You do not have access to this site, or it is not set up for the publish workflow.'
          : `Could not load pending requests (${resp.status}).`,
      };
    }
    const { requests = [] } = await resp.json();
    return { success: true, requests: requests.filter((r) => r.status === 'pending') };
  } catch (error) {
    console.error('Error listing pending requests:', error);
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
    if (!resp.ok) return { success: false, error: `Preview failed (${resp.status})` };
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || 'Preview failed' };
  }
}

/**
 * Submit one publish request. `ambiguous` marks failures where the worker may
 * have saved the request anyway (network error or 5xx).
 * @returns {Promise<{success: boolean, message?: string, ambiguous?: boolean}>}
 */
export async function submitPublishRequest({
  org, site, path, comment,
}, token) {
  try {
    const resp = await fetch(`${getWorkerUrl()}/api/requests`, getOpts(token, 'POST', {
      org, site, path, comment,
    }));
    const result = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return {
        success: false,
        ambiguous: resp.status >= 500,
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
