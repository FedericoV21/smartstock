import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { WhatsappBranchRule } from './entities/whatsapp-branch-rule.entity';
import { serializeBranchRule } from './utils/whatsapp-serialize.util';
import { WhatsappBaseService } from './whatsapp-base.service';

@Injectable()
export class WhatsappBranchRulesService {
  constructor(
    private readonly base: WhatsappBaseService,
    @InjectRepository(WhatsappBranchRule)
    private readonly ruleRepo: Repository<WhatsappBranchRule>,
    @InjectRepository(Sucursal)
    private readonly sucursalRepo: Repository<Sucursal>,
  ) {}

  async list(user: AccessTokenPayload) {
    await this.base.assertModuloWhatsApp();
    const tenantId = this.base.getTenantId();

    const [rules, sucursales] = await Promise.all([
      this.ruleRepo.find({
        where: { tenantId },
        relations: ['sucursal'],
        order: { prioridad: 'DESC', createdAt: 'DESC' },
      }),
      this.sucursalRepo.find({
        where: { tenantId, activa: true },
        order: { esPrincipal: 'DESC', nombre: 'ASC' },
      }),
    ]);

    return {
      rules: rules.map(serializeBranchRule),
      sucursales: sucursales.map((s) => ({
        id: s.id,
        nombre: s.nombre,
        codigo: s.codigo,
        es_principal: s.esPrincipal,
        activa: s.activa,
      })),
      can_manage: this.base.isAdminOrSuper(user),
    };
  }

  async create(user: AccessTokenPayload, body: Record<string, unknown>) {
    await this.base.assertModuloWhatsApp();
    this.base.assertNotVisor(user);
    this.base.assertAdminOrSuper(user);

    const tenantId = this.base.getTenantId();
    const sucursalId = String(body.sucursal_id ?? '').trim();
    if (!sucursalId) {
      throw new BadRequestException('sucursal_id es obligatorio');
    }

    const fromWaIdRaw = String(body.from_wa_id ?? '').trim();
    const fromWaId = fromWaIdRaw.length > 0 ? fromWaIdRaw : null;
    const prioridad = Number(body.prioridad ?? 0);
    const activa = body.activa !== false;

    const sucursal = await this.sucursalRepo.findOne({
      where: { id: sucursalId, tenantId, activa: true },
    });
    if (!sucursal) {
      throw new BadRequestException('Sucursal no encontrada o inactiva');
    }

    const saved = await this.ruleRepo.save({
      tenantId,
      sucursalId,
      fromWaId,
      phoneNumberId: null,
      proveedorId: null,
      prioridad: Number.isFinite(prioridad) ? Math.trunc(prioridad) : 0,
      activa,
    });

    return { ok: true, id: saved.id };
  }

  async remove(user: AccessTokenPayload, id: string) {
    await this.base.assertModuloWhatsApp();
    this.base.assertNotVisor(user);
    this.base.assertAdminOrSuper(user);

    const tenantId = this.base.getTenantId();
    const ruleId = id?.trim();
    if (!ruleId) {
      throw new BadRequestException('id es obligatorio');
    }

    const result = await this.ruleRepo.delete({ id: ruleId, tenantId });
    if (!result.affected) {
      throw new NotFoundException('Regla no encontrada');
    }

    return { ok: true };
  }
}
