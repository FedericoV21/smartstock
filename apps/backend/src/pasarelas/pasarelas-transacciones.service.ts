import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PasarelaTransaccion } from './entities/pasarela-transaccion.entity';
import { TRANSACCION_ESTADOS_ACTIVOS } from './utils/pasarela-secrets.util';

@Injectable()
export class PasarelasTransaccionesService {
  constructor(
    @InjectRepository(PasarelaTransaccion)
    private readonly transaccionRepo: Repository<PasarelaTransaccion>,
  ) {}

  async insertarActiva(row: {
    tenantId: string;
    sucursalId: string;
    cajaId: string | null;
    integracionId: string;
    comprobanteId: string;
    proveedor: string;
    canal: 'qr' | 'terminal';
    tipo: string;
    monto: number;
    externalReference?: string | null;
  }): Promise<{ id: string }> {
    try {
      const saved = await this.transaccionRepo.save(
        this.transaccionRepo.create({
          tenantId: row.tenantId,
          sucursalId: row.sucursalId,
          cajaId: row.cajaId,
          integracionId: row.integracionId,
          comprobanteId: row.comprobanteId,
          proveedor: row.proveedor,
          canal: row.canal,
          tipo: row.tipo,
          estado: 'iniciada',
          monto: String(row.monto),
          moneda: 'ARS',
          externalReference: row.externalReference ?? row.comprobanteId,
        }),
      );
      return { id: saved.id };
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      if (code === '23505') {
        throw new ConflictException({
          error:
            'Esta integracion ya tiene un cobro activo. Espera, cancelalo o consulta el estado antes de iniciar otro.',
          code,
        });
      }
      throw new InternalServerErrorException('No se pudo crear la transaccion');
    }
  }

  async marcar(
    transaccionId: string,
    patch: {
      estado: string;
      externalIntentId?: string | null;
      externalOrderId?: string | null;
      externalPaymentId?: string | null;
      externalReference?: string | null;
      responsePayload?: Record<string, unknown> | null;
      requestPayload?: Record<string, unknown> | null;
      ultimoError?: string | null;
    },
  ): Promise<void> {
    const row = await this.transaccionRepo.findOne({ where: { id: transaccionId } });
    if (!row) return;

    row.estado = patch.estado;
    if (patch.externalIntentId !== undefined) row.externalIntentId = patch.externalIntentId;
    if (patch.externalOrderId !== undefined) row.externalOrderId = patch.externalOrderId;
    if (patch.externalPaymentId !== undefined) row.externalPaymentId = patch.externalPaymentId;
    if (patch.externalReference !== undefined) row.externalReference = patch.externalReference;
    if (patch.responsePayload !== undefined) row.responsePayload = patch.responsePayload;
    if (patch.requestPayload !== undefined) row.requestPayload = patch.requestPayload;
    if (patch.ultimoError !== undefined) row.ultimoError = patch.ultimoError;

    await this.transaccionRepo.save(row);
  }

  estadosActivos(): string[] {
    return [...TRANSACCION_ESTADOS_ACTIVOS];
  }
}
