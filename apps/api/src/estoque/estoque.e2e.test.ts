/**
 * Testes de ponta a ponta da movimentação de estoque.
 *
 * O que estes testes existem para impedir:
 *
 *  1. **Razão que não encadeia.** `saldo_posterior` de um movimento tem que ser
 *     o `saldo_anterior` do seguinte. Quebrar isso é perder o histórico sem
 *     perceber, e nenhuma tela mostraria.
 *  2. **Custo médio recalculado errado.** A matemática está testada em
 *     `packages/core`; aqui se prova que a API usa aquela matemática, e não
 *     uma segunda versão dela.
 *  3. **Concorrência.** Duas saídas simultâneas do mesmo item não podem ler o
 *     mesmo saldo.
 *  4. **Estoque de outra loja.** Permissão diz o quê; vínculo diz onde.
 *
 * Pré-requisito: `npm run db:seed`.
 */

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { PaginaMovimentos } from '@estoque/contracts';
import { diaISO } from '@estoque/core';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../app.module';

const temBanco = Boolean(process.env['DATABASE_URL'] && process.env['DIRECT_URL']);

const ADMIN = { email: 'rodrigo@lojacentro.com.br', senha: 'Estoque@2026' };
/** Estoquista, restrito à loja CENTRO pelo seed. */
const ESTOQUISTA = { email: 'sergio@lojacentro.com.br', senha: 'Estoque@2026' };
/** Vendedora: não tem nenhuma permissão de movimentar estoque. */
const VENDEDORA = { email: 'marina@lojacentro.com.br', senha: 'Estoque@2026' };

let app: INestApplication;
let http: ReturnType<typeof request>;
let tokenAdmin: string;
let locais: Local[];

interface Local {
  id: string;
  nome: string;
  lojaId: string;
  loja: string;
  padraoVenda: boolean;
}

interface Movimento {
  id: string;
  sentido: string;
  tipo: string;
  quantidade: string;
  saldoAnterior: string;
  saldoPosterior: string;
  saldoNegativo: boolean;
  custoUnitario?: string;
  custoMedioAntes?: string;
  custoMedioDepois?: string;
  politicaCusto?: string;
  justificativa: string | null;
}

interface Resultado {
  movimento: Movimento;
  saldoPosterior: string;
  custoMedioDepois?: string;
  avisos: { codigo: string; mensagem: string }[];
}

async function entrar(dados: { email: string; senha: string }): Promise<string> {
  const resposta = await http
    .post('/api/auth/login')
    .send({ ...dados, canal: 'app' })
    .expect(200);
  return (resposta.body as { tokenAcesso: string }).tokenAcesso;
}

/** Cria um produto novo e devolve o id da primeira variação. */
async function novaVariacao(token: string): Promise<string> {
  const sufixo = Math.random().toString(36).toUpperCase().slice(2, 8);

  const criado = await http
    .post('/api/produtos')
    .set('Authorization', `Bearer ${token}`)
    .send({
      skuBase: `EST-${sufixo}`,
      nome: `Item de estoque ${sufixo}`,
      variacoes: [{ sku: `EST-${sufixo}-U`, descricao: 'única', precoPadrao: '100.00' }],
    })
    .expect(201);

  const detalhe = await http
    .get(`/api/produtos/${(criado.body as { id: string }).id}`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  return (detalhe.body as { variacoes: { id: string }[] }).variacoes[0]!.id;
}

function entrada(
  token: string,
  variacaoId: string,
  local: Local,
  quantidade: string,
  custoUnitario: string,
) {
  return http.post('/api/estoque/entrada').set('Authorization', `Bearer ${token}`).send({
    variacaoId,
    lojaId: local.lojaId,
    localId: local.id,
    quantidade,
    custoUnitario,
  });
}

function saida(token: string, variacaoId: string, local: Local, quantidade: string) {
  return http.post('/api/estoque/saida').set('Authorization', `Bearer ${token}`).send({
    variacaoId,
    lojaId: local.lojaId,
    localId: local.id,
    quantidade,
    tipo: 'SAIDA_PERDA',
    justificativa: 'Teste automatizado de saída',
  });
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

  locais = (
    await http.get('/api/estoque/locais').set('Authorization', `Bearer ${tokenAdmin}`).expect(200)
  ).body as Local[];
}, 60_000);

