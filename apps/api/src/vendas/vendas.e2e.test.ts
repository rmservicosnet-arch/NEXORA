/**
 * Testes de ponta a ponta do PDV.
 *
 * O que estes testes existem para impedir:
 *
 *  1. **Venda sem baixa de estoque.** As duas coisas estão na mesma transação
 *     ou o balanço nunca mais fecha.
 *  2. **Preço e custo não congelados.** Mudar a tabela de preços depois não
 *     pode reescrever faturamento passado, e compra de hoje não pode alterar a
 *     margem de ontem.
 *  3. **Numeração duplicada.** Dois caixas vendendo ao mesmo tempo.
 *  4. **Cancelamento que apaga o histórico.** Estorno é lançamento contrário.
 *  5. **Pagamento que não fecha.** Faltando ou sobrando onde não pode sobrar.
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
/** Vendedora: `venda.criar` e `preco.aplicar_desconto`, sem `estoque.vender_sem_saldo`. */
const VENDEDORA = { email: 'marina@lojacentro.com.br', senha: 'Estoque@2026' };
/** Estoquista: movimenta estoque, mas não vende. */
const ESTOQUISTA = { email: 'sergio@lojacentro.com.br', senha: 'Estoque@2026' };

let app: INestApplication;
let http: ReturnType<typeof request>;
let tokenAdmin: string;
let loja: { id: string; nome: string; localPadraoId: string | null };
let locais: { id: string; lojaId: string; nome: string; padraoVenda: boolean }[];

interface Venda {
  id: string;
  numero: number;
  status: string;
  total: string;
  subtotal: string;
  troco: string;
  local: string;
  itens: {
    sku: string;
    quantidade: string;
    precoUnitario: string;
    totalItem: string;
    precoOrigem: string;
    custoUnitario?: string;
  }[];
  pagamentos: { forma: string; valor: string }[];
  custoTotal?: string;
  margem?: string;
  motivoCancelamento: string | null;
}

interface Resultado {
  venda: Venda;
  avisos: { codigo: string; mensagem: string }[];
}

async function entrar(dados: { email: string; senha: string }): Promise<string> {
  const resposta = await http
    .post('/api/auth/login')
    .send({ ...dados, canal: 'app' })
    .expect(200);
  return (resposta.body as { tokenAcesso: string }).tokenAcesso;
}

/** Cria produto com preço na tabela padrão e devolve a variação. */
async function produtoComPreco(preco: string): Promise<{ variacaoId: string; sku: string }> {
  const sufixo = Math.random().toString(36).toUpperCase().slice(2, 8);

  const criado = await http
    .post('/api/produtos')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send({
      skuBase: `PDV-${sufixo}`,
      nome: `Item de PDV ${sufixo}`,
      variacoes: [{ sku: `PDV-${sufixo}-U`, descricao: 'única', precoPadrao: preco }],
    })
    .expect(201);

  const detalhe = await http
    .get(`/api/produtos/${(criado.body as { id: string }).id}`)
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .expect(200);

  const variacao = (detalhe.body as { variacoes: { id: string; sku: string }[] }).variacoes[0]!;
  return { variacaoId: variacao.id, sku: variacao.sku };
}

async function abastecer(variacaoId: string, quantidade: string, custo: string): Promise<void> {
  const local = locais.find((l) => l.id === loja.localPadraoId)!;

  await http
    .post('/api/estoque/entrada')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send({
      variacaoId,
      lojaId: local.lojaId,
      localId: local.id,
      quantidade,
      custoUnitario: custo,
    })
    .expect(201);
}

