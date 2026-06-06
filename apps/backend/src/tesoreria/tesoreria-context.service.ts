import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { Tenant } from '../config/entities/tenant.entity';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { CajaTesoreria } from './entities/caja-tesoreria.entity';
import {
  effectiveBusinessPrefs,
  resolveCajaTesoreriaFilter,
} from './utils/business-prefs-tesoreria.util';

export type TesoreriaResolvedContext = {
  tenantId: string;
  sucursalId: string | null;
  cajaTesoreriaId: string;
  saldoEfectivo: number;
  alcance: 'tenant' | 'sucursal';
};

@Injectable()
export class TesoreriaContextService {
  constructor(
    @InjectRepository(CajaTesoreria)
    private readonly cajaRepo: Repository<CajaTesoreria>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(Sucursal)
    private readonly sucursalRepo: Repository<Sucursal>,
    @InjectRepository(ModuloConfig)
    private readonly moduloRepo: Repository<ModuloConfig>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly tenantContext: TenantContext,
  ) {}

  async resolve(sucursalIdParam?: string | null): Promise<TesoreriaResolvedContext> {
    await this.assertFacturadorSimple();
    const tenantId = this.tenantContext.getTenantId();

    const tenant = await this.tenantRepo.findOne({
      where: { id: tenantId },
      select: { id: true, businessPrefs: true },
    });
    if (!tenant) throw new NotFoundException('Tenant no encontrado');

    let sucursalPrefs: unknown = null;
    const sucursalId = sucursalIdParam?.trim() || null;
    if (sucursalId) {
      const suc = await this.sucursalRepo.findOne({
        where: { id: sucursalId, tenantId },
        select: { businessPrefs: true },
      });
      if (!suc) throw new NotFoundException('Sucursal no encontrada');
      sucursalPrefs = suc.businessPrefs;
    }

    const prefs = effectiveBusinessPrefs(tenant.businessPrefs, sucursalPrefs);
    if (!prefs.cajaInterna.habilitado) {
      throw new ForbiddenException('La caja interna no est├í habilitada.');
    }

    let filter: { sucursalId: null } | { sucursalId: string };
    try {
      filter = resolveCajaTesoreriaFilter(
        prefs.cajaInterna.alcance,
        prefs.cajaInterna.alcance === 'sucursal' ? sucursalId : null,
      );
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }

    let caja = await this.findCajaActiva(tenantId, filter.sucursalId);
    if (!caja) {
      await this.dataSource.query(
        `SELECT public.provisionar_cajas_tesoreria($1::uuid, $2::text)`,
        [tenantId, prefs.cajaInterna.alcance],
      );
      caja = await this.findCajaActiva(tenantId, filter.sucursalId);
    }
    if (!caja) {
      throw new NotFoundException('Caja de tesorer├¡a no encontrada.');
    }

    const saldoRows = (await this.dataSource.query(
      `SELECT public.saldo_efectivo_caja_tesoreria($1::uuid) AS saldo`,
      [caja.id],
    )) as Array<{ saldo: string }>;
    const saldoEfectivo = Number(saldoRows[0]?.saldo ?? 0);

    return {
      tenantId,
      sucursalId,
      cajaTesoreriaId: caja.id,
      saldoEfectivo: Number.isFinite(saldoEfectivo) ? saldoEfectivo : 0,
      alcance: prefs.cajaInterna.alcance,
    };
  }

  private async findCajaActiva(tenantId: string, sucursalId: string | null) {
    return this.cajaRepo.findOne({
      where: {
        tenantId,
        activa: true,
        sucursalId: sucursalId === null ? IsNull() : sucursalId,
      },
    });
  }

  private async assertFacturadorSimple(): Promise<void> {
    const modulos = await this.moduloRepo.findOne({ where: { tenantId: this.tenantContext.getTenantId() } });
    if (!modulos?.facturadorSimple) {
      throw new ForbiddenException('El m├│dulo facturador_simple no est├í habilitado.');
    }
  }
}
