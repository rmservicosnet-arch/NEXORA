import { createHash } from 'node:crypto';

import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { comContexto, comEscopoAtual, contextoAtual, Prisma, type PrismaClient } from '@estoque/db';
import type { Request, Response } from 'express';
import { from, of, switchMap, tap, type Observable } from 'rxjs';

import { PRISMA } from '../infra/prisma/prisma.module';

/**
 * Idempotência de escrita, pelo cabeçalho `Idempotency-Key`.
 *
 * O aplicativo do balcão perde conexão no meio de uma venda e reenvia. Sem
 * isto, nascem duas vendas: dois movimentos de estoque, duas comissões, dois
 * lançamentos de caixa. É o primeiro dos seis requisitos que
 * `docs/MOBILE.md` §4 lista — e o único cuja INFRAESTRUTURA já existia sem
 * nada usá-la.
 *
 * A tabela `chave_idempotencia` está migrada desde o começo, com `corpo_hash`,
 * `resposta_status` e `resposta`. Nenhuma linha de código a lia: o schema dava
 * a impressão de resolvido. `docs/WALLET.md` e `docs/ORDERS.md` chegavam a
 * afirmar que a chave era enviada.
 *
 * ## Como funciona
 *
 * A primeira requisição RESERVA a chave — grava a linha com `resposta` vazia
 * antes de chamar o handler. Terminado, grava a resposta. Um reenvio encontra
 * a linha:
 *
 * - **com resposta** → devolve a MESMA resposta, sem executar nada;
 * - **sem resposta** → a primeira ainda está em voo. Recusa com 409 para o
 *   app tentar de novo daqui a pouco, em vez de executar em paralelo;
 * - **com corpo diferente** → é a mesma chave para outra operação. Recusa:
 *   repetir não é o mesmo que reaproveitar.
 *
 * A reserva usa o índice único `(tenant, chave, rota)`, então duas
 * requisições simultâneas não passam as duas: a segunda colide no banco e é
 * tratada como "em andamento". A corrida é resolvida pelo PostgreSQL, não
 * por ordem de chegada no Node.
 *
 * ## O que NÃO passa por aqui
 *
 * Leitura. `GET` nunca é idempotente-sensível, e gravar uma linha por consulta
 * encheria a tabela sem proteger nada.
 *
 * E requisição sem o cabeçalho segue direto. O cabeçalho é opcional de
 * propósito: o web não precisa dele — o navegador não reenvia sozinho —, e
 * exigi-lo quebraria todas as telas de uma vez.
 */

const CABECALHO = 'idempotency-key';
const METODOS_DE_ESCRITA = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Cabe um uuid e sobra. Limite do banco: `varchar(120)`. */
const TAMANHO_MAXIMO_CHAVE = 120;

@Injectable()
export class IdempotenciaInterceptor implements NestInterceptor {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  intercept(execucao: ExecutionContext, proximo: CallHandler): Observable<unknown> {
    const requisicao = execucao.switchToHttp().getRequest<Request>();

    const chave = this.chaveDa(requisicao);
    if (!chave) {
      return proximo.handle();
    }

    /*
      Sem contexto de tenant não há o que proteger: a tabela tem `tenant_id` e
      está sob RLS. Rota pública com `Idempotency-Key` simplesmente segue —
      recusar seria inventar um erro onde não há risco.
    */
    const contexto = contextoAtual();
    if (!contexto) {
      return proximo.handle();
    }

    const rota = `${requisicao.method} ${requisicao.route?.path ?? requisicao.path}`;
    const corpoHash = this.hashDo(requisicao.body);
    const resposta = execucao.switchToHttp().getResponse<Response>();

    return from(this.reservar(chave, rota, corpoHash)).pipe(
      switchMap((anterior) => {
        if (anterior) {
          // Repetição: devolve o que a primeira devolveu, com o mesmo status.
          resposta.status(anterior.status);
          return of(anterior.corpo);
        }

        /*
          REENTRA no contexto antes de chamar o handler.

          O `AsyncLocalStorage` não sobrevive à consulta que este interceptor
          faz: medido, o contexto está presente em `intercept` e em
          `reservar`, e some dentro do `switchMap` — a transação do Prisma
          quebra a cadeia de recursos assíncronos.

          Sem reentrar, o handler recebia "Nenhum contexto de tenant está
          aberto" e a rota virava 500. Quem faz I/O ANTES do handler precisa
          devolver o contexto que o `ContextoInterceptor` abriu.
        */
        return from(comContexto(contexto, async () => proximo.handle())).pipe(
          switchMap((observavel) => observavel),
          tap({
            next: (valor: unknown) => {
              void comContexto(contexto, () =>
                this.guardar(chave, rota, resposta.statusCode, valor),
              );
            },
            /*
              Falhou: solta a chave.

              Guardar a falha faria o reenvio — que é exatamente o que o app
              faz quando a conexão cai — receber o mesmo erro para sempre, sem
              nunca tentar de novo. Idempotência protege contra repetir o que
              DEU CERTO.
            */
            error: () => {
              void comContexto(contexto, () => this.soltar(chave, rota));
            },
          }),
        );
      }),
    );
  }

