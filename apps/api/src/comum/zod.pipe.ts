import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * Validação de entrada com Zod.
 *
 * O erro devolvido tem código estável e a lista de campos com problema —
 * requisito de docs/MOBILE.md §4: o aplicativo decide o que fazer pelo
 * código, não pela mensagem em português.
 */
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly esquema: ZodType<T>) {}

  transform(valor: unknown): T {
    const resultado = this.esquema.safeParse(valor);

    if (!resultado.success) {
      throw new BadRequestException({
        codigo: 'ENTRADA_INVALIDA',
        mensagem: 'Os dados enviados não são válidos.',
        campos: resultado.error.issues.map((i) => ({
          campo: i.path.join('.') || '(raiz)',
          problema: i.message,
        })),
      });
    }

    return resultado.data;
  }
}
