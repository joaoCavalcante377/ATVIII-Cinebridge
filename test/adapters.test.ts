import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SistemaRecomendacao } from '../src/application/recommendation-system.ts';
import { CatalogoProfissionais } from '../src/application/catalog.ts';
import { ServicoEquipes } from '../src/application/service.ts';
import { traduzirCargo } from '../src/application/adaptadores.ts';
import type { AdaptadorArmazenamento, AdaptadorPagamento, AdaptadorProfissional } from '../src/application/adaptadores.ts';
import { AdaptadorGoogleCloud, AdaptadorIndeed, AdaptadorInterno, AdaptadorLinkedIn, AdaptadorLocal, AdaptadorPagSeguro,
  AdaptadorPayPal, AdaptadorS3, AdaptadorStripe, armazenamentoDoAmbiente, nomeSeguro, pagamentoDoAmbiente } from '../src/infrastructure/adaptadores/configuracao.ts';
import { ApiProfissionalExterna, ArmazenamentoExterno, GatewayPagamento } from '../src/infrastructure/sistemas-externos.ts';
import { FabricaPadrao, Profissional } from '../src/domain/index.ts';
import { PARAMETROS_PADRAO } from '../src/domain/types.ts';
import { RepositorioMemoria, projeto } from './support.ts';
import { perfisIndeed, perfisLinkedIn, projetoComServicos } from '../scripts/atv3-fixtures.ts';

function preparar(sistema = new SistemaRecomendacao()) {
  const repositorio = new RepositorioMemoria();
  sistema.completarAdaptadores({ profissional: new AdaptadorInterno(repositorio) });
  const catalogo = new CatalogoProfissionais(async () => (await sistema.profissional.listarProfissionais()).map(p => p.dados));
  return { repositorio, sistema, servico: new ServicoEquipes(repositorio, catalogo, sistema) };
}

async function equipeConfirmada(servico: ServicoEquipes): Promise<string> {
  const inicial = await servico.criar(projeto());
  let estado = await servico.aceitar(inicial.projeto.id);
  for (const convite of estado.convites) estado = await servico.responder(estado.projeto.id, convite.id, convite.profissionalId, 'ACEITO');
  assert.equal(estado.equipe.status, 'CONFIRMADA');
  return estado.projeto.id;
}

test('Adapter: troca de armazenamento S3 → Google Cloud → disco local sem alterar a regra de negócio', async () => {
  const pasta = await mkdtemp(path.join(tmpdir(), 'cinebridge-'));
  try {
    const { sistema, servico } = preparar();
    const { projeto: { id } } = await servico.criar(projeto());
    const s3 = new ArmazenamentoExterno('s3', 'midias'), gcs = new ArmazenamentoExterno('gcs', 'midias');
    const provedores: [AdaptadorArmazenamento, RegExp][] = [
      [new AdaptadorS3(s3), /^s3:\/\/midias\/projetos\/[0-9a-f-]+\/[0-9a-f-]+\/Roteiro_v2.pdf$/],
      [new AdaptadorGoogleCloud(gcs), /^gs:\/\/midias\/projetos\/[0-9a-f-]+\/\d+-[0-9a-f]{8}-Roteiro_v2.pdf$/],
      [new AdaptadorLocal(pasta), /^local:\/\/projetos\/[0-9a-f-]+\/[0-9a-f-]+-Roteiro_v2.pdf$/],
    ];
    const conteudo = Buffer.from('INT. SET - DIA\nCena 1');
    const pagamento = new AdaptadorStripe(new GatewayPagamento('stripe'));
    for (const [adaptador, formato] of provedores) {
      // Somente a instância injetada muda; o mesmo método do serviço é chamado.
      sistema.configurarAdaptadores(adaptador, pagamento, sistema.profissional);
      const salvo = await servico.anexarArquivo(id, conteudo, { nome: 'Roteiro v2.pdf', tipo: 'application/pdf', categoria: 'roteiro' });
      assert.match(salvo.id, formato);
      assert.equal(salvo.provedor, adaptador.provedor);
      assert.deepEqual(await servico.listarArquivos(id), { provedor: adaptador.provedor, arquivos: [salvo.id] });
      assert.deepEqual(await servico.recuperarArquivo(id, salvo.id), conteudo);
      await assert.rejects(servico.recuperarArquivo(id, `${salvo.id}x`), { status: 404 });
    }
    // O sistema externo recebeu um File com a chave e o tipo traduzidos pelo adaptador.
    const [chave] = await s3.listar('projetos/');
    assert.equal((await s3.download(chave!)).type, 'application/pdf');
    assert.ok((await readdir(path.join(pasta, 'projetos', id))).length === 1);
  } finally { await rm(pasta, { recursive: true, force: true }); }
});

