import {
  element, loadJourneyContent, settings, showError, submitQuote,
} from '../../scripts/purchase-journey.js';

export default async function decorate(block, defaultFormat = 'document') {
  block.setAttribute('aria-busy', 'true');
  try {
    const config = settings(block, defaultFormat);
    const content = await loadJourneyContent(config.contentUrl, config.contentFormat);
    const hero = element('section', 'pre-quote-hero');
    hero.append(
      element('p', 'pre-quote-eyebrow', content.eyebrow),
      element('h1', '', content.headline),
      element('p', 'pre-quote-intro', content.intro),
      element('p', 'pre-quote-note', 'Sample cover only. No payment or policy purchase.'),
    );
    const panel = element('section', 'pre-quote-panel');
    const form = element('form');
    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    content.fields.forEach((field) => {
      const id = `pre-quote-${field.id}`;
      const label = element('label', '', field.label);
      label.htmlFor = id;
      const control = element(field.type === 'select' ? 'select' : 'input');
      control.name = field.id;
      control.id = id;
      control.required = true;
      if (field.type === 'select') {
        const placeholder = element('option', '', 'Please select');
        placeholder.value = '';
        placeholder.disabled = true;
        placeholder.selected = true;
        control.append(placeholder);
        field.options.forEach((option) => {
          const node = element('option', '', option.label);
          node.value = option.value;
          control.append(node);
        });
      } else {
        control.type = 'date';
        control.min = date;
        control.value = date;
      }
      form.append(label, control);
    });
    const submit = element('button', '', content.preQuoteButton);
    submit.type = 'submit';
    form.append(submit);
    panel.append(
      element('h2', '', content.preQuoteTitle),
      element('p', '', 'Use sample selections. Your quote will carry into the purchase journey.'),
      form,
      element('p', 'pre-quote-note', config.contentFormat === 'json'
        ? 'Form copy and options come from structured JSON. The local fixture is not DA-published.'
        : 'Form copy and options come from the shared authoring document.'),
    );
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      await submitQuote(block, form, config, content);
    });
    block.replaceChildren(hero, panel);
  } catch (error) {
    block.replaceChildren();
    showError(block, error);
  } finally {
    block.removeAttribute('aria-busy');
  }
}
