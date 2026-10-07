# Sitemap: Git Commitment, Branch Configuration & Multi-Tenancy

> **Scope:** AIG EDS Migration POC (`kprasad05/aig-eds-migration-poc`, branch `main`)

---

## 1. Is the Generated Sitemap XML Committed to the Git Repo?

There are **three feed artifacts** in this project. Each has a different generation and storage mechanism.

### 1.1 `/sitemap.xml` — Standard Page Sitemap

| Attribute | Detail |
|-----------|--------|
| **Committed to Git?** | ❌ No |
| **Generation** | Platform-generated at runtime by AEM EDS |
| **Source data** | `/query-index.json` (built by the EDS indexing pipeline) |
| **Config files** | `helix-query.yaml`, `helix-sitemap.yaml` |

`helix-sitemap.yaml` instructs the EDS platform to read `query-index.json` and serve `/sitemap.xml` dynamically. No file is ever written to the repository.

```yaml
# helix-sitemap.yaml
sitemaps:
  aig-eds-migration-poc:
    source: /query-index.json
    destination: /sitemap.xml
    lastmod: YYYY-MM-DD
```

`helix-query.yaml` defines the `query-index` that feeds it — indexing `title`, `description`, `image`, `lastModified`, `robots`, `hidenav`, and `bodyText` from every published page.

**To verify:** `curl https://main--aig-eds-migration-poc--kprasad05.aem.live/sitemap.xml`

---

### 1.2 `video-sitemap.xml` — Video Sitemap

| Attribute | Detail |
|-----------|--------|
| **Committed to Git?** | ✅ Yes — file exists at repo root, tracked by Git |
| **Generation** | `tools/generate-video-sitemap.js` (Node.js script) |
| **Trigger** | Daily cron (`0 6 * * *` UTC) + manual `workflow_dispatch` |
| **Workflow file** | `.github/workflows/video-sitemap.yaml` |
| **Commit author** | `github-actions[bot]` |
| **Commit message** | `chore: update video-sitemap.xml` |

**How data flows:**

```
helix-query.yaml (video-index)
        │
        ▼
/video-index.json  (EDS index, live environment)
        │
        ▼
tools/generate-video-sitemap.js
        │  fetches video-index.json
        │  filters rows where videourl is set
        │  builds Google Video Sitemap XML
        ▼
video-sitemap.xml  ──►  committed to main branch
        │
        ▼
Served as static file: /video-sitemap.xml
```

**Workflow commit logic (`.github/workflows/video-sitemap.yaml`):**

```yaml
- name: Commit if changed
  run: |
    git add video-sitemap.xml
    if ! git diff --cached --quiet -- video-sitemap.xml; then
      git config user.name "github-actions[bot]"
      git config user.email "github-actions[bot]@users.noreply.github.com"
      git commit -m "chore: update video-sitemap.xml"
      git push
    else
      echo "No changes to video-sitemap.xml"
    fi
```

> ⚠️ **Known past bug (now fixed):** The workflow originally ran `git diff --quiet` _before_ staging, so a never-committed `video-sitemap.xml` always appeared unchanged. The fix stages the file first (`git add`), then diffs with `--cached`. Confirm the fix is merged before trusting the daily automation.

**Currently committed content:** 5 video entries (all under `/drafts/`), covering YouTube and direct `.mp4` links.

---

### 1.3 `article-really-simple-syndication.rss` — Article RSS Feed

| Attribute | Detail |
|-----------|--------|
| **Committed to Git?** | ✅ Yes — file exists at repo root, tracked by Git |
| **Generation** | `tools/generate-article-rss.js` (Node.js script) |
| **Trigger** | Daily cron (`0 6 * * *` UTC) + manual `workflow_dispatch` |
| **Workflow file** | `.github/workflows/article-rss.yaml` |
| **Commit author** | `github-actions[bot]` |
| **Commit message** | `chore: update article-really-simple-syndication.rss` |

**Inclusion criteria for a page to appear in the feed:**
- Path must be under `/articles/`
- Page metadata `template` must equal `Article Template`

**Data flow:** `helix-query.yaml` → `article-index` → `/article-index.json` → generator script → committed RSS file → served as static file.

> ℹ️ **Known gap:** No pages are currently published under `/articles/`, so the feed contains zero items until real content is authored there.

