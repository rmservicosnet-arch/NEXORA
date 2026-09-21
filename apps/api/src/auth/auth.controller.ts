import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UsePipes,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { ExigeDominio, PrincipalAtual, Publico } from '../comum/decoradores';
import { ZodPipe } from '../comum/zod.pipe';
import type { Ambiente } from '../configuracao';
import { AuthService, type Sessao } from './auth.service';
import {
  esquemaEntrada,
  esquemaRenovacao,
  esquemaSaida,
  esquemaTrocaDeSenha,
  type EntradaDto,
  type RenovacaoDto,
  type SaidaDto,
  type TrocaDeSenhaDto,
} from './auth.dto';
import { DOMINIO_CLIENTE, DOMINIO_FUNCIONARIO, type Dominio, type Principal } from './dominios';

interface RespostaSessao {
  readonly tokenAcesso: string;
  readonly tokenRefresh?: string;
  readonly usuario: {
    readonly id: string;
    readonly nome: string;
    readonly email: string;
    readonly dominio: Dominio;
    /** So no portal: a empresa em nome de quem a pessoa compra. */
    readonly empresa?: string;
    readonly permissoes: string[];
    readonly lojaIds: string[];
  };
}

/**
 * Base comum aos dois domínios.
 *
 * Login de funcionário e de cliente fazem a mesma coisa com segredos,
 * tabelas e cookies diferentes. O que NÃO se compartilha é a rota nem o
 * segredo — é isso que mantém os domínios separados de verdade.
 */
abstract class AuthControllerBase {
  protected abstract readonly dominio: Dominio;
  protected abstract readonly nomeDoCookie: string;

  constructor(
    protected readonly auth: AuthService,
    protected readonly config: ConfigService<Ambiente, true>,
  ) {}

  /**
   * Troca a senha do dono da sessão.
   *
   * Mora na base porque a regra não muda entre os domínios — e as duas rotas
   * continuam separadas, cada uma no seu controller, como tudo aqui.
   *
   * Limpa o cookie: a troca derruba todas as sessões daquele principal,
   * inclusive esta. Deixar o cookie na máquina faria o próximo carregamento
   * tentar renovar com um refresh já revogado.
   */
  protected async trocar(principal: Principal, dto: TrocaDeSenhaDto, res: Response): Promise<void> {
    await this.auth.trocarSenha(principal, dto.senhaAtual, dto.novaSenha);
    res.clearCookie(this.nomeDoCookie, { path: '/' });
  }

  protected responder(
    sessao: Sessao,
    dto: { canal: string; manterConectado?: boolean },
    res: Response,
  ): RespostaSessao {
    const corpo: RespostaSessao = {
      tokenAcesso: sessao.tokenAcesso,
      // Canal `app` recebe no corpo; `web` recebe no cookie. Nunca os dois:
      // devolver no corpo anularia o httpOnly.
      ...(dto.canal === 'app' ? { tokenRefresh: sessao.tokenRefresh } : {}),
      usuario: {
        id: sessao.principal.id,
        nome: sessao.principal.nome,
        email: sessao.principal.email,
        dominio: sessao.principal.dominio,
        ...(sessao.principal.empresa ? { empresa: sessao.principal.empresa } : {}),
        permissoes: [...sessao.principal.permissoes],
        lojaIds: [...sessao.principal.lojaIds],
        ...(sessao.principal.suporteDe ? { suporteDe: sessao.principal.suporteDe } : {}),
      },
    };

    if (dto.canal === 'web') {
      res.cookie(this.nomeDoCookie, sessao.tokenRefresh, {
        httpOnly: true,
        sameSite: 'strict',
        secure: this.config.get('COOKIE_SECURE', { infer: true }),
        domain: this.config.get('COOKIE_DOMAIN', { infer: true }),
        path: '/',
        /*
          Sem `maxAge` o cookie é de SESSÃO: morre quando a janela fecha.
          É o que "manter conectado" desmarcado pede — e o token no servidor
          continua válido pelos mesmos 30 dias, porque quem decide aqui é o
          aparelho, não o servidor.
        */
        ...(dto.manterConectado === false
          ? {}
          : {
              maxAge: this.config.get('REFRESH_TOKEN_TTL_DIAS', { infer: true }) * 86_400_000,
            }),
      });
    }

    return corpo;
  }

  protected refreshDaRequisicao(req: Request, dto: RenovacaoDto): string {
    const doCookie = (req.cookies as Record<string, string> | undefined)?.[this.nomeDoCookie];
    const token = dto.canal === 'app' ? dto.refreshToken : doCookie;

    if (!token) {
      throw new UnauthorizedException({
        codigo: 'REFRESH_AUSENTE',
        mensagem: 'Sessão não encontrada.',
      });
    }
    return token;
  }

  protected metadados(req: Request): { ip?: string; userAgent?: string } {
    return {
      ...(req.ip ? { ip: req.ip } : {}),
      ...(req.headers['user-agent'] ? { userAgent: req.headers['user-agent'] } : {}),
    };
  }
}

// ---------------------------------------------------------------------------
// Funcionários
// ---------------------------------------------------------------------------

@Controller('auth')
export class AuthController extends AuthControllerBase {
  protected readonly dominio = DOMINIO_FUNCIONARIO;
  protected readonly nomeDoCookie = 'estoque_refresh';

  constructor(auth: AuthService, config: ConfigService<Ambiente, true>) {
    super(auth, config);
  }

