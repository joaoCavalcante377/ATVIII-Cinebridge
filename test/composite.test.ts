import test from 'node:test';
import assert from 'node:assert/strict';
import { PacoteServico, ServicoAtomico, criarServico, resumirServico, Projeto, FabricaPadrao, FabricaAnimacao,
  ValidadorConsistencia, PROFUNDIDADE_MAXIMA_SERVICOS } from '../src/domain/index.ts';
import type { ServicoDados } from '../src/domain/types.ts';
import { PARAMETROS_PADRAO } from '../src/domain/types.ts';
import { CatalogoProfissionais } from '../src/application/catalog.ts';
import { ServicoEquipes } from '../src/application/service.ts';
import { RepositorioMemoria, projeto, profissional } from './support.ts';
import { projetoComServicos, servicosPosProducao } from '../scripts/atv3-fixtures.ts';

const edicao = () => new ServicoAtomico('Edição', 40_000, 6, 'EDITOR', [{ nome: 'montagem', nivel: 5 }]);

test('Composite: folha e pacote respondem pela mesma interface', () => {
  const folha = edicao();
  assert.equal(folha.calcularCusto(), 40_000);
  assert.equal(folha.obterPrazo(), 6);
  assert.deepEqual(folha.listarSubservicos(), []);
  assert.deepEqual(folha.validar(), []);
  const pacote = new PacoteServico('Imagem', [folha]);
  for (const servico of [folha, pacote]) {
    assert.equal(typeof servico.calcularCusto(), 'number');
    assert.ok(Array.isArray(servico.listarSubservicos()));
    assert.equal(typeof servico.obterPrazo(), 'number');
    assert.ok(Array.isArray(servico.validar()));
  }
});

test('Composite: custo e prazo corretos em profundidades e formas diferentes', () => {
  // Profundidade 1: só um serviço atômico.
  assert.equal(criarServico({ tipo: 'atomico', nome: 'Roteiro', custoCentavos: 5_000, prazoDias: 4, papel: 'ROTEIRISTA' }).calcularCusto(), 5_000);
  // Profundidade 2: sequencial soma prazos; paralelo usa o maior.
  const filhos = () => [edicao(), new ServicoAtomico('Mixagem', 25_000, 5, 'SONOPLASTA')];
  assert.deepEqual([new PacoteServico('S', filhos()).calcularCusto(), new PacoteServico('S', filhos()).obterPrazo()], [65_000, 11]);
  assert.deepEqual([new PacoteServico('P', filhos(), { execucao: 'paralela' }).calcularCusto(), new PacoteServico('P', filhos(), { execucao: 'paralela' }).obterPrazo()], [65_000, 6]);
  // Profundidade 4: hierarquia da atividade (direção + pós-produção paralela com subpacote de imagem).
  const completa = criarServico(servicosPosProducao());
  assert.equal(completa.calcularCusto(), 90_000 + 40_000 + 20_000 + 25_000 + 35_000);
  assert.equal(completa.obterPrazo(), 10 + Math.max(6 + 3, 5, 8));
  const pos = completa.listarSubservicos()[1]!;
  assert.equal(pos.calcularCusto(), 120_000);
  assert.equal(pos.obterPrazo(), 9);
  // Profundidade máxima: cadeia de pacotes até o limite aceito.
  let profundo: ServicoDados = { tipo: 'atomico', nome: 'Folha', custoCentavos: 1, prazoDias: 1, papel: 'EDITOR' };
  for (let i = 1; i < PROFUNDIDADE_MAXIMA_SERVICOS; i++) profundo = { tipo: 'pacote', nome: `Nível ${i}`, servicos: [profundo] };
  assert.deepEqual([criarServico(profundo).calcularCusto(), criarServico(profundo).obterPrazo()], [1, 1]);
  assert.throws(() => criarServico({ tipo: 'pacote', nome: 'Excesso', servicos: [profundo] }), /níveis/);
  // Pacote vazio não tem custo nem prazo, mas é inválido.
  const vazio = new PacoteServico('Vazio');
  assert.deepEqual([vazio.calcularCusto(), vazio.obterPrazo()], [0, 0]);
  assert.match(vazio.validar().join(), /ao menos um serviço/);
});

