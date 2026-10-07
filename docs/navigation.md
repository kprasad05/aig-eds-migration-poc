# Nav authoring guide

The main nav is authored as a document at `/nav` in da.live:
https://da.live/canvas#/kprasad05/aig-eds-migration-poc/nav

## Dynamically add pages to a nav flyout

Instead of hand-listing every article link under a menu item, add one link
ending in `/*` pointing at the folder, e.g.:

```
/home/newsroom/stories/*
```

At render time, this link is replaced with the pages published under that
path, newest first (max 10). No further authoring needed when new pages are
added under that folder — they show up automatically.

**Steps to test a change:**
1. Add or edit a `/*` link in the nav doc, save and preview it.
2. Preview any page that uses this nav.
3. Open the corresponding flyout and confirm the expected pages appear,
   newest first.

## Hide a specific page from the nav

Add page metadata `hidenav` with value `true` to the page you want hidden:

1. Open the page in da.live.
2. Add metadata: `hidenav` = `true`.
3. Preview the page (this re-indexes it).

The page is then excluded from the nav everywhere it would otherwise
appear — whether it's linked directly in the nav doc, or pulled in by a
`/*` dynamic link above. It still exists and is reachable by direct URL;
only its nav entry is suppressed.

**Steps to test:**
1. Set `hidenav: true` on a page and preview it.
2. Check `/query-index.json` — the page's row should show `"hidenav":"true"`.
3. Preview any page that links to it (directly or via `/*`) and confirm
   the link no longer appears in the rendered nav.

## How it works (for developers)

- `helix-query.yaml` — indexes a page's `hidenav` metadata into
  `query-index.json`.
- `blocks/header/header.js`:
  - `expandDynamicNavLinks` expands `/*` links using `query-index.json`,
    skipping pages flagged `hidenav`.
  - `removeHiddenNavLinks` strips any remaining nav `<li>` — authored or
    expanded — whose link target is flagged `hidenav`.
