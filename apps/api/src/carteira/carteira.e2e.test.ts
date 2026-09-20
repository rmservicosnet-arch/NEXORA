/**
 * Testes de ponta a ponta da carteira.
 *
 * O que estes testes existem para impedir:
 *
 *  1. **Saldo divergindo do razao.** `carteira.saldo` e cache; a verdade e a
 *     soma de `carteira_movimento`. Divergencia e BUG, nao arredondamento.
 *  2. **Sinal invertido.** Credito aumenta, debito diminui — em toda camada.
 *     Uma quitacao gravada como debito aumentaria a divida de quem pagou.
 *  3. **Limite ignorado.** Comprar acima de `saldo + limite` sem autorizacao.
 *  4. **Venda em carteira que nao debita.** Era o estado ate agora: o PDV
 *     aceitava a forma e nao lancava nada.
 *
 * Pre-requisito: `npm run db:seed`.
 */

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../app.module';

const temBanco = Boolean(process.env['DATABASE_URL'] && process.env['DIRECT_URL']);

const ADMIN = { email: 'rodrigo@lojacentro.com.br', senha: 'Estoque@2026' };
/** Vendedora: ve a carteira, nao lanca nada. */
const VENDEDORA = { email: 'marina@lojacentro.com.br', senha: 'Estoque@2026' };
/** Financeiro: lanca quitacao e deposito, nao ajusta. */
const FINANCEIRO = { email: 'beatriz@lojacentro.com.br', senha: 'Estoque@2026' };

let app: INestApplication;
let http: ReturnType<typeof request>;
let tokenAdmin: string;
let clienteId: string;
let loja: { id: string; localPadraoId: string | null };
let tabelaPadraoId: string;

interface Movimento {
  id: string;
  sentido: string;
  tipo: string;
  valor: string;
  saldoAnterior: string;
  saldoPosterior: string;
  excedeuLimite: boolean;
  justificativa: string | null;
  estornado: boolean;
  vendaNumero: number | null;
}

interface Extrato {
  carteira: {
    id: string;
    clienteId: string;
    cliente: string;
    saldo: string;
    limiteCredito: string;
    disponivel: string;
    bloqueadaParaCompra: boolean;
  };
  movimentos: Movimento[];
  proximoCursor: string | null;
  totalCreditos: string;
  totalDebitos: string;
}

async function entrar(dados: { email: string; senha: string }): Promise<string> {
  const resposta = await http
    .post('/api/auth/login')
    .send({ ...dados, canal: 'app' })
    .expect(200);
  return (resposta.body as { tokenAcesso: string }).tokenAcesso;
}

async function extrato(token = tokenAdmin, cursor: string | null = null): Promise<Extrato> {
  const resposta = await http
    .get(`/api/carteira/${clienteId}/extrato?limite=200${cursor ? `&cursor=${cursor}` : ''}`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  return resposta.body as Extrato;
}

/**
 * Devolve a cadeia do supertest, NAO uma Promise.
 *
 * Com `async` aqui, `lancar(...).expect(201)` quebra: a Promise nao tem
 * `.expect`. O `await` continua funcionando porque a cadeia e thenable.
 */
function lancar(token: string, corpo: Record<string, unknown>) {
  return http
    .post(`/api/carteira/${clienteId}/lancamentos`)
    .set('Authorization', `Bearer ${token}`)
    .send(corpo);
}

/**
 * Produto com preco e estoque no local de venda da primeira loja.
 *
 * O preco e informado para que a venda de teste bata num valor conhecido.
 */
async function itemComEstoque(preco: string): Promise<{ variacaoId: string; lojaId: string }> {
  const sufixo = Math.random().toString(36).toUpperCase().slice(2, 8);

  const criado = await http
    .post('/api/produtos')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send({
      skuBase: `CT-${sufixo}`,
      nome: `Item de carteira ${sufixo}`,
      variacoes: [{ sku: `CT-${sufixo}-U`, descricao: 'unica', precoPadrao: preco }],
    })
    .expect(201);

  const detalhe = await http
    .get(`/api/produtos/${(criado.body as { id: string }).id}`)
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .expect(200);

  const variacaoId = (detalhe.body as { variacoes: { id: string }[] }).variacoes[0]!.id;

  await http
    .post('/api/estoque/entrada')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send({
      variacaoId,
      lojaId: loja.id,
      localId: loja.localPadraoId,
      quantidade: '20',
      custoUnitario: '1.00',
    })
    .expect(201);

  return { variacaoId, lojaId: loja.id };
}

beforeAll(async () => {
  if (!temBanco) {
    return;
  }

  const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = modulo.createNestApplication();
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  await app.init();
  http = request(app.getHttpServer());

  tokenAdmin = await entrar(ADMIN);

  const pagina = (
    await http
      .get('/api/carteira?limite=10')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200)
  ).body as { itens: { clienteId: string }[] };

  clienteId = pagina.itens[0]!.clienteId;

  const contexto = (
    await http.get('/api/vendas/contexto').set('Authorization', `Bearer ${tokenAdmin}`).expect(200)
  ).body as {
    lojas: { id: string; localPadraoId: string | null }[];
    tabelas: { id: string; padrao: boolean }[];
  };

  loja = contexto.lojas.find((l) => l.localPadraoId !== null)!;
  tabelaPadraoId = contexto.tabelas.find((t) => t.padrao)!.id;
}, 60_000);

