/**
 * Testes de ponta a ponta das contas.
 *
 * O que estes testes existem para impedir:
 *
 *  1. **Um segundo saldo do cliente.** Baixar um título a receber lança a
 *     quitação NA carteira. Dois lugares com o mesmo débito e números
 *     diferentes seria a pior coisa que este sistema poderia ganhar.
 *  2. **Baixa acima do saldo.** É erro de digitação, e aceitar em silêncio
 *     esconde dinheiro que não existe.
 *  3. **Parcial marcada como paga.** Perde a cobrança do resto.
 *  4. **Indicador contado sobre a página.**
 *  5. **"Vencido" que não vence.** A situação é derivada de hoje, não de uma
 *     coluna que precisa de rotina para virar.
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

interface Titulo {
  id: string;
  tipo: string;
  status: string;
  situacao: string;
  diasDeAtraso: number;
  contraparte: string;
  valor: string;
  valorPago: string;
  emAberto: string;
  parcela: number;
  parcelas: number;
  vencimento: string;
  baixas: { id: string; valor: string; forma: string }[];
}

interface Pagina {
  itens: Titulo[];
  resumo: {
    vencido: string;
    titulosVencidos: number;
    emAberto: string;
    titulosEmAberto: number;
  };
  contagens: { aPagar: number; aReceber: number; abertos: number; vencidos: number };
}

let app: INestApplication;
let http: ReturnType<typeof request>;
let token: string;
let fornecedorId: string;
let clienteId: string;

/**
 * O que este arquivo criou.
 *
 * "Titulo vencido de teste" na tela de Contas empurra os titulos de verdade
 * para fora da primeira pagina. Em aberto se CANCELA — que e a acao do
 * dominio, nao um `delete` escondido. Titulo com baixa fica: a baixa ja
 * moveu carteira e caixa, e apagar isso seria mentir sobre dinheiro que se
 * moveu.
 */
const criados: string[] = [];

function autenticado(metodo: 'get' | 'post' | 'put' | 'delete', rota: string) {
  return http[metodo](rota).set('Authorization', `Bearer ${token}`);
}

/** Data relativa a hoje, em AAAA-MM-DD. Negativo é passado. */
function emDias(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

async function novoTitulo(corpo: Record<string, unknown>): Promise<Titulo[]> {
  const titulos = (await autenticado('post', '/api/financeiro/titulos').send(corpo).expect(201))
    .body as Titulo[];

  criados.push(...titulos.map((t) => t.id));
  return titulos;
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

  const fornecedores = (await autenticado('get', '/api/compras/fornecedores').expect(200)).body as {
    id: string;
  }[];
  if (fornecedores.length === 0) throw new Error('seed sem fornecedor');
  fornecedorId = fornecedores[0]!.id;

  const clientes = (await autenticado('get', '/api/clientes?limite=5').expect(200)).body as {
    itens: { id: string }[];
  };
  if (clientes.itens.length === 0) throw new Error('seed sem cliente');
  clienteId = clientes.itens[0]!.id;
}, 60_000);

afterAll(async () => {
  if (app) {
    for (const id of criados) {
      await autenticado('post', `/api/financeiro/titulos/${id}/cancelar`).send({
        motivo: 'Limpeza do teste de ponta a ponta',
      });
    }

    await app.close();
  }
}, 60_000);

