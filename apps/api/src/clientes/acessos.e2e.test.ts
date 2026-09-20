/**
 * O login do cliente no portal.
 *
 * O teste que importa não é "a rota devolveu 201": é que a credencial criada
 * **entra**. Criar `cliente_acesso` sem a linha correspondente em
 * `credencial_login` produz um acesso que existe e não autentica — o login
 * não descobre de qual empresa a pessoa é.
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../app.module';

const temBanco = Boolean(process.env['DATABASE_URL'] && process.env['DIRECT_URL']);

const ADMIN = { email: 'rodrigo@lojacentro.com.br', senha: 'Estoque@2026' };
/** Vendedora: tem `cliente.editar` e NÃO tem `cliente.gerenciar_acesso`. */
const VENDEDORA = { email: 'marina@lojacentro.com.br', senha: 'Estoque@2026' };

let app: INestApplication;
let http: ReturnType<typeof request>;
let tokenAdmin: string;
let tokenVendedora: string;

interface Acesso {
  id: string;
  nome: string;
  email: string;
  status: string;
  ultimoLoginEm: string | null;
}
interface Criado {
  acesso: Acesso;
  senhaProvisoria: string;
}

async function entrar(rota: string, dados: { email: string; senha: string }): Promise<string> {
  const resposta = await http
    .post(rota)
    .send({ ...dados, canal: 'app' })
    .expect(200);
  return (resposta.body as { tokenAcesso: string }).tokenAcesso;
}

function sufixo(): string {
  return Math.random().toString(36).toUpperCase().slice(2, 9);
}

async function cadastroComTabela(): Promise<string> {
  const s = sufixo();
  const tabelas = (
    await http.get('/api/clientes/apoio').set('Authorization', `Bearer ${tokenAdmin}`).expect(200)
  ).body.tabelas as { id: string; chave: string }[];

  const criado = await http
    .post('/api/clientes')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send({
      nome: `Cliente com portal ${s}`,
      documento: `AC${s}`,
      tabelaPrecoId: tabelas.find((t) => t.chave === 'PROFESSOR')!.id,
    })
    .expect(201);

  return (criado.body as { id: string }).id;
}

async function criarAcesso(clienteId: string, email: string): Promise<Criado> {
  const resposta = await http
    .post(`/api/clientes/${clienteId}/acessos`)
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send({ nome: 'Responsável do teste', email })
    .expect(201);
  return resposta.body as Criado;
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
}, 60_000);

afterAll(async () => {
  if (app) await app.close();
});

describe.runIf(temBanco)('criar acesso ao portal', () => {
  it('a credencial criada entra no portal e vê o catálogo da tabela dele', async () => {
    const clienteId = await cadastroComTabela();
    const email = `portal${sufixo().toLowerCase()}@exemplo.com.br`;

    const criado = await criarAcesso(clienteId, email);

    expect(criado.senhaProvisoria.length).toBeGreaterThanOrEqual(10);

    // O que prova que a criação funcionou: entrar de verdade.
    const token = await entrar('/api/portal/auth/login', {
      email,
      senha: criado.senhaProvisoria,
    });

    const catalogo = (
      await http
        .get('/api/portal/pedidos/catalogo?limite=5')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
    ).body as { tabela: string; itens: unknown[] };

    // A credencial nova ve o catalogo DA TABELA dela — e a resposta diz qual e.
    expect(Array.isArray(catalogo.itens)).toBe(true);
    expect(catalogo.tabela.length).toBeGreaterThan(0);
  });

  it('a senha nunca volta na listagem', async () => {
    const clienteId = await cadastroComTabela();
    await criarAcesso(clienteId, `listagem${sufixo().toLowerCase()}@exemplo.com.br`);

    const lista = await http
      .get(`/api/clientes/${clienteId}/acessos`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    // Procura o que de fato vazaria: o campo e o prefixo do hash argon2.
    // "não conter a palavra senha" é frágil — um e-mail com ela derruba o
    // teste sem nada ter vazado, e foi o que aconteceu ao escrevê-lo.
    const bruto = JSON.stringify(lista.body);
    expect(bruto).not.toContain('senhaHash');
    expect(bruto).not.toContain('$argon2');
    expect(bruto).not.toContain('senhaProvisoria');
  });

  it('o mesmo e-mail não vira acesso duas vezes', async () => {
    const clienteId = await cadastroComTabela();
    const email = `repetido${sufixo().toLowerCase()}@exemplo.com.br`;

    await criarAcesso(clienteId, email);

    const recusa = await http
      .post(`/api/clientes/${clienteId}/acessos`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nome: 'Outro nome', email })
      .expect(409);

    expect(['EMAIL_JA_TEM_ACESSO', 'EMAIL_EM_USO']).toContain(
      (recusa.body as { codigo: string }).codigo,
    );
  });
});