async function saldoDe(variacaoId: string): Promise<number> {
  const pagina = await http
    .get(`/api/estoque/movimentos?variacaoId=${variacaoId}&limite=1`)
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .expect(200);

  const itens = (pagina.body as { itens: { saldoPosterior: string }[] }).itens;
  return itens.length > 0 ? Number(itens[0]!.saldoPosterior) : 0;
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

  const contexto = (
    await http.get('/api/vendas/contexto').set('Authorization', `Bearer ${tokenAdmin}`).expect(200)
  ).body as { lojas: (typeof loja)[] };

  loja = contexto.lojas.find((l) => l.localPadraoId !== null)!;

  locais = (
    await http.get('/api/estoque/locais').set('Authorization', `Bearer ${tokenAdmin}`).expect(200)
  ).body as typeof locais;

  // Venda em dinheiro exige caixa aberto. Reaproveita o que já estiver aberto
  // de uma execução anterior — o índice único impede abrir um segundo.
  const existente = (
    await http
      .get(`/api/caixa/meu?lojaId=${loja.id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200)
  ).body as { caixa: { id: string } | null };

  if (!existente.caixa) {
    await http
      .post('/api/caixa/abrir')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ lojaId: loja.id, valorAbertura: '200.00' })
      .expect(201);
  }
}, 60_000);

afterAll(async () => {
  if (app) {
    await app.close();
  }
});

describe.runIf(temBanco)('contexto do PDV', () => {
  it('diz onde vender e o que o operador pode fazer', () => {
    expect(loja.localPadraoId).toBeTruthy();
    expect(loja.nome.length).toBeGreaterThan(0);
  });

  it('o estoquista não abre o PDV', async () => {
    const token = await entrar(ESTOQUISTA);
    await http.get('/api/vendas/contexto').set('Authorization', `Bearer ${token}`).expect(403);
  });
});

describe.runIf(temBanco)('venda de balcão', () => {
  it('conclui, baixa o estoque e congela preço e custo', async () => {
    const { variacaoId, sku } = await produtoComPreco('150.00');
    await abastecer(variacaoId, '10', '60.00');

    const antes = await saldoDe(variacaoId);

    const resultado = (
      await http
        .post('/api/vendas')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          lojaId: loja.id,
          itens: [{ variacaoId, quantidade: '2' }],
          pagamentos: [{ forma: 'PIX', valor: '300.00' }],
        })
        .expect(201)
    ).body as Resultado;

    const { venda } = resultado;

    expect(venda.status).toBe('CONCLUIDA');
    expect(venda.numero).toBeGreaterThan(0);
    expect(venda.subtotal).toBe('300.00');
    expect(venda.total).toBe('300.00');
    expect(venda.troco).toBe('0.00');

    expect(venda.itens).toHaveLength(1);
    expect(venda.itens[0]!.sku).toBe(sku);
    // Preço veio da tabela, não digitado.
    expect(venda.itens[0]!.precoOrigem).toBe('TABELA');
    expect(venda.itens[0]!.precoUnitario).toBe('150.00');
    // Custo congelado no instante da saída.
    expect(venda.itens[0]!.custoUnitario).toBe('60.000000');

    // Margem: 300 de venda, 120 de custo.
    expect(venda.custoTotal).toBe('120.00');
    expect(venda.margem).toBe('180.00');

    // E o estoque baixou.
    expect(await saldoDe(variacaoId)).toBe(antes - 2);
  });

  it('a baixa aparece no razão como SAIDA_VENDA, ligada à venda', async () => {
    const { variacaoId } = await produtoComPreco('80.00');
    await abastecer(variacaoId, '5', '30.00');

    const venda = (
      await http
        .post('/api/vendas')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          lojaId: loja.id,
          itens: [{ variacaoId, quantidade: '3' }],
          pagamentos: [{ forma: 'DEBITO', valor: '240.00' }],
        })
        .expect(201)
    ).body as Resultado;

    const pagina = (
      await http
        .get(`/api/estoque/movimentos?variacaoId=${variacaoId}&limite=5`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200)
    ).body as { itens: { tipo: string; quantidade: string; documentoNumero: string | null }[] };

    const saida = pagina.itens[0]!;
    expect(saida.tipo).toBe('SAIDA_VENDA');
    expect(saida.quantidade).toBe('3.000000');
    // O número da venda fica no movimento: é assim que se vai do razão ao cupom.
    expect(saida.documentoNumero).toBe(String(venda.venda.numero));
  });

  it('mudar o preço da tabela depois NÃO reescreve a venda', async () => {
    const { variacaoId } = await produtoComPreco('100.00');
    await abastecer(variacaoId, '5', '40.00');

    const venda = (
      await http
        .post('/api/vendas')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          lojaId: loja.id,
          itens: [{ variacaoId, quantidade: '1' }],
          pagamentos: [{ forma: 'PIX', valor: '100.00' }],
        })
        .expect(201)
    ).body as Resultado;

    // Entrada nova a custo bem diferente: muda o custo médio de hoje.
    await abastecer(variacaoId, '100', '90.00');

    const relida = (
      await http
        .get(`/api/vendas/${venda.venda.id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200)
    ).body as Venda;

    // A margem de ontem não muda porque comprei caro hoje.
    expect(relida.itens[0]!.custoUnitario).toBe('40.000000');
    expect(relida.itens[0]!.precoUnitario).toBe('100.00');
    expect(relida.margem).toBe('60.00');
  });

  it('aceita várias formas de pagamento na mesma venda', async () => {
    const { variacaoId } = await produtoComPreco('200.00');
    await abastecer(variacaoId, '5', '50.00');

    const resultado = (
      await http
        .post('/api/vendas')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          lojaId: loja.id,
          itens: [{ variacaoId, quantidade: '1' }],
          pagamentos: [
            { forma: 'DINHEIRO', valor: '50.00' },
            {
              forma: 'CREDITO',
              valor: '150.00',
              parcelas: 3,
              bandeira: 'Visa',
              ultimosQuatro: '4321',
            },
          ],
        })
        .expect(201)
    ).body as Resultado;

    expect(resultado.venda.pagamentos).toHaveLength(2);
    expect(resultado.venda.total).toBe('200.00');
    expect(resultado.venda.troco).toBe('0.00');
  });

  it('dinheiro a mais vira troco, e o troco é avisado', async () => {
    const { variacaoId } = await produtoComPreco('87.50');
    await abastecer(variacaoId, '5', '20.00');

    const resultado = (
      await http
        .post('/api/vendas')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          lojaId: loja.id,
          itens: [{ variacaoId, quantidade: '1' }],
          pagamentos: [{ forma: 'DINHEIRO', valor: '100.00' }],
        })
        .expect(201)
    ).body as Resultado;

    expect(resultado.venda.troco).toBe('12.50');
    expect(resultado.avisos.map((a) => a.codigo)).toContain('TROCO');
  });

  it('cartão a mais é recusado — só dinheiro devolve troco', async () => {
    const { variacaoId } = await produtoComPreco('87.50');
    await abastecer(variacaoId, '5', '20.00');

    const recusa = await http
      .post('/api/vendas')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        lojaId: loja.id,
        itens: [{ variacaoId, quantidade: '1' }],
        pagamentos: [{ forma: 'CREDITO', valor: '100.00' }],
      })
      .expect(400);

    expect((recusa.body as { codigo: string }).codigo).toBe('PAGAMENTO_EXCEDE_TOTAL');
  });

  it('pagamento a menos é recusado, dizendo quanto falta', async () => {
    const { variacaoId } = await produtoComPreco('100.00');
    await abastecer(variacaoId, '5', '20.00');

    const recusa = await http
      .post('/api/vendas')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        lojaId: loja.id,
        itens: [{ variacaoId, quantidade: '2' }],
        pagamentos: [{ forma: 'PIX', valor: '150.00' }],
      })
      .expect(400);

    /*
      Com VÍRGULA. A mensagem é lida por gente no balcão, e "R$ 50.00" num
      texto em português é o formato de outro país — o helper `formatarBRL`
      existia em `@estoque/core` desde sempre e 15 mensagens o ignoravam.
    */
    expect((recusa.body as { mensagem: string }).mensagem).toContain('R$ 50,00');
  });

  it('nada fica gravado quando a venda falha no meio', async () => {
    const { variacaoId } = await produtoComPreco('100.00');
    await abastecer(variacaoId, '5', '20.00');

    const saldoAntes = await saldoDe(variacaoId);

    // Pagamento insuficiente: a recusa acontece DEPOIS da baixa de estoque
    // dentro da transação. Se a transação não segurar, o estoque baixa e a
    // venda não existe — a pior divergência possível.
    await http
      .post('/api/vendas')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        lojaId: loja.id,
        itens: [{ variacaoId, quantidade: '2' }],
        pagamentos: [{ forma: 'PIX', valor: '1.00' }],
      })
      .expect(400);

    expect(await saldoDe(variacaoId)).toBe(saldoAntes);
  });
});

