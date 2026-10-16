import DA_SDK from 'https://da.live/nx/utils/sdk.js';

function buildText(target, values) {
  return values.length ? `${target.name} (${values.join(', ')})` : target.name;
}

function buildSectionHtml(values) {
  return `<table><tr><td colspan="2">Section Metadata</td></tr><tr><td>style</td><td>${values.join(', ')}</td></tr></table>`;
}

function buildMetadataHtml(keys) {
  const rows = keys.map((key) => `<tr><td>${key}</td><td>true</td></tr>`).join('');
  return `<table><tr><td colspan="2">Metadata</td></tr>${rows}</table>`;
}

(async function init() {
  const { actions } = await DA_SDK;
  const config = await (await fetch('/tools/plugins/style-picker/styles.json')).json();

  const allTargets = [
    {
      id: 'section', type: 'section', label: config.section.label, multiple: true, options: config.section.options,
    },
    {
      id: 'page', type: 'metadata', label: config.page.label, multiple: true, options: config.page.options,
    },
    ...config.blocks.map((b) => ({
      id: b.name.toLowerCase().replace(/\s+/g, '-'), type: 'block', label: b.label, name: b.name, multiple: true, options: b.options,
    })),
  ];

  // ?target=<section|page|block-name> scopes the plugin to a single target.
  const scope = new URLSearchParams(window.location.search).get('target');
  const scoped = allTargets.filter((t) => t.id === scope);
  const targets = scoped.length ? scoped : allTargets;

  const container = document.createElement('div');
  container.className = 'style-picker';

  const selectLabel = document.createElement('label');
  selectLabel.textContent = 'Apply to';
  const select = document.createElement('select');
  targets.forEach((t, i) => {
    const option = document.createElement('option');
    option.value = i;
    option.textContent = t.label;
    select.append(option);
  });
  selectLabel.append(select);

  const fieldset = document.createElement('fieldset');
  const legend = document.createElement('legend');
  legend.textContent = 'Styles';
  fieldset.append(legend);

  const preview = document.createElement('div');
  preview.className = 'preview';

  const insert = document.createElement('button');
  insert.type = 'button';
  insert.textContent = 'Insert';

  const selected = () => [...fieldset.querySelectorAll('input:checked')].map((i) => i.value);
  const current = () => targets[Number(select.value)];

  const updatePreview = () => {
    const target = current();
    const values = selected();
    if (target.type === 'section') {
      preview.textContent = `Section Metadata: style = ${values.join(', ')}`;
    } else if (target.type === 'metadata') {
      preview.textContent = `Metadata: ${values.map((v) => `${v} = true`).join(', ')}`;
    } else {
      preview.textContent = buildText(target, values);
    }
    insert.disabled = target.type !== 'block' && !values.length;
  };

  const renderOptions = () => {
    fieldset.querySelectorAll('label').forEach((l) => l.remove());
    current().options.forEach((opt) => {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = current().multiple ? 'checkbox' : 'radio';
      input.name = 'style-option';
      input.value = opt.value;
      input.addEventListener('change', updatePreview);
      label.append(input, ` ${opt.label}`);
      fieldset.append(label);
    });
    updatePreview();
  };

  select.addEventListener('change', renderOptions);

  insert.addEventListener('click', () => {
    const target = current();
    const values = selected();
    if (target.type === 'section') {
      actions.sendHTML(buildSectionHtml(values));
    } else if (target.type === 'metadata') {
      actions.sendHTML(buildMetadataHtml(values));
    } else {
      actions.sendText(buildText(target, values));
    }
    actions.closeLibrary();
  });

  if (targets.length > 1) container.append(selectLabel);
  container.append(fieldset, preview, insert);
  document.body.append(container);
  renderOptions();
}());
