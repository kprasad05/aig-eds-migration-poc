function createMetadataBlock() {
  const metadata = document.createElement('div');
  metadata.className = 'metadata';
  return metadata;
}

function createTagRow(tags) {
  const tagRow = document.createElement('div');

  const tagKey = document.createElement('div');
  tagKey.textContent = 'tags';

  const tagVal = document.createElement('div');
  tagVal.textContent = tags.join(', ');

  tagRow.append(tagKey, tagVal);

  return tagRow;
}

function getOpts(token, method = 'GET') {
  return {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
    },
  };
}

async function fetchDoc(path, token) {
  const opts = getOpts(token);
  const srcPath = path.endsWith('.html') ? path : `${path}.html`;
  const resp = await fetch(`https://admin.da.live/source${srcPath}`, opts);
  if (!resp.ok) return { message: 'Could not fetch doc.', status: resp.status };
  const html = await resp.text();
  return { html };
}

async function saveDoc(path, token, doc) {
  // Create the body
  const body = new FormData();
  const html = doc.body.outerHTML;
  const data = new Blob([html], { type: 'text/html' });
  body.append('data', data);

  // Setup options
  const opts = getOpts(token, 'POST');
  opts.body = body;

  const resp = await fetch(`https://admin.da.live/source${path}.html`, opts);
  if (!resp.ok) return { message: 'Could not save.', status: resp.status, type: 'error' };
  return { message: 'Successfully saved.', status: resp.status, type: 'success' };
}

const getMetadata = (el) => [...el.childNodes].reduce((rdx, row) => {
  if (row.children) {
    const key = row.children[0].textContent.trim().toLowerCase();
    const content = row.children[1];
    const text = content.textContent.trim().toLowerCase();
    if (key && text) rdx[key] = { text };
  }
  return rdx;
}, {});

export async function loadGenTags(path, token) {
  const { html } = await fetchDoc(path, token);
  const baseOpts = getOpts(token, 'POST');
  const opts = { ...baseOpts, body: JSON.stringify({ html }) };
  const resp = await fetch(`https://da-etc.adobeaem.workers.dev/tags`, opts);
  if (!resp.ok) return [];
  const { tags } = await resp.json();
  return tags;
}

export async function loadPageTags(path, token) {
  const { html } = await fetchDoc(path, token);
  if (!html) return [];
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const metaEl = doc.querySelector('.metadata');
  if (metaEl) {
    const { tags } = getMetadata(metaEl);
    if (tags) {
      return tags.text.split(',').map((tag) => tag.trim().toLowerCase());
    }
  }
  return [];
}

const VAGUE_LINK_TEXT = ['click here', 'here', 'read more', 'more', 'link', 'this page'];

function checkImages(doc) {
  return [...doc.querySelectorAll('img')].reduce((issues, img) => {
    if (!img.hasAttribute('alt')) {
      issues.push({ rule: 'image-alt', message: `Image missing "alt" attribute: ${img.getAttribute('src') || '(no src)'}` });
    }
    return issues;
  }, []);
}

function checkLinks(doc) {
  return [...doc.querySelectorAll('a[href]')].reduce((issues, link) => {
    const text = (link.textContent || '').trim().toLowerCase();
    const label = link.getAttribute('aria-label');
    if (!text && !label) {
      issues.push({ rule: 'link-name', message: `Link has no accessible text: ${link.getAttribute('href')}` });
    } else if (!label && VAGUE_LINK_TEXT.includes(text)) {
      issues.push({ rule: 'link-name', message: `Link text is not descriptive ("${text}"): ${link.getAttribute('href')}` });
    }
    return issues;
  }, []);
}

function checkHeadings(doc) {
  const headings = [...doc.querySelectorAll('h1, h2, h3, h4, h5, h6')];
  const issues = [];

  headings.forEach((heading) => {
    if (!heading.textContent.trim()) {
      issues.push({ rule: 'empty-heading', message: `Empty <${heading.tagName.toLowerCase()}> heading` });
    }
  });

  let prevLevel = 0;
  headings.forEach((heading) => {
    const level = Number(heading.tagName[1]);
    if (prevLevel && level - prevLevel > 1) {
      issues.push({ rule: 'heading-order', message: `Heading level skips from h${prevLevel} to h${level}` });
    }
    prevLevel = level;
  });

  return issues;
}

function checkTables(doc) {
  return [...doc.querySelectorAll('table')].reduce((issues, table) => {
    if (!table.querySelector('th')) {
      issues.push({ rule: 'table-headers', message: 'Table has no header (<th>) cells' });
    }
    return issues;
  }, []);
}

export async function scanAccessibility(path, token) {
  const { html, message, status } = await fetchDoc(path, token);
  if (!html) return { message: message || 'Could not fetch doc.', status, issues: undefined };

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const issues = [
    ...checkImages(doc),
    ...checkLinks(doc),
    ...checkHeadings(doc),
    ...checkTables(doc),
  ];

  return { issues };
}

export async function savePageTags(path, token, tags) {
  // Build the tag row elements
  const tagsRow = createTagRow(tags);

  // Always get a fresh doc
  const { html } = await fetchDoc(path, token);
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // Re-use existing metadata block if possible
  const metaEl = doc.querySelector('.metadata');
  if (metaEl) {
    const metaRows = metaEl.querySelectorAll(':scope > div');
    const foundRow = [...metaRows].find((row) => {
      const text = row.children[0].textContent;
      return text === 'tags';
    });
    if (foundRow) {
      foundRow.parentElement.replaceChild(tagsRow, foundRow);
    } else {
      metaEl.append(tagsRow);
    }
  } else {
    // Make net-new metadata block
    const newMetaEl = createMetadataBlock();
    newMetaEl.append(tagsRow);
    doc.body.querySelector('main > div:last-child').append(newMetaEl);
  }
  return saveDoc(path, token, doc);
}