afterAll(async () => {
  if (app) {
    await app.close();
  }
});

describe.runIf(temBanco)('locais', () => {
  it('lista os locais das lojas a que o usuário tem vínculo', () => {
    expect(locais.length).toBeGreaterThan(0);
    expect(locais.every((l) => l.lojaId && l.loja)).toBe(true);
  });

  it('o estoquista só enxerga os locais da loja dele', async () => {
    const token = await entrar(ESTOQUISTA);

    const dele = (
      await http.get('/api/estoque/locais').set('Authorization', `Bearer ${token}`).expect(200)
    ).body as Local[];

    expect(dele.length).toBeGreaterThan(0);
    // Uma loja só — a do vínculo.
    expect(new Set(dele.map((l) => l.lojaId)).size).toBe(1);
    expect(dele.length).toBeLessThan(locais.length);
  });
});

describe.runIf(temBanco)('custo médio ponderado', () => {
  it('a média é recalculada na entrada e não muda na saída', async () => {
    const variacaoId = await novaVariacao(tokenAdmin);
    const local = locais[0]!;

    // 10 a 20,00 → média 20
    const primeira = (await entrada(tokenAdmin, variacaoId, local, '10', '20.00').expect(201))
      .body as Resultado;

    expect(primeira.saldoPosterior).toBe('10.000000');
    expect(primeira.custoMedioDepois).toBe('20.000000');
    expect(primeira.movimento.politicaCusto).toBe('CUSTO_REDEFINIDO');

    // +10 a 30,00 → (10×20 + 10×30) ÷ 20 = 25
    const segunda = (await entrada(tokenAdmin, variacaoId, local, '10', '30.00').expect(201))
      .body as Resultado;

    expect(segunda.saldoPosterior).toBe('20.000000');
    expect(segunda.custoMedioDepois).toBe('25.000000');
    expect(segunda.movimento.politicaCusto).toBe('MEDIA_PONDERADA');

    // Saída consome ao custo vigente e NÃO mexe na média.
    const tirada = (await saida(tokenAdmin, variacaoId, local, '5').expect(201)).body as Resultado;

    expect(tirada.saldoPosterior).toBe('15.000000');
    expect(tirada.custoMedioDepois).toBe('25.000000');
    expect(tirada.movimento.politicaCusto).toBe('SEM_EFEITO');
    expect(tirada.movimento.custoUnitario).toBe('25.000000');
  });

  it('o razão encadeia: o posterior de um é o anterior do seguinte', async () => {
    const variacaoId = await novaVariacao(tokenAdmin);
    const local = locais[0]!;

    await entrada(tokenAdmin, variacaoId, local, '30', '10.00').expect(201);
    await saida(tokenAdmin, variacaoId, local, '4').expect(201);
    await entrada(tokenAdmin, variacaoId, local, '20', '14.00').expect(201);
    await saida(tokenAdmin, variacaoId, local, '6').expect(201);

    const pagina = (
      await http
        .get(`/api/estoque/movimentos?variacaoId=${variacaoId}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200)
    ).body as { itens: Movimento[] };

    // A listagem vem do mais novo para o mais antigo.
    const cronologico = [...pagina.itens].reverse();
    expect(cronologico).toHaveLength(4);

    expect(cronologico[0]!.saldoAnterior).toBe('0.000000');

    for (let i = 1; i < cronologico.length; i += 1) {
      expect(cronologico[i]!.saldoAnterior).toBe(cronologico[i - 1]!.saldoPosterior);
      // O mesmo vale para o custo médio: o depois de um é o antes do próximo.
      expect(cronologico[i]!.custoMedioAntes).toBe(cronologico[i - 1]!.custoMedioDepois);
    }
  });

  it('entrada com saldo zerado adota o custo da entrada, sem ponderar com zero', async () => {
    const variacaoId = await novaVariacao(tokenAdmin);
    const local = locais[0]!;

    await entrada(tokenAdmin, variacaoId, local, '5', '40.00').expect(201);
    await saida(tokenAdmin, variacaoId, local, '5').expect(201);

    // Saldo zero. Ponderar 0×40 com 5×10 daria 10 — que por acaso está certo —,
    // mas a política gravada precisa dizer que foi redefinição, não média.
    const retorno = (await entrada(tokenAdmin, variacaoId, local, '5', '10.00').expect(201))
      .body as Resultado;

    expect(retorno.custoMedioDepois).toBe('10.000000');
    expect(retorno.movimento.politicaCusto).toBe('CUSTO_REDEFINIDO');
  });
});

describe.runIf(temBanco)('saldo negativo', () => {
  it('é permitido para quem tem a permissão — e nunca em silêncio', async () => {
    const variacaoId = await novaVariacao(tokenAdmin);
    const local = locais[0]!;

    await entrada(tokenAdmin, variacaoId, local, '2', '10.00').expect(201);

    const resultado = (await saida(tokenAdmin, variacaoId, local, '5').expect(201))
      .body as Resultado;

    expect(resultado.saldoPosterior).toBe('-3.000000');
    expect(resultado.movimento.saldoNegativo).toBe(true);

    // O aviso é a parte que não pode faltar.
    expect(resultado.avisos.map((a) => a.codigo)).toContain('SALDO_NEGATIVO');
  });

  it('a entrada seguinte regulariza e avisa quantas unidades cobriu', async () => {
    const variacaoId = await novaVariacao(tokenAdmin);
    const local = locais[0]!;

    await entrada(tokenAdmin, variacaoId, local, '2', '10.00').expect(201);
    await saida(tokenAdmin, variacaoId, local, '5').expect(201);

    const cobertura = (await entrada(tokenAdmin, variacaoId, local, '10', '12.00').expect(201))
      .body as Resultado;

    expect(cobertura.saldoPosterior).toBe('7.000000');
    expect(cobertura.avisos.map((a) => a.codigo)).toContain('REGULARIZACAO');
  });

  it('o movimento negativo fica achável pelo filtro', async () => {
    const pagina = (
      await http
        .get('/api/estoque/movimentos?apenasNegativos=true&limite=5')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200)
    ).body as { itens: Movimento[] };

    expect(pagina.itens.length).toBeGreaterThan(0);
    expect(pagina.itens.every((m) => m.saldoNegativo)).toBe(true);
  });
});

describe.runIf(temBanco)('transferência', () => {
  it('move a mercadoria e leva o custo junto', async () => {
    const variacaoId = await novaVariacao(tokenAdmin);
    const origem = locais[0]!;
    const destino = locais.find((l) => l.id !== origem.id)!;

    await entrada(tokenAdmin, variacaoId, origem, '10', '35.00').expect(201);

    const resposta = await http
      .post('/api/estoque/transferencia')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        variacaoId,
        lojaOrigemId: origem.lojaId,
        localOrigemId: origem.id,
        lojaDestinoId: destino.lojaId,
        localDestinoId: destino.id,
        quantidade: '4',
      })
      .expect(201);

    const { saida: saiu, entrada: entrou } = resposta.body as {
      saida: Movimento;
      entrada: Movimento;
    };

    expect(saiu.saldoPosterior).toBe('6.000000');
    expect(entrou.saldoPosterior).toBe('4.000000');
    // Transferir não cria nem destrói valor: o custo atravessa.
    expect(entrou.custoUnitario).toBe('35.000000');
    expect(entrou.custoMedioDepois).toBe('35.000000');
  });

  it('recusa origem igual ao destino', async () => {
    const variacaoId = await novaVariacao(tokenAdmin);
    const local = locais[0]!;

    await http
      .post('/api/estoque/transferencia')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        variacaoId,
        lojaOrigemId: local.lojaId,
        localOrigemId: local.id,
        lojaDestinoId: local.lojaId,
        localDestinoId: local.id,
        quantidade: '1',
      })
      .expect(400);
  });
});

describe.runIf(temBanco)('contagem de inventário', () => {
  it('ajusta para o que foi contado, para mais e para menos', async () => {
    const variacaoId = await novaVariacao(tokenAdmin);
    const local = locais[0]!;

    await entrada(tokenAdmin, variacaoId, local, '10', '25.00').expect(201);

    // Contou 7: sobra de 3 para baixo.
    const falta = (
      await http
        .post('/api/estoque/contagem')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ variacaoId, lojaId: local.lojaId, localId: local.id, quantidadeContada: '7' })
        .expect(200)
    ).body as Resultado;

    expect(falta.movimento.tipo).toBe('SAIDA_INVENTARIO');
    expect(falta.movimento.quantidade).toBe('3.000000');
    expect(falta.saldoPosterior).toBe('7.000000');
    // A contagem não é lugar de reavaliar mercadoria.
    expect(falta.custoMedioDepois).toBe('25.000000');

    // Agora contou 9: sobra de 2 para cima, ao mesmo custo.
    const sobra = (
      await http
        .post('/api/estoque/contagem')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ variacaoId, lojaId: local.lojaId, localId: local.id, quantidadeContada: '9' })
        .expect(200)
    ).body as Resultado;

    expect(sobra.movimento.tipo).toBe('ENTRADA_INVENTARIO');
    expect(sobra.saldoPosterior).toBe('9.000000');
    expect(sobra.custoMedioDepois).toBe('25.000000');
  });

  it('contagem que bate não gera movimento', async () => {
    const variacaoId = await novaVariacao(tokenAdmin);
    const local = locais[0]!;

    await entrada(tokenAdmin, variacaoId, local, '8', '11.00').expect(201);

    const resposta = await http
      .post('/api/estoque/contagem')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ variacaoId, lojaId: local.lojaId, localId: local.id, quantidadeContada: '8' })
      .expect(200);

    expect(resposta.body).toEqual({ semDiferenca: true });

    const pagina = (
      await http
        .get(`/api/estoque/movimentos?variacaoId=${variacaoId}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200)
    ).body as { itens: Movimento[] };

    // Só a entrada. Razão cheio de movimento zero esconde os que importam.
    expect(pagina.itens).toHaveLength(1);
  });
});

