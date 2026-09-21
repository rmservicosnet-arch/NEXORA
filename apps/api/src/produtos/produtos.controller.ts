import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  alteracaoPrecosSchema,
  alteracaoProdutoSchema,
  filtroProdutosSchema,
  novoProdutoSchema,
  PERM,
  type AlteracaoPrecos,
  type AlteracaoProduto,
  type ApoioProduto,
  type FiltroProdutos,
  type NovoProduto,
  type PaginaProdutos,
  type PrecosDoProduto,
  type ProdutoDetalhe,
  novaOpcaoSchema,
  renomearOpcaoSchema,
  situacaoOpcaoSchema,
  type NovaOpcao,
  type Opcao,
  type RenomearOpcao,
  type SituacaoOpcao,
} from '@estoque/contracts';

import type { Principal } from '../auth/dominios';
import { Permissoes, PrincipalAtual } from '../comum/decoradores';
import { ZodPipe } from '../comum/zod.pipe';
import { PrecosService } from './precos.service';
import { ProdutosService } from './produtos.service';

@Controller('produtos')
export class ProdutosController {
  constructor(
    private readonly produtos: ProdutosService,
    private readonly precos: PrecosService,
  ) {}

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

  /*
    Criar categoria e marca — também antes de `:id`.

    Exigem `produto.criar`, não uma permissão própria: quem cadastra produto
    é quem descobre que falta a categoria, e uma permissão a mais que ninguém
    atribuísse deixaria o campo inalcançável do mesmo jeito.
  */
  @Post('categorias')
  @Permissoes(PERM.produto.criar)
  async criarCategoria(@Body(new ZodPipe(novaOpcaoSchema)) dto: NovaOpcao): Promise<Opcao> {
    return this.produtos.criarOpcao('categoria', dto.nome);
  }

  @Post('marcas')
  @Permissoes(PERM.produto.criar)
  async criarMarca(@Body(new ZodPipe(novaOpcaoSchema)) dto: NovaOpcao): Promise<Opcao> {
    return this.produtos.criarOpcao('marca', dto.nome);
  }

  /* Renomear: sem isto, um nome errado ficava preso para sempre. */
  @Put('categorias/:id')
  @Permissoes(PERM.produto.criar)
  async renomearCategoria(
    @Param('id') id: string,
    @Body(new ZodPipe(renomearOpcaoSchema)) dto: RenomearOpcao,
  ): Promise<Opcao> {
    return this.produtos.renomearOpcao('categoria', id, dto.nome);
  }

  @Put('marcas/:id')
  @Permissoes(PERM.produto.criar)
  async renomearMarca(
    @Param('id') id: string,
    @Body(new ZodPipe(renomearOpcaoSchema)) dto: RenomearOpcao,
  ): Promise<Opcao> {
    return this.produtos.renomearOpcao('marca', id, dto.nome);
  }

  /* Com vínculo, a saída é desativar — e ela volta atrás. */
  @Put('categorias/:id/situacao')
  @Permissoes(PERM.produto.criar)
  async situacaoCategoria(
    @Param('id') id: string,
    @Body(new ZodPipe(situacaoOpcaoSchema)) dto: SituacaoOpcao,
  ): Promise<Opcao> {
    return this.produtos.mudarSituacaoOpcao('categoria', id, dto.ativo);
  }

  @Put('marcas/:id/situacao')
  @Permissoes(PERM.produto.criar)
  async situacaoMarca(
    @Param('id') id: string,
    @Body(new ZodPipe(situacaoOpcaoSchema)) dto: SituacaoOpcao,
  ): Promise<Opcao> {
    return this.produtos.mudarSituacaoOpcao('marca', id, dto.ativo);
  }

  /* Só o que ninguém usa. Com produto apontando, a recusa diz quantos. */
  @Delete('categorias/:id')
  @HttpCode(204)
  @Permissoes(PERM.produto.criar)
  async excluirCategoria(@Param('id') id: string): Promise<void> {
    await this.produtos.excluirOpcao('categoria', id);
  }

  @Delete('marcas/:id')
  @HttpCode(204)
  @Permissoes(PERM.produto.criar)
  async excluirMarca(@Param('id') id: string): Promise<void> {
    await this.produtos.excluirOpcao('marca', id);
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

  @Get(':id/precos')
  @Permissoes(PERM.preco.visualizar)
  async precosDoProduto(@Param('id') id: string): Promise<PrecosDoProduto> {
    return this.precos.doProduto(id);
  }

  @Put(':id/precos')
  @Permissoes(PERM.preco.editar)
  async alterarPrecos(
    @Param('id') id: string,
    @Body(new ZodPipe(alteracaoPrecosSchema)) dados: AlteracaoPrecos,
    @PrincipalAtual() principal: Principal,
  ): Promise<PrecosDoProduto> {
    return this.precos.alterar(id, dados, principal);
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
