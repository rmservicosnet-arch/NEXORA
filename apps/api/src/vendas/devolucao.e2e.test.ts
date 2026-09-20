import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../app.module';

/**
 * DEVOLUCAO PARCIAL.
 *
 * `venda_item.quantidade_devolvida` estava no banco desde o inicio,
 * `DEVOLVIDA_PARCIAL` e `DEVOLVIDA_TOTAL` estavam no enum de status e
 * `venda.devolver` estava no perfil do VENDEDOR — e nada usava nenhum dos
 * tres. Devolver dois de dez so era possivel cancelando a venda inteira, o
 * que apaga o faturamento e o resto da mercadoria, que continua com o
 * cliente.
 *
 * O que estes testes fixam e a CASCATA do dinheiro: abate o que o cliente
 * ainda deve antes de devolver o que ele ja pagou.
 */
const temBanco = Boolean(process.env['DATABASE_URL'] && process.env['DIRECT_URL']);
const ADMIN = { email: 'rodrigo@lojacentro.com.br', senha: 'Estoque@2026' };

let app: INestApplication;
let http: ReturnType<typeof request>;
let token: string;
let lojaId: string;
let localId: string;

/** Cadastros criados aqui. Saem DESATIVADOS, nunca apagados. */
const criados: string[] = [];

/**
 * Numeros das vendas a prazo criadas aqui.
 *
 * Cada uma deixa um titulo a receber ABERTO. Sem limpar, "Venda 349 a prazo"
 * se acumula na grade de Contas e empurra os titulos de verdade para fora da
 * primeira pagina — e foi um desses acumulos que quebrou um teste vizinho
 * que procurava numa pagina de 100.
 */
const vendasAPrazo: number[] = [];

function sufixo(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function autenticado(metodo: 'get' | 'post' | 'patch', rota: string) {
  return http[metodo](rota).set('Authorization', `Bearer ${token}`);
}

interface VendaCriada {
  venda: { id: string; numero: number };
}

interface Venda {
  id: string;
  status: string;
  itens: { id: string; quantidade: string; quantidadeDevolvida: string; totalItem: string }[];
}

interface Devolucao {
  venda: Venda;
  valorDevolvido: string;
  destinos: { onde: string; valor: string; descricao: string }[];
}

async function cliente(usaCarteira: boolean): Promise<string> {
  const criado = (
    await autenticado('post', '/api/clientes')
      .send({ nome: `Devolucao ${sufixo()}`, usaCarteira })
      .expect(201)
  ).body as { id: string };

  criados.push(criado.id);
  return criado.id;
}

/** Abastece um item para a venda nao esbarrar em saldo, e devolve a variacao. */
async function itemAbastecido(): Promise<string> {
  const itens = (
    await autenticado('get', `/api/vendas/itens?lojaId=${lojaId}&limite=30`).expect(200)
  ).body as { variacaoId: string }[];

  const item = itens[0];
  if (!item) throw new Error('seed sem item vendável');

  await autenticado('post', '/api/estoque/entrada')
    .send({
      lojaId,
      localId,
      variacaoId: item.variacaoId,
      quantidade: '50',
      custoUnitario: '10.00',
      tipo: 'ENTRADA_COMPRA',
    })
    .expect(201);

  return item.variacaoId;
}

/**
 * O saldo sai do RAZAO, que e onde ele vive: `saldoPosterior` do ultimo
 * movimento daquele item naquele local. Somar entradas e saidas por fora
 * seria recalcular o que o razao ja encadeia.
 */
async function saldo(variacaoId: string): Promise<number> {
  const pagina = (
    await autenticado(
      'get',
      `/api/estoque/movimentos?localId=${localId}&variacaoId=${variacaoId}&limite=1`,
    ).expect(200)
  ).body as { itens: { saldoPosterior: string }[] };

  return Number(pagina.itens[0]?.saldoPosterior ?? 0);
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
  if (app) {
    // Pelas acoes do dominio: titulo em aberto se CANCELA, cadastro se
    // DESATIVA. Nunca um `delete` escondido.
    for (const numero of vendasAPrazo) {
      const titulos = (
        await autenticado(
          'get',
          `/api/financeiro/titulos?tipo=RECEBER&recorte=abertos&termo=Venda%20${String(numero)}%20a%20prazo`,
        )
      ).body as { itens?: { id: string; descricao: string }[] };

      for (const t of titulos.itens ?? []) {
        if (!t.descricao.includes(`Venda ${String(numero)} a prazo`)) continue;
        await autenticado('post', `/api/financeiro/titulos/${t.id}/cancelar`).send({
          motivo: 'Limpeza do teste de ponta a ponta',
        });
      }
    }

    for (const id of criados) {
      await autenticado('patch', `/api/clientes/${id}`).send({ status: 'INATIVO' });
    }

    await app.close();
  }
}, 60_000);

