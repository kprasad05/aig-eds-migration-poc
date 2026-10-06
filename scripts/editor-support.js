import { attachEventListners } from './form-editor-support.js';

// DA does not use AUE events; this adapter is loaded only in Universal Editor edit mode.
const main = document.querySelector('main');
if (main) attachEventListners(main);
