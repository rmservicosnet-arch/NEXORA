/**
 * A configuração da empresa.
 *
 * Dez campos existiam no banco, seis eram lidos pelo sistema e NENHUM era
 * editável pela aplicação: `modoCheckout` decidia se o carrinho do cliente
 * vira venda ou pedido, `prazoReservaHoras` decidia quando o estoque
 * reservado volta para a prateleira — e só o seed os definia.
 *
 * O teste que importa não é "o PATCH devolveu 200": é que mudar a
 * configuração muda o COMPORTAMENTO do sistema.
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../app.module';

const temBanco = Boolean(process.env['DATABASE_URL'] && process.env['DIRECT_URL']);

const ADMIN = { email: 'rodrigo@lojacentro.com.br', senha: 'Estoque@2026' };
/** Vendedora: vê o app inteiro e não configura nada. */
const VENDEDORA = { email: 'marina@lojacentro.com.br', senha: 'Estoque@2026' };
const CLIENTE = { email: 'carlos@academiaippon.com.br', senha: 'Cliente@2026' };

let app: INestApplication;
let http: ReturnType<typeof request>;
let tokenAdmin: string;
let tokenVendedora: string;
let tokenCliente: string;
let original: Record<string, unknown>;

interface Config {
  modoCheckout: string;
  momentoCobranca: string;
  validadePedidoHoras: number;
  prazoReservaHoras: number;
  permitirSaldoNegativo: boolean;
  exigirAceiteAumento: boolean;
  modoCaixa: string;
  pushDetalhado: boolean;
  semEfeito: string[];
}

async function entrar(rota: string, dados: { email: string; senha: string }): Promise<string> {
  const r = await http
    .post(rota)
    .send({ ...dados, canal: 'app' })
    .expect(200);
  return (r.body as { tokenAcesso: string }).tokenAcesso;
}

async function ver(): Promise<Config> {
  const r = await http
    .get('/api/configuracao')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .expect(200);
  return r.body as Config;
}

async function mudar(dados: Record<string, unknown>): Promise<Config> {
  const r = await http
    .patch('/api/configuracao')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send(dados)
    .expect(200);
  return r.body as Config;
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

  const atual = await ver();
  original = {
    modoCheckout: atual.modoCheckout,
    validadePedidoHoras: atual.validadePedidoHoras,
    prazoReservaHoras: atual.prazoReservaHoras,
    permitirSaldoNegativo: atual.permitirSaldoNegativo,
    exigirAceiteAumento: atual.exigirAceiteAumento,
    modoCaixa: atual.modoCaixa,
  };
}, 60_000);

afterAll(async () => {
  // Devolve a configuração: outros testes dependem dela, e este arquivo
  // mexe no que vale para a empresa inteira.
  if (http && original) {
    await http
      .patch('/api/configuracao')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send(original);
  }
  if (app) await app.close();
});

describe.runIf(temBanco)('a configuração tem efeito', () => {
  /**
   * `validadePedidoHoras` é o prazo do preço congelado. Mudá-lo precisa
   * mudar o pedido que nasce depois — senão é um número bonito numa tela.
   */
  it('mudar a validade muda o prazo do pedido seguinte', async () => {
    await mudar({ validadePedidoHoras: 96 });

    const catalogo = (
      await http
        .get('/api/portal/pedidos/catalogo?limite=1')
        .set('Authorization', `Bearer ${tokenCliente}`)
        .expect(200)
    ).body as { itens: { variacaoId: string }[] };

    const pedido = (
      await http
        .post('/api/portal/pedidos')
        .set('Authorization', `Bearer ${tokenCliente}`)
        .send({ itens: [{ variacaoId: catalogo.itens[0]!.variacaoId, quantidade: '1' }] })
        .expect(201)
    ).body as { pedido: { validoAte: string } };

    // Sem arredondar: a janela é comparada em milissegundos. O lint bloqueia
    // `Math.round` porque arredondamento aqui é assunto de dinheiro, e a
    // asserção não precisa dele — precisa de um intervalo.
    const restam = new Date(pedido.pedido.validoAte).getTime() - Date.now();

    // 96 horas, não 72: o pedido nasceu com o prazo recém-configurado.
    expect(restam).toBeGreaterThan(95 * 3_600_000);
    expect(restam).toBeLessThanOrEqual(96 * 3_600_000);
  });

  it('recusa prazo fora do intervalo', async () => {
    await http
      .patch('/api/configuracao')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ prazoReservaHoras: 0 })
      .expect(400);

    await http
      .patch('/api/configuracao')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ validadePedidoHoras: 99_999 })
      .expect(400);
  });

  it('alterar um campo não mexe nos outros', async () => {
    const antes = await ver();
    const depois = await mudar({ validadePedidoHoras: antes.validadePedidoHoras + 1 });

    expect(depois.prazoReservaHoras).toBe(antes.prazoReservaHoras);
    expect(depois.modoCheckout).toBe(antes.modoCheckout);
    expect(depois.modoCaixa).toBe(antes.modoCaixa);
  });
});

describe.runIf(temBanco)('o que ainda não faz nada é declarado', () => {
  /**
   * Oferecer uma chave que não faz nada é pior do que não oferecer: a pessoa
   * configura, confia, e o comportamento não muda. A resposta diz quais são,
   * e a tela os desabilita.
   */
  it('a resposta lista os campos sem efeito', async () => {
    const cfg = await ver();

    expect(cfg.semEfeito).toContain('momentoCobranca');
    expect(cfg.semEfeito).toContain('pushDetalhado');
    // E não lista os que funcionam.
    expect(cfg.semEfeito).not.toContain('modoCheckout');
    expect(cfg.semEfeito).not.toContain('prazoReservaHoras');
  });
});

describe.runIf(temBanco)('permissões', () => {
  it('a vendedora não vê nem altera a configuração', async () => {
    await http
      .get('/api/configuracao')
      .set('Authorization', `Bearer ${tokenVendedora}`)
      .expect(403);

    await http
      .patch('/api/configuracao')
      .set('Authorization', `Bearer ${tokenVendedora}`)
      .send({ permitirSaldoNegativo: false })
      .expect(403);
  });

  /** Token do portal na rota da equipe: 401, não 403. ADR-009. */
  it('o cliente não alcança a configuração da empresa', async () => {
    await http.get('/api/configuracao').set('Authorization', `Bearer ${tokenCliente}`).expect(401);
  });
});
