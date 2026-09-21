import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../app.module';

/**
 * A EQUIPE.
 *
 * O modelo existia desde a Fase 1 — `usuario`, `usuario_perfil`,
 * `usuario_loja_acesso`, `perfil`, `perfil_permissao` — e nao havia rota nem
 * tela: a equipe so existia pelo seed. `usuario.visualizar`, `criar` e
 * `editar` estavam declaradas e nada as usava.
 *
 * O que estes testes fixam e o que o cadastro PRODUZ: usuario, credencial de
 * login e a senha mostrada uma vez. Usuario sem credencial e gente que nao
 * consegue entrar — ja aconteceu com `cliente_acesso`.
 */
const temBanco = Boolean(process.env['DATABASE_URL'] && process.env['DIRECT_URL']);
const ADMIN = { email: 'rodrigo@lojacentro.com.br', senha: 'Estoque@2026' };
const VENDEDORA = { email: 'marina@lojacentro.com.br', senha: 'Estoque@2026' };

let app: INestApplication;
let http: ReturnType<typeof request>;
let token: string;
let perfilVendedorId: string;
let perfilAdminId: string;
let lojaId: string;
let permissoes: string[];

/** Usuarios e perfis criados aqui. Saem DESATIVADOS ou excluidos no fim. */
const usuariosCriados: string[] = [];
const perfisCriados: string[] = [];

