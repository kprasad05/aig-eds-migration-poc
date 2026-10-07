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
/* eslint-disable class-methods-use-this */
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { LitElement, html, nothing } from 'da-lit';

// DA Admin API base — source/publish endpoints for writing content
const DA_ADMIN = 'https://admin.da.live';

// CORS proxy — same as publish-requests-inbox; wraps external origins that
// do not allow the da.live iframe origin directly (e.g. *.aem.live index JSON).
const CORS_PROXY = 'https://da-etc.adobeaem.workers.dev/cors';

// daFetch ensures a fresh IMS token is used on every request (handles token expiry)
const { daFetch } = await import('https://da.live/nx/utils/daFetch.js');

// NX style pipeline — same as publish-requests-inbox
const NX = 'https://da.live/nx2';
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

// ---------------------------------------------------------------------------
// XML helpers (mirrors generate-video-sitemap.js logic)
// ---------------------------------------------------------------------------

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function isEmbedPlayerUrl(url) {
  return /youtube\.com|youtu\.be|vimeo\.com/i.test(url);
}

/**
 * Build a single <url> entry from a video-index row.
 * @param {Object} row - A row from /video-index.json
 * @param {string} host - The live host base URL (e.g. https://main--repo--org.aem.live)
 * @returns {string} XML string for the entry
 */
function buildEntry(row, host) {
  const loc = `${host}${row.path}`;
  const title = escapeXml(row.title || row.path);
  const description = escapeXml(row.description || row.title || '');

  // Prefer the video block's own poster image, then the page image.
  const rawThumbnail = row.videothumbnail || row.image || row.thumbnail;
  const thumbnail = rawThumbnail ? escapeXml(new URL(rawThumbnail, loc).href) : '';

  // YouTube/Vimeo: player_loc; direct file: content_loc
  const locTag = isEmbedPlayerUrl(row.videourl)
    ? `<video:player_loc allow_embed="yes">${escapeXml(row.videourl)}</video:player_loc>`
    : `<video:content_loc>${escapeXml(row.videourl)}</video:content_loc>`;

  return `  <url>
    <loc>${escapeXml(loc)}</loc>
    <video:video>
      <video:title>${title}</video:title>
      <video:description>${description}</video:description>
      ${locTag}
      <video:thumbnail_loc>${thumbnail}</video:thumbnail_loc>
    </video:video>
  </url>`;
}

/**
 * Generate the full video-sitemap.xml string from an array of video-index rows.
 * @param {Array} rows - Filtered rows (only those with a videourl)
 * @param {string} host - The live host base URL
 * @returns {string} Complete XML string
 */
function generateXml(rows, host) {
  const entries = rows.map((row) => buildEntry(row, host)).join('\n');
  return `<?xml version="1.0"?>
<urlset xmlns="https://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:video="https://www.google.com/schemas/sitemap-video/1.1">
${entries}
</urlset>
`;
}

// ---------------------------------------------------------------------------
// DA API helpers
// ---------------------------------------------------------------------------

/**
 * Fetch video-index.json from the live site.
 * Routed through the DA CORS proxy so the request works from the da.live
 * iframe origin (*.aem.live does not include da.live in its CORS allow-list).
 * @param {string} host - e.g. https://main--repo--org.aem.live
 * @returns {Promise<Array>} Array of rows with videourl set
 */
async function fetchVideoIndex(host) {
  const indexUrl = `${host}/video-index.json`;
  const proxiedUrl = `${CORS_PROXY}?url=${encodeURIComponent(indexUrl)}`;
  const resp = await daFetch(proxiedUrl);
  if (!resp.ok) throw new Error(`Failed to fetch ${indexUrl}: ${resp.status} ${resp.statusText}`);
  const { data } = await resp.json();
  return (data || []).filter((row) => row.videourl);
}

/**
 * Write the video-sitemap.xml to DA source via PUT.
 * DA source PUT: PUT https://admin.da.live/source/{org}/{repo}/video-sitemap.xml
 * @param {string} org
 * @param {string} repo
 * @param {string} xml - The XML content
 * @returns {Promise<Object>} { success, error? }
 */
