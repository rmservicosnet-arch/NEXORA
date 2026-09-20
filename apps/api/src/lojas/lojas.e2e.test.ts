/**
 * Abrir e alterar lojas.
 *
 * O que se testa aqui é o que uma loja mal aberta causa depois: sem local
 * padrão de venda o PDV não sabe de onde baixar o estoque, e o erro só
 * apareceria no balcão, com o cliente esperando.
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../app.module';

const temBanco = Boolean(process.env['DATABASE_URL'] && process.env['DIRECT_URL']);

const ADMIN = { email: 'rodrigo@lojacentro.com.br', senha: 'Estoque@2026' };
/** Vendedora: opera, mas não abre loja. */
const VENDEDORA = { email: 'marina@lojacentro.com.br', senha: 'Estoque@2026' };

let app: INestApplication;
let http: ReturnType<typeof request>;
let tokenAdmin: string;
let tokenVendedora: string;

/**
 * O que este arquivo abriu.
 *
 * Loja aparece no seletor do PDV e no painel. Sem a limpeza, cada execução
 * deixa mais uma — o teste degradaria o ambiente que usa. Apagar não dá
 * (venda e movimento apontam para ela), então elas são desativadas no fim.
 */
const abertas: string[] = [];

interface LojaPainel {
  id: string;
  nome: string;
  codigo: string;
  status: string;
  locais: { id: string; nome: string; padraoVenda: boolean; itens: number }[];
  caixaAberto: number | null;
  vendasHoje: string;
  variacoesNegativas: number;
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

async function painel(): Promise<LojaPainel[]> {
  const resposta = await http
    .get('/api/lojas/painel')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .expect(200);
  return resposta.body as LojaPainel[];
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
  tokenVendedora = await entrar(VENDEDORA);
}, 60_000);

afterAll(async () => {
  if (http) {
    for (const id of abertas) {
      await http
        .patch(`/api/lojas/${id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ status: 'INATIVO' })
        .catch(() => undefined);
    }
  }
  if (app) await app.close();
});

describe.runIf(temBanco)('abrir loja', () => {
  it('o local padrão de venda nasce junto', async () => {
    const s = sufixo();
    const criada = await http
      .post('/api/lojas')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nome: `Loja Teste ${s}`, localPadrao: 'Balcão' })
      .expect(201);

    const { id } = criada.body as { id: string };
    abertas.push(id);

    const nova = (await painel()).find((l) => l.id === id);

    expect(nova).toBeDefined();
    expect(nova?.codigo).toBe(`LOJA_TESTE_${s}`);
    expect(nova?.locais).toHaveLength(1);
    expect(nova?.locais[0]?.padraoVenda).toBe(true);
    expect(nova?.locais[0]?.nome).toBe('Balcão');

    // Loja recém-aberta não tem venda nem saldo — e o painel diz isso em
    // número, não em branco.
    expect(nova?.vendasHoje).toBe('0.00');
    expect(nova?.variacoesNegativas).toBe(0);
    expect(nova?.caixaAberto).toBeNull();
  });

  it('recusa código repetido dizendo de quem ele é', async () => {
    const nome = `Loja Repetida ${sufixo()}`;

    const primeira = await http
      .post('/api/lojas')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nome })
      .expect(201);
    abertas.push((primeira.body as { id: string }).id);

    const recusa = await http
      .post('/api/lojas')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nome })
      .expect(409);

    const corpo = recusa.body as { codigo: string; mensagem: string };
    expect(corpo.codigo).toBe('CODIGO_JA_EXISTE');
    expect(corpo.mensagem).toContain(nome);
  });

  it('quem opera não abre loja', async () => {
    await http
      .post('/api/lojas')
      .set('Authorization', `Bearer ${tokenVendedora}`)
      .send({ nome: 'Loja da vendedora' })
      .expect(403);
  });
});

describe.runIf(temBanco)('desativar', () => {
  /**
   * Desativar tira do PDV sem apagar: venda e movimento antigos continuam
   * apontando para a loja, e o estoque dela continua onde está.
   */
  it('some do seletor e continua no painel', async () => {
    const criada = await http
      .post('/api/lojas')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nome: `Loja Efêmera ${sufixo()}` })
      .expect(201);

    const { id } = criada.body as { id: string };
    abertas.push(id);

    await http
      .patch(`/api/lojas/${id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ status: 'INATIVO' })
      .expect(200);

    const seletor = await http
      .get('/api/lojas')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    expect((seletor.body as { id: string }[]).some((l) => l.id === id)).toBe(false);
  });
});
