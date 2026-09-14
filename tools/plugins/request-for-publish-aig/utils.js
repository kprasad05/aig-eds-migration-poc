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

// Supabase project used to record submitted publish requests. The publishable
// key is safe to ship client-side: the table is protected by an insert-only RLS
// policy so the key can only append rows, never read/update/delete.
const SUPABASE_URL = 'https://hlsbfggivfgkqxzmqvgo.supabase.co';
const SUPABASE_KEY = 'sb_publishable_iU5SL93AmI2tCSCvW-SEeQ_bgAODIGB';
const SUPABASE_TABLE = 'workflow_requests';
const SUPABASE_ARTIFACTS_TABLE = 'compliance_artifacts';

// Base da.live media location where uploaded compliance artifacts live. The
// artifact filename is appended to build each row's artifact_path.
const ARTIFACT_BASE_URL = 'https://da.live/media#/kprasad05/aig-eds-migration-poc/drafts/dorothy/docs/';

// daFetch ensures a fresh IMS token is used on every request (handles expiry).
const { daFetch } = await import('https://da.live/nx/utils/daFetch.js');

/**
 * Extract a setting value from the publish-workflow-settings tab. Display-only
 * (the worker enforces the authoritative rules); a wrong hint is cosmetic.
 * @param {Object} config - The workflow config returned by GET /api/config
 * @param {string} key - The setting key to look up
 * @returns {string|null} The setting value or null if not found
 */
function extractSetting(config, key) {
  const settings = config?.['publish-workflow-settings']?.data || [];
  const entry = settings.find((r) => (r.key || r.Key) === key);
  return entry?.value || entry?.Value || null;
}

/**
 * Get the publish-requests Worker URL. Falls back to localhost for local dev;
 * `?env=ci` targets the CI worker.
 * @returns {string} Worker base URL
 */
function getWorkerUrl() {
  const { hostname } = window.location;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return LOCAL_WORKER_URL;
  }
  if (new URLSearchParams(window.location.search).get('env') === 'ci') {
    return CI_WORKER_URL;
  }
  return WORKER_URL;
}

/**
 * Build fetch options with the user's IMS bearer token. The worker derives the
 * caller's identity from this token (via the IMS profile) — the client never
 * sends an email/approver list.
 * @param {string} token - The authorization token
 * @param {string} method - HTTP method
 * @param {Object} body - Optional request body
 * @returns {Object} Fetch options object
 */
function getOpts(token, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) {
    opts.body = JSON.stringify(body);
  }
  return opts;
}

/**
 * Resolve the publish-workflow configuration for a content path.
 *
 * Approver/CC resolution (specificity matching + DL-group expansion) is done by
 * the worker (`GET /api/approvers`) — the single source of truth. Display-only
 * settings (comment requirements, accent, support contact) are read from the
 * raw config (`GET /api/config`); the worker still enforces the comment rule.
 * @param {string} path - The content path
 * @param {string} org - Organization
 * @param {string} site - Site
 * @param {string} token - Authorization token
 * @returns {Promise<Object>} Workflow config including approvers, cc, settings.
 */
export async function resolveWorkflowConfig(path, org, site, token) {
  const base = getWorkerUrl();
  const opts = getOpts(token, 'GET');

  // Display settings come from the raw config.
  const configResp = await fetch(`${base}/api/config?org=${encodeURIComponent(org)}&site=${encodeURIComponent(site)}`, opts);
  if (!configResp.ok) {
    return {
      approvers: [],
      cc: [],
      source: 'error',
      commentsRequired: false,
      commentsMinLength: 10,
      error: configResp.status === 403
        ? 'You do not have access to this site, or it is not set up for the publish workflow.'
        : `Could not load the publish workflow configuration (${configResp.status}).`,
    };
  }
  const { config } = await configResp.json();
  if (!config) {
    return {
      approvers: [],
      cc: [],
      source: 'error',
      commentsRequired: false,
      commentsMinLength: 10,
      error: 'Publish workflow configuration not found for this site or org.',
    };
  }

  const commentsRequired = extractSetting(config, 'request.comments.required')?.toLowerCase() === 'true';
  const commentsMinLength = parseInt(extractSetting(config, 'request.comments.length'), 10) || 10;
  const accentColor = extractSetting(config, 'theme.accent-color');
  const accentColorHover = extractSetting(config, 'theme.accent-color-hover');
  const supportContact = extractSetting(config, 'request.support.contact') || '';

  // Approvers/CC are resolved server-side (matching + DL-group expansion).
  const approversResp = await fetch(`${base}/api/approvers?org=${encodeURIComponent(org)}&site=${encodeURIComponent(site)}&path=${encodeURIComponent(path)}`, opts);
  if (!approversResp.ok) {
    return {
      approvers: [],
      cc: [],
      source: 'error',
      commentsRequired,
      commentsMinLength,
      accentColor,
      accentColorHover,
      supportContact,
      error: `Could not resolve approvers (${approversResp.status}).`,
    };
  }
  const { approvers = [], cc = [] } = await approversResp.json();

  if (approvers.length === 0) {
    return {
      approvers: [],
      cc: [],
      source: 'no-match',
      commentsRequired,
      commentsMinLength,
      accentColor,
      accentColorHover,
      supportContact,
      error: `No approver rule found matching path "${path}". Please add a matching pattern to the "publish-workflow-config" tab.`,
    };
  }

  return {
    approvers,
    cc,
    source: 'config',
    commentsRequired,
    commentsMinLength,
    accentColor,
    accentColorHover,
    supportContact,
  };
}

