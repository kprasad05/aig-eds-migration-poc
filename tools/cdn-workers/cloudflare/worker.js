/**
 * Cloudflare Worker — serves /video-sitemap.xml dynamically.
 *
 * SETUP
 * ─────
 * 1. Deploy this file as a Cloudflare Worker (via Wrangler or the dashboard).
 * 2. In wrangler.toml set the two environment variables below, or bind them as
 *    Worker Secrets in the Cloudflare dashboard:
 *
 *      [vars]
 *      AEM_LIVE_HOST = "https://main--aig-eds-migration-poc--kprasad05.aem.live"
 *
 * 3. Add a Worker Route that maps
 *      www.aig.com/video-sitemap.xml  →  this worker
 *    All other paths fall through to the existing AEM proxy logic (see below).
 *
 * WRANGLER QUICK-START
 * ─────────────────────
 *   npm install -g wrangler
 *   wrangler login
 *   wrangler deploy tools/cdn-workers/cloudflare/worker.js \
 *              --name aig-video-sitemap \
 *              --compatibility-date 2024-01-01
 *
 * If you already have a Cloudflare Worker acting as your AEM reverse proxy,
 * paste the `handleVideoSitemap` branch into that worker's fetch handler
 * instead of deploying a separate worker.
 */

// ── Configuration ──────────────────────────────────────────────────────────

/**
 * AEM Live preview host. Set via env var or wrangler.toml [vars] so you can
 * keep the same worker code across stage / production deployments.
 * Falls back to the hard-coded POC host when the env var is absent.
 */
const DEFAULT_AEM_LIVE_HOST = 'https://main--aig-eds-migration-poc--kprasad05.aem.live';

/** How long (in seconds) Cloudflare's edge caches the generated XML. */
const CACHE_TTL_SECONDS = 3600; // 1 hour

// ── XML helpers ─────────────────────────────────────────────────────────────

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

async function buildVideoSitemapXml(origin, aemLiveHost) {
  const indexUrl = `${aemLiveHost}/video-index.json?limit=1000`;
  const res = await fetch(indexUrl);
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

// ── Request handler ──────────────────────────────────────────────────────────

async function handleVideoSitemap(request, env) {
  const url = new URL(request.url);
  const origin = url.origin; // e.g. https://www.aig.com
  const aemLiveHost = (env && env.AEM_LIVE_HOST) || DEFAULT_AEM_LIVE_HOST;

  try {
    const xml = await buildVideoSitemapXml(origin, aemLiveHost);
    return new Response(xml, {
      status: 200,
      headers: {
        'content-type': 'application/xml; charset=utf-8',
        'cache-control': `public, max-age=${CACHE_TTL_SECONDS}`,
        // Allow Cloudflare to serve stale content for up to 24 h while
        // revalidating in the background — keeps latency low.
        'surrogate-control': `max-age=${CACHE_TTL_SECONDS}, stale-while-revalidate=86400`,
      },
    });
  } catch (err) {
    console.error('[video-sitemap] generation failed:', err.message);
    return new Response(`Internal Server Error: ${err.message}`, { status: 500 });
  }
}

/**
 * AEM reverse-proxy passthrough for all other requests.
 * If you already have your own AEM proxy worker, remove this function and
 * call handleVideoSitemap() from your existing fetch handler instead.
 */
async function handleAemProxy(request, env) {
  const url = new URL(request.url);
  const aemLiveHost = (env && env.AEM_LIVE_HOST) || DEFAULT_AEM_LIVE_HOST;
  const proxyUrl = `${aemLiveHost}${url.pathname}${url.search}`;

  const proxyRequest = new Request(proxyUrl, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    redirect: 'follow',
  });

  const res = await fetch(proxyRequest);
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}

// ── Entry point ───────────────────────────────────────────────────────────────

export default {
  /**
   * @param {Request} request
   * @param {{ AEM_LIVE_HOST?: string }} env
   */
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname === '/video-sitemap.xml') {
      return handleVideoSitemap(request, env);
    }

    // Pass everything else through to the AEM origin.
    return handleAemProxy(request, env);
  },
};