---

## 2. Is the Branch the Same as the One Configured for the Site?

**Yes — `main` is used consistently across all layers.**

### EDS URL Structure Confirms the Branch

AEM EDS encodes the branch in every environment URL:

```
https://{branch}--{site}--{org}.aem.live
         ^^^^^^
         main
```

For this project:
```
https://main--aig-eds-migration-poc--kprasad05.aem.live
```

### GitHub Actions Workflows Check Out `main`

Both artifact-generating workflows hard-code `ref: main`:

```yaml
# .github/workflows/video-sitemap.yaml
- uses: actions/checkout@v7
  with:
    ref: main

# .github/workflows/article-rss.yaml
- uses: actions/checkout@v7
  with:
    ref: main
```

### Generator Script Defaults to `main` Environment

`tools/generate-video-sitemap.js` hardcodes the `main` environment as the default host:

```js
const DEFAULT_HOST = 'https://main--aig-eds-migration-poc--kprasad05.aem.live';
const host = process.argv[2] || process.env.SITE_HOST || DEFAULT_HOST;
```

### `helix-sitemap.yaml` Is Branch-Scoped by EDS

`helix-sitemap.yaml` at the repo root is read by the EDS platform from whichever branch is being served. Since the site is configured on `main`, the platform reads this file from `main`.

### Branch Consistency Summary

| Layer | Branch / Environment |
|-------|----------------------|
| EDS site configuration | `main` |
| `helix-sitemap.yaml` / `helix-query.yaml` | `main` (read by EDS from repo root) |
| `video-sitemap.yaml` workflow checkout | `main` (`ref: main`) |
| `article-rss.yaml` workflow checkout | `main` (`ref: main`) |
| Generator script default host | `main` (`main--...--.aem.live`) |
| Committed artifacts | `main` (pushed by workflow) |

---

## 3. How Does It Support Multi-Tenancy?

AEM EDS multi-tenancy is **platform-native** — it is encoded in the URL structure, not in any application-level tenant configuration within this repository.

### EDS URL = Tenant Identity

```
https://{branch}--{site}--{org}.aem.live
                  ^^^^    ^^^
                  repo    GitHub org
```

| Segment | This Project | Role |
|---------|--------------|------|
| `branch` | `main` | Code/content version |
| `site` | `aig-eds-migration-poc` | The tenant site (= repo name) |
| `org` | `kprasad05` | GitHub organization/owner |

Each combination of `org + site + branch` maps to a completely isolated EDS environment with its own:
- Content index (`query-index.json`, `video-index.json`, etc.)
- Platform-generated `/sitemap.xml`
- Configuration files (`helix-sitemap.yaml`, `helix-query.yaml`)

### Multi-Tenancy for Each Sitemap Type

#### `/sitemap.xml` (Platform-Generated)
- Fully isolated per tenant by the EDS platform.
- Each tenant's EDS environment has its own `query-index.json` — no cross-tenant data is possible.
- No code changes needed; isolation is automatic.

#### `video-sitemap.xml` and `article-really-simple-syndication.rss` (Committed)
- The generator scripts are tenant-configurable via a CLI argument or environment variable:

  ```js
  // tools/generate-video-sitemap.js
  const host = process.argv[2] || process.env.SITE_HOST || DEFAULT_HOST;
  ```

- To target a different tenant, either:
  - **CLI:** `node tools/generate-video-sitemap.js https://main--other-site--other-org.aem.live`
  - **Env var in workflow:** Set `SITE_HOST` in the GitHub Actions environment
  - **Fork the repo:** Each tenant maintains its own GitHub repo with its own workflows and `DEFAULT_HOST`

### The One-Repo-Per-Tenant Model

There is **no shared/centralized sitemap infrastructure**. The architecture follows EDS conventions:

```
kprasad05/aig-eds-migration-poc  (this repo)
  ├── helix-sitemap.yaml          ← tenant A sitemap config
  ├── helix-query.yaml            ← tenant A index config
  ├── video-sitemap.xml           ← tenant A committed artifact
  └── .github/workflows/          ← tenant A automation

other-org/other-site              (another tenant's repo)
  ├── helix-sitemap.yaml          ← tenant B sitemap config
  ├── helix-query.yaml            ← tenant B index config
  ├── video-sitemap.xml           ← tenant B committed artifact
  └── .github/workflows/          ← tenant B automation
```

