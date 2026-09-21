/**
 * Os pré-requisitos que `docs/MOBILE.md` §4 exige da API.
 *
 * O documento lista seis coisas que precisam existir ANTES do aplicativo,
 * "senão viram retrabalho". Uma auditoria encontrou três delas ausentes ou
 * quebradas, e duas eram das piores:
 *
 *  1. **Idempotência.** A tabela `chave_idempotencia` estava migrada desde o
 *     início e nenhuma linha de código a lia. `docs/WALLET.md` e
 *     `docs/ORDERS.md` afirmavam que a chave era enviada. O schema dava a
 *     impressão de resolvido — e o balcão que perde conexão gravava a venda
 *     duas vezes.
 *  3. **Sair no canal `app`.** O `logout` só lia o cookie: no celular ele
 *     devolvia 204 sem revogar nada, e o refresh seguia válido os 30 dias.
 *  4. **Erro com código.** Sem filtro global, o 429 do limite de tentativas
 *     — o primeiro erro que o aplicativo encontra — saía sem `codigo`.
 *
 * Estes testes existem para que as três não voltem.
 */

import type { ArgumentsHost, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerException } from '@nestjs/throttler';
import { ValorImprecisoError } from '@estoque/core';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../app.module';
import { ErroFiltro } from './erro.filtro';

const temBanco = Boolean(process.env['DATABASE_URL'] && process.env['DIRECT_URL']);
const ADMIN = { email: 'rodrigo@lojacentro.com.br', senha: 'Estoque@2026' };

let app: INestApplication;
let http: ReturnType<typeof request>;
let token: string;

/** Categorias criadas aqui. Saem excluídas — nenhuma ganha produto. */
const criadas: string[] = [];

