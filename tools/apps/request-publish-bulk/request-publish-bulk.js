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
import { showToast, VARIANT_ERROR, VARIANT_WARNING } from 'https://da.live/nx2/blocks/shared/toast/toast.js';
import {
  listMyPendingRequests,
  listPendingRequests,
  previewContent,
  submitPublishRequest,
  getUserEmail,
  listTranslationProjects,
  loadTranslationProject,
  validateContent,
} from './api.js';
import {
  normalizePath, isValidPath, validateSite, getTranslationDestinations,
} from './paths.js';

const NX = 'https://da.live/nx2';
const CONCURRENCY = 3;
const PROJECT_PAGE_SIZE = 3;
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
  checking: 'Checking...',
  missing: 'Page not found',
  stale: 'Preview out of date',
  'needs-preview': 'Not previewed',
  unverified: 'Freshness unknown',
  error: 'Validation failed',
};

async function forEachLimited(items, callback, concurrency = CONCURRENCY) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      // eslint-disable-next-line no-await-in-loop
      await callback(queue.shift());
    }
  }));
}

function formatDate(value) {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Unavailable';
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
    _flow: { state: true },
    _projects: { state: true },
    _projectEntries: { state: true },
    _projectPage: { state: true },
    _loadingProjects: { state: true },
    _projectPath: { state: true },
    _project: { state: true },
    _destinations: { state: true },
    _selectedDestinations: { state: true },
    _selectedPreviewPaths: { state: true },
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
    this._flow = 'paths';
    this._projects = [];
    this._projectEntries = [];
    this._projectPage = 0;
    this._loadingProjects = false;
    this._projectPath = '';
    this._project = null;
    this._destinations = [];
    this._selectedDestinations = new Set();
    this._selectedPreviewPaths = new Set();
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

  get _busy() {
    return this._validating || this._submitting || this._loadingProjects;
  }

  get _previewable() {
    return this._items.filter((item) => ['stale', 'needs-preview', 'unverified', 'already-pending'].includes(item.status)
      && ['stale', 'needs-preview', 'unverified'].includes(item.validationStatus || item.status));
  }

  get _selectedPreviewItems() {
    return this._previewable.filter((item) => this._selectedPreviewPaths.has(item.path));
  }

  get _generatedPaths() {
    return [...new Set(this._destinations
      .filter((destination) => this._selectedDestinations.has(destination.id))
      .flatMap((destination) => destination.paths))];
  }

  get _projectPageCount() {
    return Math.ceil(this._projectEntries.length / PROJECT_PAGE_SIZE);
  }

  _notify(type, text) {
    this._message = { type, text };
    if (type === 'error' || type === 'warning') {
      console[type === 'error' ? 'error' : 'warn']('[Request Publish Bulk]', text);
      showToast({ text, variant: type === 'error' ? VARIANT_ERROR : VARIANT_WARNING });
    }
  }

  _checkSite() {
    try {
      validateSite(this._org.trim(), this._site.trim());
      return true;
    } catch (error) {
      this._notify('error', error.message);
      return false;
    }
  }

  handleSiteChange(field, value) {
    this[field] = value;
    this._projects = [];
    this._projectEntries = [];
    this._projectPage = 0;
    this._clearProject();
    this._resetValidation();
  }

  _clearProject() {
    this._projectPath = '';
    this._project = null;
    this._destinations = [];
    this._selectedDestinations = new Set();
  }

  async handleFlowChange(flow) {
    if (this._busy || this._flow === flow) return;
    this._flow = flow;
    this._resetValidation();
    if (flow === 'translations' && !this._projectEntries.length) await this.handleLoadProjects();
  }

  async handleLoadProjects() {
    if (this._busy || !this._checkSite()) return;
    this._resetValidation();
    this._clearProject();
    this._projects = [];
    this._projectEntries = [];
    this._projectPage = 0;
    this._loadingProjects = true;
    const org = this._org.trim();
    const site = this._site.trim();
    try {
      this._projectEntries = await listTranslationProjects(org, site, this.token);
      await this._loadProjectPage(0);
    } catch (error) {
      this._notify('error', error.message);
    } finally {
      this._loadingProjects = false;
    }
  }

  async handleProjectPage(page) {
    if (this._busy || !Number.isInteger(page) || page < 0 || page >= this._projectPageCount) return;
    this._resetValidation();
    this._clearProject();
    this._loadingProjects = true;
    try {
      await this._loadProjectPage(page);
    } catch (error) {
      this._notify('error', error.message);
    } finally {
      this._loadingProjects = false;
    }
  }

  async _loadProjectPage(page) {
    this._projectPage = page;
    this._projects = [];
    const start = page * PROJECT_PAGE_SIZE;
    const entries = this._projectEntries.slice(start, start + PROJECT_PAGE_SIZE);
    const projects = new Array(entries.length);
    const indexedEntries = entries.map((entry, index) => ({ entry, index }));
    await forEachLimited(indexedEntries, async ({ entry, index }) => {
      try {
        const project = await loadTranslationProject(
          this._org.trim(), this._site.trim(), entry.path, this.token,
        );
        let available = false;
        let reason = 'No eligible language/country destinations: translation must be translated or complete; copy and rollout must be complete.';
        if (Array.isArray(project.langs) && Array.isArray(project.urls)) {
          try {
            available = getTranslationDestinations(project).length > 0;
          } catch (error) {
            reason = error.message;
          }
        }
        projects[index] = {
          ...entry, title: project.title, available, reason,
        };
      } catch (error) {
        console.error('[Request Publish Bulk] Project load failed', { path: entry.path, message: error.message });
        projects[index] = {
          ...entry, title: entry.name, available: false, error: error.message,
        };
      }
    });
    this._projects = projects;
    const failed = projects.filter((project) => project.error).length;
    if (failed) {
      this._notify('warning', `${failed} project file(s) on this page could not be read. Other projects remain available. Reload this page to retry.`);
    } else if (!this._projectEntries.length) {
      this._notify('info', 'No active translation projects were found for this site.');
    } else if (!projects.some((project) => project.available)) {
      this._notify('info', 'No eligible language/country destinations on this page. Review the project details or browse another page.');
    }
  }

  async handleProjectSelect(path) {
    if (this._busy) return;
    this._resetValidation();
    this._clearProject();
    if (!path) return;
    this._projectPath = path;
    this._loadingProjects = true;
    try {
      this._project = await loadTranslationProject(
        this._org.trim(), this._site.trim(), path, this.token,
      );
      this._destinations = getTranslationDestinations(this._project);
      this._selectedDestinations = new Set(this._destinations.map((destination) => destination.id));
      if (!this._destinations.length) {
        this._notify('warning', 'This project has no eligible language/country destinations. Translation must be translated or complete; copy and rollout must be complete. Language-only pages are excluded.');
      }
    } catch (error) {
      this._clearProject();
      this._notify('error', error.message);
    } finally {
      this._loadingProjects = false;
    }
  }

  handleDestinationChange(id, checked) {
    if (this._busy) return;
    const selected = new Set(this._selectedDestinations);
    if (checked) selected.add(id);
    else selected.delete(id);
    this._selectedDestinations = selected;
    this._resetValidation();
  }

  handleSelectDestinations(selected) {
    if (this._busy) return;
    this._selectedDestinations = new Set(
      selected ? this._destinations.map((destination) => destination.id) : [],
    );
    this._resetValidation();
  }

  _updateItem(path, patch) {
    this._items = this._items.map((i) => (i.path === path ? { ...i, ...patch } : i));
  }

  handlePreviewSelection(path, checked) {
    if (this._busy || !this._previewable.some((item) => item.path === path)) return;
    const selected = new Set(this._selectedPreviewPaths);
    if (checked) selected.add(path);
    else selected.delete(path);
    this._selectedPreviewPaths = selected;
  }

  handleSelectPreviews(checked) {
    if (this._busy) return;
    this._selectedPreviewPaths = new Set(checked ? this._previewable.map((item) => item.path) : []);
  }

  _resetValidation() {
    if (this._submitting) return;
    this._items = [];
    this._selectedPreviewPaths = new Set();
    this._duplicates = 0;
    this._message = null;
  }

  async handleValidate() {
    if (this._busy || !this._checkSite()) return;
    this._message = null;
    this._selectedPreviewPaths = new Set();

    const org = this._org.trim();
    const site = this._site.trim();
    const seen = new Set();
    const items = [];
    let duplicates = 0;
    const lines = this._flow === 'translations' ? this._generatedPaths : this._pathsText.split(/\r?\n/);
    lines.forEach((line) => {
      const path = normalizePath(line);
      if (!path) return;
      if (seen.has(path)) {
        duplicates += 1;
        return;
      }
      seen.add(path);
      items.push({ path, status: isValidPath(path) ? 'checking' : 'invalid', message: '' });
    });

    if (items.length === 0) {
      this._items = [];
      this._notify('error', this._flow === 'translations'
        ? 'Select a project and at least one eligible destination folder.'
        : 'Paste at least one page path.');
      return;
    }

    this._validating = true;
    this._duplicates = duplicates;
    this._items = items;
    try {
      const pending = await listPendingRequests(org, site, this.token);
      if (!pending.success) throw new Error(pending.error);
      const pendingPaths = new Set(pending.requests.map((request) => request.path));
      await forEachLimited(items.filter((item) => item.status === 'checking'), async (item) => {
        await this._validateItem({ ...item, pending: pendingPaths.has(item.path) });
      });
      const blocked = this._items.filter((item) => (item.validationStatus || item.status) !== 'ready').length;
      if (blocked) this._notify('warning', `${blocked} page(s) need attention. Review the per-page results before submitting.`);
      else this._notify('success', `${this._submittable.length} page(s) have a current preview and are ready to submit.`);
    } catch (error) {
      this._items = [];
      this._notify('error', error.message);
    } finally {
      this._validating = false;
    }
  }

  async _validateItem(item) {
    let result;
    try {
      result = await validateContent(
        this._org.trim(), this._site.trim(), item.path, this.token,
      );
    } catch (error) {
      console.error('[Request Publish Bulk] Validation failed', { path: item.path, message: error.message });
      result = { status: 'error', message: error.message };
    }
    const pending = item.pending || item.status === 'already-pending';
    const pendingMessage = {
      stale: 'The source changed after the preview. Refresh the preview before approval.',
      'needs-preview': 'No preview exists. Preview this page before approval.',
      unverified: 'Source timestamps are unavailable. Preview freshness cannot be confirmed for approval.',
    }[result.status] || result.message || '';
    this._updateItem(item.path, {
      ...result,
      pending,
      validationStatus: result.status,
      status: pending ? 'already-pending' : result.status,
      message: pending
        ? `A publish request is already pending for this page in your requests or approver inbox. ${pendingMessage}`.trim()
        : result.message,
    });
    return !pending && result.status === 'ready';
  }

  async handlePreview(items) {
    if (this._busy || !items.length) return;
    this._validating = true;
    this._message = null;
    try {
      await forEachLimited(items, async (item) => {
        this._updateItem(item.path, { status: 'previewing', message: '' });
        const result = await previewContent(this._org.trim(), this._site.trim(), item.path);
        if (!result.success) {
          this._updateItem(item.path, {
            status: item.pending ? 'already-pending' : 'error',
            validationStatus: 'error',
            message: item.pending ? `The publish request is still pending. ${result.error}` : result.error,
          });
        } else {
          await this._validateItem(item);
        }
      });
      const blocked = items.filter((item) => {
        const current = this._items.find((row) => row.path === item.path);
        return (current?.validationStatus || current?.status) !== 'ready';
      }).length;
      if (blocked) this._notify('error', `${blocked} preview(s) could not be confirmed current. Review the page results and validate again.`);
      else this._notify('success', 'Previews refreshed and source timestamps verified.');
    } catch (error) {
      this._notify('error', error.message);
    } finally {
      this._selectedPreviewPaths = new Set(this._selectedPreviewItems.map((item) => item.path));
      this._validating = false;
    }
  }

  async _processItem(item, comment) {
    const org = this._org.trim();
    const site = this._site.trim();

    this._updateItem(item.path, { status: 'checking', message: '' });
    if (!await this._validateItem(item)) return;

    this._updateItem(item.path, { status: 'submitting' });
    const result = await submitPublishRequest({
      org, site, path: item.path, comment,
    }, this.token);
    if (result.success) {
      this._updateItem(item.path, { status: 'submitted', message: 'Sent to approvers.', ambiguous: false });
    } else {
      console.error('[Request Publish Bulk] Submission failed', { path: item.path, message: result.message });
      this._updateItem(item.path, {
        status: 'failed',
        message: result.message,
        ambiguous: !!result.ambiguous,
      });
    }
  }

  async _run(targets) {
    const comment = this._comment.trim();
    const pending = await listPendingRequests(this._org.trim(), this._site.trim(), this.token);
    if (!pending.success) throw new Error(`Submission stopped: ${pending.error}`);
    const pendingPaths = new Set(pending.requests.map((request) => request.path));
    // The Worker writes a shared requests sheet; do not race concurrent submissions.
    await forEachLimited(targets, async (item) => {
      if (pendingPaths.has(item.path)) {
        await this._validateItem({ ...item, pending: true });
      } else {
        await this._processItem(item, comment);
      }
    }, 1);
  }

  async handleSubmit() {
    if (this._busy || this._submittable.length === 0) return;
    this._submitting = true;
    this._message = null;
    try {
      await this._run(this._submittable);
      this._summarize();
    } catch (error) {
      this._notify('error', error.message);
    } finally {
      this._submitting = false;
    }
  }

  async handleRetry() {
    if (this._busy || this._failed.length === 0) return;
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
        this._notify('error', `Retry stopped: ${pending.error} Checking the queue first avoids duplicate requests.`);
        return;
      }
    }

    try {
      await this._run(toRetry);
      this._summarize();
    } catch (error) {
      this._notify('error', error.message);
    } finally {
      this._submitting = false;
    }
  }

  _summarize() {
    const submitted = this._items.filter((i) => i.status === 'submitted').length;
    const failed = this._failed.length;
    const blocked = this._items.filter((item) => !['submitted', 'already-pending', 'ready'].includes(item.status)
      || (item.status === 'already-pending' && item.validationStatus !== 'ready')).length;
    if (blocked) {
      this._notify('warning', `${submitted} submitted, ${failed} submission(s) failed, ${blocked - failed} other page(s) need attention. Already-pending requests were skipped. Check pending requests before retrying notification failures.`);
    } else {
      this._notify('success', `${submitted} request${submitted === 1 ? '' : 's'} submitted. Already-pending requests were skipped.`);
    }
  }

  get _inboxUrl() {
    return `https://da.live/app/adobe-rnd/aem-apps/tools/apps/publish-requests-inbox/publish-requests-inbox?org=${encodeURIComponent(this._org)}&site=${encodeURIComponent(this._site)}&requester=true`;
  }

  renderItems() {
    if (!this._validated) return nothing;
    const previewable = this._previewable;
    const selectedCount = this._selectedPreviewItems.length;
    const allSelected = previewable.length > 0 && selectedCount === previewable.length;
    const previewablePaths = new Set(previewable.map((item) => item.path));
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
        ${previewable.length ? html`
          <div class="bulk-preview-actions">
            <label class="preview-option">
              <input type="checkbox" .checked=${allSelected}
                .indeterminate=${selectedCount > 0 && !allSelected} ?disabled=${this._busy}
                @change=${(event) => this.handleSelectPreviews(event.target.checked)}>
              <span>Select all pages needing preview</span>
            </label>
            <sl-button ?disabled=${this._busy || selectedCount === 0}
              @click=${() => this.handlePreview(this._selectedPreviewItems)}>
              Preview / refresh selected (${selectedCount})
            </sl-button>
          </div>` : nothing}
        <ul class="bulk-list" aria-label="Page validation results" aria-live="polite">
          ${this._items.map((i) => html`
            <li class="bulk-item bulk-${i.status}">
              <span class="bulk-path">${i.path}</span>
              <span class="bulk-status">
                ${STATUS_LABELS[i.status]}
                ${i.status === 'already-pending' && i.validationStatus ? html`
                  / ${i.validationStatus === 'ready' ? 'Preview current' : STATUS_LABELS[i.validationStatus]}
                ` : nothing}
              </span>
              ${i.message ? html`<span class="bulk-detail">${i.message}</span>` : nothing}
              ${i.sourceModified || i.previewModified ? html`
                <span class="bulk-detail">
                  Source saved: ${formatDate(i.sourceModified)}.
                  Preview generated: ${formatDate(i.previewModified)}.
                  Source included in preview: ${formatDate(i.previewSourceModified)}.
                </span>` : nothing}
              ${previewablePaths.has(i.path) ? html`
                <div class="bulk-preview-actions bulk-detail">
                  <label class="preview-option">
                    <input type="checkbox" .checked=${this._selectedPreviewPaths.has(i.path)}
                      aria-label=${`Select ${i.path} for preview`} ?disabled=${this._busy}
                      @change=${(event) => this.handlePreviewSelection(i.path, event.target.checked)}>
                    <span>Select for preview</span>
                  </label>
                </div>` : nothing}
            </li>
          `)}
        </ul>
      </section>
    `;
  }

  renderTranslations() {
    const total = this._projectEntries.length;
    const start = this._projectPage * PROJECT_PAGE_SIZE;
    const selectedCount = this._selectedDestinations.size;
    const allSelected = this._destinations.length > 0
      && selectedCount === this._destinations.length;
    return html`
      <section aria-label="Translation project" class="translation-panel">
        <p class="field-hint">Choose an active project. Translated or completed translations and completed copies or rollouts matching /&lt;lang&gt;/&lt;country&gt; can be validated. Language-only pages are excluded.</p>
        <p class="field-hint">Translations marked "save unconfirmed" have translation results but no confirmed save completion. Validate checks existing destination pages and preview freshness; it cannot prove those pages contain this project's latest translation.</p>
        <sl-button ?disabled=${this._busy} @click=${() => this.handleLoadProjects()}>
          Refresh projects
        </sl-button>
        <div class="project-picker" aria-busy=${this._loadingProjects ? 'true' : 'false'}>
          ${this._loadingProjects ? html`
            <p class="project-loading" role="status">
              <span class="project-spinner" aria-hidden="true"></span>
              Loading translation projects...
            </p>` : html`
          <fieldset ?disabled=${this._busy || !this._projects.length}>
            <legend>Translation project title</legend>
            <ul class="project-list">
            ${this._projects.map((project) => html`
              <li>
                <label class="project-option">
                  <input type="radio" name="translation-project" value=${project.path}
                    .checked=${this._projectPath === project.path} ?disabled=${!project.available}
                    @change=${() => this.handleProjectSelect(project.path)}>
                  <span>
                    <strong>${project.title}</strong>
                    <span class="project-meta">Modified: ${formatDate(project.lastModified)} - ${project.name}</span>
                    ${!project.available ? html`<span class="project-meta">${project.error || project.reason}</span>` : nothing}
                  </span>
                </label>
              </li>`)}
            </ul>
          </fieldset>`}
          ${total ? html`
            <nav class="project-pagination" aria-label="Translation project pages">
              <sl-button ?disabled=${this._busy || this._projectPage === 0}
                @click=${() => this.handleProjectPage(this._projectPage - 1)}>Previous</sl-button>
              <span role="status">Projects ${start + 1}-${Math.min(start + PROJECT_PAGE_SIZE, total)} of ${total}
                (page ${this._projectPage + 1} of ${this._projectPageCount})</span>
              <sl-button ?disabled=${this._busy || this._projectPage + 1 >= this._projectPageCount}
                @click=${() => this.handleProjectPage(this._projectPage + 1)}>Next</sl-button>
              ${this._projects.some((project) => project.error) ? html`
                <sl-button ?disabled=${this._busy}
                  @click=${() => this.handleProjectPage(this._projectPage)}>Reload page</sl-button>` : nothing}
            </nav>` : nothing}
        </div>
        ${this._project ? html`
          <fieldset ?disabled=${this._busy}>
            <legend>Translation destination folders</legend>
            <label class="destination-option destination-select-all">
              <input type="checkbox" .checked=${allSelected}
                .indeterminate=${selectedCount > 0 && !allSelected}
                ?disabled=${this._busy || this._destinations.length === 0}
                @change=${(event) => this.handleSelectDestinations(event.target.checked)}>
              <span>Select all destination folders</span>
            </label>
            ${this._destinations.map((destination) => html`
              <label class="destination-option">
                <input type="checkbox" .checked=${this._selectedDestinations.has(destination.id)}
                  @change=${(event) => this.handleDestinationChange(destination.id, event.target.checked)}>
                <span>${destination.label}: <code>${destination.location}</code> (${destination.paths.length} pages)</span>
              </label>`)}
          </fieldset>
          <p class="field-hint">Untranslated pages and incomplete copies or rollouts are excluded. Review the selected paths before validating.</p>
          <details open>
            <summary>Generated paths (${this._generatedPaths.length})</summary>
            <ul class="generated-paths">
              ${this._generatedPaths.map((path) => html`<li><code>${path}</code></li>`)}
            </ul>
          </details>` : nothing}
      </section>
    `;
  }

  render() {
    const busy = this._busy;
    const readyCount = this._submittable.length;
    const failedCount = this._failed.length;
    return html`
      <div class="bulk-app">
        <h1>Request Publish for Multiple Pages</h1>
        <p class="field-hint">Submits one pending request per page. Approvers review them in the Publish Requests inbox; nothing is published from here.</p>
        ${this._message ? html`<div class="message ${this._message.type}" role=${this._message.type === 'error' ? 'alert' : 'status'}>${this._message.text}</div>` : nothing}

        <div class="bulk-row">
          <div class="form-group">
            <label for="org">Organization</label>
            <sl-input id="org" .value=${this._org} ?disabled=${busy}
              @input=${(e) => this.handleSiteChange('_org', e.target.value)}></sl-input>
          </div>
          <div class="form-group">
            <label for="site">Site</label>
            <sl-input id="site" .value=${this._site} ?disabled=${busy}
              @input=${(e) => this.handleSiteChange('_site', e.target.value)}></sl-input>
          </div>
        </div>

        <fieldset class="flow-picker" ?disabled=${busy}>
          <legend>Choose how to add pages</legend>
          <label>
            <input type="radio" name="flow" value="paths" .checked=${this._flow === 'paths'}
              @change=${() => this.handleFlowChange('paths')}>
            Paste paths
          </label>
          <label>
            <input type="radio" name="flow" value="translations" .checked=${this._flow === 'translations'}
              @change=${() => this.handleFlowChange('translations')}>
            Translation project
          </label>
        </fieldset>

        ${this._flow === 'translations' ? this.renderTranslations() : html`<div class="form-group">
          <label for="paths">Page paths</label>
          <sl-textarea id="paths" rows="8" .value=${this._pathsText} ?disabled=${busy}
            placeholder="/fr/ca/home&#10;/fr/ca/products&#10;/de/de/home"
            @input=${(e) => { this._pathsText = e.target.value; this._resetValidation(); }}></sl-textarea>
          <span class="field-hint">One site-relative path per line.</span>
        </div>`}
        <p class="field-hint">Validate checks DA source existence and compares its last-saved timestamp with the source timestamp included in the preview. Missing or stale previews block that page until you explicitly preview it.</p>

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
