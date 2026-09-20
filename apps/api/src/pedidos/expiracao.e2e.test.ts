/**
 * Reserva vencida não segura estoque.
 *
 * `expiraEm` era gravado desde o início e ninguém o lia. Uma reserva ATIVA de
 * um pedido que ninguém confirmou nem cancelou prendia a mercadoria para
 * sempre: passados os sete dias do padrão, o catálogo dizia "sob encomenda"
 * para item que estava na prateleira.
 *
 * O que se testa aqui é a garantia que não depende de rotina nenhuma: o
 * cálculo de disponibilidade ignora reserva vencida mesmo que ninguém tenha
 * rodado `npm run expirar`.
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { criarPrisma, type PrismaClient } from '@estoque/db';

import { AppModule } from '../app.module';
import { pngSolido } from '../produtos/png.testutil';

const temBanco = Boolean(process.env['DATABASE_URL'] && process.env['DIRECT_URL']);

const ADMIN = { email: 'rodrigo@lojacentro.com.br', senha: 'Estoque@2026' };
const CLIENTE = { email: 'carlos@academiaippon.com.br', senha: 'Cliente@2026' };

let app: INestApplication;
let http: ReturnType<typeof request>;
let tokenAdmin: string;
let tokenCliente: string;
/** Conexão privilegiada, só para envelhecer a reserva — o relógio não espera. */
let privilegiado: PrismaClient;

function sufixo(): string {
  return Math.random().toString(36).toUpperCase().slice(2, 9);
}

async function entrar(rota: string, dados: { email: string; senha: string }): Promise<string> {
  const resposta = await http
    .post(rota)
    .send({ ...dados, canal: 'app' })
    .expect(200);
  return (resposta.body as { tokenAcesso: string }).tokenAcesso;
}

/** Um item publicado, com preço na tabela do cliente e saldo no local. */
async function itemDisponivel(quantidade: string): Promise<{ variacaoId: string; sku: string }> {
  const s = sufixo();

  const produto = (
    await http
      .post('/api/produtos')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        skuBase: `EXP-${s}`,
        nome: `Item de expiração ${s}`,
        variacoes: [{ sku: `EXP-${s}-U`, descricao: 'única', precoPadrao: '50.00' }],
      })
      .expect(201)
  ).body as { id: string };

  const detalhe = (
    await http
      .get(`/api/produtos/${produto.id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200)
  ).body as { variacoes: { id: string; sku: string }[] };

  const variacao = detalhe.variacoes[0]!;

  const precos = (
    await http
      .get(`/api/produtos/${produto.id}/precos`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200)
  ).body as { variacoes: { precos: { tabelaPrecoId: string; chave: string }[] }[] };

  await http
    .put(`/api/produtos/${produto.id}/precos`)
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send({
      precos: precos.variacoes[0]!.precos.map((p) => ({
        variacaoId: variacao.id,
        tabelaPrecoId: p.tabelaPrecoId,
        preco: '50.00',
      })),
    })
    .expect(200);

  // Publicar exige foto: produto no catálogo sem imagem é anúncio vazio, e a
  // API recusa. Os três passos do envio, como qualquer outra foto.
  const png = pngSolido(1000, 1000);
  const autorizacao = (
    await http
      .post(`/api/produtos/${produto.id}/imagens/autorizar`)
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
    .post(`/api/produtos/${produto.id}/imagens/${autorizacao.imagemId}/confirmar`)
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .expect(200);

  await http
    .patch(`/api/produtos/${produto.id}`)
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send({ publicadoNoCatalogo: true, status: 'ATIVO' })
    .expect(200);

  const contexto = (
    await http.get('/api/vendas/contexto').set('Authorization', `Bearer ${tokenAdmin}`).expect(200)
  ).body as { lojas: { id: string; localPadraoId: string | null }[] };

  const loja = contexto.lojas.find((l) => l.localPadraoId !== null)!;

  await http
    .post('/api/estoque/entrada')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send({
      variacaoId: variacao.id,
      lojaId: loja.id,
      localId: loja.localPadraoId,
      quantidade,
      custoUnitario: '10.00',
    })
    .expect(201);

  return { variacaoId: variacao.id, sku: variacao.sku };
}

async function noCatalogo(sku: string): Promise<{ disponivel: boolean } | undefined> {
  const catalogo = (
    await http
      .get(`/api/portal/pedidos/catalogo?limite=60&termo=${sku}`)
      .set('Authorization', `Bearer ${tokenCliente}`)
      .expect(200)
  ).body as { sku: string; disponivel: boolean }[];

  return catalogo.find((i) => i.sku === sku);
}

beforeAll(async () => {
  if (!temBanco) return;

  const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = modulo.createNestApplication();
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  await app.init();

  http = request(app.getHttpServer());
  tokenAdmin = await entrar('/api/auth/login', ADMIN);
  tokenCliente = await entrar('/api/portal/auth/login', CLIENTE);

  privilegiado = await criarPrisma({
    url: process.env['DIRECT_URL']!,
    permitirPapelPrivilegiado: true,
  });
}, 60_000);

afterAll(async () => {
  if (app) await app.close();
  if (privilegiado) await privilegiado.$disconnect();
});

/**
 * O catálogo do cliente conta reservas que o cliente não pode ver.
 *
 * `estoque_reserva` tem política RESTRICTIVE que devolve zero linhas quando
 * `app.cliente_id` está definido — ou seja, em todo o portal. A decisão está
 * certa: reserva revela quantidade, e o cliente só vê disponível ou não.
 *
 * Mas com ela, `saldo − reservas` virava `saldo − 0` no portal, e o catálogo
 * anunciava "pronta entrega" para item inteiramente reservado por pedidos já
 * confirmados de outros clientes. Duas decisões certas somando uma errada.
 *
 * A conferência da equipe nunca foi afetada — ela roda como funcionário, onde
 * as reservas aparecem. Nunca houve compromisso de estoque a descoberto; o
 * defeito era informar mal quem compra.
 */
describe.runIf(temBanco)('o que o cliente vê e o que ele não pode ver', () => {
  it('item todo reservado aparece como indisponível no portal', async () => {
    const item = await itemDisponivel('4');

    const pedido = (
      await http
        .post('/api/portal/pedidos')
        .set('Authorization', `Bearer ${tokenCliente}`)
        .send({ itens: [{ variacaoId: item.variacaoId, quantidade: '4' }] })
        .expect(201)
    ).body as { pedido: { id: string; itens: { id: string }[] } };

    expect((await noCatalogo(item.sku))?.disponivel).toBe(true);

    await http
      .post(`/api/pedidos/${pedido.pedido.id}/confirmar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        itens: pedido.pedido.itens.map((i) => ({ itemId: i.id, quantidadeConfirmada: '4' })),
      })
      .expect(201);

    // O pedido em espera não reservava nada; a confirmação reserva. Se o
    // portal continuasse dizendo "pronta entrega" aqui, o próximo cliente
    // pediria mercadoria que já tem dono.
    expect((await noCatalogo(item.sku))?.disponivel).toBe(false);
  });

  it('e o portal continua sem enxergar reserva nenhuma', async () => {
    const pedidos = (
      await http
        .get('/api/portal/pedidos?limite=1')
        .set('Authorization', `Bearer ${tokenCliente}`)
        .expect(200)
    ).body as { itens: unknown[] };

    // A resposta do portal não carrega quantidade em lugar nenhum: nem
    // `disponivelAgora` no item, nem reserva. O número que ele recebe é o
    // booleano do catálogo, e mais nada.
    expect(JSON.stringify(pedidos)).not.toContain('disponivelAgora');
  });
});

