import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';

import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { TenantContext } from '../auth/tenant-context.service';
import { resolveAppRole } from '../auth/utils/resolve-app-role';
import { Usuario } from '../users/entities/usuario.entity';
import { CajaGasto } from './entities/caja-gasto.entity';
import { CajaApertura } from './entities/caja-apertura.entity';
import { CajaUsuario } from './entities/caja-usuario.entity';
import { Caja } from './entities/caja.entity';
import { CierreZ } from './entities/cierre-z.entity';
import {
  cajaUuidComoCajaIdText,
  fechaYmdArgentina,
  normalizarCaja,
  redondear2,
} from './utils/caja-id.util';
import {
  formatGastosDetalle,
  fusionarGastosCierre,
  MAX_GASTOS_POR_SESION,
  serializeGastoRow,
  sumarGastosRows,
  type GastoCierreItem,
} from './utils/caja-gastos.util';
import { aperturaEstaCerrada, serializeAperturaVigente } from './utils/sesion-caja.util';

export type CajaGastosContexto = {
  cajaIdText: string;
  sucursalId: string;
  aperturaId: string;
};

@Injectable()
export class CajaGastosService {
  constructor(
    @InjectRepository(CajaGasto)
    private readonly gastoRepo: Repository<CajaGasto>,
    @InjectRepository(Caja)
    private readonly cajaRepo: Repository<Caja>,
    @InjectRepository(CajaUsuario)
    private readonly cajaUsuarioRepo: Repository<CajaUsuario>,
    @InjectRepository(CajaApertura)
    private readonly aperturaRepo: Repository<CajaApertura>,
    @InjectRepository(CierreZ)
    private readonly cierreRepo: Repository<CierreZ>,
    @InjectRepository(Usuario)
    private readonly usuarioRepo: Repository<Usuario>,
    @InjectRepository(ModuloConfig)
    private readonly moduloRepo: Repository<ModuloConfig>,
    private readonly tenantContext: TenantContext,
  ) {}

  private async assertFacturadorPos(): Promise<void> {
    const tenantId = this.tenantContext.getTenantId();
    const mod = await this.moduloRepo.findOne({ where: { tenantId } });
    if (!mod?.facturadorPos) {
      throw new ForbiddenException('El módulo POS no está habilitado para este negocio.');
    }
  }

  async resolverGastosParaCierreDiario(
    sesionAperturaId: string | null,
    bodyItemsRaw: unknown,
  ): Promise<
    | { ok: true; total: number; itemsGuardados: GastoCierreItem[] | null; detalle: string | null }
    | { ok: false; error: string }
  > {
    if (!sesionAperturaId) {
      const extras = fusionarGastosCierre([], bodyItemsRaw);
      if (!extras.ok) return extras;
      return {
        ok: true,
        total: extras.total,
        itemsGuardados: extras.items.length > 0 ? extras.items : null,
        detalle: formatGastosDetalle(extras.items),
      };
    }

    const dbGastos = await this.listarGastosSesionVigentes(sesionAperturaId);
    const fusion = fusionarGastosCierre(dbGastos, bodyItemsRaw);
    if (!fusion.ok) return fusion;

    return {
      ok: true,
      total: fusion.total,
      itemsGuardados: fusion.items.length > 0 ? fusion.items : null,
      detalle: formatGastosDetalle(fusion.items),
    };
  }

  async listarGastosSesionVigentes(aperturaId: string) {
    const rows = await this.gastoRepo.find({
      where: {
        cajaAperturaId: aperturaId,
        anuladoAt: IsNull(),
        cierreZId: IsNull(),
      },
      order: { createdAt: 'ASC' },
    });

    const usuarioIds = [...new Set(rows.map((r) => r.usuarioId).filter(Boolean))] as string[];
    const usuarios =
      usuarioIds.length > 0
        ? await this.usuarioRepo.find({ where: { id: In(usuarioIds) } })
        : [];
    const nombreMap = new Map(usuarios.map((u) => [u.id, u.nombre]));

    return rows.map((r) =>
      serializeGastoRow({
        id: r.id,
        concepto: r.concepto,
        monto: r.monto,
        createdAt: r.createdAt,
        usuarioId: r.usuarioId,
        usuarioNombre: r.usuarioId ? (nombreMap.get(r.usuarioId) ?? null) : null,
      }),
    );
  }

