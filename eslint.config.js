import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'data/**',
      'scripts/**/*.py',
      '**/*.gen.ts',
      'apps/mobile/.expo/**',
      'apps/mobile/ios/**',
      'apps/mobile/android/**',
      'apps/mobile/expo-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // The shared contract and the parser must stay free of `any`.
    files: ['packages/types/**/*.ts', 'packages/parser/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'error' },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}', 'apps/mobile/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // The iOS app reuses only these platform-free web modules (see apps/mobile/metro.config.js
    // and DECISIONS.md). Anything else under apps/web stays out of the mobile bundle.
    files: ['apps/mobile/{app,src}/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex:
                '^@web/(?!(field/geometry|field/formations|field/lineup|lib/format|lib/plays|lib/booth|store/game)$)',
              message:
                'Only platform-free web modules may be imported from @web (see DECISIONS.md).',
            },
            {
              regex: '^(\\.\\./)+web/',
              message: 'Import web modules through the @web/* allowlist.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/mobile/metro.config.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
  },
);