test('Composite: validação recursiva aponta o caminho do nó inválido', () => {
  const dados = servicosPosProducao() as Extract<ServicoDados, { tipo: 'pacote' }>;
  const pos = dados.servicos[1] as Extract<ServicoDados, { tipo: 'pacote' }>;
  const imagem = pos.servicos[0] as Extract<ServicoDados, { tipo: 'pacote' }>;
  imagem.servicos[1] = { tipo: 'atomico', nome: 'Coloração', custoCentavos: -1, prazoDias: 0, papel: 'COLORISTA' as never };
  const erros = criarServico(dados).validar();
  assert.ok(erros.some(e => e === 'Produção completa › Pós-produção › Imagem › Coloração: papel técnico inválido.'), erros.join('\n'));
  assert.ok(erros.some(e => e.endsWith('Coloração: custo deve ser inteiro não negativo em centavos.')));
  assert.ok(erros.some(e => e.endsWith('Coloração: prazo deve ser um número inteiro de dias, a partir de 1.')));
  // Prazo do pacote acima do limite declarado.
  const lento = new PacoteServico('Pós', [new ServicoAtomico('VFX', 1, 20, 'EFEITOS_VISUAIS')], { prazoMaximoDias: 12 });
  assert.match(lento.validar().join(), /20 dia\(s\) excede o máximo de 12/);
  // Nomes repetidos no mesmo pacote e competências repetidas.
  const repetido = new PacoteServico('Pacote', [edicao(), edicao(), new ServicoAtomico('Som', 1, 1, 'SONOPLASTA', [{ nome: 'Mix', nivel: 3 }, { nome: 'mix', nivel: 2 }])]);
  assert.match(repetido.validar().join('\n'), /mesmo nome/);
  assert.match(repetido.validar().join('\n'), /competências inválidas/);
  assert.throws(() => criarServico({ tipo: 'outro' } as never), /atomico ou pacote/);
});

test('Composite: ciclos e instâncias repetidas são recusados', () => {
  const raiz = new PacoteServico('Raiz');
  const filho = new PacoteServico('Filho');
  raiz.adicionar(filho);
  assert.throws(() => filho.adicionar(raiz), /conter a si mesmo/);
  assert.throws(() => raiz.adicionar(raiz), /conter a si mesmo/);
  const folha = edicao();
  filho.adicionar(folha);
  assert.throws(() => raiz.adicionar(folha), /já faz parte/);
  assert.equal(filho.remover(folha), true);
  assert.equal(filho.remover(folha), false);
  raiz.adicionar(folha);
  assert.equal(raiz.calcularCusto(), 40_000);
});

test('Projeto delega custo, prazo e validação ao serviço principal', () => {
  const p = new FabricaPadrao().criarProjeto({ ...projetoComServicos(), id: 'p1', parametros: PARAMETROS_PADRAO });
  assert.equal(p.calcularCustoTotal(), p.servicoPrincipal.calcularCusto());
  assert.equal(p.calcularCustoTotal(), 210_000);
  assert.equal(p.calcularPrazoTotal(), 19);
  // Os papéis da recomendação vêm das folhas; serviços do mesmo papel somam peso e unem competências.
  assert.deepEqual(p.dados.papeis.map(r => r.papel), ['DIRETOR', 'EDITOR', 'SONOPLASTA', 'EFEITOS_VISUAIS']);
  const editor = p.dados.papeis.find(r => r.papel === 'EDITOR')!;
  assert.equal(editor.peso, 2);
  assert.deepEqual(editor.competencias.map(c => c.nome), ['montagem', 'colorização']);
  assert.deepEqual(p.validarEstrutura(), []);
  assert.deepEqual(p.aceitar(new ValidadorConsistencia()), []);
  assert.equal(p.servicoPrincipal, p.servicoPrincipal);
  // O validador do projeto inclui a validação recursiva e a coerência com prazo e orçamento.
  const curto = new FabricaPadrao().criarProjeto({ ...projetoComServicos({ prazo: '2027-03-10' }), id: 'p2', parametros: PARAMETROS_PADRAO });
  assert.match(curto.aceitar(new ValidadorConsistencia()).join(), /exigem 19 dia\(s\), mas o período do projeto tem 10/);
  const caro = new FabricaPadrao().criarProjeto({ ...projetoComServicos({ orcamentoCentavos: 100_000 }), id: 'p3', parametros: PARAMETROS_PADRAO });
  assert.match(caro.validarEstrutura().join(), /excede o orçamento/);
  const adulterado = new Projeto({ ...p.dados, papeis: p.dados.papeis.slice(1) });
  assert.match(adulterado.validarEstrutura().join(), /não correspondem/);
  const malformado = new Projeto({ ...p.dados, servicos: { tipo: 'x' } as never });
  assert.match(malformado.validarEstrutura().join(), /atomico ou pacote/);
});

