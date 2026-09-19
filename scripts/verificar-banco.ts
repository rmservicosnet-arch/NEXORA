/**
 * Confere o estado real do banco depois da migração.
 *
 *   npm run db:verificar
 *
 * Não é teste unitário: é uma conferência do ambiente. Vários itens aqui são
 * critérios de aceite de docs/TENANCY.md §6 — em especial o de número 7,
 * "a conexão da aplicação não possui BYPASSRLS nem é dona das tabelas".
 *
 * Roda com os dois usuários, porque metade das perguntas só faz sentido do
 * ponto de vista de quem tem menos privilégio.
 */

import { Client } from 'pg';

let falhas = 0;

function ok(mensagem: string, detalhe = ''): void {
  console.log(`  ✓ ${mensagem}${detalhe ? ` — ${detalhe}` : ''}`);
}

function falhou(mensagem: string, detalhe = ''): void {
  falhas += 1;
  console.log(`  ✗ ${mensagem}${detalhe ? ` — ${detalhe}` : ''}`);
}

function exigir(url: string | undefined, nome: string): string {
  if (!url) {
    console.error(`\n  ✗ ${nome} não está definida no .env\n`);
    process.exit(1);
  }
  return url;
}

async function main(): Promise<void> {
  console.log('\n  Conferindo o banco\n');

  const urlMigrator = exigir(process.env['DIRECT_URL'], 'DIRECT_URL');
  const urlApp = exigir(process.env['DATABASE_URL'], 'DATABASE_URL');

  const usuarioApp = decodeURIComponent(new URL(urlApp).username);
  const usuarioMigrator = decodeURIComponent(new URL(urlMigrator).username);

  const migrator = new Client({ connectionString: urlMigrator });
  await migrator.connect();

  // --- Estrutura -----------------------------------------------------------

  const tabelas = await migrator.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM pg_tables WHERE schemaname = 'public'`,
  );
  const totalTabelas = Number(tabelas.rows[0]?.total ?? 0);
  if (totalTabelas >= 38) {
    ok('Tabelas criadas', `${totalTabelas} no schema public`);
  } else {
    falhou('Poucas tabelas', `esperava ao menos 38, encontrei ${totalTabelas}`);
  }

  const enums = await migrator.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM pg_type t
       JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE t.typtype = 'e' AND n.nspname = 'public'`,
  );
  ok('Enums criados', `${enums.rows[0]?.total ?? 0}`);

  const fks = await migrator.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM pg_constraint WHERE contype = 'f'`,
  );
  ok('Chaves estrangeiras', `${fks.rows[0]?.total ?? 0}`);

  const indices = await migrator.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM pg_indexes WHERE schemaname = 'public'`,
  );
  ok('Índices', `${indices.rows[0]?.total ?? 0}`);

  // --- uuidv7 realmente gera v7 -------------------------------------------

  await migrator.query('BEGIN');
  const inserido = await migrator.query<{ id: string }>(
    `INSERT INTO tenant (nome, slug) VALUES ('__verificacao__', '__verificacao__') RETURNING id::text`,
  );
  const id = inserido.rows[0]?.id ?? '';
  await migrator.query('ROLLBACK');

  // O 13º caractere hexadecimal carrega a versão do UUID.
  const versao = id.replace(/-/g, '')[12];
  if (versao === '7') {
    ok('Chave primária é UUID v7', `${id.slice(0, 18)}… (ordenável no tempo)`);
  } else {
    falhou('Chave primária não é v7', `versão ${versao ?? '?'} em ${id}`);
  }

  // --- Privilégios do usuário da aplicação --------------------------------

  const papel = await migrator.query<{
    rolbypassrls: boolean;
    rolsuper: boolean;
    rolcreatedb: boolean;
  }>(`SELECT rolbypassrls, rolsuper, rolcreatedb FROM pg_roles WHERE rolname = $1`, [usuarioApp]);

  const p = papel.rows[0];
  if (p && !p.rolbypassrls && !p.rolsuper) {
    ok(`"${usuarioApp}" sem BYPASSRLS e sem SUPERUSER`, 'o RLS vai valer para ele');
  } else {
    falhou(`"${usuarioApp}" tem privilégio demais`, JSON.stringify(p));
  }

  const donas = await migrator.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM pg_tables
      WHERE schemaname = 'public' AND tableowner = $1`,
    [usuarioApp],
  );
  if (Number(donas.rows[0]?.total ?? 0) === 0) {
    ok(`"${usuarioApp}" não é dono de nenhuma tabela`, `o dono é "${usuarioMigrator}"`);
  } else {
    falhou(`"${usuarioApp}" é dono de tabelas`, `${donas.rows[0]?.total} — dono ignora policy`);
  }

  await migrator.end();

  // --- Do ponto de vista da aplicação -------------------------------------

  const app = new Client({ connectionString: urlApp });
  await app.connect();

  try {
    await app.query('CREATE TABLE __nao_deveria_existir__ (id int)');
    await app.query('DROP TABLE __nao_deveria_existir__');
    falhou(`"${usuarioApp}" conseguiu criar tabela`, 'deveria ser proibido');
  } catch {
    ok(`"${usuarioApp}" não consegue criar objetos`, 'CREATE negado no schema public');
  }

  try {
    await app.query('SELECT 1 FROM tenant LIMIT 1');
    ok(`"${usuarioApp}" consegue ler as tabelas`, 'privilégios padrão aplicados');
  } catch (erro) {
    falhou(`"${usuarioApp}" não consegue ler`, (erro as Error).message);
  }

  await app.end();

  // --- Row-Level Security --------------------------------------------------

  console.log('\n  Isolamento entre empresas\n');

  const mig = new Client({ connectionString: urlMigrator });
  await mig.connect();

  const rls = await mig.query<{ com_rls: string; forcado: string; sem: string }>(
    `SELECT
       count(*) FILTER (WHERE c.relrowsecurity)::text                              AS com_rls,
       count(*) FILTER (WHERE c.relforcerowsecurity)::text                         AS forcado,
       count(*) FILTER (WHERE NOT c.relrowsecurity OR NOT c.relforcerowsecurity)::text AS sem
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
    WHERE n.nspname = 'public' AND c.relkind = 'r'`,
  );

  const r = rls.rows[0];
  if (r && Number(r.sem) === 0) {
    ok('Tabelas com tenant_id protegidas', `${r.com_rls} com RLS, ${r.forcado} com FORCE`);
  } else {
    falhou('Tabelas com tenant_id sem proteção', `${r?.sem ?? '?'} desprotegidas`);
  }

  // Duas empresas de teste. O migrator tem BYPASSRLS, então consegue criar.
  await mig.query(`DELETE FROM tenant WHERE slug LIKE '__verif_%'`);
  const criadas = await mig.query<{ id: string; slug: string }>(
    `INSERT INTO tenant (nome, slug) VALUES
       ('Empresa A de verificação', '__verif_a'),
       ('Empresa B de verificação', '__verif_b')
     RETURNING id::text, slug`,
  );
  const empresaA = criadas.rows.find((t) => t.slug === '__verif_a')?.id ?? '';
  const empresaB = criadas.rows.find((t) => t.slug === '__verif_b')?.id ?? '';

  const app2 = new Client({ connectionString: urlApp });
  await app2.connect();

  async function comoAplicacao<T>(
    tenantId: string | null,
    clienteId: string | null,
    executar: () => Promise<T>,
  ): Promise<T> {
    await app2.query('BEGIN');
    // SET LOCAL: expira no fim da transação. `SET` comum vazaria o tenant
    // para a próxima requisição que pegasse a mesma conexão do pool.
    await app2.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId ?? '']);
    await app2.query(`SELECT set_config('app.cliente_id', $1, true)`, [clienteId ?? '']);
    try {
      return await executar();
    } finally {
      await app2.query('ROLLBACK');
    }
  }

  async function contarTenants(): Promise<number> {
    const res = await app2.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM tenant WHERE slug LIKE '__verif_%'`,
    );
    return Number(res.rows[0]?.total ?? 0);
  }

  // Critério de aceite nº 4 do TENANCY.md — o mais importante de todos.
  const semContexto = await comoAplicacao(null, null, contarTenants);
  if (semContexto === 0) {
    ok('Consulta SEM contexto retorna zero linhas', 'não retorna todas — a falha é fechada');
  } else {
    falhou('Consulta sem contexto vazou dados', `${semContexto} linhas visíveis`);
  }

  const comA = await comoAplicacao(empresaA, null, contarTenants);
  if (comA === 1) {
    ok('Com contexto da empresa A, enxerga só a empresa A', '1 de 2');
  } else {
    falhou('Escopo de tenant não filtrou', `${comA} linhas com contexto de A`);
  }

  // Critério nº 1 — buscar recurso de outro tenant por id direto.
  const vazamentoPorId = await comoAplicacao(empresaA, null, async () => {
    const res = await app2.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM tenant WHERE id = $1`,
      [empresaB],
    );
    return Number(res.rows[0]?.total ?? 0);
  });
  if (vazamentoPorId === 0) {
    ok('Buscar a empresa B por id, no contexto de A, devolve nada', 'vira 404, não 403');
  } else {
    falhou('Vazamento por id direto', `${vazamentoPorId} linhas`);
  }

  // WITH CHECK: escrever para outro tenant tem de ser recusado.
  const escritaCruzada = await comoAplicacao(empresaA, null, async () => {
    try {
      await app2.query(
        `INSERT INTO loja (tenant_id, nome, codigo) VALUES ($1, 'Loja intrusa', 'X1')`,
        [empresaB],
      );
      return 'passou';
    } catch {
      return 'recusado';
    }
  });
  if (escritaCruzada === 'recusado') {
    ok('Escrever no tenant B, no contexto de A, é recusado', 'WITH CHECK da policy');
  } else {
    falhou('Escrita cruzada foi aceita', 'a policy não tem WITH CHECK efetivo');
  }

  await app2.end();
  await mig.query(`DELETE FROM tenant WHERE slug LIKE '__verif_%'`);
  await mig.end();
  ok('Dados de verificação removidos', 'nada ficou no banco');

  if (falhas === 0) {
    console.log('\n  Tudo conferido.\n');
  } else {
    console.log(`\n  ${falhas} verificação(ões) falharam.\n`);
  }
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((erro: unknown) => {
  console.error('\n  ✗ Falhou:', erro instanceof Error ? erro.message : erro, '\n');
  process.exit(1);
});
