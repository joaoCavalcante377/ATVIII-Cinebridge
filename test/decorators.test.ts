import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { AuditoriaDecorator, AuditoriaMemoria, CacheDecorator, CompressaoDecorator, MonitorDecoradores, RecomendacaoDecorator,
  RecomendadorBase, decoradoresPadrao, lerPolitica } from '../src/application/decoradores.ts';
import { SistemaRecomendacao } from '../src/application/recommendation-system.ts';
import { CatalogoProfissionais } from '../src/application/catalog.ts';
import { ServicoEquipes } from '../src/application/service.ts';
import { OrquestradorPadrao, SimilaridadeCosseno, fabricasPadrao } from '../src/domain/index.ts';
import type { RecomendacaoStrategy } from '../src/domain/index.ts';
import { PARAMETROS_PADRAO } from '../src/domain/types.ts';
import type { ProfissionalDados, ProjetoDados, Ranking } from '../src/domain/types.ts';
import { profissionaisExemplo, projetoExemplo } from '../scripts/fixtures.ts';
import { RepositorioMemoria, projeto as projetoSimples } from './support.ts';

/** Dublê que conta quantas vezes o componente interno realmente executou. */
class Contador extends RecomendacaoDecorator {
  chamadas = 0;
  override recomendar(p: ProjetoDados, ps: ProfissionalDados[]): Ranking { this.chamadas++; return super.recomendar(p, ps); }
}
const base = () => new RecomendadorBase(fabricasPadrao());
const projetoBase = (estrategia: ProjetoDados['estrategia'] = 'colaborativa', id = 'p1'): ProjetoDados => ({ ...projetoExemplo(estrategia), id, parametros: PARAMETROS_PADRAO }) as ProjetoDados;
const mediana = (valores: number[]) => [...valores].sort((a, b) => a - b)[Math.floor(valores.length / 2)]!;
function medir(executar: () => void): number { const inicio = performance.now(); executar(); return performance.now() - inicio; }

test('Decorator: recomendador base continua sendo a lógica da ATVI/ATVII', () => {
  const pessoas = profissionaisExemplo();
  for (const estrategia of ['cosseno', 'colaborativa', 'orcamento'] as const) {
    const p = projetoBase(estrategia);
    assert.deepEqual(base().recomendar(p, pessoas), fabricasPadrao().obter().criarRecomendador(p).recomendar(p, pessoas));
  }
});

test('CacheDecorator reduz o tempo de requisições repetidas sem alterar o resultado', () => {
  const pessoas = profissionaisExemplo(1_200);
  const contador = new Contador(base());
  const cache = new CacheDecorator(contador);
  const p = projetoBase();
  const original = base().recomendar(p, pessoas); // aquece o JIT antes de medir
  const semCache = mediana([1, 2, 3].map(() => medir(() => base().recomendar(p, pessoas))));
  const primeiro = cache.recomendar(p, pessoas);
  // Projeto semelhante: outro id e título, mesmos critérios.
  const comCache = mediana([1, 2, 3].map(i => medir(() => cache.recomendar({ ...p, id: `p${i + 1}`, titulo: `Obra ${i}` }, pessoas))));
  assert.equal(contador.chamadas, 1);
  assert.deepEqual(cache.estatisticas, { acertos: 3, falhas: 1, entradas: 1 });
  assert.deepEqual(primeiro, original);
  assert.deepEqual(cache.recomendar(p, pessoas), original);
  assert.ok(comCache < semCache / 2, `com cache ${comCache.toFixed(2)} ms; sem cache ${semCache.toFixed(2)} ms`);
});

test('CacheDecorator isola resultados e invalida por critério, cadastro, validade e capacidade', () => {
  let agora = 0;
  const contador = new Contador(base());
  const cache = new CacheDecorator(contador, { limite: 2, ttlMs: 1_000, relogio: () => agora });
  const pessoas = profissionaisExemplo(), p = projetoBase('cosseno');
  // O resultado calculado é do chamador; alterá-lo não afeta o que ficou guardado.
  const a = cache.recomendar(p, pessoas);
  a.DIRETOR!.length = 0;
  const acerto = cache.recomendar(p, pessoas);
  assert.ok(acerto.DIRETOR!.length > 0);
  // No acerto, a raiz é nova (aceita trocar listas), mas listas e candidatos guardados são imutáveis.
  acerto.DIRETOR = [];
  assert.ok(cache.recomendar(p, pessoas).DIRETOR!.length > 0);
  assert.throws(() => { cache.recomendar(p, pessoas).EDITOR![0]!.pontuacao = 0; }, TypeError);
  assert.throws(() => { cache.recomendar(p, pessoas).EDITOR!.pop(); }, TypeError);
  cache.recomendar({ ...p, orcamentoCentavos: 1 }, pessoas);
  assert.equal(contador.chamadas, 2);
  assert.deepEqual(cache.estatisticas, { acertos: 4, falhas: 2, entradas: 2 });
  // Cadastro alterado (novos objetos com conteúdo diferente) gera nova chave.
  cache.recomendar(p, pessoas.map((x, i) => i ? x : { ...x, precoCentavos: x.precoCentavos + 1 }));
  assert.equal(contador.chamadas, 3);
  // Mesmo conteúdo em objetos novos ainda aproveita o resultado.
  cache.recomendar(p, structuredClone(pessoas.map((x, i) => i ? x : { ...x, precoCentavos: x.precoCentavos + 1 })));
  assert.equal(contador.chamadas, 3);
  agora = 1_000;
  cache.recomendar({ ...p, orcamentoCentavos: 1 }, pessoas);
  assert.equal(contador.chamadas, 4);
  assert.ok(cache.estatisticas.entradas <= 2);
  cache.invalidar();
  assert.equal(cache.estatisticas.entradas, 0);
  assert.throws(() => new CacheDecorator(base(), { limite: 0 }));
});

