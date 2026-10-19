import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Projeto, ProjetoDocumentario, ProjetoAnimacao, ProjetoPublicitario,
  FabricaPadrao, FabricaDocumentario, FabricaAnimacao, FabricaPublicitario,
  RegistroFabricas, RegistroPrototipos, OrquestradorPadrao,
  ValidadorFamilia, NotificadorFamilia, NotificadorAnimacao, horasRender } from '../src/domain/index.ts';
import type { Equipe, Evento, Notificacao } from '../src/domain/types.ts';
import { SistemaRecomendacao } from '../src/application/recommendation-system.ts';
import { projetosFamilias, profissionaisFamilias } from '../scripts/family-fixtures.ts';

test('Prototype mantém o tipo concreto e copia profundamente todos os dados agregados', () => {
  const fabricas = [new FabricaDocumentario(), new FabricaAnimacao(), new FabricaPublicitario()];
  for (const [i, fabrica] of fabricas.entries()) {
    const original = fabrica.criarProjeto(projetosFamilias()[i]!);
    original.dados.papeis[0]!.competencias.push({ nome: 'original', nivel: 3 });
    const antes = structuredClone(original.dados);
    const copia = original.clonar();
    assert.ok(copia instanceof original.constructor);
    assert.equal(copia.criarFabrica().tipo, fabrica.tipo);
    assert.deepEqual(copia.dados, original.dados);
    copia.dados.papeis[0]!.competencias[0]!.nivel = 1;
    copia.dados.parametros.pesoPreco = 0.9;
    copia.dados.especificacoes!.reservaOrcamentoCentavos = 0;
    copia.dados.especificacoes!.entrevistados?.push('Nova pessoa');
    copia.dados.especificacoes!.canais?.push('radio');
    assert.deepEqual(original.dados, antes);
    assert.notEqual(original.dados.papeis, copia.dados.papeis);
    assert.notEqual(original.dados.especificacoes, copia.dados.especificacoes);
  }
});

test('Factory Method da subclasse fabrica toda a família correspondente', () => {
  const classes = [ProjetoDocumentario, ProjetoAnimacao, ProjetoPublicitario];
  for (const [i, dados] of projetosFamilias().entries()) {
    const p = new classes[i]!(dados);
    const fabrica = p.criarFabrica();
    assert.equal(fabrica.tipo, dados.tipoProjeto);
    const criado = fabrica.criarProjeto({ titulo: 'Outra obra' });
    assert.ok(criado instanceof classes[i]!);
    assert.notEqual(criado.dados.id, p.dados.id);
    assert.deepEqual(criado.aceitar(fabrica.criarValidador()), []);
    assert.ok(fabrica.criarRecomendador(criado.dados).recomendar(criado.dados, profissionaisFamilias()));
    assert.equal(typeof criado.aceitar(fabrica.criarRelatorio()), 'string');
  }
});

test('registro de protótipos protege modelos contra alterações externas', () => {
  const r = new RegistroPrototipos();
  const original = new FabricaAnimacao().criarProjeto({});
  r.registrar('curta-3d', original);
  original.dados.especificacoes!.software = 'Alterado fora';
  const copia = r.clonar('curta-3d');
  copia.dados.especificacoes!.software = 'Alterado na cópia';
  r.listar()[0]!.dados.papeis.length = 0;
  assert.equal(r.clonar('curta-3d').dados.especificacoes!.software, 'Blender');
  assert.equal(r.clonar('curta-3d').dados.papeis.length, 2);
  assert.throws(() => r.registrar('curta-3d', original));
  assert.throws(() => r.registrar(' ', original));
  assert.throws(() => r.clonar('inexistente'), { status: 404 });
});