  async sumarGastosSesion(aperturaId: string): Promise<number> {
    const rows = await this.listarGastosSesionVigentes(aperturaId);
    return sumarGastosRows(rows);
  }

  async marcarGastosIncluidosEnCierre(aperturaId: string, cierreZId: string): Promise<void> {
    await this.gastoRepo.update(
      {
        cajaAperturaId: aperturaId,
        anuladoAt: IsNull(),
        cierreZId: IsNull(),
      },
      { cierreZId },
    );
  }

  async resolverContextoGastos(
    user: AccessTokenPayload,
    cajaIdRaw: string,
  ): Promise<CajaGastosContexto> {
    const tenantId = this.tenantContext.getTenantId();
    const userId = user.sub;
    const role = resolveAppRole(user);

    const cajaUuid = cajaIdRaw.trim();
    if (!cajaUuid) {
      throw new BadRequestException('caja_id es obligatorio.');
    }

    const caja = await this.cajaRepo.findOne({ where: { id: cajaUuid, tenantId } });
    if (!caja || !caja.activa) {
      throw new NotFoundException('Caja no encontrada o inactiva.');
    }

    if (!(await this.usuarioPuedeOperarCaja(userId, tenantId, role, caja))) {
      throw new ForbiddenException('No tenés permiso para operar esta caja.');
    }

    const cajaIdText = normalizarCaja(cajaUuidComoCajaIdText(caja.id));
    const sucursalId = caja.sucursalId?.trim();
    if (!sucursalId) {
      throw new BadRequestException('La caja no tiene sucursal asignada.');
    }

    const ap = await this.obtenerAperturaVigente(tenantId, cajaIdText, sucursalId);
    if (!ap) {
      throw new BadRequestException(
        'No hay sesión de caja abierta. Abrí la caja antes de registrar gastos.',
      );
    }

    return { cajaIdText, sucursalId, aperturaId: ap.id };
  }

  async listGastos(user: AccessTokenPayload, cajaId: string, sucursalIdParam?: string) {
    await this.assertFacturadorPos();
    const ctx = await this.resolverContextoGastos(user, cajaId);

    if (sucursalIdParam?.trim() && sucursalIdParam.trim() !== ctx.sucursalId) {
      throw new ForbiddenException('La caja no pertenece a la sucursal operativa.');
    }

    const items = await this.listarGastosSesionVigentes(ctx.aperturaId);
    const total = sumarGastosRows(items);

    return {
      items,
      total,
      caja_apertura_id: ctx.aperturaId,
    };
  }

  async createGasto(
    user: AccessTokenPayload,
    cajaId: string,
    conceptoRaw: string,
    montoRaw: number,
  ) {
    await this.assertFacturadorPos();
    const role = resolveAppRole(user);
    if (role === 'visor') {
      throw new ForbiddenException('Los usuarios visor no pueden registrar gastos.');
    }

    const concepto = conceptoRaw.trim();
    if (!concepto) {
      throw new BadRequestException('Indicá de qué es el gasto (concepto).');
    }
    if (!Number.isFinite(montoRaw) || montoRaw <= 0) {
      throw new BadRequestException('El monto debe ser un número mayor a 0.');
    }

    const ctx = await this.resolverContextoGastos(user, cajaId);
    const tenantId = this.tenantContext.getTenantId();
    const userId = user.sub;

    const count = await this.gastoRepo.count({
      where: {
        cajaAperturaId: ctx.aperturaId,
        anuladoAt: IsNull(),
        cierreZId: IsNull(),
      },
    });
    if (count >= MAX_GASTOS_POR_SESION) {
      throw new BadRequestException('Máximo 25 gastos por sesión de caja.');
    }

    const monto = redondear2(montoRaw);
    const saved = await this.gastoRepo.save(
      this.gastoRepo.create({
        tenantId,
        sucursalId: ctx.sucursalId,
        cajaId: ctx.cajaIdText,
        cajaAperturaId: ctx.aperturaId,
        concepto: concepto.slice(0, 200),
        monto: String(monto),
        usuarioId: userId,
      }),
    );

    const total = await this.sumarGastosSesion(ctx.aperturaId);

    return {
      item: {
        id: saved.id,
        concepto: saved.concepto,
        monto,
        created_at: saved.createdAt.toISOString(),
        usuario_id: saved.usuarioId,
      },
      total,
    };
  }

