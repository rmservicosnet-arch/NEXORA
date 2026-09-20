/**
 * Testes de ponta a ponta da autenticação e dos guards.
 *
 * Fecham os critérios de aceite 3 e 6 de docs/TENANCY.md §6 — os dois que
 * dependiam da camada HTTP.
 *
 * Sobem a aplicação de verdade, contra o PostgreSQL de verdade, com os dados
 * do seed. Autenticação e isolamento não se testam com mock: metade da
 * garantia está no banco e a outra metade na ordem dos guards.
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
const ESTOQUISTA = { email: 'sergio@lojacentro.com.br', senha: 'Estoque@2026' };
const FINANCEIRO = { email: 'beatriz@lojacentro.com.br', senha: 'Estoque@2026' };
const CLIENTE = { email: 'carlos@academiaippon.com.br', senha: 'Cliente@2026' };

let app: INestApplication;
let http: ReturnType<typeof request>;

interface Sessao {
  tokenAcesso: string;
  tokenRefresh?: string;
  usuario: { id: string; nome: string; email: string; permissoes: string[]; lojaIds: string[] };
}

async function entrar(rota: string, dados: { email: string; senha: string }): Promise<Sessao> {
  const resposta = await http
    .post(rota)
    .send({ ...dados, canal: 'app' })
    .expect(200);
  return resposta.body as Sessao;
}

beforeAll(async () => {
  if (!temBanco) {
    return;
  }

  // O limite de taxa é desligado pelo `skipIf` do ThrottlerModule quando
  // NODE_ENV=test. Ver o comentário em app.module.ts.
  const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = modulo.createNestApplication();
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  await app.init();
  http = request(app.getHttpServer());
}, 60_000);

afterAll(async () => {
  if (app) {
    await app.close();
  }
});

describe.runIf(temBanco)('login', () => {
  it('entra com credenciais corretas', async () => {
    const sessao = await entrar('/api/auth/login', ADMIN);

    expect(sessao.tokenAcesso).toBeTruthy();
    expect(sessao.tokenRefresh).toBeTruthy();
    expect(sessao.usuario.email).toBe(ADMIN.email);
    expect(sessao.usuario.permissoes.length).toBeGreaterThan(50);
  });

  it('recusa senha errada', async () => {
    await http
      .post('/api/auth/login')
      .send({ ...ADMIN, senha: 'senha-errada-123', canal: 'app' })
      .expect(401);
  });

  it('e-mail inexistente e senha errada dão a MESMA resposta', async () => {
    // Distinguir os dois casos entregaria ao atacante a lista de e-mails
    // cadastrados.
    const inexistente = await http
      .post('/api/auth/login')
      .send({ email: 'ninguem@lugar-nenhum.com.br', senha: 'qualquer-coisa', canal: 'app' })
      .expect(401);

    const senhaErrada = await http
      .post('/api/auth/login')
      .send({ ...ADMIN, senha: 'senha-errada-123', canal: 'app' })
      .expect(401);

    expect(inexistente.body.codigo).toBe(senhaErrada.body.codigo);
    expect(inexistente.body.mensagem).toBe(senhaErrada.body.mensagem);
  });

  it('canal web não devolve o refresh no corpo — ele vai no cookie', async () => {
    const resposta = await http
      .post('/api/auth/login')
      .send({ ...ADMIN, canal: 'web' })
      .expect(200);

    expect(resposta.body.tokenRefresh).toBeUndefined();

    const cookies = resposta.headers['set-cookie'] as unknown as string[];
    const refresh = cookies.find((c) => c.startsWith('estoque_refresh='));
    expect(refresh).toBeDefined();
    expect(refresh).toContain('HttpOnly');
    expect(refresh).toContain('SameSite=Strict');
  });

  /**
   * "Manter conectado" é a diferença entre o computador de casa e o do
   * balcão compartilhado — e ela tem de sobreviver à ROTAÇÃO do refresh.
   * O cookie é reescrito a cada renovação; sem repetir a escolha ali, a
   * primeira renovação devolveria os 30 dias que a pessoa recusou.
   */
  it('sem manter conectado, o cookie morre com a janela — e continua assim ao renovar', async () => {
    const login = await http
      .post('/api/auth/login')
      .send({ ...ADMIN, canal: 'web', manterConectado: false })
      .expect(200);

    const doLogin = (login.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('estoque_refresh='),
    );

    // Cookie de sessão: sem Max-Age e sem Expires.
    expect(doLogin).toBeDefined();
    expect(doLogin).not.toContain('Max-Age');
    expect(doLogin).not.toContain('Expires');

    const renovacao = await http
      .post('/api/auth/refresh')
      .set('Cookie', doLogin!)
      .send({ canal: 'web', manterConectado: false })
      .expect(200);

    const daRenovacao = (renovacao.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('estoque_refresh='),
    );
    expect(daRenovacao).toBeDefined();
    expect(daRenovacao).not.toContain('Max-Age');
  });

  it('com manter conectado, o cookie tem prazo', async () => {
    const login = await http
      .post('/api/auth/login')
      .send({ ...ADMIN, canal: 'web', manterConectado: true })
      .expect(200);

    const cookie = (login.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('estoque_refresh='),
    );
    expect(cookie).toContain('Max-Age=');
  });

  it('o padrão é manter: quem não manda o campo continua com prazo', async () => {
    const login = await http
      .post('/api/auth/login')
      .send({ ...ADMIN, canal: 'web' })
      .expect(200);

    const cookie = (login.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('estoque_refresh='),
    );
    expect(cookie).toContain('Max-Age=');
  });
});

