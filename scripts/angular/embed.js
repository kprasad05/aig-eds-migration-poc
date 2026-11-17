const base = new URL('.', import.meta.url);

try {
  const response = await fetch(new URL('bundle.json', base));
  if (!response.ok) throw new Error(`Bundle manifest returned HTTP ${response.status}.`);
  const manifest = await response.json();
  // The element has scoped styles; importing host-wide styles would affect the EDS page.
  if (!window.Zone) await import(new URL(manifest.polyfills, base).href);
  const app = await import(new URL(manifest.main, base).href);
  await app.ready;
  if (!customElements.get('quote-purchase')) {
    throw new Error('The hosted bundle did not register the purchase element.');
  }
} catch (error) {
  console.error('Unable to embed the purchase demo:', error);
  for (const element of document.querySelectorAll('quote-purchase')) {
    element.replaceChildren(document.createTextNode(
      'Unable to load the purchase demo. Check the bundle host, CORS, and browser console.',
    ));
  }
  throw error;
}
