/**
 * Testes de ponta a ponta dos produtos.
 *
 * O que estes testes existem para impedir:
 *
 *  1. **Custo vazando por omissão de coluna.** Esconder `custoMedio` na tela e
 *     mandá-lo no JSON não é permissão, é decoração: basta abrir a aba de rede
 *     do navegador. Aqui se verifica a AUSÊNCIA DA CHAVE, não o valor.
 *  2. **Permissão de escrita confundida com permissão de leitura.** Quem lista
 *     produto não necessariamente cadastra produto.
 *  3. **Mensagem de validação em inglês.** O mesmo schema valida no navegador
 *     e aqui; se o idioma quebrar, quebra nos dois.
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

/** Tem `produto.ver_custo` e `produto.criar`. */
const ADMIN = { email: 'rodrigo@lojacentro.com.br', senha: 'Estoque@2026' };
/** Tem `produto.visualizar`, mas NÃO tem `produto.ver_custo` nem `produto.criar`. */
const VENDEDORA = { email: 'marina@lojacentro.com.br', senha: 'Estoque@2026' };

let app: INestApplication;
let http: ReturnType<typeof request>;

interface Sessao {
  tokenAcesso: string;
  usuario: { permissoes: string[] };
}

interface ItemLista {
  id: string;
  skuBase: string;
  saldoTotal: string;
  custoMedio?: string | null;
  valorEstoque?: string;
}

async function entrar(dados: { email: string; senha: string }): Promise<Sessao> {
  const resposta = await http
    .post('/api/auth/login')
    .send({ ...dados, canal: 'app' })
    .expect(200);
  return resposta.body as Sessao;
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
}, 60_000);

afterAll(async () => {
  if (app) {
    await app.close();
  }
});

describe.runIf(temBanco)('listagem de produtos', () => {
  it('entrega custo a quem tem produto.ver_custo', async () => {
    const sessao = await entrar(ADMIN);
    expect(sessao.usuario.permissoes).toContain('produto.ver_custo');

    const resposta = await http
      .get('/api/produtos?limite=5')
      .set('Authorization', `Bearer ${sessao.tokenAcesso}`)
      .expect(200);

    const itens = resposta.body.itens as ItemLista[];
    expect(itens.length).toBeGreaterThan(0);

    for (const item of itens) {
      // A chave existe sempre que a permissão existe. O VALOR pode ser `null`
      // — produto sem saldo não tem custo médio, e zero seria mentira.
      expect(Object.keys(item)).toContain('custoMedio');
      expect(item).toHaveProperty('valorEstoque');
    }
  });

  it('com saldo zero manda custoMedio null — não omite a chave, nem zera', async () => {
    const sessao = await entrar(ADMIN);

    const resposta = await http
      .get('/api/produtos?busca=CAM-TRN')
      .set('Authorization', `Bearer ${sessao.tokenAcesso}`)
      .expect(200);

    const item = (resposta.body.itens as ItemLista[])[0];

    expect(item?.saldoTotal).toBe('0');
    expect(Object.keys(item ?? {})).toContain('custoMedio');
    expect(item?.custoMedio).toBeNull();
    expect(item?.valorEstoque).toBe('0.00');
  });

  it('OMITE A CHAVE de custo para quem não tem a permissão', async () => {
    const sessao = await entrar(VENDEDORA);
    expect(sessao.usuario.permissoes).toContain('produto.visualizar');
    expect(sessao.usuario.permissoes).not.toContain('produto.ver_custo');

    const resposta = await http
      .get('/api/produtos?limite=5')
      .set('Authorization', `Bearer ${sessao.tokenAcesso}`)
      .expect(200);

    const itens = resposta.body.itens as ItemLista[];
    expect(itens.length).toBeGreaterThan(0);

    for (const item of itens) {
      // `toHaveProperty` falha para chave ausente E para chave com `undefined`
      // explícito só no primeiro caso — que é o que queremos garantir: a chave
      // não existe no corpo serializado.
      expect(item).not.toHaveProperty('custoMedio');
      expect(item).not.toHaveProperty('valorEstoque');
      expect(Object.keys(item)).not.toContain('custoMedio');
    }

    // E o corpo cru, por via das dúvidas: nem a palavra aparece.
    expect(resposta.text).not.toContain('custoMedio');
    expect(resposta.text).not.toContain('valorEstoque');
  });

  it('os dois veem os mesmos produtos — o corte é no campo, não na linha', async () => {
    const admin = await entrar(ADMIN);
    const vendedora = await entrar(VENDEDORA);

    const doAdmin = await http
      .get('/api/produtos?limite=100')
      .set('Authorization', `Bearer ${admin.tokenAcesso}`)
      .expect(200);

    const daVendedora = await http
      .get('/api/produtos?limite=100')
      .set('Authorization', `Bearer ${vendedora.tokenAcesso}`)
      .expect(200);

    expect(daVendedora.body.total).toBe(doAdmin.body.total);
    expect((daVendedora.body.itens as ItemLista[]).map((i) => i.skuBase)).toEqual(
      (doAdmin.body.itens as ItemLista[]).map((i) => i.skuBase),
    );
  });

  it('exige autenticação', async () => {
    await http.get('/api/produtos').expect(401);
  });
});

