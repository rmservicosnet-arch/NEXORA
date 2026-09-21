/**
 * A PLATAFORMA — o terceiro domínio.
 *
 * `docs/TENANCY.md` §3 sempre desenhou `Plataforma → Tenant → Loja → Local`,
 * e o topo era o único nível sem entidade nenhuma. Uma empresa só nascia
 * pelo seed, que APAGA a anterior.
 *
 * O que estes testes fixam:
 *
 *  1. **O domínio separa de verdade.** Token de funcionário numa rota da
 *     plataforma dá 401, não 403 — falha na assinatura, não na permissão.
 *  2. **A empresa nasce utilizável.** O administrador criado ENTRA com a
 *     senha devolvida: é a prova de que a credencial de login existe.
 *  3. **Suspender bloqueia o login de todos**, e reativar devolve.
 *  4. **O suporte é rastreável.** A sessão nasce marcada e a entrada aparece
 *     na auditoria DA EMPRESA.
 *  5. **Criar tem volta.** Empresa vazia se exclui; com histórico, não.
 *
 * Pré-requisito: `npm run db:seed` e um administrador de plataforma
 * (`npm run plataforma:admin`).
 */

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EmpresaCriada, EmpresaDetalhe, PaginaEmpresas } from '@estoque/contracts';
import { criarPrisma, gerarHashSenha } from '@estoque/db';

import { AppModule } from '../app.module';

const temBanco = Boolean(process.env['DATABASE_URL'] && process.env['DIRECT_URL']);

/*
  O administrador de plataforma do TESTE é criado aqui, com senha conhecida
  só por este arquivo. Não se reusa o do ambiente: a senha dele não está em
  lugar nenhum de propósito, e um teste que dependesse dela não rodaria em
  máquina nenhuma além desta.
*/
const ADMIN_PLATAFORMA = {
  nome: 'Plataforma (teste)',
  email: 'plataforma.teste@estoque.local',
  senha: 'Plataforma@Teste2026',
};

const ADMIN_EMPRESA = { email: 'rodrigo@lojacentro.com.br', senha: 'Estoque@2026' };

let app: INestApplication;
let http: ReturnType<typeof request>;
let token: string;

/** Empresas criadas aqui. Saem EXCLUÍDAS no fim — todas nascem vazias. */
const empresasCriadas: string[] = [];

