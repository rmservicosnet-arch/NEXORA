/**
 * As tabelas de preço.
 *
 * Existiam só no seed: quatro, fixas, sem como criar a quinta nem aposentar
 * nenhuma. O que se testa aqui é o que dá errado quando se mexe nelas —
 * desativar uma tabela em uso deixa cadastros sem catálogo, e duas padrão ao
 * mesmo tempo fazem o sistema escolher qualquer uma.
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../app.module';

const temBanco = Boolean(process.env['DATABASE_URL'] && process.env['DIRECT_URL']);

const ADMIN = { email: 'rodrigo@lojacentro.com.br', senha: 'Estoque@2026' };
/** Estoquista: não tem `preco.editar`. */
const ESTOQUISTA = { email: 'luan@lojacentro.com.br', senha: 'Estoque@2026' };

let app: INestApplication;
let http: ReturnType<typeof request>;
let tokenAdmin: string;
let tokenEstoquista: string;

/**
 * O que este arquivo criou.
 *
 * Tabela ativa aparece na grade de preço de TODO produto. Sem a limpeza,
 * cada execução deixa mais uma "Promovida XYZ" no aviso "sem preço em…" —
 * o teste degrada o ambiente que usa. Apagar não dá (não há rota, e seria
 * destrutivo), então elas são desativadas no fim.
 */
const criadas: string[] = [];

interface Tabela {
  id: string;
  nome: string;
  chave: string;
  padrao: boolean;
  status: string;
  itensComPreco: number;
  clientes: number;
}

function sufixo(): string {
  return Math.random().toString(36).toUpperCase().slice(2, 8);
}

async function entrar(dados: { email: string; senha: string }): Promise<string> {
  const resposta = await http
    .post('/api/auth/login')
    .send({ ...dados, canal: 'app' })
    .expect(200);
  return (resposta.body as { tokenAcesso: string }).tokenAcesso;
}

async function listar(): Promise<Tabela[]> {
  const resposta = await http
    .get('/api/tabelas-preco')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .expect(200);
  return resposta.body as Tabela[];
}

async function criar(nome: string): Promise<string> {
  const resposta = await http
    .post('/api/tabelas-preco')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send({ nome })
    .expect(201);
  const id = (resposta.body as { id: string }).id;
  criadas.push(id);
  return id;
}

beforeAll(async () => {
  if (!temBanco) return;

  const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = modulo.createNestApplication();
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  await app.init();

  http = request(app.getHttpServer());
  tokenAdmin = await entrar(ADMIN);
  tokenEstoquista = await entrar(ESTOQUISTA);
}, 60_000);

