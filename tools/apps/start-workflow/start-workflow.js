/* eslint-disable import/no-unresolved, no-console */
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { LitElement, html, nothing } from 'da-lit';
import createClient from './api.js';
import { createProject, LOCALE_MODE, operationLabel } from './model.js';
import { runProject } from './workflow.js';
import { createWorkflowHandoffBatches } from '../request-publish-bulk/handoff.js';
import createBackgroundClient, { allCountryTargets, backgroundJobId } from './background.js';

const STYLE = new URL('./start-workflow.css', import.meta.url).href;

function translationStatus(item) {
  if (!item.translate) return 'not required (same language)';
  if (item.status === 'complete') return 'saved';
  return item.status === 'translating' ? 'in progress' : 'not yet saved';
}

class StartWorkflowApp extends LitElement {
  static properties = {
    org: {},
    site: {},
    folder: { state: true },
    pages: { state: true },
    selected: { state: true },
    config: { state: true },
    busy: { state: true },
    message: { state: true },
    project: { state: true },
    projects: { state: true },
    targetIds: { state: true },
    targetLocation: { state: true },
    overwriteConfirmed: { state: true },
    title: { state: true },
    running: { state: true },
    publishBatches: { state: true },
    publishError: { state: true },
    allCountries: { state: true },
    backgroundJob: { state: true },
    backgroundId: { state: true },
    backgroundBatches: { state: true },
  };

  constructor() {
    super();
    this.folder = '/en/fragments';
    this.pages = [];
    this.selected = new Set();
    this.targetIds = new Set();
    this.targetLocation = '';
    this.overwriteConfirmed = false;
    this.projects = [];
    this.busy = false;
    this.running = false;
    this.message = null;
    this.title = 'Fragments translation POC';
    this.stopRequested = false;
    this.publishBatches = [];
    this.publishError = '';
    this.allCountries = false;
    this.backgroundJob = null;
    this.backgroundId = '';
    this.backgroundBatches = [];
    this.guardUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.stopRequested = true;
    window.removeEventListener('beforeunload', this.guardUnload);
  }

  async perform(action) {
    this.busy = true;
    this.message = null;
    try {
      await action();
    } catch (error) {
      console.error('[Start Workflow]', error.message);
      this.message = { error: true, text: error.message };
    } finally {
      this.busy = false;
    }
  }

  async initialize(token) {
    await this.perform(async () => {
      this.client = createClient(this.org, this.site, token);
      this.backgroundClient = createBackgroundClient(this.org, this.site, token);
      this.config = await this.client.loadConfig();
      this.resetTargets();
      this.pages = await this.client.listPages(this.folder);
      this.projects = await this.client.listProjects();
      const backgroundId = new URLSearchParams(window.location.search).get('backgroundJob');
      if (backgroundId) {
        this.backgroundId = backgroundId;
        this.backgroundJob = await this.backgroundClient.status(backgroundId);
      }
    });
  }

  async browse(folder) {
    await this.perform(async () => {
      const pages = await this.client.listPages(folder);
      this.pages = pages;
      this.folder = folder;
    });
  }

  select(path, checked) {
    const selected = new Set(this.selected);
    if (checked) selected.add(path);
    else selected.delete(path);
    this.selected = selected;
  }

  resetTargets() {
    this.targetIds = new Set();
    this.targetLocation = '';
    this.overwriteConfirmed = false;
    this.allCountries = false;
    this.submissionId = null;
  }

  selectTarget(id, checked) {
    this.allCountries = false;
    this.overwriteConfirmed = false;
    this.submissionId = null;
    const ids = new Set(this.targetIds);
    if (checked) ids.add(id);
    else ids.delete(id);
    this.targetIds = ids;
  }

  selectAllCountries(checked) {
    this.allCountries = checked;
    this.targetIds = checked ? allCountryTargets(this.config) : new Set();
    this.overwriteConfirmed = false;
    this.submissionId = null;
    this.closeLocalePicker();
  }