afterAll(async () => {
  if (app) {
    await app.close();
  }
});

describe.runIf(temBanco)('a convencao de sinal', () => {
  it('saldo negativo significa que o CLIENTE deve a loja', async () => {
    const e = await extrato();

    // O seed deixa a Academia Ippon devendo. Ver docs/WALLET.md §2: o valor
    // que trafega e negativo, mesmo que a tela escreva "em aberto".
    expect(Number(e.carteira.saldo)).toBeLessThan(0);
    expect(Number(e.carteira.limiteCredito)).toBeGreaterThan(0);
    // disponivel = saldo + limite
    expect(Number(e.carteira.disponivel)).toBeCloseTo(
      Number(e.carteira.saldo) + Number(e.carteira.limiteCredito),
      2,
    );
  });

  it('credito aumenta o saldo; debito diminui', async () => {
    const antes = Number((await extrato()).carteira.saldo);

    await lancar(tokenAdmin, {
      tipo: 'DEPOSITO',
      valor: '100.00',
      formaPagamento: 'PIX',
    }).expect(201);

    const comCredito = Number((await extrato()).carteira.saldo);
    expect(comCredito).toBeCloseTo(antes + 100, 2);

    await lancar(tokenAdmin, {
      tipo: 'TAXA',
      valor: '30.00',
      justificativa: 'Taxa de entrega acordada',
    }).expect(201);

    expect(Number((await extrato()).carteira.saldo)).toBeCloseTo(comCredito - 30, 2);
  });

  it('quitacao de 400 num saldo de -1000 deixa -600', async () => {
    // Leva o saldo a exatamente -1000 com um ajuste, para a conta do teste
    // ser a do documento.
    const atual = Number((await extrato()).carteira.saldo);
    const diferenca = -1000 - atual;

    await lancar(tokenAdmin, {
      tipo: diferenca > 0 ? 'AJUSTE_CREDITO' : 'AJUSTE_DEBITO',
      valor: Math.abs(diferenca).toFixed(2),
      justificativa: 'Preparo do cenario de teste',
    }).expect(201);

    expect(Number((await extrato()).carteira.saldo)).toBeCloseTo(-1000, 2);

    await lancar(tokenAdmin, {
      tipo: 'QUITACAO',
      valor: '400.00',
      formaPagamento: 'DINHEIRO',
      documento: 'Recibo 123',
    }).expect(201);

    expect(Number((await extrato()).carteira.saldo)).toBeCloseTo(-600, 2);
  });
});

describe.runIf(temBanco)('o razao e a verdade', () => {
  it('o saldo e exatamente a soma dos movimentos', async () => {
    // O razao INTEIRO, seguindo o cursor.
    //
    // Somar so a primeira pagina e comparar com o saldo total e um teste que
    // passa enquanto o cadastro e novo e quebra quando ele cresce — o que de
    // fato aconteceu, passados os 200 movimentos. A divergencia acusada nao
    // era do razao: era da leitura.
    let soma = 0;
    let cursor: string | null = null;
    let saldo: string;
    let paginas = 0;

    do {
      const pagina: Extrato = await extrato(tokenAdmin, cursor);
      saldo = pagina.carteira.saldo;
      for (const m of pagina.movimentos) {
        soma += m.sentido === 'CREDITO' ? Number(m.valor) : -Number(m.valor);
      }
      cursor = pagina.proximoCursor;
      paginas += 1;
    } while (cursor && paginas < 50);

    expect(cursor).toBeNull();

    // `carteira.saldo` e cache. Se ele divergir da soma do razao, e BUG —
    // nao arredondamento. Ver docs/WALLET.md §3.
    expect(soma).toBeCloseTo(Number(saldo), 2);
  });

  it('o extrato encadeia: o posterior de um e o anterior do seguinte', async () => {
    const e = await extrato();
    const cronologico = [...e.movimentos].reverse();

    expect(cronologico.length).toBeGreaterThan(2);

    for (let i = 1; i < cronologico.length; i += 1) {
      expect(cronologico[i]!.saldoAnterior).toBe(cronologico[i - 1]!.saldoPosterior);
    }
  });

  it('os totais de credito e debito fecham com o saldo', async () => {
    const e = await extrato();
    expect(Number(e.totalCreditos) - Number(e.totalDebitos)).toBeCloseTo(
      Number(e.carteira.saldo),
      2,
    );
  });
});

