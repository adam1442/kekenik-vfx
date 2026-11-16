import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules', 'public'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      // The code base deliberately uses comma-sequence statements `(a = 1, b = 2)` and `cond && fn()` in UI glue (prettier-formatted); the rule would flag all of them.
      '@typescript-eslint/no-unused-expressions': 'off',
    },
  },
  {
    files: ['tools/**/*.mjs'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly', URL: 'readonly', self: 'readonly', caches: 'readonly', fetch: 'readonly', location: 'readonly', Response: 'readonly' } },
  },
);
