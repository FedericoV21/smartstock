import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Tenant } from '../config/entities/tenant.entity';
import { UsuarioCredencialLocal } from '../rbac/entities/usuario-credencial-local.entity';
import { Usuario } from '../users/entities/usuario.entity';
import { AuthSessionService } from './auth-session.service';
import { normalizeLocalUsername, verifyPin } from './utils/local-credentials.util';
import type { LocalLoginDto } from './dto/local-login.dto';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

@Injectable()
export class LocalAuthService {
  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(UsuarioCredencialLocal)
    private readonly credencialRepo: Repository<UsuarioCredencialLocal>,
    @InjectRepository(Usuario)
    private readonly usuarioRepo: Repository<Usuario>,
    private readonly authSessionService: AuthSessionService,
  ) {}

  async login(dto: LocalLoginDto) {
    const tenantIdInput = dto.tenantId?.trim() ?? '';
    const tenantCode = dto.tenantCode?.trim().toLowerCase() ?? '';
    const username = normalizeLocalUsername(dto.username);
    const pin = dto.pin;

    if ((!tenantIdInput && !tenantCode) || !username || !pin) {
      throw new BadRequestException('tenantCode (o tenantId), username y pin son obligatorios.');
    }

    const tenantId = tenantIdInput || (await this.resolveTenantIdByCode(tenantCode));
    if (!tenantId) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    const cred = await this.credencialRepo
      .createQueryBuilder('c')
      .where('c.tenant_id = :tenantId', { tenantId })
      .andWhere('LOWER(c.username_local) = :username', { username })
      .getOne();

    if (!cred) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    const usuario = await this.usuarioRepo.findOne({
      where: { id: cred.usuarioId, tenantId, deletedAt: IsNull() },
    });

    if (!usuario) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    if (!cred.activo || !usuario.activo) {
      throw new ForbiddenException('Usuario inactivo.');
    }

    if (cred.bloqueadoHasta && cred.bloqueadoHasta.getTime() > Date.now()) {
      throw new HttpException('Usuario temporalmente bloqueado.', 423);
    }

    const pinOk = await verifyPin(pin, cred.pinHash);
    if (!pinOk) {
      await this.registerFailedAttempt(cred);
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    await this.credencialRepo.update(
      { usuarioId: cred.usuarioId },
      {
        intentosFallidos: 0,
        bloqueadoHasta: null,
        ultimoLoginAt: new Date(),
      },
    );

    return this.authSessionService.issueSession(usuario, {
      pin_temporal: cred.pinTemporal,
      username_local: cred.usernameLocal,
    });
  }

  private async resolveTenantIdByCode(tenantCode: string): Promise<string | null> {
    if (!tenantCode) return null;

    const tenant = await this.tenantRepo
      .createQueryBuilder('t')
      .select('t.id')
      .where('LOWER(t.codigo_acceso) = :code', { code: tenantCode })
      .andWhere('t.activo = true')
      .getOne();

    return tenant?.id ?? null;
  }

  private async registerFailedAttempt(cred: UsuarioCredencialLocal) {
    const nextAttempts = (cred.intentosFallidos ?? 0) + 1;
    const shouldLock = nextAttempts >= MAX_FAILED_ATTEMPTS;

    await this.credencialRepo.update(
      { usuarioId: cred.usuarioId },
      {
        intentosFallidos: shouldLock ? 0 : nextAttempts,
        bloqueadoHasta: shouldLock
          ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000)
          : null,
      },
    );
  }
}
