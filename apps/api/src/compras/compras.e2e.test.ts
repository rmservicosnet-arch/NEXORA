/**
 * Testes de ponta a ponta das compras.
 *
 * O que estes testes existem para impedir:
 *
 *  1. **Mercadoria entrando sem custo.** É o custo daqui que forma o custo
 *     médio; uma entrada sem ele quebra toda margem depois.
 *  2. **A mesma nota lançada duas vezes.** Dobra a mercadoria e estraga a
 *     média de cada item dela.
 *  3. **Nota recebida sendo editada.** Ela já mexeu no razão: editar deixaria
 *     o documento dizendo uma coisa e o razão outra.
 *  4. **Estorno que apaga em vez de lançar o contrário.**
 *  5. **Recebimento parcial.** O documento entra inteiro ou não entra.
 *
 * Pré-requisito: `npm run db:seed`.
 */

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../app.module';

const temBanco = Boolean(process.env['DATABASE_URL'] && process.env['DIRECT_URL']);

const ADMIN = { email: 'rodrigo@lojacentro.com.br', senha: 'Estoque@2026' };

interface ItemCompra {
  id: string;
  variacaoId: string;
  sku: string;
  quantidade: string;
  custoUnitario: string;
  custoMedioAntes: string | null;
  custoMedioDepois: string | null;
  saldoAtual?: string;
}

interface Compra {
  id: string;
  status: string;
  numeroNota: string | null;
  valorTotal: string;
  recebidaPor: string | null;
  motivoEstorno: string | null;
  itens: ItemCompra[];
}

interface PaginaCompras {
  itens: Compra[];
  contagens: { total: number; rascunhos: number; recebidas: number; estornadas: number };
  resumo: { aReceber: number; valorAReceber: string; itensSemCusto: number };
}

interface ItemParaComprar {
  variacaoId: string;
  sku: string;
  saldoAtual: string;
  custoMedioAtual: string;
  ultimoCusto: string | null;
}

let app: INestApplication;
let http: ReturnType<typeof request>;
let token: string;
let lojaId: string;
let localId: string;
let fornecedorId: string;

