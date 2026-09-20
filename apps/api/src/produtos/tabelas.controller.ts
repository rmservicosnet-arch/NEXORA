import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import {
  alteracaoTabelaPrecoSchema,
  novaTabelaPrecoSchema,
  PERM,
  type AlteracaoTabelaPreco,
  type NovaTabelaPreco,
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

  @Patch(':id')
  @Permissoes(PERM.preco.editar)
  async alterar(
    @Param('id') id: string,
    @Body(new ZodPipe(alteracaoTabelaPrecoSchema)) dados: AlteracaoTabelaPreco,
  ): Promise<{ id: string }> {
    return this.tabelas.alterar(id, dados);
  }
}
