# Start Translation Workflow — interactive POC

A standalone DA app for selecting multiple pages/fragments, choosing French
and/or German, creating a translation project, calling the configured Google
connector, saving translated HTML, and retrieving per-page progress later.
It does **not** add a button to Adobe's content-browser toolbar.

## Agreed scope

- Uses the author's existing DA SDK session, in memory only.
- English `/en` → French `/fr` and German `/de`; initially browse `/en/fragments`.
  Thus `/en/fragments/example.html` maps to `/fr/fragments/example.html` and
  `/de/fragments/example.html`. Other HTML pages under `/en` are also selectable.
- At most 25 selected source pages per project. Folder selection is not recursive.
- **Foreground only. Keep the app open during execution.** Closing/navigating away
  stops execution. There is no queue, Worker, token storage, or unattended runner.
  A request already sent to a remote service may still finish after the app closes.
- No regional rollout or source synchronization. This app does not preview,
  publish, or submit publish requests itself; it can hand reviewed destinations
  to the existing publish-request app.
- Existing destinations require manual review and are not intentionally overwritten.
  Use new test source names whose corresponding target paths do not already exist.
- Native translation project storage, plus app-specific task metadata. Native
  dashboard compatibility and tenant execution still require validation.

The earlier new-Worker proposal was superseded by the choice to use an interactive
session-bound POC. A backend and approved renewable/delegated authentication remain
necessary for unattended execution.

## Prerequisites

1. The author is signed into DA and can read the source folder and translation
   configuration, write the target folders, and read/write/list
   `/.da/translation/active/`. Dot folders are **not** access controls; configure DA
   permissions appropriately.
2. Site `/.da/translate.json` (or org configuration if the site file is absent)
   contains `config` and `languages` sheets. No default configuration is silently
   substituted.
3. `config` rows include:

   | key | value |
   | --- | --- |
   | translation.service.name | Google |
   | source.language | English |

4. `languages` includes English (`code=en`, `location=/en`), and French
   (`code=fr`, `location=/fr`) and/or German (`code=de`, `location=/de`) with
   `Translate` in their comma-separated `actions`. The English language row's
   `name` must match `source.language`. Targets with a different `source language`
   dependency or different destination folders are not offered by this POC.
   Unavailable targets are not invented or added to the site's configuration.
5. Google translation is configured and authorized for this DA org/site.
   Translation may incur provider charges.
6. A current browser with native dialogs, Web Crypto and Web Locks, such as Chrome.

If configuration cannot be read or does not match this POC, the app shows an
explicit error. It does not change your DA configuration.

## Open the app

After this branch's code has been pushed and synchronized, open inside DA:

```text
https://da.live/app/kprasad05/aig-eds-migration-poc/tools/apps/start-workflow/start-workflow?ref=poc-workflow&org=kprasad05&site=aig-eds-migration-poc
```

For local code, start the AEM CLI from the repository root:

```sh
npx -y @adobe/aem-cli up --no-open --forward-browser-logs --stop-other=false \
  --url https://main--aig-eds-migration-poc--kprasad05.aem.page
```

Then open:

```text
https://da.live/app/kprasad05/aig-eds-migration-poc/tools/apps/start-workflow/start-workflow?ref=local&org=kprasad05&site=aig-eds-migration-poc
```

No Prepare plugin or toolbar injection is required. Launch it through DA, not as
a signed-out standalone site page. Local app code still operates on **real DA
content** using your session; it is not a sandbox or dry-run.

### Site apps tile

DA's Apps landing page supports site-specific tiles through the site's DA
configuration `apps` tab. This is separate from repository code deployment and
from Adobe's built-in **For automators** cards.

For this POC, **Start Translation Workflow** is registered in the
`kprasad05/aig-eds-migration-poc` site configuration with `ref=poc-workflow`.
Open:

```text
https://da.live/apps?ref=poc-workflow#/kprasad05/aig-eds-migration-poc
```

Find **Start Translation Workflow** under **Site apps** and choose **Go**.
The tile launches the pushed `poc-workflow` app code, not local uncommitted code.
Use the `ref=local` direct app URL above to test local changes.

The configuration row has `title`, `description`, `image`, `path`, and `ref`
fields. `path` is the complete DA app launch URL and `ref` is `poc-workflow`.
An empty image uses DA's default card image. Existing app rows without a
reference have the same behavior as `ref=main`.

