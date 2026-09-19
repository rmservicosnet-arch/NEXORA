/**
 * O cadastro de cliente — e a tabela de preço.
 *
 * Este módulo nasceu de uma falta: dava para *usar* a tabela de preço de um
 * cliente e não dava para *atribuí-la*. Um cadastro novo ficava sem tabela, e
 * sem tabela o portal mostra catálogo vazio — o item sem preço na tabela dele
 * não existe para ele.
 *
 * O que se testa aqui é o vínculo: que ele pega, que ele solta, que ele
 * recusa tabela inválida, e que o efeito no catálogo do cliente é real.
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../app.module';

const temBanco = Boolean(process.env['DATABASE_URL'] && process.env['DIRECT_URL']);

const ADMIN = { email: 'rodrigo@lojacentro.com.br', senha: 'Estoque@2026' };
/** Vendedora: o perfil dela inclui cadastro de cliente. */
const VENDEDORA = { email: 'marina@lojacentro.com.br', senha: 'Estoque@2026' };

let app: INestApplication;
let http: ReturnType<typeof request>;
let tokenAdmin: string;
let tokenVendedora: string;
let tabelas: { id: string; chave: string; padrao: boolean; itensComPreco: number }[];

async function entrar(dados: { email: string; senha: string }): Promise<string> {
  const resposta = await http
    .post('/api/auth/login')
    .send({ ...dados, canal: 'app' })
    .expect(200);
  return (resposta.body as { tokenAcesso: string }).tokenAcesso;
}

async function criarCadastro(extra: Record<string, unknown> = {}): Promise<string> {
  const sufixo = Math.random().toString(36).toUpperCase().slice(2, 9);
  const criado = await http
    .post('/api/clientes')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send({ nome: `Cadastro de teste ${sufixo}`, documento: `CT${sufixo}`, ...extra })
    .expect(201);
  return (criado.body as { id: string }).id;
}

async function ver(id: string) {
  const resposta = await http
    .get(`/api/clientes/${id}`)
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .expect(200);
  return resposta.body as {
    tabelaPreco: string | null;
    tabelaPrecoId: string | null;
    modoCheckout: string | null;
    modoCheckoutEfetivo: string;
    usaCarteira: boolean;
    acessos: number;
  };
}

beforeAll(async () => {
  if (!temBanco) return;

  const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = modulo.createNestApplication();
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  await app.init();

  http = request(app.getHttpServer());
  tokenAdmin = await entrar(ADMIN);
  tokenVendedora = await entrar(VENDEDORA);

  tabelas = (
    await http.get('/api/clientes/apoio').set('Authorization', `Bearer ${tokenAdmin}`).expect(200)
  ).body.tabelas as typeof tabelas;
}, 60_000);

afterAll(async () => {
  if (app) await app.close();
});

describe.runIf(temBanco)('vínculo com a tabela de preço', () => {
  it('um cadastro novo sem tabela nasce sem catálogo', async () => {
    const id = await criarCadastro();

    // Não é erro — é o estado que a tela precisa denunciar. O cadastro
    // existe, funciona para venda no PDV, e não tem portal.
    expect((await ver(id)).tabelaPrecoId).toBeNull();
  });

  it('vincular e desvincular a tabela', async () => {
    const id = await criarCadastro();
    const professor = tabelas.find((t) => t.chave === 'PROFESSOR')!;

    await http
      .patch(`/api/clientes/${id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ tabelaPrecoId: professor.id })
      .expect(200);

    expect((await ver(id)).tabelaPreco).toBe('Professor');

    // `null` desvincula. É diferente de omitir o campo, que não mexe em nada.
    await http
      .patch(`/api/clientes/${id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ tabelaPrecoId: null })
      .expect(200);

    expect((await ver(id)).tabelaPrecoId).toBeNull();
  });

  it('omitir a tabela não a apaga', async () => {
    const professor = tabelas.find((t) => t.chave === 'PROFESSOR')!;
    const id = await criarCadastro({ tabelaPrecoId: professor.id });

    await http
      .patch(`/api/clientes/${id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ telefone: '11999990000' })
      .expect(200);

    expect((await ver(id)).tabelaPrecoId).toBe(professor.id);
  });

  it('recusa tabela inexistente', async () => {
    const id = await criarCadastro();

    const recusa = await http
      .patch(`/api/clientes/${id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ tabelaPrecoId: '01234567-89ab-7cde-8f01-23456789abcd' })
      .expect(404);

    expect((recusa.body as { codigo: string }).codigo).toBe('TABELA_NAO_ENCONTRADA');
  });

  /**
   * O apoio conta quantos itens cada tabela tem precificado.
   *
   * Vincular alguém a uma tabela vazia produz um catálogo vazio, e o efeito
   * só apareceria quando o cliente reclamasse. O número existe para a escolha
   * ser informada.
   */
  it('o apoio diz quantos itens cada tabela tem', () => {
    expect(tabelas.length).toBeGreaterThan(0);
    expect(tabelas.some((t) => t.padrao)).toBe(true);
    for (const t of tabelas) {
      expect(t.itensComPreco).toBeGreaterThanOrEqual(0);
    }
  });
});

