/**
 * Os relatórios do ciclo do pedido.
 *
 * O que se testa aqui é o que um relatório de processo erra em silêncio:
 * contar como fracasso o pedido que acabou de chegar, somar a fila da equipe
 * com a fila do cliente, e medir a espera por uma média que a cauda distorce.
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

interface Fila {
  dias: number;
  naFila: number;
  valorNaFila: string;
  maisAntigoHoras: number | null;
  precoVencido: number;
  esperandoCliente: number;
  confirmados: number;
  horasMedias: string | null;
  horasMediana: string | null;
  faixas: { faixa: string; pedidos: number; valor: string }[];
  itens: {
    numero: number;
    horasNaFila: number;
    valorSolicitado: string;
    itens: number;
    precoVencido: boolean;
    esperaCliente: boolean;
  }[];
}

interface Confirmacao {
  dias: number;
  enviados: number;
  decididos: number;
  emAberto: number;
  taxaConfirmacao: string;
  valorSolicitado: string;
  valorConfirmado: string;
  aproveitamento: string;
  desfechos: { status: string; pedidos: number; valor: string; participacao: string }[];
  porLoja: {
    loja: string;
    enviados: number;
    decididos: number;
    confirmados: number;
    taxa: string;
    valorConfirmado: string;
  }[];
}

interface Ruptura {
  dias: number;
  itensEmFalta: number;
  pedidosAfetados: number;
  valorPerdido: string;
  confirmadosSemSaldo: number;
  itens: {
    sku: string;
    pedidos: number;
    solicitada: string;
    atendida: string;
    naoAtendida: string;
    valorPerdido: string;
    saldoAtual: string;
    confirmadoSemSaldo: number;
  }[];
}

interface Alteracoes {
  dias: number;
  inclusoes: number;
  remocoes: number;
  valorIncluido: string;
  valorRemovido: string;
  pedidosTocados: number;
  porAutor: {
    autor: string;
    inclusoes: number;
    remocoes: number;
    valorIncluido: string;
    valorRemovido: string;
    semMotivo: number;
  }[];
  itens: {
    acao: 'INCLUSAO' | 'REMOCAO';
    quantidade: string;
    valor: string;
    autor: string | null;
  }[];
}

interface Aceites {
  dias: number;
  pedidosDeAceite: number;
  aceitos: number;
  recusados: number;
  pendentes: number;
  taxaAceite: string;
  aumentoAceito: string;
  aumentoRecusado: string;
  horasMedias: string | null;
  itens: {
    numero: number;
    desfecho: 'ACEITO' | 'RECUSADO' | 'PENDENTE';
    aumento: string;
    horasAte: number | null;
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
  tokenCliente = await entrar('/api/portal/auth/login', CLIENTE);
}, 60_000);

afterAll(async () => {
  if (app) await app.close();
});

describe.runIf(temBanco)('fila e tempo de confirmação', () => {
  /**
   * Esperar a equipe e esperar o cliente são filas diferentes. Somadas, a
   * equipe leva a culpa por um aumento que o cliente ainda não aceitou.
   */
  it('a fila da equipe não inclui quem espera o cliente', async () => {
    const r = await http
      .get('/api/relatorios/pedidos/fila')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const f = r.body as Fila;

    expect(f.naFila).toBeGreaterThanOrEqual(0);
    expect(f.esperandoCliente).toBeGreaterThanOrEqual(0);

    const naFilaListados = f.itens.filter((i) => !i.esperaCliente).length;
    const esperandoListados = f.itens.filter((i) => i.esperaCliente).length;

    expect(naFilaListados + esperandoListados).toBe(f.itens.length);
    expect(naFilaListados).toBeLessThanOrEqual(f.naFila);
    expect(esperandoListados).toBeLessThanOrEqual(f.esperandoCliente);
  });

  /** As faixas dividem a MESMA fila: somadas, não podem passar dela. */
  it('as faixas cobrem a fila listada sem se sobreporem', async () => {
    const r = await http
      .get('/api/relatorios/pedidos/fila?limite=200')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const f = r.body as Fila;
    const soma = f.faixas.reduce((s, x) => s + x.pedidos, 0);

    expect(soma).toBe(f.itens.filter((i) => !i.esperaCliente).length);
    expect(f.faixas).toHaveLength(5);
  });

  /** Média e mediana lado a lado dizem se o atraso é regra ou exceção. */
  it('o tempo medido vem com média e mediana', async () => {
    const r = await http
      .get('/api/relatorios/pedidos/fila?dias=365')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const f = r.body as Fila;

    if (f.confirmados > 0) {
      expect(f.horasMedias).not.toBeNull();
      expect(f.horasMediana).not.toBeNull();
      expect(Number(f.horasMedias)).toBeGreaterThanOrEqual(0);
      expect(Number(f.horasMediana)).toBeGreaterThanOrEqual(0);
    } else {
      expect(f.horasMedias).toBeNull();
    }
  });

  it('o mais antigo nunca é menor que o primeiro da lista', async () => {
    const r = await http
      .get('/api/relatorios/pedidos/fila')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const f = r.body as Fila;
    const primeiro = f.itens.find((i) => !i.esperaCliente);

    if (primeiro && f.maisAntigoHoras !== null) {
      expect(f.maisAntigoHoras).toBeGreaterThanOrEqual(primeiro.horasNaFila - 1);
    }
  });

  it('exige sessão da equipe', async () => {
    await http.get('/api/relatorios/pedidos/fila').expect(401);
    await http
      .get('/api/relatorios/pedidos/fila')
      .set('Authorization', `Bearer ${tokenCliente}`)
      .expect(401);
  });
});

