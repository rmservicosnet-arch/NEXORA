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

interface Giro {
  dias: number;
  semVenda: number;
  semMovimento: number;
  valorEncalhado?: string;
  itens: {
    sku: string;
    saldo: string;
    vendidas: string;
    giro: string | null;
    cobertura: string | null;
    diasParado: number | null;
    valorEmEstoque?: string;
  }[];
}

interface Transferencias {
  dias: number;
  enviadas: number;
  recebidas: number;
  emTransito: number;
  itens: {
    quantidade: string;
    origem: string;
    destino: string | null;
    emTransito: boolean;
    ator: string | null;
  }[];
}

interface Inventario {
  dias: number;
  contagens: number;
  sobras: number;
  faltas: number;
  efeitoLiquido?: string;
  itens: {
    diferenca: string;
    saldoAntes: string;
    saldoDepois: string;
    valor?: string;
    ator: string | null;
  }[];
}

interface Formas {
  dias: number;
  total: string;
  imediato: string;
  futuro: string;
  formas: {
    forma: string;
    total: string;
    participacao: string;
    pagamentos: number;
    medio: string;
    parcelasMedias: string;
    futuro: boolean;
  }[];
  parcelamento: { parcelas: number; pagamentos: number; total: string; participacao: string }[];
}

interface Descontos {
  dias: number;
  bruto: string;
  desconto: string;
  acrescimo: string;
  liquido: string;
  taxa: string;
  vendas: number;
  comDesconto: number;
  vendedores: {
    vendedor: string;
    vendas: number;
    comDesconto: number;
    bruto: string;
    desconto: string;
    acrescimo: string;
    liquido: string;
    taxa: string;
    maiorTaxa: string;
  }[];
}

interface Cancelamentos {
  dias: number;
  canceladas: number;
  concluidas: number;
  taxa: string;
  valorCancelado: string;
  naHora: number;
  porMotivo: { motivo: string; quantidade: number; valor: string }[];
  devolucoesRegistradas: number;
  itens: {
    numero: number;
    em: string;
    loja: string;
    vendedor: string;
    cliente: string | null;
    total: string;
    motivo: string | null;
    minutosAte: number;
  }[];
}

interface Comparativo {
  dias: number;
  faturamento: string;
  vendas: number;
  lojas: {
    loja: string;
    vendas: number;
    faturamento: string;
    participacao: string;
    ticketMedio: string;
    itens: string;
    itensPorVenda: string;
    clientes: number;
    taxaDesconto: string;
    canceladas: number;
    taxaCancelamento: string;
    margem?: string | null;
  }[];
}

interface Fechamentos {
  dias: number;
  fechados: number;
  conferidos: number;
  abertos: number;
  comDiferenca: number;
  faltas: string;
  sobras: string;
  semConferencia: number;
  itens: {
    numero: number;
    status: string;
    valorEsperado: string | null;
    valorContado: string | null;
    diferenca: string | null;
    conferidoPor: string | null;
  }[];
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

describe.runIf(temBanco)('giro e cobertura', () => {
  it('cobertura é nula sem venda — "infinito" não é cobertura', async () => {
    const r = await http
      .get('/api/relatorios/giro?dias=30&limite=60')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const g = r.body as Giro;

    for (const i of g.itens) {
      if (Number(i.vendidas) === 0) expect(i.cobertura).toBeNull();
      if (Number(i.saldo) <= 0) expect(i.giro).toBeNull();
    }
  });

  /**
   * O resumo conta o CONJUNTO, não a página. Se contasse a página, pedir 10
   * linhas devolveria "no máximo 10 sem venda" numa loja com centenas.
   */
  it('o resumo não muda com o tamanho da página', async () => {
    const pequena = await http
      .get('/api/relatorios/giro?dias=30&limite=5')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);
    const grande = await http
      .get('/api/relatorios/giro?dias=30&limite=200')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const a = pequena.body as Giro;
    const b = grande.body as Giro;

    expect(a.semVenda).toBe(b.semVenda);
    expect(a.semMovimento).toBe(b.semMovimento);
    expect(a.valorEncalhado).toBe(b.valorEncalhado);
    expect(a.itens).toHaveLength(5);
  });

  /** Sem movimento nenhum é subconjunto de sem venda: quem se moveu pode não ter vendido. */
  it('sem movimento nunca passa de sem venda', async () => {
    const r = await http
      .get('/api/relatorios/giro?dias=30')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const g = r.body as Giro;
    expect(g.semMovimento).toBeLessThanOrEqual(g.semVenda);
  });

  it('`ordem=parado` começa pelo que menos saiu', async () => {
    const r = await http
      .get('/api/relatorios/giro?dias=30&ordem=parado&limite=30')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const g = r.body as Giro;
    const vendidas = g.itens.map((i) => Number(i.vendidas));
    for (let i = 1; i < vendidas.length; i += 1) {
      expect(vendidas[i]).toBeGreaterThanOrEqual(vendidas[i - 1]!);
    }
  });

  it('a vendedora não recebe valor parado', async () => {
    const r = await http
      .get('/api/relatorios/giro?dias=30&limite=10')
      .set('Authorization', `Bearer ${tokenVendedora}`)
      .expect(200);

    const g = r.body as Giro;
    expect(g.valorEncalhado).toBeUndefined();
    expect(JSON.stringify(g)).not.toContain('valorEmEstoque');
  });
});