  async executeBackground() {
    await this.perform(async () => {
      if (!this.overwriteConfirmed) throw new Error('Confirm the destination overwrite warning first.');
      this.submissionId ||= crypto.randomUUID();
      const id = await backgroundJobId(this.submissionId, this.org, this.site);
      this.backgroundId = id;
      const url = new URL(window.location.href);
      url.searchParams.set('backgroundJob', id);
      window.history.replaceState(null, '', url);
      this.backgroundBatches = [];
      this.project = null;
      this.publishBatches = [];
      this.publishError = '';
      this.backgroundJob = await this.backgroundClient.submit({
        requestId: this.submissionId,
        title: this.title,
        paths: [...this.selected],
        config: this.config,
        overwriteConfirmed: this.overwriteConfirmed,
      });
      this.submissionId = null;
      this.renderRoot.querySelector('dialog').close();
      this.message = {
        text: 'App Builder accepted the background workflow. You can close this tab after saving its job ID or bookmarking this URL. Retrieve or refresh progress later. Nothing is published automatically.',
      };
    });
  }

  async retrieveBackground(id, offset = 0) {
    await this.perform(async () => {
      this.backgroundBatches = [];
      this.backgroundJob = await this.backgroundClient.status(id, offset);
      this.backgroundId = id;
      this.message = { text: 'Persisted App Builder progress loaded. No rollout, translation or publishing was requested.' };
    });
  }

  async prepareBackgroundHandoff() {
    await this.perform(async () => {
      const paths = await this.backgroundClient.completedPaths(this.backgroundJob.jobId);
      const id = this.backgroundJob.jobId;
      this.backgroundBatches = paths.length ? createWorkflowHandoffBatches({
        org: this.org,
        site: this.site,
        workflowId: `workflow-${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`,
        paths,
        version: 2,
        location: window.location,
      }) : [];
      this.message = { text: `${paths.length} confirmed saves included. Opening a publish request still requires human review; nothing has been published.` };
    });
  }

  closeLocalePicker() {
    this.renderRoot.querySelector('.locale-picker').open = false;
  }

  updatePublishHandoff() {
    this.publishBatches = [];
    this.publishError = '';
    try {
      const paths = [...new Set(this.project.workflow.items
        .filter((item) => item.status === 'complete')
        .map((item) => item.destination.replace(/\.html$/, '')))];
      this.publishBatches = paths.length ? createWorkflowHandoffBatches({
        org: this.org,
        site: this.site,
        workflowId: this.project.id,
        paths,
        version: this.project.workflow.mode === LOCALE_MODE ? 2 : 1,
        location: window.location,
      }) : [];
    } catch (error) {
      console.error('[Start Workflow] Publish handoff:', error.message);
      this.publishError = error.message;
    }
  }

  async openWizard() {
    this.message = null;
    this.overwriteConfirmed = false;
    await this.updateComplete;
    this.closeLocalePicker();
    this.renderRoot.querySelector('dialog').showModal();
  }

  async execute(isNew) {
    if (isNew && this.allCountries) {
      await this.executeBackground();
      return;
    }
    await this.perform(async () => {
      if (isNew && !this.overwriteConfirmed) throw new Error('Confirm that existing destination content will be overwritten.');
      if (!navigator.locks) throw new Error('This POC requires a browser supporting the Web Locks API, such as current Chrome.');
      await navigator.locks.request(`da-workflow:${this.org}/${this.site}`, { ifAvailable: true }, async (lock) => {
        if (!lock) throw new Error('Another workflow is running in this browser for this site. Pause it first.');
        this.publishBatches = [];
        this.publishError = '';
        this.running = true;
        this.stopRequested = false;
        window.addEventListener('beforeunload', this.guardUnload);
        try {
          this.config = await this.client.loadConfig();
          if (isNew) {
            this.project = await createProject({
              org: this.org,
              site: this.site,
              title: this.title,
              paths: [...this.selected],
              targetIds: [...this.targetIds],
              config: this.config,
              readSource: this.client.readSource,
            });
          } else {
            this.project = await this.client.loadProject(this.project.id);
          }
          this.renderRoot.querySelector('dialog').close();
          const io = {
            ...this.client,
            translate: (content, code) => this.client.translate(content, code, this.config.sheets),
          };
          await runProject(this.project, this.config, io, {
            shouldStop: () => this.stopRequested,
            onChange: () => this.requestUpdate(),
          });
          this.requestUpdate();
          const complete = this.project.workflow.status === 'complete';
          this.message = {
            error: !complete && !this.stopRequested,
            text: complete
              ? 'All destinations were saved. Continue to Publish Request when ready. Nothing was previewed or published.'
              : 'Execution stopped. Progress is saved in DA. Review task details; resume retries only unfinished, unblocked tasks.',
          };
        } finally {
          this.running = false;
          if (this.project) this.updatePublishHandoff();
          window.removeEventListener('beforeunload', this.guardUnload);
        }
      });
    });
  }

