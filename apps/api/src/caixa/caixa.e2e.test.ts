/**
 * Testes de ponta a ponta do caixa.
 *
 * O que estes testes existem para impedir:
 *
 *  1. **A conta do esperado errada.** `abertura + suprimentos − sangrias +
 *     (dinheiro − troco)`. Esquecer o troco infla o esperado e transforma todo
 *     caixa que deu troco numa falta.
 *  2. **Diferença ajustada em silêncio.** Um caixa que fecha sempre exato
 *     porque o sistema arredonda não controla nada.
 *  3. **Dois caixas abertos pela mesma pessoa.**
 *  4. **Conferência de si mesmo.** Assinatura em branco.
 *  5. **Dinheiro entrando sem caixa aberto.**
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
/** `venda.criar` e `caixa.*`, sem `caixa.conferir`. */
const VENDEDORA = { email: 'marina@lojacentro.com.br', senha: 'Estoque@2026' };

let app: INestApplication;
let http: ReturnType<typeof request>;
let tokenAdmin: string;
let tokenVendedora: string;

/**
 * A loja destes testes é a ÚLTIMA da lista, e a de `vendas.e2e` é a primeira.
 *
 * Os arquivos rodam em paralelo, e o índice único parcial só deixa um caixa
 * aberto por operador e loja. Compartilhar a loja faria um dos dois arquivos
 * falhar de forma intermitente — o pior tipo de teste.
 */
let loja: { id: string; nome: string; localPadraoId: string | null };

interface Caixa {
  id: string;
  numero: number;
  status: string;
  operador: string;
  valorAbertura: string;
  valorContado: string | null;
  valorEsperado: string | null;
  diferenca: string | null;
  conferidoPor: string | null;
  resumo: {
    valorAbertura: string;
    suprimentos: string;
    sangrias: string;
    vendasEmDinheiro: string;
    esperadoEmCaixa: string;
    vendasEmCartao: string;
    vendasEmPix: string;
    totalVendido: string;
    quantidadeVendas: number;
  };
  movimentos: { tipo: string; valor: string; motivo: string }[];
}

async function entrar(dados: { email: string; senha: string }): Promise<string> {
  const resposta = await http
    .post('/api/auth/login')
    .send({ ...dados, canal: 'app' })
    .expect(200);
  return (resposta.body as { tokenAcesso: string }).tokenAcesso;
}

async function caixaAberto(token: string): Promise<Caixa | null> {
  const resposta = await http
    .get(`/api/caixa/meu?lojaId=${loja.id}`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  return (resposta.body as { caixa: Caixa | null }).caixa;
}

/** Fecha o que estiver aberto, para cada teste começar do mesmo lugar. */
async function limpar(token: string): Promise<void> {
  const aberto = await caixaAberto(token);
  if (aberto) {
    await http
      .post(`/api/caixa/${aberto.id}/fechar`)
      .set('Authorization', `Bearer ${token}`)
      .send({ valorContado: aberto.resumo.esperadoEmCaixa })
      .expect(201);
  }
}

async function abrir(token: string, valor: string): Promise<Caixa> {
  await limpar(token);

  const resposta = await http
    .post('/api/caixa/abrir')
    .set('Authorization', `Bearer ${token}`)
    .send({ lojaId: loja.id, valorAbertura: valor })
    .expect(201);

  return resposta.body as Caixa;
}

/** Produto com preço e estoque no local de venda da loja destes testes. */
async function itemVendavel(preco: string, custo: string): Promise<string> {
  const sufixo = Math.random().toString(36).toUpperCase().slice(2, 8);

  const criado = await http
    .post('/api/produtos')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send({
      skuBase: `CX-${sufixo}`,
      nome: `Item de caixa ${sufixo}`,
      variacoes: [{ sku: `CX-${sufixo}-U`, descricao: 'única', precoPadrao: preco }],
    })
    .expect(201);

  const detalhe = await http
    .get(`/api/produtos/${(criado.body as { id: string }).id}`)
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .expect(200);

  const variacaoId = (detalhe.body as { variacoes: { id: string }[] }).variacoes[0]!.id;

  await http
    .post('/api/estoque/entrada')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send({
      variacaoId,
      lojaId: loja.id,
      localId: loja.localPadraoId,
      quantidade: '50',
      custoUnitario: custo,
    })
    .expect(201);

  return variacaoId;
}

async function vender(
  token: string,
  variacaoId: string,
  quantidade: string,
  pagamentos: { forma: string; valor: string }[],
): Promise<void> {
  await http
    .post('/api/vendas')
    .set('Authorization', `Bearer ${token}`)
    .send({ lojaId: loja.id, itens: [{ variacaoId, quantidade }], pagamentos })
    .expect(201);
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

  tokenAdmin = await entrar(ADMIN);
  tokenVendedora = await entrar(VENDEDORA);

  const contexto = (
    await http.get('/api/vendas/contexto').set('Authorization', `Bearer ${tokenAdmin}`).expect(200)
  ).body as { lojas: typeof loja[] };

  const comLocal = contexto.lojas.filter((l) => l.localPadraoId !== null);
  loja = comLocal[comLocal.length - 1]!;
}, 60_000);

