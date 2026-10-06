# Forms POC validation

Branch: `forms-poc`, based on local `main`. This report records local validation;
the user subsequently approved committing and pushing the Forms POC branch.

## Completed

| Check | Exact command / method | Result |
| --- | --- | --- |
| Dependency installation | `npm install` | Passed; npm reported 19 dependency vulnerabilities. No unrelated dependency upgrades were made. |
| Official registry build | `npm run build:json` | Passed; generated 26 definitions, 28 models, and section/form filters. |
| Contact Us template generation | `npm run build:forms-fixture` | Passed; CSV definition, incoming headers and single-sheet JSON fixture generated. |
| Focused JavaScript lint | `./node_modules/.bin/eslint blocks/form blocks/forms-recaptcha blocks/embed-adaptive-form scripts/editor-support.js scripts/form-editor-support.js scripts/scripts.js test/forms --ext .js,.cjs` | Passed. |
| Focused CSS lint | `./node_modules/.bin/stylelint 'blocks/form/**/*.css' 'blocks/forms-recaptcha/*.css' 'blocks/embed-adaptive-form/*.css' scripts/form-editor-support.css` | Passed. |
| All repository CSS | `npm run lint:css` | Passed. |
| Browser tests | `npm run test:forms` | **19 passed** in Chromium. |
| Whitespace validation | `git diff --check` | Passed. |
| Existing DA sheet delivery | GET preview and live `/we-finance.json` initially; subsequent preview inspection | Initially empty; the author subsequently populated and previewed all eight definition rows. |
| Actual DA-authored form | Browser navigation to `http://localhost:3000/contact-us-adaptive` after restarting AEM | Passed: the authored Form table references `/we-finance.json`; the actual previewed DA definition renders all seven inputs and Submit, with required flags and `data-source=sheet`. No fixture interception was used for this check. |
| Local AEM pages | GET `/drafts/contact-us` and `/drafts/contact-us-definition.json` | Both HTTP 200. |
| Visual inspection | Chromium desktop 1280px and mobile 375px screenshots of the local Contact Us fixture, with real site header/footer | Completed; form follows site colors/type, with responsive layout and no horizontal overflow. |
| Existing homepage smoke test | Chromium navigation to `http://localhost:3000/` | No unhandled JavaScript errors; header/footer and page blocks reached loaded state. Not an exhaustive functional test of every pre-existing block. |
| Actual Google CAPTCHA script/widget | Chromium navigation to `/drafts/forms-recaptcha`, without request mocks or form submission | One real reCAPTCHA iframe rendered; widget displayed “I'm not a robot”, Submit became enabled, and there were no unhandled JavaScript errors. |

The VS Code `runTests` tool did not discover the `.cjs` Playwright suite, so the
repository's dedicated `npm run test:forms` runner was used instead.

### What the 19 automated tests verify

- Registered Adobe definitions/models and preservation of all section block names.
- Eight spreadsheet definition rows and matching response-storage headers.
- Six inputs, multiline Message and Submit rendering through the official
  spreadsheet transform.
- Required fields and invalid email rejection; plus-addressing and long-domain
  email acceptance.
- Official submission URL, hostname header, `data` payload and generated ID.
- Success confirmation, reset and correct configuration on a second submission.
- HTTP and network failures preserve entries and allow retry.
- Busy-state button disabling prevents duplicate user submissions.
- Failure messages disappear after a successful retry.
- HTTP 404, malformed JSON object and an empty form sheet display useful errors.
- A DA `/we-finance.json` link renders through the official block when its response
  is replaced with a populated single-sheet test definition.
- Normal DA pages do not load editor support; explicitly loading the official
  Forms editor module resolves its dependencies and CSS.
- Adaptive Form styles do not leak to unrelated form inputs.
- 375px, 768px and 1280px layouts fit the viewport; contact fields use the intended
  one-/two-column layout.
- Renamed CAPTCHA demo requires a challenge token, retains its original proxy
  payload, handles missing configuration and retains failure-page redirection.

All automated submission responses are **mocked**. All automated CAPTCHA
responses/proxy calls are **mocked**. Real widget rendering was separately
checked without solving the challenge or submitting any field values.

## Local alignment correction (October 6, 2026)

The custom `blocks/form/site-theme.css` now left-aligns the form with the
section heading instead of centering it independently. Horizontal form padding
and field margins are removed; the 760px maximum width, responsive columns,
and submission logic are unchanged.

The responsive tests now verify that the first label/input, Message textarea,
and Submit button align with the heading within 1px at 375px, 768px, 1280px,
and 1520px. All four checks failed before the CSS correction, reproducing the
misalignment. After correction, `npm run test:forms` passed all **20 tests**,
including existing mocked submission and independent reCAPTCHA coverage.
This is local validation, not evidence that the correction has been deployed.

## Failed repository-wide check (pre-existing issues)

`npm run lint` fails at its JavaScript phase. A separate final `npm run lint:js`
reported **14 errors and 2 warnings**, all in untouched existing files:

- `blocks/fragment/fragment.js`: existing quotes/concatenation and console warnings.
- `scripts/utils/error.js`, `favicon.js`, `footer.js`, `svg.js`: existing imports
  of a missing `scripts/ak.js`.
- `scripts/utils/picture.js` and `svg.js`: existing style/export/loop errors.

Representative offending code was checked against `main`; these files were
not changed. All files modified/imported for this integration pass the focused
checks. These unrelated failures were not fixed to avoid expanding the task.

## Still requiring manual/external verification

1. DA definition population and preview are complete, and the actual authored
   page renders locally. Publishing the final destination-configured definition
   and page remains outstanding.
2. Rename the old DA CAPTCHA table to **Forms Recaptcha**, and move it to its
   own page. Update any other old demo pages found by an authenticated DA search.
3. Create the Excel/Google Sheets destination, grant `forms@adobe.com` write
   access and add the exact `incoming` worksheet/headers. For Excel, create the
   named table `intake_form` inside that worksheet.
4. Obtain Forms Submission Service approval and confirm its service-side
   resolution of the DA definition and destination Action for this tenant.
5. Put the real destination link in Action and test from an approved
   preview/live hostname. Inspect the actual destination for a matching response
   row. **No real Excel/Google Sheets write has been verified.**
6. If required, solve the real Google challenge and verify the demo's existing
   proxy flow manually. No real proxy POST was performed.
7. Perform screen-reader, keyboard and actual-device accessibility checks.
8. After pushing with approval, run PageSpeed and deployment checks against the
   feature preview. Feature-branch Code Sync, PR checks and production deployment
   have not been run.

Local server used:

```sh
aem up --no-open --no-livereload --forward-browser-logs --html-folder drafts \
  --url https://main--aig-eds-migration-poc--kprasad05.aem.page --stop-other=false
```
