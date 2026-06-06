import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { BranchPricingService } from './branch-pricing.service';
import { EffectiveBranchPricingQueryDto } from './dto/effective-branch-pricing-query.dto';
import { UpsertBranchPricingDto } from './dto/upsert-branch-pricing.dto';

@ApiTags('branch-pricing')
@ApiBearerAuth('access-token')
@Controller()
export class BranchPricingController {
  constructor(private readonly branchPricingService: BranchPricingService) {}

  @Get('products/:productId/branch-pricing')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({ summary: 'Overrides de precio por dep├│sito para un producto' })
  listForProduct(@Param('productId', ParseUUIDPipe) productId: string) {
    return this.branchPricingService.listForProduct(productId);
  }

  @Get('products/:productId/branch-pricing/effective')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({ summary: 'Precio efectivo en dep├│sito (override + fallback producto)' })
  getEffective(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Query() query: EffectiveBranchPricingQueryDto,
  ) {
    return this.branchPricingService.getEffective(productId, query.sucursalId);
  }

  @Patch('products/:productId/branch-pricing')
  @Roles('admin', 'operador')
  @ApiOperation({ summary: 'Upsert o elimina override de precios por dep├│sito' })
  upsert(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: UpsertBranchPricingDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.branchPricingService.upsert(productId, dto, user);
  }
}
