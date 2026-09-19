import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import {
  buscaVariacaoSchema,
  contagemEstoqueSchema,
  entradaEstoqueSchema,
  filtroMovimentosSchema,
  saidaEstoqueSchema,
  transferenciaEstoqueSchema,
  PERM,
  type BuscaVariacao,
  type ContagemEstoque,
  type EntradaEstoque,
  type FiltroMovimentos,
  type LocalResumo,
  type PaginaMovimentos,
  type ResultadoMovimento,
  type ResultadoTransferencia,
  type SaidaEstoque,
  type TransferenciaEstoque,
  type VariacaoParaMovimento,
} from '@estoque/contracts';

import type { Principal } from '../auth/dominios';
import { EscopoLoja, Permissoes, PrincipalAtual } from '../comum/decoradores';
import { ZodPipe } from '../comum/zod.pipe';
import { EstoqueService } from './estoque.service';

@Controller('estoque')
export class EstoqueController {
  constructor(private readonly estoque: EstoqueService) {}

  @Get('locais')
  @Permissoes(PERM.estoque.visualizar)
  async locais(): Promise<LocalResumo[]> {
    return this.estoque.locais();
  }

  @Get('variacoes')
  @Permissoes(PERM.estoque.visualizar)
  async variacoes(
    @Query(new ZodPipe(buscaVariacaoSchema)) busca: BuscaVariacao,
    @PrincipalAtual() principal: Principal,
  ): Promise<VariacaoParaMovimento[]> {
    return this.estoque.buscarVariacoes(busca, principal.permissoes.has(PERM.produto.verCusto));
  }

  @Get('movimentos')
  @Permissoes(PERM.estoque.visualizar)
  async movimentos(
    @Query(new ZodPipe(filtroMovimentosSchema)) filtro: FiltroMovimentos,
    @PrincipalAtual() principal: Principal,
  ): Promise<PaginaMovimentos> {
    return this.estoque.movimentos(filtro, principal.permissoes.has(PERM.produto.verCusto));
  }

  @Post('entrada')
  @Permissoes(PERM.estoque.entradaManual)
  @EscopoLoja('lojaId')
  @HttpCode(201)
  async entrada(
    @Body(new ZodPipe(entradaEstoqueSchema)) dados: EntradaEstoque,
    @PrincipalAtual() principal: Principal,
  ): Promise<ResultadoMovimento> {
    return this.estoque.entrada(dados, principal);
  }

  @Post('saida')
  @Permissoes(PERM.estoque.ajustar)
  @EscopoLoja('lojaId')
  @HttpCode(201)
  async saida(
    @Body(new ZodPipe(saidaEstoqueSchema)) dados: SaidaEstoque,
    @PrincipalAtual() principal: Principal,
  ): Promise<ResultadoMovimento> {
    return this.estoque.saida(dados, principal);
  }

  /**
   * O guard de escopo confere a loja de ORIGEM, que é o campo do corpo que ele
   * sabe ler. O destino é conferido no serviço, contra o mesmo vínculo — sem
   * isso, dava para tirar mercadoria da própria loja e despejá-la na de
   * outro time.
   */
  @Post('transferencia')
  @Permissoes(PERM.estoque.transferir)
  @EscopoLoja('lojaOrigemId')
  @HttpCode(201)
  async transferencia(
    @Body(new ZodPipe(transferenciaEstoqueSchema)) dados: TransferenciaEstoque,
    @PrincipalAtual() principal: Principal,
  ): Promise<ResultadoTransferencia> {
    return this.estoque.transferencia(dados, principal);
  }

  @Post('contagem')
  @Permissoes(PERM.estoque.inventariar)
  @EscopoLoja('lojaId')
  @HttpCode(200)
  async contagem(
    @Body(new ZodPipe(contagemEstoqueSchema)) dados: ContagemEstoque,
    @PrincipalAtual() principal: Principal,
  ): Promise<ResultadoMovimento | { semDiferenca: true }> {
    const resultado = await this.estoque.contagem(dados, principal);

    // Contagem que bate com o sistema não vira movimento. A resposta precisa
    // dizer isso explicitamente, senão a tela mostra "nada aconteceu" e o
    // operador conta de novo achando que errou.
    return resultado ?? { semDiferenca: true };
  }
}