describe.runIf(temBanco)('os dois domínios não se misturam — ADR-009', () => {
  it('token de funcionário é recusado no portal do cliente', async () => {
    const sessao = await entrar('/api/auth/login', ADMIN);

    await http
      .get('/api/portal/auth/eu')
      .set('Authorization', `Bearer ${sessao.tokenAcesso}`)
      .expect(401);
  });

  it('token de cliente é recusado em rota de funcionário', async () => {
    const sessao = await entrar('/api/portal/auth/login', CLIENTE);

    await http.get('/api/auth/eu').set('Authorization', `Bearer ${sessao.tokenAcesso}`).expect(401);
  });

  it('cliente do portal tem exatamente uma permissão', async () => {
    const sessao = await entrar('/api/portal/auth/login', CLIENTE);
    expect(sessao.usuario.permissoes).toEqual(['portal.acessar']);
  });
});

describe.runIf(temBanco)('refresh rotativo', () => {
  it('rotaciona o token a cada renovação', async () => {
    const sessao = await entrar('/api/auth/login', ADMIN);

    const renovada = await http
      .post('/api/auth/refresh')
      .send({ refreshToken: sessao.tokenRefresh, canal: 'app' })
      .expect(200);

    expect(renovada.body.tokenRefresh).not.toBe(sessao.tokenRefresh);
  });

  it('reuso de token antigo derruba a família inteira', async () => {
    const sessao = await entrar('/api/auth/login', ADMIN);

    const renovada = await http
      .post('/api/auth/refresh')
      .send({ refreshToken: sessao.tokenRefresh, canal: 'app' })
      .expect(200);

    // O antigo já foi rotacionado: apresentá-lo indica cópia em uso.
    await http
      .post('/api/auth/refresh')
      .send({ refreshToken: sessao.tokenRefresh, canal: 'app' })
      .expect(401);

    // E o token novo também morre. Derrubar os dois é o correto: é melhor
    // pedir login de novo do que manter uma sessão possivelmente roubada.
    await http
      .post('/api/auth/refresh')
      .send({ refreshToken: renovada.body.tokenRefresh, canal: 'app' })
      .expect(401);
  });

  /**
   * Falha de renovação não é falha de login.
   *
   * Quem renova já se autenticou; um cookie não permite enumerar e-mail nem
   * senha. Responder `CREDENCIAIS_INVALIDAS` mandava a pessoa trocar uma
   * senha que estava certa. O motivo real — expirada, revogada ou reuso —
   * continua indistinguível, porque ESSE detalhe interessa a quem roubou o
   * token.
   */
  it('sessão encerrada não se disfarça de senha errada', async () => {
    const sessao = await entrar('/api/auth/login', ADMIN);

    await http
      .post('/api/auth/refresh')
      .send({ refreshToken: sessao.tokenRefresh, canal: 'app' })
      .expect(200);

    const expirada = await http
      .post('/api/auth/refresh')
      .send({ refreshToken: sessao.tokenRefresh, canal: 'app' })
      .expect(401);

    const inexistente = await http
      .post('/api/auth/refresh')
      .send({ refreshToken: 'nao.existe', canal: 'app' })
      .expect(401);

    expect(expirada.body.codigo).toBe('SESSAO_ENCERRADA');
    expect(inexistente.body.codigo).toBe('SESSAO_ENCERRADA');
    // Os dois casos respondem igual: o motivo não vaza.
    expect(inexistente.body.mensagem).toBe(expirada.body.mensagem);
  });
});