afterAll(async () => {
  if (http) {
    for (const id of criadas) {
      // A padrão recusa desativação; a que ficou com cadastro também. Falhar
      // aqui não pode derrubar a suíte — a limpeza é higiene, não asserção.
      await http
        .patch(`/api/tabelas-preco/${id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ status: 'INATIVO' })
        .catch(() => undefined);
    }
  }
  if (app) await app.close();
});

describe.runIf(temBanco)('criar tabela', () => {
  it('a chave sai do nome, sem acento e sem espaço', async () => {
    const s = sufixo();
    const id = await criar(`Revendedor Atacado ${s}`);

    const criada = (await listar()).find((t) => t.id === id);
    expect(criada?.chave).toBe(`REVENDEDOR_ATACADO_${s}`);
    // Nasce ativa, vazia e não padrão: nada é inventado.
    expect(criada?.padrao).toBe(false);
    expect(criada?.status).toBe('ATIVO');
    expect(criada?.itensComPreco).toBe(0);
  });

  it('recusa chave repetida dizendo qual tabela já a tem', async () => {
    const nome = `Repetida ${sufixo()}`;
    await criar(nome);

    const recusa = await http
      .post('/api/tabelas-preco')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nome })
      .expect(409);

    const corpo = recusa.body as { codigo: string; mensagem: string };
    expect(corpo.codigo).toBe('CHAVE_JA_EXISTE');
    expect(corpo.mensagem).toContain(nome);
  });
});

describe.runIf(temBanco)('padrão é uma só', () => {
  it('promover rebaixa a anterior', async () => {
    const antes = await listar();
    const padraoOriginal = antes.find((t) => t.padrao)!;
    const nova = await criar(`Promovida ${sufixo()}`);

    await http
      .patch(`/api/tabelas-preco/${nova}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ padrao: true })
      .expect(200);

    const depois = await listar();
    const padroes = depois.filter((t) => t.padrao);

    // Duas padrão ao mesmo tempo fariam `findFirst({ padrao: true })` — que é
    // como o resto do sistema a encontra — devolver qualquer uma das duas.
    expect(padroes).toHaveLength(1);
    expect(padroes[0]?.id).toBe(nova);

    // Devolve o estado: a tabela padrão do seed é usada por outros testes.
    await http
      .patch(`/api/tabelas-preco/${padraoOriginal.id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ padrao: true })
      .expect(200);

    expect((await listar()).filter((t) => t.padrao)[0]?.id).toBe(padraoOriginal.id);
  });

  it('a padrão não pode ser desativada', async () => {
    const padrao = (await listar()).find((t) => t.padrao)!;

    const recusa = await http
      .patch(`/api/tabelas-preco/${padrao.id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ status: 'INATIVO' })
      .expect(409);

    expect((recusa.body as { codigo: string }).codigo).toBe('TABELA_PADRAO_NAO_INATIVA');
  });
});

describe.runIf(temBanco)('desativar', () => {
  it('tabela vazia e sem cadastro desativa', async () => {
    const id = await criar(`Descartavel ${sufixo()}`);

    await http
      .patch(`/api/tabelas-preco/${id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ status: 'INATIVO' })
      .expect(200);

    expect((await listar()).find((t) => t.id === id)?.status).toBe('INATIVO');
  });

  /**
   * O vínculo do cliente continua apontando para a tabela desativada, e o
   * catálogo lê `cliente.tabelaPrecoId` sem conferir status — então o cliente
   * não veria erro, veria uma loja vazia. Recusar dizendo QUANTOS são é mais
   * útil do que deixar acontecer e esperar o telefonema.
   */
  it('tabela em uso é recusada, com a contagem', async () => {
    const id = await criar(`Em uso ${sufixo()}`);

    const cliente = (
      await http
        .post('/api/clientes')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ nome: `Cliente da tabela ${sufixo()}`, tabelaPrecoId: id })
        .expect(201)
    ).body as { id: string };

    const recusa = await http
      .patch(`/api/tabelas-preco/${id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ status: 'INATIVO' })
      .expect(409);

    const corpo = recusa.body as { codigo: string; mensagem: string };
    expect(corpo.codigo).toBe('TABELA_EM_USO');
    expect(corpo.mensagem).toContain('1 cadastro usa');

    // Movido o cadastro, a desativação passa.
    await http
      .patch(`/api/clientes/${cliente.id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ tabelaPrecoId: null })
      .expect(200);

    await http
      .patch(`/api/tabelas-preco/${id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ status: 'INATIVO' })
      .expect(200);
  });
});

describe.runIf(temBanco)('permissões', () => {
  it('quem não tem preco.editar não cria nem altera', async () => {
    await http
      .post('/api/tabelas-preco')
      .set('Authorization', `Bearer ${tokenEstoquista}`)
      .send({ nome: 'Tentativa do estoquista' })
      .expect(403);

    const alguma = (await listar())[0]!;

    await http
      .patch(`/api/tabelas-preco/${alguma.id}`)
      .set('Authorization', `Bearer ${tokenEstoquista}`)
      .send({ nome: 'Renomeada indevidamente' })
      .expect(403);
  });
});