test('fábricas recusam protótipos de outra família mesmo com tipagem estrutural', () => {
  const doc = new FabricaDocumentario().criarProjeto({});
  const anim = new FabricaAnimacao().criarProjeto({});
  assert.throws(() => new FabricaPadrao(doc), /incompatível/);
  assert.throws(() => new FabricaDocumentario(anim), /incompatível/);
  assert.throws(() => new FabricaAnimacao(doc), /incompatível/);
  assert.throws(() => new FabricaPublicitario(doc), /incompatível/);
});

test('famílias validam suas restrições e alteram os rankings sobre o mesmo cadastro', () => {
  const sistema = new SistemaRecomendacao();
  const dados = projetosFamilias(), pessoas = profissionaisFamilias();
  for (const [i, p] of dados.entries()) {
    const resultado = sistema.recomendar(p, pessoas);
    const permitidos = pessoas.slice(i * 3, i * 3 + 3).map(p => p.id);
    assert.ok(resultado.equipe.membros.every(m => permitidos.includes(m.profissionalId)));
    assert.ok(resultado.equipe.membros.length > 0);
    assert.ok(resultado.equipe.custoCentavos + p.especificacoes!.reservaOrcamentoCentavos! <= p.orcamentoCentavos);
  }
  assert.throws(() => sistema.recomendar({ ...dados[0]!, especificacoes: { ...dados[0]!.especificacoes, autorizacoesConfirmadas: false } }, pessoas), /autorizações/);
  assert.throws(() => sistema.recomendar({ ...dados[1]!, especificacoes: { ...dados[1]!.especificacoes, horasRenderDisponiveis: 1 } }, pessoas), /renderização/);
  assert.throws(() => sistema.recomendar({ ...dados[2]!, duracaoMinutos: 2 }, pessoas), /briefing/);
});

test('validações rejeitam família, papéis, reserva e detalhes incompatíveis', () => {
  const fabricas = [new FabricaDocumentario(), new FabricaAnimacao(), new FabricaPublicitario()];
  for (const [i, fabrica] of fabricas.entries()) {
    assert.throws(() => fabrica.criarProjeto({ tipoProjeto: 'outra' }), /incompatível/);
    const p = fabrica.criarProjeto(projetosFamilias()[i]!);
    p.dados.especificacoes!.reservaOrcamentoCentavos = p.dados.orcamentoCentavos + 1;
    p.dados.papeis = [];
    assert.ok(p.aceitar(fabrica.criarValidador()).length >= 2);
    const outro = new Projeto({ ...p.dados, tipoProjeto: 'outra' });
    assert.ok(outro.aceitar(fabrica.criarValidador()).some(e => e.includes('famílias')));
  }
  const doc = fabricas[0]!.criarProjeto({ tipoCaptacao: 'ficcao', especificacoes: { tema: '', entrevistados: ['A', 'a'] } });
  assert.ok(doc.aceitar(fabricas[0]!.criarValidador()).length >= 3);
  const anim = fabricas[1]!.criarProjeto({ tipoCaptacao: 'ficcao', especificacoes: {
    tecnica: '3d', software: '', framesPorSegundo: 0, tempoRenderPorFrameSegundos: 0, horasRenderDisponiveis: 0,
  } });
  assert.ok(anim.aceitar(fabricas[1]!.criarValidador()).length >= 3);
  anim.dados.especificacoes!.horasRenderDisponiveis = 999999;
  assert.ok(anim.aceitar(fabricas[1]!.criarValidador()).some(e => e.includes('período')));
  const pub = fabricas[2]!.criarProjeto({ especificacoes: { cliente: '', canais: [], duracaoMaximaSegundos: 0 } });
  assert.ok(pub.aceitar(fabricas[2]!.criarValidador()).length >= 3);
  assert.equal(horasRender(new FabricaPadrao().criarProjeto({}).dados), 0);
});

