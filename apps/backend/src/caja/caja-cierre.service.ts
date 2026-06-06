import {
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CierreZMedioPago } from './entities/cierre-z-medio-pago.entity';
import { CierreZ } from './entities/cierre-z.entity';
import { CajaSnapshotService } from './caja-snapshot.service';
import { CerrarTurnoDto } from './dto/turno.dto';
import { redondear2 } from './utils/caja-id.util';
import {
  cajaAperturaIdDesdePayloadResumen,
  cierreDiarioMismaVentana,
  cierreDiarioMismoRangoDesde,
} from './utils/sesion-caja.util';
import type { ModoPeriodoCierre, SnapshotCierreZ } from './utils/cierre-z-calculo.util';

export type ArqueoEfectivoCierre = {
  fondo_apertura: number;
  efectivo_ventas_periodo: number;
  esperado_sistema: number;
  gastos_monto: number;
  gastos_detalle: string | null;
  esperado_ajustado: number;
  contado: number;
  diferencia: number;
  esperado: number;
};

export type PersistCierreResult = {
  cierre_id: string;
  snapshot: SnapshotCierreZ;
  arqueo_efectivo: ArqueoEfectivoCierre;
  ticket_resumen: Record<string, unknown>;
};

@Injectable()
export class CajaCierreService {
  constructor(
    @InjectRepository(CierreZ)
    private readonly cierreRepo: Repository<CierreZ>,
    @InjectRepository(CierreZMedioPago)
    private readonly medioRepo: Repository<CierreZMedioPago>,
    private readonly snapshotService: CajaSnapshotService,
  ) {}

