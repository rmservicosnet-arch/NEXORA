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
import { esquemaEntrada, esquemaRenovacao, type EntradaDto, type RenovacaoDto } from './auth.dto';
import { DOMINIO_CLIENTE, DOMINIO_FUNCIONARIO, type Dominio, type Principal } from './dominios';

interface RespostaSessao {
  readonly tokenAcesso: string;
  readonly tokenRefresh?: string;
  readonly usuario: {
    readonly id: string;
    readonly nome: string;
    readonly email: string;
    readonly dominio: Dominio;
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

  protected responder(sessao: Sessao, dto: { canal: string }, res: Response): RespostaSessao {
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
        permissoes: [...sessao.principal.permissoes],
        lojaIds: [...sessao.principal.lojaIds],
      },
    };

    if (dto.canal === 'web') {
      res.cookie(this.nomeDoCookie, sessao.tokenRefresh, {
        httpOnly: true,
        sameSite: 'strict',
        secure: this.config.get('COOKIE_SECURE', { infer: true }),
        domain: this.config.get('COOKIE_DOMAIN', { infer: true }),
        path: '/',
        maxAge: this.config.get('REFRESH_TOKEN_TTL_DIAS', { infer: true }) * 86_400_000,
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
  async sair(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const token = (req.cookies as Record<string, string> | undefined)?.[this.nomeDoCookie];
    if (token) {
      await this.auth.sair(token, this.dominio);
    }
    res.clearCookie(this.nomeDoCookie, { path: '/' });
  }

  /** Quem sou eu. O front usa para montar o menu conforme as permissões. */
  @Get('eu')
  eu(@PrincipalAtual() principal: Principal): RespostaSessao['usuario'] {
    return {
      id: principal.id,
      nome: principal.nome,
      email: principal.email,
      dominio: principal.dominio,
      permissoes: [...principal.permissoes],
      lojaIds: [...principal.lojaIds],
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
  async sair(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const token = (req.cookies as Record<string, string> | undefined)?.[this.nomeDoCookie];
    if (token) {
      await this.auth.sair(token, this.dominio);
    }
    res.clearCookie(this.nomeDoCookie, { path: '/' });
  }

  @Get('eu')
  eu(@PrincipalAtual() principal: Principal): RespostaSessao['usuario'] {
    return {
      id: principal.id,
      nome: principal.nome,
      email: principal.email,
      dominio: principal.dominio,
      permissoes: [...principal.permissoes],
      lojaIds: [],
    };
  }
}
