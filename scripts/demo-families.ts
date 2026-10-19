import { setTimeout as esperar } from 'node:timers/promises';
import { projetosFamilias } from './family-fixtures.ts';
import type { EstadoProjeto, Notificacao } from '../src/domain/types.ts';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
async function post(caminho: string, dados: unknown): Promise<EstadoProjeto> {
  const resposta = await fetch(`${base}${caminho}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(dados) });
  if (!resposta.ok) throw new Error(`${resposta.status}: ${await resposta.text()}`);
  return resposta.json() as Promise<EstadoProjeto>;
}
console.log('Modelos disponíveis:', (await (await fetch(`${base}/prototipos`)).json() as { nome: string }[]).map(m => m.nome));
for (const projeto of projetosFamilias()) {
  const { id: _id, ...entrada } = projeto;
  const estado = await post('/projetos', entrada);
  console.log(`\n${projeto.tipoProjeto}: ${estado.projeto.id}`);
  console.log('Equipe:', estado.equipe.membros.map(m => `${m.papel}: ${m.profissionalId}`).join(', '));
  const relatorio = await (await fetch(`${base}/projetos/${estado.projeto.id}/relatorio`)).json();
  console.log(relatorio);
  let notificacoes: Notificacao[] = [];
  for (let tentativa = 0; tentativa < 30; tentativa++) {
    notificacoes = await (await fetch(`${base}/projetos/${estado.projeto.id}/notificacoes`)).json() as Notificacao[];
    if (notificacoes.some(n => n.canal === 'interno')) break;
    await esperar(100);
  }
  if (!notificacoes.some(n => n.canal === 'interno')) throw new Error('As notificações não foram processadas no prazo da demonstração');
  console.log('Notificação:', notificacoes.find(n => n.canal === 'interno')!.assunto);
  const copia = await post(`/projetos/${estado.projeto.id}/clonar`, { titulo: `${projeto.titulo} - nova versão`, orcamentoCentavos: 350_000 });
  console.log('Clone:', copia.projeto.id, 'convites:', copia.convites.length, 'orçamento:', copia.projeto.orcamentoCentavos);
}
const invalida = await fetch(`${base}/projetos/modelos/animacao`, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ especificacoes: { horasRenderDisponiveis: 1 } }) });
if (invalida.status !== 422) throw new Error('A validação específica de animação deveria recusar a entrada');
console.log('\nValidação específica demonstrada:', invalida.status, await invalida.json());
