/**
 * Testes de ponta a ponta das fotos de produto.
 *
 * Exercitam os três passos de docs/MEDIA.md §4 contra a aplicação de verdade,
 * com PNG de verdade, gravando em disco de verdade.
 *
 * O que estes testes existem para impedir:
 *
 *  1. **Confiar no que o cliente declara.** O `Content-Type` do passo 1 é
 *     intenção; o que vale é o byte que chegou.
 *  2. **Bilhete de envio tratado como detalhe.** Ele é a autorização de
 *     escrita — forjá-lo ou reusá-lo depois do prazo tem que falhar.
 *  3. **Produto publicado ficar sem foto.**
 *
 * Pré-requisito: `npm run db:seed`.
 */

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../app.module';
import { pngSolido } from './png.testutil';

const temBanco = Boolean(process.env['DATABASE_URL'] && process.env['DIRECT_URL']);

const ADMIN = { email: 'rodrigo@lojacentro.com.br', senha: 'Estoque@2026' };
/** Tem `produto.visualizar`, não tem `produto.gerenciar_fotos`. */
const VENDEDORA = { email: 'marina@lojacentro.com.br', senha: 'Estoque@2026' };

let app: INestApplication;
let http: ReturnType<typeof request>;
let tokenAdmin: string;
let produtoId: string;

interface Autorizacao {
  imagemId: string;
  envio: { url: string; metodo: string; cabecalhos: Record<string, string>; expiraEm: string };
}

interface Imagem {
  id: string;
  principal: boolean;
  status: string;
  largura: number | null;
  altura: number | null;
  bytes: number | null;
  textoAlternativo: string;
  url: string;
}

async function entrar(dados: { email: string; senha: string }): Promise<string> {
  const resposta = await http
    .post('/api/auth/login')
    .send({ ...dados, canal: 'app' })
    .expect(200);
  return (resposta.body as { tokenAcesso: string }).tokenAcesso;
}

/** A URL do bilhete é absoluta; o supertest precisa só do caminho. */
function caminhoDe(url: string): string {
  return url.replace(/^https?:\/\/[^/]+/, '');
}

async function criarProduto(token: string, sufixo: string): Promise<string> {
  const resposta = await http
    .post('/api/produtos')
    .set('Authorization', `Bearer ${token}`)
    .send({
      skuBase: `FOTO-${sufixo}`,
      nome: `Produto com foto ${sufixo}`,
      variacoes: [{ sku: `FOTO-${sufixo}-U`, descricao: 'única', precoPadrao: '10.00' }],
    })
    .expect(201);

  return (resposta.body as { id: string }).id;
}

/** Percorre os três passos e devolve a imagem pronta. */
async function enviarFoto(
  token: string,
  produto: string,
  png: Buffer = pngSolido(1000, 1000),
): Promise<Imagem> {
  const autorizacao = (
    await http
      .post(`/api/produtos/${produto}/imagens/autorizar`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'image/png', bytes: png.byteLength })
      .expect(201)
  ).body as Autorizacao;

  await http
    .put(caminhoDe(autorizacao.envio.url))
    .set('Content-Type', 'image/png')
    .send(png)
    .expect(200);

  const pronta = await http
    .post(`/api/produtos/${produto}/imagens/${autorizacao.imagemId}/confirmar`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  return pronta.body as Imagem;
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
  produtoId = await criarProduto(tokenAdmin, Date.now().toString(36).toUpperCase().slice(-6));
}, 60_000);

afterAll(async () => {
  if (app) {
    await app.close();
  }
});