test('Adapter: armazenamento traduz falhas e recusa identificadores de outro provedor ou caminhos inseguros', async () => {
  const externo = new ArmazenamentoExterno('s3', 'midias');
  const s3 = new AdaptadorS3(externo), gcs = new AdaptadorGoogleCloud(new ArmazenamentoExterno('gcs', 'midias'));
  const id = await s3.salvarArquivo(Buffer.from('x'), { nome: '../../etc/passwd', prefixo: 'projetos/p1' });
  assert.ok(!id.includes('..'));
  await assert.rejects(gcs.recuperarArquivo(id), { status: 400 });
  await assert.rejects(s3.recuperarArquivo('s3://midias/inexistente'), { status: 404 });
  await assert.rejects(s3.salvarArquivo(Buffer.alloc(0), { nome: 'vazio' }), { status: 400 });
  await assert.rejects(s3.salvarArquivo(Buffer.from('x'), { nome: ' ' }), { status: 400 });
  await assert.rejects(s3.listarArquivos('../fora'), { status: 400 });
  externo.indisponivel = true;
  await assert.rejects(s3.listarArquivos('projetos/'), { status: 503 });
  await assert.rejects(s3.salvarArquivo(Buffer.from('x'), { nome: 'a' }), { status: 503 });
  const pasta = await mkdtemp(path.join(tmpdir(), 'cinebridge-'));
  try {
    const local = new AdaptadorLocal(path.join(pasta, 'ainda-nao-existe'));
    assert.deepEqual(await local.listarArquivos('projetos/'), []);
    await assert.rejects(local.recuperarArquivo('local://../segredo.txt'), { status: 400 });
    await assert.rejects(local.recuperarArquivo('local://projetos/nada.txt'), { status: 404 });
    await assert.rejects(local.recuperarArquivo('s3://midias/x'), { status: 400 });
  } finally { await rm(pasta, { recursive: true, force: true }); }
  assert.equal(nomeSeguro('Ação final?.mov'), 'Acao_final_.mov');
  assert.equal(nomeSeguro('///'), 'arquivo');
});

test('Adapter: troca de gateway Stripe → PagSeguro → PayPal paga a mesma equipe confirmada', async () => {
  const { sistema, servico } = preparar();
  const id = await equipeConfirmada(servico);
  const gateways = [new GatewayPagamento('stripe'), new GatewayPagamento('pagseguro'), new GatewayPagamento('paypal')];
  const adaptadores: AdaptadorPagamento[] = [new AdaptadorStripe(gateways[0]!), new AdaptadorPagSeguro(gateways[1]!), new AdaptadorPayPal(gateways[2]!)];
  const estado = await servico.buscar(id);
  for (const [i, adaptador] of adaptadores.entries()) {
    sistema.configurarAdaptadores(new AdaptadorS3(new ArmazenamentoExterno('s3', 'm')), adaptador, sistema.profissional);
    const { provedor, pagamentos } = await servico.pagar(id);
    assert.equal(provedor, adaptador.provedor);
    assert.deepEqual(pagamentos.map(p => [p.profissionalId, p.valorCentavos, p.status]),
      estado.equipe.membros.map(m => [m.profissionalId, m.precoCentavos, 'APROVADO']));
    // Cada gateway recebeu o valor na sua unidade e os campos com os seus nomes.
    const transacao = await gateways[i]!.consultarStatus(pagamentos[0]!.transacaoId);
    assert.equal(transacao, ['succeeded', 'PAID', 'COMPLETED'][i]);
    assert.match(pagamentos[0]!.transacaoId, [/^pi_/, /^CHAR_/, /^PAYID-/][i]!);
    // Idempotência: repetir o pagamento devolve as mesmas transações.
    assert.deepEqual((await servico.pagar(id)).pagamentos.map(p => p.transacaoId), pagamentos.map(p => p.transacaoId));
    assert.equal(await adaptador.cancelarPagamento(pagamentos[0]!.transacaoId), true);
    assert.equal(await adaptador.cancelarPagamento(pagamentos[0]!.transacaoId), false);
    assert.equal((await servico.verificarPagamento(pagamentos[0]!.transacaoId)).status, 'CANCELADO');
  }
});

