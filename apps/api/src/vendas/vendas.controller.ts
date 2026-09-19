import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  buscaItemVendaSchema,
  cancelamentoVendaSchema,
  filtroVendasSchema,
  novaVendaSchema,
  PERM,
  type BuscaItemVenda,
  type CancelamentoVenda,
  type ContextoPdv,
  type FiltroVendas,
  type ItemParaVenda,
  type NovaVenda,
  type PaginaVendas,
  type ResultadoVenda,
  type Venda,
} from '@estoque/contracts';

import type { Principal } from '../auth/dominios';
import { EscopoLoja, Permissoes, PrincipalAtual } from '../comum/decoradores';
import { ZodPipe } from '../comum/zod.pipe';
import { VendasService } from './vendas.service';

@Controller('vendas')
export class VendasController {
  constructor(private readonly vendas: VendasService) {}

  @Get('contexto')
  @Permissoes(PERM.venda.criar)
  async contexto(@PrincipalAtual() principal: Principal): Promise<ContextoPdv> {
    return this.vendas.contexto(principal);
  }

  @Get('itens')
  @Permissoes(PERM.venda.criar)
  @EscopoLoja('lojaId')
  async itens(
    @Query(new ZodPipe(buscaItemVendaSchema)) busca: BuscaItemVenda,
  ): Promise<ItemParaVenda[]> {
    return this.vendas.buscarItens(busca);
  }

  @Get()
  @Permissoes(PERM.venda.criar)
  async listar(
    @Query(new ZodPipe(filtroVendasSchema)) filtro: FiltroVendas,
    @PrincipalAtual() principal: Principal,
  ): Promise<PaginaVendas> {
    return this.vendas.listar(filtro, principal, principal.permissoes.has(PERM.produto.verCusto));
  }

  @Get(':id')
  @Permissoes(PERM.venda.criar)
  async detalhe(
    @Param('id') id: string,
    @PrincipalAtual() principal: Principal,
  ): Promise<Venda> {
    return this.vendas.detalhe(id, principal.permissoes.has(PERM.produto.verCusto));
  }

  @Post()
  @Permissoes(PERM.venda.criar)
  @EscopoLoja('lojaId')
  async criar(
    @Body(new ZodPipe(novaVendaSchema)) dados: NovaVenda,
    @PrincipalAtual() principal: Principal,
  ): Promise<ResultadoVenda> {
    return this.vendas.criar(dados, principal);
  }

  @Post(':id/cancelar')
  @Permissoes(PERM.venda.cancelar)
  async cancelar(
    @Param('id') id: string,
    @Body(new ZodPipe(cancelamentoVendaSchema)) dados: CancelamentoVenda,
    @PrincipalAtual() principal: Principal,
  ): Promise<Venda> {
    return this.vendas.cancelar(id, dados, principal);
  }
}
