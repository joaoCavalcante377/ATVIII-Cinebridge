import type { MigrationInterface, QueryRunner } from 'typeorm';
import { nomeTabela } from './migration.ts';

/** ATVIII: hierarquia de serviços (Composite) e preferências do produtor. Colunas opcionais preservam projetos anteriores. */
export class ServicosProjeto1794000000000 implements MigrationInterface {
  name = 'ServicosProjeto1794000000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    const tabela = nomeTabela((queryRunner.connection.options as { schema?: string }).schema, 'projetos');
    await queryRunner.query(`ALTER TABLE ${tabela} ADD COLUMN servicos jsonb NULL, ADD COLUMN preferencias jsonb NULL`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    const tabela = nomeTabela((queryRunner.connection.options as { schema?: string }).schema, 'projetos');
    await queryRunner.query(`ALTER TABLE ${tabela} DROP COLUMN preferencias, DROP COLUMN servicos`);
  }
}
