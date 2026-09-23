/*
 * Dynamic Media Image Block
 * Renders an AEM Dynamic Media asset (picked in DA.live via the "Insert AEM Asset"
 * toolbar action) as a responsive, optimized <picture>.
 */

// Matches AEM as a Cloud Service author/delivery hosts, e.g.
// author-p56807-e1482157.adobeaemcloud.com or delivery-p56807-e1482157.adobeaemcloud.com
const DM_HOST_PATTERN = /^(author|delivery)-p\d+-e\d+\.adobeaemcloud\.com$/i;

const DEFAULT_WIDTHS = [320, 480, 768, 1024, 1600, 2000];
const DEFAULT_SIZES = '100vw';

/**
 * Checks whether a URL points at an AEM/Dynamic Media asset delivery host.
 * @param {string} href the URL to check
 * @returns {boolean} true if the URL's host matches the DM asset host pattern
 */
function isDmAssetHref(href) {
  try {
    const { hostname } = new URL(href, window.location.href);
    return DM_HOST_PATTERN.test(hostname);
  } catch {
    return false;
  }
}

/**
 * Derives a human readable label from an asset URL's filename.
 * @param {string} url asset URL
 * @returns {string} filename without extension, with separators turned into spaces
 */
function filenameFromUrl(url) {
  try {
    const { pathname } = new URL(url, window.location.href);
    const filename = pathname.split('/').pop() || '';
    return filename.replace(/\.[^./]+$/, '').replace(/[-_]+/g, ' ').trim();
  } catch {
    return '';
  }
}

/**
 * Builds a responsive srcset for a Dynamic Media / AEM Assets delivery URL by
 * requesting one rendition per width via DM Open API style query params.
 * @param {string} assetUrl base asset delivery URL
 * @param {number[]} widths widths (in px) to request renditions for
 * @param {{format?: string, quality?: string}} [options] rendition options
 * @returns {{srcset: string, src: string}} srcset string and a default fallback src
 */
export function buildDmSrcset(assetUrl, widths, { format = 'webply', quality = 'medium' } = {}) {
  const base = new URL(assetUrl, window.location.href);
  const variantUrl = (width) => {
    const variant = new URL(base);
    variant.searchParams.set('width', width);
    variant.searchParams.set('format', format);
    variant.searchParams.set('optimize', quality);
    return variant.toString();
  };
  const srcset = widths.map((width) => `${variantUrl(width)} ${width}w`).join(', ');
  const defaultWidth = widths[Math.floor(widths.length / 2)];
  return { srcset, src: variantUrl(defaultWidth) };
}

/**
 * loads and decorates the block
 * @param {Element} block The block element
 */
export default function decorate(block) {
  const [imageRow, captionRow] = [...block.children];
  const scope = imageRow || block;

  const img = scope.querySelector('img');
  const anchor = scope.querySelector('a');

  let assetUrl = '';
  let alt = '';
  if (img) {
    assetUrl = img.currentSrc || img.src;
    alt = img.alt || '';
  } else if (anchor && isDmAssetHref(anchor.href)) {
    assetUrl = anchor.href;
    const linkText = anchor.textContent.trim();
    // DA.live's link-mode picker uses the raw filename as link text; humanize
    // it the same way a missing alt/caption falls back to the filename.
    alt = /\.[a-z0-9]{2,4}$/i.test(linkText) ? filenameFromUrl(linkText) : linkText;
  }

  if (!assetUrl) {
    // eslint-disable-next-line no-console
    console.warn('[dm-image] no image or Dynamic Media asset link found in block; leaving content as authored.', block);
    return;
  }

  const captionText = captionRow ? captionRow.textContent.trim() : '';
  if (!alt) alt = captionText || filenameFromUrl(assetUrl);

  const { srcset, src } = buildDmSrcset(assetUrl, DEFAULT_WIDTHS);

  const picture = document.createElement('picture');
  const source = document.createElement('source');
  source.setAttribute('srcset', srcset);
  source.setAttribute('sizes', DEFAULT_SIZES);
  picture.append(source);

  const fallbackImg = document.createElement('img');
  fallbackImg.src = src;
  fallbackImg.alt = alt;
  fallbackImg.loading = 'lazy';
  picture.append(fallbackImg);

  block.textContent = '';
  block.append(picture);

  if (captionText) {
    const caption = document.createElement('p');
    caption.className = 'dm-image-caption';
    caption.textContent = captionText;
    block.append(caption);
  }
}