describe.runIf(temBanco)('taxa de confirmação', () => {
  /**
   * Um pedido que chegou há dez minutos não é fracasso, é pendência. Contá-lo
   * como não confirmado faria a taxa piorar toda vez que a loja recebesse
   * pedido.
   */
  it('a taxa se mede sobre os decididos, não sobre os enviados', async () => {
    const r = await http
      .get('/api/relatorios/pedidos/confirmacao?dias=365')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const c = r.body as Confirmacao;

    expect(c.decididos + c.emAberto).toBe(c.enviados);
    expect(c.decididos).toBeLessThanOrEqual(c.enviados);
    expect(Number(c.taxaConfirmacao)).toBeLessThanOrEqual(100);
    expect(Number(c.taxaConfirmacao)).toBeGreaterThanOrEqual(0);
  });

  it('os desfechos somam os enviados', async () => {
    const r = await http
      .get('/api/relatorios/pedidos/confirmacao?dias=365')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const c = r.body as Confirmacao;
    expect(c.desfechos.reduce((s, d) => s + d.pedidos, 0)).toBe(c.enviados);

    if (c.enviados > 0) {
      const partes = c.desfechos.reduce((s, d) => s + Number(d.participacao), 0);
      expect(partes).toBeGreaterThan(99);
      expect(partes).toBeLessThan(101);
    }
  });

  /** Confirmado nunca passa do solicitado que virou confirmado. */
  it('o aproveitamento fica entre zero e cem', async () => {
    const r = await http
      .get('/api/relatorios/pedidos/confirmacao?dias=365')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const c = r.body as Confirmacao;
    expect(Number(c.aproveitamento)).toBeGreaterThanOrEqual(0);
    expect(Number(c.valorConfirmado)).toBeLessThanOrEqual(Number(c.valorSolicitado) + 0.01);
  });

  it('as lojas somam os enviados', async () => {
    const r = await http
      .get('/api/relatorios/pedidos/confirmacao?dias=365')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const c = r.body as Confirmacao;
    expect(c.porLoja.reduce((s, l) => s + l.enviados, 0)).toBe(c.enviados);

    for (const l of c.porLoja) {
      expect(l.confirmados).toBeLessThanOrEqual(l.decididos);
      expect(l.decididos).toBeLessThanOrEqual(l.enviados);
    }
  });

  it('recusa período fora do intervalo e exige sessão', async () => {
    await http
      .get('/api/relatorios/pedidos/confirmacao?dias=0')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(400);

    await http.get('/api/relatorios/pedidos/confirmacao').expect(401);
  });
});

