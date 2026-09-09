# Sitemaps

Two sitemaps are set up for this site: a standard page sitemap (native
EDS feature) and a Google-schema video sitemap (custom, since EDS has no
built-in support for it).

## Page sitemap

`/sitemap.xml` is generated automatically by the platform from
`query-index.json`, configured by two files at the repo root:

- `helix-query.yaml` — defines `query-index`, indexing every page's
  `title`, `description`, `image`, `lastModified`, `robots`, `hidenav`.
- `helix-sitemap.yaml` — points the platform's sitemap feature at
  `query-index.json` and sets the output to `/sitemap.xml`.

**Steps to test:**
1. `curl https://main--aig-eds-migration-poc--kprasad05.aem.live/sitemap.xml`
   and confirm it lists real published pages with `<lastmod>` dates.
2. If you've just added/changed a property in `helix-query.yaml`, existing
   already-published pages won't pick it up until you trigger **Reindex**
   for `query-index` in the Index Admin tool
   (https://tools.aem.live/tools/index-admin/index.html, org `kprasad05`,
   site `aig-eds-migration-poc`, ref `main`). New pages published after
   the config change are indexed automatically.

## Video sitemap

A page counts as "having a video" only if it has an actual
`video-feature` block with a link in the page body — not just metadata.
This was a deliberate choice: metadata alone could be set without a real
video ever being added (or left stale after one was removed).

**Author-facing pieces (per page):**
- A `video-feature` block containing a poster image and a link to the
  video (YouTube, Vimeo, or a direct file URL). This is what makes the
  video actually play on the page. `helix-query.yaml`'s `video-index`
  reads this link directly from `main .video-feature a`.
- No extra metadata is required beyond the block itself — title,
  description, and thumbnail all come from the page's existing SEO
  metadata (`og:title`, `description`, `og:image`) and the block's own
  poster image.

The output format matches the real aig.com production video sitemap
(https://www.aig.com/video-sitemap.xml) exactly: only `title`,
`description`, `content_loc`/`player_loc`, and `thumbnail_loc` per video,
in that order — no `duration`, `publication_date`, or `expiration_date`,
which that reference doesn't use either.

**How the data flows:**
1. `helix-query.yaml`'s `video-index` indexes every page into
   `/video-index.json`, with columns `videourl` (from the block link),
   `videothumbnail` (from the block's poster image), `image` (page-level
   `og:image`, used as a thumbnail fallback).
2. `tools/generate-video-sitemap.js` fetches `/video-index.json`, keeps
   only rows where `videourl` is set, and builds `video-sitemap.xml`:
   - `<video:player_loc>` for YouTube/Vimeo links (embeds), or
     `<video:content_loc>` for direct file URLs.
   - Thumbnail preference order: block poster → page `og:image` → legacy
     `thumbnail` field (a fallback for a known reindex gap on old rows).
3. `.github/workflows/video-sitemap.yaml` runs this daily (`0 6 * * *`,
   plus manual `workflow_dispatch`), commits `video-sitemap.xml` to `main`
   if it changed, which is then served as a static file at
   `/video-sitemap.xml`.

**Steps to test:**
1. Add a `video-feature` block with a real video link to a page, preview
   and publish it.
2. Check it landed correctly:
   `curl https://main--aig-eds-migration-poc--kprasad05.aem.live/video-index.json`
   — the page's row should show `videourl` populated. If it doesn't and
   the page was already published before a `video-index` config change,
   trigger **Reindex** for `video-index` in Index Admin (same tool as
   above).
3. Run the generator locally against live data and inspect the output:
   ```
   node tools/generate-video-sitemap.js https://main--aig-eds-migration-poc--kprasad05.aem.live
   cat video-sitemap.xml
   ```
   Confirm only pages with a real video block appear (a page with just a
   poster image and no link should be excluded — `/drafts/dorothy/home`
   is a real example of this negative case).
4. Confirm it's actually live:
   `curl https://main--aig-eds-migration-poc--kprasad05.aem.live/video-sitemap.xml`
   should return XML with the `video:video` / `xmlns:video` namespace, not
   a plain page sitemap. If it doesn't match what the generator produced
   locally, the daily workflow hasn't committed yet — check its run
   history under the repo's Actions tab, or trigger it manually via
   `workflow_dispatch`.

## Known gaps / things to revisit

- **`robots.txt` doesn't reference either sitemap yet, and can't be added
  via a repo file** — `*.aem.page`/`*.aem.live` domains always serve a
  hardcoded `Disallow: /` regardless of repo content, by design (to keep
  preview/test domains out of search results). A custom `robots.txt` for
  the real production domain (once one exists) has to be set via the
  Configuration Service:
  ```
  curl -X POST https://admin.hlx.page/config/kprasad05/sites/aig-eds-migration-poc/robots.txt \
    -H 'content-type: text/plain' \
    -H 'x-auth-token: {your-auth-token}' \
    --data 'User-agent: *
  Allow: /
  Sitemap: https://{production-domain}/sitemap.xml
  Sitemap: https://{production-domain}/video-sitemap.xml'
  ```
- **The daily workflow silently committed nothing for its first 12 runs**
  (fixed in the `fix/video-sitemap-commit` branch/PR) — `git diff --quiet`
  only compares tracked files, so a never-committed `video-sitemap.xml`
  always looked like "no changes". The fix stages the file before
  diffing. Confirm this PR is merged before trusting that
  `/video-sitemap.xml` is being kept up to date automatically.
- Only two pages currently have a real video (`/drafts/purush/video`,
  `/drafts/purush/test`), both pointing at the same test YouTube link —
  fine for proving the mechanism works, but not representative of real
  site content yet.
