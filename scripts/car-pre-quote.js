import { createForm } from '../blocks/da-form/form-fields.js';
import {
  element, loadJourneyContent, showError, submitQuote,
} from './purchase-journey.js';

function searchable(select) {
  const label = select.parentElement.querySelector('label')?.textContent || select.name;
  const options = [...select.options].filter((option) => option.value)
    .map((option) => ({ value: option.value, label: option.textContent }));
  const input = element('input');
  input.type = 'text';
  input.id = select.id;
  input.required = select.required;
  input.placeholder = select.options[0].value ? '' : select.options[0].textContent;
  input.autocomplete = 'off';
  input.dataset.valueName = select.name;
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  const hidden = element('input');
  hidden.type = 'hidden';
  hidden.name = select.name;
  const list = element('div', 'quote-options');
  list.id = `${input.id}-options`;
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', `${label} options`);
  list.hidden = true;
  input.setAttribute('aria-controls', list.id);
  const toggle = element('button', 'quote-dropdown');
  toggle.type = 'button';
  toggle.tabIndex = -1;
  toggle.setAttribute('aria-label', `Show ${label} options`);
  let available = options;
  let active = -1;
  const close = () => {
    list.hidden = true;
    active = -1;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  };
  const sync = () => {
    const value = input.value.trim().toLowerCase();
    const match = available.find((option) => option.label.toLowerCase() === value);
    hidden.value = match?.value || '';
    input.setCustomValidity(input.value && !match ? 'Choose an option from the list.' : '');
  };
  const open = (showAll = false) => {
    if (input.disabled) return;
    const query = showAll && hidden.value ? '' : input.value.trim().toLowerCase();
    const filtered = available.filter((option) => option.label.toLowerCase().includes(query));
    active = -1;
    input.removeAttribute('aria-activedescendant');
    list.replaceChildren(...filtered.map((option, index) => {
      const node = element('button', 'quote-option', option.label);
      node.type = 'button';
      node.tabIndex = -1;
      node.id = `${list.id}-${index}`;
      node.dataset.value = option.value;
      node.setAttribute('role', 'option');
      node.setAttribute('aria-selected', 'false');
      node.addEventListener('pointerdown', (event) => event.preventDefault());
      node.addEventListener('click', () => {
        input.value = option.label;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        close();
      });
      return node;
    }));
    if (!filtered.length) list.append(element('span', 'quote-no-options', 'No matching options'));
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };
  const setOptions = (values) => {
    available = values;
    sync();
    close();
  };
  const setValue = (value) => {
    input.value = available.find((option) => option.value === value)?.label || '';
    sync();
  };
  setOptions(options);
  setValue(select.value);
  select.replaceWith(input, hidden);
  input.addEventListener('input', () => { sync(); open(); });
  input.addEventListener('focus', () => open(true));
  input.addEventListener('click', () => open(true));
  input.addEventListener('blur', close);
  toggle.addEventListener('pointerdown', (event) => event.preventDefault());
  toggle.addEventListener('click', () => {
    if (list.hidden) { input.focus(); open(true); } else close();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { close(); return; }
    if (event.key === 'Tab') { close(); return; }
    if (event.key === 'Enter' && !list.hidden && active >= 0) {
      event.preventDefault();
      list.children[active].click();
      return;
    }
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    if (list.hidden) open(true);
    const nodes = [...list.querySelectorAll('[role="option"]')];
    if (!nodes.length) return;
    if (active < 0) active = event.key === 'ArrowDown' ? 0 : nodes.length - 1;
    else active = (active + (event.key === 'ArrowDown' ? 1 : nodes.length - 1)) % nodes.length;
    nodes.forEach((node, index) => node.setAttribute('aria-selected', String(index === active)));
    input.setAttribute('aria-activedescendant', nodes[active].id);
    nodes[active].scrollIntoView({ block: 'nearest' });
  });
  return {
    input, hidden, options, setOptions, setValue, list, toggle,
  };
}

function addHelp(wrapper, control) {
  if (!wrapper.dataset.tooltip) return;
  const button = element('button', 'quote-help', '?');
  button.type = 'button';
  button.setAttribute('aria-label', `About ${control.getAttribute('aria-label') || control.name || control.dataset.valueName}`);
  button.setAttribute('aria-expanded', 'false');
  const tooltip = element('span', 'quote-tooltip', wrapper.dataset.tooltip);
  tooltip.id = `${control.id}-help`;
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  button.setAttribute('aria-controls', tooltip.id);
  control.setAttribute('aria-describedby', tooltip.id);
  button.addEventListener('click', () => {
    tooltip.hidden = !tooltip.hidden;
    button.setAttribute('aria-expanded', String(!tooltip.hidden));
  });
  button.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      tooltip.hidden = true;
      button.setAttribute('aria-expanded', 'false');
    }
  });
  control.parentElement.append(button, tooltip);
}

