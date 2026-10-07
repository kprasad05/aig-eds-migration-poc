import decoratePreQuote from '../pre-quote/pre-quote.js';
import { readBlockConfig } from '../../scripts/aem.js';
import { settings, showError } from '../../scripts/purchase-journey.js';

export default async function decorate(block) {
  const authored = readBlockConfig(block);
  if (authored.layout === 'car') {
    block.setAttribute('aria-busy', 'true');
    try {
      const { default: decorateCarForm } = await import('../../scripts/car-pre-quote.js');
      await decorateCarForm(block, settings(block, 'json'), null, authored['contract-url']);
    } catch (error) {
      block.replaceChildren();
      showError(block, error);
    } finally {
      block.removeAttribute('aria-busy');
    }
    return;
  }
  block.classList.add('pre-quote');
  await decoratePreQuote(block, 'json');
}
