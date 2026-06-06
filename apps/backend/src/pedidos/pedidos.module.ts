import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { BranchesModule } from '../branches/branches.module';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { ComprobanteItem } from '../facturacion/entities/comprobante-item.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { Producto } from '../products/entities/producto.entity';
import { PedidoWorkflowEstado } from './entities/pedido-workflow-estado.entity';
import { PedidoWorkflowTransicion } from './entities/pedido-workflow-transicion.entity';
import { PedidoItem } from './entities/pedido-item.entity';
import { Pedido } from './entities/pedido.entity';
import { PedidoWorkflowController } from './pedido-workflow.controller';
import { PedidoWorkflowTransicionesController } from './pedido-workflow-transiciones.controller';
import { PedidoWorkflowService } from './pedido-workflow.service';
import { PedidosController } from './pedidos.controller';
import { PedidosService } from './pedidos.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Pedido,
      PedidoItem,
      Producto,
      Comprobante,
      ComprobanteItem,
      PedidoWorkflowEstado,
      PedidoWorkflowTransicion,
      ModuloConfig,
    ]),
    AuthModule,
    BranchesModule,
  ],
  controllers: [PedidoWorkflowController, PedidoWorkflowTransicionesController, PedidosController],
  providers: [PedidosService, PedidoWorkflowService],
  exports: [PedidoWorkflowService],
})
export class PedidosModule {}
