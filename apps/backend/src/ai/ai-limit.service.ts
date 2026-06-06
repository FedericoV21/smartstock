import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { PlanTipo } from '../config/enums/plan-tipo.enum';
import { Tenant } from '../config/entities/tenant.entity';
import { ImportacionLog } from '../importaciones/entities/importacion-log.entity';

export type OrigenIA = 'ia_pdf' | 'lector_factura';
export type OrigenIACheck = OrigenIA | 'all';

@Injectable()
export class AiLimitService {
  constructor(
    @InjectRepository(ImportacionLog)
    private readonly importLogRepo: Repository<ImportacionLog>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(ModuloConfig)
    private readonly moduloConfigRepo: Repository<ModuloConfig>,
    private readonly tenantContext: TenantContext,
  ) {}

  limiteMensualIA(): number {
    const raw = process.env.IA_EXTRACCIONES_LIMITE_MENSUAL;
    const n = raw != null && raw !== '' ? parseInt(raw, 10) : 4;
    return Number.isFinite(n) && n > 0 ? n : 4;
  }

  async getLimit(origen: OrigenIACheck = 'all') {
    await this.assertIaPreciosModule();

    const tenantId = this.tenantContext.getTenantId();
    const inicioMes = new Date();
    inicioMes.setDate(1);
    inicioMes.setHours(0, 0, 0, 0);

    const origenes: OrigenIA[] =
      origen === 'all' ? ['ia_pdf', 'lector_factura'] : [origen];

    const [usadas, tenant] = await Promise.all([
      this.importLogRepo
        .createQueryBuilder('log')
        .where('log.tenant_id = :tenantId', { tenantId })
        .andWhere('log.origen IN (:...origenes)', { origenes })
        .andWhere('log.created_at >= :inicioMes', { inicioMes })
        .getCount(),
      this.tenantRepo.findOne({
        where: { id: tenantId },
        select: { plan: true, iaIlimitadaOrigen: true },
      }),
    ]);

    if (!tenant) {
      return { data: { permitido: false, usadas, limite: this.limiteMensualIA() } };
    }

    if (tenant.plan === PlanTipo.completo) {
      return { data: { permitido: true, usadas, limite: null } };
    }

    if (
      tenant.plan === PlanTipo.intermedio &&
      origen !== 'all' &&
      tenant.iaIlimitadaOrigen &&
      tenant.iaIlimitadaOrigen === origen
    ) {
      return { data: { permitido: true, usadas, limite: null } };
    }

    const limite = this.limiteMensualIA();
    return { data: { permitido: usadas < limite, usadas, limite } };
  }

  async verificarLimiteIA(origen: OrigenIACheck = 'all') {
    const result = await this.getLimit(origen);
    return result.data;
  }

  private async assertIaPreciosModule(): Promise<void> {
    const tenantId = this.tenantContext.getTenantId();
    const modulos = await this.moduloConfigRepo.findOne({ where: { tenantId } });
    if (!modulos) {
      throw new ForbiddenException('Configuraci├│n de m├│dulos no encontrada');
    }
    if (!modulos.iaPrecios) {
      throw new ForbiddenException('M├│dulo ia_precios no habilitado');
    }
  }
}