describe.runIf(temBanco)('concorrência', () => {
  it('dez saídas simultâneas não perdem lançamento nem quebram o encadeamento', async () => {
    const variacaoId = await novaVariacao(tokenAdmin);
    const local = locais[0]!;

    await entrada(tokenAdmin, variacaoId, local, '100', '10.00').expect(201);

    // Sem `FOR UPDATE` na linha de saldo, várias destas leem o mesmo saldo,
    // calculam a partir dele e gravam por cima uma da outra: o razão fica com
    // dez movimentos que não encadeiam e o saldo final não é 90.
    const respostas = await Promise.all(
      Array.from({ length: 10 }, () => saida(tokenAdmin, variacaoId, local, '1')),
    );

    for (const r of respostas) {
      expect(r.status).toBe(201);
    }

    const pagina = (
      await http
        .get(`/api/estoque/movimentos?variacaoId=${variacaoId}&limite=50`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200)
    ).body as { itens: Movimento[] };

    const cronologico = [...pagina.itens].reverse();
    expect(cronologico).toHaveLength(11);

    for (let i = 1; i < cronologico.length; i += 1) {
      expect(cronologico[i]!.saldoAnterior).toBe(cronologico[i - 1]!.saldoPosterior);
    }

    expect(cronologico[cronologico.length - 1]!.saldoPosterior).toBe('90.000000');
  });
});