describe.runIf(temBanco)('reserva vencida', () => {
  it('deixa de segurar o estoque, sem rodar rotina nenhuma', async () => {
    const item = await itemDisponivel('3');

    // O cliente pede tudo, a equipe confirma: nasce a reserva.
    const pedido = (
      await http
        .post('/api/portal/pedidos')
        .set('Authorization', `Bearer ${tokenCliente}`)
        .send({ itens: [{ variacaoId: item.variacaoId, quantidade: '3' }] })
        .expect(201)
    ).body as { pedido: { id: string; itens: { id: string }[] } };

    await http
      .post(`/api/pedidos/${pedido.pedido.id}/confirmar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        itens: pedido.pedido.itens.map((i) => ({ itemId: i.id, quantidadeConfirmada: '3' })),
      })
      .expect(201);

    // Com a reserva viva, o saldo está comprometido.
    expect((await noCatalogo(item.sku))?.disponivel).toBe(false);

    // Envelhece a reserva: é o que o relógio faria em sete dias.
    const envelhecidas = await privilegiado.$executeRawUnsafe(
      `UPDATE estoque_reserva SET expira_em = now() - interval '1 hour'
         WHERE variacao_id = $1::uuid AND status = 'ATIVA'`,
      item.variacaoId,
    );
    expect(envelhecidas).toBeGreaterThan(0);

    // Nenhuma rotina rodou. A resposta precisa estar certa mesmo assim: é
    // por isso que o filtro vive no cálculo, e não só na limpeza.
    expect((await noCatalogo(item.sku))?.disponivel).toBe(true);
  });

  it('a linha continua ATIVA até a rotina passar — o dado é arrumado depois', async () => {
    const item = await itemDisponivel('2');

    const pedido = (
      await http
        .post('/api/portal/pedidos')
        .set('Authorization', `Bearer ${tokenCliente}`)
        .send({ itens: [{ variacaoId: item.variacaoId, quantidade: '2' }] })
        .expect(201)
    ).body as { pedido: { id: string; itens: { id: string }[] } };

    await http
      .post(`/api/pedidos/${pedido.pedido.id}/confirmar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        itens: pedido.pedido.itens.map((i) => ({ itemId: i.id, quantidadeConfirmada: '2' })),
      })
      .expect(201);

    await privilegiado.$executeRawUnsafe(
      `UPDATE estoque_reserva SET expira_em = now() - interval '1 hour'
         WHERE variacao_id = $1::uuid AND status = 'ATIVA'`,
      item.variacaoId,
    );

    const aindaAtiva = await privilegiado.$queryRawUnsafe<{ status: string }[]>(
      `SELECT status FROM estoque_reserva WHERE variacao_id = $1::uuid`,
      item.variacaoId,
    );

    // A rotina é higiene, não correção: o dado fica sujo até ela rodar, e a
    // resposta já está certa. Se um dia isto virar EXPIRADA sozinho, alguém
    // pôs um agendador dentro da API — e aí são duas instâncias disputando.
    expect(aindaAtiva[0]?.status).toBe('ATIVA');
  });
});
