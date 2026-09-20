import { Controller, Get, Query } from '@nestjs/common';
import {
  filtroAceitesSchema,
  filtroAlteracoesSchema,
  filtroConfirmacaoSchema,
  filtroFilaSchema,
  filtroRupturaSchema,
  PERM,
  type FiltroAceites,
  type FiltroAlteracoes,
  type FiltroConfirmacao,
  type FiltroFila,
  type FiltroRuptura,
  type RelatorioAceites,
  type RelatorioAlteracoes,
  type RelatorioConfirmacao,
  type RelatorioFila,
  type RelatorioRuptura,
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

  /** O unico lugar onde a demanda aparece SEM a venda. */
  @Get('ruptura')
  @Permissoes(PERM.relatorio.visualizar)
  async ruptura(
    @Query(new ZodPipe(filtroRupturaSchema)) filtro: FiltroRuptura,
  ): Promise<RelatorioRuptura> {
    return this.pedidos.ruptura(filtro);
  }

  @Get('alteracoes')
  @Permissoes(PERM.relatorio.visualizar)
  async alteracoes(
    @Query(new ZodPipe(filtroAlteracoesSchema)) filtro: FiltroAlteracoes,
  ): Promise<RelatorioAlteracoes> {
    return this.pedidos.alteracoes(filtro);
  }

  @Get('aceites')
  @Permissoes(PERM.relatorio.visualizar)
  async aceites(
    @Query(new ZodPipe(filtroAceitesSchema)) filtro: FiltroAceites,
  ): Promise<RelatorioAceites> {
    return this.pedidos.aceites(filtro);
  }
}