describe.runIf(temBanco)('permissão e escopo', () => {
  it('a vendedora não movimenta estoque', async () => {
    const token = await entrar(VENDEDORA);
    const variacaoId = await novaVariacao(tokenAdmin);
    const local = locais[0]!;

    await entrada(token, variacaoId, local, '1', '1.00').expect(403);
    await saida(token, variacaoId, local, '1').expect(403);
  });

  it('o estoquista não movimenta o estoque de outra loja', async () => {
    const token = await entrar(ESTOQUISTA);
    const variacaoId = await novaVariacao(tokenAdmin);

    const dele = (
      await http.get('/api/estoque/locais').set('Authorization', `Bearer ${token}`).expect(200)
    ).body as Local[];

    const lojaDele = dele[0]!.lojaId;
    const deOutra = locais.find((l) => l.lojaId !== lojaDele);

    // O seed só garante outra loja se houver mais de uma.
    if (!deOutra) {
      return;
    }

    await entrada(token, variacaoId, deOutra, '1', '1.00').expect(403);
  });

  it('não dá para alcançar o local de outra loja declarando a própria', async () => {
    const variacaoId = await novaVariacao(tokenAdmin);
    const a = locais[0]!;
    const b = locais.find((l) => l.lojaId !== a.lojaId);

    if (!b) {
      return;
    }

    // Loja à qual tem acesso + local que é de outra. O guard olha o corpo; o
    // serviço confronta com o local de verdade.
    const recusa = await http
      .post('/api/estoque/entrada')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        variacaoId,
        lojaId: a.lojaId,
        localId: b.id,
        quantidade: '1',
        custoUnitario: '1.00',
      })
      .expect(400);

    expect((recusa.body as { codigo: string }).codigo).toBe('LOCAL_DE_OUTRA_LOJA');
  });

  it('o recorte por dia pega o dia INTEIRO, dos dois lados', async () => {
    /*
      `de` e `ate` são dias do calendário de quem opera, e o serviço traduz
      cada um para o começo e o fim do dia.

      `new Date('2026-09-20')` é meia-noite em UTC — 21h do dia 19 em
      Brasília. Como teto, escondia o dia 20 inteiro; como piso, só deixava
      passar o que fosse gravado depois das 21h. O filtro não dava erro: a
      lista vinha vazia, e quem olhasse concluiria que nada se movimentou.
    */
    const variacaoId = await novaVariacao(tokenAdmin);
    const local = locais[0]!;

    await entrada(tokenAdmin, variacaoId, local, '7', '11.00').expect(201);

    const hoje = diaISO();

    const doDia = (
      await http
        .get(`/api/estoque/movimentos?variacaoId=${variacaoId}&de=${hoje}&ate=${hoje}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200)
    ).body as PaginaMovimentos;

    expect(doDia.itens).toHaveLength(1);

    // Amanhã em diante não pode pegar o que foi gravado hoje.
    const amanha = new Date();
    amanha.setDate(amanha.getDate() + 1);

    const depois = (
      await http
        .get(`/api/estoque/movimentos?variacaoId=${variacaoId}&de=${diaISO(amanha)}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200)
    ).body as PaginaMovimentos;

    expect(depois.itens).toHaveLength(0);
  });

  it('data em formato que não é dia é recusada com mensagem, não com pilha', async () => {
    // `new Date('ontem')` é Invalid Date, e o Prisma devolveria 500.
    await http
      .get('/api/estoque/movimentos?de=ontem')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(400);
  });

  it('omite o custo no razão para quem não tem produto.ver_custo', async () => {
    const token = await entrar(VENDEDORA);

    const resposta = await http
      .get('/api/estoque/movimentos?limite=5')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(resposta.text).not.toContain('custoUnitario');
    expect(resposta.text).not.toContain('custoMedio');
    expect(resposta.text).not.toContain('politicaCusto');
  });
});

