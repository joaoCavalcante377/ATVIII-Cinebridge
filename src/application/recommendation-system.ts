import { OrquestradorPadrao } from '../domain/orchestrator.ts';
import type { OpcoesOrquestracao, ResultadoOrquestracao } from '../domain/orchestrator.ts';
import type { DestinoNotificacaoProjeto, ObservadorProjeto } from '../domain/factory-contracts.ts';
import { fabricasPadrao, RegistroPrototipos } from '../domain/project-factories.ts';
import type { RegistroFabricas } from '../domain/project-factories.ts';
import type { Evento, ProjetoDados, ProfissionalDados } from '../domain/types.ts';
import { CacheRecomendacoes } from './recommendation-cache.ts';

export class SistemaRecomendacao {
  readonly fabricas: RegistroFabricas;
  readonly prototipos = new RegistroPrototipos();
  private caches = new Map<string, CacheRecomendacoes>();
  constructor(fabricas = fabricasPadrao()) {
    this.fabricas = fabricas;
    for (const tipo of fabricas.listar()) this.prototipos.registrar(tipo, fabricas.obter(tipo).criarProjeto({}));
  }
  criarProjeto(dados: ProjetoDados) { return this.fabricas.obter(dados.tipoProjeto).criarProjeto(dados); }
  recomendar(projeto: ProjetoDados, profissionais: ProfissionalDados[], opcoes?: OpcoesOrquestracao): ResultadoOrquestracao {
    const fabrica = this.fabricas.obter(projeto.tipoProjeto);
    const orquestrador = new OrquestradorPadrao(fabrica);
    if (opcoes) return orquestrador.orquestrar(projeto, profissionais, opcoes);
    let cache = this.caches.get(fabrica.tipo);
    if (!cache) { cache = new CacheRecomendacoes(orquestrador); this.caches.set(fabrica.tipo, cache); }
    return cache.recomendar(projeto, profissionais);
  }
  criarObservador(destino: DestinoNotificacaoProjeto): ObservadorProjeto {
    const fabricas = this.fabricas;
    return { nome: 'notificador-familia', async atualizar(evento: Evento, signal: AbortSignal) {
      const tipo = evento.dados.tipoProjeto;
      if (tipo !== undefined && typeof tipo !== 'string') throw new Error('Tipo inválido no evento');
      await fabricas.obter(tipo).criarNotificador(destino).atualizar(evento, signal);
    } };
  }
}
