import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, FindOptionsWhere, In, Not, Repository } from 'typeorm';

import { ArcaConfig } from '../arca/entities/arca-config.entity';
import { ArcaSolicitarCaeOrchestratorService } from '../arca/wsfe/arca-solicitar-cae-orchestrator.service';
import { TenantContext } from '../auth/tenant-context.service';
import { BranchStockService } from '../branches/branch-stock.service';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { REGISTRAR_MOVIMIENTO_SQL } from '../inventory/sql/registrar-movimiento.sql';
import { Producto } from '../products/entities/producto.entity';
import { ComprobanteItem } from './entities/comprobante-item.entity';
import { Comprobante } from './entities/comprobante.entity';
import { FinanciacionEmitService } from './financiacion-emit.service';
import { ComprobantePdfRegenerationService } from './pdf/comprobante-pdf-regeneration.service';
import { ComprobantePdfService } from './pdf/comprobante-pdf.service';
import { EstadoComprobante } from './enums/estado-comprobante.enum';
import { TipoComprobante } from './enums/tipo-comprobante.enum';
import { EmitComprobanteDto } from './dto/emit-comprobante.dto';
import { ListComprobantesQueryDto } from './dto/list-comprobantes-query.dto';
import { Cliente } from '../catalog/entities/cliente.entity';
import { hoyEnArgentina } from './utils/fecha-argentina';
import { tipoComprobanteRequiereCaeAfip } from './utils/comprobante-void.rules';

type MovementKind = 'entrada' | 'salida' | null;
const MAX_NUMERO_RETRIES = 3;

const ESTADOS_REEMPLAZABLES_BORRADOR: EstadoComprobante[] = [
  EstadoComprobante.borrador,
  EstadoComprobante.pendiente_posnet,
];

export type EmitirComprobanteOpciones = {
  tenantIdOverride?: string;
  reemplazarComprobanteBorradorId?: string;
  mpPointPaymentId?: number;
};

export type EmitirDesdeBorradorMpPointResult =
  | { ok: true; data: { data: Record<string, unknown> } }
  | { ok: false; error: string };

