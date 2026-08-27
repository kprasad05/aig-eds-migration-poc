import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { scanAccessibility } from './utils.js';

// Formats issues found for display
function renderIssues(container, issues) {
  container.innerHTML = '';

  const heading = document.createElement('p');
  heading.className = 'status';
  heading.textContent = issues.length
    ? `Found ${issues.length} accessibility issue${issues.length === 1 ? '' : 's'}`
    : 'No accessibility issues found';
  container.append(heading);

  if (!issues.length) return;

  const list = document.createElement('ul');
  issues.forEach(({ rule, message }) => {
    const item = document.createElement('li');
    item.textContent = `[${rule}] ${message}`;
    list.append(item);
  });
  container.append(list);
}

(async function init() {
  // Debug: page context
  const { context, token } = await DA_SDK;
  console.log('ADA SCAN context', context);
  const { org, site, path } = context;
  const fullPath = `/${org}/${site}${path}`;

  const button = document.createElement('button');
  button.textContent = 'Scan for ADA compliance';

  const results = document.createElement('div');
  results.className = 'results';

  // Button triggers ADA scan
  button.addEventListener('click', async () => {
    button.disabled = true;
    results.innerHTML = '';
    const status = document.createElement('p');
    status.className = 'status';
    status.textContent = 'Scanning...';
    results.append(status);

    const { issues, message } = await scanAccessibility(fullPath, token);
    if (!issues) {
      status.textContent = message || 'Scan failed.';
    } else {
      renderIssues(results, issues);
    }
    button.disabled = false;
  });

  document.body.append(button, results);
}());