describe.runIf(temBanco)('transferências', () => {
  /** Em trânsito é a saída sem a entrada par. Somadas, dão o total enviado. */
  it('enviadas = recebidas + em trânsito', async () => {
    const r = await http
      .get('/api/relatorios/transferencias?dias=365')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const t = r.body as Transferencias;
    expect(t.recebidas + t.emTransito).toBe(t.enviadas);
    // O resumo conta o período; a lista é uma página dele.
    expect(t.itens.length).toBeLessThanOrEqual(t.enviadas);
  });

  it('a origem nunca falta e o destino confirma o trânsito', async () => {
    const r = await http
      .get('/api/relatorios/transferencias?dias=365')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    for (const i of (r.body as Transferencias).itens) {
      expect(i.origem).toBeTruthy();
      expect(i.emTransito).toBe(i.destino === null);
      expect(Number(i.quantidade)).toBeGreaterThan(0);
    }
  });

  /** O razão guarda `ator_id`; a tela espera gente. */
  it('o ator vem como nome, nunca como uuid', async () => {
    const r = await http
      .get('/api/relatorios/transferencias?dias=365')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    for (const i of (r.body as Transferencias).itens) {
      if (i.ator !== null) {
        expect(i.ator).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/i);
      }
    }
  });
});

describe.runIf(temBanco)('divergências de inventário', () => {
  it('sobra e falta somam as contagens, sem se compensarem', async () => {
    const r = await http
      .get('/api/relatorios/inventario?dias=365')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const i = r.body as Inventario;
    expect(i.sobras + i.faltas).toBe(i.contagens);
  });

  /** O sinal mora em `sentido`; a quantidade gravada é sempre positiva. */
  it('a diferença carrega o sinal e bate com os saldos', async () => {
    const r = await http
      .get('/api/relatorios/inventario?dias=365&limite=50')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    for (const l of (r.body as Inventario).itens) {
      expect(Number(l.saldoDepois) - Number(l.saldoAntes)).toBeCloseTo(Number(l.diferenca), 0);
    }
  });

  it('a vendedora não recebe o efeito no patrimônio', async () => {
    const r = await http
      .get('/api/relatorios/inventario?dias=365&limite=10')
      .set('Authorization', `Bearer ${tokenVendedora}`)
      .expect(200);

    const i = r.body as Inventario;
    expect(i.efeitoLiquido).toBeUndefined();
    expect(JSON.stringify(i.itens)).not.toContain('"valor"');
  });

  it('recusa período fora do intervalo', async () => {
    await http
      .get('/api/relatorios/inventario?dias=0')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(400);
  });

  it('sem sessão não devolve número nenhum', async () => {
    await http.get('/api/relatorios/giro').expect(401);
    await http.get('/api/relatorios/transferencias').expect(401);
    await http.get('/api/relatorios/inventario').expect(401);
  });
});