**Each tenant is a separate GitHub repository.** Tenancy is achieved by the EDS platform's `org + site + branch` URL scheme, not by any runtime routing or tenant-selection logic in the application code.

---

## 4. Will It Cause PR Merge Conflicts (Fast-Forward Not Allowed)?

**Yes — this is a real risk.** Because the GitHub Actions workflows push commits _directly to `main`_ (bypassing PRs entirely), any open PR that was branched off an earlier `main` commit will have a diverged history the moment a bot commit lands. Here is the full analysis.

---

### 4.1 How the Conflict Arises

The two workflows (`video-sitemap.yaml`, `article-rss.yaml`) operate as follows:

```
time ──►

main:   A ── B ── C  (developer PR merged)
                  └── bot commit D  (chore: update video-sitemap.xml)

feature-branch:   A ── B ── X ── Y  (developer's in-flight PR)
```

When the developer now tries to merge their PR (`X → Y`) into `main`, `main` has moved ahead to `D`. GitHub will either:

- **Refuse a fast-forward merge** (if the repo requires linear history / "Require linear history" branch protection is enabled), because `feature-branch` does not include `D`.
- **Require a merge commit or rebase**, even if the developer's changes have nothing to do with `video-sitemap.xml`.

The conflict scenario in detail:

| Scenario | What Happens |
|----------|-------------|
| Bot commits `video-sitemap.xml` to `main` while a PR is open that also touches `video-sitemap.xml` (e.g., a developer manually regenerated it) | **Hard merge conflict** — both branches modified the same file; Git cannot auto-resolve. |
| Bot commits `video-sitemap.xml` to `main` while a PR is open that does **not** touch `video-sitemap.xml` | **No content conflict**, but the PR branch is now **behind `main`** — GitHub may block merge if "Require branches to be up to date" is enforced, or at minimum will produce a non-fast-forward merge commit. |
| Bot commits run when **no PRs are open** | No conflict — clean fast-forward is possible when the next PR is opened after the bot commit. |

---

### 4.2 Current Repo State (No Branch Protection Detected)

The repo currently has **no branch protection rules configured** (no `.github/branch-protection.yaml` or similar). This means:

- Direct pushes to `main` by `github-actions[bot]` are **allowed** (which is why the workflows work at all).
- Fast-forward enforcement is **not active** — GitHub will default to merge commits for diverged PRs.
- Developers will need to **rebase or merge `main` into their branch** before merging their PR if a bot commit has landed since they branched off.

---

### 4.3 The Specific Race Condition Pattern

```
Developer workflow:
  1. git checkout -b feature/my-change main     ← branches from commit A
  2. makes changes, opens PR
  3. Bot workflow fires (scheduled 06:00 UTC or manual)
  4. Bot pushes commit B to main (video-sitemap.xml updated)
  5. Developer's PR now shows "X commits behind main"
  6. If "Require branches to be up to date" is ON → PR is blocked
  7. Developer must: git fetch && git rebase origin/main
  8. If developer had touched video-sitemap.xml → manual conflict resolution needed
```

The files at risk of causing a **hard conflict** (both human and bot modifying them) are:

| File | Bot commits it? | Developer likely to touch it? | Conflict Risk |
|------|----------------|-------------------------------|---------------|
| `video-sitemap.xml` | ✅ Daily | Possible (if manually regenerating) | ⚠️ Medium |
| `article-really-simple-syndication.rss` | ✅ Daily | Unlikely | 🟢 Low |
| `helix-sitemap.yaml` | ❌ No | Possible (config changes) | 🟢 None from bot |
| `helix-query.yaml` | ❌ No | Possible (index changes) | 🟢 None from bot |

---

### 4.4 Mitigations

#### Option A: `.gitattributes` merge strategy (recommended for these files)

Mark the bot-committed files as always preferring the incoming (regenerated) version during merges:

```
# .gitattributes
video-sitemap.xml                       merge=ours
article-really-simple-syndication.rss   merge=ours
```

This tells Git: if there is a conflict on these files, always take the version from the branch being merged in (the regenerated one). Prevents hard conflicts at the cost of always preferring the latest generated output.

