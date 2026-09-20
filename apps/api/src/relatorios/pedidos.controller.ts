import { Controller, Get, Query } from '@nestjs/common';
import {
  filtroConfirmacaoSchema,
  filtroFilaSchema,
  PERM,
  type FiltroConfirmacao,
  type FiltroFila,
  type RelatorioConfirmacao,
  type RelatorioFila,
} from '@estoque/contracts';

import { Permissoes } from '../comum/decoradores';
import { ZodPipe } from '../comum/zod.pipe';
import { RelatoriosPedidosService } from './pedidos.service';

/**
 * Os relatórios do ciclo do pedido.
 *
 * Nenhum deles mostra custo: a pergunta aqui é de processo — o que está
 * travado, o que foi recusado, quanto tempo demorou.
 */
@Controller('relatorios/pedidos')
export class RelatoriosPedidosController {
  constructor(private readonly pedidos: RelatoriosPedidosService) {}

  @Get('fila')
  @Permissoes(PERM.relatorio.visualizar)
  async fila(@Query(new ZodPipe(filtroFilaSchema)) filtro: FiltroFila): Promise<RelatorioFila> {
    return this.pedidos.fila(filtro);
  }

  @Get('confirmacao')
  @Permissoes(PERM.relatorio.visualizar)
  async confirmacao(
    @Query(new ZodPipe(filtroConfirmacaoSchema)) filtro: FiltroConfirmacao,
  ): Promise<RelatorioConfirmacao> {
    return this.pedidos.confirmacao(filtro);
  }
}
