import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { BranchesModule } from '../branches/branches.module';
import { Cliente } from '../catalog/entities/cliente.entity';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { Tenant } from '../config/entities/tenant.entity';
import { FacturacionModule } from '../facturacion/facturacion.module';
import { ComprobanteItem } from '../facturacion/entities/comprobante-item.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { Pedido } from '../pedidos/entities/pedido.entity';
import { PedidosModule } from '../pedidos/pedidos.module';
import { PresupuestosController } from './presupuestos.controller';
import { PresupuestosService } from './presupuestos.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Comprobante, ComprobanteItem, Cliente, Tenant, ModuloConfig, Pedido]),
    AuthModule,
    BranchesModule,
    FacturacionModule,
    PedidosModule,
  ],
  controllers: [PresupuestosController],
  providers: [PresupuestosService],
})
export class PresupuestosModule {}