describe.runIf(temBanco)('validação', () => {
  it('recusa quantidade zero ou negativa', async () => {
    const variacaoId = await novaVariacao(tokenAdmin);
    const local = locais[0]!;

    await entrada(tokenAdmin, variacaoId, local, '0', '10.00').expect(400);
    await entrada(tokenAdmin, variacaoId, local, '-5', '10.00').expect(400);
  });

  it('exige justificativa na saída manual', async () => {
    const variacaoId = await novaVariacao(tokenAdmin);
    const local = locais[0]!;

    await http
      .post('/api/estoque/saida')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        variacaoId,
        lojaId: local.lojaId,
        localId: local.id,
        quantidade: '1',
        tipo: 'SAIDA_PERDA',
      })
      .expect(400);
  });

  it('não aceita SAIDA_VENDA lançada à mão', async () => {
    const variacaoId = await novaVariacao(tokenAdmin);
    const local = locais[0]!;

    // Venda gera movimento pela venda, com o documento que a explica.
    await http
      .post('/api/estoque/saida')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        variacaoId,
        lojaId: local.lojaId,
        localId: local.id,
        quantidade: '1',
        tipo: 'SAIDA_VENDA',
        justificativa: 'tentativa de lançar venda à mão',
      })
      .expect(400);
  });

  it('recusa custo negativo', async () => {
    const variacaoId = await novaVariacao(tokenAdmin);
    const local = locais[0]!;

    await entrada(tokenAdmin, variacaoId, local, '1', '-10.00').expect(400);
  });

  it('aceita custo zero — bonificação existe', async () => {
    const variacaoId = await novaVariacao(tokenAdmin);
    const local = locais[0]!;

    const resultado = (await entrada(tokenAdmin, variacaoId, local, '3', '0').expect(201))
      .body as Resultado;

    expect(resultado.custoMedioDepois).toBe('0.000000');
  });
});
