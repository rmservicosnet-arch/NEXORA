/**
 * Os dois relatórios construídos.
 *
 * O que se testa aqui é o que um relatório erra em silêncio: patrimônio
 * somado só pelos positivos, margem de 100% em item sem custo, curva ABC
 * classificada pela página em vez do conjunto, e custo viajando para quem
 * não pode vê-lo.
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../app.module';

const temBanco = Boolean(process.env['DATABASE_URL'] && process.env['DIRECT_URL']);

const ADMIN = { email: 'rodrigo@lojacentro.com.br', senha: 'Estoque@2026' };
/** Vendedora: vê relatório, não vê custo. */
const VENDEDORA = { email: 'marina@lojacentro.com.br', senha: 'Estoque@2026' };
const CLIENTE = { email: 'carlos@academiaippon.com.br', senha: 'Cliente@2026' };

let app: INestApplication;
let http: ReturnType<typeof request>;
let tokenAdmin: string;
let tokenVendedora: string;
let tokenCliente: string;

interface Posicao {
  em: string;
  variacoes: number;
  produtos: number;
  unidades: string;
  abaixoDoMinimo: number;
  comSaldoNegativo: number;
  valorPositivos?: string;
  efeitoNegativos?: string;
  valorLiquido?: string;
  itens: {
    sku: string;
    saldo: string;
    estoqueMinimo: string;
    abaixoDoMinimo: boolean;
    custoMedio?: string;
    valor?: string;
    abc: 'A' | 'B' | 'C' | null;
  }[];
  totalExibido: { unidades: string; valor?: string };
}

interface Vendas {
  de: string;
  ate: string;
  total: string;
  vendas: number;
  ticketMedio: string;
  mediaDiaria: string;
  margem?: string | null;
  porDia: { dia: string; total: string; vendas: number }[];
  formasPagamento: { forma: string; total: string; participacao: string }[];
  porLoja: { loja: string; total: string; participacao: string }[];
  dimensao: string;
  ranking: { nome: string; valor: string; participacao: string; margem?: string | null }[];
}

async function entrar(rota: string, dados: { email: string; senha: string }): Promise<string> {
  const r = await http
    .post(rota)
    .send({ ...dados, canal: 'app' })
    .expect(200);
  return (r.body as { tokenAcesso: string }).tokenAcesso;
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
  tokenVendedora = await entrar('/api/auth/login', VENDEDORA);
  tokenCliente = await entrar('/api/portal/auth/login', CLIENTE);
}, 60_000);

afterAll(async () => {
  if (app) await app.close();
});

describe.runIf(temBanco)('posição de estoque', () => {
  /**
   * Saldo negativo é mercadoria que já saiu e não foi baixada. Somar só os
   * positivos declara um patrimônio maior do que existe — e a diferença é
   * exatamente o que a tela precisa mostrar.
   */
  it('o valor líquido é positivos MAIS negativos, com sinal', async () => {
    const r = await http
      .get('/api/relatorios/posicao-estoque?limite=20')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const p = r.body as Posicao;

    expect(p.valorPositivos).toBeDefined();
    expect(Number(p.valorPositivos)).toBeGreaterThanOrEqual(0);
    // O efeito dos negativos é negativo ou zero — nunca positivo.
    expect(Number(p.efeitoNegativos)).toBeLessThanOrEqual(0);

    const liquido = Number(p.valorPositivos) + Number(p.efeitoNegativos);
    expect(Number(p.valorLiquido)).toBeCloseTo(liquido, 2);
  });

  it('dinheiro vem como string decimal, nunca como número', async () => {
    const r = await http
      .get('/api/relatorios/posicao-estoque?limite=5')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const p = r.body as Posicao;
    expect(typeof p.valorLiquido).toBe('string');
    expect(p.valorLiquido).toMatch(/^-?\d+\.\d{2}$/);
    for (const i of p.itens) {
      expect(i.valor).toMatch(/^-?\d+\.\d{2}$/);
    }
  });

  /**
   * A curva sai da participação ACUMULADA no conjunto inteiro. Classificar
   * pela página daria "A" para todos os itens da primeira página.
   */
  it('a curva sai do conjunto, não da página', async () => {
    const grande = await http
      .get('/api/relatorios/posicao-estoque?limite=200')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const p = grande.body as Posicao;

    // Vem ordenado por valor, decrescente: a curva depende disso.
    const valores = p.itens.map((i) => Number(i.valor));
    expect([...valores].sort((a, b) => b - a)).toEqual(valores);

    // A acumulada só cresce, então a letra nunca volta: A, depois B, depois C.
    const ordem = { A: 0, B: 1, C: 2 } as const;
    let anterior = 0;
    for (const i of p.itens) {
      const atual = ordem[i.abc ?? 'A'];
      expect(atual).toBeGreaterThanOrEqual(anterior);
      anterior = atual;
    }

    /*
      A prova de que a classificação NÃO é feita pela página: os mesmos itens,
      pedidos numa página de 5, recebem as mesmas letras. Classificar pelo que
      chegou daria "A" para os cinco.
    */
    const pequena = await http
      .get('/api/relatorios/posicao-estoque?limite=5')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const cinco = (pequena.body as Posicao).itens;
    for (const [indice, item] of cinco.entries()) {
      expect(item.sku).toBe(p.itens[indice]?.sku);
      expect(item.abc).toBe(p.itens[indice]?.abc);
    }
  });

  it('o recorte de negativos traz só o que está abaixo de zero', async () => {
    const r = await http
      .get('/api/relatorios/posicao-estoque?recorte=negativos&limite=30')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const p = r.body as Posicao;
    for (const i of p.itens) {
      expect(Number(i.saldo)).toBeLessThan(0);
    }
  });

  /**
   * Sem `relatorio.ver_custo` o custo não vem VAZIO: não vem. Mandar `null`
   * e esconder na tela deixaria o número na resposta, a um F12 de distância.
   */
  it('quem não tem permissão de custo não recebe custo nem valor', async () => {
    const r = await http
      .get('/api/relatorios/posicao-estoque?limite=10')
      .set('Authorization', `Bearer ${tokenVendedora}`)
      .expect(200);

    const p = r.body as Posicao;
    expect(p.valorPositivos).toBeUndefined();
    expect(p.valorLiquido).toBeUndefined();

    for (const i of p.itens) {
      expect(i.custoMedio).toBeUndefined();
      expect(i.valor).toBeUndefined();
      expect(i.abc).toBeNull();
    }

    // O texto inteiro da resposta não pode conter a chave.
    expect(JSON.stringify(p)).not.toContain('custoMedio');
  });
});

