/**
 * Os relatórios sobre a própria trilha.
 *
 * O que se testa aqui é o que uma auditoria erra em silêncio: despejar dois
 * JSON em vez de dizer o que mudou, marcar como "levou custo" um arquivo que
 * só tinha uma coluna chamada assim, e deixar a trilha visível para quem tem
 * permissão de relatório mas não de auditoria.
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../app.module';

const temBanco = Boolean(process.env['DATABASE_URL'] && process.env['DIRECT_URL']);

const ADMIN = { email: 'rodrigo@lojacentro.com.br', senha: 'Estoque@2026' };
/** Vendedora: vê relatório, não audita. */
const VENDEDORA = { email: 'marina@lojacentro.com.br', senha: 'Estoque@2026' };
const CLIENTE = { email: 'carlos@academiaippon.com.br', senha: 'Cliente@2026' };

let app: INestApplication;
let http: ReturnType<typeof request>;
let tokenAdmin: string;
let tokenVendedora: string;
let tokenCliente: string;

interface Trilha {
  dias: number;
  entidade: string | null;
  entidadeId: string | null;
  registros: number;
  entidades: { entidade: string; registros: number }[];
  itens: {
    acao: string;
    entidade: string;
    entidadeId: string | null;
    ator: string | null;
    motivo: string | null;
    mudancas: { campo: string; antes: string; depois: string }[];
  }[];
}

interface Sensiveis {
  dias: number;
  registros: number;
  atores: number;
  semMotivo: number;
  porAcao: { acao: string; registros: number }[];
  porAtor: { ator: string; registros: number; semMotivo: number }[];
  itens: { acao: string; motivo: string | null }[];
}

interface Acessos {
  dias: number;
  exportacoes: number;
  comCusto: number;
  linhasExportadas: number;
  crossTenant: number;
  reusoDeToken: number;
  porAtor: { ator: string; exportacoes: number; comCusto: number }[];
  itens: {
    acao: string;
    ator: string | null;
    relatorio: string | null;
    linhas: number | null;
    comCusto: boolean;
  }[];
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
  tokenVendedora = await entrar('/api/auth/login', VENDEDORA);
  tokenCliente = await entrar('/api/portal/auth/login', CLIENTE);
}, 60_000);

afterAll(async () => {
  if (app) await app.close();
});

