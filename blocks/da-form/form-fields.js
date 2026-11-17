/*
 * Adapted from aemsites/da-block-collection, blocks/form/form-fields.js (Apache-2.0).
 * Modified: Map-based IDs, checked option requests, optional column defaults,
 * and relative confirmation URLs.
 */
import { toClassName } from '../../scripts/aem.js';

function createFieldWrapper(fd) {
  const fieldWrapper = document.createElement('div');
  if (fd.Style) fieldWrapper.className = fd.Style;
  fieldWrapper.classList.add('field-wrapper', `${fd.Type}-wrapper`);
  if (fd.Fieldset) fieldWrapper.dataset.fieldset = fd.Fieldset;
  return fieldWrapper;
}

const ids = new Map();
function generateFieldId(fd, suffix = '') {
  const slug = toClassName(`form-${fd.Name}${suffix}`);
  const count = ids.get(slug) || 0;
  ids.set(slug, count + 1);
  return `${slug}${count ? `-${count}` : ''}`;
}

function createLabel(fd) {
  const label = document.createElement('label');
  label.id = generateFieldId(fd, '-label');
  label.textContent = fd.Label || fd.Name;
  label.htmlFor = fd.Id;
  if (['true', 'x'].includes(fd.Mandatory.toLowerCase())) label.dataset.required = true;
  return label;
}

function setCommonAttributes(field, fd) {
  field.id = fd.Id;
  field.name = fd.Name;
  field.required = ['true', 'x'].includes(fd.Mandatory.toLowerCase());
  if (fd.Placeholder) field.placeholder = fd.Placeholder;
  if (fd.Value) field.value = fd.Value;
}

const createHeading = (fd) => {
  const fieldWrapper = createFieldWrapper(fd);
  const heading = document.createElement(fd.Style?.includes('sub-heading') ? 'h3' : 'h2');
  heading.textContent = fd.Value || fd.Label;
  heading.id = fd.Id;
  fieldWrapper.append(heading);
  return { field: heading, fieldWrapper };
};

const createPlaintext = (fd) => {
  const fieldWrapper = createFieldWrapper(fd);
  const text = document.createElement('p');
  text.textContent = fd.Value || fd.Label;
  text.id = fd.Id;
  fieldWrapper.append(text);
  return { field: text, fieldWrapper };
};

const createSelect = async (fd) => {
  const select = document.createElement('select');
  setCommonAttributes(select, fd);
  const addOption = ({ text, value }) => {
    const option = document.createElement('option');
    option.text = text.trim();
    option.value = value.trim();
    if (option.value === fd.Value) option.selected = true;
    select.add(option);
    return option;
  };
  if (fd.Placeholder) {
    const placeholder = addOption({ text: fd.Placeholder, value: '' });
    placeholder.disabled = true;
    placeholder.selected = !fd.Value;
  }
  if (fd.Options) {
    let options;
    if (Array.isArray(fd.Options)) {
      if (fd.Options.some((option) => !option || typeof option.Option !== 'string'
        || typeof option.Value !== 'string')) {
        throw new Error(`Invalid options data for ${fd.Name}.`);
      }
      options = fd.Options.map((option) => ({ text: option.Option, value: option.Value }));
    } else if (/^https?:\/\//.test(fd.Options) || fd.Options.startsWith('/')) {
      const optionsUrl = new URL(fd.Options, window.location.href);
      const response = await fetch(optionsUrl.href);
      if (!response.ok) throw new Error(`Unable to load ${fd.Name} options (HTTP ${response.status}).`);
      const json = await response.json();
      if (!Array.isArray(json.data) || json.data.some((option) => !option
        || typeof option.Option !== 'string'
        || (option.Value !== undefined && typeof option.Value !== 'string'))) {
        throw new Error(`Invalid options data for ${fd.Name}.`);
      }
      options = json.data.map((option) => ({
        text: option.Option, value: option.Value || option.Option,
      }));
    } else {
      options = fd.Options.split(',').map((option) => ({
        text: option.trim(), value: option.trim().toLowerCase(),
      }));
    }
    options.forEach(addOption);
  }
  const fieldWrapper = createFieldWrapper(fd);
  fieldWrapper.append(select);
  fieldWrapper.prepend(createLabel(fd));
  return { field: select, fieldWrapper };
};

const createConfirmation = (fd, form) => {
  const url = new URL(fd.Value, window.location.href);
  if (url.origin !== window.location.origin) {
    throw new Error('Form confirmation must use this page\'s origin.');
  }
  form.dataset.confirmation = url.href;
  return {};
};

const createSubmit = (fd) => {
  const button = document.createElement('button');
  button.textContent = fd.Label || fd.Name;
  button.classList.add('button');
  button.type = 'submit';
  const fieldWrapper = createFieldWrapper(fd);
  fieldWrapper.append(button);
  return { field: button, fieldWrapper };
};

const createTextArea = (fd) => {
  const field = document.createElement('textarea');
  setCommonAttributes(field, fd);
  const fieldWrapper = createFieldWrapper(fd);
  const label = createLabel(fd);
  field.setAttribute('aria-labelledby', label.id);
  fieldWrapper.append(field);
  fieldWrapper.prepend(label);
  return { field, fieldWrapper };
};

