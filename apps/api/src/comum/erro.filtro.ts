import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { ErroDominio } from '@estoque/core';
import type { Request, Response } from 'express';

/**
 * Todo erro sai no mesmo formato: `{ codigo, mensagem }`.
 *
 * `docs/MOBILE.md` §4.4 exige código estável e legível por máquina — o app
 * decide o que fazer pelo código, não pela frase em português. A convenção
 * era seguida com disciplina em todo `throw` escrito à mão, e **sem nenhum
 * mecanismo que a garantisse**. O que não passava por um `throw` nosso saía
 * no formato do NestJS, sem `codigo`:
 *
 * - **429 do limite de tentativas** — justamente o caso em que o app precisa
 *   decidir "espere e tente de novo". Saía como `ThrottlerException: Too Many
 *   Requests`.
 * - **404 de rota que não existe** — o app instalado pede uma rota que o
 *   servidor já removeu.
 * - **`ErroDominio` de `@estoque/core`** — `VALOR_IMPRECISO`,
 *   `QUANTIDADE_INVALIDA`, `CUSTO_INVALIDO`. Não são `HttpException`: viravam
 *   500 genérico, e o código que o erro CARREGA se perdia no caminho. Dois
 *   lugares o traduziam à mão; todo o resto não.
 * - **Erro cru do Prisma** — violação de índice, deadlock, recusa do RLS.
 *
 * O filtro não inventa código onde não há: traduz o que existe e, no resto,
 * usa um código derivado do status. O que ele nunca faz é deixar a mensagem
 * técnica vazar — `correlacaoId` no log liga a resposta genérica ao que
 * realmente aconteceu.
 */

interface CorpoErro {
  readonly codigo: string;
  readonly mensagem: string;
  readonly campos?: readonly { campo: string; problema: string }[];
  readonly permissoesFaltantes?: readonly string[];
}

/** Código derivado do status, para o que não traz um. */
const POR_STATUS: Record<number, string> = {
  400: 'ENTRADA_INVALIDA',
  401: 'NAO_AUTENTICADO',
  403: 'SEM_PERMISSAO',
  404: 'NAO_ENCONTRADO',
  409: 'CONFLITO',
  413: 'CORPO_GRANDE_DEMAIS',
  415: 'TIPO_NAO_SUPORTADO',
  422: 'ENTRADA_INVALIDA',
  429: 'MUITAS_TENTATIVAS',
};

@Catch()
export class ErroFiltro implements ExceptionFilter {
  private readonly logger = new Logger(ErroFiltro.name);

  catch(excecao: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const resposta = http.getResponse<Response>();
    const requisicao = http.getRequest<Request>();

    const { status, corpo, paraOLog } = this.traduzir(excecao);

    if (status >= 500) {
      this.logger.error(
        `${requisicao.method} ${requisicao.originalUrl} → ${String(status)} ${corpo.codigo}: ${paraOLog}`,
        excecao instanceof Error ? excecao.stack : undefined,
      );
    }

    resposta.status(status).json(corpo);
  }

  private traduzir(excecao: unknown): {
    status: number;
    corpo: CorpoErro;
    paraOLog: string;
  } {
    /*
      O limite de tentativas vem primeiro porque é o mais específico: sem ele
      cairia no ramo de `HttpException` e viraria "MUITAS_TENTATIVAS" só por
      causa do status — o que dá certo por acaso. Explícito é melhor.
    */
    if (excecao instanceof ThrottlerException) {
      return {
        status: HttpStatus.TOO_MANY_REQUESTS,
        corpo: {
          codigo: 'MUITAS_TENTATIVAS',
          mensagem: 'Tentativas demais em pouco tempo. Espere um instante e tente de novo.',
        },
        paraOLog: 'throttler',
      };
    }

    if (excecao instanceof HttpException) {
      const status = excecao.getStatus();
      const resposta = excecao.getResponse();

      // Os `throw` escritos à mão já vêm no formato certo.
      if (typeof resposta === 'object' && resposta !== null && 'codigo' in resposta) {
        const pronto = resposta as CorpoErro;
        return {
          status,
          corpo: {
            ...pronto,
            // Mensagem vazia chega à tela como um aviso em branco. Já
            // aconteceu em dois lugares.
            mensagem: pronto.mensagem || this.mensagemPadrao(status),
          },
          paraOLog: pronto.codigo,
        };
      }

      // O formato do NestJS: `{ statusCode, message, error }`.
      const mensagem =
        typeof resposta === 'string'
          ? resposta
          : ((resposta as { message?: string | string[] }).message ?? '');

      return {
        status,
        corpo: {
          codigo: POR_STATUS[status] ?? 'ERRO',
          mensagem:
            (Array.isArray(mensagem) ? mensagem.join('; ') : mensagem) ||
            this.mensagemPadrao(status),
        },
        paraOLog: Array.isArray(mensagem) ? mensagem.join('; ') : String(mensagem),
      };
    }

    /*
      `ErroDominio` carrega `codigo` estável desde `@estoque/core` — é
      contrato, e era exatamente isso que se perdia ao virar 500. As regras de
      dinheiro e quantidade que ele protege são as que o app mais precisa
      distinguir: `VALOR_IMPRECISO` não é falha de servidor, é entrada errada.
    */
    if (excecao instanceof ErroDominio) {
      return {
        status: HttpStatus.BAD_REQUEST,
        corpo: { codigo: excecao.codigo, mensagem: excecao.message },
        paraOLog: excecao.codigo,
      };
    }

    // Qualquer outra coisa — inclusive erro cru do Prisma. A mensagem técnica
    // NÃO vai para o cliente: ela nomeia tabela e coluna.
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      corpo: {
        codigo: 'ERRO_INTERNO',
        mensagem: 'Algo deu errado do nosso lado. Tente de novo em instantes.',
      },
      paraOLog: excecao instanceof Error ? excecao.message : String(excecao),
    };
  }

  private mensagemPadrao(status: number): string {
    const padroes: Record<number, string> = {
      400: 'Os dados enviados não são válidos.',
      401: 'Autenticação obrigatória.',
      403: 'Você não tem permissão para isto.',
      404: 'Não encontrado.',
      409: 'A operação conflita com o estado atual.',
      429: 'Tentativas demais em pouco tempo.',
    };
    return padroes[status] ?? 'Não foi possível concluir.';
  }
}
