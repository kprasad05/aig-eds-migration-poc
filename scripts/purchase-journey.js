import { readBlockConfig } from './aem.js';
import {
  assertPurchaseAuthoring, PERSONAL_DETAIL_SECTIONS, REVIEW_LABEL_KEYS, WIZARD_COPY_KEYS,
} from './angular/car-purchase-content.mjs'; // eslint-disable-line import/extensions

export const HANDOFF_KEY = 'harbour-cover.quote.v1';
export const CAR_HANDOFF_KEY = 'car-cover.quote.v2';
const COPY_KEYS = {
  brand: 'brand',
  eyebrow: 'eyebrow',
  headline: 'headline',
  intro: 'intro',
  'pre-quote-title': 'preQuoteTitle',
  'pre-quote-button': 'preQuoteButton',
  'declaration-title': 'declarationTitle',
  'declaration-text': 'declarationText',
  disclaimer: 'disclaimer',
};
const OPTIONS = {
  vehicleType: ['sedan', 'suv', 'electric'],
  ageBand: ['21-24', '25-39', '40-65'],
};

export function element(tag, className, contentText) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (contentText) node.textContent = contentText;
  return node;
}

export function showError(block, error) {
  // eslint-disable-next-line no-console
  console.error('Purchase journey failed:', error);
  let alert = block.querySelector('.journey-error');
  if (!alert) {
    alert = element('p', 'journey-error');
    alert.setAttribute('role', 'alert');
    block.prepend(alert);
  }
  alert.textContent = error instanceof Error
    ? error.message : 'Unable to load the demo. Please try again.';
}

function sameOriginPage(path, label) {
  const url = new URL(path, window.location.href);
  if (url.origin !== window.location.origin) {
    throw new Error(`${label} must use this page's origin to share browser storage.`);
  }
  return url.href;
}

export function settings(block, defaultFormat = 'document') {
  const config = readBlockConfig(block);
  Object.entries(config).forEach(([key, value]) => {
    if (typeof value !== 'string') throw new Error(`Configure ${key} with one text value or link.`);
  });
  if (!config['content-path']) throw new Error('Author a Content Path row for the journey.');
  const contentFormat = config['content-format'] || defaultFormat;
  if (!['document', 'json'].includes(contentFormat)) {
    throw new Error('Content Format must be document or json.');
  }
  const content = new URL(contentFormat === 'document'
    ? sameOriginPage(config['content-path'], 'Content Path')
    : config['content-path'], window.location.href);
  if (!['http:', 'https:'].includes(content.protocol)) {
    throw new Error('Content Path must be an HTTP(S) URL.');
  }
  if (contentFormat === 'document' && !content.pathname.endsWith('.plain.html')) {
    content.pathname = `${content.pathname.replace(/\.html$/, '')}.plain.html`;
  }
  const api = new URL(config['api-base'] || '/api', window.location.href);
  const handoffMode = config['handoff-mode'] || 'persistent';
  if (!['persistent', 'consume'].includes(handoffMode)) {
    throw new Error('Handoff Mode must be persistent or consume.');
  }
  if (!['http:', 'https:'].includes(api.protocol)) {
    throw new Error('API Base must be an HTTP(S) URL.');
  }
  if (api.search || api.hash) throw new Error('API Base must not include a query or fragment.');
  let quoteScenariosUrl;
  let scenarioModuleUrl;
  if (config['quote-scenarios']) {
    const scenarios = new URL(config['quote-scenarios'], window.location.href);
    if (!['http:', 'https:'].includes(scenarios.protocol) || scenarios.search || scenarios.hash) {
      throw new Error('Quote Scenarios must be an HTTP(S) sheet URL without a query or fragment.');
    }
    if (!config['contract-url']) throw new Error('Quote Scenarios requires the shared car Contract URL.');
    const contract = new URL(config['contract-url'], window.location.href);
    if (!['http:', 'https:'].includes(contract.protocol)) throw new Error('Contract URL must be HTTP(S).');
    quoteScenariosUrl = scenarios.href;
    scenarioModuleUrl = new URL('car-quote-scenarios.mjs', contract).href;
  }
  return {
    contentUrl: content.href,
    contentFormat,
    apiBase: api.href.replace(/\/$/, ''),
    purchaseUrl: sameOriginPage(config['purchase-path'] || '/purchase', 'Purchase Path'),
    marketingUrl: sameOriginPage(config['marketing-path'] || '/car', 'Marketing Path'),
    bundleUrl: config['bundle-url'],
    handoffMode,
    quoteScenariosUrl,
    scenarioModuleUrl,
  };
}

