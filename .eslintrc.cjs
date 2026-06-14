module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
    worker: true,
    node: true
  },
  extends: 'eslint:recommended',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module'
  },
  globals: {
    QUnit: 'readonly'
  },
  rules: {
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-undef': 'error',
    'no-console': 'off',
    'prefer-const': 'warn',
    'no-var': 'error',
    'eqeqeq': ['error', 'always'],
    'no-throw-literal': 'error',
    'no-return-assign': 'warn',
    'no-param-reassign': 'warn'
  },
  ignorePatterns: ['dist/', 'node_modules/', 'playwright-report/', 'test-results/', 'public/']
};
