import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import {
  alteracaoTabelaPrecoSchema,
  filtroItensTabelaSchema,
  gravacaoPrecosTabelaSchema,
  novaTabelaPrecoSchema,
  PERM,
  type AlteracaoTabelaPreco,
  type FiltroItensTabela,
  type GravacaoPrecosTabela,
  type NovaTabelaPreco,
  type PaginaItensTabela,
  type TabelaPreco,
} from '@estoque/contracts';

import type { Principal } from '../auth/dominios';
import { Permissoes, PrincipalAtual } from '../comum/decoradores';
import { ZodPipe } from '../comum/zod.pipe';
import { TabelasService } from './tabelas.service';

/**
 * As tabelas de preço em si — não os preços dentro delas.
 *
 * `preco.visualizar` e `preco.editar`: criar uma tabela é decisão de política
 * comercial, do mesmo grau que mexer num preço.
 */
@Controller('tabelas-preco')
export class TabelasController {
  constructor(private readonly tabelas: TabelasService) {}

  @Get()
  @Permissoes(PERM.preco.visualizar)
  async listar(): Promise<TabelaPreco[]> {
    return this.tabelas.listar();
  }

  @Post()
  @Permissoes(PERM.preco.editar)
  async criar(
    @Body(new ZodPipe(novaTabelaPrecoSchema)) dados: NovaTabelaPreco,
    @PrincipalAtual() principal: Principal,
  ): Promise<{ id: string }> {
    return this.tabelas.criar(dados, principal);
  }

  /**
   * Os itens da tabela, com o preço de cada um.
   *
   * O custo só entra para quem tem `produto.ver_custo` — e com ele sai também
   * a margem, que permitiria deduzi-lo.
   */
  @Get(':id/itens')
  @Permissoes(PERM.preco.visualizar)
  async itens(
    @Param('id') id: string,
    @Query(new ZodPipe(filtroItensTabelaSchema)) filtro: FiltroItensTabela,
    @PrincipalAtual() principal: Principal,
  ): Promise<PaginaItensTabela> {
    return this.tabelas.itens(id, filtro, principal.permissoes.has(PERM.produto.verCusto));
  }

  @Put(':id/itens')
  @Permissoes(PERM.preco.editar)
  async gravarPrecos(
    @Param('id') id: string,
    @Body(new ZodPipe(gravacaoPrecosTabelaSchema)) dados: GravacaoPrecosTabela,
    @PrincipalAtual() principal: Principal,
  ): Promise<{ gravados: number; removidos: number }> {
    return this.tabelas.gravarPrecos(id, dados, principal);
  }

  @Patch(':id')
  @Permissoes(PERM.preco.editar)
  async alterar(
    @Param('id') id: string,
    @Body(new ZodPipe(alteracaoTabelaPrecoSchema)) dados: AlteracaoTabelaPreco,
  ): Promise<{ id: string }> {
    return this.tabelas.alterar(id, dados);
  }
}