@Injectable()
export class FacturacionService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(Comprobante)
    private readonly comprobanteRepo: Repository<Comprobante>,
    @InjectRepository(ComprobanteItem)
    private readonly comprobanteItemRepo: Repository<ComprobanteItem>,
    @InjectRepository(Producto)
    private readonly productoRepo: Repository<Producto>,
    @InjectRepository(Cliente)
    private readonly clienteRepo: Repository<Cliente>,
    @InjectRepository(ArcaConfig)
    private readonly arcaConfigRepo: Repository<ArcaConfig>,
    @InjectRepository(ModuloConfig)
    private readonly moduloConfigRepo: Repository<ModuloConfig>,
    private readonly comprobantePdfService: ComprobantePdfService,
    private readonly comprobantePdfRegeneration: ComprobantePdfRegenerationService,
    private readonly tenantContext: TenantContext,
    private readonly branchStockService: BranchStockService,
    private readonly arcaOrchestrator: ArcaSolicitarCaeOrchestratorService,
    private readonly financiacionEmit: FinanciacionEmitService,
  ) {}

  async list(query: ListComprobantesQueryDto) {
    const tenantId = this.tenantContext.getTenantId();
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;

    const where: FindOptionsWhere<Comprobante> = { tenantId };
    if (query.tipo) where.tipo = query.tipo;
    if (query.clienteId) where.clienteId = query.clienteId;

    if (query.soloFallas) {
      where.estado = In([EstadoComprobante.pendiente_arca, EstadoComprobante.error_arca]);
    } else if (query.estado) {
      where.estado = query.estado;
    } else {
      where.estado = Not(In([EstadoComprobante.pendiente_arca, EstadoComprobante.error_arca]));
    }

    const [rows, total] = await this.comprobanteRepo.findAndCount({
      where,
      order: { fecha: 'DESC', numero: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    const clienteIds = [...new Set(rows.map((r) => r.clienteId).filter((id): id is string => !!id))];
    const clientes =
      clienteIds.length > 0
        ? await this.clienteRepo.find({
            where: { tenantId, id: In(clienteIds) },
            select: { id: true, nombre: true, razonSocial: true },
          })
        : [];
    const clienteMap = new Map(clientes.map((c) => [c.id, c]));

    return {
      data: rows.map((c) => this.serializeComprobanteSummary(c, clienteMap.get(c.clienteId ?? '') ?? null)),
      meta: {
        total,
        page,
        pageSize,
        pageCount: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }

  async downloadPdf(id: string) {
    const tenantId = this.tenantContext.getTenantId();
    const comprobante = await this.comprobanteRepo.findOne({ where: { id, tenantId } });
    if (!comprobante) {
      throw new NotFoundException('Comprobante no encontrado');
    }

    const buffer = await this.comprobantePdfRegeneration.buildComprobantePdf(tenantId, id);
    if (!buffer || buffer.length === 0) {
      throw new BadRequestException('No se pudo generar el PDF del comprobante');
    }

    return {
      buffer,
      filename: this.comprobantePdfRegeneration.pdfFilename(
        comprobante.tipo,
        comprobante.numero ?? comprobante.numeroOrden ?? 0,
      ),
    };
  }

  async regeneratePdf(id: string) {
    const tenantId = this.tenantContext.getTenantId();
    const comprobante = await this.comprobanteRepo.findOne({ where: { id, tenantId } });
    if (!comprobante) {
      throw new NotFoundException('Comprobante no encontrado');
    }

    const result = await this.comprobantePdfRegeneration.persistComprobantePdfToStorage(
      tenantId,
      id,
    );

    return {
      data: {
        comprobanteId: id,
        generated: result.sizeBytes > 0,
        sizeBytes: result.sizeBytes,
        pdfUrl: result.pdfUrl,
        stored: result.pdfUrl != null,
      },
    };
  }

  async getById(id: string) {
    const tenantId = this.tenantContext.getTenantId();
    const comprobante = await this.comprobanteRepo.findOne({ where: { id, tenantId } });
    if (!comprobante) {
      throw new NotFoundException('Comprobante no encontrado');
    }

    const [items, cliente] = await Promise.all([
      this.comprobanteItemRepo.find({ where: { comprobanteId: id }, order: { createdAt: 'ASC' } }),
      comprobante.clienteId
        ? this.clienteRepo.findOne({
            where: { id: comprobante.clienteId, tenantId },
            select: { id: true, nombre: true, razonSocial: true, cuitDni: true, condicionIva: true },
          })
        : Promise.resolve(null),
    ]);

    const productoIds = [...new Set(items.map((it) => it.productoId))];
    const productos =
      productoIds.length > 0
        ? await this.productoRepo.find({
            where: { tenantId, id: In(productoIds) },
            select: { id: true, codigo: true, nombre: true },
          })
        : [];
    const productMap = new Map(productos.map((p) => [p.id, p]));

    return {
      data: {
        ...this.serializeComprobanteSummary(comprobante, cliente),
        notas: comprobante.notas,
        metodoPago: comprobante.metodoPago,
        metodoPagoDetalle: comprobante.metodoPagoDetalle,
        cajaId: comprobante.cajaId,
        cae: comprobante.cae,
        caeVencimiento: comprobante.caeVencimiento,
        pdfUrl: comprobante.pdfUrl,
        usuarioId: comprobante.usuarioId,
        sucursalId: comprobante.sucursalId,
        tipoOperacion: comprobante.tipoOperacion,
        motivoAnulacion: comprobante.motivoAnulacion,
        anuladoAt: comprobante.anuladoAt?.toISOString() ?? null,
        anuladoPor: comprobante.anuladoPor,
        updatedAt: comprobante.updatedAt.toISOString(),
        items: items.map((it) => {
          const p = productMap.get(it.productoId);
          return {
            id: it.id,
            productoId: it.productoId,
            productoCodigo: p?.codigo ?? null,
            productoNombre: p?.nombre ?? null,
            cantidad: Number(it.cantidad),
            precioUnitario: Number(it.precioUnitario),
            precioCosto: it.precioCosto != null ? Number(it.precioCosto) : null,
            subtotal: Number(it.subtotal),
            createdAt: it.createdAt.toISOString(),
          };
        }),
      },
    };
  }

  async emitirDesdeBorradorMpPoint(params: {
    tenantId: string;
    borradorId: string;
    usuarioId: string;
    mpPointPaymentId: number;
    dto: EmitComprobanteDto;
  }): Promise<EmitirDesdeBorradorMpPointResult> {
    try {
      const data = await this.emitir(params.dto, params.usuarioId, {
        tenantIdOverride: params.tenantId,
        reemplazarComprobanteBorradorId: params.borradorId,
        mpPointPaymentId: params.mpPointPaymentId,
      });
      return { ok: true, data };
    } catch (err) {
      const msg =
        err instanceof BadRequestException || err instanceof ConflictException
          ? String((err as BadRequestException).message)
          : err instanceof Error
            ? err.message
            : 'Error al emitir comprobante';
      return { ok: false, error: msg };
    }
  }

  async emitir(dto: EmitComprobanteDto, usuarioId: string, opciones?: EmitirComprobanteOpciones) {
    const tenantId = opciones?.tenantIdOverride ?? this.tenantContext.getTenantId();
    const reemplazarId = opciones?.reemplazarComprobanteBorradorId?.trim() || null;
    const movementKind = resolveMovementKind(dto.tipo);

    const productoIds = [...new Set(dto.items.map((it) => it.productoId))];
    const productos = await this.productoRepo.find({
      where: { tenantId, activo: true, id: In(productoIds) },
      select: { id: true, codigo: true, nombre: true, precioCosto: true, precioVenta: true },
    });
    const productMap = new Map(productos.map((p) => [p.id, p]));
    const missing = productoIds.filter((id) => !productMap.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(`Productos inexistentes/inactivos: ${missing.join(', ')}`);
    }

    const itemsResolved = dto.items.map((item) => {
      const p = productMap.get(item.productoId)!;
      const precioUnitario = item.precioUnitario ?? Number(p.precioVenta);
      const precioCosto = Number(p.precioCosto);
      const subtotal = roundMoney(precioUnitario * item.cantidad);
      return {
        productoId: p.id,
        productoCodigo: p.codigo,
        productoNombre: p.nombre,
        cantidad: item.cantidad,
        precioUnitario,
        precioCosto,
        subtotal,
      };
    });

    const subtotalMercaderia = roundMoney(itemsResolved.reduce((acc, it) => acc + it.subtotal, 0));
    const ivaPorcentaje = dto.ivaPorcentaje ?? (dto.tipo === TipoComprobante.factura_a ? 21 : 0);
    const ivaMontoMercaderia = roundMoney(subtotalMercaderia * (ivaPorcentaje / 100));
    const totalMercaderiaBruto = roundMoney(subtotalMercaderia + ivaMontoMercaderia);

    const fin = await this.financiacionEmit.resolveForEmit(
      tenantId,
      dto,
      {
        subtotal: subtotalMercaderia,
        ivaPorcentaje,
        ivaMonto: ivaMontoMercaderia,
        total: totalMercaderiaBruto,
      },
      dto.clienteId,
    );

    const subtotal = fin.importes.subtotal;
    const ivaMonto = fin.importes.ivaMonto;
    const total = fin.importes.total;
    const mostrarFinanciacion =
      fin.esPagoMixto || fin.financiacionMonto !== 0 || Boolean(dto.medioPagoOpcionId);
    const metodoPagoFinal = fin.esPagoMixto ? 'mixto' : (dto.metodoPago ?? null);
    const metodoPagoDetalleFinal = fin.metodoPagoDetalle ?? dto.metodoPagoDetalle ?? null;
    const sucursalId =
      dto.sucursalId?.trim() ||
      (await this.branchStockService.resolveDepotId(itemsResolved[0]?.productoId));

    const modulos = await this.moduloConfigRepo.findOne({ where: { tenantId } });
    const requiereArca =
      modulos?.facturadorArca === true && tipoComprobanteRequiereCaeAfip(dto.tipo);
    const arcaCfg =
      requiereArca && sucursalId
        ? await this.arcaConfigRepo.findOne({ where: { tenantId, sucursalId } })
        : null;
    const modeloArcaV9 = Boolean(
      requiereArca && arcaCfg?.cuitEmisor && arcaCfg.puntoDeVenta != null,
    );

    let clienteDocumento: string | null = null;
    if (dto.clienteId) {
      const cl = await this.clienteRepo.findOne({
        where: { id: dto.clienteId, tenantId },
        select: { cuitDni: true },
      });
      clienteDocumento = cl?.cuitDni ?? null;
    }

    const fechaEmision = (dto.fecha ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
    let fechaParaCae = fechaEmision;
    if (modeloArcaV9 && fechaParaCae < hoyEnArgentina()) {
      fechaParaCae = hoyEnArgentina();
    }

    for (let attempt = 1; attempt <= MAX_NUMERO_RETRIES; attempt += 1) {
      try {
        const txResult = await this.dataSource.transaction(async (manager) => {
          let numeroValue: number | null = null;
          let numeroOrden: number | null = null;
          const ordenExplicito =
            dto.numeroOrdenExplicito != null && Number.isFinite(dto.numeroOrdenExplicito)
              ? dto.numeroOrdenExplicito
              : null;

          if (modeloArcaV9) {
            if (ordenExplicito != null) {
              numeroOrden = ordenExplicito;
            } else {
              const ordenRows = (await manager.query(
                `SELECT COALESCE(MAX(numero_orden), 0) + 1 AS n FROM comprobante WHERE tenant_id = $1`,
                [tenantId],
              )) as Array<{ n?: number | string }>;
              numeroOrden = Number(ordenRows[0]?.n ?? 1);
            }
          } else if (sucursalId) {
            const numeroRows = (await manager.query(
              `SELECT public.siguiente_numero_comprobante($1::uuid, $2::uuid, $3::tipo_comprobante) AS numero`,
              [tenantId, sucursalId, dto.tipo],
            )) as Array<{ numero?: number | string }>;
            numeroValue = Number(numeroRows[0]?.numero);
            if (!Number.isFinite(numeroValue)) {
              throw new BadRequestException('No se pudo generar n├║mero de comprobante');
            }
            numeroOrden = ordenExplicito ?? numeroValue;
          } else {
            throw new BadRequestException('No se pudo resolver sucursal para numeraci├│n');
          }

          const comprobanteFields = {
            tipo: dto.tipo,
            numero: numeroValue,
            numeroOrden,
            fecha: fechaParaCae,
            clienteId: dto.clienteId ?? null,
            sucursalId,
            subtotal: subtotal.toFixed(2),
            ivaMonto: ivaMonto.toFixed(2),
            ivaPorcentaje: ivaPorcentaje.toFixed(2),
            total: total.toFixed(2),
            estado: modeloArcaV9 ? EstadoComprobante.pendiente_arca : EstadoComprobante.emitido,
            metodoPago: metodoPagoFinal,
            metodoPagoDetalle: metodoPagoDetalleFinal,
            medioPagoOpcionId: fin.medioPagoOpcionId,
            totalMercaderia: mostrarFinanciacion ? fin.totalMercaderia.toFixed(4) : null,
            financiacionMonto: mostrarFinanciacion ? fin.financiacionMonto.toFixed(4) : null,
            financiacionPorcentaje: mostrarFinanciacion ? fin.financiacionPorcentaje.toFixed(4) : null,
            financiacionDescripcion: mostrarFinanciacion ? fin.financiacionDescripcion : null,
            cajaId: dto.cajaId ?? null,
            notas: dto.notas ?? null,
            usuarioId,
            mpPointIntentId: null as string | null,
            mpPointPaymentId:
              opciones?.mpPointPaymentId != null && opciones.mpPointPaymentId > 0
                ? String(opciones.mpPointPaymentId)
                : null,
          };

          let savedComprobante: Comprobante;
          let idempotent = false;

          if (reemplazarId) {
            const claim = await manager.update(
              Comprobante,
              {
                id: reemplazarId,
                tenantId,
                estado: In(ESTADOS_REEMPLAZABLES_BORRADOR),
              },
              comprobanteFields as Parameters<Repository<Comprobante>['update']>[1],
            );
            if (!claim.affected) {
              const existente = await manager.findOne(Comprobante, {
                where: { id: reemplazarId, tenantId },
              });
              if (existente && !ESTADOS_REEMPLAZABLES_BORRADOR.includes(existente.estado)) {
                savedComprobante = existente;
                idempotent = true;
              } else {
                throw new ConflictException(
                  'El comprobante ya est├í siendo emitido. Consult├í el estado en unos segundos.',
                );
              }
            } else {
              await manager.delete(ComprobanteItem, { comprobanteId: reemplazarId });
              const refreshed = await manager.findOne(Comprobante, {
                where: { id: reemplazarId, tenantId },
              });
              if (!refreshed) {
                throw new BadRequestException('No se pudo actualizar el borrador');
              }
              savedComprobante = refreshed;
            }
          } else {
            const comprobante = manager.create(Comprobante, {
              tenantId,
              tipoOperacion: 'venta',
              ...comprobanteFields,
            });
            savedComprobante = await manager.save(Comprobante, comprobante);
          }

          if (idempotent) {
            return {
              savedComprobante,
              numeroValue: savedComprobante.numero,
              numeroOrden: savedComprobante.numeroOrden,
              idempotent: true,
            };
          }

          const itemEntities = itemsResolved.map((it) =>
            manager.create(ComprobanteItem, {
              comprobanteId: savedComprobante.id,
              productoId: it.productoId,
              cantidad: it.cantidad.toFixed(3),
              precioUnitario: it.precioUnitario.toFixed(2),
              precioCosto: it.precioCosto.toFixed(6),
              subtotal: it.subtotal.toFixed(2),
            }),
          );
          await manager.save(ComprobanteItem, itemEntities);

          if (movementKind) {
            for (const it of itemsResolved) {
              await manager.query(REGISTRAR_MOVIMIENTO_SQL, [
                tenantId,
                it.productoId,
                sucursalId,
                movementKind,
                it.cantidad,
                modeloArcaV9
                  ? `Comprobante ${dto.tipo} (pendiente CAE)`
                  : `Comprobante ${dto.tipo} #${numeroValue}`,
                'factura',
                savedComprobante.id,
                usuarioId,
              ]);
            }
          }

          return { savedComprobante, numeroValue, numeroOrden, idempotent: false };
        });

        if (txResult.idempotent) {
          return {
            data: {
              id: txResult.savedComprobante.id,
              tenantId,
              tipo: txResult.savedComprobante.tipo,
              numero: txResult.savedComprobante.numero,
              numeroOrden: txResult.savedComprobante.numeroOrden,
              fecha: txResult.savedComprobante.fecha,
              estado: txResult.savedComprobante.estado,
              cae: txResult.savedComprobante.cae,
              caeVencimiento: txResult.savedComprobante.caeVencimiento,
              subtotal: Number(txResult.savedComprobante.subtotal),
              ivaMonto: Number(txResult.savedComprobante.ivaMonto),
              ivaPorcentaje: Number(txResult.savedComprobante.ivaPorcentaje),
              total: Number(txResult.savedComprobante.total),
              metodoPago: txResult.savedComprobante.metodoPago,
              financiacionMonto: txResult.savedComprobante.financiacionMonto
                ? Number(txResult.savedComprobante.financiacionMonto)
                : null,
              stockImpacto: 'sin_movimiento' as const,
              pdf: { generated: false, sizeBytes: 0, pdfUrl: txResult.savedComprobante.pdfUrl },
              items: [],
              createdAt: txResult.savedComprobante.createdAt.toISOString(),
            },
          };
        }

        let cae: string | null = null;
        let caeVencimiento: string | null = null;
        let numeroFinal = txResult.numeroValue;
        let estadoFinal = modeloArcaV9 ? EstadoComprobante.pendiente_arca : EstadoComprobante.emitido;
        let pdfUrl: string | null = null;

        if (modeloArcaV9) {
          const caeRes = await this.arcaOrchestrator.solicitarCaeYAsignarNumero(tenantId, {
            comprobanteId: txResult.savedComprobante.id,
            clienteDocumento,
            alicuotaIva: ivaPorcentaje,
            fechaComprobante: fechaParaCae,
          });

          if (caeRes.ok) {
            cae = caeRes.cae;
            caeVencimiento = caeRes.caeVencimiento;
            numeroFinal = caeRes.numero;
            estadoFinal = EstadoComprobante.emitido;
            pdfUrl = caeRes.pdfUrl ?? null;
          } else if (caeRes.kind === 'network') {
            estadoFinal = EstadoComprobante.pendiente_arca;
          } else {
            estadoFinal = EstadoComprobante.error_arca;
          }
        }

        const arcaCfgPdf =
          sucursalId != null
            ? await this.arcaConfigRepo.findOne({ where: { tenantId, sucursalId } })
            : null;

        const pdfBuffer = await this.comprobantePdfService.generateComprobantePdf({
          tipo: txResult.savedComprobante.tipo,
          numero: numeroFinal ?? txResult.numeroOrden ?? 0,
          fecha: fechaParaCae,
          emisor: {
            nombre: 'SmartStock',
            cuit: arcaCfgPdf?.cuitEmisor ?? undefined,
          },
          receptor: { nombre: dto.clienteId ?? null },
          items: itemsResolved.map((it) => ({
            descripcion: `${it.productoCodigo} - ${it.productoNombre}`,
            cantidad: it.cantidad,
            precioUnitario: it.precioUnitario,
            subtotal: it.subtotal,
          })),
          subtotal,
          ivaMonto,
          total,
          fiscal: {
            cae,
            caeVencimiento,
            cuitEmisor: arcaCfgPdf?.cuitEmisor ?? null,
            puntoVenta: arcaCfgPdf?.puntoDeVenta ?? null,
          },
          totalMercaderia: mostrarFinanciacion ? fin.totalMercaderia : null,
          financiacionMonto: mostrarFinanciacion ? fin.financiacionMonto : null,
          financiacionPorcentaje: mostrarFinanciacion ? fin.financiacionPorcentaje : null,
          financiacionDescripcion: mostrarFinanciacion ? fin.financiacionDescripcion : null,
        });

        if (!modeloArcaV9 && pdfBuffer.length > 0) {
          try {
            const stored = await this.comprobantePdfRegeneration.persistComprobantePdfToStorage(
              tenantId,
              txResult.savedComprobante.id,
            );
            pdfUrl = stored.pdfUrl;
          } catch {
            /* best-effort */
          }
        }

        return {
          data: {
            id: txResult.savedComprobante.id,
            tenantId,
            tipo: txResult.savedComprobante.tipo,
            numero: numeroFinal,
            numeroOrden: txResult.numeroOrden,
            fecha: fechaParaCae,
            estado: estadoFinal,
            cae,
            caeVencimiento,
            subtotal,
            ivaMonto,
            ivaPorcentaje,
            total,
            metodoPago: metodoPagoFinal,
            financiacionMonto: mostrarFinanciacion ? fin.financiacionMonto : null,
            stockImpacto: movementKind ?? 'sin_movimiento',
            pdf: {
              generated: pdfBuffer.length > 0,
              sizeBytes: pdfBuffer.length,
              pdfUrl,
            },
            items: itemsResolved,
            createdAt: txResult.savedComprobante.createdAt.toISOString(),
          },
        };
      } catch (error) {
        const retryable = isNumeroUniqueConflict(error);
        if (!retryable || attempt === MAX_NUMERO_RETRIES) {
          throw error;
        }
      }
    }

    throw new BadRequestException('No se pudo emitir comprobante por conflicto de numeraci├│n');
  }

  private serializeComprobanteSummary(
    c: Comprobante,
    cliente: Pick<Cliente, 'id' | 'nombre' | 'razonSocial'> | null | undefined,
  ) {
    return {
      id: c.id,
      tenantId: c.tenantId,
      tipo: c.tipo,
      numero: c.numero,
      fecha: c.fecha,
      estado: c.estado,
      clienteId: c.clienteId,
      cliente: cliente
        ? { id: cliente.id, nombre: cliente.nombre, razonSocial: cliente.razonSocial ?? null }
        : null,
      subtotal: Number(c.subtotal),
      ivaMonto: Number(c.ivaMonto),
      ivaPorcentaje: Number(c.ivaPorcentaje),
      total: Number(c.total),
      createdAt: c.createdAt.toISOString(),
    };
  }
}

function resolveMovementKind(tipo: TipoComprobante): MovementKind {
  if (
    tipo === TipoComprobante.factura_a ||
    tipo === TipoComprobante.factura_b ||
    tipo === TipoComprobante.factura_c ||
    tipo === TipoComprobante.remito ||
    tipo === TipoComprobante.ticket
  ) {
    return 'salida';
  }
  if (
    tipo === TipoComprobante.nota_credito_a ||
    tipo === TipoComprobante.nota_credito_b ||
    tipo === TipoComprobante.nota_credito_c
  ) {
    return 'entrada';
  }
  return null;
}

function roundMoney(n: number): number {
  return Number(n.toFixed(2));
}

function isNumeroUniqueConflict(error: unknown): boolean {
  const code = (error as { driverError?: { code?: string }; code?: string } | null)?.driverError?.code ??
    (error as { code?: string } | null)?.code;
  if (code !== '23505') return false;

  const msg =
    String(
      (error as { driverError?: { detail?: string; constraint?: string; message?: string } } | null)?.driverError
        ?.constraint ??
        (error as { driverError?: { detail?: string; message?: string } } | null)?.driverError?.detail ??
        (error as { driverError?: { message?: string }; message?: string } | null)?.driverError?.message ??
        (error as { message?: string } | null)?.message ??
        '',
    ).toLowerCase();

  return msg.includes('idx_comprobante_numero') || msg.includes('comprobante') || msg.includes('numero');
}