test('AuditoriaDecorator registra todas as chamadas, tempos e falhas', () => {
  const destino = new AuditoriaMemoria();
  let relogio = 0;
  const lento: RecomendacaoStrategy = { recomendar: (p, ps) => { relogio += 7; return base().recomendar(p, ps); } };
  const auditado = new AuditoriaDecorator(lento, destino, () => relogio);
  const pessoas = profissionaisExemplo();
  auditado.recomendar(projetoBase('cosseno', 'a'), pessoas);
  auditado.recomendar(projetoBase('orcamento', 'b'), pessoas.slice(0, 6));
  const falha = new AuditoriaDecorator({ recomendar: () => { throw new Error('fonte fora do ar'); } }, destino);
  assert.throws(() => falha.recomendar(projetoBase('cosseno', 'c'), []), /fonte fora do ar/);
  const registros = destino.listar();
  assert.deepEqual(registros.map(r => [r.projetoId, r.estrategia, r.profissionais, r.sucesso]),
    [['a', 'cosseno', 18, true], ['b', 'orcamento', 6, true], ['c', 'cosseno', 0, false]]);
  assert.deepEqual(registros.slice(0, 2).map(r => r.duracaoMs), [7, 7]);
  assert.equal(registros[0]!.candidatos, 18);
  assert.equal(registros[2]!.erro, 'fonte fora do ar');
  const curta = new AuditoriaMemoria(2);
  for (const id of ['1', '2', '3']) curta.registrar({ ...registros[0]!, id });
  assert.deepEqual(curta.listar().map(r => r.id), ['2', '3']);
});

test('CompressaoDecorator reduz o tamanho transmitido e preserva o conteúdo', () => {
  const pessoas = profissionaisExemplo(300), p = projetoBase('colaborativa');
  const original = base().recomendar(p, pessoas);
  const compressao = new CompressaoDecorator(base());
  const compacto = compressao.recomendar(p, pessoas);
  const pacote = CompressaoDecorator.pacoteDe(compacto)!;
  const bytesOriginais = Buffer.byteLength(JSON.stringify(original));
  assert.ok(Buffer.byteLength(JSON.stringify(compacto)) < bytesOriginais);
  assert.ok(pacote.length < bytesOriginais / 5, `${pacote.length} de ${bytesOriginais} bytes`);
  assert.deepEqual(CompressaoDecorator.descomprimir(pacote), compacto);
  // Mesmos candidatos, na mesma ordem; só a precisão exibida da pontuação muda.
  for (const papel of Object.keys(original) as (keyof Ranking)[]) {
    assert.deepEqual(compacto[papel]!.map(c => c.profissionalId), original[papel]!.map(c => c.profissionalId));
    compacto[papel]!.forEach((c, i) => assert.ok(Math.abs(c.pontuacao - original[papel]![i]!.pontuacao) <= 5e-5));
  }
  const estatisticas = compressao.estatisticas;
  assert.equal(estatisticas.chamadas, 1);
  assert.equal(estatisticas.bytesOriginais, bytesOriginais);
  assert.ok(estatisticas.bytesComprimidos < estatisticas.bytesCompactados && estatisticas.bytesCompactados < estatisticas.bytesOriginais);
  assert.equal(CompressaoDecorator.pacoteDe(original), undefined);
  assert.throws(() => new CompressaoDecorator(base(), { casasDecimais: 0 }));
});

