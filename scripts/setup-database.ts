/**
 * Prepara o PostgreSQL para o projeto.
 *
 *   npm run db:setup
 *
 * Cria, se não existirem:
 *   - o banco `estoque`
 *   - o usuário `estoque_migrator` — DONO das tabelas, usado só por migração
 *   - o usuário `estoque_app`      — usado pela aplicação, SEM BYPASSRLS e
 *                                    SEM ser dono de nada
 *
 * Por que dois usuários: uma policy de Row-Level Security é ignorada pelo dono
 * da tabela, a menos que seja FORCE — e mesmo assim, um usuário com BYPASSRLS
 * passa por cima de tudo. Rodar a aplicação com o usuário da migração
 * desligaria silenciosamente o isolamento entre empresas. Ver docs/TENANCY.md.
 *
 * O script é idempotente: rodar de novo não quebra nada.
 * Ele NUNCA apaga banco, tabela ou usuário.
 */

import { Client } from 'pg';

type Credencial = {
  usuario: string;
  senha: string;
  host: string;
  porta: number;
  banco: string;
};

const PLACEHOLDER = 'TROQUE_ESTA_SENHA';

function lerUrl(nome: string): Credencial {
  const bruto = process.env[nome];
  if (!bruto) {
    falhar(`A variável ${nome} não está definida no .env.`);
  }

  let url: URL;
  try {
    url = new URL(bruto);
  } catch {
    return falhar(`A variável ${nome} não é uma URL válida.`);
  }

  const senha = decodeURIComponent(url.password);
  const usuario = decodeURIComponent(url.username);

  if (!usuario || !senha) {
    falhar(`A variável ${nome} precisa de usuário e senha.`);
  }

  return {
    usuario,
    senha,
    host: url.hostname,
    porta: url.port ? Number(url.port) : 5432,
    banco: url.pathname.replace(/^\//, ''),
  };
}

function falhar(mensagem: string): never {
  console.error(`\n  ✗ ${mensagem}\n`);
  process.exit(1);
}

function ok(mensagem: string): void {
  console.log(`  ✓ ${mensagem}`);
}

function info(mensagem: string): void {
  console.log(`    ${mensagem}`);
}

/**
 * Identificadores vêm do .env do próprio operador, mas nunca são interpolados
 * crus: nome de papel vai por `format`-like com aspas duplas escapadas, e
 * senha vai por literal com aspas simples escapadas. `pg` não parametriza DDL.
 */
function identificador(nome: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(nome)) {
    falhar(`Nome inválido para identificador SQL: "${nome}".`);
  }
  return `"${nome}"`;
}

function literal(valor: string): string {
  return `'${valor.replace(/'/g, "''")}'`;
}