function rows(doc, name) {
  const block = doc.querySelector(`.${name}`);
  if (!block) throw new Error(`The content document is missing its ${name} table.`);
  return [...block.children].map((row) => [...row.children]);
}

function text(cell) {
  return cell?.textContent.trim() || '';
}

function list(cell) {
  if (!cell) return [];
  const items = [...cell.querySelectorAll('li')];
  const paragraphs = items.length ? items : [...cell.querySelectorAll('p')];
  return (paragraphs.length ? paragraphs.map(text) : text(cell).split('\n'))
    .map((value) => value.trim()).filter(Boolean);
}

function unique(items, label) {
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    throw new Error(`${label} contains duplicate IDs.`);
  }
}

function parsePurchaseAuthoring(doc) {
  const missing = ['quote-wizard-copy', 'quote-personal-sections', 'quote-personal-fields']
    .filter((name) => !doc.querySelector(`.${name}`));
  if (missing.length) {
    throw new Error(`Car purchase content is missing ${missing.join(', ')} tables. Reimport the updated regular DA tables.`);
  }
  const copyKeys = [
    ...Object.entries(WIZARD_COPY_KEYS).flatMap(([group, keys]) => keys.map((key) => `${group}.${key}`)),
    ...REVIEW_LABEL_KEYS.map((key) => `review.labels.${key}`),
  ];
  const copy = new Map();
  rows(doc, 'quote-wizard-copy').forEach(([keyCell, valueCell]) => {
    const key = text(keyCell);
    if (key.toLowerCase() === 'key') return;
    if (!copyKeys.includes(key) || copy.has(key) || !text(valueCell)) {
      throw new Error(`Unknown, duplicate or empty Quote Wizard Copy row: ${key}.`);
    }
    copy.set(key, text(valueCell));
  });
  const authoring = Object.fromEntries(Object.entries(WIZARD_COPY_KEYS).map(([group, keys]) => [
    group, Object.fromEntries(keys.map((key) => [key, copy.get(`${group}.${key}`)])),
  ]));
  authoring.review.labels = Object.fromEntries(
    REVIEW_LABEL_KEYS.map((key) => [key, copy.get(`review.labels.${key}`)]),
  );
  const sections = new Map();
  rows(doc, 'quote-personal-sections').forEach(([idCell, titleCell]) => {
    const id = text(idCell);
    if (id.toLowerCase() === 'id') return;
    if (!PERSONAL_DETAIL_SECTIONS.some((section) => section.id === id)
      || sections.has(id) || !text(titleCell)) {
      throw new Error(`Unknown, duplicate or empty Quote Personal Sections row: ${id}.`);
    }
    sections.set(id, { title: text(titleCell), fields: {} });
  });
  rows(doc, 'quote-personal-fields').forEach(([
    sectionCell, nameCell, label, errorMessage, hint, placeholder, patternMessage, optionsCell,
  ]) => {
    const id = text(sectionCell);
    if (id.toLowerCase() === 'section') return;
    const name = text(nameCell);
    const rule = PERSONAL_DETAIL_SECTIONS.find((section) => section.id === id)
      ?.fields.find((field) => field.name === name);
    const section = sections.get(id);
    if (!rule || !section || Object.hasOwn(section.fields, name)) {
      throw new Error(`Unsupported or duplicate Quote Personal Fields row: ${id}.${name}.`);
    }
    const options = list(optionsCell).map((option) => {
      const colon = option.indexOf(':');
      if (colon < 1 || !option.slice(colon + 1).trim()) {
        throw new Error(`Invalid ${name} option. Use a supported value: Label.`);
      }
      return { value: option.slice(0, colon).trim(), label: option.slice(colon + 1).trim() };
    });
    section.fields[name] = {
      label: text(label),
      errorMessage: text(errorMessage),
      ...(text(hint) ? { hint: text(hint) } : {}),
      ...(text(placeholder) ? { placeholder: text(placeholder) } : {}),
      ...(text(patternMessage) ? { patternMessage: text(patternMessage) } : {}),
      ...(options.length ? { options } : {}),
    };
  });
  authoring.personalDetails = Object.fromEntries(sections);
  assertPurchaseAuthoring(authoring);
  return authoring;
}

