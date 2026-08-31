const DIFF_SITE_URL = 'https://pianomister.github.io/diffsite/';

/**
 * Builds the preview and live URLs for the current page, along with a link
 * to the diff checker site, so the user can compare the two.
 * @param {object} context DA SDK context, e.g. { org, site, path, ref }
 */
export function buildDiffLinks({
  org, site, path, ref = 'main',
}) {
  return {
    diffSiteUrl: DIFF_SITE_URL,
    previewUrl: `https://${ref}--${site}--${org}.aem.page${path}`,
    liveUrl: `https://${ref}--${site}--${org}.aem.live${path}`,
  };
}