/** Sufixo aleatório: SKU e número de nota fixos dão 409 na segunda execução. */
function sufixo(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function autenticado(metodo: 'get' | 'post' | 'put' | 'delete', rota: string) {
  return http[metodo](rota).set('Authorization', `Bearer ${token}`);
}

async function novoRascunho(itens: { variacaoId: string; quantidade: string; custoUnitario: string }[]) {
  const resposta = await autenticado('post', '/api/compras')
    .send({ lojaId, localId, fornecedorId, numeroNota: `T${sufixo()}`, itens })
    .expect(201);

  return resposta.body as Compra;
}

async function itemComSaldo(): Promise<ItemParaComprar> {
  const itens = (
    await autenticado('get', `/api/compras/itens?localId=${localId}&limite=30`).expect(200)
  ).body as ItemParaComprar[];

  const comSaldo = itens.find((i) => Number(i.saldoAtual) > 0);
  if (!comSaldo) throw new Error('seed sem item com saldo positivo');
  return comSaldo;
}

beforeAll(async () => {
  if (!temBanco) return;

  const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = modulo.createNestApplication();
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  await app.init();
  http = request(app.getHttpServer());

  token = (
    (
      await http
        .post('/api/auth/login')
        .send({ ...ADMIN, canal: 'app' })
        .expect(200)
    ).body as { tokenAcesso: string }
  ).tokenAcesso;

  const lojas = (
    await autenticado('get', '/api/lojas/painel').expect(200)
  ).body as { id: string; status: string; locais: { id: string }[] }[];

  const loja = lojas.find((l) => l.status === 'ATIVO' && l.locais.length > 0);
  if (!loja) throw new Error('seed sem loja com local');
  lojaId = loja.id;
  localId = loja.locais[0]!.id;

  const fornecedores = (
    await autenticado('get', '/api/compras/fornecedores').expect(200)
  ).body as { id: string }[];

  if (fornecedores.length === 0) throw new Error('seed sem fornecedor');
  fornecedorId = fornecedores[0]!.id;
}, 60_000);

afterAll(async () => {
  if (app) {
    await app.close();
  }
});

describe.runIf(temBanco)('compras', () => {
  it('a busca devolve saldo e custo do destino — NUNCA preço de venda', async () => {
    const resposta = await autenticado('get', `/api/compras/itens?localId=${localId}`).expect(200);

    const itens = resposta.body as ItemParaComprar[];
    expect(itens.length).toBeGreaterThan(0);
    expect(itens.every((i) => typeof i.custoMedioAtual === 'string')).toBe(true);

    // Quem compra não decide por preço de venda: ele não vem nesta resposta.
    expect(resposta.text).not.toContain('preco');
    expect(resposta.text).not.toContain('"preço"');
  });

  it('a nota nasce em rascunho e NÃO mexe no estoque', async () => {
    const item = await itemComSaldo();

    const compra = await novoRascunho([
      { variacaoId: item.variacaoId, quantidade: '10', custoUnitario: '50.00' },
    ]);

    expect(compra.status).toBe('RASCUNHO');
    expect(compra.valorTotal).toBe('500.00');
    expect(compra.itens[0]!.custoMedioDepois).toBeNull();

    // O saldo do destino não se moveu.
    const depois = (
      await autenticado('get', `/api/compras/itens?localId=${localId}&termo=${item.sku}`).expect(
        200,
      )
    ).body as ItemParaComprar[];

    expect(depois[0]!.saldoAtual).toBe(item.saldoAtual);
  });

  /**
   * O rascunho diz o que VAI acontecer com a média antes de alguém apertar
   * receber. Sem o saldo de hoje no destino, a tela não teria como.
   */
  it('o rascunho carrega o saldo atual do destino; a recebida, o custo congelado', async () => {
    const item = await itemComSaldo();

    const rascunho = await novoRascunho([
      { variacaoId: item.variacaoId, quantidade: '5', custoUnitario: '80.00' },
    ]);

    const detalhe = (
      await autenticado('get', `/api/compras/${rascunho.id}`).expect(200)
    ).body as Compra;

    expect(detalhe.itens[0]!.saldoAtual).toBe(item.saldoAtual);
    expect(detalhe.itens[0]!.custoMedioAntes).toBeNull();

    const recebida = (
      await autenticado('post', `/api/compras/${rascunho.id}/receber`).expect(201)
    ).body as Compra;

    expect(recebida.status).toBe('RECEBIDA');
    expect(recebida.itens[0]!.custoMedioAntes).not.toBeNull();
    expect(recebida.itens[0]!.custoMedioDepois).not.toBeNull();
    expect(recebida.recebidaPor).not.toBeNull();
  });

  /** Receber move o custo médio pela política real, não por uma conta à parte. */
  it('receber recalcula o custo médio ponderado', async () => {
    const item = await itemComSaldo();
    const saldo = Number(item.saldoAtual);
    const medio = Number(item.custoMedioAtual);

    const rascunho = await novoRascunho([
      { variacaoId: item.variacaoId, quantidade: '10', custoUnitario: '100.00' },
    ]);

    const recebida = (
      await autenticado('post', `/api/compras/${rascunho.id}/receber`).expect(201)
    ).body as Compra;

    const esperado = (saldo * medio + 10 * 100) / (saldo + 10);

    expect(Number(recebida.itens[0]!.custoMedioDepois)).toBeCloseTo(esperado, 4);
  });

  /**
   * A MESMA nota do MESMO fornecedor, duas vezes, dobraria a mercadoria e
   * estragaria o custo médio de cada item dela. O banco recusa.
   */
  it('a mesma nota do mesmo fornecedor não entra duas vezes', async () => {
    const item = await itemComSaldo();
    const numeroNota = `DUP${sufixo()}`;

    await autenticado('post', '/api/compras')
      .send({
        lojaId,
        localId,
        fornecedorId,
        numeroNota,
        itens: [{ variacaoId: item.variacaoId, quantidade: '1', custoUnitario: '10.00' }],
      })
      .expect(201);

    const repetida = await autenticado('post', '/api/compras')
      .send({
        lojaId,
        localId,
        fornecedorId,
        numeroNota,
        itens: [{ variacaoId: item.variacaoId, quantidade: '1', custoUnitario: '10.00' }],
      })
      .expect(409);

    expect((repetida.body as { codigo: string }).codigo).toBe('NOTA_JA_LANCADA');
  });

  it('nota recebida não se edita nem se apaga — corrigir é estornar', async () => {
    const item = await itemComSaldo();
    const rascunho = await novoRascunho([
      { variacaoId: item.variacaoId, quantidade: '2', custoUnitario: '30.00' },
    ]);

    await autenticado('post', `/api/compras/${rascunho.id}/receber`).expect(201);

    const edicao = await autenticado('put', `/api/compras/${rascunho.id}`)
      .send({ itens: [{ variacaoId: item.variacaoId, quantidade: '99', custoUnitario: '1.00' }] })
      .expect(409);

    expect((edicao.body as { codigo: string }).codigo).toBe('COMPRA_JA_RECEBIDA');

    await autenticado('delete', `/api/compras/${rascunho.id}`).expect(409);
  });

  /**
   * Estorno é lançamento contrário: o saldo volta, o movimento original
   * permanece, e o motivo fica gravado. Sem motivo, a API recusa.
   */
  it('estorno devolve o saldo, exige motivo e não apaga a nota', async () => {
    const item = await itemComSaldo();
    const saldoAntes = Number(item.saldoAtual);

    const rascunho = await novoRascunho([
      { variacaoId: item.variacaoId, quantidade: '7', custoUnitario: '25.00' },
    ]);

    await autenticado('post', `/api/compras/${rascunho.id}/receber`).expect(201);

    const semMotivo = await autenticado('post', `/api/compras/${rascunho.id}/estornar`)
      .send({ motivo: 'abc' })
      .expect(400);
    expect(semMotivo.status).toBe(400);

    const estornada = (
      await autenticado('post', `/api/compras/${rascunho.id}/estornar`)
        .send({ motivo: 'Nota lançada em duplicidade pelo depósito' })
        .expect(201)
    ).body as Compra;

    expect(estornada.status).toBe('ESTORNADA');
    expect(estornada.motivoEstorno).toContain('duplicidade');

    // A nota continua existindo, e o saldo voltou ao que era.
    const depois = (
      await autenticado('get', `/api/compras/itens?localId=${localId}&termo=${item.sku}`).expect(
        200,
      )
    ).body as ItemParaComprar[];

    expect(Number(depois[0]!.saldoAtual)).toBeCloseTo(saldoAntes, 6);
  });

  it('nota sem itens não tem o que dar entrada', async () => {
    const vazia = await novoRascunho([]);

    const recusa = await autenticado('post', `/api/compras/${vazia.id}/receber`).expect(400);
    expect((recusa.body as { codigo: string }).codigo).toBe('COMPRA_SEM_ITENS');
  });

  /**
   * As contagens saem do BANCO, não da página. Um número que muda com o
   * `limite` é um número que mente.
   */
  it('as contagens contam o conjunto, não a página', async () => {
    const pagina = (await autenticado('get', '/api/compras?limite=1').expect(200))
      .body as PaginaCompras;

    expect(pagina.itens.length).toBe(1);
    expect(pagina.contagens.total).toBeGreaterThan(1);
    expect(pagina.contagens.rascunhos + pagina.contagens.recebidas + pagina.contagens.estornadas)
      .toBe(pagina.contagens.total);
  });

  it('o cliente do portal não enxerga compra nenhuma', async () => {
    const tokenCliente = (
      (
        await http
          .post('/api/portal/auth/login')
          .send({ email: 'carlos@academiaippon.com.br', senha: 'Cliente@2026', canal: 'app' })
          .expect(200)
      ).body as { tokenAcesso: string }
    ).tokenAcesso;

    // Token do OUTRO domínio numa rota da equipe dá 401, não 403: falha na
    // autenticação, não na permissão. É o desenho do ADR-009.
    await http
      .get('/api/compras')
      .set('Authorization', `Bearer ${tokenCliente}`)
      .expect(401);
  });
});