export function parseJourneyContent(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const copy = {};
  rows(doc, 'quote-copy').forEach(([keyCell, valueCell]) => {
    const key = text(keyCell).toLowerCase();
    if (key === 'key') return;
    const property = COPY_KEYS[key];
    if (!property || !text(valueCell)) throw new Error(`Invalid or empty Quote Copy row: ${key}.`);
    if (copy[property]) throw new Error(`Duplicate Quote Copy row: ${key}.`);
    copy[property] = text(valueCell);
  });
  if (Object.values(COPY_KEYS).some((key) => !copy[key])) {
    throw new Error('Complete all required rows in the Quote Copy table.');
  }
  const fields = rows(doc, 'quote-fields')
    .filter(([id]) => text(id).toLowerCase() !== 'id')
    .map(([id, label, type, options]) => {
      const field = { id: text(id), label: text(label), type: text(type) };
      if (!field.label) throw new Error(`Quote field ${field.id} needs a label.`);
      if (field.id === 'coverStart') {
        if (field.type !== 'date') throw new Error('coverStart must be a date field.');
      } else {
        if (!OPTIONS[field.id] || field.type !== 'select') {
          throw new Error(`Unsupported quote field: ${field.id}.`);
        }
        field.options = list(options).map((option) => {
          const colon = option.indexOf(':');
          const value = option.slice(0, colon).trim();
          const optionLabel = option.slice(colon + 1).trim();
          if (colon < 1 || !optionLabel || !OPTIONS[field.id].includes(value)) {
            throw new Error(`Invalid ${field.id} option. Use a supported value: Label.`);
          }
          return { value, label: optionLabel };
        });
        if (!field.options.length) throw new Error(`${field.id} needs at least one option.`);
        if (new Set(field.options.map((option) => option.value)).size !== field.options.length) {
          throw new Error(`${field.id} contains duplicate option values.`);
        }
      }
      return field;
    });
  unique(fields, 'Quote Fields');
  if (fields.length !== 3 || !['vehicleType', 'ageBand', 'coverStart']
    .every((id) => fields.some((field) => field.id === id))) {
    throw new Error('Quote Fields must include vehicleType, ageBand, and coverStart.');
  }
  const plans = rows(doc, 'quote-plans')
    .filter(([id]) => text(id).toLowerCase() !== 'id')
    .map(([id, name, tagline, benefits]) => ({
      id: text(id), name: text(name), tagline: text(tagline), benefits: list(benefits),
    }));
  if (!plans.length || plans.some((plan) => !plan.id || !plan.name
    || !plan.tagline || !plan.benefits.length)) {
    throw new Error('Each Quote Plans row needs an ID, name, tagline, and benefit list.');
  }
  const addOns = rows(doc, 'quote-add-ons')
    .filter(([id]) => text(id).toLowerCase() !== 'id')
    .map(([id, name, description, coverage]) => ({
      id: text(id),
      name: text(name),
      description: text(description),
      ...(text(coverage) ? { coverage: text(coverage) } : {}),
    }));
  if (addOns.some((addOn) => !addOn.id || !addOn.name || !addOn.description)) {
    throw new Error('Each Quote Add Ons row needs an ID, name, and description.');
  }
  unique(plans, 'Quote Plans');
  unique(addOns, 'Quote Add Ons');
  const content = {
    brand: copy.brand,
    eyebrow: copy.eyebrow,
    headline: copy.headline,
    intro: copy.intro,
    preQuoteTitle: copy.preQuoteTitle,
    preQuoteButton: copy.preQuoteButton,
    fields,
    plans,
    addOns,
    declaration: {
      title: copy.declarationTitle, text: copy.declarationText, disclaimer: copy.disclaimer,
    },
  };
  if (doc.querySelector('.quote-benefits')) {
    const excessRows = rows(doc, 'quote-excess');
    const settingsRows = new Map(excessRows.map(([key, value]) => [text(key), text(value)]));
    content.carPurchase = {
      ...parsePurchaseAuthoring(doc),
      benefits: rows(doc, 'quote-benefits').map(([id, label, description, first, second, firstNote]) => ({
        id: text(id),
        label: text(label),
        description: text(description),
        values: { 'collision-only': text(first), complete: text(second) },
        ...(text(firstNote) ? { collisionNote: text(firstNote) } : {}),
      })),
      excesses: excessRows.filter(([key]) => !['excess-note', 'informationTitle', 'customizeTitle', 'detailsTitle', 'reviewTitle'].includes(text(key)))
        .map(([label, value]) => ({ label: text(label), value: text(value) })),
      excessNote: settingsRows.get('excess-note'),
      informationTitle: settingsRows.get('informationTitle'),
      customizeTitle: settingsRows.get('customizeTitle'),
      detailsTitle: settingsRows.get('detailsTitle'),
      reviewTitle: settingsRows.get('reviewTitle'),
    };
  }
  return content;
}

