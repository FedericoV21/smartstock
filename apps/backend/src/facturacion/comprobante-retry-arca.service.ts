import {
  BadRequestException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ArcaConfig } from '../arca/entities/arca-config.entity';
import { ArcaWsfeService } from '../arca/wsfe/arca-wsfe.service';
import { TenantContext } from '../auth/tenant-context.service';
import { Cliente } from '../catalog/entities/cliente.entity';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { Comprobante } from './entities/comprobante.entity';
import { EstadoComprobante } from './enums/estado-comprobante.enum';
import { hoyEnArgentina } from './utils/fecha-argentina';
import {
  caeAfipFormatoValido,
  formatearTipoComprobante,
  tipoComprobanteRequiereCaeAfip,
} from './utils/comprobante-void.rules';

const ESTADOS_REINTENTO = new Set<string>([
  EstadoComprobante.error_arca,
  EstadoComprobante.pendiente_arca,
]);

@Injectable()
export class ComprobanteRetryArcaService {
  constructor(
    @InjectRepository(Comprobante)
    private readonly comprobanteRepo: Repository<Comprobante>,
    @InjectRepository(Cliente)
    private readonly clienteRepo: Repository<Cliente>,
    @InjectRepository(ModuloConfig)
    private readonly moduloConfigRepo: Repository<ModuloConfig>,
    @InjectRepository(ArcaConfig)
    private readonly arcaConfigRepo: Repository<ArcaConfig>,
    private readonly tenantContext: TenantContext,
    private readonly arcaWsfeService: ArcaWsfeService,
  ) {}

  async retryArca(comprobanteId: string) {
    return this.retryArcaForTenant(this.tenantContext.getTenantId(), comprobanteId);
  }

  async retryArcaForCron(
    tenantId: string,
    comprobanteId: string,
  ): Promise<{ ok: true } | { ok: false; status: number }> {
    try {
      await this.retryArcaForTenant(tenantId, comprobanteId);
      return { ok: true };
    } catch (err: unknown) {
      if (err instanceof ServiceUnavailableException) {
        return { ok: false, status: 503 };
      }
      if (err instanceof HttpException) {
        return { ok: false, status: err.getStatus() };
      }
      return { ok: false, status: 500 };
    }
  }

  async retryArcaForTenant(tenantId: string, comprobanteId: string) {
    await this.assertFacturadorArcaHabilitado(tenantId);

    let comprobante = await this.comprobanteRepo.findOne({
      where: { id: comprobanteId, tenantId },
    });
    if (!comprobante) {
      throw new NotFoundException('Comprobante no encontrado.');
    }

    if (!tipoComprobanteRequiereCaeAfip(comprobante.tipo)) {
      throw new BadRequestException(
        `Este tipo de comprobante (${formatearTipoComprobante(comprobante.tipo)}) no se fiscaliza por ARCA.`,
      );
    }

    if (caeAfipFormatoValido(comprobante.cae)) {
      throw new BadRequestException('El comprobante ya tiene CAE.');
    }

    comprobante = await this.normalizarEmitidoSinCae(comprobante, tenantId);
    this.assertEstadoReintentable(comprobante.estado);
    if (!comprobante.sucursalId) {
      throw new BadRequestException('El comprobante no tiene sucursal asociada.');
    }
    await this.assertArcaConfigCompleta(tenantId, comprobante.sucursalId);

    comprobante = await this.normalizarFechaSiPasada(comprobante, tenantId);

    const clienteDocumento = await this.resolveClienteDocumento(comprobante.clienteId, tenantId);

    const resultado = await this.arcaWsfeService.solicitarCae({
      comprobanteId: comprobante.id,
      clienteDocumento,
    });

    const data = resultado.data;

    if (data.estado === 'aprobado' && data.cae) {
      const actualizado = await this.comprobanteRepo.findOne({
        where: { id: comprobante.id, tenantId },
      });
      const pdfFromWsfe =
        'pdf' in data && data.pdf && typeof data.pdf === 'object'
          ? (data.pdf as { pdfUrl?: string | null }).pdfUrl ?? null
          : null;
      return {
        data: {
          cae: data.cae,
          caeVencimiento: data.caeVencimiento ?? actualizado?.caeVencimiento ?? null,
          pdfUrl: actualizado?.pdfUrl ?? pdfFromWsfe,
          estado: actualizado?.estado ?? EstadoComprobante.emitido,
          numero: actualizado?.numero ?? null,
        },
      };
    }

    if (data.estado === 'pendiente') {
      const msg =
        data.errores[0]?.mensaje ??
        'Sin respuesta de ARCA. Qued├│ pendiente; pod├®s reintentar cuando la red est├® estable.';
      throw new ServiceUnavailableException(msg);
    }

    const errMsg =
      data.errores.map((e) => `${e.codigo}: ${e.mensaje}`).join('; ') || 'Rechazo ARCA';
    throw new UnprocessableEntityException(errMsg);
  }

  private async assertFacturadorArcaHabilitado(tenantId: string) {
    const modulos = await this.moduloConfigRepo.findOne({ where: { tenantId } });
    if (!modulos?.facturadorArca) {
      throw new BadRequestException('El facturador ARCA no est├í habilitado.');
    }
  }

  private assertEstadoReintentable(estado: EstadoComprobante) {
    if (!ESTADOS_REINTENTO.has(estado)) {
      throw new BadRequestException(
        'Solo se puede reintentar ARCA en comprobantes con error o pendiente de autorizaci├│n.',
      );
    }
  }

  private async assertArcaConfigCompleta(tenantId: string, sucursalId: string) {
    const arca = await this.arcaConfigRepo.findOne({ where: { tenantId, sucursalId } });
    if (!arca?.cuitEmisor || arca.puntoDeVenta == null) {
      throw new BadRequestException('Configuraci├│n ARCA incompleta (CUIT o punto de venta).');
    }
  }

  private async normalizarEmitidoSinCae(comprobante: Comprobante, tenantId: string) {
    if (comprobante.estado !== EstadoComprobante.emitido) {
      return comprobante;
    }

    await this.comprobanteRepo.update(
      { id: comprobante.id, tenantId, estado: EstadoComprobante.emitido },
      {
        numero: null,
        estado: EstadoComprobante.error_arca,
        ultimoErrorArcaCodigo: 'SIN_CAE',
        ultimoErrorArcaMensaje:
          'El comprobante estaba marcado como emitido sin CAE v├ílido. Reintent├í la autorizaci├│n ARCA.',
      },
    );

    const recargado = await this.comprobanteRepo.findOne({
      where: { id: comprobante.id, tenantId },
    });
    if (!recargado) {
      throw new NotFoundException('Comprobante no encontrado tras normalizar estado.');
    }
    return recargado;
  }

  private async normalizarFechaSiPasada(comprobante: Comprobante, tenantId: string) {
    const hoy = hoyEnArgentina();
    if (comprobante.fecha >= hoy) {
      return comprobante;
    }

    await this.comprobanteRepo.update(
      { id: comprobante.id, tenantId },
      { fecha: hoy },
    );
    return { ...comprobante, fecha: hoy };
  }

  private async resolveClienteDocumento(
    clienteId: string | null,
    tenantId: string,
  ): Promise<string | undefined> {
    if (!clienteId) {
      return undefined;
    }
    const cliente = await this.clienteRepo.findOne({
      where: { id: clienteId, tenantId },
      select: { cuitDni: true },
    });
    return cliente?.cuitDni ?? undefined;
  }
}