function sufixo(): string {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

function comToken(metodo: 'get' | 'post' | 'delete', caminho: string) {
  return http[metodo](caminho).set('Authorization', `Bearer ${token}`);
}

beforeAll(async () => {
  if (!temBanco) {
    return;
  }

  const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = modulo.createNestApplication();
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  /*
    O filtro é registrado por `APP_FILTER` no módulo, mas o `createNestApplication`
    do teste não o aplica a rotas não encontradas sem isto. Registrar aqui
    reproduz o que o `main.ts` monta em produção.
  */
  app.useGlobalFilters(new ErroFiltro());
  await app.init();
  http = request(app.getHttpServer());

  const entrada = await http
    .post('/api/auth/login')
    .send({ ...ADMIN, canal: 'app' })
    .expect(200);

  token = (entrada.body as { tokenAcesso: string }).tokenAcesso;
}, 60_000);

afterAll(async () => {
  if (app) {
    for (const id of criadas) {
      await comToken('delete', `/api/produtos/categorias/${id}`);
    }
    await app.close();
  }
}, 60_000);

describe.runIf(temBanco)('idempotência das escritas', () => {
  it('a mesma chave devolve a MESMA resposta, sem executar de novo', async () => {
    const chave = `teste-${sufixo()}`;
    const nome = `Categoria ${sufixo()}`;

    const primeira = await comToken('post', '/api/produtos/categorias')
      .set('Idempotency-Key', chave)
      .send({ nome })
      .expect(201);

    const criada = primeira.body as { id: string; nome: string };
    criadas.push(criada.id);

    // O reenvio do balcão: mesma chave, mesmo corpo.
    const repetida = await comToken('post', '/api/produtos/categorias')
      .set('Idempotency-Key', chave)
      .send({ nome })
      .expect(201);

    expect((repetida.body as { id: string }).id).toBe(criada.id);

    /*
      A prova de que NÃO executou de novo: sem a idempotência, o segundo
      `POST` daria 409 de nome repetido — e daria 201 na primeira vez que o
      nome fosse diferente, criando duas.
    */
    const apoio = (await comToken('get', '/api/produtos/apoio').expect(200)).body as {
      categorias: { id: string; nome: string }[];
    };
    expect(apoio.categorias.filter((c) => c.nome === nome)).toHaveLength(1);
  });

  it('SEM a chave, o reenvio executa de novo — é o defeito que ela evita', async () => {
    const nome = `Categoria ${sufixo()}`;

    const primeira = await comToken('post', '/api/produtos/categorias').send({ nome }).expect(201);
    criadas.push((primeira.body as { id: string }).id);

    // Sem `Idempotency-Key` o servidor não tem como saber que é repetição.
    // Aqui a colisão de nome protege; numa venda, não haveria nada.
    await comToken('post', '/api/produtos/categorias').send({ nome }).expect(409);
  });

  it('mesma chave com corpo DIFERENTE é recusada', async () => {
    const chave = `teste-${sufixo()}`;

    const primeira = await comToken('post', '/api/produtos/categorias')
      .set('Idempotency-Key', chave)
      .send({ nome: `Categoria ${sufixo()}` })
      .expect(201);
    criadas.push((primeira.body as { id: string }).id);

    const recusa = await comToken('post', '/api/produtos/categorias')
      .set('Idempotency-Key', chave)
      .send({ nome: `Outra coisa ${sufixo()}` })
      .expect(409);

    expect((recusa.body as { codigo: string }).codigo).toBe('CHAVE_IDEMPOTENCIA_REUSADA');
  });

  it('a chave NÃO guarda o fracasso: depois de falhar, dá para tentar de novo', async () => {
    const chave = `teste-${sufixo()}`;

    // Nome curto demais: o schema recusa.
    await comToken('post', '/api/produtos/categorias')
      .set('Idempotency-Key', chave)
      .send({ nome: 'x' })
      .expect(400);

    /*
      Guardar a falha faria o reenvio receber o mesmo erro para sempre — e
      reenviar é justamente o que o app faz quando a conexão cai. A reserva é
      solta quando o handler lança.

      O corpo muda junto (nome válido agora), então isto também prova que a
      chave foi mesmo liberada: se a linha tivesse ficado, a resposta seria
      CHAVE_IDEMPOTENCIA_REUSADA.
    */
    const depois = await comToken('post', '/api/produtos/categorias')
      .set('Idempotency-Key', chave)
      .send({ nome: `Categoria ${sufixo()}` })
      .expect(201);

    criadas.push((depois.body as { id: string }).id);
  });

  it('GET não entra no mecanismo, mesmo com o cabeçalho', async () => {
    const chave = `teste-${sufixo()}`;

    // Duas leituras com a mesma chave têm de funcionar as duas.
    await comToken('get', '/api/produtos/apoio').set('Idempotency-Key', chave).expect(200);
    await comToken('get', '/api/produtos/apoio').set('Idempotency-Key', chave).expect(200);
  });
});

describe.runIf(temBanco)('sair no canal app', () => {
  it('revoga de verdade — o refresh para de funcionar', async () => {
    const entrada = await http
      .post('/api/auth/login')
      .send({ ...ADMIN, canal: 'app' })
      .expect(200);

    const daSessao = (entrada.body as { tokenRefresh: string }).tokenRefresh;

    // Antes de sair, renovar funciona.
    const renovada = await http
      .post('/api/auth/refresh')
      .send({ canal: 'app', refreshToken: daSessao })
      .expect(200);

    const rotacionado = (renovada.body as { tokenRefresh: string }).tokenRefresh;

    await http
      .post('/api/auth/logout')
      .send({ canal: 'app', refreshToken: rotacionado })
      .expect(204);

    /*
      Antes desta correção, o logout só lia o cookie: no celular devolvia 204
      sem revogar nada, e este refresh continuaria valendo os 30 dias. Perder
      o aparelho era perder a sessão junto com ele.
    */
    await http
      .post('/api/auth/refresh')
      .send({ canal: 'app', refreshToken: rotacionado })
      .expect(401);
  });

  it('sair sem token não quebra — o web manda o cookie, e ele pode não existir', async () => {
    await http.post('/api/auth/logout').send({ canal: 'web' }).expect(204);
  });
});

describe.runIf(temBanco)('todo erro sai com código', () => {
  it('rota que não existe devolve código, não o formato cru do NestJS', async () => {
    const resposta = await comToken('get', '/api/rota-que-nao-existe').expect(404);
    const corpo = resposta.body as { codigo?: string; mensagem?: string };

    expect(corpo.codigo).toBe('NAO_ENCONTRADO');
    expect(corpo.mensagem).toBeTruthy();
  });

  it('o limite de tentativas vira MUITAS_TENTATIVAS', () => {
    /*
      Pela ROTA este caso não roda: o throttler é desligado sob teste de
      propósito — foi ele que derrubou a primeira execução da suíte de
      autenticação, que faz mais de dez logins em segundos.

      Então o teste exercita a TRADUÇÃO, que é o que este filtro acrescenta.
      Minha primeira versão martelava o login doze vezes esperando 429 e
      recebia 401: exigia do ambiente algo que ele não produz, e teria sido
      um teste que nunca passa por um motivo que nada tem a ver com o código.
    */
    let status = 0;
    let corpo: { codigo?: string; mensagem?: string } = {};

    const resposta = {
      status(valor: number) {
        status = valor;
        return this;
      },
      json(valor: unknown) {
        corpo = valor as { codigo?: string };
      },
    };

    const host = {
      switchToHttp: () => ({
        getResponse: () => resposta,
        getRequest: () => ({ method: 'POST', originalUrl: '/api/auth/login' }),
      }),
    } as unknown as ArgumentsHost;

    new ErroFiltro().catch(new ThrottlerException(), host);

    expect(status).toBe(429);
    expect(corpo.codigo).toBe('MUITAS_TENTATIVAS');
    expect(corpo.mensagem).toContain('Espere');
  });

  it('erro do domínio não vira 500: o código que ele carrega chega à tela', () => {
    /*
      `ErroDominio` de `@estoque/core` não é `HttpException`. Sem o filtro,
      `VALOR_IMPRECISO` virava 500 genérico e o código se perdia — e ele é
      contrato, legível por máquina. Só dois lugares o traduziam à mão.
    */
    let status = 0;
    let corpo: { codigo?: string } = {};

    const resposta = {
      status(valor: number) {
        status = valor;
        return this;
      },
      json(valor: unknown) {
        corpo = valor as { codigo?: string };
      },
    };

    const host = {
      switchToHttp: () => ({
        getResponse: () => resposta,
        getRequest: () => ({ method: 'POST', originalUrl: '/api/vendas' }),
      }),
    } as unknown as ArgumentsHost;

    new ErroFiltro().catch(new ValorImprecisoError(0.1), host);

    expect(status).toBe(400);
    expect(corpo.codigo).toBe('VALOR_IMPRECISO');
  });

  it('erro de validação continua trazendo os campos', async () => {
    const resposta = await comToken('post', '/api/produtos/categorias').send({ nome: '' });

    const corpo = resposta.body as {
      codigo: string;
      campos?: { campo: string; problema: string }[];
    };

    expect(resposta.status).toBe(400);
    expect(corpo.codigo).toBe('ENTRADA_INVALIDA');
    expect(corpo.campos?.length).toBeGreaterThan(0);
  });
});