export function validateJourneyContent(content) {
  const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
  if (!content || !['brand', 'eyebrow', 'headline', 'intro', 'preQuoteTitle', 'preQuoteButton']
    .every((key) => nonempty(content[key]))
    || !content.declaration
    || !['title', 'text', 'disclaimer'].every((key) => nonempty(content.declaration[key]))) {
    throw new Error('Structured journey content needs complete page copy and declaration text.');
  }
  if (!Array.isArray(content.fields) || content.fields.length !== 3
    || !['vehicleType', 'ageBand', 'coverStart']
      .every((id) => content.fields.some((field) => field?.id === id))) {
    throw new Error('Quote Fields must include vehicleType, ageBand, and coverStart.');
  }
  content.fields.forEach((field) => {
    if (!nonempty(field.label)) throw new Error(`Quote field ${field.id} needs a label.`);
    if (field.id === 'coverStart') {
      if (field.type !== 'date') throw new Error('coverStart must be a date field.');
    } else {
      if (field.type !== 'select' || !Array.isArray(field.options) || !field.options.length
        || field.options.some((option) => !option || !OPTIONS[field.id].includes(option.value)
          || !nonempty(option.label))) {
        throw new Error(`Invalid ${field.id} options in structured content.`);
      }
      if (new Set(field.options.map((option) => option.value)).size !== field.options.length) {
        throw new Error(`${field.id} contains duplicate option values.`);
      }
    }
  });
  if (!Array.isArray(content.plans) || !content.plans.length
    || content.plans.some((plan) => !plan || !nonempty(plan.id) || !nonempty(plan.name)
      || !nonempty(plan.tagline) || !Array.isArray(plan.benefits)
      || !plan.benefits.length || !plan.benefits.every(nonempty))) {
    throw new Error('Each plan needs an ID, name, tagline, and benefit list.');
  }
  if (!Array.isArray(content.addOns)
    || content.addOns.some((addOn) => !addOn || !nonempty(addOn.id)
      || !nonempty(addOn.name) || !nonempty(addOn.description))) {
    throw new Error('Each add-on needs an ID, name, and description.');
  }
  unique(content.fields, 'Quote Fields');
  unique(content.plans, 'Quote Plans');
  unique(content.addOns, 'Quote Add Ons');
  if (content.carPurchase !== undefined) {
    const purchase = content.carPurchase;
    if (!purchase || !['excessNote', 'informationTitle', 'customizeTitle', 'detailsTitle', 'reviewTitle']
      .every((key) => nonempty(purchase[key]))
      || !Array.isArray(purchase.benefits) || !purchase.benefits.length
      || purchase.benefits.some((benefit) => !benefit || !nonempty(benefit.id)
        || !nonempty(benefit.label) || !nonempty(benefit.description)
        || !benefit.values || typeof benefit.values !== 'object' || Array.isArray(benefit.values)
        || !content.plans.every((plan) => nonempty(benefit.values[plan.id]))
        || (benefit.collisionNote !== undefined && typeof benefit.collisionNote !== 'string'))
      || !Array.isArray(purchase.excesses) || !purchase.excesses.length
      || purchase.excesses.some((item) => !item || !nonempty(item.label) || !nonempty(item.value))
      || content.addOns.some((item) => !nonempty(item.coverage))) {
      throw new Error('Complete the car purchase benefits, add-on coverage and excess content.');
    }
    unique(purchase.benefits, 'Quote Benefits');
    assertPurchaseAuthoring(purchase);
  }
  return content;
}

