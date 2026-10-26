# Build the Contact Us form in DA

This step-by-step guide is for an author who is new to Adobe Edge Delivery
Services (EDS) and Document Authoring (DA). It explains how to recreate the
Contact Us form on this existing site without writing JavaScript.


## Start here: Adobe documentation for new authors

Read these introductory resources if EDS and DA are new to you:

1. [Experience League: Edge Delivery Services overview](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/edge-delivery/overview)
   explains what EDS is and how it delivers websites.
2. [Adobe: DA document editor](https://www.aem.live/docs/ew/authoring/document-editor)
   introduces the editing interface, formatting tools, and document-based blocks.
3. [Adobe: Authoring sheets](https://www.aem.live/docs/ew/authoring/editing-sheets)
   explains creating a sheet, editing cells and tabs, and saving structured data.
4. [Adobe: Publishing content](https://www.aem.live/docs/ew/authoring/publishing)
   explains the difference between preview and production publishing.

Adobe's current authoring documentation uses the name **Experience Workspace**,
the evolution of **Document Authoring (DA)**. The document-editor reference
explicitly covers the earlier DA editor. Some screenshots and toolbar names may
differ from those in this site's `da.live` interface.

Experience League's spreadsheet Forms tutorials use SharePoint/Google Drive
authoring examples. This site instead authors the **definition in DA** and uses
**Excel only as the response destination**. Follow the DA-specific steps below;
do not move the definition into SharePoint or rename its `data` tab to match a
tutorial's `shared-aem` example.

## 1. Understand the three pieces

| Piece | Purpose | Name in this example |
| --- | --- | --- |
| DA page | The page visitors open to fill out the form | `contact-us-no-recaptcha` |
| DA definition sheet | Defines fields, labels, validation, hidden values, and the submission destination | `aig-contact-us-nocaptcha` |
| SharePoint/OneDrive Excel workbook | Stores submitted responses | `EDS Forms POC Responses.xlsx` in `EDS-AIG-POC` |

**EDS** delivers the website. **DA** is the browser-based authoring tool used to
create its pages and sheets. A **block** is a named table on a DA page that the
site turns into a feature, such as this form.

The DA definition sheet and the Excel response workbook are **different
documents**. Responses are written to Excel, not back into the DA sheet.

The flow is:

```text
DA page -> reads DA definition JSON -> displays the form
Visitor submits -> Adobe Forms Submission Service -> Excel response table
```

### Example links

- [Finished live form](https://main--aig-eds-migration-poc--kprasad05.aem.live/contact-us-no-recaptcha)
- [Preview form](https://main--aig-eds-migration-poc--kprasad05.aem.page/contact-us-no-recaptcha)
- [DA page editor](https://da.live/edit#/kprasad05/aig-eds-migration-poc/contact-us-no-recaptcha)
- [DA definition sheet editor](https://da.live/sheet#/kprasad05/aig-eds-migration-poc/aig-contact-us-nocaptcha)
- [Preview definition JSON](https://main--aig-eds-migration-poc--kprasad05.aem.page/aig-contact-us-nocaptcha.json)
- [Live definition JSON](https://main--aig-eds-migration-poc--kprasad05.aem.live/aig-contact-us-nocaptcha.json)

The `.aem.page` host is for previewing authored content. The `.aem.live` host is
for published content. JSON is the machine-readable version of the definition
sheet; authors edit the DA sheet, not the JSON directly.

## 2. Check prerequisites

Before starting, obtain:

- Permission to edit and preview/publish content in this DA site.
- Access to the SharePoint/OneDrive location where the workbook is stored.
- Permission to share that workbook with `forms@adobe.com` with edit access.
- Confirmation from the site administrator that Adobe Forms Submission Service
  is enabled for the repository and intended preview/live hosts, and can resolve
  the DA definition and its destination.

This guide assumes the existing site already supports a `Form` block.
Rendering a form does not establish that submission service access is enabled.

**Adobe reference:** [Forms Submission Service](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/edge-delivery/build-forms/forms-submission-service)
describes the submission service, access requirements, and submission interface.
The site administrator should use it when checking service enablement.

## 3. Prepare the Excel response workbook

For this example, the destination is **EDS Forms POC Responses.xlsx**, in the
**EDS-AIG-POC** folder in Adobe SharePoint/OneDrive.

1. Open the workbook in Excel for the web.
2. Create or rename the response worksheet to exactly:

   ```text
   incoming
   ```

3. Enter the following headers in row 1, starting at A1. Use the exact spelling
   and capitalization:

   | A1 | B1 | C1 | D1 | E1 | F1 | G1 | H1 | I1 |
   | --- | --- | --- | --- | --- | --- | --- | --- | --- |
   | firstName | lastName | email | phone | company | subject | message | formSource | campaignId |

   These match the `Name` values in the DA definition. The final two columns
   store hidden values, not additional visible input fields.

4. Select the header range and use **Insert > Table** or **Format as Table**.
   Confirm **My table has headers**. If Excel needs a data row to create the
   table, include a blank row beneath the headers.
5. Select a cell in the table and open the table settings, usually called
   **Table Design** or **Table**. Set the table name to exactly:

   ```text
   intake_form
   ```

6. Save the workbook.

Both names matter: `incoming` is the worksheet; `intake_form` is the Excel
table inside it. A styled header row alone is not a named Excel table.

The supplied screenshot also shows a trailing header beginning with `Column`.
It has no matching field in the inspected definition and is not needed for
this form. Do not use it instead of one of the named headers above. There is
no `submit` response column. A `__id__` column is not part of this example's
required header set.

**Adobe reference:** [Submit form data to a spreadsheet](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/edge-delivery/build-forms/getting-started-edge-delivery-services-forms/submit-forms)
documents the exact `incoming` worksheet and `intake_form` table names, matching
field-name headers, and excluding the Submit button from response headers.
Its same-workbook authoring example differs from this site's separate DA
definition and Excel response workbook.

### Share the workbook with the submission service

1. In SharePoint/OneDrive or Excel for the web, click **Share**.
2. Add `forms@adobe.com` as a recipient.
3. Set its permission to **Can edit**, not view-only.
4. Send/apply the sharing invitation.
5. Use **Manage access** to verify that `forms@adobe.com` has edit access to the
   workbook itself. If external sharing is blocked, ask the SharePoint
   administrator to approve the access.
6. Obtain the workbook link using your organization's approved sharing settings.
   Keep it available for the Submit row's Action cell in the next section.

Do not make the workbook anonymously editable merely to work around a sharing
problem. The actual destination sharing URL is intentionally not reproduced in
this guide; use the link to the named workbook supplied by its owner.

**Adobe reference:** consult [Forms Submission Service](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/edge-delivery/build-forms/forms-submission-service)
for spreadsheet sharing/access requirements. Sharing the workbook is separate
from enabling the submission service for the site.

## 4. Create the DA form definition sheet

**Adobe reference:** [Authoring sheets](https://www.aem.live/docs/ew/authoring/editing-sheets)
shows how to create and edit sheets in the authoring interface. For the Forms
definition and embedding concepts, see [Experience League: Create forms](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/edge-delivery/build-forms/getting-started-edge-delivery-services-forms/create-forms).
Use the names and values below for this DA-backed example.

1. Open [the DA site](https://da.live/#/kprasad05/aig-eds-migration-poc).
2. Use DA's new-content controls to create a **sheet** named
   `aig-contact-us-nocaptcha`. If it already exists, open the
   [existing sheet](https://da.live/sheet#/kprasad05/aig-eds-migration-poc/aig-contact-us-nocaptcha)
   instead.
3. Keep a single worksheet/tab named **data**. This is the definition tab in DA,
   not Excel's `incoming` worksheet.
4. Enter these column headers in row 1:

   ```text
   Name | Type | Label | Mandatory | Placeholder | Value | Action | Required Error Message | Pattern Error Message | Max
   ```

   Each item belongs in a separate cell. The vertical bars above only separate
   the header names; do not paste the entire line into one cell.

### Enter the field rows

The table below matches the inspected preview definition on October 7, 2026.
Blank cells mean leave that cell empty.

| DA row | Name | Type | Label | Mandatory | Placeholder | Value | Max |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2 | firstName | text | First Name | true | First name | | 100 |
| 3 | lastName | text | Last Name | true | Last name | | 100 |
| 4 | email | email | Email | true | you@example.com | | 254 |
| 5 | phone | tel | Phone Number | | | | 50 |
| 6 | company | text | Company | | Company | | 200 |
| 7 | subject | text | Subject | | Subject | | 200 |
| 8 | message | textarea | Message | true | How can we help? | | 500 |
| 9 | formSource | hidden | | | | contact-us-adaptive | |
| 10 | campaignId | hidden | | | | aig-eds-poc | |
| 11 | submit | submit | Submit | | | Thank you. Your message has been sent. | |

Column meanings:

- **Name:** the submitted field name. It must match the destination table header.
- **Type:** controls whether the field is text, email, phone, multiline, hidden,
  or the Submit button.
- **Label:** the visible text above a field.
- **Mandatory:** `true` marks a required field.
- **Placeholder:** the hint displayed inside an empty field.
- **Value:** a preset value; for Submit, this is the confirmation message.
- **Max:** the maximum text length for these input fields.

The current form definition uses `contact-us` as its hidden
`formSource` value even though the page is named `contact-us-no-recaptcha`.
This is a configured tracking value, not a link or routing setting. Keep it
to reproduce the current definition. If the business needs the pages
distinguished in response reporting, intentionally choose a different value,
such as `contact-us`, and verify it in the response row.

### Add validation messages

Populate **Required Error Message** as follows:

| Name | Required Error Message |
| --- | --- |
| firstName | Please enter your first name. |
| lastName | Please enter your last name. |
| email | Please enter your email address. |
| message | Please enter a message. |

For the email row, enter `Please enter a valid email address.` in
**Pattern Error Message**. Leave the other error-message cells blank.

### Set the destination in the Submit row

In **row 11**, where `Name` and `Type` are both `submit`, paste the actual
SharePoint/OneDrive link to **EDS Forms POC Responses.xlsx** into the **Action**
cell. Leave Action blank on all other rows.

**The destination belongs in the DA definition sheet's Submit Action cell, not
on the form page and not in the Submit Value cell.** Submit Value is the thank-you
message. Action identifies the workbook where the service should store responses.


### Save and preview the definition

1. Wait for DA to save the sheet.
2. Use DA's **Preview** control to preview the definition.
3. Open the [preview JSON](https://main--aig-eds-migration-poc--kprasad05.aem.page/aig-contact-us-nocaptcha.json).
4. Check that it loads successfully and contains `":type": "sheet"` with a
   `data` array containing ten definition rows: seven visible inputs, two
   hidden fields, and Submit.
5. Check the names, types, and Submit Action privately. Do not share raw JSON
   screenshots or logs containing the workbook sharing URL.

The JSON definition is publicly delivered to the browser. Never put passwords,
API secrets, or confidential response data in the definition.

## 5. Create the DA page that displays the form

**Adobe references:**

- [DA document editor](https://www.aem.live/docs/ew/authoring/document-editor)
  explains authoring page content and working with tables.
- [Experience League: Create forms](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/edge-delivery/build-forms/getting-started-edge-delivery-services-forms/create-forms)
  shows the one-column, two-row `Form` table and explicitly requires a real JSON
  hyperlink rather than plain text. Apply that structure in DA as described below.

1. In DA, create a **page/document** named `contact-us-no-recaptcha`, or open
   the [existing page editor](https://da.live/edit#/kprasad05/aig-eds-migration-poc/contact-us-no-recaptcha).
2. Add a top-level heading. The inspected example uses **Forms POC**.
3. Below it, insert a **one-column table with two rows**.
4. In the first row, type **Form**. This names the block.
5. In the second row, enter **Contact Us Form Sheet** and turn that text into a
   hyperlink whose target is:

   ```text
   /aig-contact-us-nocaptcha.json
   ```

The authored table should have this structure:

| Form |
| --- |
| [Contact Us Form Sheet](/aig-contact-us-nocaptcha.json) |

The second row must contain a real hyperlink, not merely unlinked text showing
a URL. The relative link lets the preview page read the preview definition and
the live page read the live definition.

6. Wait for the page to save, then **Preview** it.
7. Open the [preview form page](https://main--aig-eds-migration-poc--kprasad05.aem.page/contact-us-no-recaptcha).
8. Confirm that the seven visible inputs and Submit button appear. The hidden
   fields should not appear as editable inputs.

## 6. Publish the definition and page

**Adobe reference:** [Publishing content](https://www.aem.live/docs/ew/authoring/publishing)
shows the Send/Publish menu, preview/publish choices, and Sidekick workflow.
Both preview and live URLs are publicly accessible; preview is not private
storage.

1. Publish the **definition sheet first**.
2. Check that the [live definition JSON](https://main--aig-eds-migration-poc--kprasad05.aem.live/aig-contact-us-nocaptcha.json)
   is available.
3. Publish the **page**.
4. Open the [live form](https://main--aig-eds-migration-poc--kprasad05.aem.live/contact-us-no-recaptcha)
   and check the fields and Submit button.

Preview updates `.aem.page`; publishing updates `.aem.live`. Saving in DA alone
does not establish that the latest content has reached either environment.
Whenever the field definition or destination changes, preview/publish the sheet
again, not just the page.

## 7. Verify a real submission in Excel

Use approved synthetic data, not a customer's personal information. Coordinate
with the workbook owner before sending test responses.

1. Create a unique marker, for example `DA-TEST-20261007-001`.
2. Open the preview page on an authorized host.
3. Fill First Name and Last Name with synthetic names, Email with a test address
   such as `eds.forms.test@example.com`, and Message with the unique marker.
   Use the marker in Subject too, if convenient.
4. Click Submit **once** and note the time and hostname.
5. A thank-you message is useful feedback, but **it is not proof of storage**.
6. Open **EDS Forms POC Responses.xlsx**, select **incoming**, and inspect the
   **intake_form** table. Refresh/reopen the workbook if needed.
7. Find the row with the exact marker and check all submitted fields plus the
   hidden `formSource` and `campaignId` values.
8. Record the marker, submission time, environment, and whether the matching row
   was found. Avoid putting personal data or sharing URLs in the evidence.

Only declare the end-to-end test successful after locating that matching row.
Before retrying an ambiguous or timed-out submission, check Excel for the first
attempt to avoid creating duplicates.

The published definition and page were inspected when this guide was written;
no real submission or workbook inspection was performed to produce this guide.

## 8. Troubleshooting

| Symptom | Checks |
| --- | --- |
| Only the definition link appears, or the form shows a load error | Confirm the block heading is `Form`, the second row contains a hyperlink, and the referenced JSON is available. |
| Field changes are missing | Preview/publish the definition sheet and refresh the corresponding environment. |
| Required fields are not enforced | Check `Mandatory` is `true` and header/field spelling matches the definition. |
| Submit fails with HTTP 401 | Inspect the actual `forms.adobe.com` response and available error headers. Ask Adobe to confirm service activation, host authorization, and definition resolution; 401 alone does not identify the cause. |
| No matching Excel row | Check Submit Action, workbook edit access for `forms@adobe.com`, exact `incoming` and `intake_form` names, matching headers, and Adobe service configuration. |
| Hidden tracking values are unexpected | Inspect their Value cells in the DA definition; they are not entered by visitors. |

Do not publish unredacted network captures, workbook links, or submitted personal
data when asking for help.

### Contact Adobe if responses are not written to Excel

If the form still cannot write to the response workbook after the checks above,
email **[aem-forms-ea@adobe.com](mailto:aem-forms-ea@adobe.com)** to ask Adobe to
confirm Forms Submission Service activation and authorization for the site.
A missing row does not necessarily mean the service is disabled; include the
observed failure so Adobe can investigate.

Include the **EDS repository** and **every branch from which forms will submit**.
For this project, the repository is `kprasad05/aig-eds-migration-poc`, and example
branches are `main` and `forms-poc`. Replace or extend this list as needed.
Include the actual preview/live hostnames because each branch has its own URLs.

Use this email template:

```text
To: aem-forms-ea@adobe.com
Subject: EDS Forms submission access / Excel response storage

Hi Adobe team,

Our DA-authored EDS form is not writing responses to the destination Excel table.
Could you confirm Forms Submission Service activation, host authorization, and
resolution of our DA form definition and its Submit Action?

EDS Repo: kprasad05/aig-eds-migration-poc
Submission branches: main, forms-poc

Hosts to confirm:
- main--aig-eds-migration-poc--kprasad05.aem.page
- main--aig-eds-migration-poc--kprasad05.aem.live

Form page path: /contact-us-no-recaptcha
DA definition path: /aig-contact-us-nocaptcha.json
Authoring: DA, not Universal Editor/XWalk
Destination worksheet: incoming
Destination Excel table: intake_form
Workbook shared with forms@adobe.com with edit access: [confirmed / not confirmed]

Failing branch and hostname: [actual branch and hostname tested]
Test date/time and timezone: [date/time]
Submission HTTP status and error header, if available: [observed result]
Matching synthetic response row found in Excel: [yes / no]

Thanks,
[Your name]
```

Fill in the bracketed details before sending. Inspect the request to
`forms.adobe.com` for the submission status, rather than unrelated network
requests. Do not attach private response data or the workbook sharing URL.

## Further reading

- [Experience League: Edge Delivery Services overview](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/edge-delivery/overview)
- [Adobe: DA document editor](https://www.aem.live/docs/ew/authoring/document-editor)
- [Adobe: Authoring sheets](https://www.aem.live/docs/ew/authoring/editing-sheets)
- [Adobe: Publishing content](https://www.aem.live/docs/ew/authoring/publishing)
- [Adobe: Create spreadsheet-authored forms](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/edge-delivery/build-forms/getting-started-edge-delivery-services-forms/create-forms)
- [Adobe: Submit form data to a spreadsheet](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/edge-delivery/build-forms/getting-started-edge-delivery-services-forms/submit-forms)
- [Adobe: Forms Submission Service](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/edge-delivery/build-forms/forms-submission-service)