describe.runIf(temBanco)('formas de pagamento', () => {
  it('as formas somam o total recebido', async () => {
    const r = await http
      .get('/api/relatorios/formas-pagamento?dias=90')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const f = r.body as Formas;
    const soma = f.formas.reduce((s, l) => s + Number(l.total), 0);
    expect(soma).toBeCloseTo(Number(f.total), 2);
    expect(f.total).toMatch(/^\d+\.\d{2}$/);
  });

  /**
   * Crédito é dinheiro futuro mesmo em uma parcela: quem liquida é a
   * adquirente. Chamá-lo de à vista faria a loja contar com o que não tem.
   */
  it('crédito nunca entra no que já está na conta', async () => {
    const r = await http
      .get('/api/relatorios/formas-pagamento?dias=90')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const f = r.body as Formas;

    for (const l of f.formas) {
      if (['CREDITO', 'BOLETO', 'PRAZO', 'CARTEIRA'].includes(l.forma)) {
        expect(l.futuro).toBe(true);
      }
      if (['DINHEIRO', 'PIX', 'DEBITO', 'TRANSFERENCIA'].includes(l.forma)) {
        expect(l.futuro).toBe(false);
      }
    }

    expect(Number(f.imediato) + Number(f.futuro)).toBeCloseTo(Number(f.total), 2);

    const somaFutura = f.formas.filter((l) => l.futuro).reduce((s, l) => s + Number(l.total), 0);
    expect(somaFutura).toBeCloseTo(Number(f.futuro), 2);
  });

  it('o parcelamento é só do crédito e fecha nele', async () => {
    const r = await http
      .get('/api/relatorios/formas-pagamento?dias=90')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const f = r.body as Formas;
    const credito = f.formas.find((l) => l.forma === 'CREDITO');

    const soma = f.parcelamento.reduce((s, l) => s + Number(l.total), 0);
    expect(soma).toBeCloseTo(Number(credito?.total ?? 0), 2);

    if (f.parcelamento.length > 0) {
      const partes = f.parcelamento.reduce((s, l) => s + Number(l.participacao), 0);
      expect(partes).toBeGreaterThan(99);
      expect(partes).toBeLessThan(101);
      for (const l of f.parcelamento) expect(l.parcelas).toBeGreaterThanOrEqual(1);
    }
  });

  /** Ponderada pelo valor: dez compras de R$ 20 em 1x não disfarçam uma de R$ 3.000 em 12x. */
  it('as parcelas médias nunca ficam abaixo de uma', async () => {
    const r = await http
      .get('/api/relatorios/formas-pagamento?dias=90')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    for (const l of (r.body as Formas).formas) {
      expect(Number(l.parcelasMedias)).toBeGreaterThanOrEqual(1);
      expect(Number(l.medio)).toBeGreaterThanOrEqual(0);
    }
  });

  /**
   * `venda_pagamento` guarda o que o cliente ENTREGOU. O troco voltou para
   * ele: somado como recebido, declararia dinheiro que não está na gaveta.
   */
  it('o dinheiro já vem sem o troco', async () => {
    const r = await http
      .get('/api/relatorios/formas-pagamento?dias=365')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const f = r.body as Formas;
    const dinheiro = f.formas.find((l) => l.forma === 'DINHEIRO');

    if (dinheiro) {
      const vendas = await http
        .get('/api/relatorios/vendas?dias=365')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200);

      const bruto = (vendas.body as Vendas).formasPagamento.find((l) => l.forma === 'DINHEIRO');

      // O relatório de vendas ainda soma o entregue; este soma o que ficou.
      expect(Number(dinheiro.total)).toBeLessThanOrEqual(Number(bruto?.total ?? 0));
      expect(Number(dinheiro.total)).toBeGreaterThanOrEqual(0);
    }
  });

  it('recusa período fora do intervalo e exige sessão', async () => {
    await http
      .get('/api/relatorios/formas-pagamento?dias=999')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(400);

    await http.get('/api/relatorios/formas-pagamento').expect(401);
  });
});