The plain `/apps` URL without a site hash does not show site-specific tiles.
Branch-specific tiles are visible when the gallery's `ref` matches the row's
reference (or the gallery uses its development filter). No merge to `main` is
required for the branch tile. To promote it later, update both the configuration
row's `ref` and its launch URL after the app code is available on the target
branch. Do not change only one of them.

## Author flow

1. Browse `/en/fragments` or another `/en` folder.
2. Check source pages. Selections persist across folder navigation. Review/remove
   entries in the selected list.
3. Click **Start Workflow**, enter a title, select configured targets, and review
   every generated destination. Cancel/Escape performs no translation or writes.
4. Choose **Create project and run**. Sources are read and fingerprinted before
   project creation. Keep the app open.
5. Review per-page status, attempts and errors. **Pause after current task** waits
   for the current task and its checkpoint before stopping.
6. After reopening, choose a saved workflow or enter its ID. Loading is read-only
   and never resumes automatically.
7. **Resume / retry unfinished tasks** reloads persisted progress, skips confirmed
   saves, reconciles uncertain saves, and retries unfinished unblocked tasks.
8. Use **Open in DA** on a completed destination to review the translated document.
9. Check **Reviewed** for each completed destination to include in a publish
   request, then choose **Continue to Publish Request (N)**.
10. The bulk publish-request app opens in a new tab with just those paths prefilled.
    Validate, explicitly preview missing/stale pages, add a comment as required,
    then choose **Request Publish**. Merely opening the app does not validate,
    preview, submit requests, send emails, or publish.

## Publish-request handoff

This reuses `../request-publish-bulk/` and the existing external approval Worker.
Only confirmed saved destinations are selectable, including successful tasks from
a partially failed translation project. French/German language-only paths are
passed through the editable **Paste paths** flow; the existing project picker's
language/country eligibility policy is unchanged.

Review selections are local UI confirmations, cleared on project reload,
retrieval, or resume. They are not persisted review records or a backend-enforced
sign-off gate. Review any subsequent edits again before requesting approval.
The receiving app treats imported data as untrusted editable input and still
performs its normal source, preview-freshness, and duplicate-request checks.

The DA launch link carries a bounded `workflowHandoff` query containing a version,
org/site, workflow ID and at most 50 unique extensionless destination paths. It
contains no tokens, source/translated content or credentials. The receiver rejects
malformed, wrong-site, duplicate, non-target and oversized payloads. Overlong
links require smaller batches; paths are never silently truncated. Workflow/path
metadata will appear in the browser URL/history.

The handoff preserves `ref=local` or the current branch reference. It explicitly
selects `env=prod` by default so local frontend testing can use the existing
deployed approval service instead of requiring a local Worker on port 8787.
Opening the translator with `env=ci` carries that setting to the receiving app.
**Submitting a request to production creates real request records and can send
real approval emails.** Neither continuing nor validating sends approval emails.

The existing approval infrastructure must be configured separately:

- Worker available, authorized for the author, and able to send email.
- DA `publish-workflow-config` rules covering the selected French/German paths.
- Any distribution-list mappings and comment requirements configured.
- Author write permission for the publish-requests sheet.
- Approver access to the inbox and permission to publish the target content.

The approver uses the existing email link/inbox and **Approve & Publish**. No
approval rules or email templates were changed. Approval notifications and actual
publishing remain tenant acceptance checks, not results of the mocked tests.

### Local handoff acceptance test

1. Run the local AEM CLI and open the `ref=local` translator URL above.
2. Retrieve an already-completed workflow; no new translation run is necessary.
3. Review one destination with **Open in DA**, then check its **Reviewed** box.
4. Choose **Continue to Publish Request (1)**. Confirm the new app URL has
   `ref=local&env=prod` and the correct org/site, and only the selected path is
   prefilled. No request should yet exist.
5. Click **Validate**. If a preview is missing/stale, select the page's preview
   checkbox and use **Preview / refresh selected**, then confirm it is ready.
6. Add a comment and explicitly choose **Request Publish** when ready to create a
   real request/email.
7. As the configured approver, open the notification/inbox, inspect the preview,
   and approve/publish only if the test content is intended to go live.

## Execution and persistence

The app uses authenticated DA Admin `list` and `source` requests, including list
continuation tokens. Project files are stored at:

```text
/.da/translation/active/workflow-{uuid}.json
```

