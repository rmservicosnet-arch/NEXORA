/**
 * Testes de ponta a ponta do pedido com confirmacao.
 *
 * O que estes testes existem para impedir:
 *
 *  1. **Quantidade vazando para o cliente.** O portal mostra
 *     disponivel/indisponivel. Nunca numero — em lugar nenhum do JSON.
 *  2. **Reserva nascendo cedo.** Pedido em espera nao trava estoque.
 *  3. **`REMOVIDO` confundido com `DEVOLVIDO`.** Um e acordo, o outro e falta.
 *     Colapsar os dois inutiliza o relatorio de ruptura.
 *  4. **Aumento confirmado sem o cliente saber.**
 *  5. **Pedido faturado sem venda**, ou o contrario.
 *
 * Pre-requisito: `npm run db:seed`.
 */

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../app.module';
import { pngSolido } from '../produtos/png.testutil';

const temBanco = Boolean(process.env['DATABASE_URL'] && process.env['DIRECT_URL']);

const ADMIN = { email: 'rodrigo@lojacentro.com.br', senha: 'Estoque@2026' };
const VENDEDORA = { email: 'marina@lojacentro.com.br', senha: 'Estoque@2026' };
const CLIENTE = { email: 'carlos@academiaippon.com.br', senha: 'Cliente@2026' };

let app: INestApplication;
let http: ReturnType<typeof request>;
let tokenAdmin: string;
let tokenCliente: string;
let loja: { id: string; localPadraoId: string | null };

interface ItemCatalogo {
  variacaoId: string;
  sku: string;
  produto: string;
  preco: string;
  disponivel: boolean;
}

interface Pedido {
  id: string;
  numero: number;
  status: string;
  valorSolicitado: string;
  valorConfirmado: string;
  diferenca: string;
  resumoAlteracao: string | null;
  vendaNumero: number | null;
  itens: {
    id: string;
    sku: string;
    origem: string;
    status: string;
    quantidadeSolicitada: string;
    quantidadeConfirmada: string;
    totalItem: string;
    motivoDevolucao: string | null;
    motivoRemocao: string | null;
    confirmadoSemSaldo: boolean;
    disponivelAgora?: string;
  }[];
  eventos: { paraStatus: string; ator: string | null; motivo: string | null }[];
}

async function entrar(rota: string, dados: { email: string; senha: string }): Promise<string> {
  const resposta = await http
    .post(rota)
    .send({ ...dados, canal: 'app' })
    .expect(200);
  return (resposta.body as { tokenAcesso: string }).tokenAcesso;
}

/**
 * Produto de verdade, do jeito que o portal exige: preco em TODAS as tabelas,
 * foto e publicado no catalogo.
 *
 * Nao e cerimonia de teste. Sem preco na tabela do cliente, o item nao existe
 * para ele; sem foto, a API recusa publicar; sem publicar, o catalogo nao
 * mostra. Um helper que pulasse essas etapas testaria um caminho que nenhum
 * cliente percorre.
 */
