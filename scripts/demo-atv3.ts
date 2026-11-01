/*
 * Demonstração da ATVIII sem banco de dados nem servidor: Adapter, Composite e Decorator
 * atuando sobre o mesmo SistemaRecomendacao. Execute com `npm run demo:atv3`.
 */
import { performance } from 'node:perf_hooks';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SistemaRecomendacao } from '../src/application/recommendation-system.ts';
import { CompressaoDecorator } from '../src/application/decoradores.ts';
import { FabricaPadrao, criarServico, resumirServico } from '../src/domain/index.ts';
import type { ResumoServico } from '../src/domain/index.ts';
import { PARAMETROS_PADRAO } from '../src/domain/types.ts';
import { AdaptadorGoogleCloud, AdaptadorIndeed, AdaptadorLinkedIn, AdaptadorLocal, AdaptadorPagSeguro, AdaptadorPayPal,
  AdaptadorS3, AdaptadorStripe } from '../src/infrastructure/adaptadores/configuracao.ts';
import { ApiProfissionalExterna, ArmazenamentoExterno, GatewayPagamento } from '../src/infrastructure/sistemas-externos.ts';
import { perfisIndeed, perfisLinkedIn, projetoComServicos } from './atv3-fixtures.ts';
import { profissionaisExemplo, projetoExemplo } from './fixtures.ts';

const reais = (centavos: number) => `R$ ${(centavos / 100).toFixed(2)}`;
function imprimir(no: ResumoServico, nivel = 0): void {
  const responsaveis = no.subservicos.length ? '' : ` → ${no.responsaveis.map(r => r.profissionalId).join(', ') || 'sem responsável'}`;
  console.log(`${'  '.repeat(nivel)}- ${no.nome}: ${reais(no.custoCentavos)}, ${no.prazoDias} dia(s)${responsaveis}`);
  for (const filho of no.subservicos) imprimir(filho, nivel + 1);
}

console.log('=== Composite: hierarquia de serviços ===');
const projeto = new FabricaPadrao().criarProjeto({ ...projetoComServicos(), id: 'demo-atv3', parametros: PARAMETROS_PADRAO });
console.log(`Custo total: ${reais(projeto.calcularCustoTotal())}; prazo total: ${projeto.calcularPrazoTotal()} dia(s); erros: ${projeto.validarEstrutura().length}`);
console.log('Papéis derivados:', projeto.dados.papeis.map(r => `${r.papel} (peso ${r.peso})`).join(', '));

console.log('\n=== Adapter: mesma recomendação a partir de fontes diferentes ===');
const sistema = new SistemaRecomendacao();
const fontes = [new AdaptadorLinkedIn(new ApiProfissionalExterna('linkedin', perfisLinkedIn(), { escalaNota: { minimo: 1, maximo: 10 } })),
  new AdaptadorIndeed(new ApiProfissionalExterna('indeed', perfisIndeed(), { campoId: 'candidate_id' }))];
const pasta = await mkdtemp(path.join(tmpdir(), 'cinebridge-demo-'));
const armazenamentos = [new AdaptadorS3(new ArmazenamentoExterno('s3', 'cinebridge')), new AdaptadorGoogleCloud(new ArmazenamentoExterno('gcs', 'cinebridge')), new AdaptadorLocal(pasta)];
const pagamentos = [new AdaptadorStripe(new GatewayPagamento('stripe')), new AdaptadorPagSeguro(new GatewayPagamento('pagseguro')), new AdaptadorPayPal(new GatewayPagamento('paypal'))];
try {
  for (const [i, fonte] of fontes.entries()) {
    sistema.configurarAdaptadores(armazenamentos[i]!, pagamentos[i]!, fonte);
    const equipe = await sistema.executarRecomendacao(projeto);
    console.log(`\nFonte ${fonte.provedor}: equipe ${equipe.status}, custo ${reais(equipe.custoCentavos)}`);
    imprimir(resumirServico(projeto.servicoPrincipal, equipe.membros));
  }
  console.log('\nArmazenamento e pagamento com provedores trocados em tempo de execução:');
  for (const [i, armazenamento] of armazenamentos.entries()) {
    sistema.configurarAdaptadores(armazenamento, pagamentos[i]!, fontes[0]!);
    const arquivo = await sistema.armazenamento.salvarArquivo(Buffer.from('INT. ESTÚDIO - NOITE'), { nome: 'roteiro.txt', tipo: 'text/plain', prefixo: 'projetos/demo-atv3' });
    const transacao = await sistema.pagamento.efetuarPagamento(90_000, 'produtor:demo-atv3', 'profissional:linkedin:li-001', `demo:${i}`);
    console.log(`- ${armazenamento.provedor.padEnd(5)} ${arquivo}`);
    console.log(`  ${sistema.pagamento.provedor.padEnd(9)} ${transacao} → ${await sistema.pagamento.verificarPagamento(transacao)}`);
  }
} finally { await rm(pasta, { recursive: true, force: true }); }

console.log('\n=== Decorator: pilha configurada em tempo de execução ===');
const pessoas = profissionaisExemplo(1_200);
const dados = { ...projetoExemplo('colaborativa'), id: 'p1', parametros: PARAMETROS_PADRAO } as const;
for (const politica of [['cache', 'auditoria', 'compressao'], ['auditoria', 'cache']]) {
  sistema.definirPoliticaDecoradores(politica);
  const pilha = sistema.estrategiaPara(dados);
  const tempos = [1, 2].map(n => { const inicio = performance.now(); pilha.recomendar({ ...dados, id: `p${n}` }, pessoas); return performance.now() - inicio; });
  console.log(`${politica.join(' → ')}: 1ª chamada ${tempos[0]!.toFixed(1)} ms; repetida ${tempos[1]!.toFixed(1)} ms`);
}
const { cache, compressao, auditoria } = sistema.monitor.metricas();
console.log('Cache:', cache);
console.log(`Compressão: ${compressao.bytesOriginais} bytes → ${compressao.bytesCompactados} compactados → ${compressao.bytesComprimidos} em gzip`);
console.log(`Auditoria: ${auditoria.chamadas} chamada(s) registradas; última em ${auditoria.ultimas.at(-1)?.duracaoMs.toFixed(1)} ms`);
const ranking = new CompressaoDecorator(sistema.estrategiaPara(dados)).recomendar(dados, pessoas);
console.log(`Pacote gzip disponível para envio: ${CompressaoDecorator.pacoteDe(ranking)?.length} bytes`);
console.log('Composite validado de novo a partir do JSON persistido:', criarServico(projeto.servicoPrincipal.serializar()).calcularCusto() === projeto.calcularCustoTotal());