/**
 * Preview content via the AEM Admin API so the .aem.page preview is up to date
 * before the publish request notification is sent. Runs client-side under the
 * user's session (the worker never calls Helix).
 * @param {string} org - Organization
 * @param {string} site - Site
 * @param {string} path - Content path
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function previewContent(org, site, path) {
  try {
    const pathForUrl = path.startsWith('/') ? path : `/${path}`;
    const url = `${CORS_PROXY}?url=${encodeURIComponent(`https://admin.hlx.page/preview/${org}/${site}/main${pathForUrl}`)}`;
    const resp = await daFetch(url, { method: 'POST' });
    if (!resp.ok) {
      return { success: false, error: `Preview failed (${resp.status})` };
    }
    return { success: true };
  } catch (error) {
    console.error('Error previewing content:', error);
    return { success: false, error: error.message || 'Preview failed' };
  }
}

/**
 * Submit a publish request. The worker resolves approvers, records the pending
 * row, and emails approvers — all under the caller's token.
 * @param {Object} requestData - { org, site, path, comment }
 * @param {string} token - Authorization token
 * @returns {Promise<Object>} Result
 */
export async function submitPublishRequest(requestData, token) {
  try {
    const {
      org, site, path, comment,
    } = requestData;
    const opts = getOpts(token, 'POST', {
      org, site, path, comment,
    });
    const response = await fetch(`${getWorkerUrl()}/api/requests`, opts);
    const result = await response.json();

    if (!response.ok) {
      return { success: false, message: result.error || 'Failed to submit publish request' };
    }
    return {
      success: true,
      message: 'Publish request sent to approvers',
      approvers: result.notifiedApprovers,
    };
  } catch (error) {
    console.error('Error submitting publish request:', error);
    return { success: false, message: error.message || 'An error occurred' };
  }
}

/**
 * Re-send the approval email for an existing request. Does not write a new row
 * or reject the existing one (worker handles via the `resend` flag).
 * @param {Object} requestData - { org, site, path }
 * @param {string} token - Authorization token
 * @returns {Promise<Object>} Result
 */
export async function resendPublishRequest(requestData, token) {
  try {
    const { org, site, path } = requestData;
    const opts = getOpts(token, 'POST', {
      org, site, path, resend: true,
    });
    const response = await fetch(`${getWorkerUrl()}/api/requests`, opts);
    const result = await response.json();

    if (!response.ok) {
      return { success: false, message: result.error || 'Failed to resend publish request' };
    }
    return {
      success: true,
      message: 'Publish request re-sent to approvers',
      approvers: result.notifiedApprovers,
    };
  } catch (error) {
    console.error('Error resending publish request:', error);
    return { success: false, message: error.message || 'An error occurred' };
  }
}

/**
 * Mark any active workflow_requests rows for a preview URL as inactive
 * (workflow_status = false). Best-effort; errors are logged, never thrown.
 * @param {string} previewUrl - The preview URL used when the workflow was recorded.
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function deactivateWorkflowForPreviewUrl(previewUrl) {
  if (!previewUrl) return { success: true };
  try {
    const params = new URLSearchParams({
      preview_url: `eq.${previewUrl}`,
      workflow_status: 'eq.true',
    });
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?${params.toString()}`, {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ workflow_status: false }),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.error('Supabase workflow deactivation failed:', resp.status, text);
      return { success: false, error: `Supabase update failed (${resp.status})` };
    }
    return { success: true };
  } catch (error) {
    console.error('Error deactivating workflow:', error);
    return { success: false, error: error.message || 'Supabase update error' };
  }
}

/**
 * Withdraw (cancel) the caller's own pending publish request.
 * @param {string} org - Organization
 * @param {string} site - Site
 * @param {string} path - Content path
 * @param {string} _requesterEmail - Unused; the worker derives identity from the token.
 * @param {string} token - Authorization token
 * @param {string} previewUrl - Preview URL, used to deactivate the Supabase workflow row.
 * @returns {Promise<Object>} Result
 */
