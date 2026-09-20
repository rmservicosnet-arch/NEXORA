import {
  PERM,
  filtroAgingSchema,
  filtroAReceberSchema,
  filtroComprasFornecedorSchema,
  filtroCustoAquisicaoSchema,
  filtroFluxoSchema,
  filtroRevendedoresSchema,
  type FiltroAging,
  type FiltroAReceber,
  type FiltroComprasFornecedor,
  type FiltroCustoAquisicao,
  type FiltroFluxo,
  type FiltroRevendedores,
  type RelatorioAging,
  type RelatorioAReceber,
  type RelatorioComprasFornecedor,
  type RelatorioCustoAquisicao,
  type RelatorioFluxo,
  type RelatorioRevendedores,
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
 * relatorio comum.
 *
 * Os TRES de compras exigem `relatorio.ver_custo`. Nao e so o relatorio que
 * tem "custo" no nome: "compras por fornecedor" devolve o valor comprado ao
 * lado das unidades, e quem divide um pelo outro tem o custo unitario medio
 * do fornecedor; "notas a receber" devolve o valor parado, que e o mesmo
 * numero antes de entrar no estoque. Restringir so o do nome obvio e a
 * mesma falha da coluna de custo que apareceu para uma vendedora.
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

  /**
   * Quem mais comprou no periodo — professores e revendedores.
   *
   * Exige `cliente.visualizar` alem de `relatorio.visualizar`: e um ranking
   * NOMINAL de quanto cada cliente comprou, e isso nao e dado de relatorio
   * comum.
   */
  @Get('vendas/revendedores')
  @Permissoes(PERM.relatorio.visualizar, PERM.cliente.visualizar)
  async revendedores(
    @Query(new ZodPipe(filtroRevendedoresSchema)) filtro: FiltroRevendedores,
  ): Promise<RelatorioRevendedores> {
    return this.fase5.revendedores(filtro);
  }

  @Get('compras/fornecedores')
  @Permissoes(PERM.relatorio.visualizar, PERM.compra.visualizar, PERM.relatorio.verCusto)
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
  @Permissoes(PERM.relatorio.visualizar, PERM.compra.visualizar, PERM.relatorio.verCusto)
  async notasAReceber(
    @Query(new ZodPipe(filtroAReceberSchema)) filtro: FiltroAReceber,
  ): Promise<RelatorioAReceber> {
    return this.fase5.notasAReceber(filtro);
  }
}
