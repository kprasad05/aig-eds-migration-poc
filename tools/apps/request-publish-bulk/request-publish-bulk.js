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
/* eslint-disable no-underscore-dangle, import/no-unresolved, no-console */
/* eslint-disable class-methods-use-this, function-paren-newline */
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { LitElement, html, nothing } from 'da-lit';
import {
  listMyPendingRequests,
  previewContent,
  submitPublishRequest,
  getUserEmail,
} from './api.js';

const NX = 'https://da.live/nx2';
const CONCURRENCY = 3;
let nexter = null;
let sl = null;
let styles = null;
try {
  const [{ default: getStyle }, { loadStyle, getColorScheme }] = await Promise.all([
    import(`${NX}/public/utils/styles.js`),
    import(`${NX}/scripts/nx.js`),
  ]);
  document.documentElement.style.colorScheme = getColorScheme() === 'dark-scheme' ? 'dark' : 'light';
  await Promise.all([
    loadStyle(`${NX}/styles/styles.css`),
    loadStyle(`${NX}/public/sl/styles.css`),
  ]);
  await import(`${NX}/public/sl/components.js`);
  [nexter, sl, styles] = await Promise.all([
    getStyle(`${NX}/styles/styles.css`),
    getStyle(`${NX}/public/sl/styles.css`),
    getStyle(import.meta.url),
  ]);
} catch (e) {
  console.warn('Failed to load styles:', e);
}

const STATUS_LABELS = {
  ready: 'Ready',
  'already-pending': 'Already pending',
  invalid: 'Invalid path',
  previewing: 'Previewing...',
  submitting: 'Submitting...',
  submitted: 'Submitted',
  failed: 'Failed',
};

/**
 * Normalize a pasted line to a site-relative content path.
 * @returns {string|null} Normalized path, or null if the line is unusable
 */
