module.exports = {
  root: true,
  extends: 'airbnb-base',
  env: {
    browser: true,
  },
  parser: '@babel/eslint-parser',
  parserOptions: {
    allowImportExportEverywhere: true,
    sourceType: 'module',
    requireConfigFile: false,
  },
  rules: {
    'import/extensions': ['error', { js: 'always' }], // require js file extensions in imports
    'linebreak-style': ['error', 'unix'], // enforce unix linebreaks
    'no-param-reassign': [2, { props: false }], // allow modifying properties of param
  },
  overrides: [
    {
      files: ['blocks/form/**/*.js', 'scripts/form-editor-support.js'],
      rules: {
        'no-console': ['error', { allow: ['warn', 'error', 'log'] }],
      },
    },
    {
      files: ['scripts/form-editor-support.js'],
      rules: { 'no-alert': 'off' },
    },
    {
      files: ['test/forms/*.cjs'],
      env: { node: true },
      rules: {
        'import/no-extraneous-dependencies': ['error', { devDependencies: true }],
      },
    },
  ],
};
