/**
 * Trocar a própria senha.
 *
 * Vale para os dois domínios. O que se testa aqui é o que a tela não mostra:
 * que a senha atual é exigida mesmo com sessão válida, que a troca derruba
 * TODAS as sessões daquele principal, e que um domínio não alcança o outro.
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../app.module';

const temBanco = Boolean(process.env['DATABASE_URL'] && process.env['DIRECT_URL']);

const ADMIN = { email: 'rodrigo@lojacentro.com.br', senha: 'Estoque@2026' };

let app: INestApplication;
let http: ReturnType<typeof request>;
let tokenAdmin: string;

interface Sessao {
  tokenAcesso: string;
  tokenRefresh: string;
}

function sufixo(): string {
  return Math.random().toString(36).toUpperCase().slice(2, 9);
}

async function entrar(rota: string, dados: { email: string; senha: string }): Promise<Sessao> {
  const resposta = await http
    .post(rota)
    .send({ ...dados, canal: 'app' })
    .expect(200);
  return resposta.body as Sessao;
}

/** Um acesso de portal descartável, para não mexer na senha do seed. */
async function acessoDescartavel(): Promise<{ email: string; senha: string; clienteId: string }> {
  const s = sufixo();

  const tabelas = (
    await http.get('/api/clientes/apoio').set('Authorization', `Bearer ${tokenAdmin}`).expect(200)
  ).body.tabelas as { id: string; chave: string }[];

  const cliente = (
    await http
      .post('/api/clientes')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        nome: `Cliente senha ${s}`,
        documento: `SN${s}`,
        tabelaPrecoId: tabelas.find((t) => t.chave === 'PROFESSOR')!.id,
      })
      .expect(201)
  ).body as { id: string };

  const email = `senha${s.toLowerCase()}@exemplo.com.br`;
  const criado = (
    await http
      .post(`/api/clientes/${cliente.id}/acessos`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nome: 'Dono da senha', email })
      .expect(201)
  ).body as { senhaProvisoria: string };

  criados.push(cliente.id);
  return { email, senha: criado.senhaProvisoria, clienteId: cliente.id };
}

/*
  Todo cadastro de cliente criado aqui sai DESATIVADO no fim.

  Sem isso o teste degrada o ambiente que ele proprio usa: cadastro de teste
  acumulado empurra os clientes de verdade para fora da primeira pagina.
  Desativar, nao apagar — cliente aparece em venda, pedido e titulo.
*/
const criados: string[] = [];

beforeAll(async () => {
  if (!temBanco) return;

  const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = modulo.createNestApplication();
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  await app.init();

  http = request(app.getHttpServer());
  tokenAdmin = (await entrar('/api/auth/login', ADMIN)).tokenAcesso;
}, 60_000);

afterAll(async () => {
  if (app) {
    for (const id of criados) {
      await http
        .patch(`/api/clientes/${id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ status: 'INATIVO' });
    }

    await app.close();
  }
}, 60_000);

describe.runIf(temBanco)('o cliente troca a própria senha', () => {
  it('troca, a nova entra e a antiga não', async () => {
    const conta = await acessoDescartavel();
    const sessao = await entrar('/api/portal/auth/login', conta);
    const nova = `Nova${sufixo()}2026`;

    await http
      .post('/api/portal/auth/senha')
      .set('Authorization', `Bearer ${sessao.tokenAcesso}`)
      .send({ senhaAtual: conta.senha, novaSenha: nova })
      .expect(204);

    await entrar('/api/portal/auth/login', { email: conta.email, senha: nova });

    await http
      .post('/api/portal/auth/login')
      .send({ email: conta.email, senha: conta.senha, canal: 'app' })
      .expect(401);
  });

  /**
   * Sessão prova que alguém entrou, não que é o dono AGORA.
   *
   * Sem esta exigência, uma aba esquecida aberta no balcão vira troca de
   * senha por quem passar ali — e o dono perde a conta sem digitar nada.
   */
  it('exige a senha atual mesmo com sessão válida', async () => {
    const conta = await acessoDescartavel();
    const sessao = await entrar('/api/portal/auth/login', conta);

    const recusa = await http
      .post('/api/portal/auth/senha')
      .set('Authorization', `Bearer ${sessao.tokenAcesso}`)
      .send({ senhaAtual: 'chute-errado', novaSenha: `Nova${sufixo()}2026` })
      .expect(401);

    expect((recusa.body as { codigo: string }).codigo).toBe('SENHA_ATUAL_INCORRETA');

    // E a senha continua sendo a antiga.
    await entrar('/api/portal/auth/login', conta);
  });

  it('a troca derruba as OUTRAS sessões, não só a que trocou', async () => {
    const conta = await acessoDescartavel();

    // Dois aparelhos, duas famílias de refresh.
    const aparelhoA = await entrar('/api/portal/auth/login', conta);
    const aparelhoB = await entrar('/api/portal/auth/login', conta);

    await http
      .post('/api/portal/auth/senha')
      .set('Authorization', `Bearer ${aparelhoA.tokenAcesso}`)
      .send({ senhaAtual: conta.senha, novaSenha: `Nova${sufixo()}2026` })
      .expect(204);

    // O aparelho B nunca soube da troca. Se a sessão dele sobrevivesse,
    // trocar a senha não teria expulsado ninguém — que é o motivo de trocar.
    await http
      .post('/api/portal/auth/refresh')
      .send({ refreshToken: aparelhoB.tokenRefresh, canal: 'app' })
      .expect(401);
  });

  it('recusa senha curta e senha igual à atual', async () => {
    const conta = await acessoDescartavel();
    const sessao = await entrar('/api/portal/auth/login', conta);

    await http
      .post('/api/portal/auth/senha')
      .set('Authorization', `Bearer ${sessao.tokenAcesso}`)
      .send({ senhaAtual: conta.senha, novaSenha: 'curta123' })
      .expect(400);

    const igual = await http
      .post('/api/portal/auth/senha')
      .set('Authorization', `Bearer ${sessao.tokenAcesso}`)
      .send({ senhaAtual: conta.senha, novaSenha: conta.senha })
      .expect(401);

    expect((igual.body as { codigo: string }).codigo).toBe('SENHA_IGUAL_A_ATUAL');
  });

  /** Token de um domínio não abre a rota do outro. 401, não 403. ADR-009. */
  it('o token do cliente não troca a senha de funcionário', async () => {
    const conta = await acessoDescartavel();
    const sessao = await entrar('/api/portal/auth/login', conta);

    await http
      .post('/api/auth/senha')
      .set('Authorization', `Bearer ${sessao.tokenAcesso}`)
      .send({ senhaAtual: conta.senha, novaSenha: `Nova${sufixo()}2026` })
      .expect(401);
  });

  it('sem sessão não troca nada', async () => {
    await http
      .post('/api/portal/auth/senha')
      .send({ senhaAtual: 'qualquer', novaSenha: `Nova${sufixo()}2026` })
      .expect(401);
  });
});
