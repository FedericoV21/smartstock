import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { ArcaConfig } from '../../arca/entities/arca-config.entity';
import { Cliente } from '../../catalog/entities/cliente.entity';
import { Tenant } from '../../config/entities/tenant.entity';
import { Producto } from '../../products/entities/producto.entity';
import { ComprobanteItem } from '../entities/comprobante-item.entity';
import { Comprobante } from '../entities/comprobante.entity';
import { ComprobantePdfService } from './comprobante-pdf.service';
import { PdfS3StorageService } from '../storage/pdf-s3.storage';

/**
 * Regenera el PDF fiscal luego de persistir CAE (WSFE o stub homologaci├│n).
 * Si `PDF_STORAGE_ENABLED` y credenciales S3 est├ín definidas, sube el archivo y actualiza `pdf_url`.
 */
@Injectable()
export class ComprobantePdfRegenerationService {
  private readonly logger = new Logger(ComprobantePdfRegenerationService.name);

  constructor(
    @InjectRepository(Comprobante)
    private readonly comprobanteRepo: Repository<Comprobante>,
    @InjectRepository(ComprobanteItem)
    private readonly itemRepo: Repository<ComprobanteItem>,
    @InjectRepository(Producto)
    private readonly productoRepo: Repository<Producto>,
    @InjectRepository(ArcaConfig)
    private readonly arcaConfigRepo: Repository<ArcaConfig>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(Cliente)
    private readonly clienteRepo: Repository<Cliente>,
    private readonly comprobantePdfService: ComprobantePdfService,
    private readonly pdfS3: PdfS3StorageService,
  ) {}

  pdfFilename(tipo: string, numero: number): string {
    return `${tipo}_${numero}.pdf`;
  }

  /** Genera PDF del comprobante (con o sin CAE). */
  async buildComprobantePdf(tenantId: string, comprobanteId: string): Promise<Buffer | null> {
    const c = await this.comprobanteRepo.findOne({ where: { id: comprobanteId, tenantId } });
    if (!c) {
      return null;
    }

    const items = await this.itemRepo.find({
      where: { comprobanteId: c.id },
      order: { createdAt: 'ASC' },
    });
    if (items.length === 0) {
      this.logger.warn(`buildComprobantePdf: comprobante ${comprobanteId} sin ├¡tems`);
    }

    const productoIds = [...new Set(items.map((it) => it.productoId))];
    const [productos, arcaCfg, tenant, cliente] = await Promise.all([
      productoIds.length > 0
        ? this.productoRepo.find({
            where: { tenantId, id: In(productoIds) },
            select: { id: true, codigo: true, nombre: true },
          })
        : Promise.resolve([]),
      this.arcaConfigRepo.findOne({
        where: { tenantId, ...(c.sucursalId ? { sucursalId: c.sucursalId } : {}) },
      }),
      this.tenantRepo.findOne({ where: { id: tenantId } }),
      c.clienteId
        ? this.clienteRepo.findOne({
            where: { id: c.clienteId, tenantId },
            select: { id: true, nombre: true, razonSocial: true, cuitDni: true },
          })
        : Promise.resolve(null),
    ]);
    const pmap = new Map(productos.map((p) => [p.id, p]));

    try {
      return await this.comprobantePdfService.generateComprobantePdf({
        tipo: c.tipo,
        numero: c.numero ?? c.numeroOrden ?? 0,
        fecha: c.fecha,
        emisor: {
          nombre: tenant?.razonSocial ?? tenant?.nombre ?? 'SmartStock',
          cuit: arcaCfg?.cuitEmisor ?? tenant?.cuit ?? undefined,
        },
        receptor: cliente
          ? {
              nombre: cliente.razonSocial ?? cliente.nombre,
              cuitDni: cliente.cuitDni,
            }
          : null,
        items: items.map((it) => {
          const p = pmap.get(it.productoId);
          return {
            descripcion: `${p?.codigo ?? '?'} - ${p?.nombre ?? 'Producto'}`,
            cantidad: Number(it.cantidad),
            precioUnitario: Number(it.precioUnitario),
            subtotal: Number(it.subtotal),
          };
        }),
        subtotal: Number(c.subtotal),
        ivaMonto: Number(c.ivaMonto),
        total: Number(c.total),
        fiscal: {
          cae: c.cae,
          caeVencimiento: c.caeVencimiento,
          cuitEmisor: arcaCfg?.cuitEmisor ?? tenant?.cuit ?? null,
          puntoVenta: arcaCfg?.puntoDeVenta ?? null,
          qrContenido: null,
        },
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`buildComprobantePdf fall├│ (${comprobanteId}): ${msg}`);
      return null;
    }
  }

  /** Devuelve buffer PDF o `null` si no hay CAE o falla el armado. */
  async buildPostCaePdf(tenantId: string, comprobanteId: string): Promise<Buffer | null> {
    const c = await this.comprobanteRepo.findOne({ where: { id: comprobanteId, tenantId } });
    if (!c?.cae || !c.caeVencimiento) {
      return null;
    }
    return this.buildComprobantePdf(tenantId, comprobanteId);
  }

  /**
   * Genera el PDF post-CAE; si hay storage S3 configurado, sube y persiste `pdf_url`.
   */
  async persistComprobantePdfToStorage(
    tenantId: string,
    comprobanteId: string,
  ): Promise<{ sizeBytes: number; pdfUrl: string | null }> {
    const buf = await this.buildComprobantePdf(tenantId, comprobanteId);
    if (!buf) {
      return { sizeBytes: 0, pdfUrl: null };
    }
    if (!this.pdfS3.isConfigured()) {
      return { sizeBytes: buf.length, pdfUrl: null };
    }
    try {
      const url = await this.pdfS3.uploadComprobantePdf(tenantId, comprobanteId, buf);
      await this.comprobanteRepo.update({ id: comprobanteId, tenantId }, { pdfUrl: url });
      return { sizeBytes: buf.length, pdfUrl: url };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Subida PDF fall├│ (${comprobanteId}): ${msg}`);
      return { sizeBytes: buf.length, pdfUrl: null };
    }
  }

  async persistPostCaePdfToStorage(
    tenantId: string,
    comprobanteId: string,
  ): Promise<{ sizeBytes: number; pdfUrl: string | null }> {
    const buf = await this.buildPostCaePdf(tenantId, comprobanteId);
    if (!buf) {
      return { sizeBytes: 0, pdfUrl: null };
    }
    if (!this.pdfS3.isConfigured()) {
      return { sizeBytes: buf.length, pdfUrl: null };
    }
    try {
      const url = await this.pdfS3.uploadComprobantePdf(tenantId, comprobanteId, buf);
      await this.comprobanteRepo.update({ id: comprobanteId, tenantId }, { pdfUrl: url });
      return { sizeBytes: buf.length, pdfUrl: url };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Subida PDF post-CAE fall├│ (${comprobanteId}): ${msg}`);
      return { sizeBytes: buf.length, pdfUrl: null };
    }
  }
}
