import { Controller, Get, Query } from '@nestjs/common';
import {
  filtroPosicaoSchema,
  filtroVendasRelatorioSchema,
  PERM,
  type FiltroPosicao,
  type FiltroVendasRelatorio,
  type PosicaoEstoque,
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
}