test('relatório e validação de equipe incluem as métricas da família', () => {
  const fabrica = new FabricaAnimacao(), p = fabrica.criarProjeto({});
  const resultado = new OrquestradorPadrao(fabrica).orquestrar(p.dados, profissionaisFamilias());
  assert.match(p.aceitar(fabrica.criarRelatorio(resultado.equipe, profissionaisFamilias())), /renderização estimada 4.00 h/);
  const equipe: Equipe = { ...resultado.equipe, custoCentavos: p.dados.orcamentoCentavos };
  assert.ok(p.aceitar(fabrica.criarValidador(equipe)).some(e => e.includes('reserva')));
});

test('notificador específico é idempotente, isolado e respeita cancelamento', async () => {
  const salvas = new Map<string, Notificacao>();
  const notificador = new NotificadorAnimacao({ async salvarNotificacao(n) { salvas.set(n.id, n); } });
  const evento: Evento = { id: randomUUID(), tipo: 'recomendacao.gerada', projetoId: randomUUID(), ocorridoEm: new Date().toISOString(),
    dados: { tipoProjeto: 'animacao', destinatarios: ['pessoa', 'pessoa', 4, ''] } };
  const signal = new AbortController().signal;
  await notificador.atualizar(evento, signal); await notificador.atualizar(evento, signal);
  assert.equal(salvas.size, 1);
  assert.match([...salvas.values()][0]!.assunto, /Animação/);
  await assert.rejects(notificador.atualizar({ ...evento, dados: { tipoProjeto: 'publicitario' } }, signal), /incompatível/);
  await notificador.atualizar({ ...evento, dados: { tipoProjeto: 'animacao' } }, signal);
  const abortado = new AbortController(); abortado.abort();
  await assert.rejects(notificador.atualizar(evento, abortado.signal));
  await assert.rejects(new SistemaRecomendacao().criarObservador({ async salvarNotificacao() {} })
    .atualizar({ ...evento, dados: { tipoProjeto: 42 } }, signal) as Promise<void>, /Tipo inválido/);
});

test('quarta família é adicionada sem modificar o orquestrador', async () => {
  class ValidadorVR extends ValidadorFamilia { protected override tipo = 'vr'; }
  class NotificadorVR extends NotificadorFamilia { protected override tipo = 'vr'; protected override titulo = 'Realidade virtual'; }
  class ProjetoVR extends Projeto { override criarFabrica() { return new FabricaVR(this); } }
  class FabricaVR extends FabricaPadrao {
    override readonly tipo = 'vr';
    override criarValidador(equipe?: Equipe) { return new ValidadorVR(equipe); }
    override criarNotificador(destino: { salvarNotificacao(n: Notificacao): Promise<void> }) { return new NotificadorVR(destino); }
  }
  const base = new FabricaPadrao().criarProjeto({}).dados;
  const fabrica = new FabricaVR(new ProjetoVR({ ...base, tipoProjeto: 'vr' }));
  const registro = new RegistroFabricas(); registro.registrar(fabrica);
  const sistema = new SistemaRecomendacao(registro), p = fabrica.criarProjeto({});
  assert.equal(sistema.recomendar(p.dados, profissionaisFamilias()).equipe.membros.length, 2);
  assert.equal(sistema.prototipos.clonar('vr').criarFabrica().tipo, 'vr');
  assert.throws(() => registro.registrar(fabrica));
  assert.throws(() => registro.obter('inexistente'));
  class FabricaInvalida extends FabricaPadrao { override readonly tipo = 'Tipo inválido'; }
  assert.throws(() => registro.registrar(new FabricaInvalida()));
  const salvas: Notificacao[] = [];
  await sistema.criarObservador({ async salvarNotificacao(n) { salvas.push(n); } }).atualizar({ id: 'vr1', tipo: 'recomendacao.gerada', projetoId: p.dados.id,
    ocorridoEm: new Date().toISOString(), dados: { tipoProjeto: 'vr', destinatarios: ['produtor'] } }, new AbortController().signal);
  assert.match(salvas[0]!.assunto, /Realidade virtual/);
});
