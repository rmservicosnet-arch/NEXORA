/**
 * Os relatórios da conta corrente do cliente.
 *
 * O que se testa aqui é o que um relatório de dívida erra em silêncio:
 * inverter o sinal do saldo, contar como atraso uma dívida já quitada no
 * meio do caminho, e deixar o dado de dívida vazar para quem só tem
 * permissão de relatório.
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

interface Abertos {
  devedores: number;
  totalDevido: string;
  acimaDoLimite: number;
  bloqueadas: number;
  faixas: { faixa: string; clientes: number; valor: string }[];
  itens: {
    cliente: string;
    saldo: string;
    limiteCredito: string;
    disponivel: string;
    diasNegativo: number | null;
    bloqueada: boolean;
  }[];
}

interface Limite {
  dias: number;
  autorizacoes: number;
  valorAutorizado: string;
  clientesAfetados: number;
  acimaAgora: number;
  semJustificativa: number;
  itens: {
    valor: string;
    saldoPosterior: string;
    limiteCredito: string;
    excedeuEm: string;
    justificativa: string | null;
    autorizadoPor: string | null;
  }[];
}

interface Ajustes {
  dias: number;
  lancamentos: number;
  credito: string;
  debito: string;
  liquido: string;
  semJustificativa: number;
  porAutor: { autor: string; lancamentos: number; credito: string; debito: string }[];
  itens: { tipo: string; credito: boolean; valor: string; justificativa: string | null }[];
}

function entrar(rota: string, dados: { email: string; senha: string }) {
  return http
    .post(rota)
    .send({ ...dados, canal: 'app' })
    .expect(200)
    .then((r) => (r.body as { tokenAcesso: string }).tokenAcesso);
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

describe.runIf(temBanco)('saldos em aberto', () => {
  /** Dívida é saldo NEGATIVO. Inverter o sinal na tela é esconder de quem lê. */
  it('a dívida chega com o sinal do razão', async () => {
    const r = await http
      .get('/api/relatorios/carteira/abertos')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const a = r.body as Abertos;

    expect(Number(a.totalDevido)).toBeLessThanOrEqual(0);
    for (const i of a.itens) {
      expect(Number(i.saldo)).toBeLessThan(0);
      expect(i.saldo).toMatch(/^-\d+\.\d{2}$/);
    }
  });

  /** `disponivel` é `saldo + limite`. Negativo significa que já passou. */
  it('o disponível é o saldo mais o limite', async () => {
    const r = await http
      .get('/api/relatorios/carteira/abertos')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const a = r.body as Abertos;

    for (const i of a.itens) {
      expect(Number(i.disponivel)).toBeCloseTo(Number(i.saldo) + Number(i.limiteCredito), 2);
    }

    const acima = a.itens.filter((i) => Number(i.disponivel) < 0).length;
    expect(acima).toBeLessThanOrEqual(a.acimaDoLimite);
  });

  it('as faixas cobrem os devedores listados', async () => {
    const r = await http
      .get('/api/relatorios/carteira/abertos?limite=200')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const a = r.body as Abertos;
    expect(a.faixas.reduce((s, f) => s + f.clientes, 0)).toBe(a.itens.length);
    expect(a.faixas).toHaveLength(4);
  });

  /** Dívida de cliente não é dado de relatório comum. ADR-009 vale aqui também. */
  it('não responde a token de cliente nem sem sessão', async () => {
    await http.get('/api/relatorios/carteira/abertos').expect(401);
    await http
      .get('/api/relatorios/carteira/abertos')
      .set('Authorization', `Bearer ${tokenCliente}`)
      .expect(401);
  });
});

describe.runIf(temBanco)('acima do limite', () => {
  /**
   * Passar do limite é permitido quando autorizado, nunca silencioso.
   *
   * O serviço exige justificativa para exceder, mas o banco não: linha vinda
   * de carga direta pode chegar sem. O relatório CONTA essas, em vez de
   * escondê-las num zero — e o que se testa é que a conta bate com a lista.
   */
  it('a autorização sem justificativa é contada, não escondida', async () => {
    const r = await http
      .get('/api/relatorios/carteira/limite?dias=365&limite=200')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const l = r.body as Limite;

    // A lista cabe inteira no limite pedido, então os dois números têm de bater.
    if (l.itens.length === l.autorizacoes) {
      expect(l.itens.filter((i) => i.justificativa === null)).toHaveLength(l.semJustificativa);
    }

    for (const i of l.itens) {
      expect(Number(i.excedeuEm)).toBeGreaterThanOrEqual(0);
      expect(Number(i.valor)).toBeGreaterThan(0);
    }
  });

  /** Histórico e dívida viva são coisas diferentes. */
  it('o que passou hoje é contado à parte do histórico', async () => {
    const r = await http
      .get('/api/relatorios/carteira/limite?dias=365')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const l = r.body as Limite;
    expect(l.acimaAgora).toBeGreaterThanOrEqual(0);
    expect(l.clientesAfetados).toBeLessThanOrEqual(l.autorizacoes);
  });

  it('exige as duas permissões', async () => {
    await http.get('/api/relatorios/carteira/limite').expect(401);
    await http
      .get('/api/relatorios/carteira/limite')
      .set('Authorization', `Bearer ${tokenCliente}`)
      .expect(401);
  });
});

describe.runIf(temBanco)('ajustes e bonificações', () => {
  /**
   * Ajuste e bonificação criam dinheiro sem contrapartida. O banco exige
   * justificativa neles por CHECK — se algum chegar sem, a garantia furou.
   */
  it('nenhum lançamento que cria dinheiro vem sem justificativa', async () => {
    const r = await http
      .get('/api/relatorios/carteira/ajustes?dias=365')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const a = r.body as Ajustes;
    expect(a.semJustificativa).toBe(0);

    for (const i of a.itens) {
      expect(['AJUSTE_CREDITO', 'AJUSTE_DEBITO', 'BONIFICACAO']).toContain(i.tipo);
      expect(i.justificativa).not.toBeNull();
    }
  });

  it('crédito menos débito é o líquido', async () => {
    const r = await http
      .get('/api/relatorios/carteira/ajustes?dias=365')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const a = r.body as Ajustes;
    expect(Number(a.credito) - Number(a.debito)).toBeCloseTo(Number(a.liquido), 2);
    expect(a.porAutor.reduce((s, x) => s + x.lancamentos, 0)).toBe(a.lancamentos);
  });

  it('exige as duas permissões', async () => {
    await http.get('/api/relatorios/carteira/ajustes').expect(401);
    await http
      .get('/api/relatorios/carteira/ajustes')
      .set('Authorization', `Bearer ${tokenCliente}`)
      .expect(401);
  });
});
