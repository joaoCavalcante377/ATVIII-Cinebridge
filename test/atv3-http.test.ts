import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { criarApp } from '../src/http/app.ts';
import type { EstadoProjeto } from '../src/domain/types.ts';
import { RepositorioMemoria, projeto, profissional } from './support.ts';
import { projetoComServicos } from '../scripts/atv3-fixtures.ts';

test('HTTP da ATVIII: serviços, arquivos, pagamentos, avaliações e política de decoradores', async () => {
  const repo = new RepositorioMemoria();
  const { app, sistema, servico } = criarApp(repo, { logger: false, worker: false });
  try {
    assert.deepEqual(sistema.adaptadoresConfigurados, { armazenamento: 's3', pagamento: 'stripe', profissional: 'interno' });
    // Composite pela API: papéis omitidos e derivados da hierarquia.
    repo.profissionais.push(...['SONOPLASTA', 'EFEITOS_VISUAIS'].map(papel => profissional(`${papel}-1`, { papeis: [papel as never] })));
    const { papeis: _papeis, ...semPapeis } = projetoComServicos({ inicio: '2026-10-01', prazo: '2026-10-30' });
    const criado = await app.inject({ method: 'POST', url: '/projetos', payload: semPapeis });
    assert.equal(criado.statusCode, 201, criado.body);
    const estado = criado.json<EstadoProjeto>();
    assert.deepEqual(estado.projeto.papeis.map(r => r.papel), ['DIRETOR', 'EDITOR', 'SONOPLASTA', 'EFEITOS_VISUAIS']);
    const servicos = (await app.inject(`/projetos/${estado.projeto.id}/servicos`)).json();
    assert.deepEqual([servicos.custoTotalCentavos, servicos.prazoTotalDias, servicos.erros], [210_000, 19, []]);
    const semNada = await app.inject({ method: 'POST', url: '/projetos', payload: { ...semPapeis, servicos: undefined } });
    assert.equal(semNada.statusCode, 400);
    const ciclo = { tipo: 'pacote', nome: 'A', servicos: [{ tipo: 'atomico', nome: 'x', custoCentavos: 1, prazoDias: 1, papel: 'NINGUEM' }] };
    assert.equal((await app.inject({ method: 'POST', url: '/projetos', payload: { ...semPapeis, servicos: ciclo } })).statusCode, 400);

    // Arquivos pelo adaptador de armazenamento.
    const conteudo = Buffer.from('storyboard cena 1');
    const envio = await app.inject({ method: 'POST', url: `/projetos/${estado.projeto.id}/arquivos`,
      payload: { nome: 'storyboard.png', tipo: 'image/png', categoria: 'storyboard', conteudoBase64: conteudo.toString('base64') } });
    assert.equal(envio.statusCode, 201, envio.body);
    const { id: arquivoId, provedor } = envio.json();
    assert.equal(provedor, 's3');
    assert.deepEqual((await app.inject(`/projetos/${estado.projeto.id}/arquivos`)).json().arquivos, [arquivoId]);
    const baixado = await app.inject({ url: `/projetos/${estado.projeto.id}/arquivos/conteudo`, query: { arquivoId } });
    assert.equal(baixado.statusCode, 200);
    assert.deepEqual(baixado.rawPayload, conteudo);
    assert.equal(baixado.headers['content-type'], 'application/octet-stream');
    // Arquivo de outro projeto não é acessível por este projeto.
    const outro = (await app.inject({ method: 'POST', url: '/projetos', payload: projeto() })).json<EstadoProjeto>();
    assert.equal((await app.inject({ url: `/projetos/${outro.projeto.id}/arquivos/conteudo`, query: { arquivoId } })).statusCode, 404);
    assert.equal((await app.inject({ method: 'POST', url: `/projetos/${randomUUID()}/arquivos`, payload: { nome: 'a', conteudoBase64: 'YWJj' } })).statusCode, 404);
    assert.equal((await app.inject({ method: 'POST', url: `/projetos/${outro.projeto.id}/arquivos`, payload: { nome: 'a', conteudoBase64: '###' } })).statusCode, 400);

    // Pagamento só depois da confirmação da equipe.
    assert.equal((await app.inject({ method: 'POST', url: `/projetos/${outro.projeto.id}/pagamentos` })).statusCode, 409);
    let confirmado = (await app.inject({ method: 'POST', url: `/projetos/${outro.projeto.id}/aceitar`, payload: {} })).json<EstadoProjeto>();
    // Os IDs do dublê em memória não são UUID; a resposta ao convite usa o serviço diretamente.
    for (const convite of confirmado.convites) confirmado = await servico.responder(outro.projeto.id, convite.id, convite.profissionalId, 'ACEITO');
    const pagos = await app.inject({ method: 'POST', url: `/projetos/${outro.projeto.id}/pagamentos` });
    assert.equal(pagos.statusCode, 200, pagos.body);
    const { pagamentos } = pagos.json();
    assert.equal(pagamentos.length, 2);
    const consulta = (await app.inject(`/pagamentos/${pagamentos[0].transacaoId}`)).json();
    assert.deepEqual(consulta, { provedor: 'stripe', transacaoId: pagamentos[0].transacaoId, status: 'APROVADO' });
    assert.equal((await app.inject('/pagamentos/pi_INEXISTENTE')).statusCode, 404);

    // Avaliação pelo adaptador de profissionais.
    const editorId = confirmado.equipe.membros.find(m => m.papel === 'EDITOR')!.profissionalId;
    repo.profissionais = repo.profissionais.map(p => p.id === editorId ? { ...p, id: '00000000-0000-4000-8000-000000000001' } : p);
    const avaliacao = await app.inject({ method: 'POST', url: '/profissionais/00000000-0000-4000-8000-000000000001/avaliacoes',
      payload: { nota: 5, comentario: 'Excelente', data: '2026-11-01' } });
    assert.equal(avaliacao.statusCode, 204, avaliacao.body);
    assert.equal(repo.profissionais.find(p => p.id === '00000000-0000-4000-8000-000000000001')!.avaliacoes.at(-1)!.comentario, 'Excelente');
    assert.equal((await app.inject({ method: 'POST', url: `/profissionais/${randomUUID()}/avaliacoes`, payload: { nota: 5, comentario: '', data: '2026-11-01' } })).statusCode, 404);

    // Política de decoradores em execução e métricas.
    const inicial = (await app.inject('/recomendador')).json();
    assert.deepEqual(inicial.politica, ['cache', 'auditoria']);
    assert.deepEqual(inicial.disponiveis, ['cache', 'auditoria', 'compressao']);
    assert.ok(inicial.metricas.auditoria.chamadas >= 2);
    const alterada = await app.inject({ method: 'PUT', url: '/recomendador/politica', payload: { decoradores: ['cache', 'auditoria', 'compressao'] } });
    assert.deepEqual(alterada.json(), { politica: ['cache', 'auditoria', 'compressao'] });
    await app.inject({ method: 'POST', url: '/projetos', payload: projeto() });
    assert.equal((await app.inject('/recomendador')).json().metricas.compressao.chamadas, 1);
    assert.equal((await app.inject({ method: 'PUT', url: '/recomendador/politica', payload: { decoradores: ['gzip'] } })).statusCode, 422);
    const preferencia = await app.inject({ method: 'POST', url: `/projetos/${outro.projeto.id}/reavaliar`, payload: { preferencias: { decoradores: ['auditoria'] } } });
    assert.equal(preferencia.statusCode, 200, preferencia.body);
    assert.deepEqual(preferencia.json<EstadoProjeto>().projeto.preferencias, { decoradores: ['auditoria'] });
  } finally { await app.close(); }
});