afterAll(async () => {
  if (app) {
    await app.close();
  }
});

describe.runIf(temBanco)('abertura', () => {
  it('abre com fundo de troco e começa esperando exatamente ele', async () => {
    const caixa = await abrir(tokenVendedora, '150.00');

    expect(caixa.status).toBe('ABERTO');
    expect(caixa.numero).toBeGreaterThan(0);
    expect(caixa.valorAbertura).toBe('150.00');
    expect(caixa.resumo.esperadoEmCaixa).toBe('150.00');
    expect(caixa.resumo.quantidadeVendas).toBe(0);
  });

  it('não abre dois caixas para a mesma pessoa na mesma loja', async () => {
    await abrir(tokenVendedora, '100.00');

    const recusa = await http
      .post('/api/caixa/abrir')
      .set('Authorization', `Bearer ${tokenVendedora}`)
      .send({ lojaId: loja.id, valorAbertura: '50.00' })
      .expect(409);

    expect((recusa.body as { codigo: string }).codigo).toBe('CAIXA_JA_ABERTO');
  });

  it('"não há caixa aberto" cabe no corpo da resposta', async () => {
    await limpar(tokenVendedora);

    const resposta = await http
      .get(`/api/caixa/meu?lojaId=${loja.id}`)
      .set('Authorization', `Bearer ${tokenVendedora}`)
      .expect(200);

    // `{ caixa: null }`, e não corpo vazio. Handler que devolve `null` manda
    // nada, e o cliente recebe `{}` — que é verdadeiro.
    expect(resposta.body).toEqual({ caixa: null });
  });
});

