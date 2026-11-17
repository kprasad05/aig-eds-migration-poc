/*
 * Adapted from aemsites/da-block-collection, blocks/form/form.js (Apache-2.0).
 * Modified: explicit errors, configurable definition URLs, and mock quote submission.
 */
import { readBlockConfig } from '../../scripts/aem.js';
import {
  loadJourneyContent, settings, showError, submitQuote,
} from '../../scripts/purchase-journey.js';
import { createForm } from './form-fields.js';

function configureQuoteFields(form, content) {
  content.fields.forEach((field) => {
    const controls = [...form.elements].filter((control) => control.name === field.id);
    if (controls.length !== 1 || !controls[0].required) {
      throw new Error(`The quote sheet needs one mandatory ${field.id} field.`);
    }
    const [control] = controls;
    if (field.type === 'select') {
      if (control.tagName !== 'SELECT') throw new Error(`${field.id} must be a select field.`);
      const options = [...control.options].filter((option) => option.value);
      if (!options.length || !options.every((option) => field.options
        .some((supported) => supported.value === option.value))) {
        throw new Error(`The quote sheet contains unsupported or empty ${field.id} options.`);
      }
    } else {
      if (control.type !== 'date') throw new Error(`${field.id} must be a date field.`);
      const today = new Date();
      control.min = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      if (!control.value) control.value = control.min;
    }
  });
}

export default async function decorate(block) {
  block.setAttribute('aria-busy', 'true');
  try {
    const authored = readBlockConfig(block);
    if (!authored.definition) throw new Error('Author a Definition JSON link for the form sheet.');
    const config = settings(block);
    if (authored.layout === 'car') {
      const { default: decorateCarForm } = await import('../../scripts/car-pre-quote.js');
      await decorateCarForm(block, config, authored.definition, authored['contract-url']);
      return;
    }
    const [form, content] = await Promise.all([
      createForm(authored.definition),
      loadJourneyContent(config.contentUrl, config.contentFormat),
    ]);
    configureQuoteFields(form, content);
    block.replaceChildren(form);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      await submitQuote(block, form, config, content);
    });
  } catch (error) {
    block.replaceChildren();
    showError(block, error);
  } finally {
    block.removeAttribute('aria-busy');
  }
}