async function writeSitemapToDa(org, repo, xml) {
  const url = `${DA_ADMIN}/source/${org}/${repo}/video-sitemap.xml`;
  const blob = new Blob([xml], { type: 'application/xml' });
  const formData = new FormData();
  formData.append('data', blob, 'video-sitemap.xml');

  try {
    const resp = await daFetch(url, {
      method: 'PUT',
      body: formData,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      return { success: false, error: `PUT failed (${resp.status}): ${text}` };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message || 'PUT request failed' };
  }
}

/**
 * Publish the video-sitemap.xml via DA Admin publish API.
 * POST https://admin.da.live/publish/{org}/{repo}/video-sitemap.xml
 * This makes the file live at https://{liveHost}/video-sitemap.xml
 * @param {string} org
 * @param {string} repo
 * @returns {Promise<Object>} { success, error? }
 */
async function publishSitemapInDa(org, repo) {
  const url = `${DA_ADMIN}/publish/${org}/${repo}/video-sitemap.xml`;
  try {
    const resp = await daFetch(url, { method: 'POST' });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      return { success: false, error: `Publish failed (${resp.status}): ${text}` };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message || 'Publish request failed' };
  }
}

// ---------------------------------------------------------------------------
// LitElement DA App
// ---------------------------------------------------------------------------

class VideoSitemapApp extends LitElement {
  static properties = {
    context: { attribute: false },
    token: { attribute: false },
    // States: 'loading' | 'idle' | 'generating' | 'success' | 'error'
    _state: { state: true },
    _message: { state: true },
    _org: { state: true },
    _repo: { state: true },
    _liveHost: { state: true },
    _entryCount: { state: true },
    _previewXml: { state: true },
    _showPreview: { state: true },
  };

  constructor() {
    super();
    this._state = 'loading';
    this._message = null;
    this._org = '';
    this._repo = '';
    this._liveHost = '';
    this._entryCount = 0;
    this._previewXml = '';
    this._showPreview = false;
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [nexter, sl, styles].filter(Boolean);
    this.init();
  }

  async init() {
    const { org, repo } = this.context || {};
    this._org = org || '';
    this._repo = repo || '';
    this._liveHost = `https://main--${this._repo}--${this._org}.aem.live`;
    this._state = 'idle';
  }

  // -------------------------------------------------------------------------
  // Action: Generate & Publish
  // -------------------------------------------------------------------------

  async handleGenerate() {
    if (this._state === 'generating') return;

    this._state = 'generating';
    this._message = null;
    this._previewXml = '';
    this._showPreview = false;

    // Allow the host override from the input field
    const input = this.shadowRoot.querySelector('#live-host');
    const host = (input?.value || '').trim() || this._liveHost;

    try {
      // Step 1: Fetch video index
      this._message = { type: 'info', text: `Fetching video index from ${host}/video-index.json …` };
      this.requestUpdate();

      let rows;
      try {
        rows = await fetchVideoIndex(host);
      } catch (fetchErr) {
        this._state = 'error';
        this._message = { type: 'error', text: `Could not fetch video index: ${fetchErr.message}` };
        return;
      }

      if (rows.length === 0) {
        this._state = 'idle';
        this._message = { type: 'info', text: 'No video entries found in video-index.json. Sitemap not updated.' };
        return;
      }

      // Step 2: Generate XML
      const xml = generateXml(rows, host);
      this._entryCount = rows.length;
      this._previewXml = xml;

      // Step 3: Write to DA source
      this._message = { type: 'info', text: `Writing video-sitemap.xml to DA (${rows.length} entries) …` };
      this.requestUpdate();

      const writeResult = await writeSitemapToDa(this._org, this._repo, xml);
      if (!writeResult.success) {
        this._state = 'error';
        this._message = { type: 'error', text: `Failed to save sitemap to DA: ${writeResult.error}` };
        return;
      }

      // Step 4: Publish via DA Admin
      this._message = { type: 'info', text: 'Publishing video-sitemap.xml …' };
      this.requestUpdate();

      const publishResult = await publishSitemapInDa(this._org, this._repo);
      if (!publishResult.success) {
        // File is saved in DA but publish failed — partial success
        this._state = 'error';
        this._message = {
          type: 'error',
          text: `Sitemap saved to DA but publish step failed: ${publishResult.error}. You can retry publish from DA.`,
        };
        return;
      }

      this._state = 'success';
      this._message = {
        type: 'success',
        text: `video-sitemap.xml updated and published — ${rows.length} video ${rows.length === 1 ? 'entry' : 'entries'}.`,
      };
    } catch (err) {
      console.error('Video sitemap generation error:', err);
      this._state = 'error';
      this._message = { type: 'error', text: err.message || 'An unexpected error occurred.' };
    }
  }

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------

  renderLoading() {
    return html`
      <div class="loading-container" role="status" aria-live="polite" aria-busy="true">
        <div class="spectrum-loading-indicator" aria-hidden="true"></div>
        <p class="loading-label">Loading…</p>
      </div>
    `;
  }

  renderMessage() {
    if (!this._message) return nothing;
    return html`<div class="message ${this._message.type}" role="status">${this._message.text}</div>`;
  }