async function itemPublicado(preco: string, quantidade: string): Promise<string> {
  const sufixo = Math.random().toString(36).toUpperCase().slice(2, 8);

  const criado = await http
    .post('/api/produtos')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send({
      skuBase: `PED-${sufixo}`,
      nome: `Item de pedido ${sufixo}`,
      variacoes: [{ sku: `PED-${sufixo}-U`, descricao: 'unica', precoPadrao: preco }],
    })
    .expect(201);

  const produtoId = (criado.body as { id: string }).id;

  const detalhe = await http
    .get(`/api/produtos/${produtoId}`)
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .expect(200);

  const variacaoId = (detalhe.body as { variacoes: { id: string }[] }).variacoes[0]!.id;

  // Preco em todas as tabelas ativas, nao so na padrao.
  const precos = (
    await http
      .get(`/api/produtos/${produtoId}/precos`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200)
  ).body as { variacoes: { precos: { tabelaPrecoId: string }[] }[] };

  await http
    .put(`/api/produtos/${produtoId}/precos`)
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send({
      precos: precos.variacoes[0]!.precos.map((t) => ({
        variacaoId,
        tabelaPrecoId: t.tabelaPrecoId,
        preco,
      })),
    })
    .expect(200);

  // Foto: sem ela a API recusa publicar no catalogo.
  const png = pngSolido(900, 900);

  const autorizacao = (
    await http
      .post(`/api/produtos/${produtoId}/imagens/autorizar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ tipo: 'image/png', bytes: png.byteLength })
      .expect(201)
  ).body as { imagemId: string; envio: { url: string } };

  await http
    .put(autorizacao.envio.url.replace(/^https?:\/\/[^/]+/, ''))
    .set('Content-Type', 'image/png')
    .send(png)
    .expect(200);

  await http
    .post(`/api/produtos/${produtoId}/imagens/${autorizacao.imagemId}/confirmar`)
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .expect(200);

  await http
    .patch(`/api/produtos/${produtoId}`)
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send({ publicadoNoCatalogo: true })
    .expect(200);

  await http
    .post('/api/estoque/entrada')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send({
      variacaoId,
      lojaId: loja.id,
      localId: loja.localPadraoId,
      quantidade,
      custoUnitario: '1.00',
    })
    .expect(201);

  return variacaoId;
}

async function enviarPedido(itens: { variacaoId: string; quantidade: string }[]): Promise<Pedido> {
  const resposta = await http
    .post('/api/portal/pedidos')
    .set('Authorization', `Bearer ${tokenCliente}`)
    .send({ itens })
    .expect(201);

  const corpo = resposta.body as { tipo: string; pedido: Pedido };
  expect(corpo.tipo).toBe('PEDIDO');
  return corpo.pedido;
}

async function verPelaEquipe(id: string): Promise<Pedido> {
  return (
    await http.get(`/api/pedidos/${id}`).set('Authorization', `Bearer ${tokenAdmin}`).expect(200)
  ).body as Pedido;
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

  tokenAdmin = await entrar('/api/auth/login', ADMIN);
  tokenCliente = await entrar('/api/portal/auth/login', CLIENTE);

  const contexto = (
    await http.get('/api/vendas/contexto').set('Authorization', `Bearer ${tokenAdmin}`).expect(200)
  ).body as { lojas: { id: string; localPadraoId: string | null; nome: string }[] };

  // O portal atende pela PRIMEIRA loja ativa com local padrao, em ordem de
  // nome — a mesma regra do servico.
  const ordenadas = [...contexto.lojas]
    .filter((l) => l.localPadraoId !== null)
    .sort((a, b) => a.nome.localeCompare(b.nome));
  loja = ordenadas[0]!;
}, 60_000);

afterAll(async () => {
  if (app) {
    await app.close();
  }
});

describe.runIf(temBanco)('o que o cliente ve', () => {
  it('o catalogo diz disponivel ou nao — NUNCA quantidade', async () => {
    await itemPublicado('80.00', '10');

    const resposta = await http
      .get('/api/portal/pedidos/catalogo?limite=40')
      .set('Authorization', `Bearer ${tokenCliente}`)
      .expect(200);

    const itens = resposta.body as ItemCatalogo[];
    expect(itens.length).toBeGreaterThan(0);

    // `disponivel` e booleano, e a palavra "quantidade" nao aparece no corpo.
    expect(itens.every((i) => typeof i.disponivel === 'boolean')).toBe(true);
    expect(resposta.text).not.toContain('quantidade');
    expect(resposta.text).not.toContain('saldo');
  });

  it('o pedido do cliente nao carrega disponivel, e o da equipe carrega', async () => {
    const variacaoId = await itemPublicado('50.00', '10');
    const pedido = await enviarPedido([{ variacaoId, quantidade: '2' }]);

    const doCliente = await http
      .get(`/api/portal/pedidos/${pedido.id}`)
      .set('Authorization', `Bearer ${tokenCliente}`)
      .expect(200);

    // A chave nem existe no JSON. Esconder a coluna na tela e mandar o numero
    // seria o mesmo que nao ter regra.
    expect(doCliente.text).not.toContain('disponivelAgora');

    const daEquipe = await http
      .get(`/api/pedidos/${pedido.id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    expect((daEquipe.body as Pedido).itens[0]!.disponivelAgora).toBeDefined();
  });

  it('o funcionario nao entra no portal, e o cliente nao entra na fila', async () => {
    // 401, nao 403 — e e a resposta certa.
    //
    // O token nao e recusado por falta de PERMISSAO: ele e recusado na
    // autenticacao, porque a claim `aud` nao confere e a verificacao usa o
    // segredo do outro dominio. E o "estruturalmente incapaz" do ADR-009: nao
    // depende de ninguem lembrar de filtrar por tipo.
    await http.get('/api/portal/pedidos').set('Authorization', `Bearer ${tokenAdmin}`).expect(401);

    await http.get('/api/pedidos').set('Authorization', `Bearer ${tokenCliente}`).expect(401);
  });
});

