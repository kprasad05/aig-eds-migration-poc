import DA_SDK from 'https://da.live/nx/utils/sdk.js';

(async function init() {
  const { context } = await DA_SDK;
  const { org, repo, path } = context;

  const el = document.createElement('p');
  el.textContent = `Ada Scan loaded for /${org}/${repo}${path}`;
  document.body.append(el);
}());
