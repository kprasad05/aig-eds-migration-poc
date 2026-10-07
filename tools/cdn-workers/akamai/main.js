/**
 * Akamai EdgeWorkers — serves /video-sitemap.xml dynamically.
 *
 * REQUIREMENTS
 * ────────────
 * • EdgeWorkers entitlement on your Akamai contract.
 * • The property must have the "EdgeWorkers" behavior enabled.
 * • Node.js 18+ for local bundling (esbuild or webpack to bundle into one file
 *   because EdgeWorkers does not support ES-module imports from other files at
 *   runtime).
 *
 * SETUP IN PROPERTY MANAGER
 * ─────────────────────────
 * 1. Create an EdgeWorker ID in the Akamai Control Center
 *    (EdgeWorkers → Create EdgeWorker).
 * 2. Bundle this file with the manifest (edgeworker.json) and upload the zip:
 *      zip edgeworker.zip main.js edgeworker.json
 *      akamai edgeworkers upload --bundle=edgeworker.zip --edgeworker-id=<ID>
 * 3. In Property Manager add a match condition on the delivery property:
 *      Path matches:  /video-sitemap.xml
 *    Add these behaviors to that rule:
 *      • "EdgeWorkers" behavior — pick your EdgeWorker ID.
 *      • "Origin Server" behavior — set origin to
 *          main--aig-eds-migration-poc--kprasad05.aem.live  (port 443, TLS on).
 * 4. For all other paths, keep the existing AEM origin behavior.
 *
 * CACHING
 * ───────
 * The response sets Surrogate-Control so Akamai caches at the edge for 1 hour.
 * To purge manually:
 *   akamai purge invalidate --cpcode <cpcode>   (fastest)
 *   or use the Fast Purge API tag "video-sitemap".
 *
 * NOTE ON httpRequest
 * ────────────────────
 * EdgeWorkers' `httpRequest` resolves against the property's configured origin,
 * not the public internet. The URL below uses the AEM Live hostname directly,
 * which works as long as the origin for the matched rule points at aem.live.
 * If your property uses a different origin for the sitemap rule, change the
 * path to a relative one:  '/video-index.json?limit=1000'
 */

// EdgeWorkers runtime globals — available without import.
// eslint-disable-next-line import/no-unresolved
import { httpRequest } from 'http-request';
// eslint-disable-next-line import/no-unresolved
import { createResponse } from 'create-response';

// ── Configuration ──────────────────────────────────────────────────────────

const AEM_LIVE_HOST = 'https://main--aig-eds-migration-poc--kprasad05.aem.live';
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
  // httpRequest resolves against the property origin configured in
  // Property Manager. Use the full AEM Live URL so it works regardless of
  // what other origin the property uses for non-sitemap paths.
  const indexUrl = `${AEM_LIVE_HOST}/video-index.json?limit=1000`;

  const res = await httpRequest(indexUrl);

  if (res.status !== 200) {
    throw new Error(`video-index.json fetch failed: ${res.status} (${indexUrl})`);
  }

  // EdgeWorkers' httpRequest returns a ReadableStream body; .json() is
  // available as a convenience method on the response object.
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

// ── EdgeWorker entry point ──────────────────────────────────────────────────
//
// responseProvider runs INSTEAD of fetching the origin for the matched path,
// so this only fires for /video-sitemap.xml (as configured in Property Manager).

export async function responseProvider(request) {
  const origin = `https://${request.host}`;

  try {
    const xml = await buildVideoSitemapXml(origin);

    return createResponse(
      200,
      {
        'Content-Type': 'application/xml; charset=utf-8',
        // Akamai uses Surrogate-Control for edge TTL.
        'Surrogate-Control': `max-age=${CACHE_TTL_SECONDS}`,
        // Browser / downstream cache TTL.
        'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
        // Edge cache tag for targeted purge via Fast Purge API.
        'Edge-Cache-Tag': 'video-sitemap',
      },
      xml,
    );
  } catch (err) {
    return createResponse(
      500,
      { 'Content-Type': 'text/plain' },
      `Internal Server Error: ${err.message}`,
    );
  }
}
