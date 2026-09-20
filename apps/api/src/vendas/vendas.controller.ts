import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  buscaItemVendaSchema,
  cancelamentoVendaSchema,
  devolucaoVendaSchema,
  filtroVendasSchema,
  novaVendaSchema,
  PERM,
  type BuscaItemVenda,
  type CancelamentoVenda,
  type DevolucaoVenda,
  type ResultadoDevolucao,
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
  async detalhe(@Param('id') id: string, @PrincipalAtual() principal: Principal): Promise<Venda> {
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

  /**
   * Devolucao PARCIAL.
   *
   * `venda.devolver` existia como permissao, o VENDEDOR ja a tinha e nenhuma
   * rota a exigia — devolver dois de dez so era possivel cancelando a venda
   * inteira.
   *
   * A resposta traz os DESTINOS do dinheiro, nao so o total: quem chama
   * precisa saber que parte abateu um titulo e parte saiu da gaveta.
   */
  @Post(':id/devolucoes')
  @Permissoes(PERM.venda.devolver)
  async devolver(
    @Param('id') id: string,
    @Body(new ZodPipe(devolucaoVendaSchema)) dados: DevolucaoVenda,
    @PrincipalAtual() principal: Principal,
  ): Promise<ResultadoDevolucao> {
    return this.vendas.devolver(id, dados, principal);
  }

  /**
   * A PREVIA da devolucao: a mesma conta, sem gravar nada.
   *
   * A tela mostra para onde o dinheiro vai antes de alguem confirmar, e o
   * numero tem de ser o mesmo que a devolucao vai produzir — por isso a
   * previa roda o servico de verdade e desfaz no fim, em vez de repetir a
   * regra no navegador.
   */
  @Post(':id/devolucoes/previa')
  @Permissoes(PERM.venda.devolver)
  async previaDevolucao(
    @Param('id') id: string,
    @Body(new ZodPipe(devolucaoVendaSchema)) dados: DevolucaoVenda,
    @PrincipalAtual() principal: Principal,
  ): Promise<ResultadoDevolucao> {
    return this.vendas.devolver(id, dados, principal, true);
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
