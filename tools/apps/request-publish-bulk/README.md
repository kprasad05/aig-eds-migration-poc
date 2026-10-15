# Request Publish for Multiple Pages

This DA app creates ordinary publish requests through the existing Worker,
one page at a time. It does not publish pages or send a bulk submission payload.

## Local development

From the repository root:

```sh
aem up --no-open --forward-browser-logs --stop-other=false \
  --url https://main--aig-eds-migration-poc--kprasad05.aem.page
```

Sign in to DA and open:

```text
https://da.live/app/kprasad05/aig-eds-migration-poc/tools/apps/request-publish-bulk/request-publish-bulk?ref=local&env=prod&org=kprasad05&site=aig-eds-migration-poc
```

`ref=local` loads local app code inside the authenticated DA shell.
`env=prod` uses the existing production publish-request Worker; submission can
create real requests and send emails. `env=ci` selects the CI Worker. Without
an environment override, localhost expects a Worker at localhost:8787.

## Two input flows

- **Paste paths:** enter one site-relative path or page URL per line.
- **Translation project:** load active projects for the selected organization
  and site. Select a project title and the completed destination folders to
  include. Review the generated page paths before validating.

Use the **Select all destination folders** checkbox to select or deselect all
completed destination folders at once. It shows a mixed state when only some
folders are selected. Selection changes update the generated paths and clear
previous validation results; validate the new selection before submitting.

Projects are listed using authenticated
`GET https://admin.da.live/list/{org}/{site}/.da/translation/active`.
The list supplies file paths, not titles. Projects are ordered by most recently
modified, with three entries per page. The app asynchronously reads only the
visible page's project JSON files from `https://content.da.live{projectPath}`
to obtain titles and completion information. A spinner indicates loading.
Previous/Next loads another page on demand; changing pages clears the selected
project and validation results. The selected project is re-read before its
destination folders are displayed. Refresh projects reloads the list and returns
to page one; Reload page retries failed project reads on the current page.

Paths combine each selected URL's `basePath` with the destination folder.
When `basePath` is absent, the app derives it from `suppliedPath` by removing
the project's source-language folder. A language's `location` is its
translation/copy destination; `locale.code` is a separate rollout destination,
not a suffix to append to the language folder.

The translation flow only offers destination folders matching `/<lang>/<country>`.
Language-only pages such as `/fr/fragments/test` are intermediate translation
content, not publish destinations. For example, a completed translation in `/fr` with a
completed rollout to `/fr/ca` offers `/fr/ca/fragments/fragment-test`, never
`/fr/fragments/fragment-test`. A completed translation or copy directly into
a language/country folder is still eligible without a rollout. A completed
translation or copy into `/es` with base path `/pr/press-release` also qualifies:
its saved path is already `/es/pr/press-release`. The app groups these paths
under their configured active locale (such as `/es/pr`), without requiring
rollout status or appending the country again. Locale saved counts describe
rollouts and are not required for these directly saved translations/copies.
The app does not invent a country or infer a country rollout from translation
completion. This rule
does not restrict manually pasted paths.

Only completed translation/copy destinations and completed active locale
rollouts are selectable. Saved counts, when supplied, must cover all selected
source URLs. Status `translated` alone is not saved completion. A translated
language does not imply its locale rollout completed.
Unchecked URLs, incomplete destinations, and snapshot projects are excluded
or reported as unsupported. Individual pages in a partially completed
destination are not inferred to be complete.

## Validation and explicit preview

**Validate** is read-only. It checks pending requests, confirms each valid
page exists via authenticated DA Source API GET, and reads AEM Admin status.

Duplicate detection combines the caller's requester queue
(`GET /api/requests?role=requester`) and the same approver inbox used by the
Publish Requests Inbox app (`GET /api/requests` without a role). A page requested
by another author is skipped if it is visible in that inbox. Neither endpoint
provides a guaranteed site-wide duplicate check for requests the caller cannot
see. Submission stops if either queue cannot be checked. Retry reconciliation
uses the caller's own queue to confirm their failed submission was saved.

Pending pages receive the same source and preview checks. Their results show
both **Already pending** and preview freshness (or a missing page/validation
error), with timestamps where available. Stale or missing previews can be
refreshed explicitly using the selected-pages preview action. Refreshing
a pending page does not create another request or make it eligible for
resubmission; it remains pending even when its preview is current.

Content checks use:

```text
GET https://admin.da.live/source/{org}/{site}/{path}.html
GET https://admin.hlx.page/status/{org}/{site}/main/{path}?editUrl=auto
```

The source extension is retained for resources such as `.json`; `.html` is
added to extensionless document paths.

The comparison is between the DA source response's `Last-Modified` header and
`preview.sourceLastModified` from AEM status. `preview.lastModified` is when
the preview was generated, not the version of source included in it.
All three timestamps are displayed where available. Dates are compared at
the precision provided by those APIs; this is not a content-hash or
immutable-version guarantee.

Missing, stale, or unverifiable previews block that page's submission.
Authors select one or more page checkboxes and use
**Preview / refresh selected (N)**. The **Select all pages
needing preview** checkbox selects or deselects all missing, stale, or
unverifiable previews, including already-pending pages, and shows a mixed state
for partial selection. No pages are selected by default. Selection is cleared
when validating again or changing input; pages confirmed current are removed
from the selection after refreshing. Selection controls are disabled while
the app is busy. The app rechecks timestamps after previewing and never
automatically previews just because Validate or a checkbox was clicked.

Submission rechecks pending requests and source/preview freshness before
creating each request. A later source edit can still occur after this check;
requests are path-based rather than pinned to a source revision.

## Errors and retries

Errors are shown inline and through DA's shared toast component:
`https://da.live/nx2/blocks/shared/toast/toast.js`.
Console messages use the `[Request Publish Bulk]` prefix and never include
tokens or authorization headers.

Preview and validation failures block submission. Request submission failures
are treated as potentially saved, including HTTP 400 email failures. **Retry
failed** checks the pending queue first and does not resubmit saved requests.
Email suppression and consolidation are not supported by this app.

## Targeted checks

```sh
node --experimental-default-type=module --experimental-vm-modules \
  --test tools/apps/request-publish-bulk/tests/*.test.mjs
npx eslint --no-ignore tools/apps/request-publish-bulk/*.js
npx stylelint tools/apps/request-publish-bulk/request-publish-bulk.css
```
