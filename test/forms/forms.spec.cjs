const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const definition = JSON.parse(fs.readFileSync(path.join(root, 'drafts/contact-us-definition.json'), 'utf8'));
const service = 'https://forms.adobe.com/adobe/forms/af/submit/';

async function isolatePage(page) {
  await page.route('**/nav.plain.html', (route) => route.fulfill({ body: '<div></div>', contentType: 'text/html' }));
  await page.route('**/footer.plain.html', (route) => route.fulfill({ body: '<div></div>', contentType: 'text/html' }));
}

async function loadContact(page, status = 200, body = definition) {
  await isolatePage(page);
  await page.route('**/drafts/contact-us-definition.json', (route) => route.fulfill({
    status,
    json: body,
  }));
  await page.goto('/drafts/contact-us');
}

async function fillRequired(page) {
  await page.getByLabel('First Name', { exact: true }).fill('Test');
  await page.getByLabel('Last Name', { exact: true }).fill('User');
  await page.getByLabel('Email', { exact: true }).fill('test.user+forms@example.technology');
  await page.getByLabel('Message', { exact: true }).fill('Automated local test only.');
}

test('registers official models and retains section components', async () => {
  const definitions = JSON.parse(
    fs.readFileSync(path.join(root, 'component-definition.json'), 'utf8'),
  );
  const models = JSON.parse(fs.readFileSync(path.join(root, 'component-models.json'), 'utf8'));
  const filters = JSON.parse(fs.readFileSync(path.join(root, 'component-filters.json'), 'utf8'));
  const ids = definitions.groups.flatMap(
    (group) => group.components.map((component) => component.id),
  );
  expect(ids).toEqual(expect.arrayContaining([
    'form', 'embed-adaptive-form', 'form-submit-button',
  ]));
  expect(models.map((model) => model.id)).toEqual(expect.arrayContaining([
    'form', 'embed-adaptive-form', 'email', 'multiline-input',
  ]));
  const sections = filters.find((filter) => filter.id === 'section').components;
  const blocks = fs.readdirSync(path.join(root, 'blocks'));
  expect(sections).toEqual(expect.arrayContaining(blocks));
});

test('generated spreadsheet definition matches its CSV and incoming headers', async () => {
  expect(definition[':type']).toBe('sheet');
  expect(definition.total).toBe(8);
  expect(definition.data.filter((row) => row.Mandatory === 'true').map((row) => row.Name))
    .toEqual(['firstName', 'lastName', 'email', 'message']);
  const csv = fs.readFileSync(path.join(root, 'docs/forms/contact-us-definition.csv'), 'utf8');
  expect(csv.split(/\r?\n/)[0]).toBe(definition.columns.join(','));
  const incoming = fs.readFileSync(path.join(root, 'docs/forms/incoming.csv'), 'utf8').trim().split(',');
  expect(incoming).toEqual(['__id__', ...definition.data.filter((row) => row.Type !== 'submit').map((row) => row.Name)]);
});

test('renders all fields, validates required inputs and accepts modern email addresses', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await loadContact(page);
  const form = page.locator('.form form');
  await expect(form).toHaveAttribute('data-source', 'sheet');
  await expect(form.locator('input')).toHaveCount(6);
  await expect(form.locator('textarea')).toHaveCount(1);
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByLabel('First Name', { exact: true })).toBeFocused();
  await expect(page.getByText('Please enter your first name.', { exact: true })).toBeVisible();
  await fillRequired(page);
  const email = page.getByLabel('Email', { exact: true });
  await email.fill('invalid-email');
  expect(await email.evaluate((el) => el.validity.typeMismatch)).toBe(true);
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(email).toBeFocused();
  expect(await form.evaluate((el) => el.checkValidity())).toBe(false);
  await email.fill('test.user+forms@example.technology');
  expect(await form.evaluate((el) => el.checkValidity())).toBe(true);
  expect(errors).toEqual([]);
});