export async function loadJourneyContent(url, format = 'document') {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to load authored content (HTTP ${response.status}).`);
  if (format === 'json') {
    const delivered = await response.json();
    const content = delivered && Object.hasOwn(delivered, 'metadata')
      ? delivered.data : delivered;
    if (!content || typeof content !== 'object' || Array.isArray(content)
      || !Object.keys(content).length) {
      throw new Error('The structured journey document has no data. Save an edit in DA, then preview or publish it.');
    }
    if (content?.carForm !== undefined) {
      content.fields = [
        ...['vehicleType', 'ageBand'].map((id) => ({
          id,
          label: id === 'vehicleType' ? 'Vehicle type' : 'Mock driver age bucket',
          type: 'select',
          options: OPTIONS[id].map((value) => ({ value, label: value })),
        })),
        { id: 'coverStart', label: 'Policy effective date', type: 'date' },
      ];
    }
    return validateJourneyContent(content);
  }
  return validateJourneyContent(parseJourneyContent(await response.text()));
}

export function validateQuote(quote, content) {
  const pricesValid = (items, products) => Array.isArray(items)
    && items.length === products.length
    && new Set(items.map((item) => item?.id)).size === items.length
    && products.every((product) => items.some((item) => item?.id === product.id
      && typeof item.annualPremium === 'number'
      && Number.isFinite(item.annualPremium) && item.annualPremium >= 0));
  if (!quote || typeof quote.id !== 'string' || !quote.id
    || quote.currency !== 'SGD'
    || typeof quote.expiresAt !== 'string' || Date.parse(quote.expiresAt) <= Date.now()
    || !Number.isFinite(Date.parse(quote.expiresAt))
    || (content.carPurchase && (typeof quote.taxRate !== 'number'
      || !Number.isFinite(quote.taxRate) || quote.taxRate < 0 || quote.taxRate > 1))
    || !content.plans.some((plan) => plan.id === quote.recommendedPlanId)
    || !pricesValid(quote.plans, content.plans)
    || !pricesValid(quote.addOns, content.addOns)) {
    throw new Error('The quote response is invalid or does not match the authored product IDs.');
  }
}

export async function submitQuote(block, form, config, content, carRequest = null) {
  if (form.dataset.submitting === 'true' || !form.reportValidity()) return;
  const submit = form.querySelector('button[type="submit"]');
  if (!submit) throw new Error('The pre-quote form needs a submit button.');
  const originalLabel = submit.textContent;
  block.querySelector('.journey-error')?.remove();
  form.dataset.submitting = 'true';
  submit.disabled = true;
  submit.textContent = 'Preparing your sample quote...';
  try {
    const values = new FormData(form);
    const request = carRequest || Object.fromEntries(
      content.fields.map((field) => [field.id, values.get(field.id)]),
    );
    let quote;
    if (config.quoteScenariosUrl) {
      if (!carRequest) throw new Error('Quote scenarios require the car pre-quote form.');
      const { loadScenarioQuote } = await import(config.scenarioModuleUrl);
      quote = await loadScenarioQuote(config.quoteScenariosUrl, request);
    } else {
      const response = await fetch(`${config.apiBase}/quotes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (!response.ok) throw new Error(`Unable to get a sample quote (HTTP ${response.status}).`);
      quote = await response.json();
    }
    validateQuote(quote, content);
    const consume = config.handoffMode === 'consume';
    localStorage.setItem(
      consume ? CAR_HANDOFF_KEY : HANDOFF_KEY,
      JSON.stringify({ version: consume ? 2 : 1, request, quote }),
    );
    window.location.assign(config.purchaseUrl);
  } catch (error) {
    showError(block, error);
  } finally {
    form.dataset.submitting = 'false';
    submit.disabled = false;
    submit.textContent = originalLabel;
  }
}
