import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { createHash } from 'node:crypto';
import { Repository } from 'typeorm';

import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { Usuario } from '../users/entities/usuario.entity';
import { ApiIntegracionKey } from './entities/api-integracion-key.entity';

export type ApiKeyScope =
  | 'lector_facturas:jobs:create'
  | 'lector_facturas:jobs:read'
  | 'lector_facturas:jobs:confirm';

export type ApiIntegrationAuthContext = {
  key: ApiIntegracionKey;
  tenantId: string;
  sucursalId: string | null;
  userId: string;
};

const keyHits = new Map<string, number[]>();

@Injectable()
export class ApiIntegracionAuthService {
  constructor(
    @InjectRepository(ApiIntegracionKey)
    private readonly keyRepo: Repository<ApiIntegracionKey>,
    @InjectRepository(ModuloConfig)
    private readonly moduloRepo: Repository<ModuloConfig>,
    @InjectRepository(Sucursal)
    private readonly sucursalRepo: Repository<Sucursal>,
    @InjectRepository(Usuario)
    private readonly usuarioRepo: Repository<Usuario>,
  ) {}

  hashApiIntegrationKey(token: string): string {
    return createHash('sha256').update(token.trim()).digest('hex');
  }

  private readToken(req: Request): string | null {
    const auth = req.headers.authorization?.trim() ?? '';
    const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    if (bearer) return bearer;
    const header = req.headers['x-api-key'];
    if (typeof header === 'string' && header.trim()) return header.trim();
    return null;
  }

  private hasScope(scopes: string[] | null | undefined, scope: ApiKeyScope): boolean {
    const set = new Set(scopes ?? []);
    if (set.has('*') || set.has('lector_facturas:*') || set.has(scope)) return true;
    return scope === 'lector_facturas:jobs:read' && set.has('lector_facturas:read');
  }

  private rateLimitOk(keyId: string, limitPerMinute: number): boolean {
    const now = Date.now();
    const windowStart = now - 60_000;
    const existing = (keyHits.get(keyId) ?? []).filter((ts) => ts >= windowStart);
    if (existing.length >= limitPerMinute) {
      keyHits.set(keyId, existing);
      return false;
    }
    existing.push(now);
    keyHits.set(keyId, existing);
    return true;
  }

  async authenticate(params: {
    request: Request;
    scope: ApiKeyScope;
    requestedSucursalId?: string | null;
    consumeRateLimit?: boolean;
  }): Promise<ApiIntegrationAuthContext> {
    const token = this.readToken(params.request);
    if (!token) throw new UnauthorizedException('API key requerida');

    const keyHash = this.hashApiIntegrationKey(token);
    const key = await this.keyRepo.findOne({ where: { keyHash } });
    if (!key?.id) throw new UnauthorizedException('API key invalida');
    if (key.estado !== 'activa') throw new ForbiddenException('API key no activa');
    if (!this.hasScope(key.scopes, params.scope)) {
      throw new ForbiddenException('Scope insuficiente');
    }

    const mod = await this.moduloRepo.findOne({ where: { tenantId: key.tenantId } });
    if (!mod?.lectorFacturas && !mod?.facturadorSimple) {
      throw new ForbiddenException(
        'El modulo lector de facturas no esta habilitado para este tenant.',
      );
    }

    if (params.consumeRateLimit !== false) {
      const limit = Math.max(1, Number(key.rateLimitPorMinuto ?? 10));
      if (!this.rateLimitOk(key.id, limit)) {
        throw new HttpException('Rate limit de API key excedido', HttpStatus.TOO_MANY_REQUESTS);
      }
    }

    const sucursalId = await this.resolveSucursalId(key, params.requestedSucursalId);
    const userId = key.usuarioId ?? (await this.pickAutomationUserId(key.tenantId));
    if (!userId) {
      throw new HttpException(
        'No hay usuario admin/operador para auditar la operacion.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    await this.keyRepo.update({ id: key.id }, { lastUsedAt: new Date() });

    return { key, tenantId: key.tenantId, sucursalId, userId };
  }

  private async resolveSucursalId(
    key: ApiIntegracionKey,
    requested?: string | null,
  ): Promise<string | null> {
    const req = requested?.trim() || null;
    if (key.sucursalId && req && req !== key.sucursalId) {
      throw new ForbiddenException('La API key no tiene permiso para esa sucursal.');
    }
    const sucursalId = req ?? key.sucursalId ?? (await this.principalOrFirstActiveSucursalId(key.tenantId));
    if (!sucursalId) return null;

    const row = await this.sucursalRepo.findOne({
      where: { id: sucursalId, tenantId: key.tenantId, activa: true },
    });
    if (!row) throw new HttpException('Sucursal no encontrada o inactiva.', HttpStatus.NOT_FOUND);
    return row.id;
  }

  private async principalOrFirstActiveSucursalId(tenantId: string): Promise<string | null> {
    const rows = await this.sucursalRepo.find({
      where: { tenantId, activa: true },
      order: { esPrincipal: 'DESC', createdAt: 'ASC' },
      take: 1,
    });
    return rows[0]?.id ?? null;
  }

  private async pickAutomationUserId(tenantId: string): Promise<string | null> {
    const row = await this.usuarioRepo
      .createQueryBuilder('u')
      .where('u.tenant_id = :tenantId', { tenantId })
      .andWhere('u.activo = true')
      .andWhere("u.rol IN ('admin', 'operador')")
      .orderBy('u.created_at', 'ASC')
      .getOne();
    return row?.id ?? null;
  }
}