function sufixo(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function autenticado(metodo: 'get' | 'post' | 'put' | 'delete', rota: string) {
  return http[metodo](rota).set('Authorization', `Bearer ${token}`);
}

interface Usuario {
  id: string;
  nome: string;
  email: string;
  status: string;
  perfis: { id: string; chave: string }[];
  lojas: { id: string; nome: string }[];
  inerte: boolean;
}

interface Criado {
  usuario: Usuario;
  senhaProvisoria: string;
}

interface Perfil {
  id: string;
  nome: string;
  chave: string;
  sistema: boolean;
  permissoes: string[];
  usuarios: number;
}

async function criarUsuario(extra: Record<string, unknown> = {}): Promise<Criado> {
  const s = sufixo();
  const corpo = {
    nome: `Equipe ${s}`,
    email: `equipe.${s.toLowerCase()}@lojacentro.com.br`,
    perfilIds: [perfilVendedorId],
    lojaIds: [lojaId],
    ...extra,
  };

  const criado = (await autenticado('post', '/api/equipe').send(corpo).expect(201)).body as Criado;
  usuariosCriados.push(criado.usuario.id);
  return criado;
}

async function entrar(email: string, senha: string): Promise<number> {
  const r = await http.post('/api/auth/login').send({ email, senha, canal: 'app' });
  return r.status;
}

beforeAll(async () => {
  if (!temBanco) return;

  const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = modulo.createNestApplication();
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  await app.init();
  http = request(app.getHttpServer());

  token = (
    (
      await http
        .post('/api/auth/login')
        .send({ ...ADMIN, canal: 'app' })
        .expect(200)
    ).body as { tokenAcesso: string }
  ).tokenAcesso;

  const apoio = (await autenticado('get', '/api/equipe/apoio').expect(200)).body as {
    perfis: Perfil[];
    lojas: { id: string }[];
    permissoes: { chave: string }[];
  };

  perfilVendedorId = apoio.perfis.find((p) => p.chave === 'VENDEDOR')!.id;
  perfilAdminId = apoio.perfis.find((p) => p.chave === 'ADMIN_EMPRESA')!.id;
  lojaId = apoio.lojas[0]!.id;
  permissoes = apoio.permissoes.map((p) => p.chave);
}, 60_000);

afterAll(async () => {
  if (app) {
    // Pelas acoes do dominio: usuario se DESATIVA (nao se apaga, ele aparece
    // em venda e em caixa), perfil criado aqui se exclui.
    /*
      Desativar o usuario nao solta o perfil dele: perfil EM USO nao se exclui,
      e o `delete` seguinte falhava em silencio. Dois perfis "Em uso ..." de
      teste ficaram na tela de cadastro ao lado dos de verdade. Primeiro
      devolve todo mundo ao perfil de vendedor, depois exclui.
    */
    for (const id of usuariosCriados) {
      await autenticado('put', `/api/equipe/${id}`).send({
        status: 'INATIVO',
        perfilIds: [perfilVendedorId],
      });
    }
    for (const id of perfisCriados) {
      await autenticado('delete', `/api/equipe/perfis/${id}`);
    }

    await app.close();
  }
}, 60_000);

describe.runIf(temBanco)('equipe — usuários', () => {
  it('o cadastro cria usuário, credencial e senha — e a pessoa ENTRA com ela', async () => {
    const criado = await criarUsuario();

    expect(criado.senhaProvisoria).toHaveLength(14);
    expect(criado.usuario.perfis).toHaveLength(1);
    expect(criado.usuario.lojas).toHaveLength(1);
    expect(criado.usuario.inerte).toBe(false);

    /*
      A prova de que a credencial foi criada: sem ela a senha existe e o login
      não descobre de qual empresa a pessoa é. Conferir a tabela seria fraco —
      o que importa é ENTRAR.
    */
    expect(await entrar(criado.usuario.email, criado.senhaProvisoria)).toBe(200);
  });

  it('a senha não volta em nenhuma outra resposta', async () => {
    const criado = await criarUsuario();

    const detalhe = await autenticado('get', `/api/equipe/${criado.usuario.id}`).expect(200);
    const lista = await autenticado('get', '/api/equipe').expect(200);

    const texto = JSON.stringify(detalhe.body) + JSON.stringify(lista.body);

    expect(texto).not.toContain(criado.senhaProvisoria);
    // Nem o hash: procurar a palavra "senha" derrubaria o teste por um e-mail.
    expect(texto).not.toContain('senhaHash');
    expect(texto).not.toContain('$argon2');
  });

  it('e-mail repetido é recusado, dizendo de quem é', async () => {
    const criado = await criarUsuario();

    const recusa = await autenticado('post', '/api/equipe')
      .send({
        nome: 'Outra pessoa',
        email: criado.usuario.email,
        perfilIds: [perfilVendedorId],
        lojaIds: [lojaId],
      })
      .expect(409);

    const corpo = recusa.body as { codigo: string; mensagem: string };
    expect(corpo.codigo).toBe('EMAIL_JA_CADASTRADO');
    expect(corpo.mensagem).toContain(criado.usuario.nome);
  });

  /*
    Criar alguem que entra e nao faz nada e produzir o problema de proposito.
    Na CRIACAO os dois sao obrigatorios; tirar depois e possivel, e ai a lista
    marca `inerte` e a tela avisa em faixa.
  */
  it('criar sem perfil ou sem loja é recusado', async () => {
    const s = sufixo();

    await autenticado('post', '/api/equipe')
      .send({
        nome: `Sem perfil ${s}`,
        email: `sp.${s.toLowerCase()}@lojacentro.com.br`,
        perfilIds: [],
        lojaIds: [lojaId],
      })
      .expect(400);

    await autenticado('post', '/api/equipe')
      .send({
        nome: `Sem loja ${s}`,
        email: `sl.${s.toLowerCase()}@lojacentro.com.br`,
        perfilIds: [perfilVendedorId],
        lojaIds: [],
      })
      .expect(400);
  });

  it('o perfil do portal não é oferecido nem aceito para funcionário', async () => {
    const apoio = (await autenticado('get', '/api/equipe/apoio').expect(200)).body as {
      perfis: { id: string; chave: string }[];
    };

    expect(apoio.perfis.some((p) => p.chave === 'CLIENTE_PORTAL')).toBe(false);

    // Some da lista E é recusado: esconder botão não é segurança. O id sai da
    // listagem de perfis, que continua mostrando o do portal.
    const todos = (await autenticado('get', '/api/equipe/perfis').expect(200)).body as {
      id: string;
      chave: string;
    }[];
    const portal = todos.find((p) => p.chave === 'CLIENTE_PORTAL');
    expect(portal).toBeDefined();

    const s = sufixo();
    const recusa = await autenticado('post', '/api/equipe')
      .send({
        nome: `Portal ${s}`,
        email: `pt.${s.toLowerCase()}@lojacentro.com.br`,
        perfilIds: [portal?.id],
        lojaIds: [lojaId],
      })
      .expect(400);

    expect((recusa.body as { codigo: string }).codigo).toBe('PERFIL_NAO_ATRIBUIVEL');
  });

  it('tirar todas as lojas marca INERTE — nenhuma loja não é "todas"', async () => {
    const criado = await criarUsuario();

    const depois = (
      await autenticado('put', `/api/equipe/${criado.usuario.id}`).send({ lojaIds: [] }).expect(200)
    ).body as Usuario;

    expect(depois.lojas).toHaveLength(0);
    expect(depois.inerte).toBe(true);

    const lista = (await autenticado('get', '/api/equipe?status=ATIVO').expect(200)).body as {
      contagens: { inertes: number };
    };

    expect(lista.contagens.inertes).toBeGreaterThan(0);
  });

  it('desativar impede a entrada; reativar devolve', async () => {
    const criado = await criarUsuario();
    expect(await entrar(criado.usuario.email, criado.senhaProvisoria)).toBe(200);

    await autenticado('put', `/api/equipe/${criado.usuario.id}`)
      .send({ status: 'INATIVO' })
      .expect(200);

    expect(await entrar(criado.usuario.email, criado.senhaProvisoria)).toBe(401);

    await autenticado('put', `/api/equipe/${criado.usuario.id}`)
      .send({ status: 'ATIVO' })
      .expect(200);

    expect(await entrar(criado.usuario.email, criado.senhaProvisoria)).toBe(200);
  });

  it('redefinir senha troca a senha e derruba a antiga', async () => {
    const criado = await criarUsuario();

    const nova = (await autenticado('post', `/api/equipe/${criado.usuario.id}/senha`).expect(201))
      .body as { senhaProvisoria: string };

    expect(nova.senhaProvisoria).not.toBe(criado.senhaProvisoria);
    expect(await entrar(criado.usuario.email, criado.senhaProvisoria)).toBe(401);
    expect(await entrar(criado.usuario.email, nova.senhaProvisoria)).toBe(200);
  });

  it('quem não tem usuario.visualizar não lista a equipe', async () => {
    const vendedora = (
      (
        await http
          .post('/api/auth/login')
          .send({ ...VENDEDORA, canal: 'app' })
          .expect(200)
      ).body as { tokenAcesso: string }
    ).tokenAcesso;

    await http.get('/api/equipe').set('Authorization', `Bearer ${vendedora}`).expect(403);
  });
});

describe.runIf(temBanco)('equipe — perfis', () => {
  it('perfil de sistema não se altera nem se exclui', async () => {
    const alterar = await autenticado('put', `/api/equipe/perfis/${perfilAdminId}`)
      .send({ permissoes: ['produto.visualizar'] })
      .expect(409);

    expect((alterar.body as { codigo: string }).codigo).toBe('PERFIL_DE_SISTEMA');

    const excluir = await autenticado('delete', `/api/equipe/perfis/${perfilAdminId}`).expect(409);
    expect((excluir.body as { codigo: string }).codigo).toBe('PERFIL_DE_SISTEMA');
  });

  it('duplicar um perfil de sistema dá uma cópia EDITÁVEL com as mesmas permissões', async () => {
    const nome = `Vendedor copia ${sufixo()}`;

    const copia = (
      await autenticado('post', `/api/equipe/perfis/${perfilVendedorId}/duplicar`)
        .send({ nome })
        .expect(201)
    ).body as Perfil;

    perfisCriados.push(copia.id);

    expect(copia.sistema).toBe(false);
    expect(copia.permissoes.length).toBeGreaterThan(0);

    const original = (
      (await autenticado('get', '/api/equipe/perfis').expect(200)).body as Perfil[]
    ).find((p) => p.id === perfilVendedorId);

    expect(copia.permissoes).toEqual(original!.permissoes);

    // E a cópia aceita edição, que é o ponto de duplicar.
    const ajustada = (
      await autenticado('put', `/api/equipe/perfis/${copia.id}`)
        .send({ permissoes: ['produto.visualizar', 'venda.criar'] })
        .expect(200)
    ).body as Perfil;

    expect(ajustada.permissoes).toEqual(['produto.visualizar', 'venda.criar']);
  });

  /*
    A troca e por SUBSTITUICAO. Somar sem apagar deixaria permissao revogada
    valendo — quem tira uma permissao da tela espera que ela saia.
  */
  it('alterar SUBSTITUI a lista, não soma', async () => {
    const criado = (
      await autenticado('post', '/api/equipe/perfis')
        .send({
          nome: `Só leitura ${sufixo()}`,
          permissoes: ['produto.visualizar', 'estoque.visualizar', 'venda.criar'],
        })
        .expect(201)
    ).body as Perfil;

    perfisCriados.push(criado.id);
    expect(criado.permissoes).toHaveLength(3);

    const menor = (
      await autenticado('put', `/api/equipe/perfis/${criado.id}`)
        .send({ permissoes: ['produto.visualizar'] })
        .expect(200)
    ).body as Perfil;

    expect(menor.permissoes).toEqual(['produto.visualizar']);
  });

  it('permissão que não existe no catálogo é recusada', async () => {
    const recusa = await autenticado('post', '/api/equipe/perfis')
      .send({
        nome: `Inventado ${sufixo()}`,
        permissoes: ['produto.visualizar', 'produto.teletransportar'],
      })
      .expect(409);

    const corpo = recusa.body as { codigo: string; mensagem: string };
    expect(corpo.codigo).toBe('PERMISSAO_DESCONHECIDA');
    expect(corpo.mensagem).toContain('produto.teletransportar');
  });

  it('perfil sem permissão nenhuma é recusado', async () => {
    await autenticado('post', '/api/equipe/perfis')
      .send({ nome: `Vazio ${sufixo()}`, permissoes: [] })
      .expect(400);
  });

  it('perfil em uso não se exclui — deixaria gente sem menu nenhum', async () => {
    const perfil = (
      await autenticado('post', '/api/equipe/perfis')
        .send({ nome: `Em uso ${sufixo()}`, permissoes: ['produto.visualizar'] })
        .expect(201)
    ).body as Perfil;

    perfisCriados.push(perfil.id);

    await criarUsuario({ perfilIds: [perfil.id] });

    const recusa = await autenticado('delete', `/api/equipe/perfis/${perfil.id}`).expect(409);
    const corpo = recusa.body as { codigo: string; mensagem: string };

    expect(corpo.codigo).toBe('PERFIL_EM_USO');
    expect(corpo.mensagem).toContain('1 pessoa');
  });

  it('o catálogo de permissões vem inteiro, com grupo e descrição', async () => {
    expect(permissoes.length).toBeGreaterThan(60);

    const apoio = (await autenticado('get', '/api/equipe/apoio').expect(200)).body as {
      permissoes: { chave: string; grupo: string; descricao: string }[];
    };

    const uma = apoio.permissoes.find((p) => p.chave === 'venda.devolver');
    expect(uma).toBeDefined();
    expect(uma!.grupo).toBe('venda');
    expect(uma!.descricao.length).toBeGreaterThan(3);
  });
});