describe.runIf(temBanco)('envio de foto', () => {
  it('autoriza, recebe e confirma', async () => {
    const png = pngSolido(1200, 1200);
    const imagem = await enviarFoto(tokenAdmin, produtoId, png);

    expect(imagem.status).toBe('PRONTA');
    // As dimensões vêm do arquivo, não do que alguém digitou.
    expect(imagem.largura).toBe(1200);
    expect(imagem.altura).toBe(1200);
    expect(imagem.bytes).toBe(png.byteLength);
    // Primeira foto do produto vira capa sozinha.
    expect(imagem.principal).toBe(true);
    // Texto alternativo vazio herda o nome do produto. docs/MEDIA.md §7.
    expect(imagem.textoAlternativo).toContain('Produto com foto');
  });

  it('serve os bytes de volta, com o tipo lido do conteúdo', async () => {
    const produto = await criarProduto(tokenAdmin, `S${Date.now().toString(36).slice(-5)}`);
    const png = pngSolido(900, 900);
    const imagem = await enviarFoto(tokenAdmin, produto, png);

    const resposta = await http
      .get(`/api${imagem.url}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    expect(resposta.headers['content-type']).toContain('image/png');
    expect(Buffer.from(resposta.body as Buffer).equals(png)).toBe(true);
  });

  it('recusa quem não tem produto.gerenciar_fotos', async () => {
    const token = await entrar(VENDEDORA);

    await http
      .post(`/api/produtos/${produtoId}/imagens/autorizar`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'image/png', bytes: 1000 })
      .expect(403);
  });

  it('recusa declaração acima de 10 MB antes mesmo do envio', async () => {
    const resposta = await http
      .post(`/api/produtos/${produtoId}/imagens/autorizar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ tipo: 'image/png', bytes: 11 * 1024 * 1024 })
      .expect(400);

    expect(JSON.stringify(resposta.body)).toContain('10 MB');
  });

  it('recusa tipo fora da lista', async () => {
    await http
      .post(`/api/produtos/${produtoId}/imagens/autorizar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ tipo: 'image/gif', bytes: 1000 })
      .expect(400);
  });

  it('não cria foto em produto de outra empresa — 404, não 403', async () => {
    await http
      .post('/api/produtos/01234567-89ab-7cde-8f01-23456789abcd/imagens/autorizar')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ tipo: 'image/png', bytes: 1000 })
      .expect(404);
  });
});

describe.runIf(temBanco)('o que chegou não é o que foi declarado', () => {
  it('recusa arquivo que não é imagem, mesmo autorizado como PNG', async () => {
    const produto = await criarProduto(tokenAdmin, `X${Date.now().toString(36).slice(-5)}`);
    // Um executável do Windows enviado como "image/png".
    const impostor = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);

    const autorizacao = (
      await http
        .post(`/api/produtos/${produto}/imagens/autorizar`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ tipo: 'image/png', bytes: impostor.byteLength })
        .expect(201)
    ).body as Autorizacao;

    // O envio passa: o armazenamento guarda bytes, não julga conteúdo.
    await http
      .put(caminhoDe(autorizacao.envio.url))
      .set('Content-Type', 'image/png')
      .send(impostor)
      .expect(200);

    // A confirmação é que recusa.
    const recusa = await http
      .post(`/api/produtos/${produto}/imagens/${autorizacao.imagemId}/confirmar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(400);

    expect((recusa.body as { codigo: string }).codigo).toBe('TIPO_NAO_ACEITO');

    // E a imagem fica visível como FALHA, para o operador entender o que houve.
    const lista = (
      await http
        .get(`/api/produtos/${produto}/imagens`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200)
    ).body as Imagem[];

    expect(lista[0]?.status).toBe('FALHA');
    expect(lista[0]?.principal).toBe(false);
  });

  it('recusa imagem menor que 800×800', async () => {
    const produto = await criarProduto(tokenAdmin, `P${Date.now().toString(36).slice(-5)}`);
    const pequena = pngSolido(400, 400);

    const autorizacao = (
      await http
        .post(`/api/produtos/${produto}/imagens/autorizar`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ tipo: 'image/png', bytes: pequena.byteLength })
        .expect(201)
    ).body as Autorizacao;

    await http
      .put(caminhoDe(autorizacao.envio.url))
      .set('Content-Type', 'image/png')
      .send(pequena)
      .expect(200);

    const recusa = await http
      .post(`/api/produtos/${produto}/imagens/${autorizacao.imagemId}/confirmar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(400);

    expect((recusa.body as { codigo: string }).codigo).toBe('IMAGEM_PEQUENA');
    expect((recusa.body as { mensagem: string }).mensagem).toContain('400×400');
  });

  it('recusa confirmar antes do arquivo chegar', async () => {
    const produto = await criarProduto(tokenAdmin, `A${Date.now().toString(36).slice(-5)}`);

    const autorizacao = (
      await http
        .post(`/api/produtos/${produto}/imagens/autorizar`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ tipo: 'image/png', bytes: 5000 })
        .expect(201)
    ).body as Autorizacao;

    const recusa = await http
      .post(`/api/produtos/${produto}/imagens/${autorizacao.imagemId}/confirmar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(400);

    expect((recusa.body as { codigo: string }).codigo).toBe('ARQUIVO_NAO_ENVIADO');
  });
});

