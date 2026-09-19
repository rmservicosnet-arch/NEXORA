import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  aberturaCaixaSchema,
  conferenciaCaixaSchema,
  fechamentoCaixaSchema,
  filtroCaixasSchema,
  movimentoCaixaSchema,
  PERM,
  type AberturaCaixa,
  type Caixa,
  type CaixaAtual,
  type ConferenciaCaixa,
  type FechamentoCaixa,
  type FiltroCaixas,
  type NovoMovimentoCaixa,
  type PaginaCaixas,
} from '@estoque/contracts';

import type { Principal } from '../auth/dominios';
import { EscopoLoja, Permissoes, PrincipalAtual } from '../comum/decoradores';
import { ZodPipe } from '../comum/zod.pipe';
import { CaixaService } from './caixa.service';

@Controller('caixa')
export class CaixaController {
  constructor(private readonly caixa: CaixaService) {}

  /**
   * O caixa aberto do operador naquela loja.
   *
   * É a primeira coisa que o PDV pergunta ao abrir. Não é 404 quando não há:
   * "não há caixa aberto" é uma resposta normal, não um erro.
   *
   * E vem embrulhado em `{ caixa }` porque handler que devolve `null` manda
   * corpo VAZIO — e o cliente recebe `{}`, que é verdadeiro. Ver o comentário
   * em `caixaAtualSchema`.
   */
  @Get('meu')
  @Permissoes(PERM.caixa.abrir)
  @EscopoLoja('lojaId')
  async meu(
    @Query('lojaId') lojaId: string,
    @PrincipalAtual() principal: Principal,
  ): Promise<CaixaAtual> {
    return { caixa: await this.caixa.meuCaixaAberto(lojaId, principal) };
  }

  @Get()
  @Permissoes(PERM.caixa.abrir)
  async listar(
    @Query(new ZodPipe(filtroCaixasSchema)) filtro: FiltroCaixas,
    @PrincipalAtual() principal: Principal,
  ): Promise<PaginaCaixas> {
    return this.caixa.listar(filtro, principal);
  }

  @Get(':id')
  @Permissoes(PERM.caixa.abrir)
  async detalhe(
    @Param('id') id: string,
    @PrincipalAtual() principal: Principal,
  ): Promise<Caixa> {
    return this.caixa.detalhe(id, principal);
  }

  @Post('abrir')
  @Permissoes(PERM.caixa.abrir)
  @EscopoLoja('lojaId')
  async abrir(
    @Body(new ZodPipe(aberturaCaixaSchema)) dados: AberturaCaixa,
    @PrincipalAtual() principal: Principal,
  ): Promise<Caixa> {
    return this.caixa.abrir(dados, principal);
  }

  /**
   * Sangria e suprimento na mesma rota.
   *
   * A permissão específica é conferida no serviço, porque depende do `tipo`
   * que vem no corpo — `@Permissoes` decide antes de o corpo ser lido.
   */
  @Post(':id/movimento')
  @Permissoes(PERM.caixa.abrir)
  async movimentar(
    @Param('id') id: string,
    @Body(new ZodPipe(movimentoCaixaSchema)) dados: NovoMovimentoCaixa,
    @PrincipalAtual() principal: Principal,
  ): Promise<Caixa> {
    return this.caixa.movimentar(id, dados, principal);
  }

  @Post(':id/fechar')
  @Permissoes(PERM.caixa.fechar)
  async fechar(
    @Param('id') id: string,
    @Body(new ZodPipe(fechamentoCaixaSchema)) dados: FechamentoCaixa,
    @PrincipalAtual() principal: Principal,
  ): Promise<Caixa> {
    return this.caixa.fechar(id, dados, principal);
  }

  @Post(':id/conferir')
  @Permissoes(PERM.caixa.conferir)
  async conferir(
    @Param('id') id: string,
    @Body(new ZodPipe(conferenciaCaixaSchema)) dados: ConferenciaCaixa,
    @PrincipalAtual() principal: Principal,
  ): Promise<Caixa> {
    return this.caixa.conferir(id, dados, principal);
  }
}
