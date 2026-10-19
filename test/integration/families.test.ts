import { before, after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { criarDataSource, RepositorioPostgres } from '../../src/infrastructure/database.ts';
import { criarApp } from '../../src/http/app.ts';
import { projetosFamilias, profissionaisFamilias } from '../../scripts/family-fixtures.ts';
import { projetoExemplo } from '../../scripts/fixtures.ts';
import { EventoEntity } from '../../src/infrastructure/entities.ts';
import type { EstadoProjeto, Notificacao, ProjetoDados } from '../../src/domain/types.ts';

if (!process.env.TEST_DATABASE_URL) throw new Error('Defina TEST_DATABASE_URL para testar as famílias com PostgreSQL real.');
const schema = `familias_${randomUUID().replaceAll('-', '')}`;
const db = criarDataSource(process.env.TEST_DATABASE_URL); db.setOptions({ schema });
const repo = new RepositorioPostgres(db);
const { app, worker, servico } = criarApp(repo, { logger: false, worker: false });
const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload });
const entrada = (p: ProjetoDados) => { const { id: _id, ...dados } = p; return dados; };

describe('ATVII: famílias, protótipos e migração', () => {
  before(async () => {
    await db.initialize(); await db.query(`CREATE SCHEMA "${schema}"`); await db.runMigrations();
    for (const p of profissionaisFamilias()) await repo.salvarProfissional(p);
    await app.ready();
  });
  after(async () => {
    await app.close();
    if (db.isInitialized) {
      assert.match(schema, /^familias_[a-f0-9]{32}$/);
      await db.query(`DROP SCHEMA "${schema}" CASCADE`); await db.destroy();
    }
  });

  it('migração pode ser aplicada a um banco da ATVI sem perder o projeto anterior', async () => {
    const legado = await servico.criar(projetoExemplo());
    await db.undoLastMigration();
    const [registro] = await db.query(`SELECT id FROM "${schema}".projetos WHERE id = $1`, [legado.projeto.id]);
    assert.equal(registro.id, legado.projeto.id);
    const aplicadas = await db.runMigrations();
    assert.equal(aplicadas.length, 1);
    assert.match(aplicadas[0]!.name, /FamiliasProjeto/);
    assert.deepEqual(await servico.buscar(legado.projeto.id), legado);
  });

  it('troca fábricas em chamadas concorrentes sem misturar produtos, persistência ou notificações', async () => {
    const projetos = projetosFamilias();
    const respostas = await Promise.all(projetos.map(p => post('/projetos', entrada(p))));
    for (const [i, resposta] of respostas.entries()) {
      assert.equal(resposta.statusCode, 201, resposta.body);
      const estado = resposta.json<EstadoProjeto>();
      const esperado = projetos[i]!, ids = profissionaisFamilias().slice(i * 3, i * 3 + 3).map(p => p.id);
      assert.equal(estado.projeto.tipoProjeto, esperado.tipoProjeto);
      assert.equal(estado.equipe.membros.length, esperado.papeis.length);
      assert.ok(estado.equipe.membros.every(m => ids.includes(m.profissionalId)));
      assert.deepEqual((await app.inject(`/projetos/${estado.projeto.id}`)).json(), estado);
    }
    await worker.processar();
    for (const [i, resposta] of respostas.entries()) {
      const estado = resposta.json<EstadoProjeto>();
      const notificacoes = (await app.inject(`/projetos/${estado.projeto.id}/notificacoes`)).json<Notificacao[]>();
      assert.ok(notificacoes.length > 0);
      assert.ok(notificacoes.every(n => n.dados.tipoProjeto === projetos[i]!.tipoProjeto));
      const assunto = ['Documentário', 'Animação', 'Publicidade'][i]!;
      assert.ok(notificacoes.filter(n => n.canal === 'interno').every(n => n.assunto.includes(assunto)));
      const relatorio = (await app.inject(`/projetos/${estado.projeto.id}/relatorio`)).json();
      assert.deepEqual(relatorio.inconsistencias, []);
      assert.ok(relatorio.texto.includes(assunto));
    }
  });

  it('restrições específicas devolvem 422 sem gravar projeto nem evento', async () => {
    const antes = await db.getRepository('ProjetoRegistro').count();
    const eventosAntes = await db.getRepository(EventoEntity).count();
    const [doc, anim, pub] = projetosFamilias();
    const invalidos = [
      { ...entrada(doc!), especificacoes: { ...doc!.especificacoes, autorizacoesConfirmadas: false } },
      { ...entrada(anim!), especificacoes: { ...anim!.especificacoes, horasRenderDisponiveis: 1 } },
      { ...entrada(pub!), duracaoMinutos: 5 },
      { ...entrada(pub!), tipoProjeto: 'nao-registrada' },
    ];
    for (const p of invalidos) assert.equal((await post('/projetos', p)).statusCode, 422);
    assert.equal(await db.getRepository('ProjetoRegistro').count(), antes);
    assert.equal(await db.getRepository(EventoEntity).count(), eventosAntes);
  });

  it('modelos podem ser listados e instanciados com ajustes sem alterar o protótipo', async () => {
    const antes = (await app.inject('/prototipos')).json();
    assert.equal(antes.length, 4);
    const resposta = await post('/projetos/modelos/animacao', { titulo: 'Modelo ajustado', especificacoes: { software: 'Maya' } });
    assert.equal(resposta.statusCode, 201, resposta.body);
    const estado = resposta.json<EstadoProjeto>();
    assert.equal(estado.projeto.especificacoes?.software, 'Maya');
    assert.equal(estado.projeto.especificacoes?.framesPorSegundo, 24);
    assert.deepEqual((await app.inject('/prototipos')).json(), antes);
    assert.equal((await post('/projetos/modelos/inexistente', {})).statusCode, 404);
    assert.equal((await post('/projetos/modelos/documentario', {})).statusCode, 422);
    assert.equal((await post('/projetos/modelos/animacao', { tipoProjeto: 'publicitario' })).statusCode, 400);
  });

  it('clona projeto confirmado profundamente, com novos IDs, equipe e convites reiniciados', async () => {
    const resposta = await post('/projetos', entrada(projetosFamilias()[0]!));
    let original = resposta.json<EstadoProjeto>();
    original = await servico.aceitar(original.projeto.id);
    for (const c of original.convites) original = await servico.responder(original.projeto.id, c.id, c.profissionalId, 'ACEITO');
    assert.equal(original.equipe.status, 'CONFIRMADA');
    const clonado = await post(`/projetos/${original.projeto.id}/clonar`, { titulo: 'Continuação',
      especificacoes: { entrevistados: ['Outra pessoa'] }, parametros: { pesoPreco: 0.5 } });
    assert.equal(clonado.statusCode, 201, clonado.body);
    const copia = clonado.json<EstadoProjeto>();
    assert.notEqual(copia.projeto.id, original.projeto.id);
    assert.notEqual(copia.equipe.id, original.equipe.id);
    assert.notEqual(copia.recomendacao.id, original.recomendacao.id);
    assert.equal(copia.projeto.tipoProjeto, 'documentario');
    assert.equal(copia.projeto.especificacoes?.tema, original.projeto.especificacoes?.tema);
    assert.deepEqual(copia.projeto.especificacoes?.entrevistados, ['Outra pessoa']);
    assert.deepEqual(copia.convites, []);
    assert.deepEqual(copia.excluidos, {});
    assert.equal(copia.versao, 1);
    assert.ok(copia.equipe.membros.every(m => !m.aceitoProdutor && !m.confirmado));
    assert.deepEqual(await servico.buscar(original.projeto.id), original);
    assert.equal((await post(`/projetos/${randomUUID()}/clonar`, {})).statusCode, 404);
  });

  it('reavaliação conserva detalhes não alterados e respeita a reserva de orçamento', async () => {
    const original = (await post('/projetos', entrada(projetosFamilias()[1]!))).json<EstadoProjeto>();
    const alterada = await post(`/projetos/${original.projeto.id}/reavaliar`, { especificacoes: { reservaOrcamentoCentavos: 220_000 } });
    assert.equal(alterada.statusCode, 200, alterada.body);
    const estado = alterada.json<EstadoProjeto>();
    assert.equal(estado.projeto.especificacoes?.software, 'Blender');
    assert.ok(estado.equipe.custoCentavos <= 80_000);
    assert.equal(estado.equipe.status, 'PARCIAL');
    const invalida = await post(`/projetos/${original.projeto.id}/reavaliar`, { especificacoes: { horasRenderDisponiveis: 1 } });
    assert.equal(invalida.statusCode, 422);
    assert.deepEqual(await servico.buscar(original.projeto.id), estado);
  });

  it('cache e retry após reinício não misturam famílias nem duplicam mensagens', async () => {
    const estado = await servico.criar(entrada(projetosFamilias()[2]!));
    const repetida = await servico.criar(entrada(projetosFamilias()[2]!));
    assert.notEqual(estado.projeto.id, repetida.projeto.id);
    await worker.processar();
    const antes = await repo.listarNotificacoes(estado.projeto.id);
    const outro = criarApp(repo, { logger: false, worker: false });
    try {
      await db.getRepository(EventoEntity).update({ projetoId: estado.projeto.id }, { status: 'PENDENTE', disponivelEm: new Date(0) });
      await outro.worker.processar();
      assert.equal((await repo.listarNotificacoes(estado.projeto.id)).length, antes.length);
    } finally { await outro.app.close(); }
  });
});
