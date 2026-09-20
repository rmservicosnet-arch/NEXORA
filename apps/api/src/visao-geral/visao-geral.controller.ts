import { Controller, Get, Query } from '@nestjs/common';
import {
  filtroVisaoGeralSchema,
  PERM,
  type FiltroVisaoGeral,
  type VisaoGeral,
} from '@estoque/contracts';

import { Permissoes } from '../comum/decoradores';
import { ZodPipe } from '../comum/zod.pipe';
import { VisaoGeralService } from './visao-geral.service';

/**
 * A tela inicial da equipe.
 *
 * `relatorio.visualizar` e não uma permissão nova: são números agregados da
 * operação, o mesmo grau do resto dos relatórios. Custo não aparece aqui —
 * o que se mostra é faturamento, contagem e divergência.
 */
@Controller('visao-geral')
export class VisaoGeralController {
  constructor(private readonly visaoGeral: VisaoGeralService) {}

  @Get()
  @Permissoes(PERM.relatorio.visualizar)
  async resumo(
    @Query(new ZodPipe(filtroVisaoGeralSchema)) filtro: FiltroVisaoGeral,
  ): Promise<VisaoGeral> {
    return this.visaoGeral.resumo(filtro);
  }
}
