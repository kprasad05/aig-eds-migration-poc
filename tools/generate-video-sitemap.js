/* eslint-disable no-console */

/**
 * Generates video-sitemap.xml (Google video sitemap schema) from /video-index.json.
 * Run: node tools/generate-video-sitemap.js [host]
 * host defaults to the SITE_HOST env var, falling back to the production live host.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_HOST = 'https://main--aig-eds-migration-poc--kprasad05.aem.live';
const host = process.argv[2] || process.env.SITE_HOST || DEFAULT_HOST;
const outputFile = path.join(__dirname, '..', 'video-sitemap.xml');

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toIsoDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function isEmbedPlayerUrl(url) {
  return /youtube\.com|youtu\.be|vimeo\.com/i.test(url);
}

function buildEntry(row) {
  const loc = `${host}${row.path}`;
  const title = escapeXml(row.title || row.path);
  const description = escapeXml(row.description || row.title || '');
  // Prefer the video block's own poster image; fall back to the page image.
  const rawThumbnail = row.videothumbnail || row.image;
  const thumbnail = rawThumbnail ? escapeXml(new URL(rawThumbnail, loc).href) : '';
  const duration = parseInt(row.duration, 10);
  const publicationDate = toIsoDate(row.releasedate || row.lastModified);

  // video-feature embeds YouTube/Vimeo links as a player, not a direct file,
  // so those need player_loc rather than content_loc per Google's schema.
  const locTag = isEmbedPlayerUrl(row.videourl)
    ? `<video:player_loc allow_embed="yes">${escapeXml(row.videourl)}</video:player_loc>`
    : `<video:content_loc>${escapeXml(row.videourl)}</video:content_loc>`;

  const durationTag = Number.isFinite(duration) && duration > 0
    ? `\n      <video:duration>${duration}</video:duration>`
    : '';
  const publicationDateTag = publicationDate
    ? `\n      <video:publication_date>${publicationDate}</video:publication_date>`
    : '';

  return `  <url>
    <loc>${escapeXml(loc)}</loc>
    <video:video>
      <video:thumbnail_loc>${thumbnail}</video:thumbnail_loc>
      <video:title>${title}</video:title>
      <video:description>${description}</video:description>
      ${locTag}${durationTag}${publicationDateTag}
    </video:video>
  </url>`;
}

async function main() {
  const res = await fetch(`${host}/video-index.json`);
  if (!res.ok) {
    throw new Error(`Failed to fetch video-index.json: ${res.status} ${res.statusText}`);
  }
  const { data } = await res.json();

  // Only pages that actually have a video-feature block with a link count as
  // having a video (a page's og-style metadata alone is not enough).
  const videoRows = data.filter((row) => row.videourl);
  const entries = videoRows.map(buildEntry).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
${entries}
</urlset>
`;

  fs.writeFileSync(outputFile, xml);
  console.log(`Wrote ${videoRows.length} video entries to ${outputFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
