import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { ComprobantePdfRegenerationService } from '../../facturacion/pdf/comprobante-pdf-regeneration.service';
import { Comprobante } from '../../facturacion/entities/comprobante.entity';
import { EstadoComprobante } from '../../facturacion/enums/estado-comprobante.enum';
import { hoyEnArgentina, sumarDiasYmdAR } from '../../facturacion/utils/fecha-argentina';
import { caeAfipFormatoValido } from '../../facturacion/utils/comprobante-void.rules';
import { ArcaConfig } from '../entities/arca-config.entity';
import { ArcaNumeracionPreCaeService } from './arca-numeracion-pre-cae.service';
import { ArcaWsfeService } from './arca-wsfe.service';

export type SolicitarCaeOrchestratorInput = {
  comprobanteId: string;
  clienteDocumento?: string | null;
  alicuotaIva?: number;
  /** Fecha comercial del comprobante (YYYY-MM-DD). */
  fechaComprobante: string;
};

export type SolicitarCaeOrchestratorOk = {
  ok: true;
  numero: number;
  cae: string;
  caeVencimiento: string | null;
  pdfUrl?: string | null;
};

export type SolicitarCaeOrchestratorFail =
  | { ok: false; kind: 'network'; message: string }
  | { ok: false; kind: 'reject'; message: string; codigo?: string }
  | { ok: false; kind: 'config'; message: string };

@Injectable()
export class ArcaSolicitarCaeOrchestratorService {
  private readonly logger = new Logger(ArcaSolicitarCaeOrchestratorService.name);

  constructor(
    @InjectRepository(Comprobante)
    private readonly comprobanteRepo: Repository<Comprobante>,
    @InjectRepository(ArcaConfig)
    private readonly arcaConfigRepo: Repository<ArcaConfig>,
    private readonly numeracion: ArcaNumeracionPreCaeService,
    private readonly wsfe: ArcaWsfeService,
    private readonly pdfRegeneration: ComprobantePdfRegenerationService,
  ) {}

  async solicitarCaeYAsignarNumero(
    tenantId: string,
    input: SolicitarCaeOrchestratorInput,
  ): Promise<SolicitarCaeOrchestratorOk | SolicitarCaeOrchestratorFail> {
    const row = await this.comprobanteRepo.findOne({
      where: { id: input.comprobanteId, tenantId },
    });
    if (!row) {
      return { ok: false, kind: 'config', message: 'Comprobante no encontrado' };
    }
    if (!row.sucursalId) {
      return { ok: false, kind: 'config', message: 'Comprobante sin sucursal' };
    }
    if (caeAfipFormatoValido(row.cae)) {
      return {
        ok: true,
        numero: row.numero ?? 0,
        cae: row.cae!,
        caeVencimiento: row.caeVencimiento,
        pdfUrl: row.pdfUrl,
      };
    }
    if (![EstadoComprobante.pendiente_arca, EstadoComprobante.error_arca].includes(row.estado)) {
      return {
        ok: false,
        kind: 'config',
        message: 'El comprobante no est├í pendiente de ARCA ni en error.',
      };
    }

    const config = await this.arcaConfigRepo.findOne({
      where: { tenantId, sucursalId: row.sucursalId },
    });
    if (!config?.cuitEmisor || config.puntoDeVenta == null) {
      return { ok: false, kind: 'config', message: 'Configuraci├│n ARCA incompleta' };
    }

    const intentosPrev = row.intentosArca ?? 0;
    const nextIntentos = intentosPrev + 1;
    const nowIso = new Date().toISOString();

    try {
      await this.numeracion.lockArcaConfig(tenantId, row.sucursalId);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { ok: false, kind: 'config', message: `Lock ARCA: ${msg}` };
    }

    let numeroRes = await this.numeracion.resolverNumeroParaSolicitudCae(
      { tenantId, sucursalId: row.sucursalId },
      row.tipo,
      config,
    );
    if ('error' in numeroRes) {
      return { ok: false, kind: 'reject', message: numeroRes.error, codigo: 'NUMERACION' };
    }

    let fechaEmitida = fechaEmisionConCorrelativaAfip(input.fechaComprobante, numeroRes.fechaMinCorrelativaAfip);
    let resultado = await this.wsfe.ejecutarFecaeSolicitar({
      tenantId,
      sucursalId: row.sucursalId,
      comprobanteId: row.id,
      config,
      comprobante: row,
      numero: numeroRes.numero,
      fechaYmd: fechaEmitida,
      clienteDocumento: input.clienteDocumento,
      alicuotaIva: input.alicuotaIva,
    });

    let intentosAlineacion = 0;
    while (
      resultado.estado === 'rechazado' &&
      esRechazoNumeracionProximoAutorizar(resultado) &&
      intentosAlineacion < 12
    ) {
      intentosAlineacion++;
      const otra = await this.numeracion.resolverNumeroParaSolicitudCae(
        { tenantId, sucursalId: row.sucursalId },
        row.tipo,
        config,
      );
      if ('error' in otra) break;
      numeroRes = otra;
      let baseFecha = fechaEmisionConCorrelativaAfip(input.fechaComprobante, otra.fechaMinCorrelativaAfip);
      if (intentosAlineacion >= 3) {
        baseFecha = maxIsoYmd(baseFecha, sumarDiasYmdAR(baseFecha, intentosAlineacion - 2));
      }
      fechaEmitida = baseFecha;
      resultado = await this.wsfe.ejecutarFecaeSolicitar({
        tenantId,
        sucursalId: row.sucursalId,
        comprobanteId: row.id,
        config,
        comprobante: row,
        numero: numeroRes.numero,
        fechaYmd: fechaEmitida,
        clienteDocumento: input.clienteDocumento,
        alicuotaIva: input.alicuotaIva,
      });
    }

    if (resultado.estado === 'aprobado' && resultado.cae) {
      const updated = await this.comprobanteRepo.update(
        {
          id: row.id,
          tenantId,
          estado: In([EstadoComprobante.pendiente_arca, EstadoComprobante.error_arca]),
        },
        {
          numero: numeroRes.numero,
          cae: resultado.cae,
          caeVencimiento: resultado.caeVencimiento,
          estado: EstadoComprobante.emitido,
          fecha: fechaEmitida,
          intentosArca: nextIntentos,
          ultimoIntentoArcaAt: new Date(nowIso),
          ultimoErrorArcaCodigo: null,
          ultimoErrorArcaMensaje: null,
        },
      );
      if (!updated.affected) {
        return {
          ok: false,
          kind: 'reject',
          message: 'No se pudo confirmar el CAE (condici├│n de carrera). Reintent├í.',
          codigo: 'RACE',
        };
      }

      await this.arcaConfigRepo.update(
        { tenantId, sucursalId: row.sucursalId },
        { ultimoComprobante: numeroRes.numero },
      );

      let pdfUrl: string | null = null;
      try {
        const r = await this.pdfRegeneration.persistPostCaePdfToStorage(tenantId, row.id);
        pdfUrl = r.pdfUrl;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.warn(`PDF post-CAE omitido (${row.id}): ${msg}`);
      }

      return {
        ok: true,
        numero: numeroRes.numero,
        cae: resultado.cae,
        caeVencimiento: resultado.caeVencimiento,
        pdfUrl,
      };
    }

    if (resultado.estado === 'pendiente') {
      await this.comprobanteRepo.update(
        { id: row.id, tenantId },
        {
          estado: EstadoComprobante.pendiente_arca,
          intentosArca: nextIntentos,
          ultimoIntentoArcaAt: new Date(nowIso),
          ultimoErrorArcaCodigo: 'NETWORK',
          ultimoErrorArcaMensaje: resultado.errores[0]?.mensaje ?? 'Sin respuesta de ARCA',
        },
      );
      return {
        ok: false,
        kind: 'network',
        message: resultado.errores[0]?.mensaje ?? 'Sin respuesta de ARCA',
      };
    }

    const firstErr = resultado.errores[0] ?? resultado.observaciones[0];
    await this.comprobanteRepo.update(
      { id: row.id, tenantId },
      {
        estado: EstadoComprobante.error_arca,
        ultimoErrorArcaCodigo: firstErr?.codigo ?? null,
        ultimoErrorArcaMensaje: firstErr?.mensaje ?? 'Rechazo ARCA',
        intentosArca: nextIntentos,
        ultimoIntentoArcaAt: new Date(nowIso),
      },
    );
    return {
      ok: false,
      kind: 'reject',
      message: firstErr?.mensaje ?? 'ARCA rechaz├│ la solicitud',
      codigo: firstErr?.codigo,
    };
  }

