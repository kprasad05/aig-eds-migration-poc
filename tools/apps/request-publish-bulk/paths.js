export function normalizePath(line) {
  let path = line.trim();
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      return path;
    }
  }
  path = path.split(/[?#]/)[0].replace(/\.(plain\.)?html$/i, '').replace(/\/{2,}/g, '/');
  if (!path.startsWith('/')) path = `/${path}`;
  if (path.endsWith('/')) path = `${path}index`;
  return path;
}

export function isValidPath(path) {
  return typeof path === 'string'
    && /^\/[A-Za-z0-9_./-]+$/.test(path)
    && !path.split('/').some((part) => part === '..' || part === '.')
    && !path.startsWith('/.da/')
    && !path.startsWith('/.snapshots/');
}

export function validateSite(org, site) {
  if (![org, site].every((value) => /^[A-Za-z0-9_-]+$/.test(value))) {
    throw new Error('Enter an organization and site name without slashes, spaces, or URLs.');
  }
}

function isComplete(state, count) {
  return state?.status === 'complete'
    && (state.saved === undefined || Number(state.saved) >= count);
}

function joinDestination(location, basePath) {
  return normalizePath(`${location.replace(/\/+$/, '')}/${basePath.replace(/^\/+/, '')}`);
}

/**
 * A language's location is its translation destination; locale.code is a
 * separate rollout destination. Never append a locale to the language folder.
 */
export function getTranslationDestinations(project) {
  if (!Array.isArray(project.urls) || !Array.isArray(project.langs)) {
    throw new Error('This project does not have a translation URL and language list yet.');
  }
  if (project.snapshot) {
    throw new Error('Snapshot projects are not supported. Use the normal content paths instead.');
  }
  const urls = project.urls.filter((url) => url.checked !== false);
  if (!urls.length) throw new Error('This project has no selected source pages.');

  const sourcePrefix = project.options?.['source.language']?.location?.replace(/\/+$/, '') || '';
  const basePaths = urls.map((url) => {
    let base = url.basePath;
    if (typeof base !== 'string') {
      base = url.suppliedPath;
      if (typeof base !== 'string') throw new Error('A project URL is missing its content path.');
      if (sourcePrefix && (base === sourcePrefix || base.startsWith(`${sourcePrefix}/`))) {
        base = base.slice(sourcePrefix.length) || '/';
      }
    }
    return base;
  });
  const destinations = [];
  const addDestination = (location, label) => {
    if (typeof location !== 'string' || !location.startsWith('/')) {
      throw new Error(`Missing or invalid destination folder for ${label}.`);
    }
    const paths = [...new Set(basePaths.map((base) => joinDestination(location, base)))];
    if (paths.some((path) => !isValidPath(path))) {
      throw new Error(`Invalid generated path for ${label}. Check the translation project.`);
    }
    destinations.push({
      id: `${label}:${location}`, location, label, paths,
    });
  };

  project.langs.forEach((lang) => {
    const name = lang.name || lang.code || 'Language';
    const translated = lang.action === 'translate' && isComplete(lang.translation, urls.length);
    const copied = lang.action === 'copy' && isComplete(lang.copy, urls.length);
    if (translated || copied) {
      addDestination(lang.location, `${name} ${translated ? 'translation' : 'copy'}`);
    }
    if (isComplete(lang.rollout, urls.length) && Array.isArray(lang.locales)) {
      lang.locales.filter((locale) => locale.active !== false
        && (locale.saved === undefined || Number(locale.saved) >= urls.length))
        .forEach((locale) => addDestination(locale.code, `${name} rollout`));
    }
  });
  return destinations;
}

export function assessPreview(sourceModified, preview) {
  const sourceTime = Date.parse(sourceModified);
  const previewTime = Date.parse(preview?.sourceLastModified);
  const dates = {
    sourceModified,
    previewModified: preview?.lastModified,
    previewSourceModified: preview?.sourceLastModified,
  };
  if (preview?.status === 404) {
    return { ...dates, status: 'needs-preview', message: 'No preview exists. Preview this page before submitting.' };
  }
  if (preview?.status !== 200) {
    throw new Error(`Could not read preview status (${preview?.status || 'unknown'}).`);
  }
  if (!Number.isFinite(sourceTime) || !Number.isFinite(previewTime)) {
    return { ...dates, status: 'unverified', message: 'Source timestamps are unavailable. Freshness cannot be confirmed; submission is blocked.' };
  }
  if (previewTime < sourceTime) {
    return { ...dates, status: 'stale', message: 'The source changed after the preview. Refresh the preview before submitting.' };
  }
  return { ...dates, status: 'ready', message: 'Page exists and the preview includes the latest saved source.' };
}