  /** Limite apertado: senha é o alvo óbvio de força bruta. */
  @Publico()
  @Throttle({ padrao: { limit: 8, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  @UsePipes(new ZodPipe(esquemaEntrada))
  async entrar(
    @Body() dto: EntradaDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RespostaSessao> {
    const sessao = await this.auth.entrarFuncionario({ ...dto, ...this.metadados(req) });
    return this.responder(sessao, dto, res);
  }

  @Publico()
  @Throttle({ padrao: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  async renovar(
    @Body(new ZodPipe(esquemaRenovacao)) dto: RenovacaoDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RespostaSessao> {
    const token = this.refreshDaRequisicao(req, dto);
    const sessao = await this.auth.renovar(token, this.dominio, this.metadados(req));
    return this.responder(sessao, dto, res);
  }

  @Publico()
  @Post('logout')
  @HttpCode(204)
  async sair(
    @Body(new ZodPipe(esquemaSaida)) dto: SaidaDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    /*
      O token vem do CORPO no canal `app` e do cookie no `web`.

      Antes só o cookie era lido: no celular `token` era sempre `undefined`,
      `sair()` nunca era chamado, e a resposta 204 dizia que tudo certo. A
      sessão seguia válida os 30 dias do refresh — aparelho perdido era
      sessão viva. Sair tem de revogar de verdade.
    */
    const doCookie = (req.cookies as Record<string, string> | undefined)?.[this.nomeDoCookie];
    const token = dto.canal === 'app' ? dto.refreshToken : doCookie;

    if (token) {
      await this.auth.sair(token, this.dominio);
    }
    res.clearCookie(this.nomeDoCookie, { path: '/' });
  }

  /** Quem sou eu. O front usa para montar o menu conforme as permissões. */

  /**
   * Trocar a própria senha.
   *
   * Não é `@Publico()`: precisa de sessão. E precisa da senha atual mesmo
   * assim — sessão prova que alguém entrou, não que é o dono de novo.
   */
  @Post('senha')
  @HttpCode(204)
  @Throttle({ padrao: { limit: 5, ttl: 60_000 } })
  async trocarSenha(
    @Body(new ZodPipe(esquemaTrocaDeSenha)) dto: TrocaDeSenhaDto,
    @PrincipalAtual() principal: Principal,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.trocar(principal, dto, res);
  }

  @Get('eu')
  eu(@PrincipalAtual() principal: Principal): RespostaSessao['usuario'] {
    return {
      id: principal.id,
      nome: principal.nome,
      email: principal.email,
      dominio: principal.dominio,
      ...(principal.empresa ? { empresa: principal.empresa } : {}),
      permissoes: [...principal.permissoes],
      lojaIds: [...principal.lojaIds],
      ...(principal.suporteDe ? { suporteDe: principal.suporteDe } : {}),
    };
  }
}

// ---------------------------------------------------------------------------
// Portal do cliente — ADR-009
// ---------------------------------------------------------------------------

@Controller('portal/auth')
@ExigeDominio(DOMINIO_CLIENTE)
export class PortalAuthController extends AuthControllerBase {
  protected readonly dominio = DOMINIO_CLIENTE;
  protected readonly nomeDoCookie = 'estoque_portal_refresh';

  constructor(auth: AuthService, config: ConfigService<Ambiente, true>) {
    super(auth, config);
  }

  @Publico()
  @Throttle({ padrao: { limit: 8, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  @UsePipes(new ZodPipe(esquemaEntrada))
  async entrar(
    @Body() dto: EntradaDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RespostaSessao> {
    const sessao = await this.auth.entrarCliente({ ...dto, ...this.metadados(req) });
    return this.responder(sessao, dto, res);
  }

  @Publico()
  @Throttle({ padrao: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  async renovar(
    @Body(new ZodPipe(esquemaRenovacao)) dto: RenovacaoDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RespostaSessao> {
    const token = this.refreshDaRequisicao(req, dto);
    const sessao = await this.auth.renovar(token, this.dominio, this.metadados(req));
    return this.responder(sessao, dto, res);
  }

  @Publico()
  @Post('logout')
  @HttpCode(204)
  async sair(
    @Body(new ZodPipe(esquemaSaida)) dto: SaidaDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    /*
      O token vem do CORPO no canal `app` e do cookie no `web`.

      Antes só o cookie era lido: no celular `token` era sempre `undefined`,
      `sair()` nunca era chamado, e a resposta 204 dizia que tudo certo. A
      sessão seguia válida os 30 dias do refresh — aparelho perdido era
      sessão viva. Sair tem de revogar de verdade.
    */
    const doCookie = (req.cookies as Record<string, string> | undefined)?.[this.nomeDoCookie];
    const token = dto.canal === 'app' ? dto.refreshToken : doCookie;

    if (token) {
      await this.auth.sair(token, this.dominio);
    }
    res.clearCookie(this.nomeDoCookie, { path: '/' });
  }

  /**
   * Trocar a própria senha.
   *
   * Não é `@Publico()`: precisa de sessão. E precisa da senha atual mesmo
   * assim — sessão prova que alguém entrou, não que é o dono de novo.
   */
  @Post('senha')
  @HttpCode(204)
  @Throttle({ padrao: { limit: 5, ttl: 60_000 } })
  async trocarSenha(
    @Body(new ZodPipe(esquemaTrocaDeSenha)) dto: TrocaDeSenhaDto,
    @PrincipalAtual() principal: Principal,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.trocar(principal, dto, res);
  }

  @Get('eu')
  eu(@PrincipalAtual() principal: Principal): RespostaSessao['usuario'] {
    return {
      id: principal.id,
      nome: principal.nome,
      email: principal.email,
      dominio: principal.dominio,
      ...(principal.empresa ? { empresa: principal.empresa } : {}),
      permissoes: [...principal.permissoes],
      lojaIds: [],
    };
  }
}