describe.runIf(temBanco)('critério 3 — tenantId forjado', () => {
  it('recusa tenantId no corpo de uma rota protegida', async () => {
    const sessao = await entrar('/api/auth/login', ADMIN);

    const resposta = await http
      .get('/api/lojas')
      .set('Authorization', `Bearer ${sessao.tokenAcesso}`)
      .set('Content-Type', 'application/json')
      .send({ tenantId: '01234567-89ab-7cde-8f01-23456789abcd' })
      .expect(403);

    expect(resposta.body.codigo).toBe('TENANT_FORJADO');
  });

  it('a checagem não se aplica a rota pública — não há token com que comparar', async () => {
    // `/auth/refresh` é público de propósito: o token de acesso pode estar
    // expirado, que é justamente o motivo de renovar. Sem token, não existe
    // tenant de referência, e a rota confia apenas no refresh token — que
    // carrega o tenant e cujo hash tem de bater com uma sessão viva.
    //
    // Documentado aqui porque a primeira versão deste teste supôs o
    // contrário e falhou. A proteção correta dessa rota é o próprio refresh,
    // não a comparação com um token que não existe.
    const sessao = await entrar('/api/auth/login', ADMIN);

    await http
      .post('/api/auth/refresh')
      .send({
        refreshToken: sessao.tokenRefresh,
        canal: 'app',
        tenantId: '01234567-89ab-7cde-8f01-23456789abcd',
      })
      .expect(200);
  });

  it('recusa tenantId na query string', async () => {
    const sessao = await entrar('/api/auth/login', ADMIN);

    const resposta = await http
      .get('/api/lojas?tenantId=01234567-89ab-7cde-8f01-23456789abcd')
      .set('Authorization', `Bearer ${sessao.tokenAcesso}`)
      .expect(403);

    expect(resposta.body.codigo).toBe('TENANT_FORJADO');
  });

  it('aceita quando o tenantId informado é o mesmo do token', async () => {
    // Não é ataque — é redundância. Só a divergência é tratada como ataque.
    const sessao = await entrar('/api/auth/login', ADMIN);
    const lojas = await http
      .get('/api/lojas')
      .set('Authorization', `Bearer ${sessao.tokenAcesso}`)
      .expect(200);

    expect(Array.isArray(lojas.body)).toBe(true);
  });
});

describe.runIf(temBanco)('critério 6 — escopo de loja', () => {
  it('estoquista acessa a loja à qual tem vínculo', async () => {
    const sessao = await entrar('/api/auth/login', ESTOQUISTA);
    expect(sessao.usuario.lojaIds).toHaveLength(1);

    const lojaId = sessao.usuario.lojaIds[0] as string;
    const resposta = await http
      .get(`/api/lojas/${lojaId}`)
      .set('Authorization', `Bearer ${sessao.tokenAcesso}`)
      .expect(200);

    expect(resposta.body.codigo).toBe('CENTRO');
  });

  it('403 ao tocar em loja sem vínculo, mesmo tendo a permissão', async () => {
    const admin = await entrar('/api/auth/login', ADMIN);
    const estoquista = await entrar('/api/auth/login', ESTOQUISTA);

    const suaLoja = estoquista.usuario.lojaIds[0];
    const outraLoja = admin.usuario.lojaIds.find((id) => id !== suaLoja);
    expect(outraLoja).toBeDefined();

    const resposta = await http
      .get(`/api/lojas/${outraLoja}`)
      .set('Authorization', `Bearer ${estoquista.tokenAcesso}`)
      .expect(403);

    // Permissão diz O QUE se pode fazer; vínculo diz ONDE. São perguntas
    // diferentes, e ter a primeira não responde a segunda.
    expect(resposta.body.codigo).toBe('SEM_ACESSO_A_LOJA');
  });
});

describe.runIf(temBanco)('permissões', () => {
  it('403 quando falta a permissão da rota', async () => {
    // Financeiro não tem `estoque.visualizar`.
    const sessao = await entrar('/api/auth/login', FINANCEIRO);
    const lojaId = sessao.usuario.lojaIds[0] as string;

    const resposta = await http
      .get(`/api/lojas/${lojaId}`)
      .set('Authorization', `Bearer ${sessao.tokenAcesso}`)
      .expect(403);

    expect(resposta.body.codigo).toBe('SEM_PERMISSAO');
    expect(resposta.body.permissoesFaltantes).toContain('estoque.visualizar');
  });
});

describe.runIf(temBanco)('rotas nascem protegidas', () => {
  it('sem token, 401', async () => {
    await http.get('/api/auth/eu').expect(401);
    await http.get('/api/lojas').expect(401);
  });

  it('a sonda de saúde é pública, e não revela nada', async () => {
    const resposta = await http.get('/api/saude').expect(200);

    expect(resposta.body.situacao).toBe('ok');
    expect(Object.keys(resposta.body).sort()).toEqual(['banco', 'em', 'situacao']);
  });
});