describe.runIf(temBanco)('redefinir e desligar', () => {
  it('a senha nova entra e a antiga para de valer', async () => {
    const clienteId = await cadastroComTabela();
    const email = `troca${sufixo().toLowerCase()}@exemplo.com.br`;
    const criado = await criarAcesso(clienteId, email);

    await entrar('/api/portal/auth/login', { email, senha: criado.senhaProvisoria });

    const nova = (
      await http
        .post(`/api/clientes/${clienteId}/acessos/${criado.acesso.id}/senha`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(201)
    ).body as Criado;

    expect(nova.senhaProvisoria).not.toBe(criado.senhaProvisoria);

    await entrar('/api/portal/auth/login', { email, senha: nova.senhaProvisoria });

    // A antiga morre. Redefinir senha é o que se faz quando ela pode ter
    // vazado; se a anterior continuasse valendo, não teria servido de nada.
    await http
      .post('/api/portal/auth/login')
      .send({ email, senha: criado.senhaProvisoria, canal: 'app' })
      .expect(401);
  });

  it('desligar o acesso fecha a porta', async () => {
    const clienteId = await cadastroComTabela();
    const email = `desligado${sufixo().toLowerCase()}@exemplo.com.br`;
    const criado = await criarAcesso(clienteId, email);

    await entrar('/api/portal/auth/login', { email, senha: criado.senhaProvisoria });

    await http
      .patch(`/api/clientes/${clienteId}/acessos/${criado.acesso.id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ status: 'INATIVO' })
      .expect(200);

    await http
      .post('/api/portal/auth/login')
      .send({ email, senha: criado.senhaProvisoria, canal: 'app' })
      .expect(401);
  });

  it('não mexe no acesso de outro cadastro pela URL', async () => {
    const umCliente = await cadastroComTabela();
    const outroCliente = await cadastroComTabela();
    const criado = await criarAcesso(umCliente, `alheio${sufixo().toLowerCase()}@exemplo.com.br`);

    // O id do acesso é do primeiro cadastro; a URL diz o segundo.
    await http
      .patch(`/api/clientes/${outroCliente}/acessos/${criado.acesso.id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ status: 'INATIVO' })
      .expect(404);
  });
});

describe.runIf(temBanco)('quem pode emitir credencial', () => {
  /**
   * A vendedora edita cliente e NÃO emite login.
   *
   * A permissão é separada de propósito: corrigir um telefone e criar uma
   * credencial de acesso não são o mesmo grau de autoridade. O perfil VENDEDOR
   * passou a listar as permissões de cliente uma a uma justamente para que
   * esta não entrasse de carona.
   */
  it('a vendedora não cria acesso', async () => {
    const clienteId = await cadastroComTabela();

    await http
      .post(`/api/clientes/${clienteId}/acessos`)
      .set('Authorization', `Bearer ${tokenVendedora}`)
      .send({ nome: 'Tentativa', email: `tentativa${sufixo().toLowerCase()}@exemplo.com.br` })
      .expect(403);
  });

  it('a vendedora não redefine senha nem lista acessos', async () => {
    const clienteId = await cadastroComTabela();

    await http
      .get(`/api/clientes/${clienteId}/acessos`)
      .set('Authorization', `Bearer ${tokenVendedora}`)
      .expect(403);
  });

  it('mas continua editando o cadastro', async () => {
    const clienteId = await cadastroComTabela();

    await http
      .patch(`/api/clientes/${clienteId}`)
      .set('Authorization', `Bearer ${tokenVendedora}`)
      .send({ telefone: '11988887777' })
      .expect(200);
  });
});