describe.runIf(temBanco)('descontos concedidos', () => {
  /** Bruto menos desconto mais acréscimo é o faturado. Se não fecha, um dos três mente. */
  it('bruto − desconto + acréscimo fecha no faturado', async () => {
    const r = await http
      .get('/api/relatorios/descontos?dias=365')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const d = r.body as Descontos;
    expect(Number(d.bruto) - Number(d.desconto) + Number(d.acrescimo)).toBeCloseTo(
      Number(d.liquido),
      2,
    );

    for (const v of d.vendedores) {
      expect(Number(v.bruto) - Number(v.desconto) + Number(v.acrescimo)).toBeCloseTo(
        Number(v.liquido),
        2,
      );
    }
  });

  it('os vendedores somam o total do período', async () => {
    const r = await http
      .get('/api/relatorios/descontos?dias=365')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const d = r.body as Descontos;
    const soma = (campo: 'bruto' | 'desconto' | 'liquido') =>
      d.vendedores.reduce((s, v) => s + Number(v[campo]), 0);

    expect(soma('bruto')).toBeCloseTo(Number(d.bruto), 2);
    expect(soma('desconto')).toBeCloseTo(Number(d.desconto), 2);
    expect(soma('liquido')).toBeCloseTo(Number(d.liquido), 2);
    expect(d.vendedores.reduce((s, v) => s + v.vendas, 0)).toBe(d.vendas);
  });

  /** A média esconde o pico: 3% de taxa com uma venda a 40% é uma decisão sozinha. */
  it('a maior taxa nunca fica abaixo da média do vendedor', async () => {
    const r = await http
      .get('/api/relatorios/descontos?dias=365')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    for (const v of (r.body as Descontos).vendedores) {
      expect(Number(v.maiorTaxa)).toBeGreaterThanOrEqual(Number(v.taxa) - 0.1);
      expect(Number(v.taxa)).toBeGreaterThanOrEqual(0);
      expect(v.comDesconto).toBeLessThanOrEqual(v.vendas);
    }
  });

  it('o faturado bate com o relatório de vendas', async () => {
    const [descontos, vendas] = await Promise.all([
      http
        .get('/api/relatorios/descontos?dias=30')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200),
      http
        .get('/api/relatorios/vendas?dias=30')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200),
    ]);

    expect(Number((descontos.body as Descontos).liquido)).toBeCloseTo(
      Number((vendas.body as Vendas).total),
      2,
    );
  });

  it('recusa período fora do intervalo e exige sessão', async () => {
    await http
      .get('/api/relatorios/descontos?dias=0')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(400);

    await http.get('/api/relatorios/descontos').expect(401);
  });
});

