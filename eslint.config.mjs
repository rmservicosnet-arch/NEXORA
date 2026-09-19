import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      'packages/db/src/generated/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', disallowTypeAnnotations: false },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],

      // Dinheiro e quantidade são Decimal. Ver docs/ARCHITECTURE.md §7.
      'no-restricted-globals': [
        'error',
        { name: 'parseFloat', message: 'Use Decimal. Float não representa dinheiro.' },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Number',
          property: 'parseFloat',
          message: 'Use Decimal. Float não representa dinheiro.',
        },
        {
          object: 'Math',
          property: 'round',
          message: 'Arredondamento monetário usa Decimal com política explícita (half-up).',
        },
      ],
    },
  },

  // A API depende de metadados de decorator em runtime; `import type` os apaga.
  {
    files: ['apps/api/**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },

  // O cliente Prisma sem escopo de tenant é restrito. Ver docs/TENANCY.md §2.
  {
    files: ['apps/api/src/**/*.ts'],
    ignores: ['apps/api/src/platform/**', 'apps/api/src/infra/prisma/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@estoque/db',
              importNames: ['prismaUnscoped'],
              message:
                'prismaUnscoped ignora o isolamento de tenant. Use o cliente com escopo. ' +
                'Uso administrativo legítimo vive em apps/api/src/platform/.',
            },
          ],
        },
      ],
    },
  },

  // Testes podem ser mais soltos.
  {
    files: ['**/*.test.ts', '**/*.spec.ts', '**/tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
      'no-restricted-imports': 'off',
    },
  },

  // Scripts de manutenção falam com o operador pelo terminal.
  {
    files: ['scripts/**/*.ts', 'packages/db/prisma/**/*.ts'],
    rules: {
      'no-console': 'off',
      'no-restricted-imports': 'off',
    },
  },
);
