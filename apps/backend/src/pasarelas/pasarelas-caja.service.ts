import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { resolveAppRole } from '../auth/utils/resolve-app-role';
import { TenantContext } from '../auth/tenant-context.service';
import { Caja } from '../caja/entities/caja.entity';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { UsersService } from '../users/users.service';
import { PasarelaCaja } from './entities/pasarela-caja.entity';
import { PasarelaIntegracion } from './entities/pasarela-integracion.entity';
import { PatchCajaPasarelasDto } from './dto/pasarela-caja.dto';
import { serializeIntegracion } from './utils/pasarela-secrets.util';

@Injectable()
export class PasarelasCajaService {
  constructor(
    @InjectRepository(Caja)
    private readonly cajaRepo: Repository<Caja>,
    @InjectRepository(PasarelaCaja)
    private readonly pasarelaCajaRepo: Repository<PasarelaCaja>,
    @InjectRepository(PasarelaIntegracion)
    private readonly integracionRepo: Repository<PasarelaIntegracion>,
    @InjectRepository(ModuloConfig)
    private readonly moduloConfigRepo: Repository<ModuloConfig>,
    private readonly tenantContext: TenantContext,
    private readonly usersService: UsersService,
  ) {}

  async listForCaja(user: AccessTokenPayload, cajaId: string, soloHabilitadas: boolean) {
    await this.assertFacturadorPos();
    const { caja, operables } = await this.resolveCaja(user, cajaId);

    const links = await this.pasarelaCajaRepo.find({
      where: { tenantId: caja.tenantId, cajaId },
      order: { orden: 'ASC' },
    });
    if (!links.length) return { pasarelas: [] };

    const ids = [...new Set(links.map((l) => l.integracionId))];
    const integraciones = await this.integracionRepo.find({
      where: { tenantId: caja.tenantId, id: In(ids) },
    });
    const byId = new Map(integraciones.map((i) => [i.id, i]));

    const pasarelas = links
      .map((link) => {
        const integracion = byId.get(link.integracionId);
        if (!integracion || integracion.sucursalId !== caja.sucursalId) return null;
        if (soloHabilitadas && (!link.habilitado || integracion.estado !== 'activa')) return null;
        const clean = serializeIntegracion(integracion);
        const alias = link.alias?.trim() || null;
        return {
          ...clean,
          pasarela_caja_id: link.id,
          habilitado: link.habilitado,
          alias,
          orden: link.orden,
          nombre_integracion: clean.nombre,
          nombre: alias ?? clean.nombre,
        };
      })
      .filter(Boolean);

    void operables;
    return { pasarelas };
  }

  async patchForCaja(user: AccessTokenPayload, cajaId: string, dto: PatchCajaPasarelasDto) {
    await this.assertFacturadorPos();
    if (resolveAppRole(user) !== 'admin') {
      throw new ForbiddenException('Sin permisos para editar cajas.');
    }
    const { caja } = await this.resolveCaja(user, cajaId);
    const tenantId = caja.tenantId;

    const integracionIds = [
      ...new Set(dto.pasarelas.map((r) => r.integracion_id.trim()).filter(Boolean)),
    ];
    if (integracionIds.length !== dto.pasarelas.length) {
      throw new BadRequestException('Cada fila necesita integracion_id unico');
    }

    const integraciones = await this.integracionRepo.find({
      where: { tenantId, id: In(integracionIds) },
    });
    const found = new Map(integraciones.map((i) => [i.id, i]));
    for (const id of integracionIds) {
      const integracion = found.get(id);
      if (!integracion) throw new NotFoundException('Integracion no encontrada');
      if (integracion.sucursalId !== caja.sucursalId) {
        throw new BadRequestException('La integracion debe pertenecer a la misma sucursal que la caja.');
      }
    }

    for (const [idx, row] of dto.pasarelas.entries()) {
      const alias = typeof row.alias === 'string' ? row.alias.trim().slice(0, 120) || null : null;
      const orden =
        typeof row.orden === 'number' && Number.isInteger(row.orden) && row.orden >= 0 && row.orden <= 10000
          ? row.orden
          : idx * 10;
      await this.pasarelaCajaRepo.upsert(
        {
          tenantId,
          cajaId,
          integracionId: row.integracion_id.trim(),
          habilitado: row.habilitado !== false,
          alias,
          orden,
        } as Parameters<Repository<PasarelaCaja>['upsert']>[0],
        ['cajaId', 'integracionId'],
      );
    }

    return { ok: true };
  }

  private async resolveCaja(user: AccessTokenPayload, cajaId: string) {
    const tenantId = this.tenantContext.getTenantId();
    const caja = await this.cajaRepo.findOne({ where: { id: cajaId } });
    if (!caja || caja.tenantId !== tenantId) {
      throw new NotFoundException('Caja no encontrada');
    }

    const role = resolveAppRole(user);
    const operables = await this.usersService.listOperableSucursalIds(user.sub, tenantId, role);
    if (!operables.includes(caja.sucursalId)) {
      throw new ForbiddenException('No podes operar esta caja.');
    }

    return { caja, operables };
  }

  private async assertFacturadorPos() {
    const tenantId = this.tenantContext.getTenantId();
    const mod = await this.moduloConfigRepo.findOne({ where: { tenantId } });
    if (!mod?.facturadorPos) {
      throw new ForbiddenException("El módulo 'facturador_pos' no está habilitado para tu plan.");
    }
  }
}