async function main(): Promise<void> {
  console.log('\n  Preparando o PostgreSQL para o Estoque SaaS\n');

  const superUrl = process.env.POSTGRES_SUPERUSER_URL;
  if (!superUrl) {
    falhar('POSTGRES_SUPERUSER_URL não está definida no .env.');
  }

  const app = lerUrl('DATABASE_URL');
  const migrator = lerUrl('DIRECT_URL');

  if (app.senha === PLACEHOLDER || migrator.senha === PLACEHOLDER) {
    falhar(
      'As senhas de DATABASE_URL e DIRECT_URL ainda são o texto de exemplo.\n' +
        `    Troque "${PLACEHOLDER}" por senhas reais no .env antes de continuar.`,
    );
  }

  if (app.usuario === migrator.usuario) {
    falhar(
      'DATABASE_URL e DIRECT_URL usam o MESMO usuário.\n' +
        '    Isso desliga o Row-Level Security. Ver docs/TENANCY.md §2.',
    );
  }

  if (app.banco !== migrator.banco) {
    falhar(`Os dois URLs apontam para bancos diferentes: "${app.banco}" e "${migrator.banco}".`);
  }

  const banco = app.banco;
  const admin = new Client({ connectionString: superUrl });

  try {
    await admin.connect();
  } catch (erro) {
    falhar(
      'Não consegui conectar como superusuário.\n' +
        `    ${(erro as Error).message}\n` +
        '    Confira POSTGRES_SUPERUSER_URL no .env.',
    );
  }

  const versao = await admin.query<{ v: string }>('SELECT version() AS v');
  ok(`Conectado: ${versao.rows[0]?.v.split(',')[0] ?? 'PostgreSQL'}`);

  // O schema usa uuidv7() como default de chave primária. É função nativa do
  // PostgreSQL 18. Falhar aqui, com mensagem clara, é muito melhor do que
  // falhar no meio da primeira migração.
  const temUuidV7 = await admin.query<{ existe: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_proc WHERE proname = 'uuidv7' AND pronargs = 0
     ) AS existe`,
  );

  if (!temUuidV7.rows[0]?.existe) {
    await admin.end();
    falhar(
      'Este servidor não tem a função uuidv7(), que o schema usa como chave primária.\n' +
        '    Ela é nativa do PostgreSQL 18. Opções:\n' +
        '      a) usar PostgreSQL 18 ou superior;\n' +
        '      b) trocar os defaults do schema para gen_random_uuid() — perde a\n' +
        '         ordenação temporal do índice, mas funciona.',
    );
  }
  ok('uuidv7() disponível — chaves primárias ordenáveis no tempo');

  for (const papel of [migrator, app]) {
    const existe = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [papel.usuario]);

    if (existe.rowCount === 0) {
      // O migrator precisa de CREATEDB por causa do shadow database que o
      // `prisma migrate dev` cria para detectar divergência de schema. Em
      // produção usa-se `migrate deploy`, que não precisa disso — mas o
      // privilégio fica no usuário de migração, nunca no da aplicação.
      const extra =
        papel === app
          ? 'NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE'
          : 'NOBYPASSRLS NOSUPERUSER CREATEDB';
      await admin.query(
        `CREATE ROLE ${identificador(papel.usuario)} LOGIN PASSWORD ${literal(papel.senha)} ${extra}`,
      );
      ok(`Usuário "${papel.usuario}" criado`);
    } else {
      await admin.query(
        `ALTER ROLE ${identificador(papel.usuario)} WITH LOGIN PASSWORD ${literal(papel.senha)}`,
      );
      ok(`Usuário "${papel.usuario}" já existia — senha sincronizada com o .env`);
    }
  }

  // Garantias explícitas, mesmo que os papéis já existissem de antes com
  // outros atributos. A primeira é a linha que sustenta a camada 3 do
  // isolamento: sem ela, o RLS não vale nada.
  await admin.query(
    `ALTER ROLE ${identificador(app.usuario)} NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE`,
  );
  ok(`"${app.usuario}" confirmado como NOBYPASSRLS, NOSUPERUSER e NOCREATEDB`);

  // O migrator precisa de BYPASSRLS porque as policies usam FORCE, que
  // alcança até o dono da tabela. Sem isso, migração e seed não conseguiriam
  // escrever linha nenhuma.
  //
  // O buraco que isso abre — alguém apontar a aplicação para DIRECT_URL e
  // passar por cima do isolamento — é fechado em packages/db/src/client.ts:
  // a aplicação se RECUSA a iniciar se o papel conectado tiver BYPASSRLS ou
  // for dono das tabelas. Ver docs/TENANCY.md §2.
  await admin.query(`ALTER ROLE ${identificador(migrator.usuario)} CREATEDB BYPASSRLS`);
  ok(
    `"${migrator.usuario}" com CREATEDB e BYPASSRLS`,
    'identidade de migração, nunca da aplicação',
  );

  const bancoExiste = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [banco]);

  if (bancoExiste.rowCount === 0) {
    await admin.query(
      `CREATE DATABASE ${identificador(banco)} OWNER ${identificador(migrator.usuario)}`,
    );
    ok(`Banco "${banco}" criado, com dono "${migrator.usuario}"`);
  } else {
    ok(`Banco "${banco}" já existe — preservado, nada foi apagado`);
  }

  await admin.query(
    `GRANT CONNECT ON DATABASE ${identificador(banco)} TO ${identificador(migrator.usuario)}, ${identificador(app.usuario)}`,
  );

  await admin.end();

  // O restante precisa acontecer dentro do banco do projeto.
  const noBanco = new Client({
    connectionString: new URL(`/${banco}`, superUrl).toString(),
  });
  await noBanco.connect();

  await noBanco.query(`GRANT USAGE, CREATE ON SCHEMA public TO ${identificador(migrator.usuario)}`);
  await noBanco.query(`GRANT USAGE ON SCHEMA public TO ${identificador(app.usuario)}`);
  await noBanco.query(`REVOKE CREATE ON SCHEMA public FROM ${identificador(app.usuario)}`);
  ok('Privilégios de schema aplicados — a aplicação não pode criar objetos');

  // Sem isto, cada migração criaria tabelas que a aplicação não enxerga.
  await noBanco.query(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${identificador(migrator.usuario)} IN SCHEMA public
       GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${identificador(app.usuario)}`,
  );
  await noBanco.query(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${identificador(migrator.usuario)} IN SCHEMA public
       GRANT USAGE, SELECT ON SEQUENCES TO ${identificador(app.usuario)}`,
  );
  ok('Privilégios padrão configurados para tabelas futuras');

  // Tabelas que já existam de uma execução anterior.
  await noBanco.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${identificador(app.usuario)}`,
  );
  await noBanco.query(
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${identificador(app.usuario)}`,
  );

  await noBanco.end();

  console.log('\n  Pronto.\n');
  info('Próximo passo:');
  info('  npm run db:migrate    cria as tabelas e aplica o RLS');
  info('  npm run db:seed       cria a empresa de exemplo e os perfis');
  console.log('');
}

main().catch((erro: unknown) => {
  console.error('\n  ✗ Falhou:', erro instanceof Error ? erro.message : erro, '\n');
  process.exit(1);
});
