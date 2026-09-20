/**
 * O instante que a aplicação grava é o instante que aconteceu.
 *
 * Teste de INTEGRAÇÃO, e não dá para ser outra coisa: o defeito que ele
 * impede vive na conversa entre o adaptador do Prisma e o PostgreSQL, e
 * nenhum mock reproduz isso.
 *
 * O que aconteceu antes: o PostgreSQL renderiza `timestamptz` no fuso da
 * sessão, e o adaptador descartava o deslocamento — "18:42-03" virava 18:42
 * UTC. Escrita +3 h, leitura −3 h. Os dois se cancelavam quando o MESMO
 * caminho fazia ida e volta, e por isso as telas do app pareciam certas
 * durante meses. Só aparecia quando algo comparava com `now()` calculado em
 * SQL: as cinco faixas do relatório de fila somaram zero com quatorze pedidos
 * na fila.
 *
 * É por isso que aqui a medida é feita por um LEITOR NEUTRO — o driver `pg`
 * cru. Medir ida e volta pelo caminho que se quer testar dá zero mesmo quando
 * os dois lados estão errados.
 */

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { criarPrisma, type PrismaClient } from './client';

const urlApp = process.env['DATABASE_URL'];
const urlMigrator = process.env['DIRECT_URL'];
const temBanco = Boolean(urlApp && urlMigrator);

const TABELA = '__teste_tempo';

let app: PrismaClient;
let neutro: Client;

/**
 * Minutos entre dois instantes.
 *
 * Sem arredondar: o lint bloqueia `Math.round` porque arredondamento aqui
 * costuma ser assunto de dinheiro. Aqui é tempo, e a comparação é por FAIXA —
 * um minuto de folga contra três horas de erro. Fracionar não atrapalha.
 */
function minutos(a: Date, b: Date): number {
  return (a.getTime() - b.getTime()) / 60_000;
}

beforeAll(async () => {
  if (!temBanco) return;

  app = await criarPrisma({ url: urlApp!, maxConexoes: 2 });

  neutro = new Client({ connectionString: urlMigrator });
  await neutro.connect();

  // A tabela é do migrator e fica LEGÍVEL para o app: o teste mede fuso, não
  // isolamento, e uma tabela sem `tenant_id` não tem política para atrapalhar.
  await neutro.query(
    `CREATE TABLE IF NOT EXISTS ${TABELA} (id int PRIMARY KEY, quando timestamptz NOT NULL)`,
  );
  await neutro.query(`GRANT ALL ON ${TABELA} TO estoque_app`);
}, 60_000);

afterAll(async () => {
  if (!temBanco) return;

  await neutro.query(`DROP TABLE IF EXISTS ${TABELA}`);
  await neutro.end();
  await app.$disconnect();
});

describe.runIf(temBanco)('o tempo que a aplicação grava', () => {
  it('a sessão da aplicação fala UTC', async () => {
    const [linha] = await app.$queryRaw<{ tz: string }[]>`SELECT current_setting('TimeZone') AS tz`;

    /*
      Fuso é assunto de APRESENTAÇÃO. O banco guarda instante; quem escolhe
      como mostrar é a tela, com o fuso de quem lê. Uma sessão em
      `America/Sao_Paulo` faz o adaptador perder o deslocamento.
    */
    expect(linha?.tz).toBe('UTC');
  });

  it('o instante gravado é o instante real — medido por um leitor neutro', async () => {
    const marca = new Date();

    await app.$executeRawUnsafe(`DELETE FROM ${TABELA}`);
    await app.$executeRawUnsafe(`INSERT INTO ${TABELA} (id, quando) VALUES (1, $1)`, marca);

    const { rows } = await neutro.query<{ quando: Date }>(`SELECT quando FROM ${TABELA}`);
    const gravado = rows[0]!.quando;

    // Um minuto de folga cobre a latência; três horas, não.
    expect(Math.abs(minutos(gravado, marca))).toBeLessThanOrEqual(1);
  });

  it('`now()` do banco bate com o relógio de quem chama', async () => {
    const antes = new Date();
    const [linha] = await app.$queryRaw<{ agora: Date }[]>`SELECT now() AS agora`;

    expect(Math.abs(minutos(linha!.agora, antes))).toBeLessThanOrEqual(1);
  });

  it('o que foi gravado agora NÃO está no futuro para o banco', async () => {
    const marca = new Date();

    await app.$executeRawUnsafe(`DELETE FROM ${TABELA}`);
    await app.$executeRawUnsafe(`INSERT INTO ${TABELA} (id, quando) VALUES (1, $1)`, marca);

    /*
      A comparação acontece DENTRO do SQL, que é o único lugar onde o defeito
      aparecia: era assim que um pedido enviado agora dava −3 h de idade e não
      caía em faixa nenhuma do relatório de fila.
    */
    const { rows } = await neutro.query<{ segundos: string }>(
      `SELECT EXTRACT(epoch FROM now() - quando)::text AS segundos FROM ${TABELA}`,
    );

    const idade = Number(rows[0]!.segundos);
    expect(idade).toBeGreaterThanOrEqual(0);
    expect(idade).toBeLessThan(60);
  });
});
