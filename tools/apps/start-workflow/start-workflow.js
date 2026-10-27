/* eslint-disable import/no-unresolved, no-console */
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { LitElement, html, nothing } from 'da-lit';
import createClient from './api.js';
import { createProject, LOCALE_MODE, operationLabel } from './model.js';
import { runProject } from './workflow.js';
import { createWorkflowHandoffBatches } from '../request-publish-bulk/handoff.js';

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
    targetLocale: { state: true },
    overwriteConfirmed: { state: true },
    title: { state: true },
    running: { state: true },
    publishBatches: { state: true },
    publishError: { state: true },
  };

  constructor() {
    super();
    this.folder = '/en/fragments';
    this.pages = [];
    this.selected = new Set();
    this.targetIds = new Set();
    this.targetLocation = '';
    this.targetLocale = '';
    this.overwriteConfirmed = false;
    this.projects = [];
    this.busy = false;
    this.running = false;
    this.message = null;
    this.title = 'Fragments translation POC';
    this.stopRequested = false;
    this.publishBatches = [];
    this.publishError = '';
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
      this.config = await this.client.loadConfig();
      this.resetTargets();
      this.pages = await this.client.listPages(this.folder);
      this.projects = await this.client.listProjects();
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
    this.targetLocale = '';
    this.overwriteConfirmed = false;
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
    this.renderRoot.querySelector('dialog').showModal();
  }

  async execute(isNew) {
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
          <label for="target-location">Language / location</label>
            <select id="target-location" .value=${this.targetLocation} @change=${(event) => {
  this.targetLocation = event.target.value;
  this.targetLocale = '';
}}>
              <option value="">Choose a language / location</option>
              ${locations.map((location) => html`<option value=${location}>
                ${location.slice(1)} — ${targets.find((target) => target.location === location).name.split(' - ')[0]}
              </option>`)}
            </select>
          <label for="target-locale">Regional locale</label>
            <select id="target-locale" .value=${this.targetLocale} ?disabled=${!this.targetLocation}
              @change=${(event) => { this.targetLocale = event.target.value; }}>
              <option value="">Choose a regional locale</option>
              ${targets.filter((target) => target.location === this.targetLocation).map((target) => html`
                <option value=${target.id} ?disabled=${this.targetIds.has(target.id)}>
                  ${target.locale.split('/')[2]} — ${target.name} (${target.locale})
                </option>`)}
            </select>
          <button type="button" ?disabled=${!this.targetLocale || this.targetIds.has(this.targetLocale)}
            @click=${() => {
    this.targetIds = new Set([...this.targetIds, this.targetLocale]);
    this.targetLocale = '';
  }}>Add target locale</button>
          <ul class="paths">${selectedTargets.map((target) => html`
            <li>${target.name}: <code>${target.locale}</code> — ${operationLabel(target)}
              <button type="button" aria-label=${`Remove target ${target.locale}`} @click=${() => {
  this.targetIds = new Set([...this.targetIds].filter((id) => id !== target.id));
}}>Remove</button>
            </li>`)}</ul>
          <p>Targets come from the languages worksheet. English targets roll out without translation.
            Other languages roll out first, then translate. The /en language store itself is not a target.</p>
        </fieldset>
        <h3>3. Review destination paths</h3>
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
        <p role="note">Google translation may incur charges. Keep the app open. A different-language
          destination contains the source-language copy until translation is successfully saved.
          Failed or unfinished tasks are excluded from publish requests. Do not edit destinations
          or run another client against these paths during execution.</p>
        ${this.message?.error ? html`<p class="error" role="alert">${this.message.text}</p>` : nothing}
        <div class="actions">
          <button type="button" ?disabled=${this.busy}
            @click=${() => this.renderRoot.querySelector('dialog').close()}>Cancel</button>
          <button type="button" class="primary"
            ?disabled=${this.busy || !this.title.trim() || !this.targetIds.size || !this.overwriteConfirmed}
            @click=${() => this.execute(true)}>${this.busy ? 'Starting...' : 'Create project and run'}</button>
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
