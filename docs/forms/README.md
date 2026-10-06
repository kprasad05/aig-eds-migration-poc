# Forms POC: integration, authoring and submissions

## Status and compatibility

This repository is a vanilla EDS site using Document Authoring (DA), not an AEM
XWalk/Universal Editor site. It had no `scripts/editor-support.js`, `models/`
directory, root component registries, or `build:json` script before this change.
The existing block was **`blocks/form`**, not `blocks/forms`.

The [existing-project tutorial](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/edge-delivery/build-forms/getting-started-edge-delivery-services-forms/tutorial#add-adaptive-forms-block-to-your-existing-aem-project)
is the integration reference. Its section filters, component registries and
editor patches target Universal Editor. Here:

- The official runtime and its dependencies are imported; the existing EDS loader
  continues to load blocks normally. `scripts/aem.js` is unchanged.
- DA authors use a **Form table containing a JSON hyperlink**, not XWalk field
  editing. Component JSON registries do not configure DA's table editor.
- A small Forms-only editor adapter loads official editor support only when the
  page has the `adobe-ue-edit` class. No editor runtime loads for normal DA pages.
  This is not a conversion of the site to Universal Editor.
- Forms definitions, models and filters are generated separately, without
  replacing any site component configuration. The new section filter retains
  all existing block names and adds `form`, `embed-adaptive-form` and
  `forms-recaptcha`. It does not invent XWalk models for the site's DA blocks.
- No `fstab.yaml` or remote content-source configuration is changed. The
  existing DA sheet already delivers JSON from this same site.

### Imported source and license

Upstream: [adobe-rnd/aem-boilerplate-forms](https://github.com/adobe-rnd/aem-boilerplate-forms),
pinned commit `7a7b6461da2fc84cc077f7b6b3285652914c9a8b`.

Imported:

- `blocks/form/`: complete official runtime, transforms, components, rule
  engines, integrations, field models and `_form.json`.
- `blocks/embed-adaptive-form/`: optional fragment embedding block and model.
- `scripts/form-editor-support.js` and `scripts/form-editor-support.css`.
- Upstream `LICENSE` preserved in both imported block directories. It states
  that the Adaptive Form Block is **Adobe Proprietary**, not open source, and
  requires the applicable enterprise AEM Forms Edge Delivery Services license.
  The user confirmed the required license and authorization before importing.

Project adaptations:

- All runtime/component styles are scoped to `.form`; upstream global `:root`,
  universal and unscoped form selectors no longer affect the CAPTCHA demo or
  other blocks. The upstream wrapper-only card treatment is removed.
- Base Form CSS uses the `adaptive-form` cascade layer and imports
  `site-theme.css`. The theme reuses site typography, colors, spacing and buttons,
  with one-column mobile and two-column contact fields from 600px.
- The upstream restrictive email pattern is corrected to accept common valid
  addresses, including plus addressing and long top-level domains. Native
  `type=email` validation is retained.
- Definition fetch failures now report HTTP errors and show a visible form-load
  error instead of leaving an unexplained link.
- Submission feedback is accessible (`role=status` / `role=alert`), failures log
  explicitly and keep entries, stale feedback clears on retry, and `aria-busy`
  tracks submission. Rebuilt forms retain their configuration after reset.
- The official submission endpoint and payload construction are retained;
  no custom backend, credentials or alternate submission framework is added.

Generated/bundled `rules/model`, `rules/formula` and `rules/functions.js` are
excluded from ESLint as recommended by Adobe. All other imported runtime code
remains linted. Console logging is allowed only for imported Forms runtime/editor
files; the official editor's existing alert is allowed only in that file.
Editor CSS has one scoped specificity exception; color syntax is auto-fixed to
the site's Stylelint version. No repository-wide lint rule is disabled.

## 1. Preserve the reCAPTCHA demonstration

Renamed:

| Previous file | New file |
| --- | --- |
| `blocks/form/form.js` | `blocks/forms-recaptcha/forms-recaptcha.js` |
| `blocks/form/form.css` | `blocks/forms-recaptcha/forms-recaptcha.css` |

The CSS now uses `.forms-recaptcha`, and label/input IDs have a
`forms-recaptcha-` prefix. Existing imports of `scripts/config.js` and
`scripts/recaptcha-verify.js` remain unchanged.

**Important:** this original demo already POSTs its fields and CAPTCHA token to
`https://aig-aem-eds-poc.vercel.app/api/recaptcha-verify` for verification.
That behavior is preserved by request. It does not use Adobe's spreadsheet
submission service. The proxy documentation says it logs values server-side;
do not treat it as a no-network or no-data-transmission demo.

The existing public `/contact-us.plain.html` was inspected and uses the old
`Form` table with title/description/success/error-page rows. **Before deploying
this code**, copy that demo to a separate DA page such as `/forms-recaptcha` and
rename its table heading to **Forms Recaptcha**. Keep all four rows in place:

| Forms Recaptcha |
| --- |
| reCAPTCHA demonstration |
| Verify that you are human. |
| Thanks -- CAPTCHA verification succeeded. |
| [Verification failed](/form-error) |

Update other old `Form` demo tables to the new heading as well. No authenticated
DA content inventory was available; `/contact-us` is confirmed, but other DA
pages still need an author search. Local references were inspected; there was no
authored demo in tracked drafts. The public `recaptcha-site-key` remains in
the existing DA `/config` sheet. Private Google keys stay in the proxy service.
Google must permit the hostname used for testing (including localhost if used).

The preserved demo is available locally at `/drafts/forms-recaptcha`.

## 2. Define Contact Us in your existing DA sheet

Use the existing
[we-finance DA sheet](https://da.live/sheet#/kprasad05/aig-eds-migration-poc/we-finance).
A DA sheet is suitable as the **form definition**. It is not currently documented
as a writable submission destination for Adobe's service.

On inspection, both preview and live `/we-finance.json` returned HTTP 200 with:

```json
{"total":1,"limit":1,"offset":0,"data":[{}],":type":"sheet"}
```

That is the single-sheet envelope consumed by the official runtime. The empty
sheet still needs the field rows.

1. Open the DA sheet. Its current tab is named `data`; the existing delivery
   proves that this DA tab is converted to a single-sheet JSON response.
2. Copy [contact-us-definition.csv](./contact-us-definition.csv) into a spreadsheet,
   then paste its rectangular cells into DA, beginning at A1. Keep header spelling
   and case exactly as provided.
3. Replace `REPLACE_WITH_DESTINATION_SPREADSHEET_URL` in the Submit row's
   **Action** cell with the actual Google Sheets or OneDrive/SharePoint sharing
   URL after completing destination setup below.
4. Save, preview and publish the DA sheet using its authoring controls.
5. Check the delivered JSON: it must contain `":type":"sheet"`, a `data` array
   of eight rows, and the headers as keys. Do not use a multi-sheet envelope.
6. Reference that JSON hyperlink from the DA Form table.

The complete template is:

| Name | Type | Label | Mandatory | Placeholder | Value | Action | Required Error Message | Pattern Error Message | Max |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| firstName | text | First Name | true | First name | | | Please enter your first name. | | 100 |
| lastName | text | Last Name | true | Last name | | | Please enter your last name. | | 100 |
| email | email | Email | true | you@example.com | | | Please enter your email address. | Please enter a valid email address. | 254 |
| phone | tel | Phone Number | | Phone number | | | | | 50 |
| company | text | Company | | Company | | | | | 200 |
| subject | text | Subject | | Subject | | | | | 200 |
| message | textarea | Message | true | How can we help? | | | Please enter a message. | | 5000 |
| submit | submit | Submit | | | Thank you. Your message has been sent. | REPLACE_WITH_DESTINATION_SPREADSHEET_URL | | | |

`Type=textarea` maps to the official multiline component. `Mandatory=true`
sets required validation; `email` uses native email validity and a pattern.
Optional fields have an empty Mandatory cell. Submit `Value` is the inline
confirmation text, not a value stored in the destination.

### Excel/Google Sheets definition alternative

The same CSV can be imported into Excel or Google Sheets if the definition is
hosted there instead. Adobe's Forms tutorial specifies **`helix-default` or
`shared-aem`** as the definition worksheet names for that workflow. These are
not a reason to reject the already-delivered DA `data` tab.

For a workbook that also contains an `incoming` tab, check the published JSON
carefully: the block needs the selected sheet in single-sheet format, not
`":type":"multi-sheet"`. The general EDS spreadsheet pipeline documents
`shared-*` selection and `?sheet=...`; actual delivery shape must be verified.
The DA definition and separate response workbook avoid exposing response rows.

CSV is the importable POC deliverable; an `.xlsx` binary is not required.
`npm run build:forms-fixture` reproducibly generates the CSV, incoming header
template and local JSON fixture from `tools/build-forms-fixture.cjs`.

## 3. Configure real submission storage (manual external work)

Adobe's
[Forms Submission Service](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/edge-delivery/build-forms/forms-submission-service)
documents **Google Sheets, Microsoft OneDrive and SharePoint** destinations.
It does not document DA sheets as writable destinations. Defining the fields in
DA and storing responses in Excel/Google Sheets are distinct operations.

Prerequisites:

- A valid AEM Forms Edge Delivery Services license.
- Repository/site approval on the Forms Submission Service allowlist.
- Confirmation from Adobe that the service can resolve this site's
  DA-published definition and its external destination **Action**. Client-side
  JSON consumption is verified independently; service-side DA resolution and
  authorization require an actual end-to-end test.
- A destination workbook you control and permission to grant Adobe write access.

Steps:

1. Create a Google spreadsheet or Excel workbook on OneDrive/SharePoint.
2. Add a worksheet named exactly **`incoming`** (lowercase).
3. Paste the single header row from [incoming.csv](./incoming.csv):

   ```csv
   __id__,firstName,lastName,email,phone,company,subject,message
   ```

   Field names must match the definition `Name` values exactly. `__id__` is
   generated by the official client; its column captures that additional payload
   property rather than an authored input. Do not include a `submit` data column.
   For Excel, select the headers and an empty row beneath them, choose
   **Insert > Table**, confirm **My table has headers**, and set the table name
   to exactly **`intake_form`** under **Table Design**. `incoming` is the
   worksheet name; `intake_form` is the Excel table inside it. This Excel-specific
   step does not apply to Google Sheets.
4. Share the destination with **`forms@adobe.com`** with Editor/Edit permission.
   Adobe's setup guide also calls for Google link-view access or a Microsoft
   link-edit sharing URL. Follow your organization's data/security policy;
   if anonymous access is disallowed, obtain Adobe's approved alternative rather
   than weakening access. Never publish the `incoming` rows as site content.
5. Copy the destination sharing URL into the DA definition's Submit **Action**
   cell. Do not paste a DA editor URL as a response-storage destination.
6. Preview and publish the updated definition and form page. Follow any destination
   registration/Sidekick publishing steps Adobe requires for your tenant.
   Do **not** replace this site's DA content source with the tutorial's
   Google Drive `fstab.yaml`: that would change existing content delivery.
7. Run the real test on an approved preview/live hostname, using a clearly marked
   test entry. Confirm the network response and then inspect `incoming` for
   the corresponding row. A confirmation banner alone is not storage evidence.

### Client request and endpoint

The imported **document-based** submission code sends:

```text
POST https://forms.adobe.com/adobe/forms/af/submit/{base64(definition-path.json)}
Content-Type: application/json
x-adobe-form-hostname: <current browser hostname>
```

For this definition the path is `/we-finance.json`. The JSON body is:

```json
{
  "data": {
    "__id__": 123456789,
    "firstName": "Test",
    "lastName": "User",
    "email": "test@example.com",
    "phone": "",
    "company": "",
    "subject": "",
    "message": "Test submission"
  }
}
```

The **Action cell is service-side routing configuration** in the published
definition; this version's client does not POST directly to Google/Microsoft.
Keep the official runtime's request construction rather than inventing a
different backend.

Adobe's separate direct-API documentation describes a form ID and
`x-adobe-routing: tier=live,bucket=main--aig-eds-migration-poc--kprasad05`.
That is a different documented API caller flow; this imported client uses
`x-adobe-form-hostname`. If Adobe reports a routing incompatibility for this
tenant, verify the supported client version/header with Adobe before changing
it. No service ID, approval or real spreadsheet write is asserted here.

On successful HTTP submission, a confirmation displays and fields reset. On
network or non-2xx failure, a visible alert displays, inputs remain, the button
re-enables and the failure is logged. Duplicate requests are blocked while busy.
Do not enter production personal data until destination access and storage have
been verified.

## 4. Embed the form in DA

Create/edit `/contact-us` in
[DA](https://da.live/edit#/kprasad05/aig-eds-migration-poc/contact-us).
Move the old CAPTCHA demo to `/forms-recaptcha` first.

Insert a **one-column table with two rows**:

| Form |
| --- |
| [Contact Us definition](https://main--aig-eds-migration-poc--kprasad05.aem.page/we-finance.json) |

The first row is the block heading, **Form** (singular). The second contains
an actual hyperlink, not just URL text. DA's EDS serialization yields:

```html
<div class="form">
  <div><div><a href="/we-finance.json">Contact Us definition</a></div></div>
</div>
```

A same-site relative `/we-finance.json` hyperlink follows preview/live delivery
automatically. If using an absolute link, use `.aem.page` while testing and
`.aem.live` for the production definition; do not ship a live page that depends
on unpublished preview content.

No DA mount change is required. Preview/publish the **sheet and page**, not just
the code. Optional `Embed Adaptive Form` is for form fragments; spreadsheet
definitions should use the normal **Form** table.

Expected URLs after code deployment and content preview/publication:

| Resource | URL |
| --- | --- |
| Feature preview page | https://forms-poc--aig-eds-migration-poc--kprasad05.aem.page/contact-us |
| Feature live-content page | https://forms-poc--aig-eds-migration-poc--kprasad05.aem.live/contact-us |
| Feature preview definition | https://forms-poc--aig-eds-migration-poc--kprasad05.aem.page/we-finance.json |
| Main production page | https://main--aig-eds-migration-poc--kprasad05.aem.live/contact-us |
| Main live definition | https://main--aig-eds-migration-poc--kprasad05.aem.live/we-finance.json |
| Separate CAPTCHA demo | https://forms-poc--aig-eds-migration-poc--kprasad05.aem.page/forms-recaptcha |

DA content is shared across code branches. Coordinate the old block's content
rename with deployment: `main` still has the old block name until this code is
merged. Do not publish the renamed demo into production prematurely.

## 5. Build and local validation

```sh
npm install
npm run build:json
npm run build:forms-fixture
aem up --no-open --html-folder drafts --stop-other=false \
  --url https://main--aig-eds-migration-poc--kprasad05.aem.page
```

Visit:

- http://localhost:3000/drafts/contact-us
- http://localhost:3000/drafts/forms-recaptcha

The local JSON is a generated fixture, **not** the published DA sheet. Its
destination placeholder is intentionally unconfigured. The browser suite
intercepts all submission requests and mocks Google CAPTCHA; it never sends
test responses to a real spreadsheet or the existing proxy.

With the AEM server running:

```sh
npm run test:forms
```

If Chromium is missing, run `npx playwright install chromium`, then retry.
Tests cover registry generation, all eight field rows, required/email
validation, request URL/headers/payload, confirmation/reset, retries,
definition failures, DA JSON consumption, editor gating, responsive widths,
and the preserved CAPTCHA proxy flow. Results and remaining manual checks are
recorded in [validation.md](./validation.md).

New tooling: `merge-json-cli` for Adobe's documented JSON build and
`@playwright/test` for focused browser validation. There is no runtime npm
dependency or transpilation step.

## 6. Deployment (only after approval)

Nothing is committed or pushed automatically. Review the changes and complete
the external setup/content coordination first. Then:

```sh
git add blocks/form blocks/forms-recaptcha blocks/embed-adaptive-form \
  scripts/scripts.js scripts/editor-support.js scripts/form-editor-support.* \
  models component-definition.json component-models.json component-filters.json \
  package.json package-lock.json .eslintignore .eslintrc.js .stylelintrc.json \
  .gitignore .hlxignore README.md docs/forms drafts/contact-us.html \
  drafts/contact-us-definition.json drafts/forms-recaptcha.html \
  tools/build-forms-fixture.cjs test/forms
git commit -m "Integrate Adaptive Forms and preserve CAPTCHA demo" \
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
git push -u origin forms-poc
```

After AEM Code Sync completes, preview the DA page using the feature URL.
Test a real response row, accessibility and PageSpeed on the feature preview.
When opening a PR, use the repository's PR template and include the feature
`/contact-us` preview URL and exact validation commands/results.
Merge only after human review; main production uses the `main` live URL.

## Official references

- [EDS Forms overview](https://www.aem.live/developer/forms)
- [Existing-project integration tutorial](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/edge-delivery/build-forms/getting-started-edge-delivery-services-forms/tutorial#add-adaptive-forms-block-to-your-existing-aem-project)
- [Form creation and embedding](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/edge-delivery/build-forms/getting-started-edge-delivery-services-forms/create-forms)
- [Forms Submission Service](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/edge-delivery/build-forms/forms-submission-service)
- [Submission worksheet and Excel table setup](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/edge-delivery/build-forms/getting-started-edge-delivery-services-forms/submit-forms)
- [EDS spreadsheet JSON delivery](https://www.aem.live/developer/spreadsheets)
