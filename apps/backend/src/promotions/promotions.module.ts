import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { BranchesModule } from '../branches/branches.module';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { Producto } from '../products/entities/producto.entity';
import { ProductoPromocion } from './entities/producto-promocion.entity';
import { PromocionComboItem } from './entities/promocion-combo-item.entity';
import { PromocionSucursal } from './entities/promocion-sucursal.entity';
import { Promocion } from './entities/promocion.entity';
import { PromotionsController } from './promotions.controller';
import { PromotionsService } from './promotions.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Promocion,
      ProductoPromocion,
      PromocionComboItem,
      PromocionSucursal,
      Sucursal,
      Producto,
    ]),
    AuthModule,
    BranchesModule,
  ],
  controllers: [PromotionsController],
  providers: [PromotionsService],
  exports: [PromotionsService],
})
export class PromotionsModule {}
