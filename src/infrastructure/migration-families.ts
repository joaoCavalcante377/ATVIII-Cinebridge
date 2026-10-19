import type { MigrationInterface, QueryRunner } from 'typeorm';
import { nomeTabela } from './migration.ts';

export class FamiliasProjeto1792000000000 implements MigrationInterface {
  name = 'FamiliasProjeto1792000000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    const tabela = nomeTabela((queryRunner.connection.options as { schema?: string }).schema, 'projetos');
    await queryRunner.query(`ALTER TABLE ${tabela} ADD COLUMN "tipoProjeto" text NULL, ADD COLUMN especificacoes jsonb NULL`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    const tabela = nomeTabela((queryRunner.connection.options as { schema?: string }).schema, 'projetos');
    await queryRunner.query(`ALTER TABLE ${tabela} DROP COLUMN especificacoes, DROP COLUMN "tipoProjeto"`);
  }
}
