import { Controller, Get, Query } from '@nestjs/common';
import {
  filtroAbertosSchema,
  filtroAjustesSchema,
  filtroLimiteSchema,
  PERM,
  type FiltroAbertos,
  type FiltroAjustes,
  type FiltroLimite,
  type RelatorioAbertos,
  type RelatorioAjustes,
  type RelatorioLimite,
} from '@estoque/contracts';

import { Permissoes } from '../comum/decoradores';
import { ZodPipe } from '../comum/zod.pipe';
import { RelatoriosCarteiraService } from './carteira.service';

/**
 * Os relatórios da conta corrente do cliente.
 *
 * Exigem `relatorio.visualizar` E `carteira.visualizar`: dívida de cliente
 * não é dado de relatório comum, e quem pode ver o faturamento não passa a
 * poder ver quanto cada pessoa deve.
 */
@Controller('relatorios/carteira')
export class RelatoriosCarteiraController {
  constructor(private readonly carteira: RelatoriosCarteiraService) {}

  @Get('abertos')
  @Permissoes(PERM.relatorio.visualizar, PERM.carteira.visualizar)
  async abertos(
    @Query(new ZodPipe(filtroAbertosSchema)) filtro: FiltroAbertos,
  ): Promise<RelatorioAbertos> {
    return this.carteira.abertos(filtro);
  }

  @Get('limite')
  @Permissoes(PERM.relatorio.visualizar, PERM.carteira.visualizar)
  async limite(
    @Query(new ZodPipe(filtroLimiteSchema)) filtro: FiltroLimite,
  ): Promise<RelatorioLimite> {
    return this.carteira.limite(filtro);
  }

  @Get('ajustes')
  @Permissoes(PERM.relatorio.visualizar, PERM.carteira.visualizar)
  async ajustes(
    @Query(new ZodPipe(filtroAjustesSchema)) filtro: FiltroAjustes,
  ): Promise<RelatorioAjustes> {
    return this.carteira.ajustes(filtro);
  }
}