  private chaveDa(requisicao: Request): string | null {
    if (!METODOS_DE_ESCRITA.has(requisicao.method)) {
      return null;
    }

    const bruto = requisicao.headers[CABECALHO];
    const valor = Array.isArray(bruto) ? bruto[0] : bruto;
    const limpo = valor?.trim() ?? '';

    if (!limpo) {
      return null;
    }

    if (limpo.length > TAMANHO_MAXIMO_CHAVE) {
      throw new ConflictException({
        codigo: 'CHAVE_IDEMPOTENCIA_INVALIDA',
        mensagem: `A Idempotency-Key passa de ${String(TAMANHO_MAXIMO_CHAVE)} caracteres.`,
      });
    }

    return limpo;
  }

  /** SHA-256 do corpo. Mesma chave com corpo diferente é conflito. */
  private hashDo(corpo: unknown): string {
    const texto = corpo === undefined ? '' : JSON.stringify(corpo);
    return createHash('sha256').update(texto).digest('hex');
  }

  /**
   * Reserva a chave, ou devolve a resposta já guardada.
   *
   * `null` significa "é a primeira, pode executar".
   */
  private async reservar(
    chave: string,
    rota: string,
    corpoHash: string,
  ): Promise<{ status: number; corpo: unknown } | null> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const existente = await tx.chaveIdempotencia.findFirst({ where: { chave, rota } });

      if (existente) {
        if (existente.corpoHash !== corpoHash) {
          throw new ConflictException({
            codigo: 'CHAVE_IDEMPOTENCIA_REUSADA',
            mensagem:
              'Esta Idempotency-Key já foi usada para outra requisição. ' +
              'Repetir a mesma operação reaproveita a chave; uma operação diferente pede outra.',
          });
        }

        if (existente.respostaStatus === null) {
          throw new ConflictException({
            codigo: 'IDEMPOTENCIA_EM_ANDAMENTO',
            mensagem: 'Esta requisição ainda está sendo processada. Tente de novo em instantes.',
          });
        }

        return { status: existente.respostaStatus, corpo: existente.resposta };
      }

      try {
        await tx.chaveIdempotencia.create({
          data: {
            tenantId: exigirTenant(),
            chave,
            rota,
            corpoHash,
          },
        });
        return null;
      } catch (erro) {
        /*
          Duas requisições ao mesmo tempo com a mesma chave.

          O índice único derruba a segunda, e é o comportamento certo: quem
          perdeu a corrida espera. Engolir e executar em paralelo produziria
          as duas vendas que este interceptor existe para impedir.
        */
        if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
          throw new ConflictException({
            codigo: 'IDEMPOTENCIA_EM_ANDAMENTO',
            mensagem: 'Esta requisição ainda está sendo processada. Tente de novo em instantes.',
          });
        }
        throw erro;
      }
    });
  }

  private async guardar(
    chave: string,
    rota: string,
    status: number,
    corpo: unknown,
  ): Promise<void> {
    try {
      await comEscopoAtual(this.prisma, async (tx) => {
        await tx.chaveIdempotencia.updateMany({
          where: { chave, rota },
          data: {
            respostaStatus: status,
            resposta: (corpo ?? null) as Prisma.InputJsonValue,
          },
        });
      });
    } catch {
      /*
        Falhar aqui não pode derrubar a operação que JÁ deu certo: a venda
        está gravada. O custo é o reenvio encontrar a reserva sem resposta e
        receber "em andamento" — melhor do que desfazer uma venda concluída.
      */
    }
  }

  private async soltar(chave: string, rota: string): Promise<void> {
    try {
      await comEscopoAtual(this.prisma, async (tx) => {
        await tx.chaveIdempotencia.deleteMany({ where: { chave, rota, respostaStatus: null } });
      });
    } catch {
      // Idem: a operação já falhou, e o erro dela é o que interessa.
    }
  }
}

function exigirTenant(): string {
  const contexto = contextoAtual();
  if (!contexto) {
    throw new ConflictException({
      codigo: 'SEM_CONTEXTO_TENANT',
      mensagem: 'Sem empresa no contexto.',
    });
  }
  return contexto.tenantId;
}
