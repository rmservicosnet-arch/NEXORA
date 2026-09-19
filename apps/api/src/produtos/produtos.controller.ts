import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  alteracaoProdutoSchema,
  filtroProdutosSchema,
  novoProdutoSchema,
  PERM,
  type AlteracaoProduto,
  type ApoioProduto,
  type FiltroProdutos,
  type NovoProduto,
  type PaginaProdutos,
  type ProdutoDetalhe,
} from '@estoque/contracts';

import type { Principal } from '../auth/dominios';
import { Permissoes, PrincipalAtual } from '../comum/decoradores';
import { ZodPipe } from '../comum/zod.pipe';
import { ProdutosService } from './produtos.service';

@Controller('produtos')
export class ProdutosController {
  constructor(private readonly produtos: ProdutosService) {}

  @Get()
  @Permissoes(PERM.produto.visualizar)
  async listar(
    @Query(new ZodPipe(filtroProdutosSchema)) filtro: FiltroProdutos,
    @PrincipalAtual() principal: Principal,
  ): Promise<PaginaProdutos> {
    // A permissão é resolvida AQUI e passada para o serviço, que decide se os
    // campos de custo entram na resposta. O front não tem como pedir custo
    // sem ter direito — ele simplesmente não vem.
    return this.produtos.listar(filtro, principal.permissoes.has(PERM.produto.verCusto));
  }

  @Get('apoio')
  @Permissoes(PERM.produto.visualizar)
  async apoio(): Promise<ApoioProduto> {
    return this.produtos.apoio();
  }

  // Depois de `apoio`: o NestJS casa as rotas na ordem de declaração, e
  // `:id` capturaria "apoio" se viesse antes.
  @Get(':id')
  @Permissoes(PERM.produto.visualizar)
  async detalhe(
    @Param('id') id: string,
    @PrincipalAtual() principal: Principal,
  ): Promise<ProdutoDetalhe> {
    return this.produtos.detalhe(id, principal.permissoes.has(PERM.produto.verCusto));
  }

  @Post()
  @Permissoes(PERM.produto.criar)
  async criar(
    @Body(new ZodPipe(novoProdutoSchema)) dados: NovoProduto,
    @PrincipalAtual() principal: Principal,
  ): Promise<{ id: string }> {
    return this.produtos.criar(dados, principal);
  }

  @Patch(':id')
  @Permissoes(PERM.produto.editar)
  async alterar(
    @Param('id') id: string,
    @Body(new ZodPipe(alteracaoProdutoSchema)) dados: AlteracaoProduto,
    @PrincipalAtual() principal: Principal,
  ): Promise<{ id: string }> {
    return this.produtos.alterar(id, dados, principal);
  }
}
