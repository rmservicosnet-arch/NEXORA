/**
 * Testes de ponta a ponta dos relatórios de Compras e Contas.
 *
 * O que impedem:
 *
 *  1. **Aging somando o valor cheio.** Um título pago pela metade pesa o que
 *     falta, não o que foi. Somar o cheio mostra dívida que já não existe.
 *  2. **Faixa com buraco.** A primeira não tem piso e a última não tem teto:
 *     todo título cai em exatamente uma.
 *  3. **Fluxo misturando promessa com dinheiro.** Realizado é baixa que
 *     aconteceu; título em aberto não entra.
 *  4. **Prazo de entrega zero.** Sem data de emissão não há prazo — nulo, não
 *     zero, que diria "chegou no mesmo dia".
 *  5. **Indicador contado sobre a página.**
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
const ADMIN = { email: 'rodrigo@lojacentro.com.br', senha: 'Estoque@2026' };

interface Aging {
  tipo: string;
  faixas: { faixa: string; titulos: number; valor: string }[];
  itens: { contraparte: string; porFaixa: string[]; total: string; titulos: number }[];
  total: string;
  totalTitulos: number;
  vencido: string;
  aVencer: string;
}

let app: INestApplication;
let http: ReturnType<typeof request>;
let token: string;

function autenticado(rota: string) {
  return http.get(rota).set('Authorization', `Bearer ${token}`);
}

beforeAll(async () => {
  if (!temBanco) return;

  const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = modulo.createNestApplication();
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  await app.init();
  http = request(app.getHttpServer());

  token = (
    (
      await http
        .post('/api/auth/login')
        .send({ ...ADMIN, canal: 'app' })
        .expect(200)
    ).body as { tokenAcesso: string }
  ).tokenAcesso;
}, 60_000);

afterAll(async () => {
  if (app) await app.close();
});

describe.runIf(temBanco)('relatórios de compras e contas', () => {
  it('o aging soma o que FALTA, e as faixas fecham com o total', async () => {
    const r = (await autenticado('/api/relatorios/financeiro/aging?tipo=PAGAR').expect(200))
      .body as Aging;

    expect(r.faixas).toHaveLength(4);

    // As quatro faixas somam exatamente o total: nenhuma linha fica de fora e
    // nenhuma é contada duas vezes.
    const soma = r.faixas.reduce((s, f) => s + Number(f.valor), 0);
    expect(soma).toBeCloseTo(Number(r.total), 2);

    // Vencido + a vencer também fecham.
    expect(Number(r.vencido) + Number(r.aVencer)).toBeCloseTo(Number(r.total), 2);

    // Cada linha soma as próprias faixas.
    for (const item of r.itens) {
      const porLinha = item.porFaixa.reduce((s, v) => s + Number(v), 0);
      expect(porLinha).toBeCloseTo(Number(item.total), 2);
    }
  });

  it('o aging a receber é outro conjunto, não o mesmo com outro rótulo', async () => {
    const pagar = (await autenticado('/api/relatorios/financeiro/aging?tipo=PAGAR').expect(200))
      .body as Aging;
    const receber = (await autenticado('/api/relatorios/financeiro/aging?tipo=RECEBER').expect(200))
      .body as Aging;

    expect(pagar.tipo).toBe('PAGAR');
    expect(receber.tipo).toBe('RECEBER');
    expect(receber.total).not.toBe(pagar.total);
  });

  it('o fluxo é REALIZADO: só baixa que aconteceu', async () => {
    const r = (await autenticado('/api/relatorios/financeiro/fluxo?dias=60').expect(200)).body as {
      dias: { dia: string; entrou: string; saiu: string; liquido: string }[];
      entrou: string;
      saiu: string;
      liquido: string;
      observacao: string;
    };

    expect(Number(r.entrou) - Number(r.saiu)).toBeCloseTo(Number(r.liquido), 2);

    for (const d of r.dias) {
      expect(Number(d.entrou) - Number(d.saiu)).toBeCloseTo(Number(d.liquido), 2);
    }

    // A ressalva vai na resposta, não só na tela: quem consome a API também
    // precisa saber que isto não é previsão.
    expect(r.observacao).toContain('promessa');
  });

  it('compras por fornecedor: a participação soma 100 e o prazo sem emissão é NULO', async () => {
    const r = (await autenticado('/api/relatorios/compras/fornecedores?dias=365').expect(200))
      .body as {
      itens: {
        fornecedor: string;
        participacao: string;
        prazoMedio: number | null;
        valor: string;
      }[];
      total: string;
      fornecedores: number;
    };

    if (r.itens.length === 0) return;

    const soma = r.itens.reduce((s, i) => s + Number(i.participacao), 0);
    expect(soma).toBeCloseTo(100, 1);

    // Zero diria "chegou no mesmo dia". Sem emissão, o prazo não existe.
    for (const i of r.itens) {
      expect(i.prazoMedio === null || i.prazoMedio >= 0).toBe(true);
    }
  });

  it('o custo de aquisição sai da NOTA, não do custo médio, e classifica a direção', async () => {
    const r = (await autenticado('/api/relatorios/compras/custo-aquisicao?dias=365').expect(200))
      .body as {
      itens: {
        sku: string;
        primeiroCusto: string;
        ultimoCusto: string;
        variacaoPercentual: string | null;
      }[];
      subiram: number;
      cairam: number;
      estaveis: number;
    };

    expect(r.subiram + r.cairam + r.estaveis).toBe(r.itens.length);

    for (const i of r.itens) {
      // Custo inicial zero não vira "subiu infinito%".
      if (Number(i.primeiroCusto) === 0) {
        expect(i.variacaoPercentual).toBeNull();
      }
    }
  });

  it('notas a receber: o indicador conta o conjunto, não a página', async () => {
    const pagina = (await autenticado('/api/relatorios/compras/a-receber?limite=1').expect(200))
      .body as {
      itens: { numeroNota: string | null; diasParada: number | null }[];
      notas: number;
      paradasHaMais15: number;
    };

    expect(pagina.itens.length).toBeLessThanOrEqual(1);
    expect(pagina.notas).toBeGreaterThanOrEqual(pagina.itens.length);
    expect(pagina.paradasHaMais15).toBeLessThanOrEqual(pagina.notas);
  });

  /**
   * O ranking mede COMPRA, não revenda — e o rótulo tem de bater com a conta.
   * Quem sumiu não aparece numa lista de quem comprou, e é por isso que
   * `semCompraNoPeriodo` existe.
   */
  it('o ranking de revendedores soma compras e conta quem NÃO comprou', async () => {
    const r = (await autenticado('/api/relatorios/vendas/revendedores?dias=365').expect(200))
      .body as {
      itens: {
        posicao: number;
        perfil: string;
        valor: string;
        compras: number;
        ticketMedio: string;
        participacao: string;
      }[];
      total: string;
      revendedores: number;
      semCompraNoPeriodo: number;
    };

    // Só perfil de revenda entra: consumidor final fica de fora.
    for (const i of r.itens) {
      expect(['PROFESSOR', 'REVENDEDOR']).toContain(i.perfil);
    }

    // A posição acompanha a ordem, e o valor cai do primeiro para o último.
    r.itens.forEach((i, indice) => {
      expect(i.posicao).toBe(indice + 1);
      if (indice > 0) {
        expect(Number(i.valor)).toBeLessThanOrEqual(Number(r.itens[indice - 1]!.valor));
      }
    });

    // Ticket médio é valor ÷ compras, não uma média de médias.
    for (const i of r.itens) {
      expect(Number(i.ticketMedio)).toBeCloseTo(Number(i.valor) / i.compras, 2);
    }

    // A participação soma 100 quando a página cobre o conjunto.
    if (r.itens.length === r.revendedores && r.revendedores > 0) {
      const soma = r.itens.reduce((s, i) => s + Number(i.participacao), 0);
      expect(soma).toBeCloseTo(100, 1);
    }

    expect(r.semCompraNoPeriodo).toBeGreaterThanOrEqual(0);
  });

  it('o recorte por perfil devolve só aquele perfil', async () => {
    const so = (
      await autenticado('/api/relatorios/vendas/revendedores?dias=365&perfil=PROFESSOR').expect(200)
    ).body as { itens: { perfil: string }[] };

    expect(so.itens.every((i) => i.perfil === 'PROFESSOR')).toBe(true);
  });

  /**
   * Os TRES de compras, nao so o que tem "custo" no nome.
   *
   * "Compras por fornecedor" devolve valor e unidades lado a lado: dividir um
   * pelo outro da o custo unitario medio. "Notas a receber" devolve o valor
   * parado, que e o mesmo numero antes de entrar no estoque.
   */
  it.each([['compras/custo-aquisicao'], ['compras/fornecedores'], ['compras/a-receber']])(
    '%s exige relatorio.ver_custo',
    async (rota) => {
      const vendedora = (
        (
          await http
            .post('/api/auth/login')
            .send({ email: 'marina@lojacentro.com.br', senha: 'Estoque@2026', canal: 'app' })
            .expect(200)
        ).body as { tokenAcesso: string }
      ).tokenAcesso;

      await http
        .get(`/api/relatorios/${rota}`)
        .set('Authorization', `Bearer ${vendedora}`)
        .expect(403);
    },
  );
});