#### Option B: Rebase-before-merge policy

Require developers to rebase their branch on the latest `main` before merging:

```bash
git fetch origin
git rebase origin/main
# resolve any conflicts
git push --force-with-lease
```

This is already good practice; the bot commits are small (`chore: update ...`) and easy to rebase over.

#### Option C: Run bot workflows after business hours / off-peak

Both workflows run at `0 6 * * *` UTC (11:30 AM IST). If most PRs are opened and merged during IST business hours, scheduling the bot at a different time (e.g., `0 0 * * *` = 05:30 AM IST, before the workday) reduces the overlap window.

#### Option D: Use a dedicated branch for bot commits

Instead of committing directly to `main`, commit to a dedicated `bot/sitemaps` branch and auto-merge via a separate PR:

```yaml
# Modified workflow: push to bot branch, not main
- name: Push to bot branch
  run: |
    git checkout -b bot/update-video-sitemap
    git push --force origin bot/update-video-sitemap
    gh pr create --base main --head bot/update-video-sitemap \
      --title "chore: update video-sitemap.xml" --fill
```

This keeps `main` protected and makes bot changes go through the normal PR review path — but adds latency (the PR must be merged separately).

#### Option E: Exclude bot-managed files from branch protection "up to date" checks

If using GitHub's "Require branches to be up to date before merging", you can scope it to only require the status checks (lint, build) to pass, not that the branch be fully up to date — this allows merging even if the bot has pushed since branching.

---

### 4.5 Summary: Is This Currently a Problem?

| Question | Answer |
|----------|--------|
| Can bot commits cause a non-fast-forward state? | ✅ Yes, every daily run |
| Is "Require linear history" enforced on `main`? | ❌ No (no branch protection detected) |
| Is "Require branches to be up to date" enforced? | ❌ No |
| Can a hard merge conflict occur today? | ⚠️ Only if a developer manually edits `video-sitemap.xml` or the RSS file while a bot run is in flight |
| Recommended mitigation | Rebase policy + `.gitattributes` merge strategy for bot-managed files |

---

## Quick Reference

| Question | Answer |
|----------|--------|
| Is `/sitemap.xml` committed to Git? | ❌ No — platform-generated at runtime |
| Is `video-sitemap.xml` committed to Git? | ✅ Yes — daily GitHub Action commits it |
| Is `article-really-simple-syndication.rss` committed to Git? | ✅ Yes — daily GitHub Action commits it |
| Which branch do workflows target? | `main` (hardcoded `ref: main`) |
| Does the branch match the site config? | ✅ Yes — EDS URL, workflows, and generators all use `main` |
| How is multi-tenancy achieved? | EDS `org+site+branch` URL isolation; one GitHub repo per tenant |
| Is there shared sitemap infrastructure across tenants? | ❌ No — fully isolated per repo/tenant |

---

## 5. Can `Template` and `Publishdate` Be Automated for the Article RSS Feed?

**Yes — both fields can be partially or fully automated**, depending on the authoring convention chosen. Here is the analysis for each field.

---

### 5.1 Current State: Both Fields Are Manually Authored

In the current design:

| Field | Where It Lives | How It's Set |
|-------|---------------|--------------|
| `Template` | Page metadata (`<meta name="template" content="Article Template">`) | Author manually types `Article Template` in the Document page metadata table |
| `Publishdate` | Page metadata (`<meta name="publishdate" content="...">`) | Author manually types a date string in the Document page metadata table |

Both are read by `helix-query.yaml`'s `article-index` via:
```yaml
template:
  select: head > meta[name="template"]
  value: attribute(el, "content")
publishdate:
  select: head > meta[name="publishdate"]
  value: attribute(el, "content")
```

And the generator already has a fallback in `resolvePubDate()`:
```js
function resolvePubDate(row) {
  if (row.publishdate) return toFeedDate(row.publishdate);   // author-entered
  if (row.lastModified) return toFeedDate(row.lastModified * 1000);  // fallback
  return toFeedDate();  // current time as last resort
}
```

---

### 5.2 Automating `Publishdate`

#### Option 1: Use `lastModified` as the automatic fallback (already implemented ✅)

The generator already falls back to `lastModified` (the HTTP `Last-Modified` header of the published page) when `publishdate` is absent. This means:

