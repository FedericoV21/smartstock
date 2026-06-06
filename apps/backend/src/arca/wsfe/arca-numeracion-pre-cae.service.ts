import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { Comprobante } from '../../facturacion/entities/comprobante.entity';
import { TipoComprobante } from '../../facturacion/enums/tipo-comprobante.enum';
import { caeAfipFormatoValido } from '../../facturacion/utils/comprobante-void.rules';
import { ArcaConfig } from '../entities/arca-config.entity';
import { AFIP_CBTE_NUMERO_MAX } from '../utils/arca-wsfe-xml.util';
import { ArcaWsfeConsultaService } from '../wsfe/arca-wsfe-consulta.service';

export type ResolverNumeroCaeOk = {
  numero: number;
  fechaMinCorrelativaAfip: string | null;
};

const FECOMP_OPTS = { timeoutMs: 15_000 };

@Injectable()
export class ArcaNumeracionPreCaeService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly wsfeConsulta: ArcaWsfeConsultaService,
    @InjectRepository(Comprobante)
    private readonly comprobanteRepo: Repository<Comprobante>,
  ) {}

  async lockArcaConfig(tenantId: string, sucursalId: string): Promise<void> {
    await this.dataSource.query(`SELECT public.lock_arca_config_for_update($1::uuid, $2::uuid)`, [
      tenantId,
      sucursalId,
    ]);
  }

  async resolverNumeroParaSolicitudCae(
    ctx: { tenantId: string; sucursalId: string },
    tipo: TipoComprobante,
    arcaConfig: ArcaConfig,
  ): Promise<ResolverNumeroCaeOk | { error: string }> {
    let ultimoAutorizado: number;
    try {
      ultimoAutorizado = await this.wsfeConsulta.consultarUltimoComprobante(
        ctx.tenantId,
        ctx.sucursalId,
        arcaConfig,
        tipo,
        FECOMP_OPTS,
      );
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error);
      return { error: `No se pudo consultar numeraci├│n ARCA: ${mensaje}` };
    }

    const ultimoArca = sanitizarUltimoConsultadoWsfe(ultimoAutorizado);
    let numero = Math.max(1, ultimoArca + 1);
    if (numero > AFIP_CBTE_NUMERO_MAX) {
      return { error: 'Numeraci├│n fiscal fuera del rango ARCA (1..99999999).' };
    }

    for (let i = 0; i < 200; i++) {
      const conflicto = await this.liberarNumeroConflictuante(ctx, tipo, numero, ultimoArca);
      if (!conflicto) {
        let fechaMinCorrelativaAfip: string | null = null;
        const acumMax = (iso: string | null) => {
          if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return;
          fechaMinCorrelativaAfip =
            !fechaMinCorrelativaAfip || iso > fechaMinCorrelativaAfip ? iso : fechaMinCorrelativaAfip;
        };
        const fechaPromises: Promise<string | null>[] = [];
        if (numero > 1) {
          fechaPromises.push(
            this.wsfeConsulta.consultarCbteFch(
              ctx.tenantId,
              ctx.sucursalId,
              arcaConfig,
              tipo,
              numero - 1,
              FECOMP_OPTS,
            ),
          );
        }
        if (ultimoArca >= 1) {
          fechaPromises.push(
            this.wsfeConsulta.consultarCbteFch(
              ctx.tenantId,
              ctx.sucursalId,
              arcaConfig,
              tipo,
              ultimoArca,
              FECOMP_OPTS,
            ),
          );
        }
        if (fechaPromises.length > 0) {
          const settled = await Promise.allSettled(fechaPromises);
          for (const s of settled) {
            if (s.status === 'fulfilled') acumMax(s.value);
          }
        }
        return { numero, fechaMinCorrelativaAfip };
      }
      if (!conflicto.includes('autorizado por ARCA')) {
        return { error: conflicto };
      }
      const proximoSegunAfip = Math.min(AFIP_CBTE_NUMERO_MAX, Math.max(1, ultimoArca + 1));
      if (numero === proximoSegunAfip) {
        try {
          const existe = await this.wsfeConsulta.consultarComprobanteExisteEnAfip(
            ctx.tenantId,
            ctx.sucursalId,
            arcaConfig,
            tipo,
            numero,
            FECOMP_OPTS,
          );
          if (!existe) {
            const archivado = await this.archivarFantasma(ctx, tipo, numero);
            if (archivado) continue;
          }
        } catch {
          return {
            error: `AFIP exige n.┬║ ${proximoSegunAfip} pero hay conflicto local; no se pudo verificar en AFIP.`,
          };
        }
        return {
          error: `AFIP exige n.┬║ ${proximoSegunAfip} pero ya existe localmente con CAE v├ílido.`,
        };
      }
      numero += 1;
      if (numero > AFIP_CBTE_NUMERO_MAX) {
        return { error: 'Sin numeraci├│n fiscal disponible en rango ARCA.' };
      }
    }
    return { error: 'No se pudo reservar numeraci├│n fiscal libre.' };
  }

  async siguienteNumeroLocal(
    tenantId: string,
    sucursalId: string,
    tipo: TipoComprobante,
  ): Promise<number> {
    const rows = (await this.dataSource.query(
      `SELECT public.siguiente_numero_comprobante($1::uuid, $2::uuid, $3::tipo_comprobante) AS numero`,
      [tenantId, sucursalId, tipo],
    )) as Array<{ numero?: number | string }>;
    return Number(rows[0]?.numero ?? 1);
  }

  private async liberarNumeroConflictuante(
    ctx: { tenantId: string; sucursalId: string },
    tipo: TipoComprobante,
    numero: number,
    ultimoArca: number,
  ): Promise<string | null> {
    void ultimoArca;
    const conflicto = await this.comprobanteRepo.findOne({
      where: {
        tenantId: ctx.tenantId,
        sucursalId: ctx.sucursalId,
        tipo,
        numero,
      },
      select: { id: true, cae: true, estado: true, notas: true, numeroOrden: true },
    });
    if (!conflicto) return null;
    if (caeAfipFormatoValido(conflicto.cae)) {
      return `Ya hay un comprobante autorizado por ARCA con n├║mero fiscal ${numero}.`;
    }
    const numeroArchivado = await this.obtenerNumeroArchivado(ctx.tenantId, tipo);
    const notaArchivo = [
      conflicto.notas?.trim(),
      `[SmartStock] Archivado como ${numeroArchivado} para liberar numeraci├│n fiscal ${numero} (sin CAE v├ílido).`,
    ]
      .filter(Boolean)
      .join('\n\n');
    await this.comprobanteRepo.update(
      { id: conflicto.id },
      { numero: numeroArchivado, notas: notaArchivo },
    );
    return null;
  }

  private async archivarFantasma(
    ctx: { tenantId: string; sucursalId: string },
    tipo: TipoComprobante,
    numero: number,
  ): Promise<boolean> {
    const row = await this.comprobanteRepo.findOne({
      where: {
        tenantId: ctx.tenantId,
        sucursalId: ctx.sucursalId,
        tipo,
        numero,
      },
    });
    if (!row || !caeAfipFormatoValido(row.cae)) return false;
    const numeroArchivado = await this.obtenerNumeroArchivado(ctx.tenantId, tipo);
    await this.comprobanteRepo.update(
      { id: row.id },
      {
        numero: numeroArchivado,
        cae: null,
        caeVencimiento: null,
        notas: [
          row.notas?.trim(),
          `[SmartStock] CAE local no figura en AFIP; numeraci├│n ${numero} liberada.`,
        ]
          .filter(Boolean)
          .join('\n\n'),
      },
    );
    return true;
  }

  private async obtenerNumeroArchivado(tenantId: string, tipo: TipoComprobante): Promise<number> {
    const row = await this.comprobanteRepo
      .createQueryBuilder('c')
      .select('c.numero', 'numero')
      .where('c.tenant_id = :tenantId', { tenantId })
      .andWhere('c.tipo = :tipo', { tipo })
      .andWhere('c.numero < 0')
      .orderBy('c.numero', 'ASC')
      .limit(1)
      .getRawOne<{ numero: number | null }>();
    return (row?.numero ?? 0) - 1;
  }
}

function sanitizarUltimoConsultadoWsfe(n: unknown): number {
  const raw = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(raw)) return 0;
  const k = Math.trunc(raw);
  if (k < 0 || k > AFIP_CBTE_NUMERO_MAX) return 0;
  return k;
}