const createInput = (fd) => {
  const field = document.createElement('input');
  field.type = fd.Type;
  setCommonAttributes(field, fd);
  const fieldWrapper = createFieldWrapper(fd);
  const label = createLabel(fd);
  field.setAttribute('aria-labelledby', label.id);
  fieldWrapper.append(field);
  if (fd.Type === 'radio' || fd.Type === 'checkbox') {
    fieldWrapper.append(label);
  } else {
    fieldWrapper.prepend(label);
  }
  return { field, fieldWrapper };
};

const createFieldset = (fd) => {
  const field = document.createElement('fieldset');
  setCommonAttributes(field, fd);
  if (fd.Label) {
    const legend = document.createElement('legend');
    legend.textContent = fd.Label;
    field.append(legend);
  }
  const fieldWrapper = createFieldWrapper(fd);
  fieldWrapper.append(field);
  return { field, fieldWrapper };
};

const createToggle = (fd) => {
  const { field, fieldWrapper } = createInput(fd);
  field.type = 'checkbox';
  if (!fd.Value) field.value = 'on';
  field.classList.add('toggle');
  fieldWrapper.classList.add('selection-wrapper');
  const toggleSwitch = document.createElement('div');
  toggleSwitch.classList.add('switch');
  toggleSwitch.append(field);
  fieldWrapper.append(toggleSwitch);
  const slider = document.createElement('span');
  slider.classList.add('slider');
  slider.setAttribute('aria-hidden', 'true');
  toggleSwitch.append(slider);
  slider.addEventListener('click', () => {
    field.checked = !field.checked;
    field.dispatchEvent(new Event('change', { bubbles: true }));
  });
  return { field, fieldWrapper };
};

const createCheckbox = (fd) => {
  const { field, fieldWrapper } = createInput(fd);
  if (!fd.Value) field.value = 'checked';
  fieldWrapper.classList.add('selection-wrapper');
  return { field, fieldWrapper };
};

const createRadio = (fd) => {
  const { field, fieldWrapper } = createInput(fd);
  if (!fd.Value) field.value = fd.Label || 'on';
  fieldWrapper.classList.add('selection-wrapper');
  return { field, fieldWrapper };
};

const FIELD_CREATOR_FUNCTIONS = {
  select: createSelect,
  heading: createHeading,
  plaintext: createPlaintext,
  'text-area': createTextArea,
  toggle: createToggle,
  submit: createSubmit,
  confirmation: createConfirmation,
  fieldset: createFieldset,
  checkbox: createCheckbox,
  radio: createRadio,
};

export default async function createField(fd, form) {
  fd.Id = fd.Id || generateFieldId(fd);
  fd.Type = fd.Type.toLowerCase();
  const create = FIELD_CREATOR_FUNCTIONS[fd.Type] || createInput;
  const fields = await create(fd, form);
  return fields.fieldWrapper;
}

export async function createForm(source) {
  let json = source;
  let definitionUrl = window.location.href;
  if (typeof source === 'string') {
    const url = new URL(source, window.location.href);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('Form Definition must be an HTTP(S) JSON URL.');
    }
    const response = await fetch(url.href);
    if (!response.ok) throw new Error(`Unable to load form definitions (HTTP ${response.status}).`);
    json = await response.json();
    definitionUrl = url.href;
  }
  if (!json || !Array.isArray(json.data) || !json.data.length
    || json.data.some((field) => !field || typeof field.Name !== 'string'
      || !field.Name || typeof field.Type !== 'string' || !field.Type
      || (field.Mandatory !== undefined && typeof field.Mandatory !== 'string'))) {
    throw new Error('Form definitions need a data array with Name, Type, and Mandatory columns.');
  }
  const form = document.createElement('form');
  const fields = await Promise.all(json.data.map(async (fd) => {
    const definition = { ...fd, Mandatory: fd.Mandatory || '' };
    if (definition.Type.toLowerCase() === 'select' && typeof definition.Options === 'string'
      && /^\.{1,2}\//.test(definition.Options)) {
      definition.Options = new URL(definition.Options, definitionUrl).href;
    }
    const field = await createField(definition, form);
    if (field) {
      if (fd.PreText) {
        const prefix = document.createElement('span');
        prefix.className = 'sentence-text';
        prefix.textContent = fd.PreText;
        field.prepend(prefix);
      }
      if (fd.PostText) {
        const suffix = document.createElement('span');
        suffix.className = 'sentence-text';
        suffix.textContent = fd.PostText;
        field.append(suffix);
      }
      if (fd.Tooltip) field.dataset.tooltip = fd.Tooltip;
    }
    return field;
  }));
  fields.forEach((field) => {
    if (field) form.append(field);
  });
  form.querySelectorAll('fieldset').forEach((fieldset) => {
    form.querySelectorAll(`[data-fieldset="${CSS.escape(fieldset.name)}"]`).forEach((field) => {
      if (!field.contains(fieldset)) fieldset.append(field);
    });
  });
  if (form.querySelectorAll('button[type="submit"]').length !== 1) {
    throw new Error('Form definitions need exactly one submit button.');
  }
  return form;
}