Each project includes native-style `org`, `site`, `title`, `urls`, `langs`,
`options`, `view`, dates, and language translation counts, plus a `workflow`
namespace with `mode=interactive-google-v1` and per-source/per-target tasks.
The UUID is the app/native project identifier. Google is called synchronously;
there is no separate provider job ID or provider status polling endpoint here.
No source/translated HTML, session tokens, or credentials are persisted in
project metadata.

The adapter calls:

```text
POST https://translate.da.live/translate/google/{org}/{site}
multipart: data=<HTML>, fromlang=en, tolang=fr|de
```

It reuses native DA `addDnt`/`removeDnt` and Google HTML split/rejoin helpers so
block structures, icons, metadata and configured do-not-translate rules follow
the native path. Each chunk and HTTP response is checked. Destination HTML is
saved with DA Source multipart `data`. A translation response alone does **not**
count as a confirmed save.

### Task states and retries

| State | Meaning |
| --- | --- |
| queued | Not executed yet |
| translating | Provider operation in progress, or interrupted if app closed |
| saving | Output hash checkpoint saved; destination save may be in flight |
| complete | Destination was read back and matched the expected output SHA-256 |
| failed | Source/provider/read failure; eligible for explicit retry |
| save-unconfirmed | Save response/readback uncertain; retry checks destination first |
| needs-review | Source revision changed or destination exists/differs; blocked |

The project persists source SHA-256, configuration SHA-256, output SHA-256 before
save, attempts, errors, and verified-save timestamps. A retry that finds matching
output completes the task without another write or translation. Missing output
may require another Google request and additional charges. A changed source or
configuration requires a new project; existing workflow inputs are not silently
updated. Readback normalization by DA can cause an exact-hash mismatch requiring
manual review.

Status checkpoints are serialized with content writes. Failure to persist
progress stops execution rather than continuing untracked writes. Language
`saved` counts only confirmed destination saves, not provider success.

### Concurrency and native integration limits

- Web Locks prevent two app instances in the same browser/origin running for
  the same site simultaneously. This is **not** a cross-device or cross-origin
  distributed lock.
- Destination existence is checked before translation and immediately before
  save; the source fingerprint is rechecked before saving. A remote edit can
  still race between the final read and the DA write: an atomic conditional
  create/lock contract has not been verified. **Use isolated test paths and do not
  edit them or execute another client against them during a run.** This POC is
  not safe for concurrent production writers.
- Do not run, edit, archive, or resave these projects through native Translate
  while this app owns them. The native schema and helper imports are internal
  contracts, not a verified stable public workflow API.
- Native integration was checked against `adobe/da-nx` revision
  `f0c63255bc8ce34f79d6908d98351bb3d426e927`, especially
  `nx/blocks/loc/{utils/utils.js,connectors/google/index.js,dnt/dnt.js}`.
  Runtime helper imports use DA's deployed version; upstream changes can require
  adapter updates. No upstream modules are copied into this repository.

## Validation

Run from the repository root:

```sh
node --experimental-vm-modules --test tools/apps/start-workflow/tests/*.test.mjs tools/apps/request-publish-bulk/tests/*.test.mjs
npx eslint --no-ignore tools/apps/start-workflow/*.js tools/apps/request-publish-bulk/handoff.js tools/apps/request-publish-bulk/request-publish-bulk.js
npx stylelint 'tools/apps/start-workflow/*.css'
```

Node's VM modules flag is needed by the existing repository's browser-ESM test
pattern. Tests use installed Playwright for real Chromium UI checks with mocked
DA/Google responses. They never contact the real provider or write tenant content.
Repository-wide JS lint normally ignores `tools/`, so the focused command uses
`--no-ignore`; repository-wide CSS lint does not cover app styles.

Coverage includes multi-selection, target wizard/cancel, native-shaped project
creation, partial provider failure, reload/status retrieval, actual save
confirmation, idempotent retry, source/config drift, existing destinations,
permission/session errors, chunking contract, checkpoint failure and pause.

Before calling the tenant POC accepted, execute two uniquely named test fragments
against both configured targets, verify DA permissions/provider quotas and DNT
behavior, close/reopen to retrieve status, and review native dashboard rendering.
Also verify partial failure and safe retry with the tenant's actual responses.
These authenticated acceptance checks cannot be inferred from mocked tests.