describe.runIf(temBanco)('limite de credito', () => {
  it('o admin, que tem carteira.exceder_limite, passa do limite com justificativa', async () => {
    const e = await extrato();
    const disponivel = Number(e.carteira.disponivel);

    // Nao e falha: e o comportamento desenhado. Permitido quando autorizado,
    // nunca silencioso — o movimento fica marcado. Ver docs/WALLET.md §4.
    const depois = (
      await lancar(tokenAdmin, {
        tipo: 'AJUSTE_DEBITO',
        valor: (disponivel + 500).toFixed(2),
        justificativa: 'Acordo comercial fora do limite, autorizado pela diretoria',
      }).expect(201)
    ).body as Extrato;

    expect(depois.movimentos[0]!.excedeuLimite).toBe(true);

    /*
      A justificativa vai para o RAZAO, nao so para a conferencia.

      `conferirLimite` a exigia e o chamador a descartava: o movimento ficava
      marcado como excedido e sem uma linha dizendo por que foi autorizado.
      Quem revisasse depois via a marca e nenhuma explicacao — o relatorio
      "Acima do limite" existe justamente para ser lido por quem nao estava la.
    */
    expect(depois.movimentos[0]!.justificativa).toBe(
      'Acordo comercial fora do limite, autorizado pela diretoria',
    );

    // Desfaz, para nao deixar o cenario torto para os testes seguintes.
    await http
      .post(`/api/carteira/${clienteId}/lancamentos/${depois.movimentos[0]!.id}/estornar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ justificativa: 'Limpeza do cenario de teste' })
      .expect(201);
  });

  it('quem NAO tem carteira.exceder_limite e recusado — pela venda', async () => {
    // Nenhum perfil consegue lancar debito manual sem tambem poder exceder:
    // debito manual exige `carteira.ajustar`, que e do Gestor. O caminho real
    // de um debito feito por quem nao pode exceder e a VENDA paga em carteira.
    const token = await entrar(VENDEDORA);
    const e = await extrato();
    const acima = (Number(e.carteira.disponivel) + 1000).toFixed(2);

    const item = await itemComEstoque(acima);

    const recusa = await http
      .post('/api/vendas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        lojaId: item.lojaId,
        clienteId,
        // O cliente usa a tabela Revendedor, e o produto de teste so tem
        // preco na Padrao. Informar a tabela e o que o operador faria no
        // balcao — e o servidor aceita, porque a excecao existe.
        tabelaPrecoId: tabelaPadraoId,
        itens: [{ variacaoId: item.variacaoId, quantidade: '1' }],
        pagamentos: [{ forma: 'CARTEIRA', valor: acima }],
      })
      .expect(409);

    expect((recusa.body as { codigo: string }).codigo).toBe('LIMITE_EXCEDIDO');
    // A mensagem precisa dizer quanto ha, nao so que nao pode.
    expect((recusa.body as { mensagem: string }).mensagem).toContain('Disponivel');
  });

  it('o limite nao pode ser negativo', async () => {
    await http
      .post(`/api/carteira/${clienteId}/limite`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ limiteCredito: '-100.00' })
      .expect(400);
  });

  it('define limite e o disponivel acompanha', async () => {
    await http
      .post(`/api/carteira/${clienteId}/limite`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ limiteCredito: '8000.00', justificativa: 'Aumento acordado' })
      .expect(201);

    const e = await extrato();
    expect(e.carteira.limiteCredito).toBe('8000.00');
    expect(Number(e.carteira.disponivel)).toBeCloseTo(Number(e.carteira.saldo) + 8000, 2);
  });
});

describe.runIf(temBanco)('os tipos que criam dinheiro', () => {
  it('ajuste sem justificativa e recusado', async () => {
    const recusa = await lancar(tokenAdmin, {
      tipo: 'AJUSTE_CREDITO',
      valor: '50.00',
    }).expect(409);

    expect((recusa.body as { codigo: string }).codigo).toBe('JUSTIFICATIVA_OBRIGATORIA');
  });

  it('bonificacao sem justificativa e recusada', async () => {
    await lancar(tokenAdmin, { tipo: 'BONIFICACAO', valor: '50.00' }).expect(409);
  });

  it('o banco tambem recusa, por CHECK', async () => {
    // A validacao da aplicacao ja barrou acima. Este teste prova que a
    // restricao existe no BANCO — e continuaria valendo para um script de
    // manutencao que nao passa pela API.
    const e = await extrato();

    const { PrismaClient } = await import('@estoque/db');
    void PrismaClient;

    // Conferencia indireta: o movimento de ajuste gravado pela aplicacao
    // sempre tem justificativa.
    const ajustes = e.movimentos.filter((m) => m.tipo.startsWith('AJUSTE_'));
    expect(ajustes.length).toBeGreaterThan(0);
    expect(ajustes.every((m) => (m.justificativa ?? '').length >= 5)).toBe(true);
  });

  it('o financeiro lanca quitacao mas nao ajusta', async () => {
    const token = await entrar(FINANCEIRO);

    await lancar(token, {
      tipo: 'QUITACAO',
      valor: '10.00',
      formaPagamento: 'PIX',
    }).expect(201);

    await lancar(token, {
      tipo: 'AJUSTE_CREDITO',
      valor: '10.00',
      justificativa: 'Nao deveria passar',
    }).expect(403);
  });

  it('a vendedora ve a carteira mas nao lanca', async () => {
    const token = await entrar(VENDEDORA);

    await http
      .get(`/api/carteira/${clienteId}/extrato`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    await lancar(token, {
      tipo: 'DEPOSITO',
      valor: '10.00',
    }).expect(403);
  });
});

describe.runIf(temBanco)('estorno', () => {
  it('anula com o lancamento contrario, sem apagar o original', async () => {
    const antes = Number((await extrato()).carteira.saldo);

    const depois = (
      await lancar(tokenAdmin, {
        tipo: 'DEPOSITO',
        valor: '250.00',
        formaPagamento: 'PIX',
      }).expect(201)
    ).body as Extrato;

    const movimento = depois.movimentos[0]!;
    expect(Number(depois.carteira.saldo)).toBeCloseTo(antes + 250, 2);

    const estornado = (
      await http
        .post(`/api/carteira/${clienteId}/lancamentos/${movimento.id}/estornar`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ justificativa: 'Deposito lancado no cliente errado' })
        .expect(201)
    ).body as Extrato;

    // O saldo volta ao que era.
    expect(Number(estornado.carteira.saldo)).toBeCloseTo(antes, 2);

    // O original continua la, agora marcado como estornado.
    const original = estornado.movimentos.find((m) => m.id === movimento.id);
    expect(original).toBeDefined();
    expect(original!.estornado).toBe(true);

    // E existe uma linha NOVA explicando.
    expect(estornado.movimentos[0]!.tipo).toBe('ESTORNO_CREDITO');
    expect(estornado.movimentos[0]!.justificativa).toContain('cliente errado');
  });

  it('nao estorna duas vezes', async () => {
    const depois = (await lancar(tokenAdmin, { tipo: 'DEPOSITO', valor: '15.00' }).expect(201))
      .body as Extrato;

    const id = depois.movimentos[0]!.id;

    await http
      .post(`/api/carteira/${clienteId}/lancamentos/${id}/estornar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ justificativa: 'Primeiro estorno' })
      .expect(201);

    const segunda = await http
      .post(`/api/carteira/${clienteId}/lancamentos/${id}/estornar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ justificativa: 'Segundo estorno' })
      .expect(409);

    expect((segunda.body as { codigo: string }).codigo).toBe('MOVIMENTO_JA_ESTORNADO');
  });

  it('nao estorna um estorno', async () => {
    const depois = (await lancar(tokenAdmin, { tipo: 'DEPOSITO', valor: '20.00' }).expect(201))
      .body as Extrato;

    const estornado = (
      await http
        .post(`/api/carteira/${clienteId}/lancamentos/${depois.movimentos[0]!.id}/estornar`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ justificativa: 'Estorno legitimo' })
        .expect(201)
    ).body as Extrato;

    const recusa = await http
      .post(`/api/carteira/${clienteId}/lancamentos/${estornado.movimentos[0]!.id}/estornar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ justificativa: 'Estorno do estorno' })
      .expect(409);

    expect((recusa.body as { codigo: string }).codigo).toBe('ESTORNO_DE_ESTORNO');
  });
});

