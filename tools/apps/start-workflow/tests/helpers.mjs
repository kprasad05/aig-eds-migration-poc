import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';

export function sheets() {
  return {
    config: { data: [
      { key: 'translation.service.name', value: 'Google' },
      { key: 'source.language', value: 'English' },
    ] },
    languages: { data: [
      { name: 'English', code: 'en', location: '/en', actions: 'Skip' },
      { name: 'French', code: 'fr', location: '/fr', actions: 'Skip, Translate' },
      { name: 'German', code: 'de', location: '/de', actions: 'Translate' },
    ] },
    'custom-doc-rules': { data: [] },
    'dnt-content-rules': { data: [] },
  };
}

export async function modules({ request, remote = {}, globals = {} } = {}) {
  const calls = [];
  const context = vm.createContext({
    crypto: webcrypto, TextEncoder, Uint8Array, Response, FormData, Blob,
    URL, AbortSignal, DOMParser: class {
      parseFromString(html) {
        return { querySelector: () => (html.includes('<main>') ? {} : null) };
      }
    },
    ...globals,
  });
  const cache = new Map();
  async function synthetic(exports) {
    const module = new vm.SyntheticModule(Object.keys(exports), function init() {
      Object.entries(exports).forEach(([key, value]) => this.setExport(key, value));
    }, { context });
    await module.link(() => {});
    await module.evaluate();
    return module;
  }
  const da = await synthetic({
    daFetch: async (url, options) => {
      calls.push({ url, options });
      if (!request) throw new Error(`Unexpected request: ${url}`);
      return request(url, options);
    },
  });
  async function external(specifier) {
    if (specifier.endsWith('/daFetch.js')) return da;
    if (!remote[specifier]) throw new Error(`Unexpected import: ${specifier}`);
    return synthetic(remote[specifier]);
  }
  async function load(url) {
    if (cache.has(url.href)) return cache.get(url.href);
    const module = new vm.SourceTextModule(await readFile(url, 'utf8'), {
      context, identifier: url.href,
      initializeImportMeta: (meta) => { meta.url = url.href; },
      importModuleDynamically: external,
    });
    cache.set(url.href, module);
    await module.link((specifier) => (specifier.startsWith('https:')
      ? external(specifier) : load(new URL(specifier, url))));
    return module;
  }
  const model = await load(new URL('../model.js', import.meta.url));
  await model.evaluate();
  const workflow = await load(new URL('../workflow.js', import.meta.url));
  await workflow.evaluate();
  const api = await load(new URL('../api.js', import.meta.url));
  await api.evaluate();
  return { model: model.namespace, workflow: workflow.namespace, api: api.namespace, calls };
}

export function json(value, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(value), {
    status, headers: { 'Content-Type': 'application/json', ...headers },
  });
}