- If an author does **not** fill in `Publishdate`, the feed will use the page's last publish timestamp.
- This is already live — no code change required.
- **Limitation:** `lastModified` changes every time the page is re-published (edits, corrections, navigation changes). For a news feed, the original publish date is semantically correct; `lastModified` will drift.

#### Option 2: Derive `publishdate` from the page URL path (new — zero author input)

If articles follow a date-stamped URL convention like `/articles/2024/03/15/my-story`, the date can be extracted automatically in the generator:

```js
// In generate-article-rss.js
function extractDateFromPath(rowPath) {
  const match = rowPath.match(/\/articles\/(\d{4})\/(\d{2})\/(\d{2})\//);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function resolvePubDate(row) {
  if (row.publishdate) return toFeedDate(row.publishdate);
  const pathDate = extractDateFromPath(row.path);
  if (pathDate) return toFeedDate(pathDate);
  if (row.lastModified) return toFeedDate(row.lastModified * 1000);
  return toFeedDate();
}
```

- **Pro:** Completely automatic — no author action needed.
- **Con:** Requires a date-in-URL authoring convention. Does not work for flat URL structures like `/articles/my-story`.

#### Option 3: Capture `firstModified` via EDS Admin API (automatic, accurate)

The EDS Admin API exposes the full version history of a page. The first publish date can be fetched programmatically:

```js
// Approximate — Admin API endpoint for page status
const statusUrl = `https://admin.hlx.page/status/{org}/{site}/{ref}{path}`;
// Response includes `live.lastModified` for the currently live version
// and potentially `preview.lastModified` for the preview
```

This is the most accurate "original publish date" but requires an auth token and an extra API call per article — impractical in a batch generator.

#### Recommendation for `Publishdate`

| Approach | Automation Level | Accuracy | Implementation Effort |
|----------|-----------------|----------|-----------------------|
| `lastModified` fallback (current) | ✅ Automatic | ⚠️ Drifts on re-publish | ✅ Already done |
| Date from URL path | ✅ Fully automatic | ✅ Stable | 🟡 Low (URL convention needed) |
| Admin API `firstModified` | ✅ Fully automatic | ✅ Most accurate | 🔴 High (auth + per-page API call) |
| Author-entered `Publishdate` (current) | ❌ Manual | ✅ Correct | — |

**Best practical approach:** adopt date-in-URL paths (`/articles/YYYY/MM/DD/slug`) — this gives automatic, stable publish dates with zero extra API calls.

---

### 5.3 Automating `Template`

The `template` field is used purely as an **inclusion filter** in `isArticle()`:

```js
function isArticle(row) {
  const isArticleTemplate = (row.template || '').trim().toLowerCase() === ARTICLE_TEMPLATE.toLowerCase();
  const isUnderArticlesFolder = row.path.startsWith(ARTICLE_FOLDER);
  return isArticleTemplate && isUnderArticlesFolder;
}
```

The dual condition (folder **and** template) exists to prevent false positives. There are three ways to remove the need for manual template entry:

#### Option A: Remove the template check — use folder path alone

```js
function isArticle(row) {
  return row.path.startsWith(ARTICLE_FOLDER);  // folder is sufficient
}
```

- **Pro:** Zero author input — any page under `/articles/` appears in the feed automatically.
- **Con:** Any non-article page accidentally placed under `/articles/` (landing page, category index) would appear in the RSS feed. Only safe if `/articles/` is a strict content folder.

#### Option B: Infer template from URL structure

If articles follow a predictable sub-path pattern (e.g., `/articles/YYYY/MM/DD/slug`), the template can be inferred:

```js
function isArticle(row) {
  // Match /articles/YYYY/MM/DD/slug pattern
  return /^\/articles\/\d{4}\/\d{2}\/\d{2}\//.test(row.path);
}
```

- **Pro:** No author action needed; date-in-URL is the implicit "this is an article" signal.
- **Con:** Requires the URL convention to be consistently followed by authors.

#### Option C: Inject `template` metadata automatically via a Document Authoring Template

In AEM EDS / Google Docs / SharePoint authoring, a **page template document** can have the `Template: Article Template` metadata row pre-filled and locked. When authors copy the template to create a new article, the metadata is already there — no manual typing required.

- **Pro:** Authors cannot forget or misspell it; the template carries it automatically.
- **Con:** Only prevents future omissions — existing pages without the field still need it added.
- **This is the recommended approach** if the dual-condition filter is to be kept.

#### Option D: Add a `category` index field and filter on that instead

Extend `helix-query.yaml`'s `article-index` to read a `category` metadata field:

```yaml
# helix-query.yaml — article-index
category:
  select: head > meta[name="category"]
  value: attribute(el, "content")