export function normalizePath(line) {
  let p = line.trim();
  if (!p) return null;
  try {
    if (/^https?:\/\//i.test(p)) p = new URL(p).pathname;
  } catch {
    return p;
  }
  p = p.split(/[?#]/)[0].replace(/\.(plain\.)?html$/i, '').replace(/\/{2,}/g, '/');
  if (!p.startsWith('/')) p = `/${p}`;
  if (p.length > 1) p = p.replace(/\/$/, '');
  return p;
}

function isValidPath(path) {
  return /^\/[A-Za-z0-9\-_./]*$/.test(path) && !path.split('/').includes('..') && path !== '/';
}

class RequestPublishBulkApp extends LitElement {
  static properties = {
    context: { attribute: false },
    token: { attribute: false },
    _org: { state: true },
    _site: { state: true },
    _pathsText: { state: true },
    _comment: { state: true },
    _items: { state: true },
    _duplicates: { state: true },
    _message: { state: true },
    _validating: { state: true },
    _submitting: { state: true },
    _userEmail: { state: true },
  };

  constructor() {
    super();
    this._org = '';
    this._site = '';
    this._pathsText = '';
    this._comment = '';
    this._items = [];
    this._duplicates = 0;
    this._message = null;
    this._validating = false;
    this._submitting = false;
    this._userEmail = '';
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [nexter, sl, styles].filter(Boolean);
    const params = new URLSearchParams(window.location.search);
    this._org = params.get('org') || this.context?.org || '';
    this._site = params.get('site') || this.context?.repo || '';
    getUserEmail(this.token).then((email) => { this._userEmail = email; });
  }

  get _validated() {
    return this._items.length > 0;
  }

  get _submittable() {
    return this._items.filter((i) => i.status === 'ready');
  }

  get _failed() {
    return this._items.filter((i) => i.status === 'failed');
  }

  _updateItem(path, patch) {
    this._items = this._items.map((i) => (i.path === path ? { ...i, ...patch } : i));
  }

  _resetValidation() {
    if (this._submitting) return;
    this._items = [];
    this._duplicates = 0;
    this._message = null;
  }

  async handleValidate() {
    if (this._validating || this._submitting) return;
    this._message = null;

    const org = this._org.trim();
    const site = this._site.trim();
    if (!org || !site) {
      this._message = { type: 'error', text: 'Enter the organization and site.' };
      return;
    }

    const seen = new Set();
    const items = [];
    let duplicates = 0;
    this._pathsText.split(/\r?\n/).forEach((line) => {
      const path = normalizePath(line);
      if (!path) return;
      if (seen.has(path)) {
        duplicates += 1;
        return;
      }
      seen.add(path);
      items.push({ path, status: isValidPath(path) ? 'ready' : 'invalid', message: '' });
    });

    if (items.length === 0) {
      this._items = [];
      this._message = { type: 'error', text: 'Paste at least one page path.' };
      return;
    }

    this._validating = true;
    const pending = await listMyPendingRequests(org, site, this.token);
    this._validating = false;

    if (!pending.success) {
      this._items = [];
      this._message = { type: 'error', text: pending.error };
      return;
    }

    const pendingPaths = new Set(pending.requests.map((r) => r.path));
    this._duplicates = duplicates;
    this._items = items.map((i) => (i.status === 'ready' && pendingPaths.has(i.path)
      ? { ...i, status: 'already-pending', message: 'You already have a pending request for this page.' }
      : i));
  }

  async _processItem(item, comment) {
    const org = this._org.trim();
    const site = this._site.trim();

    this._updateItem(item.path, { status: 'previewing', message: '' });
    const preview = await previewContent(org, site, item.path);
    if (!preview.success) {
      this._updateItem(item.path, { status: 'failed', message: preview.error, ambiguous: false });
      return;
    }

    this._updateItem(item.path, { status: 'submitting' });
    const result = await submitPublishRequest({
      org, site, path: item.path, comment,
    }, this.token);
    if (result.success) {
      this._updateItem(item.path, { status: 'submitted', message: 'Sent to approvers.', ambiguous: false });
    } else {
      this._updateItem(item.path, {
        status: 'failed',
        message: result.message,
        ambiguous: !!result.ambiguous,
      });
    }
  }

  async _run(targets) {
    const comment = this._comment.trim();
    const queue = [...targets];
    const worker = async () => {
      while (queue.length) {
        // eslint-disable-next-line no-await-in-loop
        await this._processItem(queue.shift(), comment);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  }

  async handleSubmit() {
    if (this._submitting || this._submittable.length === 0) return;
    this._submitting = true;
    this._message = null;
    await this._run(this._submittable);
    this._submitting = false;
    this._summarize();
  }

  async handleRetry() {
    if (this._submitting || this._failed.length === 0) return;
    this._submitting = true;
    this._message = null;

    // A failed call may still have saved the request; check the queue before resubmitting.
    let toRetry = this._failed;
    const ambiguous = toRetry.filter((i) => i.ambiguous);
    if (ambiguous.length) {
      const pending = await listMyPendingRequests(this._org.trim(), this._site.trim(), this.token);
      if (pending.success) {
        const pendingPaths = new Set(pending.requests.map((r) => r.path));
        ambiguous.filter((i) => pendingPaths.has(i.path)).forEach((i) => {
          this._updateItem(i.path, {
            status: 'submitted',
            message: 'Request was saved despite the error; not resubmitted.',
            ambiguous: false,
          });
        });
        toRetry = this._failed;
      } else {
        this._submitting = false;
        this._message = { type: 'error', text: `Retry stopped: ${pending.error} Checking the queue first avoids duplicate requests.` };
        return;
      }
    }

    await this._run(toRetry);
    this._submitting = false;
    this._summarize();
  }

  _summarize() {
    const submitted = this._items.filter((i) => i.status === 'submitted').length;
    const failed = this._failed.length;
    if (failed) {
      this._message = { type: 'warning', text: `${submitted} submitted, ${failed} failed. Retry failed items below.` };
    } else {
      this._message = { type: 'success', text: `${submitted} request${submitted === 1 ? '' : 's'} sent to approvers.` };
    }
  }

  get _inboxUrl() {
    return `https://da.live/app/adobe-rnd/aem-apps/tools/apps/publish-requests-inbox/publish-requests-inbox?org=${encodeURIComponent(this._org)}&site=${encodeURIComponent(this._site)}&requester=true`;
  }

  renderItems() {
    if (!this._validated) return nothing;
    const counts = {
      ready: this._submittable.length,
      pending: this._items.filter((i) => i.status === 'already-pending').length,
      invalid: this._items.filter((i) => i.status === 'invalid').length,
    };
    return html`
      <section class="bulk-results">
        <p class="bulk-summary">
          ${this._items.length} page${this._items.length === 1 ? '' : 's'}:
          ${counts.ready} ready, ${counts.pending} already pending, ${counts.invalid} invalid.
          ${this._duplicates ? html`${this._duplicates} duplicate${this._duplicates === 1 ? '' : 's'} removed.` : nothing}
        </p>
        <ul class="bulk-list">
          ${this._items.map((i) => html`
            <li class="bulk-item bulk-${i.status}">
              <span class="bulk-path">${i.path}</span>
              <span class="bulk-status">${STATUS_LABELS[i.status]}</span>
              ${i.message ? html`<span class="bulk-detail">${i.message}</span>` : nothing}
            </li>
          `)}
        </ul>
      </section>
    `;
  }

  render() {
    const busy = this._validating || this._submitting;
    const readyCount = this._submittable.length;
    const failedCount = this._failed.length;
    return html`
      <div class="bulk-app">
        <h1>Request Publish for Multiple Pages</h1>
        <p class="field-hint">Submits one pending request per page. Approvers review them in the Publish Requests inbox; nothing is published from here.</p>
        ${this._message ? html`<div class="message ${this._message.type}">${this._message.text}</div>` : nothing}

        <div class="bulk-row">
          <div class="form-group">
            <label for="org">Organization</label>
            <sl-input id="org" .value=${this._org} ?disabled=${busy}
              @input=${(e) => { this._org = e.target.value; this._resetValidation(); }}></sl-input>
          </div>
          <div class="form-group">
            <label for="site">Site</label>
            <sl-input id="site" .value=${this._site} ?disabled=${busy}
              @input=${(e) => { this._site = e.target.value; this._resetValidation(); }}></sl-input>
          </div>
        </div>

        <div class="form-group">
          <label for="paths">Page paths</label>
          <sl-textarea id="paths" rows="8" .value=${this._pathsText} ?disabled=${busy}
            placeholder="/fr/ca/home&#10;/fr/ca/products&#10;/de/de/home"
            @input=${(e) => { this._pathsText = e.target.value; this._resetValidation(); }}></sl-textarea>
          <span class="field-hint">One site-relative path per line.</span>
        </div>

        <div class="form-group">
          <label for="comment">Comment (shared by all requests)</label>
          <sl-textarea id="comment" rows="3" .value=${this._comment} ?disabled=${busy}
            placeholder="Translations ready for review."
            @input=${(e) => { this._comment = e.target.value; }}></sl-textarea>
        </div>

        ${this._userEmail ? html`<p class="field-hint">Requesting as ${this._userEmail}</p>` : nothing}

        <div class="bulk-actions">
          <sl-button @click=${() => this.handleValidate()} ?disabled=${busy}>
            ${this._validating ? 'Validating...' : 'Validate'}
          </sl-button>
          <sl-button class="pw-fill-accent" @click=${() => this.handleSubmit()}
            ?disabled=${busy || readyCount === 0}>
            ${this._submitting ? 'Submitting...' : `Request Publish${readyCount ? ` (${readyCount})` : ''}`}
          </sl-button>
          ${failedCount ? html`
            <sl-button @click=${() => this.handleRetry()} ?disabled=${busy}>
              Retry failed (${failedCount})
            </sl-button>` : nothing}
          ${this._items.some((i) => i.status === 'submitted') ? html`
            <a href=${this._inboxUrl} target="_blank" rel="noopener">View my requests</a>` : nothing}
        </div>

        ${this.renderItems()}
      </div>
    `;
  }
}

customElements.define('request-publish-bulk-app', RequestPublishBulkApp);

(async function init() {
  const { context, token } = await DA_SDK;
  const cmp = document.createElement('request-publish-bulk-app');
  cmp.context = context;
  cmp.token = token;
  document.body.append(cmp);
}());
