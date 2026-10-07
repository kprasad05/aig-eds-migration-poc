/**
 * Fastly Compute@Edge — serves /video-sitemap.xml dynamically.
 *
 * SETUP
 * ─────
 * 1. Install the Fastly CLI:  npm install -g @fastly/cli
 * 2. From this directory run: fastly compute init  (choose JavaScript)
 *    Then replace the generated src/index.js with this file.
 * 3. In fastly.toml add a backend named "aem_origin":
 *
 *      [setup.backends]
 *      [setup.backends.aem_origin]
 *        address = "main--aig-eds-migration-poc--kprasad05.aem.live"
 *        port = 443
 *
 * 4. Deploy:  fastly compute publish
 *
 * HOW ROUTING WORKS
 * ─────────────────
 * A VCL service or a Compute service can live on the same Fastly service.
 * The simplest approach for an existing VCL service is to add a second
 * Compute service and route only /video-sitemap.xml to it via a custom VCL
 * `recv` condition:
 *
 *   if (req.url ~ "^/video-sitemap\.xml") {
 *     set req.backend = F_compute_service;
 *   }
 *
 * Alternatively, migrate the whole site to a single Compute service and use
 * the passthrough branch below for all other requests.
 */

// ── Configuration ─────────────────────────────────────────────────────────

const AEM_LIVE_HOST = 'https://main--aig-eds-migration-poc--kprasad05.aem.live';
const AEM_BACKEND_NAME = 'aem_origin'; // matches [setup.backends] in fastly.toml
const CACHE_TTL_SECONDS = 3600; // 1 hour

// ── XML helpers ────────────────────────────────────────────────────────────

function escapeXml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function isEmbedPlayerUrl(url) {
  return /youtube\.com|youtu\.be|vimeo\.com/i.test(url);
}

function buildEntry(row, origin) {
  const loc = `${origin}${row.path}`;
  const title = escapeXml(row.title || row.path);
  const description = escapeXml(row.description || row.title || '');

  const rawThumbnail = row.videothumbnail || row.image || '';
  const thumbnail = rawThumbnail ? escapeXml(new URL(rawThumbnail, loc).href) : '';

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

async function buildVideoSitemapXml(origin) {
  // Fetch from AEM Live via the named Fastly backend.
  // Using the full AEM_LIVE_HOST URL — Fastly resolves the backend by the
  // hostname in the URL when you pass { backend } in the fetch options.
  const indexUrl = `${AEM_LIVE_HOST}/video-index.json?limit=1000`;
  const res = await fetch(indexUrl, { backend: AEM_BACKEND_NAME });

  if (!res.ok) {
    throw new Error(`video-index.json fetch failed: ${res.status} (${indexUrl})`);
  }

  const { data } = await res.json();
  const videoRows = (data || []).filter((row) => row.videourl);
  const entries = videoRows.map((row) => buildEntry(row, origin)).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
${entries}
</urlset>
`;
}

// ── Entry point ─────────────────────────────────────────────────────────────

addEventListener('fetch', (event) => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const url = new URL(request.url);

  // ── Video sitemap route ──────────────────────────────────────────────────
  if (url.pathname === '/video-sitemap.xml') {
    const origin = `${url.protocol}//${url.host}`;
    try {
      const xml = await buildVideoSitemapXml(origin);
      return new Response(xml, {
        status: 200,
        headers: {
          'content-type': 'application/xml; charset=utf-8',
          // Fastly Surrogate-Control drives edge caching; Cache-Control tells
          // downstream caches (browser, CDN shield).
          'surrogate-control': `max-age=${CACHE_TTL_SECONDS}`,
          'cache-control': `public, max-age=${CACHE_TTL_SECONDS}`,
          // Surrogate-Key lets you purge just the sitemap via the Fastly API:
          //   fastly purge --service-id=<id> --key=video-sitemap
          'surrogate-key': 'video-sitemap',
        },
      });
    } catch (err) {
      return new Response(`Internal Server Error: ${err.message}`, {
        status: 500,
        headers: { 'content-type': 'text/plain' },
      });
    }
  }

  // ── Passthrough — forward everything else to the AEM origin ─────────────
  // Remove the production Host header so AEM Live can resolve the correct
  // site; it uses the hostname of its own URL instead.
  const proxyHeaders = new Headers(request.headers);
  proxyHeaders.set('host', 'main--aig-eds-migration-poc--kprasad05.aem.live');

  const proxyRequest = new Request(
    `${AEM_LIVE_HOST}${url.pathname}${url.search}`,
    {
      method: request.method,
      headers: proxyHeaders,
      body: request.body,
    },
  );

  return fetch(proxyRequest, { backend: AEM_BACKEND_NAME });
}