describe.runIf(temBanco)('quatro fotos de uma vez', () => {
  it('confirma todas em paralelo e elege exatamente uma capa', async () => {
    const produto = await criarProduto(tokenAdmin, `R${Date.now().toString(36).slice(-5)}`);

    // Este é o caso real: quem arrasta quatro arquivos dispara quatro
    // confirmações ao mesmo tempo. Todas veem "sem capa" antes de qualquer
    // uma gravar, e o índice único parcial derruba as perdedoras.
    //
    // Aconteceu de verdade na tela: uma foto ficou PROCESSANDO para sempre
    // porque a exceção da eleição abortou a confirmação inteira.
    const tons = [0x20, 0x50, 0x80, 0xb0];

    const autorizacoes = await Promise.all(
      tons.map(async (tom) => {
        const png = pngSolido(900, 900, tom);
        const autorizacao = (
          await http
            .post(`/api/produtos/${produto}/imagens/autorizar`)
            .set('Authorization', `Bearer ${tokenAdmin}`)
            .send({ tipo: 'image/png', bytes: png.byteLength })
            .expect(201)
        ).body as Autorizacao;

        await http
          .put(caminhoDe(autorizacao.envio.url))
          .set('Content-Type', 'image/png')
          .send(png)
          .expect(200);

        return autorizacao.imagemId;
      }),
    );

    const respostas = await Promise.all(
      autorizacoes.map((imagemId) =>
        http
          .post(`/api/produtos/${produto}/imagens/${imagemId}/confirmar`)
          .set('Authorization', `Bearer ${tokenAdmin}`),
      ),
    );

    // Nenhuma confirmação pode falhar por causa da disputa de capa.
    for (const resposta of respostas) {
      expect(resposta.status).toBe(200);
    }

    const lista = (
      await http
        .get(`/api/produtos/${produto}/imagens`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200)
    ).body as Imagem[];

    expect(lista).toHaveLength(4);
    // Todas prontas, com dimensões lidas do arquivo.
    expect(lista.every((i) => i.status === 'PRONTA')).toBe(true);
    expect(lista.every((i) => i.largura === 900)).toBe(true);
    // E exatamente uma capa.
    expect(lista.filter((i) => i.principal)).toHaveLength(1);
  });
});

describe.runIf(temBanco)('o bilhete de envio', () => {
  it('recusa envio sem bilhete', async () => {
    await http.put('/api/midia/enviar').send(pngSolido(800, 800)).expect(400);
  });

  it('recusa bilhete com assinatura adulterada', async () => {
    const png = pngSolido(800, 800);

    const autorizacao = (
      await http
        .post(`/api/produtos/${produtoId}/imagens/autorizar`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ tipo: 'image/png', bytes: png.byteLength })
        .expect(201)
    ).body as Autorizacao;

    const caminho = caminhoDe(autorizacao.envio.url);
    const adulterado = caminho.slice(0, -4) + 'aaaa';

    const recusa = await http
      .put(adulterado)
      .set('Content-Type', 'image/png')
      .send(png)
      .expect(400);

    expect((recusa.body as { codigo: string }).codigo).toBe('ENVIO_NAO_AUTORIZADO');
  });

  it('recusa arquivo maior do que o bilhete autorizou', async () => {
    const declarado = pngSolido(800, 800);
    const enviado = pngSolido(1600, 1600);
    expect(enviado.byteLength).toBeGreaterThan(declarado.byteLength);

    const autorizacao = (
      await http
        .post(`/api/produtos/${produtoId}/imagens/autorizar`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ tipo: 'image/png', bytes: declarado.byteLength })
        .expect(201)
    ).body as Autorizacao;

    const recusa = await http
      .put(caminhoDe(autorizacao.envio.url))
      .set('Content-Type', 'image/png')
      .send(enviado)
      .expect(400);

    expect((recusa.body as { codigo: string }).codigo).toBe('TAMANHO_ACIMA_DO_AUTORIZADO');
  });
});