test('Adapter: pagamentos validam a regra de negócio e traduzem respostas do gateway', async () => {
  const { sistema, servico, repositorio } = preparar();
  const gateway = new GatewayPagamento('pagseguro', { limiteAprovacao: 50 });
  sistema.configurarAdaptadores(new AdaptadorS3(new ArmazenamentoExterno('s3', 'm')), new AdaptadorPagSeguro(gateway), sistema.profissional);
  const pendente = await servico.criar(projeto());
  await assert.rejects(servico.pagar(pendente.projeto.id), { status: 409 });
  const id = await equipeConfirmada(servico);
  // R$ 100,00 excede o limite simulado de R$ 50,00: o gateway recusa e o adaptador traduz o status.
  assert.ok((await servico.pagar(id)).pagamentos.every(p => p.status === 'RECUSADO'));
  assert.ok(repositorio.eventos.some(e => e.tipo === 'pagamentos.processados'));
  const stripe = new AdaptadorStripe(new GatewayPagamento('stripe'));
  await assert.rejects(stripe.efetuarPagamento(10.5, 'a', 'b'), { status: 422 });
  await assert.rejects(stripe.efetuarPagamento(100, 'a', 'a'), { status: 422 });
  await assert.rejects(stripe.verificarPagamento('pi_inexistente'), { status: 404 });
  await assert.rejects(new AdaptadorStripe(new GatewayPagamento('paypal')).efetuarPagamento(100, 'a', 'b'), { status: 500 });
  gateway.indisponivel = true;
  await assert.rejects(new AdaptadorPagSeguro(gateway).efetuarPagamento(100, 'a', 'b'), { status: 503 });
  assert.equal(await new AdaptadorPayPal(new GatewayPagamento('paypal')).cancelarPagamento('PAYID-NADA'), false);
});

test('Adapter: LinkedIn, Indeed e cadastro interno alimentam a mesma recomendação', async () => {
  const linkedin = new ApiProfissionalExterna('linkedin', perfisLinkedIn(), { escalaNota: { minimo: 1, maximo: 10 } });
  const indeed = new ApiProfissionalExterna('indeed', perfisIndeed(), { campoId: 'candidate_id' });
  const repositorio = new RepositorioMemoria();
  repositorio.profissionais = (await new AdaptadorLinkedIn(linkedin).listarProfissionais()).map(p => ({ ...p.dados, id: p.dados.id.replace('linkedin:', 'interno-') }));
  const fontes: AdaptadorProfissional[] = [new AdaptadorLinkedIn(linkedin), new AdaptadorIndeed(indeed), new AdaptadorInterno(repositorio)];
  const sistema = new SistemaRecomendacao();
  const p = new FabricaPadrao().criarProjeto({ ...projetoComServicos(), id: 'projeto-externo', parametros: PARAMETROS_PADRAO });
  for (const fonte of fontes) {
    sistema.configurarAdaptadores(new AdaptadorS3(new ArmazenamentoExterno('s3', 'm')), new AdaptadorStripe(new GatewayPagamento('stripe')), fonte);
    const equipe = await sistema.executarRecomendacao(p);
    assert.equal(equipe.status, 'SUGERIDA', `${fonte.provedor}: ${JSON.stringify(equipe)}`);
    assert.deepEqual(equipe.membros.map(m => m.papel), ['DIRETOR', 'EDITOR', 'SONOPLASTA', 'EFEITOS_VISUAIS']);
    const prefixo = { linkedin: 'linkedin:', indeed: 'indeed:', interno: 'interno-' }[fonte.provedor]!;
    assert.ok(equipe.membros.every(m => m.profissionalId.startsWith(prefixo)));
  }
});