export async function withdrawPublishRequest(org, site, path, _requesterEmail, token, previewUrl) {
  try {
    const opts = getOpts(token, 'POST', { org, site, path });
    const response = await fetch(`${getWorkerUrl()}/api/requests/withdraw`, opts);
    const result = await response.json();
    if (!response.ok) {
      return { success: false, error: result.error || 'Failed to withdraw request' };
    }
    // Best-effort: mark the recorded workflow inactive.
    await deactivateWorkflowForPreviewUrl(previewUrl);
    return { success: true };
  } catch (error) {
    console.error('Error withdrawing publish request:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Check whether the caller already has a pending request for the given path.
 * @param {string} org - Organization
 * @param {string} site - Site
 * @param {string} path - Content path
 * @param {string} _requesterEmail - Unused; the worker scopes by the token identity.
 * @param {string} token - Authorization token
 * @returns {Promise<Object|null>} The existing pending request row, or null.
 */
export async function checkExistingRequest(org, site, path, _requesterEmail, token) {
  try {
    const url = `${getWorkerUrl()}/api/requests?org=${encodeURIComponent(org)}&site=${encodeURIComponent(site)}&role=requester`;
    const resp = await fetch(url, getOpts(token, 'GET'));
    if (!resp.ok) return null;
    const { requests = [] } = await resp.json();
    return requests.find((r) => r.path === path && r.status === 'pending') || null;
  } catch (error) {
    console.error('Error checking existing request:', error);
    return null;
  }
}

/**
 * Fetch the current user's email from the Adobe IMS profile (for display).
 * @param {string} token - The authorization token
 * @returns {Promise<string>} User email or empty string if unavailable
 */
export async function getUserEmail(token) {
  try {
    const resp = await fetch('https://ims-na1.adobelogin.com/ims/profile/v1', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return '';
    const profile = await resp.json();
    return profile?.email || '';
  } catch {
    console.warn('Could not fetch user profile');
    return '';
  }
}

/**
 * Fetch the given preview URL and parse its document <title>. Best-effort: if the
 * request or parse fails, falls back to the last path segment of the URL.
 * @param {string} previewUrl - The AEM .aem.page preview URL
 * @returns {Promise<string>} The page title, or a derived fallback.
 */
export async function getPreviewPageTitle(previewUrl) {
  const fallback = () => {
    try {
      const segment = new URL(previewUrl).pathname.split('/').filter(Boolean).pop();
      return segment || '';
    } catch {
      return '';
    }
  };
  try {
    const resp = await fetch(previewUrl);
    if (!resp.ok) return fallback();
    const html = await resp.text();
    const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return match ? match[1].trim() : fallback();
  } catch (error) {
    console.warn('Could not fetch preview page title:', error);
    return fallback();
  }
}

/**
 * Insert one row (object) or many rows (array) into a Supabase table via REST.
 * Best-effort: errors are logged, never thrown.
 * @param {string} table - The Supabase table name.
 * @param {Object|Object[]} payload - Row or rows to insert.
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function insertRows(table, payload) {
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.error(`Supabase insert into ${table} failed:`, resp.status, text);
      return { success: false, error: `Supabase insert failed (${resp.status})` };
    }
    return { success: true };
  } catch (error) {
    console.error(`Error writing to Supabase table ${table}:`, error);
    return { success: false, error: error.message || 'Supabase write error' };
  }
}

/**
 * Record a submitted publish request in Supabase. Best-effort analytics write:
 * runs only after a successful publish request and never blocks the user flow —
 * failures are logged, not surfaced.
 * @param {Object} row - The workflow_requests row to insert.
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function pushWorkflowToSupabase(row) {
  return insertRows(SUPABASE_TABLE, row);
}

/**
 * Record one compliance_artifacts row per uploaded artifact filename, all sharing
 * the given workflowid. Best-effort; a no-op when there are no artifacts.
 * @param {number} workflowid - The parent workflow_requests id.
 * @param {string[]} artifactNames - Uploaded compliance file names.
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function pushComplianceArtifacts(workflowid, artifactNames) {
  if (!artifactNames || artifactNames.length === 0) return { success: true };
  const rows = artifactNames.map((name) => ({
    workflowid,
    artifact_path: `${ARTIFACT_BASE_URL}${name}`,
  }));
  return insertRows(SUPABASE_ARTIFACTS_TABLE, rows);
}
