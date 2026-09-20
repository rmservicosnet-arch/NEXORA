import {
  PERM,
  alteracaoFornecedorSchema,
  buscaItemCompraSchema,
  edicaoCompraSchema,
  estornoCompraSchema,
  filtroComprasSchema,
  novaCompraSchema,
  novoFornecedorSchema,
  type AlteracaoFornecedor,
  type BuscaItemCompra,
  type Compra,
  type EdicaoCompra,
  type EstornoCompra,
  type FiltroCompras,
  type Fornecedor,
  type ItemParaComprar,
  type NovaCompra,
  type NovoFornecedor,
  type PaginaCompras,
} from '@estoque/contracts';
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';

import type { Principal } from '../auth/dominios';
import { Permissoes, PrincipalAtual } from '../comum/decoradores';
import { ZodPipe } from '../comum/zod.pipe';
import { ComprasService } from './compras.service';

/**
 * Compras — entrada de mercadoria com custo.
 *
 * `compra.visualizar` lê; `compra.receber` é que mexe no estoque. São
 * perguntas diferentes: conferir uma nota digitada por outra pessoa não é o
 * mesmo grau de autoridade que lançar a mercadoria e mover o custo médio.
 */
@Controller('compras')
export class ComprasController {
  constructor(private readonly compras: ComprasService) {}

  @Get('fornecedores')
  @Permissoes(PERM.compra.visualizar)
  async fornecedores(@Query('incluirInativos') incluirInativos?: string): Promise<Fornecedor[]> {
    return this.compras.fornecedores(incluirInativos === 'true');
  }

  @Post('fornecedores')
  @Permissoes(PERM.compra.receber)
  async criarFornecedor(
    @Body(new ZodPipe(novoFornecedorSchema)) dados: NovoFornecedor,
    @PrincipalAtual() principal: Principal,
  ): Promise<Fornecedor> {
    return this.compras.criarFornecedor(dados, principal);
  }

  @Get('itens')
  @Permissoes(PERM.compra.visualizar)
  async buscarItens(
    @Query(new ZodPipe(buscaItemCompraSchema)) busca: BuscaItemCompra,
  ): Promise<ItemParaComprar[]> {
    return this.compras.buscarItens(busca);
  }

  @Put('fornecedores/:id')
  @Permissoes(PERM.compra.receber)
  async alterarFornecedor(
    @Param('id') id: string,
    @Body(new ZodPipe(alteracaoFornecedorSchema)) dados: AlteracaoFornecedor,
    @PrincipalAtual() principal: Principal,
  ): Promise<Fornecedor> {
    return this.compras.alterarFornecedor(id, dados, principal);
  }

  @Get()
  @Permissoes(PERM.compra.visualizar)
  async listar(
    @Query(new ZodPipe(filtroComprasSchema)) filtro: FiltroCompras,
  ): Promise<PaginaCompras> {
    return this.compras.listar(filtro);
  }

  @Get(':id')
  @Permissoes(PERM.compra.visualizar)
  async detalhe(@Param('id') id: string): Promise<Compra> {
    return this.compras.detalhe(id);
  }

  @Post()
  @Permissoes(PERM.compra.receber)
  async criar(
    @Body(new ZodPipe(novaCompraSchema)) dados: NovaCompra,
    @PrincipalAtual() principal: Principal,
  ): Promise<Compra> {
    return this.compras.criar(dados, principal);
  }

  @Put(':id')
  @Permissoes(PERM.compra.receber)
  async editar(
    @Param('id') id: string,
    @Body(new ZodPipe(edicaoCompraSchema)) dados: EdicaoCompra,
    @PrincipalAtual() principal: Principal,
  ): Promise<Compra> {
    return this.compras.editar(id, dados, principal);
  }

  @Delete(':id')
  @HttpCode(204)
  @Permissoes(PERM.compra.receber)
  async remover(@Param('id') id: string, @PrincipalAtual() principal: Principal): Promise<void> {
    return this.compras.remover(id, principal);
  }

  /** É aqui que a mercadoria entra e o custo médio se move. */
  @Post(':id/receber')
  @Permissoes(PERM.compra.receber)
  async receber(@Param('id') id: string, @PrincipalAtual() principal: Principal): Promise<Compra> {
    return this.compras.receber(id, principal);
  }

  @Post(':id/estornar')
  @Permissoes(PERM.compra.receber)
  async estornar(
    @Param('id') id: string,
    @Body(new ZodPipe(estornoCompraSchema)) dados: EstornoCompra,
    @PrincipalAtual() principal: Principal,
  ): Promise<Compra> {
    return this.compras.estornar(id, dados, principal);
  }
}
