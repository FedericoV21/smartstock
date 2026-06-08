import { BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';

import { TurnoAgenda } from '../entities/turno-agenda.entity';
import { UUID_RE } from './turnos-api.util';

export async function validateAgendaPrincipalId(opts: {
  agendaRepo: Repository<TurnoAgenda>;
  tenantId: string;
  sucursalId: string;
  agendaId: string | null;
  agendaPrincipalIdRaw: unknown;
}): Promise<string | null> {
  const raw = opts.agendaPrincipalIdRaw;
  if (raw === null || raw === undefined || raw === '') {
    return null;
  }
  const value = String(raw).trim();
  if (!UUID_RE.test(value)) {
    throw new BadRequestException('agenda_principal_id invalido');
  }
  if (opts.agendaId && value === opts.agendaId) {
    throw new BadRequestException('Una agenda no puede vincularse a si misma');
  }

  const principal = await opts.agendaRepo.findOne({
    where: { id: value, tenantId: opts.tenantId, sucursalId: opts.sucursalId },
    select: { id: true, agendaPrincipalId: true },
  });
  if (!principal) {
    throw new BadRequestException('La agenda principal indicada no existe en esta sucursal');
  }
  if (principal.agendaPrincipalId) {
    throw new BadRequestException('No se puede vincular a una agenda que ya depende de otra');
  }

  if (opts.agendaId) {
    const dependientes = await opts.agendaRepo.find({
      where: { tenantId: opts.tenantId, agendaPrincipalId: opts.agendaId },
      take: 1,
      select: { id: true },
    });
    if (dependientes.length > 0) {
      throw new BadRequestException(
        'Esta agenda ya es principal de otras y no puede vincularse a otra',
      );
    }
  }

  return value;
}
