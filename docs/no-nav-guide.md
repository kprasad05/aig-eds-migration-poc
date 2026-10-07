# Excluding Navigation on Specific Pages

> **Scope:** AIG EDS Migration POC — Document Authoring (DA) content source

---

## Summary

Set the page metadata field `no-nav` to `true` on any page to hide the site header
(navigation bar) and footer from that page entirely.  The blocks are never loaded,
so there is no flash of header/footer content — the main content fills the full
viewport from the very first paint.

The page continues to exist and is reachable by direct URL.  The exclusion only
affects the rendering of the navigation chrome on that single page.

---

## Step-by-Step: Authoring in DA

1. Open the page in [da.live](https://da.live).
2. Open or add the **Metadata** section (the last two-column `Key | Value` table in
   the document).
3. Add a new row:

   | Key    | Value |
   |--------|-------|
   | `no-nav` | `true` |

4. Save and **Preview** the document via the DA Sidekick (or AEM Sidekick).

> **Accepted values:** `true`, `yes`, or `1` (case-insensitive).  
> Any other value — including blank — is treated as "show navigation normally".

---

## How It Works (Technical Detail)

### 1. Reading the metadata — `scripts/scripts.js`

`getMetadata('no-nav')` reads the `<meta name="no-nav" content="…">` tag that EDS
injects from the page's Metadata table.

```js
function isNavHiddenOnPage() {
  return /^(true|yes|1)$/i.test((getMetadata('no-nav') || '').trim());
}
```

### 2. Early body class — `loadEager`

During the *eager* load phase (before any blocks paint) the body class `no-nav` is
applied when the flag is set.  CSS picks this up immediately and collapses the
`<header>` and `<footer>` elements so they never occupy space.

```js
async function loadEager(doc) {
  decorateTemplateAndTheme();

  if (isNavHiddenOnPage()) {
    document.body.classList.add('no-nav');   // ← applied before first paint
  }
  // …
}
```

### 3. Skipping block loading — `loadLazy`

During the *lazy* load phase `loadHeader()` and `loadFooter()` are skipped
entirely, so the header and footer fragments are never fetched from the CDN.

```js
async function loadLazy(doc) {
  if (!isNavHiddenOnPage()) {
    loadHeader(doc.querySelector('header'));
    loadFooter(doc.querySelector('footer'));
  }
  // …
}
```

### 4. CSS rules — `styles/styles.css`

```css
body.no-nav header,
body.no-nav footer {
  display: none;
}

body.no-nav main > .section:first-of-type {
  margin-top: 0;
}
```

The `display: none` ensures the empty `<header>` placeholder (which normally
reserves `--nav-height: 64px`) does not leave a blank gap at the top of the page.

### 5. Index column — `helix-query.yaml`

The `no-nav` field is indexed so it can be inspected via `query-index.json`:

```yaml
no-nav:
  select: head > meta[name="no-nav"]
  value: attribute(el, "content")
```

---

## Verification

After previewing, confirm the flag was indexed:

```bash
curl https://main--aig-eds-migration-poc--kprasad05.aem.live/query-index.json \
  | python -m json.tool | grep -A 10 '"path": "/your/page/path"'
```

The row for your page should contain `"no-nav": "true"`.

Open the page in a browser and confirm:

- No header navigation bar is visible.
- No footer is visible.
- The page content starts at the very top of the viewport.
- DevTools → Elements shows `<body class="… no-nav …">`.

---

## Scope of the `no-nav` Flag

| Effect | Covered? |
|--------|----------|
| Header (navigation bar) hidden on this page | ✅ Yes |
| Footer hidden on this page | ✅ Yes |
| Header/footer network requests skipped (performance) | ✅ Yes |
| No blank gap at top of page | ✅ Yes |
| Page removed from the site nav on other pages | ❌ No — use `hidenav: true` for that |
| Page removed from sitemap | ❌ No — use `robots: noindex` for that |
| Page removed from search results | ❌ No — use `robots: noindex` for that |

---

## Combining with Other Metadata

| Goal | Metadata to Set |
|------|-----------------|
| Hide nav chrome *on* this page | `no-nav: true` |
| Hide this page *from* the nav on other pages | `hidenav: true` |
| Hide from sitemap | `robots: noindex` |
| Hide from search results | `robots: noindex` |

A landing page or campaign microsite that should be entirely standalone:

| Key | Value |
|-----|-------|
| `no-nav` | `true` |
| `hidenav` | `true` |
| `robots` | `noindex` |

---

## Common Mistakes

| Mistake | What Happens | Fix |
|---------|-------------|-----|
| Setting `no-nav: true` but not previewing | Flag is not yet in the page HTML; nav still loads | Preview/publish after saving |
| Setting `no-nav: false` or `no-nav: 0` | `isNavHiddenOnPage()` returns `false`; nav loads normally | Use `true`, `yes`, or `1` to hide |
| Confusing `no-nav` with `hidenav` | `hidenav` hides the page *from* other pages' navs; `no-nav` hides the nav *on* this page | Use the right key for the intent |
| Expecting links to the page to disappear | `no-nav` does not affect nav link rendering elsewhere | Add `hidenav: true` if links should also be pruned |

---

## Related Files

| File | Role |
|------|------|
| `scripts/scripts.js` | `isNavHiddenOnPage()`, `loadEager` body-class injection, `loadLazy` skip logic |
| `styles/styles.css` | `body.no-nav` CSS rules that hide `<header>` / `<footer>` |
| `helix-query.yaml` | Indexes `no-nav` into `query-index.json` |
| `docs/hidenav-da-guide.md` | Guide for hiding a page *from* the navigation on other pages |