describe.runIf(temBanco)('dinheiro exige caixa', () => {
  it('a vendedora, sem caixa aberto, não recebe em dinheiro', async () => {
    const token = await entrar(VENDEDORA);
    const { variacaoId } = await produtoComPreco('20.00');
    await abastecer(variacaoId, '5', '5.00');

    const recusa = await http
      .post('/api/vendas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        lojaId: loja.id,
        itens: [{ variacaoId, quantidade: '1' }],
        pagamentos: [{ forma: 'DINHEIRO', valor: '20.00' }],
      })
      .expect(409);

    expect((recusa.body as { codigo: string }).codigo).toBe('CAIXA_FECHADO');
  });

  it('mas conclui em PIX — cartão e PIX não vão para a gaveta', async () => {
    const token = await entrar(VENDEDORA);
    const { variacaoId } = await produtoComPreco('20.00');
    await abastecer(variacaoId, '5', '5.00');

    await http
      .post('/api/vendas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        lojaId: loja.id,
        itens: [{ variacaoId, quantidade: '1' }],
        pagamentos: [{ forma: 'PIX', valor: '20.00' }],
      })
      .expect(201);
  });
});

describe.runIf(temBanco)('numeração', () => {
  it('cinco vendas simultâneas recebem números diferentes', async () => {
    const { variacaoId } = await produtoComPreco('10.00');
    await abastecer(variacaoId, '50', '4.00');

    // Sem o lock por empresa, todas leem o mesmo `max(numero)` e quatro morrem
    // no índice único — no balcão, com o cliente esperando.
    const respostas = await Promise.all(
      Array.from({ length: 5 }, () =>
        http
          .post('/api/vendas')
          .set('Authorization', `Bearer ${tokenAdmin}`)
          .send({
            lojaId: loja.id,
            itens: [{ variacaoId, quantidade: '1' }],
            pagamentos: [{ forma: 'PIX', valor: '10.00' }],
          }),
      ),
    );

    for (const r of respostas) {
      expect(r.status).toBe(201);
    }

    const numeros = respostas.map((r) => (r.body as Resultado).venda.numero);
    expect(new Set(numeros).size).toBe(5);
  });
});

