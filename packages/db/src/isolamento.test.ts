/**
 * Testes de isolamento entre empresas — critérios de aceite de
 * docs/TENANCY.md §6.
 *
 * São testes de INTEGRAÇÃO: falam com o PostgreSQL de verdade. Isolamento não
 * pode ser testado com mock, porque metade da garantia está no banco.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ConexaoPrivilegiadaError, criarPrisma, type PrismaClient } from './client';
import { SemContextoError, comContexto, contextoDeSistema, type Contexto } from './contexto';
import { comEscopo, comEscopoAtual } from './escopo';

const urlApp = process.env['DATABASE_URL'];
const urlMigrator = process.env['DIRECT_URL'];
const temBanco = Boolean(urlApp && urlMigrator);

const SLUG_A = '__teste_iso_a';
const SLUG_B = '__teste_iso_b';

let app: PrismaClient;
let privilegiado: PrismaClient;
let tenantA = '';
let tenantB = '';

function contexto(tenantId: string, clienteId?: string): Contexto {
  return clienteId
    ? { tenantId, principalTipo: 'FUNCIONARIO', clienteId }
    : { tenantId, principalTipo: 'FUNCIONARIO' };
}

beforeAll(async () => {
  if (!temBanco) {
    return;
  }

  // O migrator tem BYPASSRLS de propósito: é assim que o seed escreve.
  privilegiado = await criarPrisma({
    url: urlMigrator as string,
    permitirPapelPrivilegiado: true,
  });

  await privilegiado.tenant.deleteMany({ where: { slug: { in: [SLUG_A, SLUG_B] } } });

  const a = await privilegiado.tenant.create({
    data: { nome: 'Empresa A (teste)', slug: SLUG_A },
  });
  const b = await privilegiado.tenant.create({
    data: { nome: 'Empresa B (teste)', slug: SLUG_B },
  });
  tenantA = a.id;
  tenantB = b.id;

  await privilegiado.loja.create({
    data: { tenantId: tenantA, nome: 'Loja da A', codigo: 'A1' },
  });
  await privilegiado.loja.create({
    data: { tenantId: tenantB, nome: 'Loja da B', codigo: 'B1' },
  });

  app = await criarPrisma({ url: urlApp as string });
});

afterAll(async () => {
  if (!temBanco) {
    return;
  }
  await privilegiado.tenant.deleteMany({ where: { slug: { in: [SLUG_A, SLUG_B] } } });
  await privilegiado.$disconnect();
  await app.$disconnect();
});

describe.runIf(temBanco)('trava de conexão privilegiada', () => {
  it('recusa conectar com o papel de migração', async () => {
    // O migrator tem BYPASSRLS e é dono das tabelas. Se a aplicação subisse
    // com ele, o isolamento inteiro deixaria de existir — sem erro aparente.
    await expect(criarPrisma({ url: urlMigrator as string })).rejects.toBeInstanceOf(
      ConexaoPrivilegiadaError,
    );
  });

  it('a mensagem diz o que fazer', async () => {
    try {
      await criarPrisma({ url: urlMigrator as string });
      expect.unreachable('deveria ter recusado');
    } catch (erro) {
      const e = erro as ConexaoPrivilegiadaError;
      expect(e.codigo).toBe('CONEXAO_PRIVILEGIADA');
      expect(e.message).toContain('BYPASSRLS');
      expect(e.message).toContain('DATABASE_URL');
    }
  });

  it('aceita o papel da aplicação', async () => {
    const cliente = await criarPrisma({ url: urlApp as string });
    expect(cliente).toBeDefined();
    await cliente.$disconnect();
  });
});

describe.runIf(temBanco)('escopo de tenant', () => {
  it('sem contexto, a consulta devolve zero linhas — não todas', async () => {
    // Critério de aceite nº 4. A falha é fechada, não aberta.
    const total = await app.tenant.count({ where: { slug: { in: [SLUG_A, SLUG_B] } } });
    expect(total).toBe(0);

    const lojas = await app.loja.count({ where: { codigo: { in: ['A1', 'B1'] } } });
    expect(lojas).toBe(0);
  });

  it('com contexto de A, enxerga apenas A', async () => {
    const vistos = await comEscopo(app, contexto(tenantA), async (tx) =>
      tx.tenant.findMany({ where: { slug: { in: [SLUG_A, SLUG_B] } } }),
    );

    expect(vistos).toHaveLength(1);
    expect(vistos[0]?.slug).toBe(SLUG_A);
  });

  it('com contexto de B, enxerga apenas B', async () => {
    const vistos = await comEscopo(app, contexto(tenantB), async (tx) =>
      tx.tenant.findMany({ where: { slug: { in: [SLUG_A, SLUG_B] } } }),
    );

    expect(vistos).toHaveLength(1);
    expect(vistos[0]?.slug).toBe(SLUG_B);
  });

  it('buscar recurso de outro tenant por id devolve nada — vira 404, não 403', async () => {
    // Critério nº 1. Devolver 403 confirmaria que o recurso existe.
    const achado = await comEscopo(app, contexto(tenantA), async (tx) =>
      tx.tenant.findUnique({ where: { id: tenantB } }),
    );

    expect(achado).toBeNull();
  });

  it('lojas também são filtradas, não só a tabela raiz', async () => {
    const daA = await comEscopo(app, contexto(tenantA), async (tx) =>
      tx.loja.findMany({ where: { codigo: { in: ['A1', 'B1'] } } }),
    );

    expect(daA).toHaveLength(1);
    expect(daA[0]?.codigo).toBe('A1');
  });

  it('escrever para outro tenant é recusado pelo WITH CHECK', async () => {
    await expect(
      comEscopo(app, contexto(tenantA), async (tx) =>
        tx.loja.create({
          data: { tenantId: tenantB, nome: 'Loja intrusa', codigo: 'X9' },
        }),
      ),
    ).rejects.toThrow();

    // E nada ficou no banco.
    const intrusas = await privilegiado.loja.count({ where: { codigo: 'X9' } });
    expect(intrusas).toBe(0);
  });
});

describe.runIf(temBanco)('o escopo não vaza entre transações', () => {
  it('SET LOCAL expira: a mesma conexão não carrega o tenant anterior', async () => {
    // É o cenário que `SET` comum quebraria: pool reaproveita a conexão e a
    // próxima requisição herdaria o tenant da anterior.
    const primeiro = await comEscopo(app, contexto(tenantA), async (tx) =>
      tx.tenant.count({ where: { slug: { in: [SLUG_A, SLUG_B] } } }),
    );
    expect(primeiro).toBe(1);

    const segundo = await comEscopo(app, contexto(tenantB), async (tx) =>
      tx.tenant.findMany({ where: { slug: { in: [SLUG_A, SLUG_B] } } }),
    );
    expect(segundo[0]?.slug).toBe(SLUG_B);

    // Fora de qualquer escopo, a mesma conexão não enxerga nada.
    const fora = await app.tenant.count({ where: { slug: { in: [SLUG_A, SLUG_B] } } });
    expect(fora).toBe(0);
  });
});

describe.runIf(temBanco)('escopo do cliente no portal', () => {
  it('cliente só enxerga os próprios dados', async () => {
    const clienteA1 = await privilegiado.cliente.create({
      data: { tenantId: tenantA, nome: 'Cliente 1 da A' },
    });
    const clienteA2 = await privilegiado.cliente.create({
      data: { tenantId: tenantA, nome: 'Cliente 2 da A' },
    });

    // Funcionário: enxerga os dois.
    const comoFuncionario = await comEscopo(app, contexto(tenantA), async (tx) =>
      tx.cliente.count(),
    );
    expect(comoFuncionario).toBe(2);

    // Portal do cliente 1: enxerga só a si mesmo.
    const comoCliente = await comEscopo(app, contexto(tenantA, clienteA1.id), async (tx) =>
      tx.cliente.findMany(),
    );
    expect(comoCliente).toHaveLength(1);
    expect(comoCliente[0]?.id).toBe(clienteA1.id);

    // E não alcança o outro nem por id direto.
    const outro = await comEscopo(app, contexto(tenantA, clienteA1.id), async (tx) =>
      tx.cliente.findUnique({ where: { id: clienteA2.id } }),
    );
    expect(outro).toBeNull();
  });
});

describe('contexto', () => {
  it('exigirContexto lança quando nenhum foi aberto', async () => {
    if (!temBanco) {
      return;
    }
    await expect(comEscopoAtual(app, async (tx) => tx.tenant.count())).rejects.toBeInstanceOf(
      SemContextoError,
    );
  });

  it('comContexto disponibiliza o contexto para toda a pilha', async () => {
    const ctx = contexto('01234567-89ab-7cde-8f01-23456789abcd');
    const visto = await comContexto(ctx, async () => {
      const { contextoAtual } = await import('./contexto');
      return contextoAtual()?.tenantId;
    });
    expect(visto).toBe(ctx.tenantId);
  });

  it('job sem tenant é rejeitado na criação do contexto', () => {
    // Ver docs/TENANCY.md §4: falhar cedo e alto.
    expect(() => contextoDeSistema('')).toThrow(SemContextoError);
  });
});
