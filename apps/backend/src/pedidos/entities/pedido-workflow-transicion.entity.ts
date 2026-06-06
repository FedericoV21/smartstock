import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'pedido_estado_workflow_transicion' })
export class PedidoWorkflowTransicion {
  @PrimaryColumn({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @PrimaryColumn({ name: 'desde_id', type: 'uuid' })
  desdeId: string;

  @PrimaryColumn({ name: 'hacia_id', type: 'uuid' })
  haciaId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