describe.runIf(temBanco)('vendas no período', () => {
  it('a série por dia não tem buraco', async () => {
    const r = await http
      .get('/api/relatorios/vendas?dias=14')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const v = r.body as Vendas;
    expect(v.porDia).toHaveLength(14);

    const dias = v.porDia.map((p) => p.dia);
    expect(new Set(dias).size).toBe(14);

    for (let i = 1; i < dias.length; i += 1) {
      const anterior = new Date(`${dias[i - 1]!}T12:00:00Z`).getTime();
      const atual = new Date(`${dias[i]!}T12:00:00Z`).getTime();
      expect(atual - anterior).toBe(24 * 60 * 60 * 1000);
    }
  });

  it('o total é a soma da série, e a média diária o divide pelo período', async () => {
    const r = await http
      .get('/api/relatorios/vendas?dias=14')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const v = r.body as Vendas;
    const soma = v.porDia.reduce((s, p) => s + Number(p.total), 0);

    expect(Number(v.total)).toBeCloseTo(soma, 2);
    expect(Number(v.mediaDiaria)).toBeCloseTo(soma / 14, 2);
  });

  it('as participações somam 100 — ou zero, quando não houve venda', async () => {
    const r = await http
      .get('/api/relatorios/vendas?dias=30')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const v = r.body as Vendas;

    for (const grupo of [v.formasPagamento, v.porLoja, v.ranking]) {
      if (grupo.length === 0) continue;
      const soma = grupo.reduce((s, l) => s + Number(l.participacao), 0);
      // Uma casa decimal por linha: o arredondamento cabe em ±0,5.
      expect(soma).toBeGreaterThan(99);
      expect(soma).toBeLessThan(101);
    }
  });

  it('cada dimensão devolve o próprio ranking', async () => {
    for (const dimensao of ['vendedor', 'produto', 'cliente', 'tabela', 'categoria']) {
      const r = await http
        .get(`/api/relatorios/vendas?dias=30&dimensao=${dimensao}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200);

      const v = r.body as Vendas;
      expect(v.dimensao).toBe(dimensao);

      // Vem ordenado por valor, decrescente.
      const valores = v.ranking.map((l) => Number(l.valor));
      expect([...valores].sort((a, b) => b - a)).toEqual(valores);
    }
  });

  /**
   * Custo zero não é margem de 100%: é item que nunca teve entrada com
   * custo. Dizer 100% seria inventar lucro.
   */
  it('margem é nula onde não há custo, nunca 100%', async () => {
    const r = await http
      .get('/api/relatorios/vendas?dias=90&dimensao=produto')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const v = r.body as Vendas;
    for (const l of v.ranking) {
      if (l.margem === null || l.margem === undefined) continue;
      expect(Number(l.margem)).toBeLessThan(100);
    }
  });

  it('quem não tem permissão de custo não recebe margem', async () => {
    const r = await http
      .get('/api/relatorios/vendas?dias=14')
      .set('Authorization', `Bearer ${tokenVendedora}`)
      .expect(200);

    const v = r.body as Vendas;
    expect(v.margem).toBeUndefined();
    for (const l of v.ranking) {
      expect(l.margem).toBeUndefined();
    }
  });

  it('recusa período fora do intervalo', async () => {
    await http
      .get('/api/relatorios/vendas?dias=0')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(400);

    await http
      .get('/api/relatorios/vendas?dias=400')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(400);
  });
});

describe.runIf(temBanco)('permissões', () => {
  it('sem sessão não devolve número nenhum', async () => {
    await http.get('/api/relatorios/posicao-estoque').expect(401);
    await http.get('/api/relatorios/vendas').expect(401);
  });

  /** Token do outro domínio falha na AUTENTICAÇÃO — 401, não 403. ADR-009. */
  it('token de cliente é recusado', async () => {
    await http
      .get('/api/relatorios/vendas')
      .set('Authorization', `Bearer ${tokenCliente}`)
      .expect(401);
  });
});