function sufixo(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function comToken(metodo: 'get' | 'post' | 'put' | 'delete', caminho: string) {
  return http[metodo](caminho).set('Authorization', `Bearer ${token}`);
}

async function novaEmpresa(extra: Record<string, unknown> = {}): Promise<EmpresaCriada> {
  const s = sufixo();
  const corpo = {
    nome: `Empresa ${s}`,
    slug: `empresa-${s.toLowerCase()}`,
    admin: { nome: `Admin ${s}`, email: `admin.${s.toLowerCase()}@empresa-teste.local` },
    ...extra,
  };

  const criada = (await comToken('post', '/api/plataforma/empresas').send(corpo).expect(201))
    .body as EmpresaCriada;

  empresasCriadas.push(criada.empresa.id);
  return criada;
}

beforeAll(async () => {
  if (!temBanco) {
    return;
  }

  // O administrador de plataforma não passa por `credencial_login` e não
  // tem empresa: nada de escopo de tenant aqui.
  const prisma = await criarPrisma({
    url: process.env['DIRECT_URL'] ?? '',
    permitirPapelPrivilegiado: true,
  });
  try {
    const senhaHash = await gerarHashSenha(ADMIN_PLATAFORMA.senha);
    await prisma.plataformaAdmin.upsert({
      where: { email: ADMIN_PLATAFORMA.email },
      create: { nome: ADMIN_PLATAFORMA.nome, email: ADMIN_PLATAFORMA.email, senhaHash },
      update: { senhaHash, status: 'ATIVO' },
    });
  } finally {
    await prisma.$disconnect();
  }

  const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = modulo.createNestApplication();
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  await app.init();
  http = request(app.getHttpServer());

  const entrada = await http
    .post('/api/plataforma/login')
    .send({ email: ADMIN_PLATAFORMA.email, senha: ADMIN_PLATAFORMA.senha })
    .expect(200);

  token = (entrada.body as { tokenAcesso: string }).tokenAcesso;
}, 60_000);

afterAll(async () => {
  if (app) {
    /*
      Todas nascem vazias, então todas se excluem — pela rota do domínio,
      nunca por `delete` escondido. Se alguma tiver ganhado histórico no
      meio do teste, a recusa é o comportamento certo e o 409 aparece aqui.
    */
    for (const id of empresasCriadas) {
      await comToken('delete', `/api/plataforma/empresas/${id}`);
    }
    await app.close();
  }
}, 60_000);

describe.runIf(temBanco)('plataforma — o domínio', () => {
  it('token de funcionário numa rota de plataforma dá 401, não 403', async () => {
    const entrada = await http
      .post('/api/auth/login')
      .send({ email: ADMIN_EMPRESA.email, senha: ADMIN_EMPRESA.senha, canal: 'app' })
      // Conferir o login é o que faz o 401 abaixo provar alguma coisa. Sem
      // isto, um token `undefined` também dá 401 — e o teste passaria com o
      // caminho inteiro quebrado.
      .expect(200);

    const daEmpresa = (entrada.body as { tokenAcesso: string }).tokenAcesso;
    expect(daEmpresa).toBeTruthy();

    // Falha na ASSINATURA: o segredo é outro. 403 diria "você existe aqui,
    // mas não pode" — e ele nem existe aqui.
    await http
      .get('/api/plataforma/empresas')
      .set('Authorization', `Bearer ${daEmpresa}`)
      .expect(401);
  });

  it('token de plataforma não alcança rota de empresa', async () => {
    await http.get('/api/equipe').set('Authorization', `Bearer ${token}`).expect(401);
  });

  it('senha errada é recusada sem dizer o que estava errado', async () => {
    const recusa = await http
      .post('/api/plataforma/login')
      .send({ email: ADMIN_PLATAFORMA.email, senha: 'errada-de-proposito' })
      .expect(401);

    expect((recusa.body as { codigo: string }).codigo).toBe('CREDENCIAIS_INVALIDAS');
  });

  it('e-mail que não existe devolve a MESMA resposta da senha errada', async () => {
    const recusa = await http
      .post('/api/plataforma/login')
      .send({ email: 'ninguem@lugar-nenhum.local', senha: 'qualquer-coisa' })
      .expect(401);

    expect((recusa.body as { codigo: string }).codigo).toBe('CREDENCIAIS_INVALIDAS');
  });
});

describe.runIf(temBanco)('plataforma — criar empresa', () => {
  it('a empresa nasce com admin que ENTRA, e a senha vem uma vez', async () => {
    const criada = await novaEmpresa();

    expect(criada.senhaProvisoria.length).toBeGreaterThanOrEqual(12);
    expect(criada.empresa.usuarios).toBe(1);

    // A prova de que a credencial de login existe: sem ela a senha está
    // certa e não autentica ninguém.
    const entrada = await http
      .post('/api/auth/login')
      .send({ email: criada.admin.email, senha: criada.senhaProvisoria, canal: 'app' })
      .expect(200);

    const usuario = (entrada.body as { usuario: { permissoes: string[] } }).usuario;
    expect(usuario.permissoes).toContain('loja.criar');
  });

  it('nasce SEM loja, e o administrador nasce podendo criar a primeira', async () => {
    const criada = await novaEmpresa();
    expect(criada.empresa.lojas).toBe(0);

    const entrada = await http
      .post('/api/auth/login')
      .send({ email: criada.admin.email, senha: criada.senhaProvisoria, canal: 'app' })
      .expect(200);

    /*
      `loja.criar` é permissão de EMPRESA, não de loja. Se fosse de loja, a
      empresa nova ficaria num impasse: precisaria de uma loja para criar a
      primeira loja.

      O teste confere a PERMISSÃO em vez de criar a loja de verdade. Criar
      deixava a empresa com histórico, e aí ela não se excluía mais — eu a
      tirava da limpeza e ela ficava na lista da plataforma, suspensa, para
      sempre. Teste que cria dado visível e não limpa, de novo.
    */
    const usuario = (entrada.body as { usuario: { permissoes: string[]; lojaIds: string[] } })
      .usuario;

    expect(usuario.permissoes).toContain('loja.criar');
    expect(usuario.lojaIds).toHaveLength(0);
  });

  it('empresa COM histórico não se exclui — a resposta manda suspender', async () => {
    /*
      Usa a empresa do seed, que tem loja, produto e venda. Não cria nada:
      provar a recusa criando uma empresa com histórico seria produzir
      justamente o resíduo que não se apaga depois.
    */
    const pagina = (await comToken('get', '/api/plataforma/empresas').expect(200))
      .body as PaginaEmpresas;

    const comHistorico = pagina.itens.find((e) => e.lojas > 0);
    expect(comHistorico).toBeDefined();

    const recusa = await comToken(
      'delete',
      `/api/plataforma/empresas/${String(comHistorico?.id)}`,
    ).expect(409);

    const corpo = recusa.body as { codigo: string; mensagem: string };
    expect(corpo.codigo).toBe('EMPRESA_NAO_ESTA_VAZIA');
    expect(corpo.mensagem).toContain('Suspenda');
  });

  it('a empresa nasce com os 8 perfis de sistema e a configuração', async () => {
    const criada = await novaEmpresa();

    const entrada = await http
      .post('/api/auth/login')
      .send({ email: criada.admin.email, senha: criada.senhaProvisoria, canal: 'app' })
      .expect(200);
    const daEmpresa = (entrada.body as { tokenAcesso: string }).tokenAcesso;

    const perfis = (
      await http.get('/api/equipe/perfis').set('Authorization', `Bearer ${daEmpresa}`).expect(200)
    ).body as { chave: string; sistema: boolean }[];

    expect(perfis.length).toBeGreaterThanOrEqual(8);
    expect(perfis.every((p) => p.sistema)).toBe(true);
    expect(perfis.map((p) => p.chave)).toContain('ADMIN_EMPRESA');

    // A linha de configuração precisa existir: ela tem default em toda
    // coluna, mas a AUSÊNCIA dela mata a tela.
    await http.get('/api/configuracao').set('Authorization', `Bearer ${daEmpresa}`).expect(200);
  });

  it('slug repetido é recusado — ele é único na plataforma e não muda', async () => {
    const criada = await novaEmpresa();

    const recusa = await comToken('post', '/api/plataforma/empresas')
      .send({
        nome: 'Outra qualquer',
        slug: criada.empresa.slug,
        admin: { nome: 'Outro', email: `outro.${sufixo().toLowerCase()}@empresa-teste.local` },
      })
      .expect(409);

    expect((recusa.body as { codigo: string }).codigo).toBe('SLUG_EM_USO');
  });

  it('e-mail já usado em OUTRA empresa é recusado — o diretório é global', async () => {
    const recusa = await comToken('post', '/api/plataforma/empresas')
      .send({
        nome: `Empresa ${sufixo()}`,
        slug: `empresa-${sufixo().toLowerCase()}`,
        admin: { nome: 'Colidente', email: ADMIN_EMPRESA.email },
      })
      .expect(409);

    expect((recusa.body as { codigo: string }).codigo).toBe('EMAIL_JA_CADASTRADO');
  });

  it('slug com espaço ou maiúscula é recusado antes de tocar no banco', async () => {
    await comToken('post', '/api/plataforma/empresas')
      .send({
        nome: 'Nome Válido',
        slug: 'Slug Com Espaço',
        admin: { nome: 'Alguém', email: `x.${sufixo().toLowerCase()}@empresa-teste.local` },
      })
      .expect(400);
  });
});

describe.runIf(temBanco)('plataforma — situação da empresa', () => {
  it('suspender bloqueia o login de todos; reativar devolve', async () => {
    const criada = await novaEmpresa();
    const credenciais = {
      email: criada.admin.email,
      senha: criada.senhaProvisoria,
      canal: 'app' as const,
    };

    await http.post('/api/auth/login').send(credenciais).expect(200);

    await comToken('put', `/api/plataforma/empresas/${criada.empresa.id}/suspender`)
      .send({ motivo: 'mensalidade em atraso há 45 dias' })
      .expect(200);

    // O bloqueio acontece em `credencial_login.ativo`: desativar só o
    // `tenant.status` não impediria ninguém, porque nada no caminho de
    // autenticação consulta aquele campo.
    await http.post('/api/auth/login').send(credenciais).expect(401);

    await comToken('put', `/api/plataforma/empresas/${criada.empresa.id}/reativar`)
      .send({ motivo: 'pagamento regularizado' })
      .expect(200);

    await http.post('/api/auth/login').send(credenciais).expect(200);
  });

  it('suspender sem motivo é recusado', async () => {
    const criada = await novaEmpresa();

    await comToken('put', `/api/plataforma/empresas/${criada.empresa.id}/suspender`)
      .send({ motivo: '' })
      .expect(400);
  });

  it('suspender duas vezes é recusado, em vez de fingir que fez', async () => {
    const criada = await novaEmpresa();

    await comToken('put', `/api/plataforma/empresas/${criada.empresa.id}/suspender`)
      .send({ motivo: 'primeira suspensão' })
      .expect(200);

    const recusa = await comToken('put', `/api/plataforma/empresas/${criada.empresa.id}/suspender`)
      .send({ motivo: 'segunda, que não faz sentido' })
      .expect(409);

    expect((recusa.body as { codigo: string }).codigo).toBe('SITUACAO_INALTERADA');

    await comToken('put', `/api/plataforma/empresas/${criada.empresa.id}/reativar`)
      .send({ motivo: 'devolvendo para a limpeza' })
      .expect(200);
  });
});

describe.runIf(temBanco)('plataforma — socorro e suporte', () => {
  it('redefinir a senha do admin invalida a antiga e derruba as sessões', async () => {
    const criada = await novaEmpresa();

    const detalhe = (
      await comToken('get', `/api/plataforma/empresas/${criada.empresa.id}`).expect(200)
    ).body as EmpresaDetalhe;

    expect(detalhe.administradores).toHaveLength(1);

    await http
      .post('/api/auth/login')
      .send({ email: criada.admin.email, senha: criada.senhaProvisoria, canal: 'app' })
      .expect(200);

    const nova = (
      await comToken('post', `/api/plataforma/empresas/${criada.empresa.id}/senha-admin`)
        .send({
          usuarioId: detalhe.administradores[0]?.id,
          motivo: 'cliente perdeu o acesso e não há outro administrador',
        })
        .expect(200)
    ).body as { senhaProvisoria: string; sessoesRevogadas: number };

    expect(nova.sessoesRevogadas).toBeGreaterThan(0);

    await http
      .post('/api/auth/login')
      .send({ email: criada.admin.email, senha: criada.senhaProvisoria, canal: 'app' })
      .expect(401);

    await http
      .post('/api/auth/login')
      .send({ email: criada.admin.email, senha: nova.senhaProvisoria, canal: 'app' })
      .expect(200);
  });

  it('a sessão de suporte funciona na empresa e nasce MARCADA', async () => {
    const criada = await novaEmpresa();

    const sessao = (
      await comToken('post', `/api/plataforma/empresas/${criada.empresa.id}/suporte`)
        .send({ motivo: 'cliente relatou saldo negativo no Balcão depois da venda 1284' })
        .expect(200)
    ).body as { tokenAcesso: string; comoUsuario: { id: string } };

    const eu = (
      await http
        .get('/api/auth/eu')
        .set('Authorization', `Bearer ${sessao.tokenAcesso}`)
        .expect(200)
    ).body as { id: string; suporteDe?: string };

    // O token é de FUNCIONÁRIO daquela empresa — é assim que todo guard e
    // todo o RLS seguem valendo. A marca é o que impede um acesso de fora
    // que ninguém vê na tela.
    expect(eu.id).toBe(sessao.comoUsuario.id);
    expect(eu.suporteDe).toBeDefined();
  });

  it('a entrada de suporte aparece na auditoria DA EMPRESA, com o motivo', async () => {
    const criada = await novaEmpresa();
    const motivo = `investigando divergência de estoque ${sufixo()}`;

    await comToken('post', `/api/plataforma/empresas/${criada.empresa.id}/suporte`)
      .send({ motivo })
      .expect(200);

    const detalhe = (
      await comToken('get', `/api/plataforma/empresas/${criada.empresa.id}`).expect(200)
    ).body as EmpresaDetalhe;

    const entrada = detalhe.auditoria.find((r) => r.acao === 'PLATAFORMA_ENTROU');
    expect(entrada).toBeDefined();
    expect(entrada?.motivo).toBe(motivo);
    expect(entrada?.atorNome).toBe(ADMIN_PLATAFORMA.nome);
  });

  it('motivo genérico demais é recusado — "investigar" não é motivo', async () => {
    const criada = await novaEmpresa();

    await comToken('post', `/api/plataforma/empresas/${criada.empresa.id}/suporte`)
      .send({ motivo: 'investigar' })
      .expect(400);
  });

  it('empresa suspensa não recebe suporte', async () => {
    const criada = await novaEmpresa();

    await comToken('put', `/api/plataforma/empresas/${criada.empresa.id}/suspender`)
      .send({ motivo: 'suspensa para o teste' })
      .expect(200);

    const recusa = await comToken('post', `/api/plataforma/empresas/${criada.empresa.id}/suporte`)
      .send({ motivo: 'tentando entrar numa empresa que está bloqueada' })
      .expect(409);

    expect((recusa.body as { codigo: string }).codigo).toBe('EMPRESA_SUSPENSA');

    await comToken('put', `/api/plataforma/empresas/${criada.empresa.id}/reativar`)
      .send({ motivo: 'devolvendo para a limpeza' })
      .expect(200);
  });
});

describe.runIf(temBanco)('plataforma — a lista', () => {
  it('cruza empresas, e os indicadores contam o mesmo conjunto que a lista', async () => {
    await novaEmpresa();

    const pagina = (await comToken('get', '/api/plataforma/empresas').expect(200))
      .body as PaginaEmpresas;

    // A lista não é uma página: é o conjunto. Um resumo contado sobre a
    // página daria um total que não corresponde às linhas ao lado.
    expect(pagina.itens.length).toBe(pagina.resumo.empresas);
    expect(pagina.resumo.ativas + pagina.resumo.suspensas).toBe(pagina.resumo.empresas);

    const ativas = pagina.itens.filter((e) => e.status === 'ATIVO');
    expect(ativas.length).toBe(pagina.resumo.ativas);

    // `usuariosAtivos` conta só as ativas, e o rótulo da tela diz isso.
    const soma = ativas.reduce((t, e) => t + e.usuarios, 0);
    expect(soma).toBe(pagina.resumo.usuariosAtivos);
  });

  it('empresa que não existe dá 404', async () => {
    await comToken('get', '/api/plataforma/empresas/0199ffff-ffff-7fff-bfff-ffffffffffff').expect(
      404,
    );
  });
});