  async persistCierreZDiarioSesion(params: {
    tenantId: string;
    userId: string;
    sucursalId: string;
    cajaIdNormalizada: string;
    sesionAperturaId: string;
    fechaOperativa: string;
    rangoDesde: string;
    rangoHasta: string;
    fondoApertura: number;
    modoPeriodo: ModoPeriodoCierre;
    body: CerrarTurnoDto;
    payloadOrigen: string;
    usarEfectivoEsperadoComoContado?: boolean;
  }): Promise<PersistCierreResult> {
    const {
      tenantId,
      userId,
      sucursalId,
      cajaIdNormalizada,
      sesionAperturaId,
      fechaOperativa,
      rangoDesde,
      rangoHasta,
      fondoApertura,
      modoPeriodo,
      body,
      payloadOrigen,
      usarEfectivoEsperadoComoContado = false,
    } = params;

    const yaRows = await this.cierreRepo.find({
      where: { tenantId, sucursalId, cajaId: cajaIdNormalizada, tipoCierre: 'diario' },
      order: { createdAt: 'DESC' },
      take: 40,
      select: ['id', 'cajaAperturaId', 'payloadResumen', 'rangoDesde', 'rangoHasta'],
    });

    const yaSesion = yaRows.find(
      (row) =>
        row.cajaAperturaId === sesionAperturaId ||
        cajaAperturaIdDesdePayloadResumen(row.payloadResumen) === sesionAperturaId,
    );
    if (yaSesion) {
      throw new ConflictException(
        'Ya registraste el cierre final de esta apertura de caja. Abr├¡ caja de nuevo para iniciar otra sesi├│n.',
      );
    }

    const dupMismoPeriodo = yaRows.find(
      (row) =>
        cierreDiarioMismaVentana(
          row.rangoDesde?.toISOString?.() ?? String(row.rangoDesde),
          row.rangoHasta?.toISOString?.() ?? String(row.rangoHasta),
          rangoDesde,
          rangoHasta,
        ) ||
        cierreDiarioMismoRangoDesde(
          row.rangoDesde?.toISOString?.() ?? String(row.rangoDesde),
          rangoDesde,
        ),
    );
    if (dupMismoPeriodo) {
      throw new ConflictException(
        'Ya existe un cierre final con el mismo per├¡odo para esta caja. Abr├¡ caja de nuevo para una sesi├│n nueva.',
      );
    }

    const snapshot = await this.snapshotService.calcularSnapshot({
      tenantId,
      fechaOperativa,
      cajaIdNormalizada,
      sucursalId,
      rangoDesdeIso: rangoDesde,
      rangoHastaIso: rangoHasta,
      fondoApertura,
      modoPeriodo,
      sesionAperturaId,
    });

    let gastosMonto = 0;
    const gastosRaw = body.gastos_monto;
    if (gastosRaw !== null && gastosRaw !== undefined && Number.isFinite(Number(gastosRaw))) {
      const g = Number(gastosRaw);
      if (g > 0) gastosMonto = redondear2(g);
    }

    const esperadoSistema = snapshot.efectivo_esperado;
    const esperadoAjustado = redondear2(esperadoSistema - gastosMonto);

    let contadoNum: number;
    if (usarEfectivoEsperadoComoContado) {
      contadoNum = esperadoAjustado;
      if (!Number.isFinite(contadoNum) || contadoNum < 0) {
        throw new ConflictException(
          'No se pudo calcular el efectivo esperado para el cierre autom├ítico.',
        );
      }
    } else {
      const parsed = body.efectivo_contado;
      if (parsed === null || parsed === undefined || !Number.isFinite(Number(parsed)) || Number(parsed) < 0) {
        throw new ConflictException(
          'En el cierre final del d├¡a deb├®s ingresar el efectivo contado en caja (n├║mero ÔëÑ 0).',
        );
      }
      contadoNum = Number(parsed);
    }

    const gastosDetalle = String(body.gastos_detalle || '')
      .trim()
      .slice(0, 500) || null;
    const origenUi = String(body.origen_ui || '').trim().slice(0, 48) || null;

    const arqueo: ArqueoEfectivoCierre = {
      fondo_apertura: snapshot.fondo_apertura,
      efectivo_ventas_periodo: snapshot.efectivo_ventas_periodo,
      esperado_sistema: esperadoSistema,
      gastos_monto: gastosMonto,
      gastos_detalle: gastosDetalle,
      esperado_ajustado: esperadoAjustado,
      contado: redondear2(contadoNum),
      diferencia: redondear2(contadoNum - esperadoAjustado),
      esperado: esperadoAjustado,
    };

    let cierre: CierreZ;
    try {
      cierre = await this.cierreRepo.save(
        this.cierreRepo.create({
          tenantId,
          sucursalId,
          cajaId: cajaIdNormalizada,
          fechaOperativa,
          cajaAperturaId: sesionAperturaId,
          tipoCierre: 'diario',
          rangoDesde: new Date(rangoDesde),
          rangoHasta: new Date(rangoHasta),
          totalComprobantes: snapshot.total_comprobantes,
          ventasBrutas: String(snapshot.ventas_brutas),
          notasCreditoTotal: String(snapshot.notas_credito_total),
          ventasNetas: String(snapshot.ventas_netas),
          pagosCtaCteTotal: String(snapshot.pagos_cta_cte_total),
          usuarioCierreId: userId,
          payloadResumen: {
            origen: payloadOrigen,
            version: 4,
            sucursal_id: sucursalId,
            tipo_cierre: 'diario',
            modo_periodo: modoPeriodo,
            caja_apertura_id: sesionAperturaId,
            origen_ui: origenUi,
            arqueo_efectivo: arqueo,
          },
        }),
      );
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      if (code === '23505') {
        throw new ConflictException(
          'Ya registraste el cierre final de esta apertura de caja. Abr├¡ caja de nuevo para iniciar otra sesi├│n.',
        );
      }
      throw e;
    }

    if (snapshot.medios.length > 0) {
      await this.medioRepo.save(
        snapshot.medios.map((m) =>
          this.medioRepo.create({
            tenantId,
            cierreZId: cierre.id,
            metodoPago: m.metodo_pago,
            montoNeto: String(m.monto_neto),
            cantidadComprobantes: m.cantidad_comprobantes,
          }),
        ),
      );
    }

    const ticketResumen = {
      cierre_id: cierre.id,
      fecha_operativa: fechaOperativa,
      caja_id: cajaIdNormalizada,
      ventas_netas: snapshot.ventas_netas,
      total_comprobantes: snapshot.total_comprobantes,
      arqueo_efectivo: arqueo,
      medios: snapshot.medios,
    };

    return {
      cierre_id: cierre.id,
      snapshot,
      arqueo_efectivo: arqueo,
      ticket_resumen: ticketResumen,
    };
  }
}
