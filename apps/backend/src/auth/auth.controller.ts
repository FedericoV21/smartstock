import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { UsersService } from '../users/users.service';
import { AuthRegisterService } from './auth-register.service';
import { AuthTokenService } from './auth-token.service';
import { AllowMissingTenant } from './decorators/allow-missing-tenant.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { Roles } from './decorators/roles.decorator';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { EmailLoginDto } from './dto/email-login.dto';
import { LocalLoginDto } from './dto/local-login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import type { AccessTokenPayload } from './interfaces/access-token-payload.interface';
import { EmailAuthService } from './email-auth.service';
import { InviteAuthService } from './invite-auth.service';
import { LocalAuthService } from './local-auth.service';
import { RefreshTokenService } from './refresh-token.service';
import { TenantContext } from './tenant-context.service';
import { resolveAppRole } from './utils/resolve-app-role';

@ApiTags('auth')
@ApiBearerAuth('access-token')
@Throttle({ default: { limit: 40, ttl: 60_000 } })
@Controller('auth')
export class AuthController {
  constructor(
    private readonly tenantContext: TenantContext,
    private readonly usersService: UsersService,
    private readonly localAuthService: LocalAuthService,
    private readonly emailAuthService: EmailAuthService,
    private readonly authRegisterService: AuthRegisterService,
    private readonly inviteAuthService: InviteAuthService,
    private readonly refreshTokenService: RefreshTokenService,
  ) {}

  @Post('register')
  @Public()
  @HttpCode(201)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Registrar negocio + admin (email/password)',
    description: 'Paridad POST /api/auth/register. Todo en PostgreSQL, sin Supabase Auth.',
  })
  register(@Body() dto: RegisterDto) {
    return this.authRegisterService.register(dto);
  }

  @Post('login')
  @Public()
  @HttpCode(200)
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Login email + password',
    description: 'Emite JWT para usuarios registrados vía POST /auth/register.',
  })
  emailLogin(@Body() dto: EmailLoginDto) {
    return this.emailAuthService.login(dto);
  }

  @Post('accept-invite')
  @Public()
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Completar invitación (token + contraseña)',
    description: 'Paridad flujo /invitacion/completar sin Supabase Auth.',
  })
  acceptInvite(@Body() dto: AcceptInviteDto) {
    return this.inviteAuthService.acceptInvite(dto);
  }

  @Post('refresh')
  @Public()
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Renovar access token con refresh token' })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.refreshTokenService.refresh(dto.refresh_token);
  }

  @Post('local-login')
  @Public()
  @HttpCode(200)
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Login local (username + PIN)',
    description:
      'Paridad POST /api/auth/local-login. Valida PIN en PostgreSQL y devuelve JWT firmado con JWT_SECRET.',
  })
  localLogin(@Body() dto: LocalLoginDto) {
    return this.localAuthService.login(dto);
  }

  @Get('me')
  @AllowMissingTenant()
  @ApiOperation({ summary: 'Authenticated user claims + perfil app (usuario)' })
  async getMe(@CurrentUser() user: AccessTokenPayload) {
    const effectiveTenantId = user.tenant_id ?? null;
    const profile =
      effectiveTenantId && typeof effectiveTenantId === 'string'
        ? await this.usersService.ensureFromJwt(user, effectiveTenantId)
        : await this.usersService.findActiveById(user.sub);

    const tenantHomeId =
      profile?.tenantId ?? user.tenant_home_id ?? effectiveTenantId;

    return {
      data: {
        sub: user.sub,
        email: user.email ?? null,
        tenantId: effectiveTenantId,
        tenantHomeId: tenantHomeId ?? null,
        tenantContextoId: profile?.tenantContextoId ?? null,
        effectiveTenantId,
        isSuperAdmin: profile?.esSuperAdmin ?? user.es_super_admin ?? false,
        appRole: resolveAppRole(user) ?? profile?.rol ?? null,
        profile: profile ? this.usersService.serializeUsuario(profile) : null,
      },
    };
  }

  @Get('tenant')
  @ApiOperation({ summary: 'Resolves tenant_id from JWT (fails if missing)' })
  getTenant() {
    return {
      data: {
        tenantId: this.tenantContext.getTenantId(),
      },
    };
  }

  @Get('admin-only')
  @Roles('admin')
  @ApiOperation({ summary: 'Example route restricted to admin (integration smoke)' })
  adminOnlyPing() {
    return { data: { ok: true } };
  }
}
