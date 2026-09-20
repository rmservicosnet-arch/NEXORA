import {
  PERM,
  filtroAgingSchema,
  filtroAReceberSchema,
  filtroComprasFornecedorSchema,
  filtroCustoAquisicaoSchema,
  filtroFluxoSchema,
  type FiltroAging,
  type FiltroAReceber,
  type FiltroComprasFornecedor,
  type FiltroCustoAquisicao,
  type FiltroFluxo,
  type RelatorioAging,
  type RelatorioAReceber,
  type RelatorioComprasFornecedor,
  type RelatorioCustoAquisicao,
  type RelatorioFluxo,
} from '@estoque/contracts';
import { Controller, Get, Query } from '@nestjs/common';

import { Permissoes } from '../comum/decoradores';
import { ZodPipe } from '../comum/zod.pipe';
import { RelatoriosFase5Service } from './fase5.service';

/**
 * Relatorios de Compras e Contas.
 *
 * O aging e o fluxo exigem `financeiro.visualizar` alem de
 * `relatorio.visualizar`: quanto a loja deve a cada fornecedor nao e dado de
 * relatorio comum. O custo de aquisicao exige `relatorio.ver_custo` pelo
 * mesmo motivo de sempre.
 */
@Controller('relatorios')
export class RelatoriosFase5Controller {
  constructor(private readonly fase5: RelatoriosFase5Service) {}

  @Get('financeiro/aging')
  @Permissoes(PERM.relatorio.visualizar, PERM.financeiro.visualizar)
  async aging(@Query(new ZodPipe(filtroAgingSchema)) filtro: FiltroAging): Promise<RelatorioAging> {
    return this.fase5.aging(filtro);
  }

  @Get('financeiro/fluxo')
  @Permissoes(PERM.relatorio.visualizar, PERM.financeiro.visualizar)
  async fluxo(@Query(new ZodPipe(filtroFluxoSchema)) filtro: FiltroFluxo): Promise<RelatorioFluxo> {
    return this.fase5.fluxo(filtro);
  }

  @Get('compras/fornecedores')
  @Permissoes(PERM.relatorio.visualizar, PERM.compra.visualizar)
  async comprasPorFornecedor(
    @Query(new ZodPipe(filtroComprasFornecedorSchema)) filtro: FiltroComprasFornecedor,
  ): Promise<RelatorioComprasFornecedor> {
    return this.fase5.comprasPorFornecedor(filtro);
  }

  @Get('compras/custo-aquisicao')
  @Permissoes(PERM.relatorio.visualizar, PERM.compra.visualizar, PERM.relatorio.verCusto)
  async custoDeAquisicao(
    @Query(new ZodPipe(filtroCustoAquisicaoSchema)) filtro: FiltroCustoAquisicao,
  ): Promise<RelatorioCustoAquisicao> {
    return this.fase5.custoDeAquisicao(filtro);
  }

  @Get('compras/a-receber')
  @Permissoes(PERM.relatorio.visualizar, PERM.compra.visualizar)
  async notasAReceber(
    @Query(new ZodPipe(filtroAReceberSchema)) filtro: FiltroAReceber,
  ): Promise<RelatorioAReceber> {
    return this.fase5.notasAReceber(filtro);
  }
}
