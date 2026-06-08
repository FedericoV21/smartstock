import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ArcaJob } from '../arca/entities/arca-job.entity';
import { TenantContext } from '../auth/tenant-context.service';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { Comprobante } from './entities/comprobante.entity';
import { EstadoComprobante } from './enums/estado-comprobante.enum';
import {
  caeAfipFormatoValido,
  tipoComprobanteRequiereCaeAfip,
} from './utils/comprobante-void.rules';

@Injectable()
export class ComprobanteEncolarArcaService {
  constructor(
    @InjectRepository(Comprobante) private readonly comprobanteRepo: Repository<Comprobante>,
    @InjectRepository(ArcaJob) private readonly arcaJobRepo: Repository<ArcaJob>,
    @InjectRepository(ModuloConfig) private readonly moduloRepo: Repository<ModuloConfig>,
    private readonly tenantContext: TenantContext,
  ) {}

  async encolar(comprobanteId: string) {
    const tenantId = this.tenantContext.getTenantId();
    await this.assertModulos();

    const comp = await this.comprobanteRepo.findOne({
      where: { id: comprobanteId, tenantId },
      select: { id: true, tipo: true, estado: true, cae: true },
    });

    if (!comp) {
      throw new NotFoundException('Comprobante no encontrado');
    }

    if (!tipoComprobanteRequiereCaeAfip(comp.tipo)) {
      throw new BadRequestException('Este tipo de comprobante no se envía a ARCA');
    }

    if (comp.estado !== EstadoComprobante.emitido && comp.estado !== EstadoComprobante.pendiente_arca) {
      throw new BadRequestException(
        'Solo se pueden encolar comprobantes emitidos o pendientes de ARCA',
      );
    }

    if (caeAfipFormatoValido(comp.cae)) {
      throw new BadRequestException('El comprobante ya tiene CAE');
    }

    const existente = await this.arcaJobRepo.findOne({
      where: { comprobanteId },
    });

    if (existente) {
      if (existente.status === 'completed') {
        throw new BadRequestException('Este comprobante ya fue autorizado por ARCA');
      }
      if (existente.status === 'pending' || existente.status === 'processing') {
        throw new ConflictException('El comprobante ya está en cola ARCA');
      }
      if (existente.status === 'failed') {
        await this.arcaJobRepo.update(
          { id: existente.id },
          {
            status: 'pending',
            attempts: 0,
            nextAttemptAt: null,
            lastError: null,
          },
        );
        await this.comprobanteRepo.update(
          { id: comprobanteId, tenantId },
          { estado: EstadoComprobante.pendiente_arca },
        );
        return {
          job_id: existente.id,
          mensaje: 'Reencolado tras fallo anterior',
        };
      }
    }

    const inserted = await this.arcaJobRepo.save(
      this.arcaJobRepo.create({
        tenantId,
        comprobanteId,
        status: 'pending',
      }),
    );

    await this.comprobanteRepo.update(
      { id: comprobanteId, tenantId },
      { estado: EstadoComprobante.pendiente_arca },
    );

    return {
      job_id: inserted.id,
      mensaje: 'Encolado para autorización ARCA',
    };
  }

  private async assertModulos(): Promise<void> {
    const tenantId = this.tenantContext.getTenantId();
    const modulos = await this.moduloRepo.findOne({ where: { tenantId } });
    if (!modulos?.facturadorArca) {
      throw new BadRequestException('El facturador ARCA no está habilitado.');
    }
    if (!modulos.facturadorSimple) {
      throw new BadRequestException('El facturador simple no está habilitado.');
    }
  }
}
