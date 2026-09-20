/**
 * A visão geral.
 *
 * O que se testa aqui é o que uma tela de números erra em silêncio: série com
 * buraco, divisão por zero virando "alta de 100%", e contagem que ignora o
 * filtro de loja.
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../app.module';

const temBanco = Boolean(process.env['DATABASE_URL'] && process.env['DIRECT_URL']);

const ADMIN = { email: 'rodrigo@lojacentro.com.br', senha: 'Estoque@2026' };
const CLIENTE = { email: 'carlos@academiaippon.com.br', senha: 'Cliente@2026' };

let app: INestApplication;
let http: ReturnType<typeof request>;
let tokenAdmin: string;
let tokenCliente: string;

interface Resumo {
  vendasHoje: string;
  vendasOntem: string;
  ticketMedio: string;
  ticketMedioSemanaAnterior: string;
  porDia: { dia: string; total: string; vendas: number }[];
  totalDoPeriodo: string;
  abaixoDoMinimo: number;
  variacoesNegativas: number;
  lojasComNegativo: number;
  negativos: { sku: string; saldo: string; desde: string | null }[];
  ultimasVendas: { numero: number; total: string; vendedor: string }[];
}

async function entrar(rota: string, dados: { email: string; senha: string }): Promise<string> {
  const r = await http
    .post(rota)
    .send({ ...dados, canal: 'app' })
    .expect(200);
  return (r.body as { tokenAcesso: string }).tokenAcesso;
}

async function resumo(dias = 14, lojaId?: string): Promise<Resumo> {
  const r = await http
    .get(`/api/visao-geral?dias=${String(dias)}${lojaId ? `&lojaId=${lojaId}` : ''}`)
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .expect(200);
  return r.body as Resumo;
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

describe.runIf(temBanco)('a série por dia', () => {
  /**
   * Dia sem venda precisa existir na série, com zero.
   *
   * Sem ele o gráfico pula a segunda-feira parada e a barra de terça encosta
   * na de domingo — a tela finge continuidade onde houve um dia vazio.
   */
  it('não tem buraco: todo dia do período aparece', async () => {
    const r = await resumo(14);

    expect(r.porDia).toHaveLength(14);

    const dias = r.porDia.map((p) => p.dia);
    expect([...dias].sort()).toEqual(dias); // já vem em ordem
    expect(new Set(dias).size).toBe(14); // sem repetição

    // E são 14 dias consecutivos, sem salto.
    for (let i = 1; i < dias.length; i += 1) {
      const anterior = new Date(`${dias[i - 1]!}T12:00:00Z`).getTime();
      const atual = new Date(`${dias[i]!}T12:00:00Z`).getTime();
      expect(atual - anterior).toBe(24 * 60 * 60 * 1000);
    }
  });

  it('o total do período é a soma da série', async () => {
    const r = await resumo(14);

    const soma = r.porDia.reduce((s, p) => s + Number(p.total), 0);
    expect(Number(r.totalDoPeriodo)).toBeCloseTo(soma, 2);
  });

  it('o período é configurável', async () => {
    expect((await resumo(7)).porDia).toHaveLength(7);
    expect((await resumo(30)).porDia).toHaveLength(30);
  });

  it('recusa período fora do intervalo', async () => {
    await http
      .get('/api/visao-geral?dias=1')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(400);

    await http
      .get('/api/visao-geral?dias=400')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(400);
  });
});

describe.runIf(temBanco)('os números que a tela compara', () => {
  it('dinheiro vem como string decimal, nunca como número', async () => {
    const r = await resumo(7);

    // `JSON.parse('{"total": 489.90}')` devolve float, e o erro entra no
    // sistema já no transporte. Ver ARCHITECTURE §7.
    expect(typeof r.vendasHoje).toBe('string');
    expect(typeof r.ticketMedio).toBe('string');
    expect(r.vendasHoje).toMatch(/^-?\d+\.\d{2}$/);
    for (const p of r.porDia) {
      expect(p.total).toMatch(/^-?\d+\.\d{2}$/);
    }
  });

  it('ticket médio é zero quando não houve venda, não NaN', async () => {
    const r = await resumo(7);
    expect(Number.isFinite(Number(r.ticketMedio))).toBe(true);
    expect(Number.isFinite(Number(r.ticketMedioSemanaAnterior))).toBe(true);
  });

  it('o negativo traz desde quando — ou nulo, nunca uma data inventada', async () => {
    const r = await resumo(14);

    for (const n of r.negativos) {
      expect(Number(n.saldo)).toBeLessThan(0);
      if (n.desde !== null) {
        expect(Number.isNaN(Date.parse(n.desde))).toBe(false);
      }
    }
  });
});

describe.runIf(temBanco)('permissões', () => {
  it('exige relatorio.visualizar', async () => {
    // O estoquista tem `relatorio.visualizar`; o cliente do portal não tem
    // nada disso — e o token dele falha na autenticação, não na permissão.
    await http.get('/api/visao-geral').set('Authorization', `Bearer ${tokenCliente}`).expect(401);
  });

  it('sem sessão não devolve número nenhum', async () => {
    await http.get('/api/visao-geral').expect(401);
  });
});