describe.runIf(temBanco)('desconto e preço manual', () => {
  it('quem não tem preco.aplicar_desconto não digita preço', async () => {
    const token = await entrar(ESTOQUISTA);
    const { variacaoId } = await produtoComPreco('100.00');

    // O estoquista nem chega ao preço: não tem `venda.criar`.
    await http
      .post('/api/vendas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        lojaId: loja.id,
        itens: [{ variacaoId, quantidade: '1', precoUnitario: '1.00' }],
        pagamentos: [{ forma: 'PIX', valor: '1.00' }],
      })
      .expect(403);
  });

  it('preço digitado fica marcado como MANUAL', async () => {
    const { variacaoId } = await produtoComPreco('100.00');
    await abastecer(variacaoId, '5', '20.00');

    const resultado = (
      await http
        .post('/api/vendas')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          lojaId: loja.id,
          itens: [{ variacaoId, quantidade: '1', precoUnitario: '75.00' }],
          pagamentos: [{ forma: 'DINHEIRO', valor: '75.00' }],
        })
        .expect(201)
    ).body as Resultado;

    // Não dá para deduzir isso depois comparando com a tabela: ela muda.
    expect(resultado.venda.itens[0]!.precoOrigem).toBe('MANUAL');
    expect(resultado.venda.itens[0]!.precoUnitario).toBe('75.00');
  });

  it('desconto maior que a venda é recusado', async () => {
    const { variacaoId } = await produtoComPreco('50.00');
    await abastecer(variacaoId, '5', '20.00');

    await http
      .post('/api/vendas')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        lojaId: loja.id,
        itens: [{ variacaoId, quantidade: '1' }],
        desconto: '80.00',
        pagamentos: [{ forma: 'DINHEIRO', valor: '1.00' }],
      })
      .expect(400);
  });
});