  async retrieve(id) {
    await this.perform(async () => {
      this.project = await this.client.loadProject(id);
      this.updatePublishHandoff();
      this.message = { text: 'Saved progress loaded. Execution does not resume automatically. No content was written.' };
    });
  }

  renderWizard() {
    const targets = this.config?.targets || [];
    const locations = [...new Set(targets.map((target) => target.location))];
    const selectedTargets = targets.filter((target) => this.targetIds.has(target.id));
    const regionalTargets = targets.filter((target) => target.location === this.targetLocation);
    const regionalCount = regionalTargets.filter((target) => this.targetIds.has(target.id)).length;
    const startLabel = this.allCountries ? 'Start App Builder background job' : 'Create project and run';
    return html`
      <dialog aria-labelledby="wizard-title" @cancel=${(event) => {
    if (this.busy) event.preventDefault();
  }}>
        <h2 id="wizard-title">Start translation workflow</h2>
        <fieldset ?disabled=${this.busy}>
          <legend>1. Name this project</legend>
          <label>Project title
            <input required maxlength="120" .value=${this.title}
              @input=${(event) => { this.title = event.target.value; }}>
          </label>
        </fieldset>
        <fieldset ?disabled=${this.busy}>
          <legend>2. Choose target languages and locales</legend>
          <label class="option">
            <input type="checkbox" .checked=${this.allCountries}
              @change=${(event) => this.selectAllCountries(event.target.checked)}>
            All Countries (${targets.length} configured regional locales)
          </label>
          <p>All Countries selects every eligible locale across languages for this site and runs
            rollout and translation in App Builder. It does not include other sites or the language-store roots.</p>
          <label for="target-location">Language / location</label>
            <select id="target-location" .value=${this.targetLocation} @change=${(event) => {
  this.targetLocation = event.target.value;
  this.closeLocalePicker();
}}>
              <option value="">Choose a language / location</option>
              ${locations.map((location) => html`<option value=${location}>
                ${location.slice(1)} — ${targets.find((target) => target.location === location).name.split(' - ')[0]}
              </option>`)}
            </select>
          <div id="target-locales-label">Regional locales</div>
          <details class="locale-picker" @keydown=${(event) => {
    if (event.key === 'Escape' && event.currentTarget.open) {
      event.preventDefault();
      event.stopPropagation();
      this.closeLocalePicker();
      event.currentTarget.querySelector('summary').focus();
    }
  }}>
            <summary aria-disabled=${this.busy || !this.targetLocation}
              tabindex=${this.busy || !this.targetLocation ? -1 : 0}
              @click=${(event) => {
    if (this.busy || !this.targetLocation) event.preventDefault();
  }}>${this.targetLocation
  ? `Choose regional locales (${regionalCount} selected)` : 'Choose a language / location first'}</summary>
            <div class="locale-options" role="group" aria-labelledby="target-locales-label">
              ${regionalTargets.map((target) => html`
                <label class="option">
                  <input type="checkbox" value=${target.id} .checked=${this.targetIds.has(target.id)}
                    @change=${(event) => this.selectTarget(target.id, event.target.checked)}>
                  ${target.locale.split('/')[2]} — ${target.name} (${target.locale})
                </label>`)}
            </div>
          </details>
          <p>Tick multiple locales to add them immediately; untick to remove.
            Selections are kept when you switch languages.</p>
          <ul class="paths">${selectedTargets.map((target) => html`
            <li>${target.name}: <code>${target.locale}</code> — ${operationLabel(target)}
              <button type="button" aria-label=${`Remove target ${target.locale}`}
                @click=${() => this.selectTarget(target.id, false)}>Remove</button>
            </li>`)}</ul>
          <p>Targets come from the languages worksheet. English targets roll out without translation.
            Other languages roll out first, then translate. The /en language store itself is not a target.</p>
        </fieldset>
        <h3>3. Review destination paths</h3>
        <p>${this.selected.size} source pages x ${selectedTargets.length} regional locales =
          ${this.selected.size * selectedTargets.length} destination tasks.</p>
        ${this.allCountries ? html`<p>Up to
          ${this.selected.size * selectedTargets.filter((target) => target.translate).length}
          Google translation requests for these supported sources. English destinations roll out only.
          No automatic translation retries.</p>` : nothing}
        <ul class="paths">
          ${[...this.selected].flatMap((path) => selectedTargets
    .map((target) => html`<li><code>${path}</code> → <code>${target.locale}${path.slice(3)}</code>
      — ${operationLabel(target)}</li>`))}
        </ul>
        <p class="error" role="note"><strong>Warning: existing destination content will be overwritten.</strong>
          This includes local edits and previous translations at the selected destination paths.
          Missing destinations will be created. Nothing will be published automatically.</p>
        <label class="option">
          <input type="checkbox" .checked=${this.overwriteConfirmed} ?disabled=${this.busy}
            @change=${(event) => { this.overwriteConfirmed = event.target.checked; }}>
          I understand that existing destination content will be overwritten.
        </label>
        <p role="note">Google translation may incur charges.
          ${this.allCountries ? 'App Builder runs after submission; you can close the app once the job is accepted.' : 'Keep the app open.'} A different-language
          destination contains the source-language copy until translation is successfully saved.
          Failed or unfinished tasks are excluded from publish requests. Do not edit destinations
          or run another client against these paths during execution.</p>
        ${this.allCountries ? html`<p role="note">Background POC: simple text and hero-banner documents only,
          at most 10 text segments and a 5,000-character translation envelope per source.
          Unsupported blocks, metadata, regional-diff markup and non-empty native DA rules are
          rejected before any writes. The service account needs configuration/source read and
          destination write access. Progress is kept for 30 days; uncertain tasks require review.</p>` : nothing}
        ${this.message?.error ? html`<p class="error" role="alert">${this.message.text}</p>` : nothing}
        <div class="actions">
          <button type="button" ?disabled=${this.busy}
            @click=${() => this.renderRoot.querySelector('dialog').close()}>Cancel</button>
          <button type="button" class="primary"
            ?disabled=${this.busy || !this.title.trim() || !this.targetIds.size || !this.overwriteConfirmed}
            @click=${() => this.execute(true)}>${this.busy ? 'Starting...' : startLabel}</button>
        </div>
      </dialog>
    `;
  }