test('decoradores combinam em ordens diferentes, e a ordem define o que cada um observa', () => {
  const pessoas = profissionaisExemplo(), p = projetoBase('cosseno');
  const montar = (politica: string[]) => {
    const monitor = new MonitorDecoradores();
    const contador = new Contador(base());
    return { estrategia: decoradoresPadrao(monitor).montar(contador, politica), monitor, contador };
  };
  // Cache → auditoria → compressão: Compressao(Auditoria(Cache(base))). A auditoria vê também os acertos do cache.
  const a = montar(['cache', 'auditoria', 'compressao']);
  assert.ok(a.estrategia instanceof CompressaoDecorator);
  // Auditoria → cache → compressão: o cache fica por fora e responde sem chegar à auditoria.
  const b = montar(['auditoria', 'cache', 'compressao']);
  // Compressão → cache → auditoria: o cache guarda o ranking já compactado.
  const c = montar(['compressao', 'cache', 'auditoria']);
  const resultados = [a, b, c].map(({ estrategia }) => [estrategia.recomendar(p, pessoas), estrategia.recomendar({ ...p, id: 'outro' }, pessoas)]);
  assert.deepEqual(resultados[1], resultados[0]);
  assert.deepEqual(resultados[2], resultados[0]);
  assert.deepEqual([a, b, c].map(x => x.contador.chamadas), [1, 1, 1]);
  assert.deepEqual([a, b, c].map(x => x.monitor.metricas().auditoria.chamadas), [2, 1, 2]);
  assert.deepEqual([a, b, c].map(x => x.monitor.metricas().cache.acertos), [1, 1, 1]);
  assert.deepEqual([a, b, c].map(x => x.monitor.metricas().compressao.chamadas), [2, 2, 1]);
});

test('pilha definida em tempo de execução por política ou preferência do produtor, sem alterar SistemaRecomendacao', async () => {
  const repositorio = new RepositorioMemoria();
  const sistema = new SistemaRecomendacao(fabricasPadrao(), { politicaDecoradores: lerPolitica('cache, auditoria', []) });
  const servico = new ServicoEquipes(repositorio, new CatalogoProfissionais(() => repositorio.listarProfissionais()), sistema);
  const sem = new OrquestradorPadrao().orquestrar({ ...projetoSimples(), id: 'x', parametros: PARAMETROS_PADRAO }, repositorio.profissionais);
  const a = await servico.criar(projetoSimples());
  const b = await servico.criar({ ...projetoSimples(), titulo: 'Outra obra' });
  assert.deepEqual(a.equipe.membros, sem.equipe.membros);
  assert.deepEqual(sistema.monitor.metricas().cache, { acertos: 1, falhas: 1, entradas: 1 });
  assert.equal(sistema.monitor.metricas().auditoria.chamadas, 2);
  assert.deepEqual(b.recomendacao.candidatos, a.recomendacao.candidatos);
  // Política global alterada em execução.
  sistema.definirPoliticaDecoradores(['auditoria', 'compressao']);
  assert.deepEqual(sistema.politicaDecoradores, ['auditoria', 'compressao']);
  await servico.criar(projetoSimples());
  assert.equal(sistema.monitor.metricas().compressao.chamadas, 1);
  // Preferência do produtor tem precedência e é persistida com o projeto.
  const preferido = await servico.criar({ ...projetoSimples(), preferencias: { decoradores: ['compressao'] } });
  assert.deepEqual(preferido.projeto.preferencias, { decoradores: ['compressao'] });
  assert.equal(sistema.monitor.metricas().compressao.chamadas, 2);
  // A preferência substitui a política global: esta chamada não passou pela auditoria.
  assert.equal(sistema.monitor.metricas().auditoria.chamadas, 3);
  await assert.rejects(servico.criar({ ...projetoSimples(), preferencias: { decoradores: ['zip'] } }), { status: 422 });
  assert.throws(() => sistema.definirPoliticaDecoradores(['cache', 'cache']), { status: 422 });
  assert.throws(() => new SistemaRecomendacao(fabricasPadrao(), { politicaDecoradores: ['nada'] }), /desconhecido/);
  // Outra estratégia central recebe a mesma pilha de decoradores.
  const contador = new Contador(new SimilaridadeCosseno());
  sistema.definirEstrategia(contador);
  sistema.definirPoliticaDecoradores(['cache']);
  await servico.criar(projetoSimples()); await servico.criar(projetoSimples());
  assert.equal(contador.chamadas, 1);
});

test('novo decorador é registrado sem modificar o sistema', async () => {
  const monitor = new MonitorDecoradores();
  // Exemplo de extensão: limita a quantidade de candidatos devolvidos por papel.
  const registro = decoradoresPadrao(monitor).registrar('top3', interno => ({ recomendar: (p, ps) => {
    const ranking = interno.recomendar(p, ps);
    for (const papel of Object.keys(ranking) as (keyof Ranking)[]) ranking[papel] = ranking[papel]!.slice(0, 3);
    return ranking;
  } }));
  const sistema = new SistemaRecomendacao(fabricasPadrao(), { decoradores: registro, monitor, politicaDecoradores: ['top3', 'auditoria'] });
  const resultado = sistema.recomendar(projetoBase('cosseno'), profissionaisExemplo(60));
  assert.ok(Object.values(resultado.candidatos).every(lista => lista.length <= 3));
  assert.equal(monitor.metricas().auditoria.ultimas[0]!.candidatos, 18);
  assert.deepEqual(registro.listar(), ['cache', 'auditoria', 'compressao', 'top3']);
  assert.throws(() => registro.registrar('top3', i => i), /já registrado/);
  assert.deepEqual(lerPolitica(undefined, ['cache']), ['cache']);
  assert.deepEqual(lerPolitica('', ['cache']), []);
});
