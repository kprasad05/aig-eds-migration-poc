const escapeXml = (v) => String(v)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const isEmbed = (url) => /youtube\.com|youtu\.be|vimeo\.com/i.test(url);

function buildEntry(row, host) {
  const loc = `${host}${row.path}`;
  // `thumbnail` is a legacy fallback for rows where `image` was left blank by a reindex gap.
  const raw = row.videothumbnail || row.image || row.thumbnail;
  const thumb = raw ? escapeXml(new URL(raw, loc).href) : '';
  const locTag = isEmbed(row.videourl)
    ? `<video:player_loc allow_embed="yes">${escapeXml(row.videourl)}</video:player_loc>`
    : `<video:content_loc>${escapeXml(row.videourl)}</video:content_loc>`;
  return `  <url>
    <loc>${escapeXml(loc)}</loc>
    <video:video>
      <video:title>${escapeXml(row.title || row.path)}</video:title>
      <video:description>${escapeXml(row.description || row.title || '')}</video:description>
      ${locTag}
      <video:thumbnail_loc>${thumb}</video:thumbnail_loc>
    </video:video>
  </url>`;
}

export default {
  async fetch(request, env, ctx) {
    const cache = caches.default;
    const cacheKey = new Request(new URL(request.url).toString(), { method: 'GET' });
    const hit = await cache.match(cacheKey);
    if (hit) return hit;

    const res = await fetch(`${env.ORIGIN}/video-index.json`);
    if (!res.ok) return new Response('video-index unavailable', { status: 502 });
    const { data } = await res.json();

    const host = env.ORIGIN;
    const entries = data.filter((r) => r.videourl).map((r) => buildEntry(r, host)).join('\n');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
${entries}
</urlset>
`;

    const response = new Response(xml, {
      headers: {
        'content-type': 'application/xml; charset=utf-8',
        'cache-control': 'public, max-age=30',
      },
    });
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  },
};