describe.runIf(temBanco)('saldo negativo no balcão', () => {
  it('a vendedora não conclui venda que deixaria o saldo negativo', async () => {
    const token = await entrar(VENDEDORA);
    const { variacaoId } = await produtoComPreco('40.00');
    await abastecer(variacaoId, '1', '10.00');

    const recusa = await http
      .post('/api/vendas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        lojaId: loja.id,
        itens: [{ variacaoId, quantidade: '5' }],
        pagamentos: [{ forma: 'PIX', valor: '200.00' }],
      })
      .expect(409);

    expect((recusa.body as { codigo: string }).codigo).toBe('SEM_PERMISSAO_SALDO_NEGATIVO');
  });

  it('quem tem a permissão conclui, e a venda avisa', async () => {
    const { variacaoId } = await produtoComPreco('40.00');
    await abastecer(variacaoId, '1', '10.00');

    const resultado = (
      await http
        .post('/api/vendas')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          lojaId: loja.id,
          itens: [{ variacaoId, quantidade: '5' }],
          pagamentos: [{ forma: 'PIX', valor: '200.00' }],
        })
        .expect(201)
    ).body as Resultado;

    expect(resultado.avisos.map((a) => a.codigo)).toContain('SALDO_NEGATIVO');
    expect(await saldoDe(variacaoId)).toBe(-4);
  });
});