describe.runIf(temBanco)('a conta do esperado', () => {
  it('soma abertura, suprimento e venda em dinheiro; subtrai sangria e troco', async () => {
    const caixa = await abrir(tokenVendedora, '100.00');
    const item = await itemVendavel('50.00', '20.00');

    // Venda 1: 50,00 em dinheiro, sem troco.
    await vender(tokenVendedora, item, '1', [{ forma: 'DINHEIRO', valor: '50.00' }]);

    // Venda 2: 50,00 pagos com 100,00 → troco de 50,00.
    // Na gaveta ficam 50,00, não 100,00. É AQUI que a conta erra quando
    // alguém esquece de subtrair o troco.
    await vender(tokenVendedora, item, '1', [{ forma: 'DINHEIRO', valor: '100.00' }]);

    // Venda 3: cartão. Não entra na gaveta.
    await vender(tokenVendedora, item, '1', [{ forma: 'CREDITO', valor: '50.00' }]);

    await http
      .post(`/api/caixa/${caixa.id}/movimento`)
      .set('Authorization', `Bearer ${tokenVendedora}`)
      .send({ tipo: 'SUPRIMENTO', valor: '30.00', motivo: 'Troco de moedas do cofre' })
      .expect(201);

    const comSangria = (
      await http
        .post(`/api/caixa/${caixa.id}/movimento`)
        .set('Authorization', `Bearer ${tokenVendedora}`)
        .send({ tipo: 'SANGRIA', valor: '80.00', motivo: 'Retirada para o cofre' })
        .expect(201)
    ).body as Caixa;

    const r = comSangria.resumo;

    expect(r.valorAbertura).toBe('100.00');
    expect(r.suprimentos).toBe('30.00');
    expect(r.sangrias).toBe('80.00');
    // 50 + (100 − 50) = 100
    expect(r.vendasEmDinheiro).toBe('100.00');
    expect(r.vendasEmCartao).toBe('50.00');
    // 100 + 30 − 80 + 100 = 150
    expect(r.esperadoEmCaixa).toBe('150.00');

    // O total vendido é outra conta: inclui o cartão e ignora o troco.
    expect(r.totalVendido).toBe('150.00');
    expect(r.quantidadeVendas).toBe(3);
  });

  it('venda em PIX não entra na gaveta', async () => {
    const caixa = await abrir(tokenVendedora, '40.00');
    const item = await itemVendavel('25.00', '10.00');

    await vender(tokenVendedora, item, '2', [{ forma: 'PIX', valor: '50.00' }]);

    const atual = (
      await http
        .get(`/api/caixa/${caixa.id}`)
        .set('Authorization', `Bearer ${tokenVendedora}`)
        .expect(200)
    ).body as Caixa;

    expect(atual.resumo.vendasEmPix).toBe('50.00');
    expect(atual.resumo.vendasEmDinheiro).toBe('0.00');
    expect(atual.resumo.esperadoEmCaixa).toBe('40.00');
  });

  it('recusa sangria maior do que o que existe na gaveta', async () => {
    const caixa = await abrir(tokenVendedora, '60.00');

    const recusa = await http
      .post(`/api/caixa/${caixa.id}/movimento`)
      .set('Authorization', `Bearer ${tokenVendedora}`)
      .send({ tipo: 'SANGRIA', valor: '200.00', motivo: 'Retirada exagerada' })
      .expect(409);

    expect((recusa.body as { codigo: string }).codigo).toBe('SANGRIA_MAIOR_QUE_O_CAIXA');
  });

  it('exige motivo na sangria', async () => {
    const caixa = await abrir(tokenVendedora, '60.00');

    await http
      .post(`/api/caixa/${caixa.id}/movimento`)
      .set('Authorization', `Bearer ${tokenVendedora}`)
      .send({ tipo: 'SANGRIA', valor: '10.00' })
      .expect(400);
  });
});

describe.runIf(temBanco)('fechamento', () => {
  it('fecha exato quando o contado bate', async () => {
    const caixa = await abrir(tokenVendedora, '80.00');
    const item = await itemVendavel('30.00', '10.00');

    await vender(tokenVendedora, item, '1', [{ forma: 'DINHEIRO', valor: '30.00' }]);

    const fechado = (
      await http
        .post(`/api/caixa/${caixa.id}/fechar`)
        .set('Authorization', `Bearer ${tokenVendedora}`)
        .send({ valorContado: '110.00' })
        .expect(201)
    ).body as Caixa;

    expect(fechado.status).toBe('FECHADO');
    expect(fechado.valorEsperado).toBe('110.00');
    expect(fechado.valorContado).toBe('110.00');
    expect(fechado.diferenca).toBe('0.00');
  });

  it('registra a falta como é, sem ajustar nada', async () => {
    const caixa = await abrir(tokenVendedora, '100.00');

    const fechado = (
      await http
        .post(`/api/caixa/${caixa.id}/fechar`)
        .set('Authorization', `Bearer ${tokenVendedora}`)
        .send({ valorContado: '92.50', observacao: 'Faltou e não achamos o motivo' })
        .expect(201)
    ).body as Caixa;

    // Negativo é falta. Nada de "tolerância" que esconde o buraco.
    expect(fechado.diferenca).toBe('-7.50');
    expect(fechado.valorEsperado).toBe('100.00');
  });

  it('registra a sobra também', async () => {
    const caixa = await abrir(tokenVendedora, '100.00');

    const fechado = (
      await http
        .post(`/api/caixa/${caixa.id}/fechar`)
        .set('Authorization', `Bearer ${tokenVendedora}`)
        .send({ valorContado: '103.00' })
        .expect(201)
    ).body as Caixa;

    expect(fechado.diferenca).toBe('3.00');
  });

  it('não fecha duas vezes', async () => {
    const caixa = await abrir(tokenVendedora, '10.00');

    await http
      .post(`/api/caixa/${caixa.id}/fechar`)
      .set('Authorization', `Bearer ${tokenVendedora}`)
      .send({ valorContado: '10.00' })
      .expect(201);

    const segunda = await http
      .post(`/api/caixa/${caixa.id}/fechar`)
      .set('Authorization', `Bearer ${tokenVendedora}`)
      .send({ valorContado: '10.00' })
      .expect(409);

    expect((segunda.body as { codigo: string }).codigo).toBe('CAIXA_NAO_ESTA_ABERTO');
  });

  it('depois de fechar, dá para abrir outro', async () => {
    await abrir(tokenVendedora, '10.00');
    // `abrir` fecha o anterior. Se o índice único não fosse parcial, esta
    // segunda abertura falharia para sempre.
    const novo = await abrir(tokenVendedora, '20.00');
    expect(novo.status).toBe('ABERTO');
  });
});

