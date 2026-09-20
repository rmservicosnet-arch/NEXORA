import { Controller, Get, Query } from '@nestjs/common';
import {
  filtroCancelamentosSchema,
  filtroComparativoSchema,
  filtroDescontosSchema,
  filtroFormasSchema,
  filtroGiroSchema,
  filtroMovimentoRelatorioSchema,
  filtroPosicaoSchema,
  filtroVendasRelatorioSchema,
  PERM,
  type FiltroCancelamentos,
  type FiltroComparativo,
  type FiltroDescontos,
  type FiltroFormas,
  type FiltroGiro,
  type FiltroMovimentoRelatorio,
  type FiltroPosicao,
  type FiltroVendasRelatorio,
  type PosicaoEstoque,
  type RelatorioCancelamentos,
  type RelatorioComparativo,
  type RelatorioDescontos,
  type RelatorioFormas,
  type RelatorioGiro,
  type RelatorioInventario,
  type RelatorioTransferencias,
  type RelatorioVendas,
} from '@estoque/contracts';

import type { Principal } from '../auth/dominios';
import { Permissoes, PrincipalAtual } from '../comum/decoradores';
import { ZodPipe } from '../comum/zod.pipe';
import { RelatoriosService } from './relatorios.service';

/**
 * Os relatórios construídos.
 *
 * `relatorio.visualizar` abre a porta; `relatorio.ver_custo` decide se custo,
 * valor e margem entram na resposta. Quem não tem a segunda não recebe as
 * colunas — não as recebe vazias.
 */
@Controller('relatorios')
export class RelatoriosController {
  constructor(private readonly relatorios: RelatoriosService) {}

  @Get('posicao-estoque')
  @Permissoes(PERM.relatorio.visualizar)
  async posicao(
    @Query(new ZodPipe(filtroPosicaoSchema)) filtro: FiltroPosicao,
    @PrincipalAtual() principal: Principal,
  ): Promise<PosicaoEstoque> {
    return this.relatorios.posicao(filtro, principal.permissoes.has(PERM.relatorio.verCusto));
  }

  @Get('vendas')
  @Permissoes(PERM.relatorio.visualizar)
  async vendas(
    @Query(new ZodPipe(filtroVendasRelatorioSchema)) filtro: FiltroVendasRelatorio,
    @PrincipalAtual() principal: Principal,
  ): Promise<RelatorioVendas> {
    return this.relatorios.vendas(filtro, principal.permissoes.has(PERM.relatorio.verCusto));
  }

  /**
   * Giro e "sem movimento" são a mesma rota.
   *
   * `ordem=parado` inverte a leitura. Duas rotas seriam duas consultas que
   * precisariam concordar sobre o que é girar.
   */
  /** A mesma metrica, lojas lado a lado. Sem filtro de loja, de proposito. */
  @Get('comparativo-lojas')
  @Permissoes(PERM.relatorio.visualizar)
  async comparativo(
    @Query(new ZodPipe(filtroComparativoSchema)) filtro: FiltroComparativo,
    @PrincipalAtual() principal: Principal,
  ): Promise<RelatorioComparativo> {
    return this.relatorios.comparativo(filtro, principal.permissoes.has(PERM.relatorio.verCusto));
  }

  /** O que foi desfeito, e quanto tempo depois. */
  @Get('cancelamentos')
  @Permissoes(PERM.relatorio.visualizar)
  async cancelamentos(
    @Query(new ZodPipe(filtroCancelamentosSchema)) filtro: FiltroCancelamentos,
  ): Promise<RelatorioCancelamentos> {
    return this.relatorios.cancelamentos(filtro);
  }

  /** Controle, nao curiosidade: quem desconta quanto, e quanto cobra a mais. */
  @Get('descontos')
  @Permissoes(PERM.relatorio.visualizar)
  async descontos(
    @Query(new ZodPipe(filtroDescontosSchema)) filtro: FiltroDescontos,
  ): Promise<RelatorioDescontos> {
    return this.relatorios.descontos(filtro);
  }

  /** Como o dinheiro entrou. Sem custo envolvido: ninguem precisa da margem. */
  @Get('formas-pagamento')
  @Permissoes(PERM.relatorio.visualizar)
  async formas(
    @Query(new ZodPipe(filtroFormasSchema)) filtro: FiltroFormas,
  ): Promise<RelatorioFormas> {
    return this.relatorios.formas(filtro);
  }

  @Get('giro')
  @Permissoes(PERM.relatorio.visualizar)
  async giro(
    @Query(new ZodPipe(filtroGiroSchema)) filtro: FiltroGiro,
    @PrincipalAtual() principal: Principal,
  ): Promise<RelatorioGiro> {
    return this.relatorios.giro(filtro, principal.permissoes.has(PERM.relatorio.verCusto));
  }

  /** Transferência não tem custo na tela: quem move não muda o patrimônio. */
  @Get('transferencias')
  @Permissoes(PERM.relatorio.visualizar)
  async transferencias(
    @Query(new ZodPipe(filtroMovimentoRelatorioSchema)) filtro: FiltroMovimentoRelatorio,
  ): Promise<RelatorioTransferencias> {
    return this.relatorios.transferencias(filtro);
  }

  @Get('inventario')
  @Permissoes(PERM.relatorio.visualizar)
  async inventario(
    @Query(new ZodPipe(filtroMovimentoRelatorioSchema)) filtro: FiltroMovimentoRelatorio,
    @PrincipalAtual() principal: Principal,
  ): Promise<RelatorioInventario> {
    return this.relatorios.inventario(filtro, principal.permissoes.has(PERM.relatorio.verCusto));
  }
}
