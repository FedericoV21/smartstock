import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { PlanTipo } from './enums/plan-tipo.enum';
import { ModuloConfig } from './entities/modulo-config.entity';
import { Tenant } from './entities/tenant.entity';

@Injectable()
export class PlanService {
  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(ModuloConfig)
    private readonly moduloRepo: Repository<ModuloConfig>,
    private readonly tenantContext: TenantContext,
  ) {}

  async getPlan() {
    const tenantId = this.tenantContext.getTenantId();
    const [tenant, modulos] = await Promise.all([
      this.tenantRepo.findOne({ where: { id: tenantId } }),
      this.moduloRepo.findOne({ where: { tenantId } }),
    ]);
    if (!tenant) {
      throw new NotFoundException('Negocio no encontrado');
    }
    return {
      plan: tenant.plan ?? PlanTipo.base,
      modulos: modulos
        ? {
            stock: modulos.stock,
            importador_excel: modulos.importadorExcel,
            facturador_simple: modulos.facturadorSimple,
            facturador_arca: modulos.facturadorArca,
            pedidos: modulos.pedidos,
            presupuestos: modulos.presupuestos,
            ia_precios: modulos.iaPrecios,
          }
        : null,
    };
  }

  async activatePlan(plan: PlanTipo.base | PlanTipo.completo) {
    const tenantId = this.tenantContext.getTenantId();
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) {
      throw new NotFoundException('Negocio no encontrado');
    }

    const modulos = await this.moduloRepo.findOne({ where: { tenantId } });
    if (!modulos) {
      throw new NotFoundException('Configuración de módulos no encontrada');
    }

    tenant.plan = plan;
    tenant.iaIlimitadaOrigen = null;

    this.applyModulosForPlan(modulos, plan);
    await this.tenantRepo.save(tenant);
    await this.moduloRepo.save(modulos);

    return { success: true, plan };
  }

  async getIaIlimitada() {
    const tenantId = this.tenantContext.getTenantId();
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) {
      throw new NotFoundException('Negocio no encontrado');
    }
    return {
      plan: tenant.plan ?? PlanTipo.base,
      ia_ilimitada_origen: tenant.iaIlimitadaOrigen ?? null,
    };
  }

  async setIaIlimitada(origen: 'lector_factura' | 'ia_pdf') {
    const tenantId = this.tenantContext.getTenantId();
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) {
      throw new NotFoundException('Negocio no encontrado');
    }
    if (tenant.plan !== PlanTipo.intermedio) {
      throw new BadRequestException(
        'La IA ilimitada a elección solo está disponible en el plan intermedio.',
      );
    }
    tenant.iaIlimitadaOrigen = origen;
    await this.tenantRepo.save(tenant);
    return { success: true, ia_ilimitada_origen: origen };
  }

  private applyModulosForPlan(modulos: ModuloConfig, plan: PlanTipo.base | PlanTipo.completo) {
    if (plan === PlanTipo.completo) {
      modulos.facturadorSimple = true;
      modulos.facturadorArca = true;
      modulos.facturadorPos = true;
      modulos.pedidos = true;
      modulos.presupuestos = true;
      modulos.iaPrecios = true;
      modulos.analizadorRentabilidad = true;
      return;
    }

    modulos.facturadorSimple = true;
    modulos.facturadorArca = true;
    modulos.facturadorPos = true;
    modulos.pedidos = true;
    modulos.presupuestos = false;
    modulos.iaPrecios = false;
    modulos.analizadorRentabilidad = false;
  }
}