describe.runIf(temBanco)('envio do pedido', () => {
  it('congela o preco e nao mexe em estoque', async () => {
    const variacaoId = await itemPublicado('100.00', '10');

    const antes = (
      await http
        .get(`/api/estoque/movimentos?variacaoId=${variacaoId}&limite=1`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200)
    ).body as { itens: { saldoPosterior: string }[] };

    const pedido = await enviarPedido([{ variacaoId, quantidade: '3' }]);

    expect(pedido.status).toBe('AGUARDANDO_CONFIRMACAO');
    expect(pedido.valorSolicitado).toBe('300.00');
    expect(pedido.itens).toHaveLength(1);
    expect(pedido.itens[0]!.origem).toBe('SOLICITADO_CLIENTE');
    expect(pedido.itens[0]!.status).toBe('PENDENTE');

    // Pedido em espera NAO reserva e NAO movimenta. docs/ORDERS.md §2.
    const depois = (
      await http
        .get(`/api/estoque/movimentos?variacaoId=${variacaoId}&limite=1`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200)
    ).body as { itens: { saldoPosterior: string }[] };

    expect(depois.itens[0]!.saldoPosterior).toBe(antes.itens[0]!.saldoPosterior);

    // E o disponivel visto pela equipe continua inteiro.
    const daEquipe = await verPelaEquipe(pedido.id);
    expect(Number(daEquipe.itens[0]!.disponivelAgora)).toBe(10);
  });

  it('o envio entra na linha do tempo', async () => {
    const variacaoId = await itemPublicado('40.00', '5');
    const pedido = await enviarPedido([{ variacaoId, quantidade: '1' }]);

    expect(pedido.eventos).toHaveLength(1);
    expect(pedido.eventos[0]!.paraStatus).toBe('AGUARDANDO_CONFIRMACAO');
    expect(pedido.eventos[0]!.ator).toContain('Carlos');
  });
});