  renderProject() {
    if (!this.project) return nothing;
    const { project } = this;
    const { items } = project.workflow;
    const complete = items.filter((item) => item.status === 'complete').length;
    const retryable = items.some((item) => item.status !== 'complete' && item.status !== 'needs-review');
    return html`
      <section aria-labelledby="progress-title">
        <h2 id="progress-title">${project.title}</h2>
        <p>Workflow ID: <code>${project.id}</code></p>
        <p role="status">${complete}/${items.length} destinations saved.
          ${this.running ? 'Running in this app.' : 'Not running. Saved progress is shown.'}</p>
        <p>Confirmed saves are skipped on retry. Uncertain saves are checked first.
          Retrying an interrupted translation may call Google again and incur another charge.
          Needs-review tasks are blocked; resolve them manually and create a new project.</p>
        <div class="actions">
          <button ?disabled=${this.busy} @click=${() => this.retrieve(project.id)}>Reload saved progress</button>
          <button ?disabled=${this.busy || !retryable}
            @click=${() => this.execute(false)}>Resume / retry unfinished tasks</button>
          ${this.running ? html`<button @click=${() => {
    this.stopRequested = true;
    this.message = { text: 'Pausing after the current task finishes and its progress is saved...' };
  }}>Pause after current task</button>` : nothing}
        </div>
        <div class="table-scroll">
          <table>
            <caption>Per-page and target-language progress</caption>
            <thead><tr><th scope="col">Source → destination</th><th scope="col">Status</th>
              <th scope="col">Attempts</th><th scope="col">Stages and details</th>
              <th scope="col">Destination</th></tr></thead>
            <tbody>${items.map((item) => html`
              <tr>
                <td><code>${item.source}</code><br>→ <code>${item.destination}</code></td>
                <td>${!this.running && ['rolling-out', 'translating', 'saving'].includes(item.status)
    ? `${item.status} (interrupted; retry to reconcile)` : item.status}</td>
                <td>${item.attempts}</td>
                <td>${item.error || (item.status === 'complete' ? 'Saved; human review required.' : '')}
                  ${project.workflow.mode === LOCALE_MODE ? html`
                    <small>Rollout: ${item.rolloutStatus}</small>
                    <small>Translation: ${translationStatus(item)}</small>` : nothing}
                  <small>Source SHA-256: ${item.sourceHash.slice(0, 12)}...</small>
                  ${item.savedDate ? html`<small>Save verified: ${new Date(item.savedDate).toLocaleString()}</small>` : nothing}
                </td>
                <td>${item.status === 'complete' ? html`
                  <a href=${`https://da.live/edit#/${this.org}/${this.site}${item.destination.replace(/\.html$/, '')}`}
                    target="_blank" rel="noopener noreferrer"
                    aria-label=${`Open ${item.destination} in DA`}>Open in DA</a>
                  <small>Included in publish-request handoff.</small>` : 'Available after a confirmed save.'}</td>
              </tr>`)}</tbody>
          </table>
        </div>
        <h3>Next: request publish approval</h3>
        <p>All successfully processed and confirmed-saved destinations are automatically included.
          Failed and unfinished destinations are excluded. Review content in DA or during approval;
          no Reviewed checkboxes are required to continue.</p>
        <p>Continue opens the existing publish-request app in a new tab with the completed paths.
          It does not preview, submit requests, send emails, or publish automatically.
          In that app, validate, explicitly preview where needed, then choose Request Publish.
          Submitting requests uses the production approval service by default and can send real emails.</p>
        <div class="actions">
          ${this.publishBatches.length && !this.busy ? this.publishBatches.map((batch, index) => html`
            <a class="primary" href=${batch.url} target="_blank" rel="noopener noreferrer">
              Continue to Publish Request (${batch.count})${this.publishBatches.length > 1
  ? ` — batch ${index + 1} of ${this.publishBatches.length}` : ''}
            </a>`) : html`<button disabled>Continue to Publish Request (0)</button>`}
        </div>
        ${this.publishBatches.length > 1 ? html`<p>Open each batch to transfer all completed destinations.
          Batches respect the publish-request URL and 50-path limits; no paths are dropped.</p>` : nothing}
        ${this.publishError ? html`<p class="error" role="alert">${this.publishError}</p>` : nothing}
      </section>
    `;
  }

  renderBackground() {
    const job = this.backgroundJob;
    return html`
      <section aria-labelledby="background-title">
        <h2 id="background-title">App Builder background workflows</h2>
        <p>Jobs belong to the submitting Adobe user and are retained for 30 days. Save the job ID
          or bookmark the app URL before leaving. Refreshing progress never restarts execution.</p>
        <form @submit=${(event) => {
    event.preventDefault();
    this.retrieveBackground(this.backgroundId.trim());
  }}>
          <label>Background job ID
            <input required .value=${this.backgroundId} ?disabled=${this.busy}
              @input=${(event) => { this.backgroundId = event.target.value; }}>
          </label>
          <button ?disabled=${this.busy}>Retrieve background progress</button>
        </form>
        ${job ? html`
          <h3>${job.title}</h3>
          <p>Job ID: <code>${job.jobId}</code></p>
          <p role="status">${job.completed}/${job.total} destinations saved. Status: ${job.status}.
            Stage: ${job.stage}. Execution is in App Builder, not this tab.</p>
          ${job.error ? html`<p class="error" role="alert">${job.error}</p>` : nothing}
          <div class="actions">
            <button ?disabled=${this.busy} @click=${() => this.retrieveBackground(job.jobId, job.offset)}>Refresh background progress</button>
            <button ?disabled=${this.busy || !['queued', 'running'].includes(job.status)}
              @click=${() => this.perform(async () => {
    this.backgroundJob = await this.backgroundClient.recover(job.jobId);
    this.message = { text: 'Recovery checked. Active or uncertain work is never replayed. Review the saved status.' };
  })}>Recover queued dispatch / inspect worker</button>
            <button ?disabled=${this.busy || !job.completed}
              @click=${() => this.prepareBackgroundHandoff()}>Prepare publish request for confirmed saves</button>
          </div>
          <ul class="paths">${job.items.map((item) => html`
            <li><code>${item.source}</code> → <code>${item.destination}</code>: ${item.status}
              ${item.status === 'complete' ? html`
                <a href=${`https://da.live/edit#/${this.org}/${this.site}${item.destination.replace(/\.html$/, '')}`}
                  target="_blank" rel="noopener noreferrer">Open saved document in DA</a>` : nothing}
            </li>`)}</ul>
          <div class="actions">
            <button ?disabled=${this.busy || !job.offset}
              @click=${() => this.retrieveBackground(job.jobId, Math.max(0, job.offset - 50))}>Previous destinations</button>
            <button ?disabled=${this.busy || job.nextOffset === null}
              @click=${() => this.retrieveBackground(job.jobId, job.nextOffset)}>Next destinations</button>
          </div>
          ${this.backgroundBatches.map((batch, index) => html`<p>
            <a href=${batch.url} target="_blank" rel="noopener noreferrer">Review Publish Request batch ${index + 1} (${batch.count})</a>
          </p>`)}
        ` : nothing}
      </section>
    `;
  }

  render() {
    const visiblePages = this.pages.filter((page) => !page.folder);
    const allSelected = visiblePages.length > 0
      && visiblePages.every((page) => this.selected.has(page.path));
    return html`
      <link rel="stylesheet" href=${STYLE}>
      <main class="workflow-app">
        <h1>Start Translation Workflow</h1>
        <p><strong>${this.org} / ${this.site}</strong> · English → configured regional locales · Google where translation is needed</p>
        <p class="notice">Interactive POC: keep this app open while running. Closing it stops execution.
          Progress is saved in DA and can be retrieved later. Nothing is published.</p>
        ${this.message ? html`
          <p class=${this.message.error ? 'error' : 'notice'}
            role=${this.message.error ? 'alert' : 'status'}>${this.message.text}</p>` : nothing}
        <button ?disabled=${this.busy} @click=${() => this.perform(async () => {
  this.config = await this.client.loadConfig();
  this.resetTargets();
  this.message = { text: 'Translation configuration loaded.' };
})}>Reload translation configuration</button>
        <section aria-labelledby="browse-title">
          <h2 id="browse-title">1. Select source pages or fragments</h2>
          <fieldset ?disabled=${this.busy || !this.config}>
            <legend>Browse English content</legend>
            <form @submit=${(event) => {
    event.preventDefault();
    this.browse(event.target.elements.folder.value);
  }}>
              <label>Source folder
                <input name="folder" .value=${this.folder} required aria-describedby="folder-hint">
              </label>
              <button>Browse folder</button>
            </form>
            <p id="folder-hint">Start with /en/fragments. Browse other /en folders for pages.
              Selections are kept across folders (maximum 25 pages).</p>
            <label class="option">
              <input type="checkbox" .checked=${allSelected}
                .indeterminate=${!allSelected && visiblePages.some((page) => this.selected.has(page.path))}
                ?disabled=${!visiblePages.length}
                @change=${(event) => {
    const selected = new Set(this.selected);
    visiblePages.forEach((page) => {
      if (event.target.checked) selected.add(page.path);
      else selected.delete(page.path);
    });
    this.selected = selected;
  }}>Select all pages in this folder
            </label>
            <ul class="page-list">
              ${this.pages.map((page) => html`<li>${page.folder
    ? html`<button type="button" @click=${() => this.browse(page.path)}>Open folder: ${page.name}</button>`
    : html`<label class="option"><input type="checkbox" .checked=${this.selected.has(page.path)}
                    @change=${(event) => this.select(page.path, event.target.checked)}>
                    <code>${page.path}</code></label>`}</li>`)}
            </ul>
            ${!this.pages.length ? html`<p>No HTML pages or folders loaded.</p>` : nothing}
          </fieldset>
          <h3>Selected pages (${this.selected.size})</h3>
          <ul class="paths">${[...this.selected].map((path) => html`
            <li><code>${path}</code>
              <button ?disabled=${this.busy} aria-label=${`Remove ${path}`}
                @click=${() => this.select(path, false)}>Remove</button></li>`)}</ul>
          <div class="actions">
            <button ?disabled=${this.busy || !this.selected.size}
              @click=${() => { this.selected = new Set(); }}>Clear selection</button>
            <button class="primary"
              ?disabled=${this.busy || !this.config || !this.selected.size || this.selected.size > 25}
              @click=${() => this.openWizard()}>Start Workflow (${this.selected.size})</button>
          </div>
        </section>
        ${this.renderProject()}
        ${this.renderBackground()}
        <section aria-labelledby="history-title">
          <h2 id="history-title">Retrieve saved workflows</h2>
          <p>Only projects created by this app are listed. Visibility follows DA permissions.</p>
          <button ?disabled=${this.busy} @click=${() => this.perform(async () => {
  this.projects = await this.client.listProjects();
  this.message = { text: `${this.projects.length} saved workflows found.` };
})}>Refresh saved workflows</button>
          <ul class="history">${this.projects.map((entry) => html`
            <li><button ?disabled=${this.busy}
              @click=${() => this.retrieve(entry.id)}>${entry.id}</button>
              ${entry.modified ? new Date(entry.modified).toLocaleString() : ''}</li>`)}</ul>
          <form @submit=${(event) => {
    event.preventDefault();
    this.retrieve(event.target.elements.workflowId.value.trim());
  }}>
            <label>Workflow ID <input name="workflowId" required ?disabled=${this.busy}></label>
            <button ?disabled=${this.busy}>Retrieve workflow</button>
          </form>
        </section>
        ${this.renderWizard()}
      </main>
    `;
  }
}

customElements.define('start-workflow-app', StartWorkflowApp);

async function init() {
  const loading = document.getElementById('loading');
  try {
    const { context, token } = await DA_SDK;
    const params = new URLSearchParams(window.location.search);
    const app = document.createElement('start-workflow-app');
    app.org = params.get('org') || context?.org;
    app.site = params.get('site') || context?.repo;
    document.body.append(app);
    loading.remove();
    await app.initialize(token);
  } catch (error) {
    console.error('[Start Workflow] Initialization failed:', error.message);
    loading.setAttribute('role', 'alert');
    loading.textContent = `Could not initialize the app: ${error.message}. Open it inside DA while signed in.`;
  }
}

init();