describe.runIf(temBanco)('cancelamento', () => {
  it('devolve a mercadoria por lançamento contrário, sem apagar nada', async () => {
    const { variacaoId } = await produtoComPreco('120.00');
    await abastecer(variacaoId, '10', '45.00');

    const antes = await saldoDe(variacaoId);

    const venda = (
      await http
        .post('/api/vendas')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          lojaId: loja.id,
          itens: [{ variacaoId, quantidade: '4' }],
          pagamentos: [{ forma: 'DINHEIRO', valor: '480.00' }],
        })
        .expect(201)
    ).body as Resultado;

    expect(await saldoDe(variacaoId)).toBe(antes - 4);

    const cancelada = (
      await http
        .post(`/api/vendas/${venda.venda.id}/cancelar`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ motivo: 'Cliente desistiu na hora do pagamento' })
        .expect(201)
    ).body as Venda;

    expect(cancelada.status).toBe('CANCELADA');
    expect(cancelada.motivoCancelamento).toContain('desistiu');
    // A venda continua existindo, com os itens.
    expect(cancelada.itens).toHaveLength(1);

    // E o estoque voltou.
    expect(await saldoDe(variacaoId)).toBe(antes);

    // O razão tem os DOIS movimentos: a saída e o estorno.
    const pagina = (
      await http
        .get(`/api/estoque/movimentos?variacaoId=${variacaoId}&limite=5`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200)
    ).body as { itens: { tipo: string; justificativa: string | null }[] };

    expect(pagina.itens[0]!.tipo).toBe('ENTRADA_DEVOLUCAO_CLIENTE');
    expect(pagina.itens[0]!.justificativa).toContain('Cancelamento da venda');
    expect(pagina.itens[1]!.tipo).toBe('SAIDA_VENDA');
  });

  it('a mercadoria volta pelo custo da venda, não pelo custo de hoje', async () => {
    const { variacaoId } = await produtoComPreco('120.00');
    await abastecer(variacaoId, '10', '50.00');

    const venda = (
      await http
        .post('/api/vendas')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          lojaId: loja.id,
          itens: [{ variacaoId, quantidade: '10' }],
          pagamentos: [{ forma: 'PIX', valor: '1200.00' }],
        })
        .expect(201)
    ).body as Resultado;

    // Saldo zerado. Agora o custo médio "de hoje" seria outro qualquer.
    await http
      .post(`/api/vendas/${venda.venda.id}/cancelar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ motivo: 'Erro do operador no fechamento' })
      .expect(201);

    const pagina = (
      await http
        .get(`/api/estoque/movimentos?variacaoId=${variacaoId}&limite=1`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200)
    ).body as { itens: { custoUnitario?: string; custoMedioDepois?: string }[] };

    expect(pagina.itens[0]!.custoUnitario).toBe('50.000000');
    expect(pagina.itens[0]!.custoMedioDepois).toBe('50.000000');
  });

  it('não cancela duas vezes', async () => {
    const { variacaoId } = await produtoComPreco('30.00');
    await abastecer(variacaoId, '5', '10.00');

    const venda = (
      await http
        .post('/api/vendas')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          lojaId: loja.id,
          itens: [{ variacaoId, quantidade: '1' }],
          pagamentos: [{ forma: 'PIX', valor: '30.00' }],
        })
        .expect(201)
    ).body as Resultado;

    await http
      .post(`/api/vendas/${venda.venda.id}/cancelar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ motivo: 'Primeiro cancelamento' })
      .expect(201);

    const segunda = await http
      .post(`/api/vendas/${venda.venda.id}/cancelar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ motivo: 'Segundo cancelamento' })
      .expect(409);

    expect((segunda.body as { codigo: string }).codigo).toBe('VENDA_JA_CANCELADA');
  });

  it('a vendedora não cancela venda', async () => {
    const token = await entrar(VENDEDORA);
    const { variacaoId } = await produtoComPreco('30.00');
    await abastecer(variacaoId, '5', '10.00');

    const venda = (
      await http
        .post('/api/vendas')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          lojaId: loja.id,
          itens: [{ variacaoId, quantidade: '1' }],
          pagamentos: [{ forma: 'PIX', valor: '30.00' }],
        })
        .expect(201)
    ).body as Resultado;

    await http
      .post(`/api/vendas/${venda.venda.id}/cancelar`)
      .set('Authorization', `Bearer ${token}`)
      .send({ motivo: 'Tentativa sem permissão' })
      .expect(403);
  });
});

describe.runIf(temBanco)('listagem', () => {
  it('quem não tem venda.ver_todas vê apenas as próprias', async () => {
    const token = await entrar(VENDEDORA);
    const { variacaoId } = await produtoComPreco('25.00');
    await abastecer(variacaoId, '5', '10.00');

    // Uma venda do admin, para existir venda de outra pessoa.
    await http
      .post('/api/vendas')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        lojaId: loja.id,
        itens: [{ variacaoId, quantidade: '1' }],
        pagamentos: [{ forma: 'PIX', valor: '25.00' }],
      })
      .expect(201);

    const daVendedora = (
      await http.get('/api/vendas?limite=50').set('Authorization', `Bearer ${token}`).expect(200)
    ).body as { itens: { vendedor: string }[] };

    // Pedir o filtro de outro vendedor não amplia o que ela vê.
    const nomes = new Set(daVendedora.itens.map((v) => v.vendedor));
    expect(nomes.size).toBeLessThanOrEqual(1);
    if (nomes.size === 1) {
      expect([...nomes][0]).toContain('Marina');
    }
  });

  it('omite custo e margem para quem não tem produto.ver_custo', async () => {
    const token = await entrar(VENDEDORA);

    const resposta = await http
      .get('/api/vendas?limite=10')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(resposta.text).not.toContain('custoUnitario');
    expect(resposta.text).not.toContain('custoTotal');
    expect(resposta.text).not.toContain('margem');
  });
});