describe.runIf(temBanco)('confirmacao', () => {
  it('confirma tudo e a reserva nasce AQUI — nao antes', async () => {
    const variacaoId = await itemPublicado('60.00', '10');
    const pedido = await enviarPedido([{ variacaoId, quantidade: '4' }]);

    const confirmado = (
      await http
        .post(`/api/pedidos/${pedido.id}/confirmar`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ itens: [{ itemId: pedido.itens[0]!.id, quantidadeConfirmada: '4' }] })
        .expect(201)
    ).body as Pedido;

    expect(confirmado.status).toBe('CONFIRMADO');
    expect(confirmado.itens[0]!.status).toBe('CONFIRMADO');

    // A reserva reduz o DISPONIVEL sem mexer no saldo fisico: reserva e
    // compromisso, nao movimentacao. docs/ORDERS.md §4.
    expect(Number(confirmado.itens[0]!.disponivelAgora)).toBe(6);

    const movimentos = (
      await http
        .get(`/api/estoque/movimentos?variacaoId=${variacaoId}&limite=5`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200)
    ).body as { itens: { tipo: string }[] };

    // Nenhum movimento de saida: nada se moveu ainda.
    expect(movimentos.itens.every((m) => m.tipo !== 'SAIDA_VENDA')).toBe(true);
  });

  it('confirmacao parcial devolve o resto, item a item', async () => {
    const variacaoId = await itemPublicado('30.00', '3');
    const pedido = await enviarPedido([{ variacaoId, quantidade: '5' }]);

    const confirmado = (
      await http
        .post(`/api/pedidos/${pedido.id}/confirmar`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          itens: [
            {
              itemId: pedido.itens[0]!.id,
              quantidadeConfirmada: '3',
              motivoDevolucao: 'So havia 3 em estoque',
            },
          ],
        })
        .expect(201)
    ).body as Pedido;

    expect(confirmado.status).toBe('CONFIRMADO_PARCIALMENTE');
    expect(confirmado.itens[0]!.quantidadeConfirmada).toBe('3');
    // O valor confirmado cai para o que sera cobrado.
    expect(confirmado.valorConfirmado).toBe('90.00');
    expect(confirmado.valorSolicitado).toBe('150.00');
  });

  it('confirmar acima do disponivel exige permissao e justificativa', async () => {
    const variacaoId = await itemPublicado('25.00', '2');
    const pedido = await enviarPedido([{ variacaoId, quantidade: '5' }]);

    // Sem justificativa, mesmo com permissao: recusa.
    const semMotivo = await http
      .post(`/api/pedidos/${pedido.id}/confirmar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ itens: [{ itemId: pedido.itens[0]!.id, quantidadeConfirmada: '5' }] })
      .expect(409);

    expect((semMotivo.body as { codigo: string }).codigo).toBe('JUSTIFICATIVA_OBRIGATORIA');

    const confirmado = (
      await http
        .post(`/api/pedidos/${pedido.id}/confirmar`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          itens: [{ itemId: pedido.itens[0]!.id, quantidadeConfirmada: '5' }],
          justificativaSemSaldo: 'Chegada prevista para amanha, cliente avisado',
        })
        .expect(201)
    ).body as Pedido;

    // Permitido quando autorizado, nunca silencioso.
    expect(confirmado.itens[0]!.confirmadoSemSaldo).toBe(true);
  });

  it('a vendedora sem pedido.confirmar_sem_saldo e recusada', async () => {
    const token = await entrar('/api/auth/login', VENDEDORA);
    const variacaoId = await itemPublicado('25.00', '1');
    const pedido = await enviarPedido([{ variacaoId, quantidade: '4' }]);

    const recusa = await http
      .post(`/api/pedidos/${pedido.id}/confirmar`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        itens: [{ itemId: pedido.itens[0]!.id, quantidadeConfirmada: '4' }],
        justificativaSemSaldo: 'Tentativa sem permissao',
      })
      .expect(409);

    expect((recusa.body as { codigo: string }).codigo).toBe('SEM_SALDO_DISPONIVEL');
  });

  it('dois pedidos disputam a ultima peca: o primeiro a confirmar leva', async () => {
    const variacaoId = await itemPublicado('45.00', '1');

    const primeiro = await enviarPedido([{ variacaoId, quantidade: '1' }]);
    const segundo = await enviarPedido([{ variacaoId, quantidade: '1' }]);

    // Consequencia ACEITA de nao reservar na solicitacao. docs/ORDERS.md §2.
    await http
      .post(`/api/pedidos/${primeiro.id}/confirmar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ itens: [{ itemId: primeiro.itens[0]!.id, quantidadeConfirmada: '1' }] })
      .expect(201);

    const token = await entrar('/api/auth/login', VENDEDORA);

    const recusa = await http
      .post(`/api/pedidos/${segundo.id}/confirmar`)
      .set('Authorization', `Bearer ${token}`)
      .send({ itens: [{ itemId: segundo.itens[0]!.id, quantidadeConfirmada: '1' }] })
      .expect(409);

    expect((recusa.body as { codigo: string }).codigo).toBe('SEM_SALDO_DISPONIVEL');
  });
});

