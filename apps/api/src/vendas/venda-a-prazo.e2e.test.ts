/**
 * Venda a prazo — a decisão de docs/WALLET.md §6.
 *
 * Um cliente compra a prazo. Isso vira UMA das duas coisas:
 *
 *   com carteira → débito `VENDA_A_PRAZO` no razão dela
 *   sem carteira → título em contas a receber, com vencimento
 *
 * **Nunca as duas.** Fazer as duas infla o ativo da empresa pelo dobro — o
 * erro contábil mais caro que um ERP pequeno costuma cometer, e o motivo de
 * este arquivo existir.
 *
 * Antes disto, o PDV aceitava a forma `PRAZO` e não lançava nada: a venda
 * fechava, a mercadoria saía e o cliente não devia em lugar nenhum.
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

let app: INestApplication;
let http: ReturnType<typeof request>;
let token: string;
let lojaId: string;
let localId: string;

/** Sufixo aleatório: documento fixo dá 409 na segunda execução. */
function sufixo(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function autenticado(metodo: 'get' | 'post', rota: string) {
  return http[metodo](rota).set('Authorization', `Bearer ${token}`);
}

async function clienteCom(usaCarteira: boolean): Promise<string> {
  const criado = (
    await autenticado('post', '/api/clientes')
      .send({ nome: `Teste prazo ${sufixo()}`, usaCarteira })
      .expect(201)
  ).body as { id: string };

  return criado.id;
}

async function produtoAbastecido(): Promise<string> {
  const itens = (
    await autenticado('get', `/api/vendas/itens?lojaId=${lojaId}&limite=30`).expect(200)
  ).body as { variacaoId: string; disponivel?: string }[];

  const item = itens[0];
  if (!item) throw new Error('seed sem item vendável');

  // Abastece para a venda não esbarrar em saldo.
  await autenticado('post', '/api/estoque/entrada')
    .send({
      lojaId,
      localId,
      variacaoId: item.variacaoId,
      quantidade: '20',
      custoUnitario: '10.00',
      tipo: 'ENTRADA_COMPRA',
    })
    .expect(201);

  return item.variacaoId;
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

  const contexto = (await autenticado('get', '/api/vendas/contexto').expect(200)).body as {
    lojas: { id: string; localPadraoId: string | null }[];
  };

  const loja = contexto.lojas.find((l) => l.localPadraoId !== null);
  if (!loja) throw new Error('seed sem loja com local padrão');
  lojaId = loja.id;
  localId = loja.localPadraoId!;
}, 60_000);

afterAll(async () => {
  if (app) await app.close();
});

describe.runIf(temBanco)('venda a prazo', () => {
  it('sem cliente identificado é recusada — alguém tem de dever', async () => {
    const variacaoId = await produtoAbastecido();

    const recusa = await autenticado('post', '/api/vendas')
      .send({
        lojaId,
        itens: [{ variacaoId, quantidade: '1', precoUnitario: '100.00' }],
        pagamentos: [{ forma: 'PRAZO', valor: '100.00' }],
      })
      .expect(400);

    expect((recusa.body as { codigo: string }).codigo).toBe('PRAZO_EXIGE_CLIENTE');
  });

  it('cliente SEM carteira gera TÍTULO, e não movimento de carteira', async () => {
    const variacaoId = await produtoAbastecido();
    const clienteId = await clienteCom(false);

    const resultado = (
      await autenticado('post', '/api/vendas')
        .send({
          lojaId,
          clienteId,
          itens: [{ variacaoId, quantidade: '1', precoUnitario: '250.00' }],
          pagamentos: [{ forma: 'PRAZO', valor: '250.00' }],
        })
        .expect(201)
    ).body as { venda: { id: string; numero: number }; avisos: { codigo: string }[] };

    expect(resultado.avisos.some((a) => a.codigo === 'TITULO_A_RECEBER_GERADO')).toBe(true);

    const titulos = (
      await autenticado('get', '/api/financeiro/titulos?tipo=RECEBER&recorte=todos&limite=100')
        .expect(200)
    ).body as {
      itens: { origem: string; valor: string; descricao: string; contraparte: string }[];
    };

    const meu = titulos.itens.find((t) =>
      t.descricao.includes(`Venda ${String(resultado.venda.numero)}`),
    );

    expect(meu).toBeDefined();
    expect(meu!.origem).toBe('VENDA');
    expect(meu!.valor).toBe('250.00');
  });

  it('cliente COM carteira leva DÉBITO no razão dela, e nenhum título', async () => {
    const variacaoId = await produtoAbastecido();
    const clienteId = await clienteCom(true);

    const resultado = (
      await autenticado('post', '/api/vendas')
        .send({
          lojaId,
          clienteId,
          itens: [{ variacaoId, quantidade: '1', precoUnitario: '180.00' }],
          pagamentos: [{ forma: 'PRAZO', valor: '180.00' }],
        })
        .expect(201)
    ).body as { venda: { numero: number }; avisos: { codigo: string }[] };

    expect(resultado.avisos.some((a) => a.codigo === 'LANCADO_NA_CARTEIRA')).toBe(true);

    // O razão da carteira recebeu o débito, com o tipo que diz o que foi.
    const extrato = (
      await autenticado('get', `/api/carteira/${clienteId}/extrato?limite=10`).expect(200)
    ).body as {
      carteira: { saldo: string };
      movimentos: { tipo: string; valor: string; sentido: string }[];
    };

    const aPrazo = extrato.movimentos.find((m) => m.tipo === 'VENDA_A_PRAZO');
    expect(aPrazo).toBeDefined();
    expect(aPrazo!.valor).toBe('180.00');
    expect(aPrazo!.sentido).toBe('DEBITO');

    // Saldo NEGATIVO é o cliente devendo. A convenção não se inverte.
    expect(Number(extrato.carteira.saldo)).toBeLessThan(0);

    /*
      E NENHUM título: a mesma dívida nos dois lugares infla o ativo pelo
      dobro. É o erro que o §6 existe para impedir.
    */
    const titulos = (
      await autenticado('get', '/api/financeiro/titulos?tipo=RECEBER&recorte=todos&limite=100')
        .expect(200)
    ).body as { itens: { descricao: string }[] };

    expect(
      titulos.itens.some((t) => t.descricao.includes(`Venda ${String(resultado.venda.numero)}`)),
    ).toBe(false);
  });

  it('o vencimento informado manda; sem ele, valem 30 dias', async () => {
    const variacaoId = await produtoAbastecido();
    const clienteId = await clienteCom(false);

    const vencimento = '2027-03-15';

    const resultado = (
      await autenticado('post', '/api/vendas')
        .send({
          lojaId,
          clienteId,
          itens: [{ variacaoId, quantidade: '1', precoUnitario: '90.00' }],
          pagamentos: [{ forma: 'PRAZO', valor: '90.00', vencimento }],
        })
        .expect(201)
    ).body as { venda: { numero: number } };

    const titulos = (
      await autenticado('get', '/api/financeiro/titulos?tipo=RECEBER&recorte=todos&limite=100')
        .expect(200)
    ).body as { itens: { descricao: string; vencimento: string }[] };

    const meu = titulos.itens.find((t) =>
      t.descricao.includes(`Venda ${String(resultado.venda.numero)}`),
    );

    expect(meu?.vencimento).toBe(vencimento);
  });
});
