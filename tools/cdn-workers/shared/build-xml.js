/**
 * Shared video-sitemap XML builder for CDN edge workers.
 *
 * Compatible with Cloudflare Workers, Fastly Compute@Edge, and
 * Akamai EdgeWorkers — all of which expose a standard `fetch` global.
 *
 * Usage:
 *   import { buildVideoSitemapXml } from './build-xml.js';
 *   const xml = await buildVideoSitemapXml(origin, aemLiveHost);
 */

/**
 * Escape special XML characters in a string value.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeXml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Returns true when `url` is a YouTube / Vimeo embed link that needs
 * <video:player_loc> instead of <video:content_loc>.
 * @param {string} url
 * @returns {boolean}
 */
function isEmbedPlayerUrl(url) {
  return /youtube\.com|youtu\.be|vimeo\.com/i.test(url);
}

/**
 * Render a single <url> entry for the video sitemap.
 * @param {{ path: string, title?: string, description?: string,
 *           videourl: string, videothumbnail?: string, image?: string }} row
 * @param {string} origin  Production origin, e.g. "https://www.aig.com"
 * @returns {string}
 */
function buildEntry(row, origin) {
  const loc = `${origin}${row.path}`;
  const title = escapeXml(row.title || row.path);
  const description = escapeXml(row.description || row.title || '');

  const rawThumbnail = row.videothumbnail || row.image || '';
  // Resolve relative thumbnail paths against the page loc.
  const thumbnail = rawThumbnail
    ? escapeXml(new URL(rawThumbnail, loc).href)
    : '';

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
 * Fetch video-index.json from the AEM Live host and return a complete
 * video sitemap XML string.
 *
 * @param {string} origin       Production origin  (e.g. "https://www.aig.com")
 * @param {string} aemLiveHost  AEM Live preview host
 *   (e.g. "https://main--aig-eds-migration-poc--kprasad05.aem.live")
 * @param {number} [limit=1000] Maximum rows to include
 * @returns {Promise<string>}
 */
export async function buildVideoSitemapXml(origin, aemLiveHost, limit = 1000) {
  const indexUrl = `${aemLiveHost}/video-index.json?limit=${limit}`;
  const res = await fetch(indexUrl);
  if (!res.ok) {
    throw new Error(`video-index.json fetch failed: ${res.status} ${res.statusText} (${indexUrl})`);
  }
  const { data } = await res.json();

  // Only include rows that have an actual video URL from a video-feature block.
  const videoRows = (data || []).filter((row) => row.videourl);

  const entries = videoRows.map((row) => buildEntry(row, origin)).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
${entries}
</urlset>
`;
}