describe.runIf(temBanco)('a equipe edita o pedido', () => {
  it('remover NAO e devolver — e a diferenca importa', async () => {
    const a = await itemPublicado('100.00', '10');
    const b = await itemPublicado('50.00', '10');
    const pedido = await enviarPedido([
      { variacaoId: a, quantidade: '1' },
      { variacaoId: b, quantidade: '1' },
    ]);

    const removido = (
      await http
        .post(`/api/pedidos/${pedido.id}/itens/${pedido.itens[1]!.id}/remover`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ motivo: 'Sem previsao de reposicao — combinado por telefone' })
        .expect(201)
    ).body as Pedido;

    const item = removido.itens.find((i) => i.id === pedido.itens[1]!.id)!;

    // REMOVIDO = houve acordo. DEVOLVIDO = faltou saldo. Colapsar os dois
    // inutilizaria o relatorio de ruptura. docs/ORDERS.md §6.
    expect(item.status).toBe('REMOVIDO');
    expect(item.motivoRemocao).toContain('telefone');
    expect(item.motivoDevolucao).toBeNull();

    // A remocao e LOGICA: o item continua na linha, fora da conta.
    expect(removido.itens).toHaveLength(2);
    expect(removido.valorConfirmado).toBe('100.00');
    expect(removido.valorSolicitado).toBe('150.00');
  });

  it('item incluido pela equipe entra com solicitada ZERO', async () => {
    const a = await itemPublicado('100.00', '10');
    const b = await itemPublicado('40.00', '10');
    const pedido = await enviarPedido([{ variacaoId: a, quantidade: '1' }]);

    const comExtra = (
      await http
        .post(`/api/pedidos/${pedido.id}/itens`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ variacaoId: b, quantidade: '1', motivo: 'Cliente pediu por telefone' })
        .expect(201)
    ).body as Pedido;

    const incluido = comExtra.itens.find((i) => i.origem === 'ADICIONADO_EQUIPE')!;

    // O cliente NAO pediu aquilo. O relatorio depende dessa distincao.
    expect(incluido.quantidadeSolicitada).toBe('0');
    expect(incluido.quantidadeConfirmada).toBe('1');
  });

  it('total que SOBE para e espera o aceite do cliente', async () => {
    const a = await itemPublicado('100.00', '10');
    const b = await itemPublicado('80.00', '10');
    const pedido = await enviarPedido([{ variacaoId: a, quantidade: '1' }]);

    const depois = (
      await http
        .post(`/api/pedidos/${pedido.id}/itens`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ variacaoId: b, quantidade: '1', motivo: 'Combinado por telefone' })
        .expect(201)
    ).body as Pedido;

    // Confirmar acima do enviado sem registro de que o cliente concordou
    // deixa a loja sem defesa numa contestacao. docs/ORDERS.md §6.
    expect(depois.status).toBe('AGUARDANDO_ACEITE_CLIENTE');
    expect(depois.valorConfirmado).toBe('180.00');
    expect(depois.diferenca).toBe('80.00');

    // A equipe nao consegue confirmar enquanto o cliente nao aceita.
    await http
      .post(`/api/pedidos/${pedido.id}/confirmar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ itens: [{ itemId: depois.itens[0]!.id, quantidadeConfirmada: '1' }] })
      .expect(409);

    const aceito = (
      await http
        .post(`/api/portal/pedidos/${pedido.id}/aceite`)
        .set('Authorization', `Bearer ${tokenCliente}`)
        .send({ aceita: true })
        .expect(201)
    ).body as Pedido;

    // O aceite NAO confirma nem reserva: ele autoriza o valor.
    expect(aceito.status).toBe('AGUARDANDO_CONFIRMACAO');
    expect(aceito.aceiteClienteEm).not.toBeNull();
  });

  /**
   * A negociacao que nao tinha caminho.
   *
   * Havia como incluir item e como remover item, e nao havia como mudar dois
   * para cinco. A unica saida era incluir uma segunda linha do mesmo SKU.
   */
  it('aumentar a quantidade de um item pede o aceite do cliente', async () => {
    const a = await itemPublicado('100.00', '10');
    const pedido = await enviarPedido([{ variacaoId: a, quantidade: '2' }]);

    expect(pedido.valorSolicitado).toBe('200.00');

    const maior = (
      await http
        .post(`/api/pedidos/${pedido.id}/itens/${pedido.itens[0]!.id}/quantidade`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ quantidade: '5', motivo: 'Cliente aumentou por telefone' })
        .expect(201)
    ).body as Pedido;

    const item = maior.itens[0]!;

    // `quantidadeSolicitada` e a referencia congelada: reescreve-la faria o
    // aumento desaparecer na comparacao.
    expect(item.quantidadeSolicitada).toBe('2');
    expect(item.quantidadeConfirmada).toBe('5');
    expect(maior.valorSolicitado).toBe('200.00');
    expect(maior.valorConfirmado).toBe('500.00');
    expect(maior.status).toBe('AGUARDANDO_ACEITE_CLIENTE');
  });

  /**
   * O teto da confirmacao e o ACORDADO, nao o enviado.
   *
   * Antes, o pedido subia de dois para cinco, o cliente tocava em "aceito" e
   * a confirmacao respondia "nao da para confirmar mais do que foi pedido".
   */
  it('depois do aceite, a equipe confirma a quantidade acordada', async () => {
    const a = await itemPublicado('100.00', '10');
    const pedido = await enviarPedido([{ variacaoId: a, quantidade: '2' }]);

    await http
      .post(`/api/pedidos/${pedido.id}/itens/${pedido.itens[0]!.id}/quantidade`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ quantidade: '5', motivo: 'Cliente aumentou por telefone' })
      .expect(201);

    await http
      .post(`/api/portal/pedidos/${pedido.id}/aceite`)
      .set('Authorization', `Bearer ${tokenCliente}`)
      .send({ aceita: true })
      .expect(201);

    const confirmado = (
      await http
        .post(`/api/pedidos/${pedido.id}/confirmar`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ itens: [{ itemId: pedido.itens[0]!.id, quantidadeConfirmada: '5' }] })
        .expect(201)
    ).body as Pedido;

    expect(confirmado.status).toBe('CONFIRMADO');
    expect(confirmado.itens[0]!.quantidadeConfirmada).toBe('5');
  });

  /** O teto continua existindo: sem ele, um dedo errado infla o pedido. */
  it('confirmar acima do acordado continua recusado', async () => {
    const a = await itemPublicado('100.00', '10');
    const pedido = await enviarPedido([{ variacaoId: a, quantidade: '2' }]);

    const recusa = await http
      .post(`/api/pedidos/${pedido.id}/confirmar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ itens: [{ itemId: pedido.itens[0]!.id, quantidadeConfirmada: '9' }] })
      .expect(400);

    expect((recusa.body as { codigo: string }).codigo).toBe('CONFIRMOU_MAIS_QUE_O_ACORDADO');
  });

  /** Reduzir nao tira dinheiro do cliente: segue sem pedir aceite. */
  it('reduzir a quantidade nao pede aceite', async () => {
    const a = await itemPublicado('100.00', '10');
    const pedido = await enviarPedido([{ variacaoId: a, quantidade: '4' }]);

    const menor = (
      await http
        .post(`/api/pedidos/${pedido.id}/itens/${pedido.itens[0]!.id}/quantidade`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ quantidade: '1', motivo: 'Cliente reduziu por telefone' })
        .expect(201)
    ).body as Pedido;

    expect(menor.status).toBe('AGUARDANDO_CONFIRMACAO');
    expect(menor.valorConfirmado).toBe('100.00');
  });

  it('item removido nao volta por ajuste de quantidade', async () => {
    const a = await itemPublicado('100.00', '10');
    const b = await itemPublicado('50.00', '10');
    const pedido = await enviarPedido([
      { variacaoId: a, quantidade: '1' },
      { variacaoId: b, quantidade: '1' },
    ]);

    await http
      .post(`/api/pedidos/${pedido.id}/itens/${pedido.itens[1]!.id}/remover`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ motivo: 'Combinado por telefone com o cliente' })
      .expect(201);

    // Quem removeu escreveu um motivo. Desfazer isso e outra decisao.
    const recusa = await http
      .post(`/api/pedidos/${pedido.id}/itens/${pedido.itens[1]!.id}/quantidade`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ quantidade: '3', motivo: 'Tentando ressuscitar o item' })
      .expect(409);

    expect((recusa.body as { codigo: string }).codigo).toBe('ITEM_REMOVIDO');
  });

  /** Token do outro dominio da 401, nao 403: falha na autenticacao. ADR-009. */
  it('o cliente nao ajusta a quantidade pela rota da equipe', async () => {
    const a = await itemPublicado('100.00', '10');
    const pedido = await enviarPedido([{ variacaoId: a, quantidade: '2' }]);

    await http
      .post(`/api/pedidos/${pedido.id}/itens/${pedido.itens[0]!.id}/quantidade`)
      .set('Authorization', `Bearer ${tokenCliente}`)
      .send({ quantidade: '3', motivo: 'Aumentando por conta propria' })
      .expect(401);
  });

  it('o cliente pode recusar o novo valor, e o pedido volta a equipe', async () => {
    const a = await itemPublicado('100.00', '10');
    const b = await itemPublicado('80.00', '10');
    const pedido = await enviarPedido([{ variacaoId: a, quantidade: '1' }]);

    await http
      .post(`/api/pedidos/${pedido.id}/itens`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ variacaoId: b, quantidade: '1', motivo: 'Sugestao da equipe' })
      .expect(201);

    const recusado = (
      await http
        .post(`/api/portal/pedidos/${pedido.id}/aceite`)
        .set('Authorization', `Bearer ${tokenCliente}`)
        .send({ aceita: false, motivo: 'Nao preciso do segundo item' })
        .expect(201)
    ).body as Pedido;

    expect(recusado.status).toBe('DEVOLVIDO');
    expect(recusado.motivo).toContain('segundo item');
  });

  it('a linha do tempo conta a historia, com autor e motivo', async () => {
    const a = await itemPublicado('100.00', '10');
    const b = await itemPublicado('30.00', '10');
    const pedido = await enviarPedido([{ variacaoId: a, quantidade: '1' }]);

    await http
      .post(`/api/pedidos/${pedido.id}/itens/${pedido.itens[0]!.id}/remover`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ motivo: 'Acabou o estoque do fornecedor' })
      .expect(201);

    const final = (
      await http
        .post(`/api/pedidos/${pedido.id}/itens`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ variacaoId: b, quantidade: '2', motivo: 'Substituto combinado' })
        .expect(201)
    ).body as Pedido;

    const motivos = final.eventos.map((e) => e.motivo ?? '').join(' | ');

    expect(motivos).toContain('Removeu');
    expect(motivos).toContain('Acabou o estoque do fornecedor');
    expect(motivos).toContain('Substituto combinado');
    // Quem fez aparece, nao so o que mudou.
    expect(final.eventos.some((e) => (e.ator ?? '').includes('Rodrigo'))).toBe(true);
  });

  it('pedido confirmado nao aceita mais edicao de itens', async () => {
    const variacaoId = await itemPublicado('20.00', '10');
    const pedido = await enviarPedido([{ variacaoId, quantidade: '1' }]);

    await http
      .post(`/api/pedidos/${pedido.id}/confirmar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ itens: [{ itemId: pedido.itens[0]!.id, quantidadeConfirmada: '1' }] })
      .expect(201);

    const recusa = await http
      .post(`/api/pedidos/${pedido.id}/itens/${pedido.itens[0]!.id}/remover`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ motivo: 'Tentativa depois de confirmado' })
      .expect(409);

    expect((recusa.body as { codigo: string }).codigo).toBe('PEDIDO_NAO_EDITAVEL');
  });
});

describe.runIf(temBanco)('faturamento', () => {
  it('vira venda pelo mesmo caminho do PDV, consumindo a reserva', async () => {
    const variacaoId = await itemPublicado('75.00', '10');
    const pedido = await enviarPedido([{ variacaoId, quantidade: '2' }]);

    await http
      .post(`/api/pedidos/${pedido.id}/confirmar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ itens: [{ itemId: pedido.itens[0]!.id, quantidadeConfirmada: '2' }] })
      .expect(201);

    const saldoAntes = (
      await http
        .get(`/api/estoque/movimentos?variacaoId=${variacaoId}&limite=1`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200)
    ).body as { itens: { saldoPosterior: string }[] };

    const faturado = (
      await http
        .post(`/api/pedidos/${pedido.id}/faturar`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ pagamentos: [{ forma: 'PIX', valor: '150.00', parcelas: 1 }] })
        .expect(201)
    ).body as { pedido: Pedido; vendaNumero: number };

    expect(faturado.pedido.status).toBe('FATURADO');
    expect(faturado.vendaNumero).toBeGreaterThan(0);
    expect(faturado.pedido.vendaNumero).toBe(faturado.vendaNumero);

    // AGORA o estoque baixa — pelo mesmo servico do PDV.
    const movimentos = (
      await http
        .get(`/api/estoque/movimentos?variacaoId=${variacaoId}&limite=2`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200)
    ).body as { itens: { tipo: string; saldoPosterior: string; documentoNumero: string | null }[] };

    expect(movimentos.itens[0]!.tipo).toBe('SAIDA_VENDA');
    expect(Number(movimentos.itens[0]!.saldoPosterior)).toBe(
      Number(saldoAntes.itens[0]!.saldoPosterior) - 2,
    );
    expect(movimentos.itens[0]!.documentoNumero).toBe(String(faturado.vendaNumero));
  });

  it('o preco faturado e o congelado no pedido, nao o de hoje', async () => {
    const variacaoId = await itemPublicado('90.00', '10');
    const pedido = await enviarPedido([{ variacaoId, quantidade: '1' }]);

    await http
      .post(`/api/pedidos/${pedido.id}/confirmar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ itens: [{ itemId: pedido.itens[0]!.id, quantidadeConfirmada: '1' }] })
      .expect(201);

    const faturado = (
      await http
        .post(`/api/pedidos/${pedido.id}/faturar`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ pagamentos: [{ forma: 'PIX', valor: '90.00', parcelas: 1 }] })
        .expect(201)
    ).body as { vendaNumero: number };

    const vendas = (
      await http
        .get('/api/vendas?limite=5')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200)
    ).body as {
      itens: { numero: number; itens: { precoUnitario: string; precoOrigem: string }[] }[];
    };

    const venda = vendas.itens.find((v) => v.numero === faturado.vendaNumero)!;

    expect(venda.itens[0]!.precoUnitario).toBe('90.00');
    // `PEDIDO`: nao foi digitado a mao nem lido da tabela na hora do
    // faturamento. E o preco que o cliente viu ao enviar.
    expect(venda.itens[0]!.precoOrigem).toBe('PEDIDO');
  });

  it('nao fatura pedido que nao foi confirmado', async () => {
    const variacaoId = await itemPublicado('20.00', '5');
    const pedido = await enviarPedido([{ variacaoId, quantidade: '1' }]);

    const recusa = await http
      .post(`/api/pedidos/${pedido.id}/faturar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ pagamentos: [{ forma: 'PIX', valor: '20.00', parcelas: 1 }] })
      .expect(409);

    expect((recusa.body as { codigo: string }).codigo).toBe('PEDIDO_NAO_CONFIRMADO');
  });

  it('cancelar um pedido confirmado LIBERA a reserva', async () => {
    const variacaoId = await itemPublicado('35.00', '5');
    const pedido = await enviarPedido([{ variacaoId, quantidade: '3' }]);

    const confirmado = (
      await http
        .post(`/api/pedidos/${pedido.id}/confirmar`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ itens: [{ itemId: pedido.itens[0]!.id, quantidadeConfirmada: '3' }] })
        .expect(201)
    ).body as Pedido;

    expect(Number(confirmado.itens[0]!.disponivelAgora)).toBe(2);

    const cancelado = (
      await http
        .post(`/api/pedidos/${pedido.id}/cancelar`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ motivo: 'Cliente desistiu da compra' })
        .expect(201)
    ).body as Pedido;

    expect(cancelado.status).toBe('CANCELADO');
    // Sem liberar, o estoque ficaria preso a um pedido que nao vai acontecer
    // e a disponibilidade do catalogo passaria a mentir para todo mundo.
    expect(Number(cancelado.itens[0]!.disponivelAgora)).toBe(5);
  });

  it('transicao que nao existe e recusada', async () => {
    const variacaoId = await itemPublicado('20.00', '5');
    const pedido = await enviarPedido([{ variacaoId, quantidade: '1' }]);

    await http
      .post(`/api/pedidos/${pedido.id}/recusar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ motivo: 'Fora da area de entrega' })
      .expect(201);

    // RECUSADO e final. Nao volta de la.
    const recusa = await http
      .post(`/api/pedidos/${pedido.id}/confirmar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ itens: [{ itemId: pedido.itens[0]!.id, quantidadeConfirmada: '1' }] })
      .expect(409);

    expect((recusa.body as { codigo: string }).codigo).toBe('PEDIDO_NAO_AGUARDA_CONFIRMACAO');
  });
});
