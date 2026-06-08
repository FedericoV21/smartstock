import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NB-LEC-001 Phase B: origen_precio.lector_factura para contador IA del lector.
 */
export class NbLec001OrigenLectorFactura1750110000000 implements MigrationInterface {
  name = 'NbLec001OrigenLectorFactura1750110000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TYPE public.origen_precio ADD VALUE IF NOT EXISTS 'lector_factura';
`);
  }

  public async down(): Promise<void> {
    // PostgreSQL no permite quitar valores de enum de forma segura.
  }
}
