import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { TurnoAgenda } from './turno-agenda.entity';

@Entity({ name: 'turno_agenda_disponibilidad' })
export class TurnoAgendaDisponibilidad {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'agenda_id', type: 'uuid' })
  agendaId: string;

  @Column({ name: 'dia_semana', type: 'smallint' })
  diaSemana: number;

  @Column({ name: 'hora_inicio', type: 'time' })
  horaInicio: string;

  @Column({ name: 'hora_fin', type: 'time' })
  horaFin: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => TurnoAgenda, (agenda) => agenda.disponibilidad, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'agenda_id' })
  agenda?: TurnoAgenda;
}
