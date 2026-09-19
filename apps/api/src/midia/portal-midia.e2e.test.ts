/**
 * A rota de mídia do PORTAL.
 *
 * Ela existe porque o cliente carrega uma permissão só, `portal.acessar`: na
 * rota da equipe ele levaria 403 e o catálogo apareceria sem foto nenhuma.
 *
 * Mas rota nova é superfície nova. O que se testa aqui é o recorte: o cliente
 * alcança a imagem do que está publicado, e nada além — nem o produto não
 * publicado da mesma empresa, nem a rota da equipe.
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
const CLIENTE = { email: 'carlos@academiaippon.com.br', senha: 'Cliente@2026' };

let app: INestApplication;
let http: ReturnType<typeof request>;
let tokenAdmin: string;
let tokenCliente: string;

interface Autorizacao {
  imagemId: string;
  envio: { url: string };
}

function caminhoDe(url: string): string {
  return url.replace(/^https?:\/\/[^/]+/, '');
}

async function entrar(rota: string, dados: { email: string; senha: string }): Promise<string> {
  const resposta = await http
    .post(rota)
    .send({ ...dados, canal: 'app' })
    .expect(200);
  return (resposta.body as { tokenAcesso: string }).tokenAcesso;
}

/**
 * Cria um produto com uma foto pronta e diz se ele vai ao catálogo.
 *
 * O SKU leva um sufixo aleatório porque ele é único por empresa: com um nome
 * fixo, o teste passa na primeira execução e devolve 409 em todas as
 * seguintes, contra o mesmo banco de desenvolvimento.
 */
async function produtoComFoto(marca: string, publicar: boolean): Promise<string> {
  const sufixo = `${marca}${Math.random().toString(36).toUpperCase().slice(2, 7)}`;

  const produto = (
    await http
      .post('/api/produtos')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        skuBase: `PMID-${sufixo}`,
        nome: `Produto de mídia ${sufixo}`,
        variacoes: [{ sku: `PMID-${sufixo}-U`, descricao: 'única', precoPadrao: '10.00' }],
      })
      .expect(201)
  ).body as { id: string };

  const png = pngSolido(1000, 1000);
  const autorizacao = (
    await http
      .post(`/api/produtos/${produto.id}/imagens/autorizar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ tipo: 'image/png', bytes: png.byteLength })
      .expect(201)
  ).body as Autorizacao;

  await http
    .put(caminhoDe(autorizacao.envio.url))
    .set('Content-Type', 'image/png')
    .send(png)
    .expect(200);

  await http
    .post(`/api/produtos/${produto.id}/imagens/${autorizacao.imagemId}/confirmar`)
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .expect(200);

  if (publicar) {
    await http
      .patch(`/api/produtos/${produto.id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ publicadoNoCatalogo: true, status: 'ATIVO' })
      .expect(200);
  }

  return autorizacao.imagemId;
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
}, 60_000);

afterAll(async () => {
  if (app) await app.close();
});

describe.runIf(temBanco)('mídia do portal', () => {
  it('o cliente vê a foto do que está publicado', async () => {
    const imagemId = await produtoComFoto('PUB', true);

    const resposta = await http
      .get(`/api/portal/midia/${imagemId}`)
      .set('Authorization', `Bearer ${tokenCliente}`)
      .expect(200);

    expect(resposta.headers['content-type']).toBe('image/png');
    expect(resposta.body.byteLength).toBeGreaterThan(0);
  });

  /**
   * O id é uuidv7 — ordenado no tempo, adivinhável. Se o recorte fosse só o
   * tenant, o cliente veria a foto de qualquer produto da empresa, inclusive
   * dos que ela ainda não pôs à venda.
   */
  it('não alcança a foto de produto fora do catálogo', async () => {
    const imagemId = await produtoComFoto('OCULTO', false);

    const recusa = await http
      .get(`/api/portal/midia/${imagemId}`)
      .set('Authorization', `Bearer ${tokenCliente}`)
      .expect(404);

    // "Não encontrada", não "não autorizada": o que ele não pode ver, para
    // ele não existe — senão a própria recusa confirma que o produto existe.
    expect((recusa.body as { codigo: string }).codigo).toBe('IMAGEM_NAO_ENCONTRADA');
  });

  it('a equipe continua vendo o que não está publicado', async () => {
    const imagemId = await produtoComFoto('EQUIPE', false);

    await http
      .get(`/api/midia/${imagemId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);
  });

  /** Token do domínio errado falha na AUTENTICAÇÃO: 401, não 403. ADR-009. */
  it('o token do cliente não abre a rota da equipe', async () => {
    const imagemId = await produtoComFoto('DOMINIO', true);

    await http
      .get(`/api/midia/${imagemId}`)
      .set('Authorization', `Bearer ${tokenCliente}`)
      .expect(401);
  });

  it('o token da equipe não abre a rota do portal', async () => {
    const imagemId = await produtoComFoto('INVERSO', true);

    await http
      .get(`/api/portal/midia/${imagemId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(401);
  });
});
