import { Body, Controller, Get, Patch } from '@nestjs/common';
import {
  alteracaoConfiguracaoSchema,
  PERM,
  type AlteracaoConfiguracao,
  type ConfiguracaoEmpresa,
} from '@estoque/contracts';

import type { Principal } from '../auth/dominios';
import { Permissoes, PrincipalAtual } from '../comum/decoradores';
import { ZodPipe } from '../comum/zod.pipe';
import { ConfiguracoesService } from './configuracoes.service';

/**
 * A configuração da empresa. Uma linha, sem id na rota.
 *
 * `configuracao.editar` é permissão de administrador: `modoCheckout` decide
 * se o carrinho do cliente vira venda ou pedido, e `prazoReservaHoras` decide
 * quando o estoque reservado volta para a prateleira.
 */
@Controller('configuracao')
export class ConfiguracoesController {
  constructor(private readonly configuracoes: ConfiguracoesService) {}

  @Get()
  @Permissoes(PERM.configuracao.visualizar)
  async ver(@PrincipalAtual() principal: Principal): Promise<ConfiguracaoEmpresa> {
    return this.configuracoes.ver(principal);
  }

  @Patch()
  @Permissoes(PERM.configuracao.editar)
  async alterar(
    @Body(new ZodPipe(alteracaoConfiguracaoSchema)) dados: AlteracaoConfiguracao,
    @PrincipalAtual() principal: Principal,
  ): Promise<ConfiguracaoEmpresa> {
    return this.configuracoes.alterar(dados, principal);
  }
}