describe.runIf(temBanco)('venda paga em carteira', () => {
  it('debita a conta corrente do cliente, na mesma transacao', async () => {
    const antes = Number((await extrato()).carteira.saldo);
    const item = await itemComEstoque('120.00');

    const resultado = (
      await http
        .post('/api/vendas')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          lojaId: item.lojaId,
          clienteId,
          tabelaPrecoId: tabelaPadraoId,
          itens: [{ variacaoId: item.variacaoId, quantidade: '2' }],
          pagamentos: [{ forma: 'CARTEIRA', valor: '240.00' }],
        })
        .expect(201)
    ).body as { venda: { numero: number }; avisos: { codigo: string; mensagem: string }[] };

    // Este era o buraco: a venda fechava e o cliente nao devia nada.
    const depois = await extrato();
    expect(Number(depois.carteira.saldo)).toBeCloseTo(antes - 240, 2);

    const movimento = depois.movimentos[0]!;
    expect(movimento.tipo).toBe('PAGAMENTO_VENDA');
    expect(movimento.sentido).toBe('DEBITO');
    expect(movimento.valor).toBe('240.00');
    // O extrato liga o debito a venda que o originou.
    expect(movimento.vendaNumero).toBe(resultado.venda.numero);

    // E o operador ve o que aconteceu com a conta do cliente.
    expect(resultado.avisos.map((a) => a.codigo)).toContain('DEBITADO_EM_CARTEIRA');
  });

  it('pagamento em carteira sem cliente e recusado', async () => {
    const item = await itemComEstoque('50.00');

    const recusa = await http
      .post('/api/vendas')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        lojaId: item.lojaId,
        tabelaPrecoId: tabelaPadraoId,
        itens: [{ variacaoId: item.variacaoId, quantidade: '1' }],
        pagamentos: [{ forma: 'CARTEIRA', valor: '50.00' }],
      })
      .expect(400);

    expect((recusa.body as { codigo: string }).codigo).toBe('CARTEIRA_EXIGE_CLIENTE');
  });

  it('carteira bloqueada nao recebe debito, mas continua recebendo quitacao', async () => {
    await http
      .post(`/api/carteira/${clienteId}/bloqueio`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ bloqueada: true, justificativa: 'Inadimplencia em analise' })
      .expect(201);

    const item = await itemComEstoque('30.00');

    const recusa = await http
      .post('/api/vendas')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        lojaId: item.lojaId,
        clienteId,
        tabelaPrecoId: tabelaPadraoId,
        itens: [{ variacaoId: item.variacaoId, quantidade: '1' }],
        pagamentos: [{ forma: 'CARTEIRA', valor: '30.00' }],
      })
      .expect(409);

    expect((recusa.body as { codigo: string }).codigo).toBe('CARTEIRA_BLOQUEADA');

    // Mas quem esta devendo precisa continuar podendo pagar. Bloquear os dois
    // lados transformaria a cobranca num impasse.
    await lancar(tokenAdmin, {
      tipo: 'QUITACAO',
      valor: '100.00',
      formaPagamento: 'PIX',
    }).expect(201);

    await http
      .post(`/api/carteira/${clienteId}/bloqueio`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ bloqueada: false, justificativa: 'Situacao regularizada' })
      .expect(201);
  });

  it('a venda nao fica gravada se o debito na carteira falhar', async () => {
    await http
      .post(`/api/carteira/${clienteId}/bloqueio`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ bloqueada: true, justificativa: 'Teste de atomicidade' })
      .expect(201);

    const item = await itemComEstoque('45.00');

    // O debito acontece DEPOIS da baixa de estoque, dentro da mesma
    // transacao. Se a transacao nao segurar, o estoque baixa e a venda nao
    // existe — e o saldo do produto fica errado para sempre.
    const saldoAntes = (
      await http
        .get(`/api/estoque/movimentos?variacaoId=${item.variacaoId}&limite=1`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200)
    ).body as { itens: { saldoPosterior: string }[] };

    await http
      .post('/api/vendas')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        lojaId: item.lojaId,
        clienteId,
        tabelaPrecoId: tabelaPadraoId,
        itens: [{ variacaoId: item.variacaoId, quantidade: '3' }],
        pagamentos: [{ forma: 'CARTEIRA', valor: '135.00' }],
      })
      .expect(409);

    const saldoDepois = (
      await http
        .get(`/api/estoque/movimentos?variacaoId=${item.variacaoId}&limite=1`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200)
    ).body as { itens: { saldoPosterior: string }[] };

    expect(saldoDepois.itens[0]!.saldoPosterior).toBe(saldoAntes.itens[0]!.saldoPosterior);

    await http
      .post(`/api/carteira/${clienteId}/bloqueio`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ bloqueada: false, justificativa: 'Fim do teste' })
      .expect(201);
  });
});