```

Then filter in the generator:

```js
function isArticle(row) {
  return row.path.startsWith(ARTICLE_FOLDER) && (row.category || '').toLowerCase() === 'news';
}
```

This replaces a generic "template" signal with a semantically richer "content category" signal — and can still be pre-filled in the authoring template.

---

### 5.4 Recommended Combined Approach

| Goal | Recommended Change | Effort |
|------|--------------------|--------|
| Eliminate manual `Publishdate` | Adopt `/articles/YYYY/MM/DD/slug` URL convention + extract date from path in generator | Low |
| Eliminate manual `Template` | Pre-fill `Template: Article Template` in the Article authoring template document | Minimal |
| Fully remove template dependency | Drop template check; rely on `/articles/` folder + date URL pattern | Low |

**Minimal code change to `generate-article-rss.js` to support date-from-path:**

```js
// Add this helper
function extractDateFromPath(rowPath) {
  const match = rowPath.match(/\/articles\/(\d{4})\/(\d{2})\/(\d{2})\//);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

// Update resolvePubDate
function resolvePubDate(row) {
  if (row.publishdate) return toFeedDate(row.publishdate);        // explicit wins
  const pathDate = extractDateFromPath(row.path);
  if (pathDate) return toFeedDate(pathDate);                       // from URL
  if (row.lastModified) return toFeedDate(row.lastModified * 1000); // fallback
  return toFeedDate();
}
```

No changes to `helix-query.yaml` are needed for this — `publishdate` can remain in the index as an optional override; if absent the path-derived date takes over.

---

## 6. What Is the Body Selector Limitation of `@adobe/helix-shared-indexer` (ref: 4.6.1)?

### 6.1 What Is It?

The **body selector limitation** is the fact that **CSS selectors targeting the `<main>` body of a page (or any element inside it) do not work in `helix-query.yaml` when the content source is AEM Sites (Universal Editor / BYOM)**.

The version reference **4.6.1** corresponds to a known behaviour in `@adobe/helix-shared-indexer` — the package the EDS platform uses internally to evaluate `helix-query.yaml` index expressions. In that version, body-scoped selectors are silently skipped (returning an empty string) for AEM Sites-sourced content, even when the YAML syntax is correct.

This was documented during work on the sibling project `aig-aem-eds-poc` (AEM Sites content source), where three separate attempts to index page body text all failed — the property always came back empty in `query-index.json`. The `docs/search.md` in this project explicitly records that observation and explains why it does **not** apply here.

---

### 6.2 Why Does It Happen?

The EDS indexer pipeline works differently depending on content source:

| Content Source | How Pages Are Indexed | Body Selectors Work? |
|---------------|----------------------|----------------------|
| **Google Drive / SharePoint / DA (this project)** | Indexer fetches the page's rendered `.plain.html` output from the EDS CDN and runs `helix-query.yaml` selectors against that HTML | ✅ Yes — `main`, `main .video-feature a`, etc. all resolve correctly |
| **AEM Sites (Universal Editor / BYOM)** | Content is sourced via AEM's Content Fragment / Page API; the indexer processes a metadata-only representation, not a full rendered HTML page | ❌ No — `<main>` and body-level elements are absent from the indexable representation |

In AEM Sites mode, the indexer only has access to page-level metadata (`<head>` meta tags, HTTP headers), not the rendered body. Therefore, any `select:` that targets anything inside `<main>` or below `<body>` **evaluates to nothing** — no error is thrown, no warning is logged to the index log, the column is simply empty for every page.

The `@adobe/helix-shared-indexer` uses `hast-util-select` (a CSS selector engine for HAST trees) to evaluate selectors. The CSS selector syntax itself (`main .video-feature a`, `main h1`) is entirely valid — `hast-util-select` supports descendant and child combinators. The problem is entirely upstream: the HAST tree the indexer receives for AEM Sites pages simply contains no `main` element to select from.

---

### 6.3 Concrete Symptoms on the Sibling Project (`aig-aem-eds-poc`)

The sibling AEM Sites project attempted the following `helix-query.yaml` entries for body text indexing:

```yaml
# Attempt 1 — identical to what works in this repo
bodyText:
  select: main
  value: words(textContent(el), 0, 300)

# Attempt 2 — narrower selector, same result
bodyText:
  select: main > div p
  value: textContent(el)

# Attempt 3 — selectFirst variant, same result
bodyText:
  selectFirst: main p
  value: textContent(el)
```

All three returned an empty string for every page in `query-index.json`. The YAML syntax was never the problem — the same `words(textContent(el), 0, 300)` expression works correctly in this repo.

---

### 6.4 Why This Project (DA/git-authored EDS) Does NOT Have This Limitation

This project uses **Document Authoring (DA) / git as the content source** — pages are authored in Google Docs/SharePoint/DA and published to the EDS CDN as rendered HTML. When the indexer runs:

1. It fetches `https://{branch}--{site}--{org}.aem.page/{path}.plain.html`
2. That response contains the full rendered `<main>` content
3. `hast-util-select` can traverse and select any element within it

This is why `helix-query.yaml`'s existing body selectors in this repo work:

```yaml
# helix-query.yaml — these all work because source is DA/git
bodyText:
  select: main                         # ✅ full main content
  value: words(textContent(el), 0, 300)

videourl:
  select: main .video-feature a        # ✅ body-scoped selector works
  value: attribute(el, "href")

videothumbnail:
  select: main .video-feature img      # ✅ body-scoped selector works
  value: attribute(el, "src")
```

`video-index.json` is living proof — `videourl` and `videothumbnail` columns are populated from body-scoped selectors for pages that have a `video-feature` block.

---

### 6.5 Implications for This Project

| Situation | Impact |
|-----------|--------|
| This project stays on DA/git content source | ✅ No limitation — body selectors work, `bodyText` in `query-index` is populated |
| This project migrates to AEM Sites (Universal Editor) as content source | ⚠️ Body selectors break silently — `bodyText`, `videourl`, `videothumbnail` all go empty |
| A migration to AEM Sites is planned | The `video-index` and `query-index.bodyText` need architectural redesign — likely a dedicated AEM search servlet or a separate indexing pipeline that has access to rendered content |

---

### 6.6 Workarounds If AEM Sites Content Source Is Adopted

If the project ever moves to AEM Sites-sourced content, body-indexed fields require one of:

1. **Store the value in page metadata (`<head>`)** — Any field that needs to be indexed must be surfaced as a meta tag. For body text, this means adding a `description`-style meta that is pre-populated from page content by AEM's page properties.

2. **Use a custom AEM servlet / GraphQL endpoint** — Build a server-side search index (e.g. via AEM's built-in Lucene/Oak index, or a dedicated `query-builder` servlet) and query it directly instead of `query-index.json`.

3. **Use Adobe Experience Platform (AEP) Data Collection** — Index page content via client-side data collection at publish time, feeding a separate search index (Algolia, Elasticsearch, Adobe Search & Promote successor).

4. **Hybrid approach** — Keep the EDS platform's metadata index for title/description/path, and use a separate full-text index (option 2 or 3) for body-level search. The `search-results` block already supports this pattern — it merges two separate sources (`query-index.json` + document-search proxy) using `Promise.allSettled`.

---

## Related Files

| File | Purpose |
|------|---------|
| `helix-sitemap.yaml` | Configures the platform-generated `/sitemap.xml` |
| `helix-query.yaml` | Defines all query indices (`query-index`, `video-index`, `article-index`) |
| `video-sitemap.xml` | Committed video sitemap artifact (5 entries as of last run) |
| `article-really-simple-syndication.rss` | Committed RSS feed artifact |
| `tools/generate-video-sitemap.js` | Video sitemap generator script |
| `tools/generate-article-rss.js` | RSS feed generator script |
| `.github/workflows/video-sitemap.yaml` | Daily workflow: generate + commit `video-sitemap.xml` |
| `.github/workflows/article-rss.yaml` | Daily workflow: generate + commit RSS feed |
