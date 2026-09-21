import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      'packages/db/generated/**',
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

  /*
    O que cruza empresas fica confinado. Ver docs/TENANCY.md §2.

    A regra anterior proibia importar `prismaUnscoped` de `@estoque/db`, num
    diretório `apps/api/src/platform/` — e nenhum dos dois existia. Guardava
    um símbolo fantasma: `criarPrisma` RECUSA papel com BYPASSRLS e derruba a
    inicialização, então um cliente sem escopo nunca poderia existir dentro
    da API.

    O que existe de verdade são as funções `plataforma_*`, `SECURITY DEFINER`,
    que leem fora do RLS de propósito. Esta regra guarda ELAS: uma chamada
    dessas fora de `apps/api/src/plataforma/` é o vazamento entre empresas que
    o RLS existe para impedir.
  */
  {
    files: ['apps/api/src/**/*.ts'],
    ignores: ['apps/api/src/plataforma/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TemplateElement[value.raw=/plataforma_/]',
          message:
            'As funções plataforma_* são SECURITY DEFINER e atravessam empresas. ' +
            'Só apps/api/src/plataforma/ pode chamá-las. Ver docs/TENANCY.md §2.',
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