describe.runIf(temBanco)('detalhe do produto', () => {
  it('traz variações, saldo por local e valor de estoque', async () => {
    const sessao = await entrar(ADMIN);

    const lista = await http
      .get('/api/produtos?busca=KIM-TRC')
      .set('Authorization', `Bearer ${sessao.tokenAcesso}`)
      .expect(200);

    const id = (lista.body.itens as ItemLista[])[0]?.id;

    const detalhe = (
      await http
        .get(`/api/produtos/${String(id)}`)
        .set('Authorization', `Bearer ${sessao.tokenAcesso}`)
        .expect(200)
    ).body as {
      skuBase: string;
      saldoTotal: string;
      valorEstoque?: string;
      variacoes: {
        sku: string;
        saldo: string;
        custoMedio?: string | null;
        abaixoDoMinimo: boolean;
        saldosPorLocal: { loja: string; local: string; quantidade: string; custoMedio?: string }[];
      }[];
    };

    expect(detalhe.skuBase).toBe('KIM-TRC');
    expect(detalhe.variacoes.length).toBeGreaterThan(0);
    expect(detalhe.valorEstoque).toBeDefined();

    // O saldo do produto é a soma do saldo das variações, que por sua vez é a
    // soma dos locais. Se as três contas não fecharem, alguma está errada.
    const somaDasVariacoes = detalhe.variacoes.reduce((t, v) => t + Number(v.saldo), 0);
    expect(somaDasVariacoes).toBe(Number(detalhe.saldoTotal));

    for (const v of detalhe.variacoes) {
      const somaDosLocais = v.saldosPorLocal.reduce((t, s) => t + Number(s.quantidade), 0);
      expect(somaDosLocais).toBe(Number(v.saldo));
      expect(v.saldosPorLocal.every((s) => s.loja.length > 0 && s.local.length > 0)).toBe(true);
    }
  });

  it('não devolve custo — em lugar nenhum — para quem não tem a permissão', async () => {
    const admin = await entrar(ADMIN);
    const vendedora = await entrar(VENDEDORA);

    const id = (
      await http
        .get('/api/produtos?busca=KIM-TRC')
        .set('Authorization', `Bearer ${admin.tokenAcesso}`)
        .expect(200)
    ).body.itens[0].id as string;

    const resposta = await http
      .get(`/api/produtos/${id}`)
      .set('Authorization', `Bearer ${vendedora.tokenAcesso}`)
      .expect(200);

    // Inclusive dentro do saldo por local, que é onde é fácil esquecer.
    expect(resposta.text).not.toContain('custoMedio');
    expect(resposta.text).not.toContain('valorEstoque');
  });

  it('produto de outra empresa é 404', async () => {
    const sessao = await entrar(ADMIN);

    await http
      .get('/api/produtos/01234567-89ab-7cde-8f01-23456789abcd')
      .set('Authorization', `Bearer ${sessao.tokenAcesso}`)
      .expect(404);
  });

  it('a rota /produtos/apoio continua sendo apoio, não um id', async () => {
    const sessao = await entrar(ADMIN);

    // `@Get(':id')` declarado antes de `@Get('apoio')` engoliria esta rota.
    const resposta = await http
      .get('/api/produtos/apoio')
      .set('Authorization', `Bearer ${sessao.tokenAcesso}`)
      .expect(200);

    expect(resposta.body).toHaveProperty('categorias');
    expect(resposta.body).toHaveProperty('marcas');
  });

  /*
    Categoria e marca só existiam no seed: `apoio` as LISTAVA e nenhuma rota
    as criava. Numa empresa nova — e a plataforma cria empresas vazias — os
    dois campos do cadastro de produto ficavam presos em "Não definida" para
    sempre. Campo que o sistema lê e ninguém consegue gravar.
  */
  it.each([
    ['categorias', 'Categoria'],
    ['marcas', 'Marca'],
  ])('%s: cria, aparece no apoio, repete recusa e a vazia se exclui', async (onde, rotulo) => {
    const sessao = await entrar(ADMIN);
    const cabecalho = { Authorization: `Bearer ${sessao.tokenAcesso}` };
    const nome = `${rotulo} de teste ${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    const criada = (
      await http.post(`/api/produtos/${onde}`).set(cabecalho).send({ nome }).expect(201)
    ).body as { id: string; nome: string };

    expect(criada.nome).toBe(nome);

    const apoio = (await http.get('/api/produtos/apoio').set(cabecalho).expect(200)).body as {
      categorias: { id: string }[];
      marcas: { id: string }[];
    };
    const lista = onde === 'categorias' ? apoio.categorias : apoio.marcas;
    expect(lista.some((o) => o.id === criada.id)).toBe(true);

    // O nome é único por empresa, e o erro diz isso em vez de estourar um
    // P2002 sem tradução.
    const repetida = await http
      .post(`/api/produtos/${onde}`)
      .set(cabecalho)
      .send({ nome: nome.toLowerCase() })
      .expect(409);
    expect((repetida.body as { mensagem: string }).mensagem).toContain(nome);

    // Criar nasce com o contrário: ninguém usa, então se exclui.
    await http.delete(`/api/produtos/${onde}/${criada.id}`).set(cabecalho).expect(204);

    const depois = (await http.get('/api/produtos/apoio').set(cabecalho).expect(200)).body as {
      categorias: { id: string }[];
      marcas: { id: string }[];
    };
    const restante = onde === 'categorias' ? depois.categorias : depois.marcas;
    expect(restante.some((o) => o.id === criada.id)).toBe(false);
  });

  it('categoria em uso não se exclui — apagar deixaria produtos órfãos', async () => {
    const sessao = await entrar(ADMIN);
    const cabecalho = { Authorization: `Bearer ${sessao.tokenAcesso}` };

    const apoio = (await http.get('/api/produtos/apoio').set(cabecalho).expect(200)).body as {
      categorias: { id: string; nome: string }[];
    };

    // As do seed têm produto. Usar uma delas prova a recusa sem criar nada.
    const emUso = apoio.categorias[0];
    expect(emUso).toBeDefined();

    const recusa = await http
      .delete(`/api/produtos/categorias/${String(emUso?.id)}`)
      .set(cabecalho)
      .expect(409);

    expect((recusa.body as { codigo: string }).codigo).toBe('CATEGORIA_EM_USO');
  });

  it('categoria em uso se DESATIVA, some das escolhas e volta atrás', async () => {
    /*
      Excluir com vínculo apagaria a categoria de produtos que já a usam, e
      quem olhasse depois não saberia que eles tiveram uma. Desativar é a
      saída: some das escolhas NOVAS, não mexe no passado, e reativa.
    */
    const sessao = await entrar(ADMIN);
    const cabecalho = { Authorization: `Bearer ${sessao.tokenAcesso}` };

    const apoio = (await http.get('/api/produtos/apoio').set(cabecalho).expect(200)).body as {
      categorias: { id: string; nome: string; produtos: number; ativo: boolean }[];
    };

    const alvo = apoio.categorias.find((c) => c.produtos > 0 && c.ativo);
    expect(alvo).toBeDefined();

    await http
      .put(`/api/produtos/categorias/${String(alvo?.id)}/situacao`)
      .set(cabecalho)
      .send({ ativo: false })
      .expect(200);

    // Continua na resposta — a tela precisa dela para o produto que já a usa
    // não mostrar "Não definida" — mas marcada como desativada.
    const desativada = (await http.get('/api/produtos/apoio').set(cabecalho).expect(200)).body as {
      categorias: { id: string; ativo: boolean }[];
    };
    const depois = desativada.categorias.find((c) => c.id === alvo?.id);
    expect(depois?.ativo).toBe(false);

    // E nem assim se exclui: o vínculo continua lá.
    await http
      .delete(`/api/produtos/categorias/${String(alvo?.id)}`)
      .set(cabecalho)
      .expect(409);

    await http
      .put(`/api/produtos/categorias/${String(alvo?.id)}/situacao`)
      .set(cabecalho)
      .send({ ativo: true })
      .expect(200);

    const voltou = (await http.get('/api/produtos/apoio').set(cabecalho).expect(200)).body as {
      categorias: { id: string; ativo: boolean }[];
    };
    expect(voltou.categorias.find((c) => c.id === alvo?.id)?.ativo).toBe(true);
  });

  it('renomear corrige o erro de digitação, e não aceita o nome de outra', async () => {
    /*
      Faltava: dava para criar, desativar e excluir. Um nome errado ficava
      preso — a saída seria criar outra e trocar a de todos os produtos.
    */
    const sessao = await entrar(ADMIN);
    const cabecalho = { Authorization: `Bearer ${sessao.tokenAcesso}` };
    const s = Math.random().toString(36).slice(2, 8).toUpperCase();

    const criada = (
      await http
        .post('/api/produtos/categorias')
        .set(cabecalho)
        .send({ nome: `Kimonoss ${s}` })
        .expect(201)
    ).body as { id: string };

    const corrigida = (
      await http
        .put(`/api/produtos/categorias/${criada.id}`)
        .set(cabecalho)
        .send({ nome: `Kimonos ${s}` })
        .expect(200)
    ).body as { nome: string };

    expect(corrigida.nome).toBe(`Kimonos ${s}`);

    // Renomear para o PRÓPRIO nome não pode colidir consigo mesma.
    await http
      .put(`/api/produtos/categorias/${criada.id}`)
      .set(cabecalho)
      .send({ nome: `Kimonos ${s}` })
      .expect(200);

    // Mas o nome de outra, sim.
    const outra = (
      await http
        .post('/api/produtos/categorias')
        .set(cabecalho)
        .send({ nome: `Faixas ${s}` })
        .expect(201)
    ).body as { id: string };

    await http
      .put(`/api/produtos/categorias/${outra.id}`)
      .set(cabecalho)
      .send({ nome: `kimonos ${s}` })
      .expect(409);

    await http.delete(`/api/produtos/categorias/${criada.id}`).set(cabecalho).expect(204);
    await http.delete(`/api/produtos/categorias/${outra.id}`).set(cabecalho).expect(204);
  });

  it('quem não tem produto.criar não cria categoria', async () => {
    const sessao = await entrar(VENDEDORA);

    await http
      .post('/api/produtos/categorias')
      .set('Authorization', `Bearer ${sessao.tokenAcesso}`)
      .send({ nome: 'Tentativa da vendedora' })
      .expect(403);
  });
});

describe.runIf(temBanco)('cadastro de produto', () => {
  it('recusa quem não tem produto.criar', async () => {
    const sessao = await entrar(VENDEDORA);

    await http
      .post('/api/produtos')
      .set('Authorization', `Bearer ${sessao.tokenAcesso}`)
      .send({
        skuBase: 'NAO-DEVE',
        nome: 'Não deve ser criado',
        variacoes: [{ sku: 'NAO-DEVE-1', descricao: 'única', precoPadrao: '10.00' }],
      })
      .expect(403);
  });

  it('devolve os campos inválidos, em português', async () => {
    const sessao = await entrar(ADMIN);

    const resposta = await http
      .post('/api/produtos')
      .set('Authorization', `Bearer ${sessao.tokenAcesso}`)
      .send({ skuBase: '', nome: '', variacoes: [] })
      .expect(400);

    const campos = resposta.body.campos as { campo: string; problema: string }[];
    expect(campos.map((c) => c.campo)).toContain('skuBase');
    expect(campos.map((c) => c.campo)).toContain('nome');

    const texto = campos.map((c) => c.problema).join(' ');
    expect(texto).toMatch(/[Pp]recisa/);
    expect(texto).not.toMatch(/expected|Too small|characters/i);
  });

  it('cria, e o produto passa a aparecer na listagem', async () => {
    const sessao = await entrar(ADMIN);
    const sufixo = Date.now().toString(36).toUpperCase().slice(-6);
    const sku = `TST-${sufixo}`;

    const criacao = await http
      .post('/api/produtos')
      .set('Authorization', `Bearer ${sessao.tokenAcesso}`)
      .send({
        skuBase: sku,
        nome: `Produto de teste ${sufixo}`,
        variacoes: [
          { sku: `${sku}-A`, descricao: 'Tamanho A', precoPadrao: '99.90' },
          { sku: `${sku}-B`, descricao: 'Tamanho B', precoPadrao: '109.90' },
        ],
      })
      .expect(201);

    expect(criacao.body.id).toBeTruthy();

    const lista = await http
      .get(`/api/produtos?busca=${sku}`)
      .set('Authorization', `Bearer ${sessao.tokenAcesso}`)
      .expect(200);

    const itens = lista.body.itens as (ItemLista & {
      totalVariacoes: number;
      publicadoNoCatalogo: boolean;
      totalFotos: number;
    })[];

    expect(itens).toHaveLength(1);
    expect(itens[0]?.totalVariacoes).toBe(2);
    expect(itens[0]?.saldoTotal).toBe('0');
    // Nasce fora do catálogo: sem foto, não se publica. docs/MEDIA.md §3.
    expect(itens[0]?.totalFotos).toBe(0);
    expect(itens[0]?.publicadoNoCatalogo).toBe(false);
  });

  it('recusa SKU base repetido', async () => {
    const sessao = await entrar(ADMIN);

    await http
      .post('/api/produtos')
      .set('Authorization', `Bearer ${sessao.tokenAcesso}`)
      .send({
        skuBase: 'KIM-TRC',
        nome: 'Tentativa de SKU repetido',
        variacoes: [{ sku: 'KIM-TRC-DUP', descricao: 'dup', precoPadrao: '10.00' }],
      })
      .expect(409);
  });
});
