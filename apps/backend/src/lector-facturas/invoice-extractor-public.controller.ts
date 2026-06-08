import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { Public } from '../auth/decorators/public.decorator';
import { InvoiceExtractorService } from './invoice-extractor.service';

@ApiTags('public-invoice-extractor')
@Public()
@Controller('public/invoice-extractor')
export class InvoiceExtractorPublicController {
  constructor(private readonly extractorService: InvoiceExtractorService) {}

  @Post('extract')
  @HttpCode(HttpStatus.OK)
  @ApiHeader({ name: 'Authorization', required: false, description: 'Bearer API key' })
  @ApiHeader({ name: 'X-Api-Key', required: false })
  @ApiOperation({
    summary: 'Extracción pura de factura IA (API pública)',
    description: 'Paridad POST /api/public/invoice-extractor/extract — sin tenant SmartStock',
  })
  extract(@Req() request: Request, @Body() body: unknown) {
    return this.extractorService.extract(request, body);
  }
}