test('Adapter: perfis externos são traduzidos para o modelo interno, inclusive escalas de nota', async () => {
  const linkedin = new ApiProfissionalExterna('linkedin', perfisLinkedIn(), { escalaNota: { minimo: 1, maximo: 10 } });
  const adaptador = new AdaptadorLinkedIn(linkedin);
  const lista = await adaptador.listarProfissionais({ papeis: ['EDITOR'], localizacao: 'São Paulo' });
  assert.ok(lista.every(p => p instanceof Profissional));
  const editor = await adaptador.detalharProfissional('linkedin:li-002');
  assert.deepEqual(lista.map(p => p.dados), [editor.dados]);
  assert.deepEqual(editor.dados.papeis, ['EDITOR']);
  assert.equal(editor.dados.precoCentavos, 60_000);
  assert.deepEqual(editor.dados.competencias, [{ nome: 'montagem', nivel: 5 }, { nome: 'colorização', nivel: 3 }]);
  assert.equal(editor.dados.avaliacoes[0]!.nota, 4.5);
  // Profissional remoto entra na busca por localidade; perfil sem papel técnico é ignorado.
  assert.ok((await adaptador.listarProfissionais({ localizacao: 'Recife' })).some(p => p.dados.id === 'linkedin:li-004'));
  assert.ok(!(await adaptador.listarProfissionais()).some(p => p.dados.id === 'linkedin:li-005'));
  await assert.rejects(adaptador.detalharProfissional('linkedin:li-005'), { status: 422 });
  await assert.rejects(adaptador.detalharProfissional('indeed:in-101'), { status: 400 });
  await assert.rejects(adaptador.detalharProfissional('linkedin:nao-existe'), { status: 404 });
  // Nota 4 (0–5) vira 8 na escala de 1 a 10 da rede; no portal, 3,6 vira 4 estrelas.
  await adaptador.registrarAvaliacao('linkedin:li-002', { nota: 4, comentario: 'Ótimo', data: '2027-04-01' });
  assert.deepEqual((await linkedin.obterPerfil('li-002')).notasRecebidas, [8]);
  const indeed = new ApiProfissionalExterna('indeed', perfisIndeed(), { campoId: 'candidate_id' });
  await new AdaptadorIndeed(indeed).registrarAvaliacao('indeed:in-102', { nota: 3.6, comentario: '', data: '2027-04-01' });
  assert.deepEqual((await indeed.obterPerfil('in-102')).notasRecebidas, [4]);
  const rita = await new AdaptadorIndeed(indeed).detalharProfissional('indeed:in-102');
  assert.deepEqual([rita.dados.nome, rita.dados.papeis, rita.dados.precoCentavos], ['Rita Lima', ['EDITOR'], 55_000]);
  await assert.rejects(adaptador.registrarAvaliacao('linkedin:li-002', { nota: 6, comentario: '', data: '2027-04-01' }), { status: 422 });
  linkedin.indisponivel = true;
  await assert.rejects(adaptador.listarProfissionais(), { status: 503 });
  await assert.rejects(adaptador.registrarAvaliacao('linkedin:li-002', { nota: 4, comentario: '', data: '2027-04-01' }), { status: 503 });
});

test('Adapter interno registra avaliações concorrentes sem perder nenhuma', async () => {
  const { servico, repositorio } = preparar();
  await Promise.all([1, 2, 3, 4].map(nota => servico.avaliarProfissional('editor-1', { nota, comentario: `nota ${nota}`, data: '2027-01-01' })));
  const editor = repositorio.profissionais.find(p => p.id === 'editor-1')!;
  assert.deepEqual(editor.avaliacoes.slice(-4).map(a => a.nota).sort(), [1, 2, 3, 4]);
  await assert.rejects(servico.avaliarProfissional('nao-existe', { nota: 3, comentario: '', data: '2027-01-01' }), { status: 404 });
  await assert.rejects(servico.avaliarProfissional('editor-1', { nota: 3, comentario: '', data: 'ontem' }), { status: 422 });
});

test('Adapter: tradução de cargos, configuração por ambiente e ausência de adaptador', async () => {
  assert.equal(traduzirCargo('Diretor de Fotografia'), 'DIRETOR_FOTOGRAFIA');
  assert.equal(traduzirCargo('Film Director'), 'DIRETOR');
  assert.equal(traduzirCargo('efeitos_visuais'), 'EFEITOS_VISUAIS');
  assert.equal(traduzirCargo('Produtor audiovisual'), undefined);
  assert.equal(armazenamentoDoAmbiente({}).provedor, 'local');
  assert.equal(armazenamentoDoAmbiente({ ARMAZENAMENTO: 's3' }).provedor, 's3');
  assert.equal(armazenamentoDoAmbiente({ ARMAZENAMENTO: 'gcs' }).provedor, 'gcs');
  assert.throws(() => armazenamentoDoAmbiente({ ARMAZENAMENTO: 'ftp' }), /ARMAZENAMENTO inválido/);
  assert.deepEqual(['stripe', 'pagseguro', 'paypal'].map(PAGAMENTO => pagamentoDoAmbiente({ PAGAMENTO }).provedor), ['stripe', 'pagseguro', 'paypal']);
  assert.equal(pagamentoDoAmbiente({}).provedor, 'stripe');
  assert.throws(() => pagamentoDoAmbiente({ PAGAMENTO: 'boleto' }), /PAGAMENTO inválido/);
  const sistema = new SistemaRecomendacao();
  assert.deepEqual(sistema.adaptadoresConfigurados, { armazenamento: undefined, pagamento: undefined, profissional: undefined });
  assert.throws(() => sistema.armazenamento, { status: 503 });
  assert.throws(() => sistema.pagamento, { status: 503 });
  await assert.rejects(sistema.executarRecomendacao(new FabricaPadrao().criarProjeto({})), { status: 503 });
});
