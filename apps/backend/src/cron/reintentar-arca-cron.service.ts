import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { ComprobanteRetryArcaService } from '../facturacion/comprobante-retry-arca.service';
import { EstadoComprobante } from '../facturacion/enums/estado-comprobante.enum';

const BATCH = 10;
const MAX_INTENTOS = 3;

@Injectable()
export class ReintentarArcaCronService {
  constructor(
    @InjectRepository(Comprobante) private readonly comprobanteRepo: Repository<Comprobante>,
    private readonly retryArcaService: ComprobanteRetryArcaService,
  ) {}

  async procesarLote() {
    const pendientes = await this.comprobanteRepo.find({
      where: { estado: EstadoComprobante.pendiente_arca },
      select: {
        id: true,
        tenantId: true,
        intentosArca: true,
        estado: true,
      },
      order: { createdAt: 'ASC' },
      take: BATCH,
    });

    if (pendientes.length === 0) {
      return { procesados: 0, mensaje: 'Sin comprobantes pendientes' };
    }

    let procesados = 0;
    let exitosos = 0;
    let aErrorArca = 0;

    for (const p of pendientes) {
      const intentos = p.intentosArca ?? 0;
      if (intentos >= MAX_INTENTOS) {
        await this.comprobanteRepo.update(
          { id: p.id },
          {
            estado: EstadoComprobante.error_arca,
            ultimoErrorArcaCodigo: 'MAX_REINTENTOS',
            ultimoErrorArcaMensaje: `Se alcanzó el máximo de ${MAX_INTENTOS} intentos de solicitud CAE.`,
          },
        );
        aErrorArca++;
        procesados++;
        continue;
      }

      const r = await this.retryArcaService.retryArcaForCron(p.tenantId, p.id);
      if (r.ok) {
        exitosos++;
      } else if (r.status !== 503) {
        aErrorArca++;
      }
      procesados++;
    }

    return { procesados, exitosos, a_error_arca: aErrorArca };
  }
}