describe.runIf(temBanco)('devolução parcial', () => {
  it('a mercadoria volta ao estoque e a venda passa a DEVOLVIDA_PARCIAL', async () => {
    const variacaoId = await itemAbastecido();
    const clienteId = await cliente(false);
    const antes = await saldo(variacaoId);

    const criada = (
      await autenticado('post', '/api/vendas')
        .send({
          lojaId,
          clienteId,
          itens: [{ variacaoId, quantidade: '10', precoUnitario: '20.00' }],
          pagamentos: [{ forma: 'PRAZO', valor: '200.00' }],
        })
        .expect(201)
    ).body as VendaCriada;

    if (criada.venda.numero) vendasAPrazo.push(criada.venda.numero);

    expect(await saldo(variacaoId)).toBe(antes - 10);

    const detalhe = (await autenticado('get', `/api/vendas/${criada.venda.id}`).expect(200))
      .body as Venda;

    const devolucao = (
      await autenticado('post', `/api/vendas/${criada.venda.id}/devolucoes`)
        .send({
          motivo: 'Dois kimonos vieram com defeito de costura',
          itens: [{ itemId: detalhe.itens[0]!.id, quantidade: '2' }],
        })
        .expect(201)
    ).body as Devolucao;

    // Só as duas unidades voltam: as outras oito continuam com o cliente.
    expect(await saldo(variacaoId)).toBe(antes - 8);
    expect(devolucao.valorDevolvido).toBe('40.00');
    expect(devolucao.venda.status).toBe('DEVOLVIDA_PARCIAL');
    expect(devolucao.venda.itens[0]!.quantidadeDevolvida).toBe('2.000000');
  });

  it('cliente SEM carteira que devia: a devolução ABATE o título', async () => {
    const variacaoId = await itemAbastecido();
    const clienteId = await cliente(false);

    const criada = (
      await autenticado('post', '/api/vendas')
        .send({
          lojaId,
          clienteId,
          itens: [{ variacaoId, quantidade: '5', precoUnitario: '60.00' }],
          pagamentos: [{ forma: 'PRAZO', valor: '300.00' }],
        })
        .expect(201)
    ).body as VendaCriada;

    if (criada.venda.numero) vendasAPrazo.push(criada.venda.numero);

    const detalhe = (await autenticado('get', `/api/vendas/${criada.venda.id}`).expect(200))
      .body as Venda;

    const devolucao = (
      await autenticado('post', `/api/vendas/${criada.venda.id}/devolucoes`)
        .send({
          motivo: 'Cliente levou um a mais por engano',
          itens: [{ itemId: detalhe.itens[0]!.id, quantidade: '1' }],
        })
        .expect(201)
    ).body as Devolucao;

    /*
      Devolver dinheiro a quem ainda não pagou seria pagar duas vezes: o
      destino é o título, e só ele.
    */
    expect(devolucao.destinos).toHaveLength(1);
    expect(devolucao.destinos[0]!.onde).toBe('TITULO');
    expect(devolucao.destinos[0]!.valor).toBe('60.00');

    const titulos = (
      await autenticado(
        'get',
        `/api/financeiro/titulos?tipo=RECEBER&recorte=todos&termo=Venda%20${String(criada.venda.numero)}%20a%20prazo`,
      ).expect(200)
    ).body as { itens: { descricao: string; valor: string; emAberto: string }[] };

    const meu = titulos.itens.find((t) =>
      t.descricao.includes(`Venda ${String(criada.venda.numero)}`),
    );

    // O valor de FACE diminui: não houve baixa, porque não entrou dinheiro.
    expect(meu?.valor).toBe('240.00');
    expect(meu?.emAberto).toBe('240.00');
  });

  it('cliente COM carteira que devia: a devolução abate o DÉBITO da carteira', async () => {
    const variacaoId = await itemAbastecido();
    const clienteId = await cliente(true);

    const criada = (
      await autenticado('post', '/api/vendas')
        .send({
          lojaId,
          clienteId,
          itens: [{ variacaoId, quantidade: '4', precoUnitario: '50.00' }],
          pagamentos: [{ forma: 'PRAZO', valor: '200.00' }],
        })
        .expect(201)
    ).body as VendaCriada;

    if (criada.venda.numero) vendasAPrazo.push(criada.venda.numero);

    const detalhe = (await autenticado('get', `/api/vendas/${criada.venda.id}`).expect(200))
      .body as Venda;

    const devolucao = (
      await autenticado('post', `/api/vendas/${criada.venda.id}/devolucoes`)
        .send({
          motivo: 'Tamanho errado, trocado por outro depois',
          itens: [{ itemId: detalhe.itens[0]!.id, quantidade: '2' }],
        })
        .expect(201)
    ).body as Devolucao;

    expect(devolucao.destinos[0]!.onde).toBe('CARTEIRA');
    expect(devolucao.destinos[0]!.valor).toBe('100.00');

    const extrato = (
      await autenticado('get', `/api/carteira/${clienteId}/extrato?limite=10`).expect(200)
    ).body as {
      carteira: { saldo: string };
      movimentos: { tipo: string; valor: string; sentido: string }[];
    };

    // Devia 200, voltou 100: deve 100. E o tipo diz o que foi.
    expect(Number(extrato.carteira.saldo)).toBe(-100);

    const credito = extrato.movimentos.find((m) => m.tipo === 'DEVOLUCAO_VENDA');
    expect(credito).toBeDefined();
    expect(credito!.sentido).toBe('CREDITO');
    expect(credito!.valor).toBe('100.00');
  });

  it('venda em DINHEIRO: a devolução sai da gaveta e aparece na conferência', async () => {
    const variacaoId = await itemAbastecido();

    const meu = (await autenticado('get', `/api/caixa/meu?lojaId=${lojaId}`).expect(200)).body as {
      caixa: { id: string } | null;
    };

    const caixaId =
      meu.caixa?.id ??
      (
        (
          await autenticado('post', '/api/caixa/abrir')
            .send({ lojaId, valorAbertura: '200.00' })
            .expect(201)
        ).body as { id: string }
      ).id;

    const criada = (
      await autenticado('post', '/api/vendas')
        .send({
          lojaId,
          itens: [{ variacaoId, quantidade: '3', precoUnitario: '30.00' }],
          pagamentos: [{ forma: 'DINHEIRO', valor: '90.00' }],
        })
        .expect(201)
    ).body as VendaCriada;

    if (criada.venda.numero) vendasAPrazo.push(criada.venda.numero);

    const detalhe = (await autenticado('get', `/api/vendas/${criada.venda.id}`).expect(200))
      .body as Venda;

    const devolucao = (
      await autenticado('post', `/api/vendas/${criada.venda.id}/devolucoes`)
        .send({
          motivo: 'Cliente desistiu de uma peça no balcão',
          itens: [{ itemId: detalhe.itens[0]!.id, quantidade: '1' }],
        })
        .expect(201)
    ).body as Devolucao;

    expect(devolucao.destinos[0]!.onde).toBe('CAIXA');
    expect(devolucao.destinos[0]!.valor).toBe('30.00');

    /*
      Sangria, não um número solto: dinheiro que sai sem aparecer na
      conferência do turno vira falta no fechamento.
    */
    const caixa = (await autenticado('get', `/api/caixa/${caixaId}`).expect(200)).body as {
      movimentos: { tipo: string; valor: string; motivo: string }[];
    };

    const saida = caixa.movimentos.find(
      (m) => m.tipo === 'SANGRIA' && m.motivo.includes(`venda ${String(criada.venda.numero)}`),
    );

    expect(saida).toBeDefined();
    expect(saida!.valor).toBe('30.00');
  });

  it('devolver tudo leva a venda a DEVOLVIDA_TOTAL', async () => {
    const variacaoId = await itemAbastecido();
    const clienteId = await cliente(false);

    const criada = (
      await autenticado('post', '/api/vendas')
        .send({
          lojaId,
          clienteId,
          itens: [{ variacaoId, quantidade: '2', precoUnitario: '15.00' }],
          pagamentos: [{ forma: 'PRAZO', valor: '30.00' }],
        })
        .expect(201)
    ).body as VendaCriada;

    if (criada.venda.numero) vendasAPrazo.push(criada.venda.numero);

    const detalhe = (await autenticado('get', `/api/vendas/${criada.venda.id}`).expect(200))
      .body as Venda;

    const devolucao = (
      await autenticado('post', `/api/vendas/${criada.venda.id}/devolucoes`)
        .send({
          motivo: 'Pedido inteiro recusado na entrega',
          itens: [{ itemId: detalhe.itens[0]!.id, quantidade: '2' }],
        })
        .expect(201)
    ).body as Devolucao;

    expect(devolucao.venda.status).toBe('DEVOLVIDA_TOTAL');
  });

  it('devolver mais do que resta é recusado', async () => {
    const variacaoId = await itemAbastecido();
    const clienteId = await cliente(false);

    const criada = (
      await autenticado('post', '/api/vendas')
        .send({
          lojaId,
          clienteId,
          itens: [{ variacaoId, quantidade: '3', precoUnitario: '10.00' }],
          pagamentos: [{ forma: 'PRAZO', valor: '30.00' }],
        })
        .expect(201)
    ).body as VendaCriada;

    if (criada.venda.numero) vendasAPrazo.push(criada.venda.numero);

    const detalhe = (await autenticado('get', `/api/vendas/${criada.venda.id}`).expect(200))
      .body as Venda;

    await autenticado('post', `/api/vendas/${criada.venda.id}/devolucoes`)
      .send({
        motivo: 'Primeira devolução, correta',
        itens: [{ itemId: detalhe.itens[0]!.id, quantidade: '2' }],
      })
      .expect(201);

    const recusa = await autenticado('post', `/api/vendas/${criada.venda.id}/devolucoes`)
      .send({
        motivo: 'Segunda devolução, acima do que restou',
        itens: [{ itemId: detalhe.itens[0]!.id, quantidade: '2' }],
      })
      .expect(409);

    expect((recusa.body as { codigo: string }).codigo).toBe('DEVOLUCAO_ACIMA_DO_VENDIDO');
  });

  /*
    Cartao e PIX entram por fora da gaveta, e o estorno acontece na maquineta.
    Sem carteira onde creditar, a API RECUSA e explica — gravar o numero num
    lugar qualquer so para a operacao passar e o dinheiro sem dono que o resto
    do sistema evita.
  */
  it('venda em PIX de cliente sem carteira: recusa e explica', async () => {
    const variacaoId = await itemAbastecido();
    const clienteId = await cliente(false);

    const criada = (
      await autenticado('post', '/api/vendas')
        .send({
          lojaId,
          clienteId,
          itens: [{ variacaoId, quantidade: '2', precoUnitario: '25.00' }],
          pagamentos: [{ forma: 'PIX', valor: '50.00' }],
        })
        .expect(201)
    ).body as VendaCriada;

    if (criada.venda.numero) vendasAPrazo.push(criada.venda.numero);

    const detalhe = (await autenticado('get', `/api/vendas/${criada.venda.id}`).expect(200))
      .body as Venda;

    const recusa = await autenticado('post', `/api/vendas/${criada.venda.id}/devolucoes`)
      .send({
        motivo: 'Cliente pediu estorno no PIX',
        itens: [{ itemId: detalhe.itens[0]!.id, quantidade: '1' }],
      })
      .expect(409);

    const corpo = recusa.body as { codigo: string; mensagem: string };
    expect(corpo.codigo).toBe('DEVOLUCAO_SEM_DESTINO');
    expect(corpo.mensagem).toContain('fora do sistema');

    // E nada aconteceu: a transação inteira voltou atrás.
    const depois = (await autenticado('get', `/api/vendas/${criada.venda.id}`).expect(200))
      .body as Venda;

    expect(depois.status).toBe('CONCLUIDA');
    expect(depois.itens[0]!.quantidadeDevolvida).toBe('0.000000');
  });
});
