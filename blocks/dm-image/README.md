# Dynamic Media Image (`dm-image`)

Proof-of-concept block that demos authoring an **AEM Dynamic Media** asset
picked from our AEMaaCS Author instance (via the DA.live "Insert AEM Asset"
toolbar action) and rendering it on the live page as an optimized, responsive
`<picture>` — without any build step or third-party dependency.

## What it demonstrates

- An author drops the asset picker into a normal DA.live table, no manual
  URL copy/paste.
- The block resolves either shape DA.live can produce for an inserted asset:
  - a plain `<img>` already pointing at a resolved rendition, or
  - a plain `<a>` whose href is the raw Dynamic Media / AEM Assets delivery
    URL (when `aem.assets.image.type=link` is configured).
- At render time the block requests several width-specific renditions from
  the asset delivery host via query params and assembles a `srcset`/`sizes`
  responsive image, so the browser only downloads the size it needs.
- An optional second row lets an author add a caption (also used as the
  alt-text fallback when the picker doesn't carry one).

## DA.live prerequisite configuration

This block is self-contained (see "Self-contained by design" below), but the
**asset picker itself** only appears in the DA.live toolbar once the AEM
Assets integration is configured for the site in DA.live's `da.live/config`
(previously `<owner>/<repo>` config sheet in DA.live's admin UI). Set:

| Key | Value for this POC | Purpose |
| --- | --- | --- |
| `aem.repositoryId` | `author-p56807-e1482157.adobeaemcloud.com` | Points DA.live's picker at our AEMaaCS Author instance. |
| `aem.asset.dm.delivery` | delivery host / DM delivery config for the same program+environment | Tells DA.live (and, indirectly, this block) which host serves optimized renditions. |
| `aem.asset.smartcrop.select` | smartcrop name(s) enabled on the asset, if any | Lets authors pick a smartcrop-based crop instead of the default rendition. |
| `aem.assets.image.type` | `link` | Makes DA.live insert a plain `<a href="...">` to the asset delivery URL instead of an `<img>`, which is the path this block's link-detection branch demos. Leave unset (or `img`) to test the `<img>`-based branch instead. |

Full setup instructions: https://docs.da.live/administrators/guides/setup-aem-assets

**I still need to set these manually** in the DA.live config for
`kprasad05/aig-eds-migration-poc` before the picker icon will show up and
before the `link` vs `img` behavior can be verified end-to-end — this repo
change alone does not configure DA.live.

## Self-contained by design

This repo does not currently have any AEM Assets plugin wiring in
`scripts/scripts.js` (no `aem-assets-plugin-support.js`, no documented
`externalImageUrlPrefixes` allowlist for keeping external DM URLs instead of
rewriting them to `/media_*`). Rather than assume that infrastructure exists,
`dm-image.js` does its own detection and rendition-URL building, so it works
whether or not such a plugin is ever added later.

## Authoring: building the block table in DA.live

1. In a DA.live document, insert a table.
2. First cell of the first row: block name, `Dynamic Media Image` (maps to
   the `dm-image` block name).
3. Second row, single cell: place the cursor in the cell and use the
   **Insert AEM Asset** icon in the rich text toolbar to pick the Dynamic
   Media asset. DA.live inserts either the resolved `<img>` or the asset
   link, depending on `aem.assets.image.type`.
4. Optional third row, single cell: type a caption. If present, it's
   rendered under the image and used as the `alt` text fallback when the
   picker didn't set one.

### Sample authored table

| Dynamic Media Image |
| --- |
| ![Product Hero Shot](https://delivery-p56807-e1482157.adobeaemcloud.com/adobe/assets/urn:aaid:aem:1234-5678-90ab-cdef/as/product-hero-shot.jpg) |
| Product hero shot, Q3 campaign |

Rendered as `.plain.html`, that table becomes:

```html
<div class="dm-image">
  <div>
    <div>
      <img src="https://delivery-p56807-e1482157.adobeaemcloud.com/adobe/assets/urn:aaid:aem:1234-5678-90ab-cdef/as/product-hero-shot.jpg" alt="Product Hero Shot">
    </div>
  </div>
  <div>
    <div>Product hero shot, Q3 campaign</div>
  </div>
</div>
```

If `aem.assets.image.type=link` is set, the picker instead inserts an anchor:

```html
<div class="dm-image">
  <div>
    <div>
      <a href="https://delivery-p56807-e1482157.adobeaemcloud.com/adobe/assets/urn:aaid:aem:1234-5678-90ab-cdef/as/product-hero-shot.jpg">product-hero-shot.jpg</a>
    </div>
  </div>
  <div>
    <div>Product hero shot, Q3 campaign</div>
  </div>
</div>
```

Both shapes decorate to the same responsive `<picture>` + caption markup.

## Testing locally

1. `npm install` (once, if not already done).
2. Start the AEM CLI dev server against this branch's preview content:
   `npx -y @adobe/aem-cli up --no-open --forward-browser-logs`
   (serves `http://localhost:3000`, proxying content from
   `https://main--aig-eds-migration-poc--kprasad05.aem.page/` or the current
   branch's preview, whichever the CLI resolves to).
3. Without a real authored page yet, create a static file under `drafts/`
   (e.g. `drafts/dm-image-test.html`) using the markup shapes above, then
   start the CLI with `--html-folder drafts` and open
   `http://localhost:3000/dm-image-test`.
4. Confirm in devtools:
   - The block renders a `<picture>` with one `<source srcset>` listing
     multiple width-tagged URLs, plus a fallback `<img>`.
   - Each URL in the `srcset` carries `width`, `format=webply`, and
     `optimize=medium` query params pointing at the same asset path.
   - If no asset was authored (empty block), the console logs a
     `[dm-image]` warning and nothing else breaks on the page.
5. Once DA.live's AEM Assets integration is configured (see prerequisites
   above), repeat the test against a real authored DA.live page and use the
   asset picker instead of hand-typed markup.