describe.runIf(temBanco)('cancelamentos e devolu\u00e7\u00f5es', () => {
  /**
   * A taxa \u00e9 sobre as vendas FECHADAS \u2014 canceladas mais conclu\u00eddas. Dividir
   * s\u00f3 pelas conclu\u00eddas daria uma taxa acima de 100% numa loja ruim.
   */
  it('a taxa compara canceladas com tudo que fechou', async () => {
    const r = await http
      .get('/api/relatorios/cancelamentos?dias=365')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const c = r.body as Cancelamentos;
    const fechadas = c.canceladas + c.concluidas;

    if (fechadas > 0) {
      expect(Number(c.taxa)).toBeCloseTo((c.canceladas / fechadas) * 100, 1);
    }
    expect(Number(c.taxa)).toBeLessThanOrEqual(100);
  });

  /** "Na hora" \u00e9 digita\u00e7\u00e3o; o resto \u00e9 mercadoria que j\u00e1 tinha sa\u00eddo. */
  it('as desfeitas na hora nunca passam do total', async () => {
    const r = await http
      .get('/api/relatorios/cancelamentos?dias=365')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const c = r.body as Cancelamentos;
    expect(c.naHora).toBeLessThanOrEqual(c.canceladas);

    for (const i of c.itens) {
      expect(i.minutosAte).toBeGreaterThanOrEqual(0);
      expect(i.total).toMatch(/^\d+\.\d{2}$/);
    }
  });

  it('os motivos n\u00e3o passam do que foi cancelado', async () => {
    const r = await http
      .get('/api/relatorios/cancelamentos?dias=365')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const c = r.body as Cancelamentos;
    const soma = c.porMotivo.reduce((s, m) => s + m.quantidade, 0);

    expect(soma).toBeLessThanOrEqual(c.canceladas);
    for (const m of c.porMotivo) expect(m.motivo.length).toBeGreaterThan(0);
  });

  /**
   * O resumo conta o per\u00edodo; a lista \u00e9 uma p\u00e1gina dele. Contar a p\u00e1gina
   * faria a taxa cair sozinha ao pedir menos linhas.
   */
  it('o resumo n\u00e3o muda com o tamanho da p\u00e1gina', async () => {
    const [pequena, grande] = await Promise.all([
      http
        .get('/api/relatorios/cancelamentos?dias=365&limite=5')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200),
      http
        .get('/api/relatorios/cancelamentos?dias=365&limite=200')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200),
    ]);

    const a = pequena.body as Cancelamentos;
    const b = grande.body as Cancelamentos;

    expect(a.canceladas).toBe(b.canceladas);
    expect(a.taxa).toBe(b.taxa);
    expect(a.valorCancelado).toBe(b.valorCancelado);
    expect(a.itens.length).toBeLessThanOrEqual(5);
  });

  /**
   * Devolu\u00e7\u00e3o parcial n\u00e3o existe: nenhuma tela grava
   * `venda_item.quantidade_devolvida`. O n\u00famero vem em campo pr\u00f3prio para a
   * tela dizer que \u00e9 aus\u00eancia de recurso, e n\u00e3o boa not\u00edcia.
   */
  it('o contador de devolu\u00e7\u00f5es vem separado', async () => {
    const r = await http
      .get('/api/relatorios/cancelamentos?dias=30')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const c = r.body as Cancelamentos;
    expect(c.devolucoesRegistradas).toBeGreaterThanOrEqual(0);
    expect(typeof c.devolucoesRegistradas).toBe('number');
  });

  it('recusa per\u00edodo fora do intervalo e exige sess\u00e3o', async () => {
    await http
      .get('/api/relatorios/cancelamentos?dias=400')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(400);

    await http.get('/api/relatorios/cancelamentos').expect(401);
  });
});

describe.runIf(temBanco)('comparativo entre lojas', () => {
  it('as lojas somam o faturamento do grupo', async () => {
    const r = await http
      .get('/api/relatorios/comparativo-lojas?dias=365')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const c = r.body as Comparativo;

    expect(c.lojas.reduce((s, l) => s + Number(l.faturamento), 0)).toBeCloseTo(
      Number(c.faturamento),
      2,
    );
    expect(c.lojas.reduce((s, l) => s + l.vendas, 0)).toBe(c.vendas);

    if (c.lojas.length > 0) {
      const partes = c.lojas.reduce((s, l) => s + Number(l.participacao), 0);
      expect(partes).toBeGreaterThan(99);
      expect(partes).toBeLessThan(101);
    }
  });

  /** Ticket medio e faturamento dividido por vendas. Se nao bate, um dos dois mente. */
  it('o ticket medio fecha com faturamento e vendas', async () => {
    const r = await http
      .get('/api/relatorios/comparativo-lojas?dias=365')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    for (const l of (r.body as Comparativo).lojas) {
      if (l.vendas > 0) {
        expect(Number(l.ticketMedio)).toBeCloseTo(Number(l.faturamento) / l.vendas, 1);
        expect(Number(l.itensPorVenda)).toBeCloseTo(Number(l.itens) / l.vendas, 1);
      }
      expect(Number(l.taxaCancelamento)).toBeLessThanOrEqual(100);
      expect(Number(l.taxaDesconto)).toBeGreaterThanOrEqual(0);
    }
  });

  /** O comparativo e o relatorio de vendas contam o MESMO faturamento. */
  it('o total bate com o relatorio de vendas', async () => {
    const [comparativo, vendas] = await Promise.all([
      http
        .get('/api/relatorios/comparativo-lojas?dias=30')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200),
      http
        .get('/api/relatorios/vendas?dias=30')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200),
    ]);

    expect(Number((comparativo.body as Comparativo).faturamento)).toBeCloseTo(
      Number((vendas.body as Vendas).total),
      2,
    );
  });

  it('a vendedora nao recebe margem', async () => {
    const r = await http
      .get('/api/relatorios/comparativo-lojas?dias=30')
      .set('Authorization', `Bearer ${tokenVendedora}`)
      .expect(200);

    expect(JSON.stringify((r.body as Comparativo).lojas)).not.toContain('margem');
  });

  it('exige sessao e recusa periodo invalido', async () => {
    await http
      .get('/api/relatorios/comparativo-lojas?dias=0')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(400);

    await http.get('/api/relatorios/comparativo-lojas').expect(401);
  });
});