describe.runIf(temBanco)('contas', () => {
  it('vencido é DERIVADO de hoje, não uma coluna que alguém precisa virar', async () => {
    const [atrasado] = await novoTitulo({
      tipo: 'PAGAR',
      fornecedorId,
      descricao: 'Título vencido de teste',
      vencimento: emDias(-9),
      valor: '500.00',
    });

    expect(atrasado!.situacao).toBe('VENCIDO');
    expect(atrasado!.diasDeAtraso).toBe(9);

    const [futuro] = await novoTitulo({
      tipo: 'PAGAR',
      fornecedorId,
      descricao: 'Título a vencer de teste',
      vencimento: emDias(6),
      valor: '500.00',
    });

    expect(futuro!.situacao).toBe('A_VENCER');
    expect(futuro!.diasDeAtraso).toBe(-6);

    const [hoje] = await novoTitulo({
      tipo: 'PAGAR',
      fornecedorId,
      descricao: 'Título que vence hoje',
      vencimento: emDias(0),
      valor: '100.00',
    });

    expect(hoje!.situacao).toBe('VENCE_HOJE');
  });

  /**
   * Cada parcela é um título próprio, com vencimento próprio. Um título só
   * com "3x" escondido no texto não apareceria no fluxo de caixa de cada mês.
   */
  it('parcelas viram títulos próprios e somam o total exato', async () => {
    const titulos = await novoTitulo({
      tipo: 'PAGAR',
      fornecedorId,
      descricao: 'Compra parcelada de teste',
      vencimento: emDias(30),
      valor: '100.00',
      parcelas: 3,
    });

    expect(titulos).toHaveLength(3);
    expect(titulos.map((t) => t.parcela)).toEqual([1, 2, 3]);

    // A ultima absorve a sobra: 33,33 + 33,33 + 33,34 = 100,00.
    const soma = titulos.reduce((s, t) => s + Number(t.valor), 0);
    expect(soma).toBeCloseTo(100, 2);

    // Vencimentos distintos, de mês em mês.
    const datas = new Set(titulos.map((t) => t.vencimento));
    expect(datas.size).toBe(3);
  });

  it('baixa parcial deixa o título aberto pelo saldo', async () => {
    const [titulo] = await novoTitulo({
      tipo: 'PAGAR',
      fornecedorId,
      descricao: 'Título para baixa parcial',
      vencimento: emDias(10),
      valor: '1000.00',
    });

    const depois = (
      await autenticado('post', `/api/financeiro/titulos/${titulo!.id}/baixar`)
        .send({ valor: '400.00', pagoEm: emDias(0), forma: 'TRANSFERENCIA' })
        .expect(201)
    ).body as Titulo;

    expect(depois.status).toBe('ABERTO');
    expect(depois.valorPago).toBe('400.00');
    expect(depois.emAberto).toBe('600.00');
    expect(depois.baixas).toHaveLength(1);

    // A segunda baixa fecha.
    const quitado = (
      await autenticado('post', `/api/financeiro/titulos/${titulo!.id}/baixar`)
        .send({ valor: '600.00', pagoEm: emDias(0), forma: 'BOLETO' })
        .expect(201)
    ).body as Titulo;

    expect(quitado.status).toBe('PAGO');
    expect(quitado.emAberto).toBe('0.00');
    expect(quitado.baixas).toHaveLength(2);
  });

  it('baixar mais do que se deve é recusado', async () => {
    const [titulo] = await novoTitulo({
      tipo: 'PAGAR',
      fornecedorId,
      descricao: 'Título para baixa acima do saldo',
      vencimento: emDias(10),
      valor: '300.00',
    });

    const recusa = await autenticado('post', `/api/financeiro/titulos/${titulo!.id}/baixar`)
      .send({ valor: '300.01', pagoEm: emDias(0), forma: 'PIX' })
      .expect(400);

    expect((recusa.body as { codigo: string }).codigo).toBe('BAIXA_ACIMA_DO_SALDO');
  });

  /**
   * A decisão que define o módulo: o título NÃO cria um segundo saldo. Quem
   * manda continua sendo a carteira, e a baixa lança a quitação NELA.
   */
  it('baixa de título a receber lança a quitação NA carteira do cliente', async () => {
    const antes = (
      await autenticado('get', `/api/carteira/${clienteId}/extrato?limite=1`).expect(200)
    ).body as { carteira: { saldo: string } };

    const [titulo] = await novoTitulo({
      tipo: 'RECEBER',
      clienteId,
      descricao: 'Título a receber de teste',
      vencimento: emDias(5),
      valor: '250.00',
    });

    await autenticado('post', `/api/financeiro/titulos/${titulo!.id}/baixar`)
      .send({ valor: '250.00', pagoEm: emDias(0), forma: 'PIX' })
      .expect(201);

    const depois = (
      await autenticado('get', `/api/carteira/${clienteId}/extrato?limite=5`).expect(200)
    ).body as { carteira: { saldo: string }; movimentos: { tipo: string; valor: string }[] };

    // Quitação é crédito: o saldo do cliente sobe em 250.
    expect(Number(depois.carteira.saldo) - Number(antes.carteira.saldo)).toBeCloseTo(250, 2);
    expect(depois.movimentos.some((m) => m.tipo === 'QUITACAO')).toBe(true);
  });

  it('baixa em DINHEIRO sem caixa aberto é recusada', async () => {
    const lojas = (await autenticado('get', '/api/lojas/painel').expect(200)).body as {
      id: string;
      status: string;
      caixaAberto: number | null;
    }[];

    const semCaixa = lojas.find((l) => l.status === 'ATIVO' && l.caixaAberto === null);
    if (!semCaixa) return; // Todas com caixa aberto: nada a provar aqui.

    const [titulo] = await novoTitulo({
      tipo: 'PAGAR',
      fornecedorId,
      descricao: 'Título para baixa em dinheiro',
      vencimento: emDias(3),
      valor: '80.00',
    });

    const recusa = await autenticado('post', `/api/financeiro/titulos/${titulo!.id}/baixar`)
      .send({ valor: '80.00', pagoEm: emDias(0), forma: 'DINHEIRO', lojaId: semCaixa.id })
      .expect(409);

    expect((recusa.body as { codigo: string }).codigo).toBe('CAIXA_FECHADO');
  });

  it('título já quitado não se baixa de novo', async () => {
    const [titulo] = await novoTitulo({
      tipo: 'PAGAR',
      fornecedorId,
      descricao: 'Título para dupla baixa',
      vencimento: emDias(10),
      valor: '50.00',
    });

    await autenticado('post', `/api/financeiro/titulos/${titulo!.id}/baixar`)
      .send({ valor: '50.00', pagoEm: emDias(0), forma: 'PIX' })
      .expect(201);

    const recusa = await autenticado('post', `/api/financeiro/titulos/${titulo!.id}/baixar`)
      .send({ valor: '50.00', pagoEm: emDias(0), forma: 'PIX' })
      .expect(409);

    expect((recusa.body as { codigo: string }).codigo).toBe('TITULO_NAO_ESTA_ABERTO');
  });

  it('título com baixa não se cancela — estorne antes', async () => {
    const [titulo] = await novoTitulo({
      tipo: 'PAGAR',
      fornecedorId,
      descricao: 'Título com baixa parcial para cancelar',
      vencimento: emDias(10),
      valor: '200.00',
    });

    await autenticado('post', `/api/financeiro/titulos/${titulo!.id}/baixar`)
      .send({ valor: '20.00', pagoEm: emDias(0), forma: 'PIX' })
      .expect(201);

    const recusa = await autenticado('post', `/api/financeiro/titulos/${titulo!.id}/cancelar`)
      .send({ motivo: 'Lançado em duplicidade pelo financeiro' })
      .expect(409);

    expect((recusa.body as { codigo: string }).codigo).toBe('TITULO_COM_BAIXA');
  });

  /**
   * O indicador conta o CONJUNTO, e soma `valor − pago`. Somar o valor cheio
   * mostraria uma dívida que já foi paga em parte.
   */
  it('o resumo conta o conjunto e desconta o que já foi pago', async () => {
    const [titulo] = await novoTitulo({
      tipo: 'PAGAR',
      fornecedorId,
      descricao: 'Título para conferir o resumo',
      vencimento: emDias(-2),
      valor: '1000.00',
    });

    const antes = (
      await autenticado('get', '/api/financeiro/titulos?tipo=PAGAR&limite=1').expect(200)
    ).body as Pagina;

    await autenticado('post', `/api/financeiro/titulos/${titulo!.id}/baixar`)
      .send({ valor: '400.00', pagoEm: emDias(0), forma: 'PIX' })
      .expect(201);

    const depois = (
      await autenticado('get', '/api/financeiro/titulos?tipo=PAGAR&limite=1').expect(200)
    ).body as Pagina;

    // A página tem 1 item; o resumo conta muitos mais.
    expect(depois.itens.length).toBe(1);
    expect(depois.resumo.titulosEmAberto).toBeGreaterThan(1);

    // O vencido caiu exatamente 400, que foi o que se pagou.
    expect(Number(antes.resumo.vencido) - Number(depois.resumo.vencido)).toBeCloseTo(400, 2);
  });

  it('o cliente do portal não enxerga a rota de contas', async () => {
    const tokenCliente = (
      (
        await http
          .post('/api/portal/auth/login')
          .send({ email: 'carlos@academiaippon.com.br', senha: 'Cliente@2026', canal: 'app' })
          .expect(200)
      ).body as { tokenAcesso: string }
    ).tokenAcesso;

    // Token do OUTRO domínio dá 401, não 403: falha na autenticação. ADR-009.
    await http
      .get('/api/financeiro/titulos')
      .set('Authorization', `Bearer ${tokenCliente}`)
      .expect(401);
  });
});
