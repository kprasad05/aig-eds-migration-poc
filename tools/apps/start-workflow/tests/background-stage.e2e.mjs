import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { chromium } from '@playwright/test';

const endpoint = 'https://258616-aigdatranslationpoc-stage.adobeioruntime.net/api/v1/web/aig-da-translation-backend/bulk-workflow';

test('Stage browser CORS permits unknown-job GET and rejects unconfirmed POST without submitting jobs', async (t) => {
  let token;
  try {
    token = execFileSync('aio', ['auth', 'login', '--bare', '--no-open'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000,
    }).trim();
  } catch {
    throw new Error('Run aio login before this opt-in Stage browser test. Credentials were not printed.');
  }
  assert.ok(token && !/\s/.test(token), 'CLI did not return a valid token.');
  const headers = {
    Authorization: `Bearer ${token}`,
    'x-gw-ims-org-id': '2FBC7B975CFE21C40A495FBB@AdobeOrg',
  };
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  // Only serve the test document locally; all Stage requests cross the real CORS boundary.
  await page.route('https://da.live/_workflow-cors-check', (route) => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Non-billable Stage CORS check</title>',
  }));
  await page.goto('https://da.live/_workflow-cors-check');
  for (const [method, expectedStatus] of [['GET', 404], ['POST', 400]]) {
    const url = method === 'GET' ? `${endpoint}?jobId=${'0'.repeat(32)}` : endpoint;
    const received = page.waitForResponse((response) => response.url() === url
      && response.request().method() === method);
    const result = await page.evaluate(async ({ target, authorization, verb }) => {
      const response = await fetch(target, {
        method: verb,
        headers: {
          ...authorization,
          ...(verb === 'POST' ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(verb === 'POST' ? { body: '{}' } : {}),
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
      });
      return { status: response.status, body: await response.json() };
    }, { target: url, authorization: headers, verb: method });
    assert.equal(result.status, expectedStatus);
    assert.equal(typeof result.body.error, 'string');
    assert.equal(await (await received).headerValue('access-control-allow-origin'), '*');
  }
});