describe.runIf(temBanco)('capa e exclusão', () => {
  it('troca a capa rebaixando a anterior', async () => {
    const produto = await criarProduto(tokenAdmin, `C${Date.now().toString(36).slice(-5)}`);

    const primeira = await enviarFoto(tokenAdmin, produto);
    const segunda = await enviarFoto(tokenAdmin, produto, pngSolido(900, 900, 0x30));

    expect(primeira.principal).toBe(true);
    expect(segunda.principal).toBe(false);

    await http
      .patch(`/api/produtos/${produto}/imagens/${segunda.id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ principal: true })
      .expect(200);

    const lista = (
      await http
        .get(`/api/produtos/${produto}/imagens`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200)
    ).body as Imagem[];

    const capas = lista.filter((i) => i.principal);
    expect(capas).toHaveLength(1);
    expect(capas[0]?.id).toBe(segunda.id);
  });

  it('excluir a capa promove a próxima', async () => {
    const produto = await criarProduto(tokenAdmin, `D${Date.now().toString(36).slice(-5)}`);

    const primeira = await enviarFoto(tokenAdmin, produto);
    const segunda = await enviarFoto(tokenAdmin, produto, pngSolido(900, 900, 0x20));

    await http
      .delete(`/api/produtos/${produto}/imagens/${primeira.id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(204);

    const lista = (
      await http
        .get(`/api/produtos/${produto}/imagens`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200)
    ).body as Imagem[];

    expect(lista).toHaveLength(1);
    expect(lista[0]?.id).toBe(segunda.id);
    expect(lista[0]?.principal).toBe(true);
  });

  it('não deixa produto publicado ficar sem foto', async () => {
    const produto = await criarProduto(tokenAdmin, `E${Date.now().toString(36).slice(-5)}`);
    const unica = await enviarFoto(tokenAdmin, produto);

    await http
      .patch(`/api/produtos/${produto}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ publicadoNoCatalogo: true })
      .expect(200);

    const recusa = await http
      .delete(`/api/produtos/${produto}/imagens/${unica.id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(409);

    expect((recusa.body as { codigo: string }).codigo).toBe('CATALOGO_FICARIA_SEM_FOTO');

    // Despublicando, a remoção passa a ser permitida.
    await http
      .patch(`/api/produtos/${produto}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ publicadoNoCatalogo: false })
      .expect(200);

    await http
      .delete(`/api/produtos/${produto}/imagens/${unica.id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(204);
  });

  it('a exclusão é lógica — a listagem some, a linha permanece', async () => {
    const produto = await criarProduto(tokenAdmin, `L${Date.now().toString(36).slice(-5)}`);
    const foto = await enviarFoto(tokenAdmin, produto);

    await http
      .delete(`/api/produtos/${produto}/imagens/${foto.id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(204);

    const lista = (
      await http
        .get(`/api/produtos/${produto}/imagens`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200)
    ).body as Imagem[];

    expect(lista).toHaveLength(0);

    // Excluir de novo devolve 404: a linha existe, mas já não está viva.
    await http
      .delete(`/api/produtos/${produto}/imagens/${foto.id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(404);
  });

  it('foto excluída não habilita publicação', async () => {
    const produto = await criarProduto(tokenAdmin, `F${Date.now().toString(36).slice(-5)}`);
    const foto = await enviarFoto(tokenAdmin, produto);

    await http
      .delete(`/api/produtos/${produto}/imagens/${foto.id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(204);

    // A linha continua na tabela — exclusão é lógica. Se a contagem não
    // filtrar por `excluido_em`, este produto passa a publicar sem foto.
    const recusa = await http
      .patch(`/api/produtos/${produto}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ publicadoNoCatalogo: true })
      .expect(409);

    expect((recusa.body as { codigo: string }).codigo).toBe('PRODUTO_SEM_FOTO');
  });

  it('foto que falhou no envio não habilita publicação', async () => {
    const produto = await criarProduto(tokenAdmin, `G${Date.now().toString(36).slice(-5)}`);
    const impostor = Buffer.from([0x4d, 0x5a, 0x90, 0x00]);

    const autorizacao = (
      await http
        .post(`/api/produtos/${produto}/imagens/autorizar`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ tipo: 'image/png', bytes: impostor.byteLength })
        .expect(201)
    ).body as Autorizacao;

    await http
      .put(caminhoDe(autorizacao.envio.url))
      .set('Content-Type', 'image/png')
      .send(impostor)
      .expect(200);

    await http
      .post(`/api/produtos/${produto}/imagens/${autorizacao.imagemId}/confirmar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(400);

    await http
      .patch(`/api/produtos/${produto}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ publicadoNoCatalogo: true })
      .expect(409);
  });
});
