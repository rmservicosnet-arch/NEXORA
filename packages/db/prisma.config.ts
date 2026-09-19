import { defineConfig, env } from 'prisma/config';

/**
 * Configuração das ferramentas Prisma (migrate, introspect, seed).
 *
 * O datasource daqui é usado APENAS pelas ferramentas de linha de comando,
 * nunca em runtime. Por isso ele aponta para `DIRECT_URL` — o usuário
 * `estoque_migrator`, dono das tabelas.
 *
 * A aplicação conecta por outro caminho: um driver adapter com `DATABASE_URL`
 * (usuário `estoque_app`, sem BYPASSRLS e sem ser dono). Ver src/client.ts.
 *
 * Essa separação não é preciosismo: sem ela, o Row-Level Security não vale
 * nada, porque o dono da tabela ignora a policy. Ver docs/TENANCY.md §2.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',

  datasource: {
    url: env('DIRECT_URL'),
  },

  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
});