export default async function decorateCarForm(block, config, definitionUrl, contractUrl) {
  if (!contractUrl) throw new Error('Author a Contract URL for the shared mock car rules.');
  const url = new URL(contractUrl, window.location.href);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Contract URL must be an HTTP(S) module URL.');
  }
  const [content, rules] = await Promise.all([
    loadJourneyContent(config.contentUrl, config.contentFormat),
    import(url.href),
  ]);
  let definition = definitionUrl;
  if (!definitionUrl) {
    const { createStructuredCarDefinition } = await import(
      new URL('car-form-content.mjs', url).href
    );
    definition = createStructuredCarDefinition(content.carForm, content.preQuoteButton, url);
  }
  const form = await createForm(definition);
  const required = ['vehicleMake', 'vehicleModel', 'registrationYear', 'dobDay', 'dobMonth',
    'dobYear', 'occupation', 'drivingExperience', 'coverStart', 'claimCount', 'ncd',
    'claimAmount', 'claimDay', 'claimMonth', 'claimYear', 'maritalStatus', 'gender',
    'vehicleRegistration', 'driverAgeCondition', 'annualMileage', 'offPeakCar'];
  const controls = {};
  required.forEach((name) => {
    const matching = [...form.elements].filter((control) => control.name === name);
    if (matching.length !== 1 || !matching[0].required) {
      throw new Error(`The car sheet needs one mandatory ${name} field.`);
    }
    [controls[name]] = matching;
  });
  ['vehicle', 'driver', 'policy', 'claims', 'claimDetails', 'claimLoss', 'discount',
    'additionalDriver', 'additionalVehicle', 'additionalCover', 'additionalUsage'].forEach((name) => {
    if (form.querySelectorAll(`fieldset[name="${name}"]`).length !== 1) {
      throw new Error(`The car sheet needs one ${name} fieldset.`);
    }
  });
  const allowed = {
    vehicleMake: Object.keys(rules.VEHICLES),
    vehicleModel: Object.values(rules.VEHICLES).flat().map((vehicle) => vehicle.value),
    occupation: ['professional', 'manager', 'clerical', 'self-employed', 'retired'],
    claimCount: ['0', '1', 'more than 1'],
    ncd: ['0%', '10%', '20%', '30%', '40%', '50%'],
    maritalStatus: ['single', 'married', 'others'],
    gender: ['male', 'female'],
    driverAgeCondition: ['all ages', '30 years and above', '35 years and above', '40 years and above'],
    annualMileage: ['unlimited mileage', 'up to 10000 km annually', 'up to 5000 km annually'],
    offPeakCar: ['non off peak car', 'off peak car'],
  };
  Object.entries(allowed).forEach(([name, values]) => {
    const select = controls[name];
    if (select.tagName !== 'SELECT' || ![...select.options].some((option) => option.value)
      || [...select.options].some((option) => option.value && !values.includes(option.value))) {
      throw new Error(`The car sheet contains unsupported ${name} options.`);
    }
  });
  if (controls.coverStart.type !== 'date' || controls.claimDay.tagName !== 'SELECT'
    || controls.claimMonth.tagName !== 'SELECT' || controls.claimYear.type !== 'text'
    || controls.claimAmount.type !== 'number' || controls.drivingExperience.type !== 'number') {
    throw new Error('The car sheet needs a policy date, split loss date, and numeric driving/claim controls.');
  }
  block.classList.add('da-form', 'car');
  form.id = 'car-quote-form';
  form.setAttribute('aria-label', 'Car insurance pre-quote');
  const choices = {
    vehicleMake: searchable(controls.vehicleMake),
    vehicleModel: searchable(controls.vehicleModel),
    occupation: searchable(controls.occupation),
  };
  const updateModel = () => {
    const make = choices.vehicleMake.hidden.value;
    choices.vehicleModel.setValue('');
    choices.vehicleModel.setOptions(choices.vehicleModel.options
      .filter((option) => option.value.startsWith(`${make}-`)));
    choices.vehicleModel.input.disabled = !make;
    choices.vehicleModel.hidden.disabled = !make;
    choices.vehicleModel.toggle.disabled = !make;
  };
  choices.vehicleMake.input.addEventListener('input', updateModel);
  updateModel();
  form.querySelectorAll('input,select').forEach((control) => {
    control.autocomplete = 'off';
    if (control.type === 'hidden') return;
    const wrapper = control.closest('.field-wrapper');
    const container = element('span', 'quote-control');
    if (control.dataset.valueName) container.classList.add('search-control');
    control.replaceWith(container);
    container.append(control);
    const choice = choices[control.dataset.valueName];
    if (choice) container.append(choice.toggle, choice.list);
    addHelp(wrapper, control);
  });
  const today = new Date();
  const dateString = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  controls.coverStart.min = dateString(today);
  if (!controls.coverStart.value) controls.coverStart.value = dateString(tomorrow);
  controls.claimAmount.min = '0.01';
  controls.claimAmount.step = '0.01';
  controls.drivingExperience.min = '2';
  controls.drivingExperience.max = '52';
  [controls.dobYear, controls.claimYear].forEach((control) => {
    control.inputMode = 'numeric';
    control.maxLength = 4;
    control.pattern = '[0-9]{4}';
  });
  controls.vehicleRegistration.maxLength = 8;
  controls.vehicleRegistration.pattern = '[A-Za-z]{1,3}[0-9]{1,4}[A-Za-z]';
  [controls.coverStart].forEach((control) => {
    const display = element('span', 'date-display');
    display.setAttribute('aria-hidden', 'true');
    const update = () => {
      display.textContent = control.value
        ? control.value.split('-').reverse().join('/') : 'DD/MM/YYYY';
    };
    control.parentElement.append(display);
    control.addEventListener('input', update);
    control.addEventListener('change', update);
    update();
  });
  const claimGroups = ['claimDetails', 'claimLoss']
    .map((name) => form.querySelector(`fieldset[name="${name}"]`));
  const toggleClaims = () => {
    const visible = controls.claimCount.value === '1';
    claimGroups.forEach((group) => {
      group.closest('.field-wrapper').hidden = !visible;
      group.disabled = !visible;
    });
    if (!visible) {
      ['claimAmount', 'claimDay', 'claimMonth', 'claimYear'].forEach((name) => {
        controls[name].value = '';
        controls[name].removeAttribute('aria-invalid');
      });
    }
  };
  controls.claimCount.addEventListener('change', toggleClaims);
  toggleClaims();
  const additionalNames = ['maritalStatus', 'gender', 'vehicleRegistration',
    'driverAgeCondition', 'annualMileage', 'offPeakCar'];
  const additionalDefaults = Object.fromEntries(additionalNames
    .map((name) => [name, controls[name].value]));
  const additionalGroups = ['additionalDriver', 'additionalVehicle',
    'additionalCover', 'additionalUsage']
    .map((name) => form.querySelector(`fieldset[name="${name}"]`));
  const ageOptions = [...controls.driverAgeCondition.options]
    .map((option) => option.cloneNode(true));
  let additionalVisible = false;
  const updateAdditional = () => {
    const values = Object.fromEntries(new FormData(form));
    let age;
    try {
      age = rules.validateCarPrimaryAnswers(values);
    } catch (error) {
      if (!(error instanceof rules.CarValidationError)) throw error;
    }
    const visible = age !== undefined;
    additionalGroups.forEach((group) => {
      group.closest('.field-wrapper').hidden = !visible;
      group.disabled = !visible;
    });
    if (!visible && additionalVisible) {
      additionalNames.forEach((name) => {
        const control = controls[name];
        control.value = additionalDefaults[name];
        control.removeAttribute('aria-invalid');
      });
    }
    if (visible) {
      const previous = controls.driverAgeCondition.value;
      controls.driverAgeCondition.replaceChildren(...ageOptions
        .filter((option) => option.value === 'all ages' || Number.parseInt(option.value, 10) <= age)
        .map((option) => option.cloneNode(true)));
      controls.driverAgeCondition.value = [...controls.driverAgeCondition.options]
        .some((option) => option.value === previous) ? previous : 'all ages';
    }
    additionalVisible = visible;
  };
  form.querySelectorAll('input,select').forEach((control) => {
    const name = control.dataset.valueName || control.name;
    if (control.type === 'hidden' || additionalNames.includes(name)) return;
    control.addEventListener('input', updateAdditional);
    control.addEventListener('change', updateAdditional);
  });
  updateAdditional();
  const heading = element('h1', 'quote-sr-only', content.preQuoteTitle);
  const sample = element('button', 'sample-quote', 'Use sample details');
  sample.type = 'button';
  sample.addEventListener('click', () => {
    choices.vehicleMake.setValue('toyota');
    updateModel();
    choices.vehicleModel.setValue('toyota-corolla');
    choices.occupation.setValue('professional');
    const values = {
      registrationYear: String(today.getFullYear() - 3),
      dobDay: '10',
      dobMonth: '5',
      dobYear: '1990',
      drivingExperience: '12',
      coverStart: dateString(tomorrow),
      claimCount: '0',
      ncd: '30%',
    };
    Object.entries(values).forEach(([name, value]) => {
      controls[name].value = value;
      controls[name].dispatchEvent(new Event('input'));
    });
    toggleClaims();
    updateAdditional();
    const additional = {
      maritalStatus: 'single',
      gender: 'female',
      vehicleRegistration: 'SGB1234A',
      driverAgeCondition: 'all ages',
      annualMileage: 'unlimited mileage',
      offPeakCar: 'non off peak car',
    };
    Object.entries(additional).forEach(([name, value]) => { controls[name].value = value; });
    form.querySelectorAll('[aria-invalid]').forEach((control) => control.removeAttribute('aria-invalid'));
    block.querySelector('.journey-error')?.remove();
  });
  const note = element('div', 'quote-demo-note', 'Demo only. Use fictional information. ');
  note.append(sample);
  const dialog = element('dialog', 'quote-validation');
  dialog.setAttribute('aria-label', 'Please check your details');
  const dismiss = element('button', 'quote-validation-close', '\u00d7');
  dismiss.type = 'button';
  dismiss.setAttribute('aria-label', 'Close validation message');
  const message = element('p');
  message.id = `${form.id}-validation`;
  dialog.setAttribute('aria-describedby', message.id);
  dialog.append(dismiss, message);
  dismiss.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) {
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right
        || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    }
  });
  const notify = (control, text) => {
    control.setAttribute('aria-invalid', 'true');
    message.textContent = text;
    if (!dialog.open) dialog.showModal();
  };
  const birthday = () => `${controls.dobYear.value}-${controls.dobMonth.value.padStart(2, '0')}-${controls.dobDay.value.padStart(2, '0')}`;
  const validateField = (control) => {
    if (control.disabled || control.closest('fieldset')?.disabled) return '';
    if (!control.validity.valid) {
      const label = form.querySelector(`label[for="${control.id}"]`)?.textContent || 'this field';
      return control.validity.valueMissing ? `Please complete ${label}.` : control.validationMessage;
    }
    const name = control.dataset.valueName || control.name;
    const dobComplete = ['dobDay', 'dobMonth', 'dobYear'].every((key) => controls[key].value);
    if (dobComplete && ['dobDay', 'dobMonth', 'dobYear', 'coverStart'].includes(name)) {
      try {
        rules.validateDriverDOB(birthday(), controls.coverStart.value);
      } catch (error) {
        if (!(error instanceof rules.CarValidationError)) throw error;
        return error.message;
      }
    }
    if (name === 'drivingExperience' && dobComplete
      && rules.calendarDate(birthday()) && rules.calendarDate(controls.coverStart.value)
      && Number(control.value) > rules.ageAt(birthday(), controls.coverStart.value) - 18) {
      return 'Driving experience cannot exceed your age minus 18.';
    }
    if (name === 'claimCount' && control.value === 'more than 1') {
      return 'More than one claim requires assisted quoting in this mock demo.';
    }
    if (['claimDay', 'claimMonth', 'claimYear'].includes(name)
      && ['claimDay', 'claimMonth', 'claimYear'].every((key) => controls[key].value)) {
      const lossDate = `${controls.claimYear.value}-${controls.claimMonth.value.padStart(2, '0')}-${controls.claimDay.value.padStart(2, '0')}`;
      try {
        rules.validateLossDate(lossDate);
      } catch (error) {
        if (!(error instanceof rules.CarValidationError)) throw error;
        return error.message;
      }
    }
    return '';
  };
  const visitorControls = [...form.querySelectorAll('input:not([type="hidden"]), select')];
  visitorControls.forEach((control) => {
    control.addEventListener('input', () => control.removeAttribute('aria-invalid'));
    control.addEventListener('blur', (event) => {
      if (control.name === 'registrationYear') return;
      if (dialog.open || event.relatedTarget?.closest('.sample-quote,.submit-quote')) return;
      const text = validateField(control);
      if (text) notify(control, text);
      else control.removeAttribute('aria-invalid');
    });
  });
  form.noValidate = true;
  block.replaceChildren(heading, form, note, dialog);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (form.dataset.submitting === 'true') return;
    const invalid = visitorControls.find((control) => validateField(control));
    if (invalid) {
      showError(block, new Error(validateField(invalid)));
      notify(invalid, validateField(invalid));
      return;
    }
    try {
      const request = rules.buildCarQuoteRequest(Object.fromEntries(new FormData(form)));
      await submitQuote(block, form, config, content, request);
    } catch (error) {
      showError(block, error);
      if (error instanceof rules.CarValidationError) {
        const control = choices[error.field]?.input || controls[error.field];
        if (control) notify(control, error.message);
      }
    }
  });
}
