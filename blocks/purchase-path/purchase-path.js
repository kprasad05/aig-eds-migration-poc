import {
  element, loadJourneyContent, settings, showError,
} from '../../scripts/purchase-journey.js';

export default async function decorate(block) {
  block.setAttribute('aria-busy', 'true');
  try {
    const config = settings(block);
    if (config.handoffMode === 'consume') document.body.classList.add('car-purchase-page');
    if (!config.bundleUrl) throw new Error('Author a Bundle URL row for the Angular embed.js module.');
    const bundle = new URL(config.bundleUrl, window.location.href);
    if (!['http:', 'https:'].includes(bundle.protocol)) {
      throw new Error('Bundle URL must be an HTTP(S) URL.');
    }
    const content = await loadJourneyContent(config.contentUrl, config.contentFormat);
    // Register the element before attaching it so authored inputs reach ngOnInit.
    await import(bundle.href);
    if (!customElements.get('quote-purchase')) {
      throw new Error('The bundle did not register the quote-purchase element.');
    }
    const purchase = element('quote-purchase');
    purchase.authoredContent = content;
    purchase.setAttribute('api-base', config.apiBase);
    purchase.setAttribute('marketing-url', config.marketingUrl);
    purchase.setAttribute('purchase-url', config.purchaseUrl);
    purchase.setAttribute('handoff-mode', config.handoffMode);
    block.replaceChildren(purchase);
  } catch (error) {
    block.replaceChildren();
    showError(block, error);
  } finally {
    block.removeAttribute('aria-busy');
  }
}
