import { before, after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { criarDataSource, RepositorioPostgres } from '../../src/infrastructure/database.ts';
import { criarApp } from '../../src/http/app.ts';
import { SistemaRecomendacao } from '../../src/application/recommendation-system.ts';
import { fabricasPadrao } from '../../src/domain/project-factories.ts';
import { AdaptadorLocal, AdaptadorPagSeguro } from '../../src/infrastructure/adaptadores/configuracao.ts';
import { GatewayPagamento } from '../../src/infrastructure/sistemas-externos.ts';
import { profissionaisFamilias } from '../../scripts/family-fixtures.ts';
import { projetoExemplo } from '../../scripts/fixtures.ts';
import { projetoComServicos } from '../../scripts/atv3-fixtures.ts';
import type { EstadoProjeto } from '../../src/domain/types.ts';

if (!process.env.TEST_DATABASE_URL) throw new Error('Defina TEST_DATABASE_URL para testar a ATVIII com PostgreSQL real.');
const schema = `atv3_${randomUUID().replaceAll('-', '')}`;
const db = criarDataSource(process.env.TEST_DATABASE_URL); db.setOptions({ schema });
const repo = new RepositorioPostgres(db);
const pasta = await mkdtemp(path.join(tmpdir(), 'cinebridge-atv3-'));
const sistema = new SistemaRecomendacao(fabricasPadrao(), { armazenamento: new AdaptadorLocal(pasta),
  pagamento: new AdaptadorPagSeguro(new GatewayPagamento('pagseguro')), politicaDecoradores: ['cache', 'auditoria', 'compressao'] });
const { app, servico } = criarApp(repo, { logger: false, worker: false, sistema });
const post = (url: string, payload?: object) => app.inject({ method: 'POST', url, ...(payload ? { payload } : {}) });

describe('ATVIII: Composite, Adapter e Decorator com PostgreSQL', () => {
  before(async () => {
    await db.initialize(); await db.query(`CREATE SCHEMA "${schema}"`); await db.runMigrations();
    for (const p of profissionaisFamilias()) await repo.salvarProfissional(p);
    await app.ready();
  });
  after(async () => {
    await app.close();
    await rm(pasta, { recursive: true, force: true });
    if (db.isInitialized) {
      assert.match(schema, /^atv3_[a-f0-9]{32}$/);
      await db.query(`DROP SCHEMA "${schema}" CASCADE`); await db.destroy();
    }
  });

  it('migração da ATVIII preserva projetos anteriores e é reversível', async () => {
    const legado = await servico.criar(projetoExemplo());
    await db.undoLastMigration();
    const colunas = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'projetos'`, [schema]);
    assert.ok(!colunas.some((c: { column_name: string }) => ['servicos', 'preferencias'].includes(c.column_name)));
    assert.deepEqual((await db.runMigrations()).map(m => m.name), ['ServicosProjeto1794000000000']);
    assert.deepEqual(await servico.buscar(legado.projeto.id), legado);
  });

  it('persiste a hierarquia e a preferência do produtor, e reconstrói o Composite ao carregar', async () => {
    const { papeis: _papeis, ...entrada } = projetoComServicos({ preferencias: { decoradores: ['auditoria'] } });
    const resposta = await post('/projetos', entrada);
    assert.equal(resposta.statusCode, 201, resposta.body);
    const estado = resposta.json<EstadoProjeto>();
    assert.deepEqual(await servico.buscar(estado.projeto.id), estado);
    assert.equal(estado.projeto.servicos?.tipo, 'pacote');
    assert.deepEqual(estado.projeto.preferencias, { decoradores: ['auditoria'] });
    const resumo = (await app.inject(`/projetos/${estado.projeto.id}/servicos`)).json();
    assert.deepEqual([resumo.custoTotalCentavos, resumo.prazoTotalDias, resumo.erros], [210_000, 19, []]);
    assert.equal(resumo.arvore.subservicos[1].subservicos.length, 3);
  });

  it('confirma, paga, anexa arquivos e expõe as métricas dos decoradores', async () => {
    const estado = (await post('/projetos', projetoExemplo())).json<EstadoProjeto>();
    const id = estado.projeto.id;
    let atual = (await post(`/projetos/${id}/aceitar`, {})).json<EstadoProjeto>();
    for (const convite of atual.convites) {
      const r = await post(`/projetos/${id}/convites/${convite.id}/resposta`, { profissionalId: convite.profissionalId, resposta: 'ACEITO' });
      assert.equal(r.statusCode, 200, r.body);
      atual = r.json<EstadoProjeto>();
    }
    assert.equal(atual.equipe.status, 'CONFIRMADA');
    const pagos = await post(`/projetos/${id}/pagamentos`);
    assert.equal(pagos.statusCode, 200, pagos.body);
    assert.equal(pagos.json().provedor, 'pagseguro');
    assert.ok(pagos.json().pagamentos.every((p: { status: string }) => p.status === 'APROVADO'));
    const [evento] = await db.query(`SELECT dados FROM "${schema}".outbox_eventos WHERE "projetoId" = $1 AND tipo = 'pagamentos.processados'`, [id]);
    assert.equal(evento.dados.pagamentos.length, atual.equipe.membros.length);
    const envio = await post(`/projetos/${id}/arquivos`, { nome: 'roteiro final.pdf', conteudoBase64: Buffer.from('FADE IN').toString('base64') });
    assert.equal(envio.statusCode, 201, envio.body);
    assert.match(envio.json().id, /^local:\/\/projetos\//);
    const baixado = await app.inject({ url: `/projetos/${id}/arquivos/conteudo`, query: { arquivoId: envio.json().id } });
    assert.equal(baixado.body, 'FADE IN');
    const metricas = (await app.inject('/recomendador')).json().metricas;
    assert.ok(metricas.compressao.bytesComprimidos < metricas.compressao.bytesOriginais);
    assert.ok(metricas.auditoria.chamadas >= 2);
  });
});