  renderPreviewToggle() {
    if (!this._previewXml) return nothing;
    return html`
      <div class="preview-section">
        <button
          class="preview-toggle"
          @click=${() => { this._showPreview = !this._showPreview; }}
          aria-expanded=${this._showPreview}
        >
          <svg class="preview-chevron ${this._showPreview ? 'open' : ''}" viewBox="0 0 10 10" aria-hidden="true"><path d="M3 1l4 4-4 4"/></svg>
          ${this._showPreview ? 'Hide XML preview' : `Show XML preview (${this._entryCount} ${this._entryCount === 1 ? 'entry' : 'entries'})`}
        </button>
        ${this._showPreview ? html`<pre class="xml-preview">${this._previewXml}</pre>` : nothing}
      </div>
    `;
  }

  render() {
    if (this._state === 'loading') return this.renderLoading();

    const isGenerating = this._state === 'generating';
    const liveUrl = `https://${this._liveHost.replace(/^https?:\/\//, '')}/video-sitemap.xml`;

    return html`
      <div class="app-container">
        <header class="app-header">
          <h1 class="app-title">Video Sitemap Generator</h1>
          <p class="app-subtitle">
            Generates <code>video-sitemap.xml</code> from <code>/video-index.json</code>
            and publishes it via DA — no git commit required.
          </p>
        </header>

        <section class="config-card">
          <h2 class="card-title">Configuration</h2>
          <div class="detail-row">
            <span class="detail-label">Organization</span>
            <span class="detail-value"><code>${this._org}</code></span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Repository</span>
            <span class="detail-value"><code>${this._repo}</code></span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Live host</span>
            <span class="detail-value">
              <sl-input
                id="live-host"
                type="text"
                .value=${this._liveHost}
                placeholder="https://main--repo--org.aem.live"
                aria-label="Live host override"
              ></sl-input>
            </span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Output</span>
            <span class="detail-value">
              <a class="action-link" href="${liveUrl}" target="_blank" rel="noopener">${liveUrl}</a>
            </span>
          </div>
        </section>

        ${this.renderMessage()}
        ${this.renderPreviewToggle()}

        <div class="action-bar">
          <sl-button
            class="vs-fill-accent"
            @click=${this.handleGenerate}
            ?disabled=${isGenerating}
          >
            ${isGenerating ? 'Generating…' : '⟳ Generate & Publish Sitemap'}
          </sl-button>

          ${this._state === 'success' ? html`
            <a class="action-link" href="${liveUrl}" target="_blank" rel="noopener">
              <svg class="action-icon" viewBox="0 0 18 18"><path d="M15.5 1h-13A1.5 1.5 0 0 0 1 2.5v13A1.5 1.5 0 0 0 2.5 17h13a1.5 1.5 0 0 0 1.5-1.5v-13A1.5 1.5 0 0 0 15.5 1Zm.5 14.5a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5v-13a.5.5 0 0 1 .5-.5h13a.5.5 0 0 1 .5.5v13ZM13 4.5a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 0-.354.854L9.793 6.5 5.146 11.146a.5.5 0 0 0 .708.708L10.5 7.207l1.646 1.647A.5.5 0 0 0 13 8.5v-4Z"/></svg>
              View Published Sitemap
            </a>
          ` : nothing}
        </div>

        <section class="info-card">
          <h2 class="card-title">How it works</h2>
          <ol class="how-list">
            <li>Reads <code>/video-index.json</code> from the configured live host.</li>
            <li>Filters pages that have a <code>videourl</code> (set by the Video Feature block).</li>
            <li>Generates a Google Video Sitemap (XML) with <code>&lt;video:player_loc&gt;</code> for YouTube/Vimeo and <code>&lt;video:content_loc&gt;</code> for direct video files.</li>
            <li>Saves the XML to DA via <code>PUT /source/${this._org}/${this._repo}/video-sitemap.xml</code>.</li>
            <li>Publishes it via <code>POST /publish/${this._org}/${this._repo}/video-sitemap.xml</code> so it is served at <code>/video-sitemap.xml</code>.</li>
          </ol>
          <p class="info-note">
            <strong>No git commit is made.</strong>
            The sitemap lives entirely in DA and is served by AEM Edge Delivery from there.
          </p>
        </section>
      </div>
    `;
  }
}

customElements.define('video-sitemap-app', VideoSitemapApp);

(async function init() {
  const { context, token } = await DA_SDK;

  const cmp = document.createElement('video-sitemap-app');
  cmp.context = context;
  cmp.token = token;

  document.body.append(cmp);
}());
