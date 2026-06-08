import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { Sucursal } from '../branches/entities/sucursal.entity';
import { Tenant } from '../config/entities/tenant.entity';
import { PlanTipo } from '../config/enums/plan-tipo.enum';
import { Usuario } from '../users/entities/usuario.entity';
import { RolUsuario } from '../users/enums/rol-usuario.enum';
import type { ListNexusTenantsQueryDto } from './dto/list-nexus-tenants-query.dto';
import type { PatchNexusTenantDto } from './dto/patch-nexus-tenant.dto';
import { proximoCorteMensualIso } from './utils/proximo-corte-mensual.util';

type CreatorRow = {
  usuarioId: string;
  tenantId: string;
  email: string;
  nombre: string;
  apellido: string;
  usuarioActivo: boolean;
  usuarioCreatedAt: Date;
  negocioNombre: string;
  plan: PlanTipo;
  planCambiadoEn: Date | null;
  iaIlimitadaOrigen: string | null;
  tenantActivo: boolean;
  tenantCreatedAt: Date;
  mensualidadCorteDia: number | null;
  ginkgoMontoAbonado: string | null;
  ginkgoPorcentaje: string | null;
  ginkgoFacturacionActualizadaEn: Date | null;
};

@Injectable()
export class NexusDashboardTenantsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Usuario) private readonly usuarioRepo: Repository<Usuario>,
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(Sucursal) private readonly sucursalRepo: Repository<Sucursal>,
  ) {}

  async list(query: ListNexusTenantsQueryDto) {
    const raw = await this.usuarioRepo
      .createQueryBuilder('u')
      .innerJoin(Tenant, 't', 't.id = u.tenant_id')
      .select([
        'u.id AS "usuarioId"',
        'u.tenant_id AS "tenantId"',
        'u.email AS email',
        'u.nombre AS nombre',
        'u.apellido AS apellido',
        'u.activo AS "usuarioActivo"',
        'u.created_at AS "usuarioCreatedAt"',
        't.nombre AS "negocioNombre"',
        't.plan AS plan',
        't.plan_cambiado_en AS "planCambiadoEn"',
        't.ia_ilimitada_origen AS "iaIlimitadaOrigen"',
        't.activo AS "tenantActivo"',
        't.created_at AS "tenantCreatedAt"',
        't.mensualidad_corte_dia AS "mensualidadCorteDia"',
        't.ginkgo_monto_abonado AS "ginkgoMontoAbonado"',
        't.ginkgo_porcentaje AS "ginkgoPorcentaje"',
        't.ginkgo_facturacion_actualizada_en AS "ginkgoFacturacionActualizadaEn"',
      ])
      .where('u.rol = :rol', { rol: RolUsuario.admin })
      .andWhere('u.es_prueba = false')
      .orderBy('u.created_at', 'ASC')
      .getRawMany<CreatorRow>();

    let creators = this.dedupeTenantCreators(raw);

    if (query.soloActivos === '1') {
      creators = creators.filter((r) => r.usuarioActivo && r.tenantActivo);
    }

    if (query.cicloActivo === '1') {
      creators = creators.filter((r) => {
        const dia = r.mensualidadCorteDia;
        return dia != null && dia >= 1 && dia <= 28;
      });
    }

    if (query.plan) {
      creators = creators.filter((r) => r.plan === query.plan);
    }

    creators.sort(
      (a, b) => b.tenantCreatedAt.getTime() - a.tenantCreatedAt.getTime(),
    );

    const tenantIds = creators.map((r) => r.tenantId);
    const sucursalesPorTenant = new Map<string, number>();
    if (tenantIds.length > 0) {
      const counts = await this.sucursalRepo
        .createQueryBuilder('s')
        .select('s.tenant_id', 'tenantId')
        .addSelect('COUNT(*)', 'count')
        .where('s.tenant_id IN (:...tenantIds)', { tenantIds })
        .groupBy('s.tenant_id')
        .getRawMany<{ tenantId: string; count: string }>();
      for (const row of counts) {
        sucursalesPorTenant.set(row.tenantId, Number(row.count));
      }
    }

    const rows = creators.map((r) => {
      const dia = r.mensualidadCorteDia;
      const mensualidadProximoCorte =
        dia != null && dia >= 1 && dia <= 28 ? proximoCorteMensualIso(dia) : null;
      return {
        usuarioId: r.usuarioId,
        tenantId: r.tenantId,
        email: r.email,
        nombreCompleto: `${r.nombre} ${r.apellido}`.trim(),
        negocioNombre: r.negocioNombre,
        plan: r.plan,
        planCambiadoEn: r.planCambiadoEn?.toISOString() ?? null,
        iaIlimitadaOrigen: r.iaIlimitadaOrigen,
        sucursales: sucursalesPorTenant.get(r.tenantId) ?? 0,
        fechaUnion: r.usuarioCreatedAt.toISOString(),
        tenantCreadoEn: r.tenantCreatedAt.toISOString(),
        usuarioActivo: r.usuarioActivo,
        tenantActivo: r.tenantActivo,
        mensualidadCorteDia: dia,
        mensualidadProximoCorte,
        ginkgoMontoAbonado:
          r.ginkgoMontoAbonado != null ? Number(r.ginkgoMontoAbonado) : null,
        ginkgoPorcentaje: r.ginkgoPorcentaje != null ? Number(r.ginkgoPorcentaje) : null,
        ginkgoFacturacionActualizadaEn:
          r.ginkgoFacturacionActualizadaEn?.toISOString() ?? null,
      };
    });

    return { rows };
  }

  async patch(dto: PatchNexusTenantDto) {
    const usuario = await this.usuarioRepo.findOne({
      where: { id: dto.usuarioId },
      select: { id: true, tenantId: true, rol: true },
    });
    if (!usuario) {
      throw new NotFoundException('Usuario no encontrado.');
    }
    if (usuario.tenantId !== dto.tenantId) {
      throw new BadRequestException('El usuario no pertenece a ese negocio.');
    }
    if (usuario.rol !== RolUsuario.admin) {
      throw new BadRequestException('Solo se puede operar sobre administradores.');
    }

    const hasPlan = dto.plan !== undefined;
    const hasIa = dto.iaIlimitadaOrigen !== undefined;
    const hasUsuarioActivo = dto.usuarioActivo !== undefined;
    const hasMensualidad = dto.mensualidadCorteDia !== undefined;
    const hasGinkgoMonto = dto.ginkgoMontoAbonado !== undefined;
    const hasGinkgoPct = dto.ginkgoPorcentaje !== undefined;

    if (
      !hasPlan &&
      !hasIa &&
      !hasUsuarioActivo &&
      !hasMensualidad &&
      !hasGinkgoMonto &&
      !hasGinkgoPct
    ) {
      throw new BadRequestException('Nada que actualizar.');
    }

    if (hasPlan && dto.plan) {
      await this.dataSource.query(`SELECT public.activar_plan($1::uuid, $2::plan_tipo)`, [
        dto.tenantId,
        dto.plan,
      ]);
    }

    if (hasIa && dto.iaIlimitadaOrigen) {
      const tenant = await this.tenantRepo.findOne({
        where: { id: dto.tenantId },
        select: { id: true, plan: true },
      });
      if ((tenant?.plan ?? PlanTipo.base) !== PlanTipo.intermedio) {
        throw new BadRequestException(
          'Solo se puede configurar la IA ilimitada en plan intermedio.',
        );
      }
      await this.tenantRepo.update(
        { id: dto.tenantId },
        { iaIlimitadaOrigen: dto.iaIlimitadaOrigen as 'lector_factura' | 'ia_pdf' },
      );
    }

    if (hasUsuarioActivo) {
      await this.usuarioRepo.update(
        { id: dto.usuarioId, tenantId: dto.tenantId },
        { activo: dto.usuarioActivo },
      );
    }

    if (hasMensualidad) {
      if (dto.mensualidadCorteDia !== null) {
        if (
          typeof dto.mensualidadCorteDia !== 'number' ||
          !Number.isInteger(dto.mensualidadCorteDia) ||
          dto.mensualidadCorteDia < 1 ||
          dto.mensualidadCorteDia > 28
        ) {
          throw new BadRequestException(
            'mensualidadCorteDia debe ser null o un entero entre 1 y 28.',
          );
        }
      }
      await this.tenantRepo.update(
        { id: dto.tenantId },
        { mensualidadCorteDia: dto.mensualidadCorteDia ?? null },
      );
    }

    if (hasGinkgoMonto || hasGinkgoPct) {
      const update: {
        ginkgoFacturacionActualizadaEn: Date;
        ginkgoMontoAbonado?: string | null;
        ginkgoPorcentaje?: string | null;
      } = {
        ginkgoFacturacionActualizadaEn: new Date(),
      };
      if (hasGinkgoMonto) {
        update.ginkgoMontoAbonado =
          dto.ginkgoMontoAbonado == null ? null : String(dto.ginkgoMontoAbonado);
      }
      if (hasGinkgoPct) {
        update.ginkgoPorcentaje =
          dto.ginkgoPorcentaje == null ? null : String(dto.ginkgoPorcentaje);
      }
      await this.tenantRepo.update({ id: dto.tenantId }, update);
    }

    return { ok: true };
  }

  private dedupeTenantCreators(rows: CreatorRow[]): CreatorRow[] {
    const seen = new Set<string>();
    const out: CreatorRow[] = [];
    for (const row of rows) {
      if (seen.has(row.tenantId)) continue;
      seen.add(row.tenantId);
      out.push(row);
    }
    return out;
  }
}