describe.runIf(temBanco)('fechamento de caixa', () => {
  /**
   * Falta e sobra contadas separadamente. Somadas, R$ 200 de cada dariam zero
   * numa loja onde dois operadores erram todo dia em direcoes opostas.
   */
  it('falta e sobra nao se anulam', async () => {
    const r = await http
      .get('/api/relatorios/fechamento-caixa?dias=365')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const f = r.body as Fechamentos;

    expect(Number(f.faltas)).toBeLessThanOrEqual(0);
    expect(Number(f.sobras)).toBeGreaterThanOrEqual(0);
    expect(f.comDiferenca).toBeLessThanOrEqual(f.fechados + f.abertos);
  });

  /** `diferenca` e `contado - esperado`, e nunca e ajustada em silencio. */
  it('a diferenca bate com o contado menos o esperado', async () => {
    const r = await http
      .get('/api/relatorios/fechamento-caixa?dias=365&limite=200')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    for (const i of (r.body as Fechamentos).itens) {
      if (i.diferenca !== null && i.valorContado !== null && i.valorEsperado !== null) {
        expect(Number(i.diferenca)).toBeCloseTo(
          Number(i.valorContado) - Number(i.valorEsperado),
          2,
        );
      }
      // Caixa aberto ainda nao tem conta nenhuma.
      if (i.status === 'ABERTO') expect(i.diferenca).toBeNull();
    }
  });

  /**
   * O recorte vale para a LISTA; o resumo continua contando tudo. Recortar o
   * resumo junto faria "153 nao bateram de 153 fechados".
   */
  it('o recorte muda a lista e nao o resumo', async () => {
    const [todos, sos] = await Promise.all([
      http
        .get('/api/relatorios/fechamento-caixa?dias=365')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200),
      http
        .get('/api/relatorios/fechamento-caixa?dias=365&apenasComDiferenca=true')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200),
    ]);

    const a = todos.body as Fechamentos;
    const b = sos.body as Fechamentos;

    expect(b.fechados).toBe(a.fechados);
    expect(b.comDiferenca).toBe(a.comDiferenca);
    for (const i of b.itens) expect(Number(i.diferenca)).not.toBe(0);
  });

  /** Fechado sem conferencia e fechamento com uma assinatura so. */
  it('conferidos e sem conferencia somam os fechados', async () => {
    const r = await http
      .get('/api/relatorios/fechamento-caixa?dias=365')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const f = r.body as Fechamentos;
    expect(f.conferidos + f.semConferencia).toBe(f.fechados);
  });

  it('exige sessao e recusa periodo invalido', async () => {
    await http
      .get('/api/relatorios/fechamento-caixa?dias=0')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(400);

    await http.get('/api/relatorios/fechamento-caixa').expect(401);
  });
});