describe.runIf(temBanco)('conferência', () => {
  it('quem fechou não confere o próprio caixa', async () => {
    const caixa = await abrir(tokenAdmin, '50.00');

    await http
      .post(`/api/caixa/${caixa.id}/fechar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ valorContado: '50.00' })
      .expect(201);

    const recusa = await http
      .post(`/api/caixa/${caixa.id}/conferir`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({})
      .expect(409);

    expect((recusa.body as { codigo: string }).codigo).toBe('NAO_CONFERE_O_PROPRIO_CAIXA');
  });

  it('outra pessoa com caixa.conferir confere', async () => {
    const caixa = await abrir(tokenVendedora, '70.00');

    await http
      .post(`/api/caixa/${caixa.id}/fechar`)
      .set('Authorization', `Bearer ${tokenVendedora}`)
      .send({ valorContado: '65.00' })
      .expect(201);

    const conferido = (
      await http
        .post(`/api/caixa/${caixa.id}/conferir`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ observacao: 'Falta de R$ 5,00 justificada pela operadora' })
        .expect(201)
    ).body as Caixa;

    expect(conferido.status).toBe('CONFERIDO');
    expect(conferido.conferidoPor).toContain('Rodrigo');
    // A diferença registrada no fechamento não muda na conferência.
    expect(conferido.diferenca).toBe('-5.00');
  });

  it('não confere caixa ainda aberto', async () => {
    const caixa = await abrir(tokenVendedora, '10.00');

    const recusa = await http
      .post(`/api/caixa/${caixa.id}/conferir`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({})
      .expect(409);

    expect((recusa.body as { codigo: string }).codigo).toBe('CAIXA_AINDA_ABERTO');
  });

  it('a vendedora não confere caixa de ninguém', async () => {
    const caixa = await abrir(tokenAdmin, '10.00');

    await http
      .post(`/api/caixa/${caixa.id}/fechar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ valorContado: '10.00' })
      .expect(201);

    await http
      .post(`/api/caixa/${caixa.id}/conferir`)
      .set('Authorization', `Bearer ${tokenVendedora}`)
      .send({})
      .expect(403);
  });
});

describe.runIf(temBanco)('o caixa é de quem o abriu', () => {
  it('a vendedora não enxerga o caixa do admin', async () => {
    const doAdmin = await abrir(tokenAdmin, '10.00');

    const recusa = await http
      .get(`/api/caixa/${doAdmin.id}`)
      .set('Authorization', `Bearer ${tokenVendedora}`)
      .expect(403);

    expect((recusa.body as { codigo: string }).codigo).toBe('CAIXA_DE_OUTRO_OPERADOR');
  });

  it('a listagem dela só traz os dela', async () => {
    await abrir(tokenAdmin, '10.00');
    await abrir(tokenVendedora, '10.00');

    const pagina = (
      await http
        .get('/api/caixa?limite=50')
        .set('Authorization', `Bearer ${tokenVendedora}`)
        .expect(200)
    ).body as { itens: Caixa[] };

    expect(pagina.itens.length).toBeGreaterThan(0);
    expect(pagina.itens.every((c) => c.operador.includes('Marina'))).toBe(true);
  });

  it('quem tem caixa.conferir vê os dos outros', async () => {
    await abrir(tokenVendedora, '10.00');

    const pagina = (
      await http
        .get('/api/caixa?limite=50')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200)
    ).body as { itens: Caixa[] };

    const operadores = new Set(pagina.itens.map((c) => c.operador));
    expect(operadores.size).toBeGreaterThan(1);
  });
});