  async anularGasto(user: AccessTokenPayload, gastoId: string) {
    await this.assertFacturadorPos();
    const role = resolveAppRole(user);
    if (role === 'visor') {
      throw new ForbiddenException('Los usuarios visor no pueden anular gastos.');
    }

    const tenantId = this.tenantContext.getTenantId();
    const userId = user.sub;
    const id = gastoId.trim();
    if (!id) {
      throw new BadRequestException('ID de gasto inválido.');
    }

    const gasto = await this.gastoRepo.findOne({ where: { id, tenantId } });
    if (!gasto) {
      throw new NotFoundException('Gasto no encontrado.');
    }
    if (gasto.anuladoAt) {
      throw new ConflictException('El gasto ya fue anulado.');
    }
    if (gasto.cierreZId) {
      throw new ConflictException('No se puede anular un gasto ya incluido en un cierre.');
    }

    const result = await this.gastoRepo.update(
      {
        id,
        tenantId,
        anuladoAt: IsNull(),
        cierreZId: IsNull(),
      },
      { anuladoAt: new Date(), anuladoPor: userId },
    );
    if (!result.affected) {
      throw new ConflictException('No se pudo anular el gasto.');
    }

    const total = await this.sumarGastosSesion(gasto.cajaAperturaId);
    return { ok: true, total };
  }

  private async obtenerAperturaVigente(
    tenantId: string,
    cajaIdNormalizada: string,
    sucursalId: string,
  ) {
    const ap = await this.aperturaRepo.findOne({
      where: { tenantId, sucursalId, cajaId: cajaIdNormalizada },
      order: { openedAt: 'DESC' },
    });
    if (!ap) return null;

    const cierres = await this.cierreRepo.find({
      where: { tenantId, sucursalId, cajaId: cajaIdNormalizada, tipoCierre: 'diario' },
      order: { createdAt: 'DESC' },
      take: 600,
      select: ['id', 'cajaAperturaId', 'payloadResumen', 'rangoDesde'],
    });

    if (
      aperturaEstaCerrada(
        ap.id,
        ap.openedAt.toISOString(),
        cierres.map((r) => ({
          id: r.id,
          caja_apertura_id: r.cajaAperturaId,
          payload_resumen: r.payloadResumen,
          rango_desde: r.rangoDesde?.toISOString?.() ?? String(r.rangoDesde),
        })),
      )
    ) {
      return null;
    }

    const row = serializeAperturaVigente(ap);
    row.fecha_operativa = fechaYmdArgentina(ap.openedAt);
    return row;
  }

  private async usuarioPuedeOperarCaja(
    userId: string,
    tenantId: string,
    role: string | undefined,
    caja: Caja,
  ): Promise<boolean> {
    if (caja.usuarioDefaultId === userId) return true;

    const row = await this.cajaUsuarioRepo.findOne({
      where: { cajaId: caja.id, usuarioId: userId },
    });
    if (row) return true;

    const count = await this.cajaUsuarioRepo.count({ where: { cajaId: caja.id } });
    return count === 0;
  }
}
