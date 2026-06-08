import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { Producto } from '../../products/entities/producto.entity';
import { TurnoAgendaDisponibilidad } from './turno-agenda-disponibilidad.entity';
import { TurnoAgendaExtraHorario } from './turno-agenda-extra-horario.entity';
import { TurnoReservaFija } from './turno-reserva-fija.entity';

@Entity({ name: 'turno_agenda' })
export class TurnoAgenda {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'sucursal_id', type: 'uuid' })
  sucursalId: string;

  @Column({ name: 'producto_id', type: 'uuid', nullable: true })
  productoId: string | null;

  @Column({ name: 'agenda_principal_id', type: 'uuid', nullable: true })
  agendaPrincipalId: string | null;

  @Column({ type: 'text' })
  nombre: string;

  @Column({ type: 'text', nullable: true })
  descripcion: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: '0' })
  precio: string;

  @Column({ name: 'duracion_minutos', type: 'smallint', default: 60 })
  duracionMinutos: number;

  @Column({ type: 'boolean', default: true })
  activa: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => Producto, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'producto_id' })
  producto?: Producto | null;

  @ManyToOne(() => TurnoAgenda, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'agenda_principal_id' })
  agendaPrincipal?: TurnoAgenda | null;

  @OneToMany(() => TurnoAgendaDisponibilidad, (row) => row.agenda)
  disponibilidad?: TurnoAgendaDisponibilidad[];

  @OneToMany(() => TurnoAgendaExtraHorario, (row) => row.agenda)
  extrasHorarios?: TurnoAgendaExtraHorario[];

  @OneToMany(() => TurnoReservaFija, (row) => row.agenda)
  reservasFijas?: TurnoReservaFija[];
}
