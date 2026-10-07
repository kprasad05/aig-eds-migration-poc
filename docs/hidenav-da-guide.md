# How to Exclude Navigation for a Specific Page in DA

> **Scope:** AIG EDS Migration POC — Document Authoring (DA) content source

---

## Summary

Set the page metadata field `hidenav` to `true` on any page in DA. That page will be suppressed from the navigation everywhere it would otherwise appear — whether it is linked directly in the nav document or pulled in automatically via a `/*` dynamic link.

The page itself continues to exist and is reachable by direct URL. Only its nav entry is hidden.

---

## Step-by-Step: Authoring in DA

1. Open the page in [da.live](https://da.live).
2. Open or add the **Metadata** section (typically the last table in a DA document, with a two-column `Key | Value` structure).
3. Add a new row:

   | Key | Value |
   |-----|-------|
   | `hidenav` | `true` |

4. Save the document.
5. Click **Preview** in the DA Sidekick (or use the AEM Sidekick). This re-indexes the page — the `hidenav` flag only takes effect after the page is re-previewed/published so the index picks it up.

> **Accepted values for `hidenav`:** `true`, `yes`, or `1` (case-insensitive). Any other value (including blank) is treated as not hidden.

---

## Verification

After previewing, confirm the flag was indexed:

```bash
curl https://main--aig-eds-migration-poc--kprasad05.aem.live/query-index.json \
  | python -m json.tool | grep -A 10 '"path": "/your/page/path"'
```

The row for your page should contain `"hidenav": "true"`.

Then preview any page that has a nav link to the hidden page (directly or via a `/*` folder link) and confirm the link no longer appears.

---

## How It Works (Technical Detail)

### 1. Indexing — `helix-query.yaml`

The `hidenav` metadata field is indexed by the `query-index` configuration:

```yaml
# helix-query.yaml
hidenav:
  select: head > meta[name="hidenav"]
  value: attribute(el, "content")
```

This means the `query-index.json` row for every published page includes a `hidenav` column. For most pages it is empty; for hidden pages it is `"true"`.

### 2. Nav Decoration — `blocks/header/header.js`

When the header block loads, it:

1. Fetches `query-index.json` (shared cache with the search typeahead — no double fetch).
2. Calls **`expandDynamicNavLinks(nav, pages)`** — expands `/*` folder links into real page links, **skipping** any page where `isHiddenFromNav(page)` returns `true`.
3. Calls **`removeHiddenNavLinks(nav, pages)`** — scans every authored `<a>` in the nav sections and tools, and removes the `<li>` for any link whose target path is in the hidden set.

```js
// The flag check — accepts true/yes/1, case-insensitive
function isHiddenFromNav(entry) {
  return /^(true|yes|1)$/i.test((entry?.hidenav || '').trim());
}

// Step 2: dynamic /*-link expansion skips hidden pages
function expandDynamicNavLinks(nav, pages) {
  const matches = pages
    .filter((p) => p.path.startsWith(`${prefix}/`) && !isHiddenFromNav(p))
    ...
}

// Step 3: removes directly authored nav links to hidden pages
function removeHiddenNavLinks(nav, pages) {
  const hiddenPaths = new Set(
    pages.filter(isHiddenFromNav).map((p) => normalizePath(p.path)),
  );
  nav.querySelectorAll('.nav-sections a[href], .nav-tools a[href]').forEach((a) => {
    if (hiddenPaths.has(normalizePath(url.pathname))) {
      (a.closest('li') || a).remove();
    }
  });
}
```

External links (different origins) are never in `query-index.json` and are intentionally left alone.

---

## Scope of the `hidenav` Flag

| Effect | Covered? |
|--------|----------|
| Hidden from `/*` dynamic nav folder links | ✅ Yes |
| Hidden from directly authored nav links (hand-listed in `/nav` doc) | ✅ Yes |
| Hidden from nav tools section links | ✅ Yes |
| Page is deleted or unpublished | ❌ No — page still exists and is accessible by URL |
| Page is excluded from `/sitemap.xml` | ❌ No — use `robots: noindex` metadata for that |
| Page is excluded from search results (`query-index.json` scoring) | ❌ No — `hidenav` only affects nav rendering; the page is still indexed and searchable |

---

## Hiding from Search and Sitemap as Well

If you also want to exclude the page from search results and the sitemap:

| Goal | Metadata to Set |
|------|----------------|
| Hide from nav | `hidenav: true` |
| Hide from sitemap | `robots: noindex` (the EDS platform's sitemap generator skips `noindex` pages automatically, provided a `robots` column exists in the index — it does here) |
| Hide from `search-results` block | `robots: noindex` — `scripts/search.js` filters out pages whose `robots` value contains `noindex` before scoring |

To hide from nav **and** search **and** sitemap, add both:

| Key | Value |
|-----|-------|
| `hidenav` | `true` |
| `robots` | `noindex` |

---

## Common Mistakes

| Mistake | What Happens | Fix |
|---------|-------------|-----|
| Setting `hidenav: true` but not previewing/publishing | Flag is not yet in `query-index.json`; page still appears in nav | Preview/publish the page after saving metadata |
| Setting it to `false` or `0` | `isHiddenFromNav()` returns `false` — page is shown in nav as normal | Use `true`, `yes`, or `1` to hide; remove or blank the field to show |
| Expecting the page to be deleted | Page still exists at its URL | `hidenav` only suppresses nav rendering — unpublish the page if you want it gone |
| Setting `hidenav` on the `/nav` document itself | Hides the nav doc from its own nav — unlikely to matter but logically odd | Set `hidenav` only on content pages, not on the `/nav` document |

---

## Related Files

| File | Role |
|------|------|
| `helix-query.yaml` | Indexes `hidenav` metadata into `query-index.json` |
| `blocks/header/header.js` | Reads `query-index.json`; `isHiddenFromNav()`, `expandDynamicNavLinks()`, `removeHiddenNavLinks()` implement the suppression |
| `docs/navigation.md` | Authoring guide for the nav document, including dynamic `/*` links |
