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

// Dynamic Media (AEMaaCS, OpenAPI) delivery domain for `videourl` values that
// point at DM instead of YouTube/Vimeo, e.g. delivery-p12345-e67890.adobeaemcloud.com.
// Unset by default: DM-sourced duration/thumbnail are skipped entirely until this
// is configured, page metadata continues to cover title/description either way.
const DM_DELIVERY_DOMAIN = process.env.DM_DELIVERY_DOMAIN || '';
// Only needed if the environment's delivery tier requires it; most AEMaaCS DM
// delivery endpoints serve published assets anonymously, same trust model as
// classic Scene7's `req=metadata` image endpoint.
const DM_API_KEY = process.env.DM_API_KEY || '';

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

function isDynamicMediaUrl(url) {
  return Boolean(DM_DELIVERY_DOMAIN) && url.includes(DM_DELIVERY_DOMAIN);
}

// DM OpenAPI delivery URLs look like
// https://{domain}/adobe/assets/deliver/{assetId}/{seoName}. The asset ID is
// what the metadata/rendition endpoints below key off of.
function extractDmAssetId(url) {
  const match = new URL(url).pathname.match(/\/adobe\/assets\/deliver\/([^/]+)/);
  return match ? match[1] : null;
}

// Best-effort against DM OpenAPI's documented shape — not yet verified against
// a real AIG asset, so field names (`dam:duration`, `dc:title`, `dc:description`)
// and the endpoint path itself may need correcting once we have one to test.
async function fetchDmMetadata(assetId) {
  const metadataUrl = `https://${DM_DELIVERY_DOMAIN}/adobe/assets/${assetId}/metadata`;
  const headers = DM_API_KEY ? { 'x-api-key': DM_API_KEY } : {};
  try {
    const res = await fetch(metadataUrl, { headers });
    if (!res.ok) {
      console.warn(`DM metadata request failed for ${assetId}: ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn(`DM metadata request errored for ${assetId}: ${err.message}`);
    return null;
  }
}

// Renders a still frame off the same asset via DM's rendition delivery.
// `seoName` is reused from the original videourl so the rendition URL stays
// valid without needing a separate lookup.
function dmThumbnailUrl(assetId, seoName) {
  return `https://${DM_DELIVERY_DOMAIN}/adobe/assets/deliver/${assetId}/${seoName}?width=1280&preferwebp=false`;
}

async function buildEntry(row) {
  const loc = `${host}${row.path}`;
  const title = escapeXml(row.title || row.path);
  const description = escapeXml(row.description || row.title || '');

  // Page/block-authored fields still win when present; DM only fills gaps.
  let dmDuration = null;
  let dmThumbnail = null;
  if (isDynamicMediaUrl(row.videourl)) {
    const assetId = extractDmAssetId(row.videourl);
    const metadata = assetId ? await fetchDmMetadata(assetId) : null;
    if (metadata) {
      // Field name unconfirmed against a real asset — adjust once we have one.
      const duration = Math.round(Number(metadata['dam:duration']));
      // Google's schema requires an integer number of seconds, 1-28800.
      if (Number.isInteger(duration) && duration >= 1 && duration <= 28800) {
        dmDuration = duration;
      }
      const seoName = row.videourl.split('/').pop();
      dmThumbnail = dmThumbnailUrl(assetId, seoName);
    }
  }

  // Prefer the video block's own poster image, then a DM-generated still
  // (video assets only), then the page image. The legacy `thumbnail` field
  // is a fallback for a known reindex gap where `image` is blank for some
  // already-indexed rows; safe to drop once the index is confirmed to
  // repopulate `image` for all rows.
  const rawThumbnail = row.videothumbnail || dmThumbnail || row.image || row.thumbnail;
  const thumbnail = rawThumbnail ? escapeXml(new URL(rawThumbnail, loc).href) : '';

  // video-feature embeds YouTube/Vimeo links as a player, not a direct file,
  // so those need player_loc rather than content_loc per Google's schema.
  const locTag = isEmbedPlayerUrl(row.videourl)
    ? `<video:player_loc allow_embed="yes">${escapeXml(row.videourl)}</video:player_loc>`
    : `<video:content_loc>${escapeXml(row.videourl)}</video:content_loc>`;

  const durationTag = dmDuration ? `\n      <video:duration>${dmDuration}</video:duration>` : '';

  return `  <url>
    <loc>${escapeXml(loc)}</loc>
    <video:video>
      <video:title>${title}</video:title>
      <video:description>${description}</video:description>
      ${locTag}
      <video:thumbnail_loc>${thumbnail}</video:thumbnail_loc>${durationTag}
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
  const entries = (await Promise.all(videoRows.map(buildEntry))).join('\n');

  const xml = `<?xml version="1.0"?>
<urlset xmlns="https://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:video="https://www.google.com/schemas/sitemap-video/1.1">
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