  /** Respuesta API legacy `{ data: ... }` para worker/admin. */
  async solicitarCaeForTenantApi(tenantId: string, input: SolicitarCaeOrchestratorInput) {
    const comp = await this.comprobanteRepo.findOne({
      where: { id: input.comprobanteId, tenantId },
    });
    if (!comp) throw new NotFoundException('Comprobante no encontrado');

    const r = await this.solicitarCaeYAsignarNumero(tenantId, {
      ...input,
      fechaComprobante: comp.fecha,
    });

    if (r.ok) {
      return {
        data: {
          estado: 'aprobado' as const,
          cae: r.cae,
          caeVencimiento: r.caeVencimiento,
          errores: [],
          observaciones: [],
          pdf: r.pdfUrl ? { generated: true, sizeBytes: 1, pdfUrl: r.pdfUrl } : undefined,
        },
      };
    }
    if (r.kind === 'network') {
      return {
        data: {
          estado: 'pendiente' as const,
          cae: null,
          caeVencimiento: null,
          errores: [{ codigo: 'NETWORK', mensaje: r.message }],
          observaciones: [],
        },
      };
    }
    return {
      data: {
        estado: 'rechazado' as const,
        cae: null,
        caeVencimiento: null,
        errores: [
          {
            codigo: r.kind === 'reject' ? (r.codigo ?? 'REJECT') : 'REJECT',
            mensaje: r.message,
          },
        ],
        observaciones: [],
      },
    };
  }
}

function maxIsoYmd(a: string, b: string): string {
  return a >= b ? a : b;
}

function fechaEmisionConCorrelativaAfip(fechaComprobanteYmd: string, fechaMin: string | null): string {
  const hoy = hoyEnArgentina();
  const raw = /^\d{4}-\d{2}-\d{2}$/.test(fechaComprobanteYmd) ? fechaComprobanteYmd : hoy;
  let d = maxIsoYmd(raw, hoy);
  if (fechaMin && /^\d{4}-\d{2}-\d{2}$/.test(fechaMin)) {
    d = maxIsoYmd(d, fechaMin);
  }
  return d;
}

function textoAfipSinTildes(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function esRechazoNumeracionProximoAutorizar(r: {
  estado: string;
  errores: Array<{ codigo: string; mensaje: string }>;
  observaciones: Array<{ codigo: string; mensaje: string }>;
}): boolean {
  if (r.estado === 'aprobado') return false;
  for (const e of [...r.errores, ...r.observaciones]) {
    if (String(e.codigo ?? '').trim() === '10016') return true;
    const t = textoAfipSinTildes(String(e.mensaje ?? ''));
    if (t.includes('fecompultimoautorizado')) return true;
    if (t.includes('proximo') && t.includes('autorizar')) return true;
  }
  return false;
}