describe.runIf(temBanco)('ruptura', () => {
  /**
   * Falta é o que foi pedido e não foi atendido. Se `naoAtendida` não for
   * `solicitada − atendida`, o relatório está inventando demanda.
   */
  it('o não atendido é exatamente o pedido menos o entregue', async () => {
    const r = await http
      .get('/api/relatorios/pedidos/ruptura?dias=365')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    for (const i of (r.body as Ruptura).itens) {
      expect(Number(i.naoAtendida)).toBeCloseTo(Number(i.solicitada) - Number(i.atendida), 0);
      expect(Number(i.naoAtendida)).toBeGreaterThan(0);
      expect(Number(i.valorPerdido)).toBeGreaterThanOrEqual(0);
    }
  });

  it('o resumo cobre a lista, que é uma página dele', async () => {
    const r = await http
      .get('/api/relatorios/pedidos/ruptura?dias=365&limite=5')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const x = r.body as Ruptura;
    expect(x.itens.length).toBeLessThanOrEqual(5);
    expect(x.pedidosAfetados).toBeLessThanOrEqual(x.itensEmFalta || Number.MAX_SAFE_INTEGER);
    expect(Number(x.valorPerdido)).toBeGreaterThanOrEqual(
      x.itens.reduce((s, i) => s + Number(i.valorPerdido), 0) - 0.01,
    );
  });

  it('exige sessão da equipe', async () => {
    await http.get('/api/relatorios/pedidos/ruptura').expect(401);
    await http
      .get('/api/relatorios/pedidos/ruptura')
      .set('Authorization', `Bearer ${tokenCliente}`)
      .expect(401);
  });
});

describe.runIf(temBanco)('alterações pela equipe', () => {
  it('inclusão e remoção somam o que a lista mostra', async () => {
    const r = await http
      .get('/api/relatorios/pedidos/alteracoes?dias=365&limite=200')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const a = r.body as Alteracoes;
    const soma = a.porAutor.reduce((s, x) => s + x.inclusoes + x.remocoes, 0);

    expect(soma).toBe(a.inclusoes + a.remocoes);
    for (const x of a.porAutor) {
      expect(x.semMotivo).toBeLessThanOrEqual(x.remocoes);
      expect(x.autor.length).toBeGreaterThan(0);
    }
  });

  /** Remoção é lógica: o item continua na linha do tempo, com autor. */
  it('cada linha diz o que foi feito e com quanto', async () => {
    const r = await http
      .get('/api/relatorios/pedidos/alteracoes?dias=365')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    for (const i of (r.body as Alteracoes).itens) {
      expect(['INCLUSAO', 'REMOCAO']).toContain(i.acao);
      expect(Number(i.valor)).toBeGreaterThanOrEqual(0);
      expect(i.valor).toMatch(/^\d+\.\d{2}$/);
    }
  });

  it('exige sessão e recusa período inválido', async () => {
    await http
      .get('/api/relatorios/pedidos/alteracoes?dias=0')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(400);

    await http.get('/api/relatorios/pedidos/alteracoes').expect(401);
  });
});

describe.runIf(temBanco)('aceites de cliente', () => {
  /**
   * Pendente não é recusa. Contar um aumento enviado há uma hora como
   * recusado faria a equipe achar que o cliente rejeita tudo.
   */
  it('a taxa se mede sobre os respondidos', async () => {
    const r = await http
      .get('/api/relatorios/pedidos/aceites?dias=365')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const a = r.body as Aceites;
    const respondidos = a.aceitos + a.recusados;

    if (respondidos > 0) {
      expect(Number(a.taxaAceite)).toBeCloseTo((a.aceitos / respondidos) * 100, 1);
    }
    expect(a.aceitos + a.recusados + a.pendentes).toBeLessThanOrEqual(a.pedidosDeAceite);
    expect(Number(a.taxaAceite)).toBeLessThanOrEqual(100);
  });

  it('pendente não tem tempo de resposta', async () => {
    const r = await http
      .get('/api/relatorios/pedidos/aceites?dias=365')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    for (const i of (r.body as Aceites).itens) {
      if (i.desfecho === 'PENDENTE') expect(i.horasAte).toBeNull();
      if (i.desfecho === 'ACEITO') expect(i.horasAte).not.toBeNull();
    }
  });

  it('exige sessão da equipe', async () => {
    await http.get('/api/relatorios/pedidos/aceites').expect(401);
    await http
      .get('/api/relatorios/pedidos/aceites')
      .set('Authorization', `Bearer ${tokenCliente}`)
      .expect(401);
  });
});
