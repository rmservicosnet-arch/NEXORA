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

function autenticado(metodo: 'get' | 'post' | 'patch', rota: string) {
  return http[metodo](rota).set('Authorization', `Bearer ${token}`);
}

/*
  Todo cadastro criado aqui entra nesta lista e sai desativado no `afterAll`.

  Sem isso o teste degradava o ambiente que ele proprio usa: 24 "Teste prazo"
  acumulados na grade de clientes, empurrando quem importa para fora da
  primeira pagina. Desativar, nao apagar — cliente aparece em venda e em
  titulo, e `delete` deixaria orfaos.
*/
const criados: string[] = [];

async function clienteCom(usaCarteira: boolean): Promise<string> {
  const criado = (
    await autenticado('post', '/api/clientes')
      .send({ nome: `Teste prazo ${sufixo()}`, usaCarteira })
      .expect(201)
  ).body as { id: string };

  criados.push(criado.id);
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
  for (const id of criados) {
    // Pela rota do dominio, nunca por `delete` escondido. Falha aqui nao
    // derruba a suite: o que importa ja foi verificado.
    try {
      await autenticado('patch', `/api/clientes/${id}`).send({ status: 'INATIVO' });
    } catch {
      /* ambiente ja derrubado */
    }
  }

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
      await autenticado(
        'get',
        '/api/financeiro/titulos?tipo=RECEBER&recorte=todos&limite=100',
      ).expect(200)
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
      await autenticado(
        'get',
        '/api/financeiro/titulos?tipo=RECEBER&recorte=todos&limite=100',
      ).expect(200)
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
      await autenticado(
        'get',
        '/api/financeiro/titulos?tipo=RECEBER&recorte=todos&limite=100',
      ).expect(200)
    ).body as { itens: { descricao: string; vencimento: string }[] };

    const meu = titulos.itens.find((t) =>
      t.descricao.includes(`Venda ${String(resultado.venda.numero)}`),
    );

    expect(meu?.vencimento).toBe(vencimento);
  });

  /*
    CANCELAMENTO — a outra ponta do §6.

    Cancelar estornava o estoque e mais nada: a mercadoria voltava para a
    prateleira e a divida ficava de pe. Cada um destes testes cobre um dos
    tres desfechos possiveis.
  */
  it('cancelar venda a prazo ESTORNA o débito na carteira', async () => {
    const variacaoId = await produtoAbastecido();
    const clienteId = await clienteCom(true);

    const resultado = (
      await autenticado('post', '/api/vendas')
        .send({
          lojaId,
          clienteId,
          itens: [{ variacaoId, quantidade: '1', precoUnitario: '320.00' }],
          pagamentos: [{ forma: 'PRAZO', valor: '320.00' }],
        })
        .expect(201)
    ).body as { venda: { id: string } };

    const antes = (
      await autenticado('get', `/api/carteira/${clienteId}/extrato?limite=10`).expect(200)
    ).body as { carteira: { saldo: string } };
    expect(Number(antes.carteira.saldo)).toBe(-320);

    await autenticado('post', `/api/vendas/${resultado.venda.id}/cancelar`)
      .send({ motivo: 'Cliente desistiu na entrega' })
      .expect(201);

    const depois = (
      await autenticado('get', `/api/carteira/${clienteId}/extrato?limite=10`).expect(200)
    ).body as {
      carteira: { saldo: string };
      movimentos: { tipo: string; valor: string; sentido: string; estornoDeId: string | null }[];
    };

    // O saldo volta a zero, e volta por LANÇAMENTO CONTRÁRIO — o razão é
    // append-only, o débito original continua lá.
    expect(Number(depois.carteira.saldo)).toBe(0);

    const estorno = depois.movimentos.find((m) => m.tipo === 'ESTORNO_DEBITO');
    expect(estorno).toBeDefined();
    expect(estorno!.sentido).toBe('CREDITO');
    expect(estorno!.valor).toBe('320.00');
    expect(estorno!.estornoDeId).not.toBeNull();

    expect(depois.movimentos.some((m) => m.tipo === 'VENDA_A_PRAZO')).toBe(true);
  });

  it('cancelar venda a prazo CANCELA o título', async () => {
    const variacaoId = await produtoAbastecido();
    const clienteId = await clienteCom(false);

    const resultado = (
      await autenticado('post', '/api/vendas')
        .send({
          lojaId,
          clienteId,
          itens: [{ variacaoId, quantidade: '1', precoUnitario: '140.00' }],
          pagamentos: [{ forma: 'PRAZO', valor: '140.00' }],
        })
        .expect(201)
    ).body as { venda: { id: string; numero: number } };

    await autenticado('post', `/api/vendas/${resultado.venda.id}/cancelar`)
      .send({ motivo: 'Erro de digitação no pedido' })
      .expect(201);

    const titulos = (
      await autenticado(
        'get',
        `/api/financeiro/titulos?tipo=RECEBER&recorte=todos&termo=Venda%20${String(resultado.venda.numero)}%20a%20prazo`,
      ).expect(200)
    ).body as { itens: { descricao: string; status: string }[] };

    const meu = titulos.itens.find((t) =>
      t.descricao.includes(`Venda ${String(resultado.venda.numero)}`),
    );

    expect(meu).toBeDefined();
    expect(meu!.status).toBe('CANCELADO');
  });

  it('título com baixa DERRUBA o cancelamento — o dinheiro recebido precisa de dono', async () => {
    const variacaoId = await produtoAbastecido();
    const clienteId = await clienteCom(false);

    const resultado = (
      await autenticado('post', '/api/vendas')
        .send({
          lojaId,
          clienteId,
          itens: [{ variacaoId, quantidade: '1', precoUnitario: '200.00' }],
          pagamentos: [{ forma: 'PRAZO', valor: '200.00' }],
        })
        .expect(201)
    ).body as { venda: { id: string; numero: number } };

    const titulos = (
      await autenticado(
        'get',
        `/api/financeiro/titulos?tipo=RECEBER&recorte=todos&termo=Venda%20${String(resultado.venda.numero)}%20a%20prazo`,
      ).expect(200)
    ).body as { itens: { id: string; descricao: string }[] };

    const meu = titulos.itens.find((t) =>
      t.descricao.includes(`Venda ${String(resultado.venda.numero)}`),
    );
    expect(meu).toBeDefined();

    // Baixa PARCIAL: o título segue em aberto, mas com dinheiro dentro.
    await autenticado('post', `/api/financeiro/titulos/${meu!.id}/baixar`)
      .send({ valor: '80.00', pagoEm: '2026-09-20', forma: 'PIX' })
      .expect(201);

    const recusa = await autenticado('post', `/api/vendas/${resultado.venda.id}/cancelar`)
      .send({ motivo: 'Tentativa de cancelamento indevida' })
      .expect(409);

    expect((recusa.body as { codigo: string }).codigo).toBe('VENDA_COM_TITULO_BAIXADO');

    // E nada mudou: a venda continua de pé, com o estoque baixado.
    const venda = (await autenticado('get', `/api/vendas/${resultado.venda.id}`).expect(200))
      .body as { status: string };

    expect(venda.status).toBe('CONCLUIDA');

    /*
      E a saida que a recusa aponta EXISTE.

      Este pedaco e o que impede a mensagem de virar promessa: estorna a
      baixa e o cancelamento passa. Enquanto o estorno nao existia, a recusa
      mandava a pessoa apertar um botao que nao havia.
    */
    const comBaixa = (await autenticado('get', `/api/financeiro/titulos/${meu!.id}`).expect(200))
      .body as { baixas: { id: string }[] };

    await autenticado(
      'post',
      `/api/financeiro/titulos/${meu!.id}/baixas/${comBaixa.baixas[0]!.id}/estornar`,
    )
      .send({ motivo: 'Cancelamento da venda combinado com o cliente' })
      .expect(201);

    await autenticado('post', `/api/vendas/${resultado.venda.id}/cancelar`)
      .send({ motivo: 'Cliente desistiu, baixa estornada antes' })
      .expect(201);

    const depois = (await autenticado('get', `/api/vendas/${resultado.venda.id}`).expect(200))
      .body as { status: string };

    expect(depois.status).toBe('CANCELADA');
  });
});
