import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { createHash } from 'node:crypto';
import { Repository } from 'typeorm';

import { ApiExtractorKey } from './entities/api-extractor-key.entity';

export type ExtractorScope = 'invoice:extract';

export type ExtractorAuthContext = {
  key: ApiExtractorKey;
};

const keyHits = new Map<string, number[]>();

@Injectable()
export class ApiExtractorAuthService {
  constructor(
    @InjectRepository(ApiExtractorKey)
    private readonly keyRepo: Repository<ApiExtractorKey>,
  ) {}

  hashExtractorApiKey(token: string): string {
    return createHash('sha256').update(token.trim()).digest('hex');
  }

  private readToken(req: Request): string | null {
    const auth = req.headers.authorization?.trim() ?? '';
    const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    if (bearer) return bearer;
    const header = req.headers['x-api-key'];
    if (typeof header === 'string' && header.trim()) return header.trim();
    return null;
  }

  private hasScope(scopes: string[] | null | undefined, scope: ExtractorScope): boolean {
    const set = new Set(scopes ?? []);
    return set.has('*') || set.has('invoice:*') || set.has(scope);
  }

  private rateLimitOk(keyId: string, limitPerMinute: number): boolean {
    const now = Date.now();
    const windowStart = now - 60_000;
    const existing = (keyHits.get(keyId) ?? []).filter((ts) => ts >= windowStart);
    if (existing.length >= limitPerMinute) {
      keyHits.set(keyId, existing);
      return false;
    }
    existing.push(now);
    keyHits.set(keyId, existing);
    return true;
  }

  async authenticate(params: {
    request: Request;
    scope: ExtractorScope;
    consumeRateLimit?: boolean;
  }): Promise<ExtractorAuthContext> {
    const token = this.readToken(params.request);
    if (!token) {
      throw new UnauthorizedException('API key requerida');
    }

    const keyHash = this.hashExtractorApiKey(token);
    const key = await this.keyRepo.findOne({ where: { keyHash } });
    if (!key?.id) {
      throw new UnauthorizedException('API key invalida');
    }
    if (key.estado !== 'activa') {
      throw new ForbiddenException('API key no activa');
    }
    if (!this.hasScope(key.scopes, params.scope)) {
      throw new ForbiddenException('Scope insuficiente');
    }

    if (params.consumeRateLimit !== false) {
      const limit = Math.max(1, Number(key.rateLimitPorMinuto ?? 10));
      if (!this.rateLimitOk(key.id, limit)) {
        throw new HttpException('Rate limit de API key excedido', HttpStatus.TOO_MANY_REQUESTS);
      }
    }

    await this.keyRepo.update({ id: key.id }, { lastUsedAt: new Date() });
    return { key };
  }
}