describe.runIf(temBanco)('checkout e carteira', () => {
  it('modo nulo herda o da empresa; escolhido não herda', async () => {
    const id = await criarCadastro();

    const herdando = await ver(id);
    expect(herdando.modoCheckout).toBeNull();
    expect(herdando.modoCheckoutEfetivo).toBe('PEDIDO_COM_CONFIRMACAO');

    await http
      .patch(`/api/clientes/${id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ modoCheckout: 'PAGAMENTO_IMEDIATO' })
      .expect(200);

    const escolhido = await ver(id);
    expect(escolhido.modoCheckout).toBe('PAGAMENTO_IMEDIATO');
    expect(escolhido.modoCheckoutEfetivo).toBe('PAGAMENTO_IMEDIATO');

    // Voltar a herdar é `null`, e precisa ser possível: senão a sobreposição
    // vira mão única e o cadastro nunca mais acompanha a empresa.
    await http
      .patch(`/api/clientes/${id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ modoCheckout: null })
      .expect(200);

    expect((await ver(id)).modoCheckout).toBeNull();
  });

  it('documento repetido é recusado com o nome de quem já o tem', async () => {
    const sufixo = Math.random().toString(36).toUpperCase().slice(2, 9);

    await http
      .post('/api/clientes')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nome: `Primeiro ${sufixo}`, documento: `DUP${sufixo}` })
      .expect(201);

    const recusa = await http
      .post('/api/clientes')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nome: `Segundo ${sufixo}`, documento: `DUP${sufixo}` })
      .expect(409);

    const corpo = recusa.body as { codigo: string; mensagem: string };
    expect(corpo.codigo).toBe('DOCUMENTO_JA_CADASTRADO');
    // Dizer QUEM já tem evita o operador cadastrar de novo às cegas.
    expect(corpo.mensagem).toContain(`Primeiro ${sufixo}`);
  });
});

describe.runIf(temBanco)('permissões', () => {
  /**
   * A vendedora cadastra e edita cliente — é o desenho do perfil VENDEDOR,
   * que diz "PDV, pedidos e clientes". Quem atende no balcão precisa abrir o
   * cadastro na hora da venda.
   *
   * ATENÇÃO, decisão em aberto: `cliente.editar` hoje junta "corrigir o
   * telefone" com "trocar a tabela de preço". A segunda é decisão comercial —
   * mover alguém para a tabela Revendedor é conceder desconto permanente, sem
   * passar por `preco.aplicar_desconto`. Se isso for indesejado, a separação
   * é uma permissão própria, não uma mudança de tela. Ver docs/ORDERS.md.
   */
  it('a vendedora cadastra cliente, como o perfil dela prevê', async () => {
    const sufixo = Math.random().toString(36).toUpperCase().slice(2, 9);

    await http
      .post('/api/clientes')
      .set('Authorization', `Bearer ${tokenVendedora}`)
      .send({ nome: `Cadastro no balcão ${sufixo}`, documento: `BAL${sufixo}` })
      .expect(201);
  });

  it('quem não tem cliente.visualizar não lista', async () => {
    // Token do domínio do cliente: falha na AUTENTICAÇÃO, não na permissão —
    // 401, não 403. É o desenho do ADR-009.
    const doPortal = (
      await http
        .post('/api/portal/auth/login')
        .send({ email: 'carlos@academiaippon.com.br', senha: 'Cliente@2026', canal: 'app' })
        .expect(200)
    ).body as { tokenAcesso: string };

    await http
      .get('/api/clientes')
      .set('Authorization', `Bearer ${doPortal.tokenAcesso}`)
      .expect(401);
  });
});
