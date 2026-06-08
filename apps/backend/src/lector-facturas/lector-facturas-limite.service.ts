import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Tenant } from '../config/entities/tenant.entity';
import { PlanTipo } from '../config/enums/plan-tipo.enum';
import { ImportacionLog } from '../importaciones/entities/importacion-log.entity';
import { LectorFacturasBaseService } from './lector-facturas-base.service';

@Injectable()
export class LectorFacturasLimiteService {
  constructor(
    private readonly base: LectorFacturasBaseService,
    @InjectRepository(ImportacionLog)
    private readonly importLogRepo: Repository<ImportacionLog>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
  ) {}

  limiteMensualIA(): number {
    const raw = process.env.IA_EXTRACCIONES_LIMITE_MENSUAL;
    const n = raw != null && raw !== '' ? parseInt(raw, 10) : 50;
    return Number.isFinite(n) && n > 0 ? n : 50;
  }

  async getLimite() {
    await this.base.assertModuloLector();
    return this.verificarLimite();
  }

  async verificarLimite() {
    const tenantId = this.base.getTenantId();
    const inicioMes = new Date();
    inicioMes.setDate(1);
    inicioMes.setHours(0, 0, 0, 0);

    const [usadas, tenant] = await Promise.all([
      this.importLogRepo
        .createQueryBuilder('log')
        .where('log.tenant_id = :tenantId', { tenantId })
        .andWhere('log.origen = :origen', { origen: 'lector_factura' })
        .andWhere('log.created_at >= :inicioMes', { inicioMes })
        .getCount(),
      this.tenantRepo.findOne({
        where: { id: tenantId },
        select: { plan: true, iaIlimitadaOrigen: true },
      }),
    ]);

    if (!tenant) {
      const limite = this.limiteMensualIA();
      return { permitido: false, usadas, limite };
    }

    if (tenant.plan === PlanTipo.completo) {
      return { permitido: true, usadas, limite: null };
    }

    if (tenant.plan === PlanTipo.intermedio && tenant.iaIlimitadaOrigen === 'lector_factura') {
      return { permitido: true, usadas, limite: null };
    }

    const limite = this.limiteMensualIA();
    return { permitido: usadas < limite, usadas, limite };
  }
}