test('Projeto sem hierarquia continua válido e é representado por um pacote derivado dos papéis', () => {
  const legado = new FabricaPadrao().criarProjeto({ ...projeto(), id: 'legado', parametros: PARAMETROS_PADRAO });
  assert.equal(legado.dados.servicos, undefined);
  assert.equal(legado.calcularCustoTotal(), 0);
  assert.equal(legado.calcularPrazoTotal(), 15);
  assert.deepEqual(legado.servicoPrincipal.listarSubservicos().map(s => s.nome), ['DIRETOR', 'EDITOR']);
  assert.deepEqual(legado.validarEstrutura(), []);
});

test('clonagem e ajustes reconstroem a árvore sem compartilhar referências', () => {
  const original = new FabricaAnimacao().criarProjeto({ id: 'a1', servicos: { tipo: 'pacote', nome: 'Animação', servicos: [
    { tipo: 'atomico', nome: 'Modelagem', custoCentavos: 10_000, prazoDias: 5, papel: 'EFEITOS_VISUAIS' },
    { tipo: 'atomico', nome: 'Montagem', custoCentavos: 5_000, prazoDias: 3, papel: 'EDITOR' }] } });
  const copia = original.clonar();
  assert.notEqual(copia.servicoPrincipal, original.servicoPrincipal);
  assert.equal(copia.calcularCustoTotal(), 15_000);
  copia.definirServicoPrincipal(new PacoteServico('Novo', [new ServicoAtomico('Montagem', 1, 1, 'EDITOR'), new ServicoAtomico('VFX', 1, 1, 'EFEITOS_VISUAIS')]));
  assert.equal(copia.calcularCustoTotal(), 2);
  assert.equal(original.calcularCustoTotal(), 15_000);
  assert.deepEqual(copia.dados.papeis.map(r => r.papel), ['EDITOR', 'EFEITOS_VISUAIS']);
  // Uma nova lista de papéis sem hierarquia descarta a hierarquia herdada.
  const ajustado = original.criarFabrica().criarProjeto({ papeis: [{ papel: 'EDITOR', peso: 1, competencias: [] }, { papel: 'EFEITOS_VISUAIS', peso: 1, competencias: [] }] });
  assert.equal(ajustado.dados.servicos, undefined);
});

test('serviço de equipes recomenda pelos papéis da hierarquia e resume a árvore com os responsáveis', async () => {
  const repositorio = new RepositorioMemoria();
  repositorio.profissionais = [
    profissional('diretor-1', { disponibilidade: { inicio: '2027-01-01', fim: '2027-12-31' } }),
    profissional('editor-1', { papeis: ['EDITOR'], competencias: [{ nome: 'montagem', nivel: 5 }, { nome: 'colorização', nivel: 4 }], disponibilidade: { inicio: '2027-01-01', fim: '2027-12-31' } }),
    profissional('som-1', { papeis: ['SONOPLASTA'], competencias: [{ nome: 'mixagem', nivel: 4 }], disponibilidade: { inicio: '2027-01-01', fim: '2027-12-31' } }),
    profissional('vfx-1', { papeis: ['EFEITOS_VISUAIS'], competencias: [{ nome: 'composição', nivel: 4 }], disponibilidade: { inicio: '2027-01-01', fim: '2027-12-31' } }),
  ];
  const servico = new ServicoEquipes(repositorio, new CatalogoProfissionais(() => repositorio.listarProfissionais()));
  const estado = await servico.criar(projetoComServicos());
  assert.equal(estado.equipe.status, 'SUGERIDA');
  assert.deepEqual(estado.equipe.membros.map(m => m.profissionalId), ['diretor-1', 'editor-1', 'som-1', 'vfx-1']);
  const resumo = await servico.servicos(estado.projeto.id);
  assert.equal(resumo.custoTotalCentavos, 210_000);
  assert.equal(resumo.prazoTotalDias, 19);
  assert.deepEqual(resumo.erros, []);
  const coloracao = resumo.arvore.subservicos[1]!.subservicos[0]!.subservicos[1]!;
  assert.equal(coloracao.nome, 'Coloração');
  assert.deepEqual(coloracao.responsaveis, [{ papel: 'EDITOR', profissionalId: 'editor-1' }]);
  assert.deepEqual(resumirServico(edicao()).subservicos, []);
  await assert.rejects(servico.criar(projetoComServicos({ prazo: '2027-03-05' })), { status: 422 });
});