describe.runIf(temBanco)('trilha por entidade', () => {
  /**
   * Antes e depois viram a lista dos campos que MUDARAM. Despejar os dois
   * JSON faz quem audita comparar chave a chave — e é aí que passa batido.
   */
  it('só os campos que mudaram aparecem na trilha', async () => {
    const r = await http
      .get('/api/relatorios/auditoria/trilha?dias=365&limite=60')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    for (const i of (r.body as Trilha).itens) {
      for (const m of i.mudancas) {
        expect(m.antes).not.toBe(m.depois);
        expect(m.campo.length).toBeGreaterThan(0);
      }
    }
  });

  /** Decorar `movimento_estoque` para digitar no filtro não é interface. */
  it('as entidades disponíveis vêm com a resposta', async () => {
    const r = await http
      .get('/api/relatorios/auditoria/trilha?dias=365')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const t = r.body as Trilha;
    expect(t.entidades.length).toBeGreaterThan(0);
    for (const e of t.entidades) expect(e.registros).toBeGreaterThan(0);
  });

  it('o filtro de entidade recorta de verdade', async () => {
    const todas = await http
      .get('/api/relatorios/auditoria/trilha?dias=365')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const alvo = (todas.body as Trilha).entidades[0];
    if (!alvo) return;

    const r = await http
      .get(`/api/relatorios/auditoria/trilha?dias=365&entidade=${alvo.entidade}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const t = r.body as Trilha;
    expect(t.registros).toBe(alvo.registros);
    expect(t.registros).toBeLessThanOrEqual((todas.body as Trilha).registros);
    for (const i of t.itens) expect(i.entidade).toBe(alvo.entidade);
  });

  /** A trilha diz o que cada pessoa fez. Ver relatório não é auditar. */
  it('a vendedora não lê a trilha', async () => {
    await http
      .get('/api/relatorios/auditoria/trilha')
      .set('Authorization', `Bearer ${tokenVendedora}`)
      .expect(403);

    await http.get('/api/relatorios/auditoria/trilha').expect(401);
    await http
      .get('/api/relatorios/auditoria/trilha')
      .set('Authorization', `Bearer ${tokenCliente}`)
      .expect(401);
  });
});

describe.runIf(temBanco)('ações sensíveis', () => {
  /**
   * Lista explícita, não prefixo: `LIKE 'CARTEIRA_%'` passaria a incluir toda
   * ação futura de carteira sem ninguém decidir isso.
   */
  it('só traz ações da lista sensível', async () => {
    const r = await http
      .get('/api/relatorios/auditoria/sensiveis?dias=365')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const s = r.body as Sensiveis;
    const permitidas = new Set(s.porAcao.map((a) => a.acao));

    for (const i of s.itens) expect(permitidas.has(i.acao)).toBe(true);
    expect(permitidas.has('VENDA_CONCLUIDA')).toBe(false);
    expect(permitidas.has('PRODUTO_CRIADO')).toBe(false);
  });

  it('os totais batem com os agrupamentos', async () => {
    const r = await http
      .get('/api/relatorios/auditoria/sensiveis?dias=365')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const s = r.body as Sensiveis;

    expect(s.porAcao.reduce((x, a) => x + a.registros, 0)).toBe(s.registros);
    expect(s.porAtor.reduce((x, a) => x + a.registros, 0)).toBe(s.registros);
    expect(s.porAtor).toHaveLength(s.atores);
    expect(s.semMotivo).toBeLessThanOrEqual(s.registros);
  });

  it('o filtro de ação recorta de verdade', async () => {
    const todas = await http
      .get('/api/relatorios/auditoria/sensiveis?dias=365')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const alvo = (todas.body as Sensiveis).porAcao[0];
    if (!alvo) return;

    const r = await http
      .get(`/api/relatorios/auditoria/sensiveis?dias=365&acao=${alvo.acao}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const s = r.body as Sensiveis;
    expect(s.registros).toBe(alvo.registros);
    for (const i of s.itens) expect(i.acao).toBe(alvo.acao);
  });

  it('a vendedora não lê as ações sensíveis', async () => {
    await http
      .get('/api/relatorios/auditoria/sensiveis')
      .set('Authorization', `Bearer ${tokenVendedora}`)
      .expect(403);
  });
});

describe.runIf(temBanco)('acessos e exportações', () => {
  /**
   * O CSV é montado no navegador: sem o aviso da tela, este relatório seria
   * uma página em branco que parece dizer que ninguém exportou nada.
   */
  it('o aviso da tela vira registro de exportação', async () => {
    const antes = await http
      .get('/api/relatorios/auditoria/acessos?dias=1')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    await http
      .post('/api/relatorios/auditoria/exportacao')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ relatorio: 'posicao-de-estoque', colunas: ['sku', 'custo_medio'], linhas: 42 })
      .expect(204);

    const depois = await http
      .get('/api/relatorios/auditoria/acessos?dias=1')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const a = antes.body as Acessos;
    const d = depois.body as Acessos;

    expect(d.exportacoes).toBe(a.exportacoes + 1);
    expect(d.comCusto).toBe(a.comCusto + 1);
    expect(d.linhasExportadas).toBe(a.linhasExportadas + 42);

    const registro = d.itens.find((i) => i.relatorio === 'posicao-de-estoque');
    expect(registro?.ator).toBeTruthy();
    expect(registro?.linhas).toBe(42);
  });

  /**
   * `com_custo` é uma coluna que DIZ se havia custo, não o custo. A primeira
   * versão marcava o próprio relatório de auditoria como portador de custo.
   */
  it('coluna que só fala de custo não conta como custo', async () => {
    await http
      .post('/api/relatorios/auditoria/exportacao')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ relatorio: 'acessos-e-exportacoes', colunas: ['ator', 'com_custo'], linhas: 3 })
      .expect(204);

    const r = await http
      .get('/api/relatorios/auditoria/acessos?dias=1')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const registro = (r.body as Acessos).itens.find((i) => i.relatorio === 'acessos-e-exportacoes');
    expect(registro?.comCusto).toBe(false);
  });

  it('recusa registro malformado', async () => {
    await http
      .post('/api/relatorios/auditoria/exportacao')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ relatorio: '', colunas: [], linhas: -1 })
      .expect(400);
  });

  /** Quem exporta é quem lê o relatório; quem audita é outra pessoa. */
  it('a vendedora registra exportação mas não lê os acessos', async () => {
    await http
      .post('/api/relatorios/auditoria/exportacao')
      .set('Authorization', `Bearer ${tokenVendedora}`)
      .send({ relatorio: 'vendas', colunas: ['vendedor'], linhas: 1 })
      .expect(204);

    await http
      .get('/api/relatorios/auditoria/acessos')
      .set('Authorization', `Bearer ${tokenVendedora}`)
      .expect(403);
  });
});