test('submits official service payload and keeps confirmation after a second submission', async ({ page }) => {
  const requests = [];
  await page.route(`${service}**`, async (route) => {
    requests.push({
      url: route.request().url(),
      headers: route.request().headers(),
      body: route.request().postDataJSON(),
    });
    await route.fulfill({ status: 200, json: {} });
  });
  await loadContact(page);
  const submit = async () => {
    await fillRequired(page);
    await page.getByRole('button', { name: 'Submit', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Thank you. Your message has been sent.');
    await expect(page.getByLabel('First Name', { exact: true })).toHaveValue('');
  };
  await submit();
  await submit();
  expect(requests).toHaveLength(2);
  expect(requests[0].url).toBe(`${service}${Buffer.from('/drafts/contact-us-definition.json').toString('base64')}`);
  expect(requests[0].headers['x-adobe-form-hostname']).toBe('localhost');
  expect(requests[0].body.data).toMatchObject({
    firstName: 'Test',
    lastName: 'User',
    email: 'test.user+forms@example.technology',
    phone: '',
    company: '',
    subject: '',
    message: 'Automated local test only.',
  });
  const { __id__: submissionId } = requests[0].body.data;
  expect(submissionId).toEqual(expect.any(Number));
});

test('retains values on failure, prevents duplicate requests and clears errors on retry', async ({ page }) => {
  let attempts = 0;
  await page.route(`${service}**`, async (route) => {
    attempts += 1;
    await new Promise((resolve) => { setTimeout(resolve, 250); });
    await route.fulfill({ status: attempts === 1 ? 503 : 200, json: {} });
  });
  await loadContact(page);
  await fillRequired(page);
  const button = page.getByRole('button', { name: 'Submit', exact: true });
  await button.click();
  await expect(button).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('Your entries have been kept');
  await expect(page.getByLabel('First Name', { exact: true })).toHaveValue('Test');
  await expect(button).toBeEnabled();
  expect(attempts).toBe(1);
  await button.click();
  await expect(page.getByRole('status')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(attempts).toBe(2);
});

[
  { status: 404, body: {} },
  { status: 200, body: { invalid: true } },
  { status: 200, body: { ':type': 'sheet', data: [{}] } },
].forEach(({ status, body }) => {
  test(`shows a useful error for definition ${status} ${JSON.stringify(body)}`, async ({ page }) => {
    await loadContact(page, status, body);
    await expect(page.getByRole('alert'))
      .toHaveText('This form is temporarily unavailable. Please try again later.');
    await expect(page.locator('.form form')).toHaveCount(0);
  });
});

test('loads a real DA sheet URL without requiring an Excel content mount', async ({ page }) => {
  await isolatePage(page);
  await page.route('**/we-finance.json', (route) => route.fulfill({ json: definition }));
  await page.route('**/drafts/da-contact.plain.html', (route) => route.fulfill({
    contentType: 'text/html',
    body: '<div><div class="form"><div><div><a href="/we-finance.json">Form</a></div></div></div></div>',
  }));
  await page.goto('/drafts/contact-us');
  await page.evaluate(async () => {
    const { decorateBlock, loadBlock } = await import(`${window.location.origin}/scripts/aem.js`);
    const block = document.createElement('div');
    block.className = 'form';
    block.innerHTML = '<div><div><a href="/we-finance.json">Form</a></div></div>';
    document.querySelector('main .section').replaceChildren(block);
    decorateBlock(block);
    await loadBlock(block);
  });
  await expect(page.getByLabel('First Name', { exact: true })).toBeVisible();
  await expect(page.locator('.form form')).toHaveAttribute('data-action', '/we-finance');
});

test('leaves DA pages free of Universal Editor runtime', async ({ page }) => {
  const editorRequests = [];
  page.on('request', (request) => {
    if (/\/(form-)?editor-support\.(js|css)/.test(request.url())) editorRequests.push(request.url());
  });
  await loadContact(page);
  await expect(page.getByLabel('First Name', { exact: true })).toBeVisible();
  expect(editorRequests).toEqual([]);
});

test('official editor module and stylesheet resolve when explicitly loaded', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await loadContact(page);
  await expect(page.getByLabel('First Name', { exact: true })).toBeVisible();
  await page.evaluate(() => import(`${window.location.origin}/scripts/editor-support.js`));
  await expect(page.locator('link[href$="/scripts/form-editor-support.css"]')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('network submission failure retains entries and permits retry', async ({ page }) => {
  await page.route(`${service}**`, (route) => route.abort('failed'));
  await loadContact(page);
  await fillRequired(page);
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Your entries have been kept');
  await expect(page.getByLabel('Message', { exact: true }))
    .toHaveValue('Automated local test only.');
  await expect(page.getByRole('button', { name: 'Submit', exact: true })).toBeEnabled();
});

test('Adaptive Form CSS does not restyle unrelated inputs', async ({ page }) => {
  await loadContact(page);
  await expect(page.getByLabel('First Name', { exact: true })).toBeVisible();
  const originalInput = await page.evaluate(() => {
    const demo = document.createElement('div');
    demo.className = 'forms-recaptcha';
    demo.innerHTML = '<form><div class="form-field"><input type="text"></div></form>';
    document.querySelector('main .section').append(demo);
    const input = demo.querySelector('input');
    const style = getComputedStyle(input);
    return {
      columns: getComputedStyle(demo.querySelector('form')).display,
      padding: style.padding,
      variables: style.getPropertyValue('--form-input-padding'),
    };
  });
  expect(originalInput.columns).not.toBe('grid');
  expect(originalInput.variables).toBe('');
});

[375, 768, 1280].forEach((width) => {
  test(`keeps form inside viewport at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await loadContact(page);
    await expect(page.getByLabel('Message', { exact: true })).toBeVisible();
    const fits = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(fits).toBe(true);
    const style = await page.getByLabel('First Name', { exact: true }).evaluate((input) => {
      const wrapper = input.closest('.field-wrapper');
      return {
        columns: getComputedStyle(wrapper).gridColumn,
        color: getComputedStyle(input).color,
      };
    });
    expect(style.columns).toBe(width >= 600 ? 'span 6' : 'span 12');
    expect(style.color).toBe('rgb(52, 55, 65)');
  });
});

async function loadRecaptcha(page, result = { success: true }, config = { Key: 'recaptcha-site-key', Value: 'local-test-key' }) {
  await isolatePage(page);
  await page.route('**/config.json', (route) => route.fulfill({ json: { data: [config] } }));
  await page.route('https://www.google.com/recaptcha/api.js?**', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `window.grecaptcha = {
      render: (element) => { element.textContent = 'Mock reCAPTCHA'; return 0; },
      getResponse: () => window.testCaptchaToken || '',
      reset: () => { window.testCaptchaToken = ''; }
    }; window.onRecaptchaApiLoad();`,
  }));
  await page.route('https://aig-aem-eds-poc.vercel.app/api/recaptcha-verify', (route) => route.fulfill({ json: result }));
  await page.goto('/drafts/forms-recaptcha');
}

test('preserves renamed reCAPTCHA verification without spreadsheet submission', async ({ page }) => {
  const errors = [];
  const submissions = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (request.method() === 'POST') submissions.push({ url: request.url(), body: request.postDataJSON() });
  });
  await loadRecaptcha(page);
  const button = page.getByRole('button', { name: 'Submit', exact: true });
  await expect(button).toBeEnabled();
  await page.getByLabel('Name', { exact: true }).fill('Test User');
  await page.getByLabel('Email', { exact: true }).fill('test@example.com');
  await page.getByLabel('Message', { exact: true }).fill('CAPTCHA test');
  await button.click();
  await expect(page.getByRole('status')).toContainText('Please complete the reCAPTCHA');
  expect(submissions).toHaveLength(0);
  await page.evaluate(() => { window.testCaptchaToken = 'local-test-token'; });
  await button.click();
  await expect(page.getByRole('status')).toHaveText('Thanks -- CAPTCHA verification succeeded.');
  expect(submissions).toEqual([{
    url: 'https://aig-aem-eds-poc.vercel.app/api/recaptcha-verify',
    body: { token: 'local-test-token', fields: { name: 'Test User', email: 'test@example.com', message: 'CAPTCHA test' } },
  }]);
  expect(errors).toEqual([]);
});

test('reports missing reCAPTCHA configuration without enabling submission', async ({ page }) => {
  await loadRecaptcha(page, { success: true }, { Key: 'other', Value: '' });
  await expect(page.getByText('reCAPTCHA is not configured for this form.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit', exact: true })).toBeDisabled();
});

test('renamed reCAPTCHA still redirects when verification fails', async ({ page }) => {
  await loadRecaptcha(page, { success: false });
  await page.getByLabel('Name', { exact: true }).fill('Test User');
  await page.getByLabel('Email', { exact: true }).fill('test@example.com');
  await page.getByLabel('Message', { exact: true }).fill('CAPTCHA test');
  await page.evaluate(() => { window.testCaptchaToken = 'local-test-token'; });
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page).toHaveURL(/\/form-error$/);
});
