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
import { BranchPluService } from './branch-plu.service';
import { EffectiveBranchPricingQueryDto } from './dto/effective-branch-pricing-query.dto';
import { UpsertBranchPluDto } from './dto/upsert-branch-plu.dto';

@ApiTags('branch-plu')
@ApiBearerAuth('access-token')
@Controller()
export class BranchPluController {
  constructor(private readonly branchPluService: BranchPluService) {}

  @Get('products/:productId/branch-plu')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({ summary: 'Overrides de PLU por dep├│sito para un producto' })
  listForProduct(@Param('productId', ParseUUIDPipe) productId: string) {
    return this.branchPluService.listForProduct(productId);
  }

  @Get('products/:productId/branch-plu/effective')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({ summary: 'PLU efectivo en dep├│sito (override + fallback producto)' })
  getEffective(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Query() query: EffectiveBranchPricingQueryDto,
  ) {
    return this.branchPluService.getEffective(productId, query.sucursalId);
  }

  @Patch('products/:productId/branch-plu')
  @Roles('admin', 'operador')
  @ApiOperation({ summary: 'Upsert o elimina override de PLU por dep├│sito' })
  upsert(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: UpsertBranchPluDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.branchPluService.upsert(productId, dto, user);
  }
}
