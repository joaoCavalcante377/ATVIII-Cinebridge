/*
 * Demonstração HTTP da ATVIII. Exige a API em execução e os dados do seed.
 * Cria um projeto por hierarquia de serviços, confirma a equipe, anexa um roteiro e paga os integrantes.
 */
import { servicosPosProducao } from './atv3-fixtures.ts';
import type { EstadoProjeto } from '../src/domain/types.ts';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
async function chamar<T>(metodo: string, caminho: string, dados?: unknown): Promise<T> {
  const resposta = await fetch(`${base}${caminho}`, { method: metodo,
    ...(dados !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(dados) } : {}) });
  if (!resposta.ok) throw new Error(`${metodo} ${caminho} → ${resposta.status}: ${await resposta.text()}`);
  return (resposta.headers.get('content-type')?.includes('json') ? resposta.json() : Buffer.from(await resposta.arrayBuffer())) as Promise<T>;
}

console.log('Recomendador:', await chamar('GET', '/recomendador'));
let estado = await chamar<EstadoProjeto>('POST', '/projetos', {
  titulo: 'Noite na cidade', genero: 'drama', duracaoMinutos: 15, orcamentoCentavos: 900_000, inicio: '2027-03-01', prazo: '2027-03-30',
  tipoCaptacao: 'ficcao', localizacao: 'São Paulo', estrategia: 'cosseno', servicos: servicosPosProducao(),
  preferencias: { decoradores: ['cache', 'auditoria'] },
});
const id = estado.projeto.id;
console.log(`\nProjeto ${id}: papéis derivados ${estado.projeto.papeis.map(r => r.papel).join(', ')}; equipe ${estado.equipe.status}`);
const servicos = await chamar<{ custoTotalCentavos: number; prazoTotalDias: number; erros: string[] }>('GET', `/projetos/${id}/servicos`);
console.log(`Serviços: custo R$ ${(servicos.custoTotalCentavos / 100).toFixed(2)}, prazo ${servicos.prazoTotalDias} dia(s), erros ${servicos.erros.length}`);

estado = await chamar<EstadoProjeto>('POST', `/projetos/${id}/aceitar`, {});
for (const convite of estado.convites) {
  estado = await chamar<EstadoProjeto>('POST', `/projetos/${id}/convites/${convite.id}/resposta`, { profissionalId: convite.profissionalId, resposta: 'ACEITO' });
}
console.log('Equipe após os aceites:', estado.equipe.status);

const roteiro = Buffer.from('INT. RUA - NOITE\nA cidade acende as luzes.');
const arquivo = await chamar<{ id: string; provedor: string }>('POST', `/projetos/${id}/arquivos`,
  { nome: 'roteiro final.txt', tipo: 'text/plain', categoria: 'roteiro', conteudoBase64: roteiro.toString('base64') });
const baixado = await chamar<Buffer>('GET', `/projetos/${id}/arquivos/conteudo?arquivoId=${encodeURIComponent(arquivo.id)}`);
console.log(`\nArquivo (${arquivo.provedor}): ${arquivo.id}; conteúdo recuperado igual: ${baixado.equals(roteiro)}`);

const pagamento = await chamar<{ provedor: string; pagamentos: { papel: string; valorCentavos: number; transacaoId: string; status: string }[] }>('POST', `/projetos/${id}/pagamentos`);
console.log(`\nPagamentos (${pagamento.provedor}):`);
for (const p of pagamento.pagamentos) console.log(`- ${p.papel}: R$ ${(p.valorCentavos / 100).toFixed(2)} ${p.transacaoId} ${p.status}`);
const repetido = await chamar<typeof pagamento>('POST', `/projetos/${id}/pagamentos`);
console.log('Repetir a chamada reutiliza as transações:', repetido.pagamentos.every((p, i) => p.transacaoId === pagamento.pagamentos[i]!.transacaoId));
console.log('Status consultado:', await chamar('GET', `/pagamentos/${pagamento.pagamentos[0]!.transacaoId}`));

const { metricas } = await chamar<{ metricas: { cache: unknown; compressao: unknown; auditoria: { chamadas: number } } }>('GET', '/recomendador');
console.log('\nMétricas dos decoradores:', { cache: metricas.cache, compressao: metricas.compressao, auditoria: metricas.auditoria.chamadas });
