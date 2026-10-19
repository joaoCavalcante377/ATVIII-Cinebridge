import type { Projeto, VisitanteProjeto } from './model.ts';
import type { RecomendacaoStrategy } from './strategies.ts';
import type { Equipe, Evento, Notificacao, ProfissionalDados, ProjetoDados } from './types.ts';

export interface ObservadorProjeto {
  nome: string;
  atualizar(evento: Evento, signal: AbortSignal): Promise<void> | void;
}
export interface DestinoNotificacaoProjeto { salvarNotificacao(notificacao: Notificacao): Promise<void> }

/** Abstract Factory: todos os produtos de uma instância pertencem à mesma família. */
export interface FabricaProjeto {
  readonly tipo: string;
  criarProjeto(dados: Partial<ProjetoDados>): Projeto;
  criarValidador(equipe?: Equipe): VisitanteProjeto<string[]>;
  criarRecomendador(projeto: ProjetoDados): RecomendacaoStrategy;
  criarNotificador(destino: DestinoNotificacaoProjeto): ObservadorProjeto;
  criarRelatorio(equipe?: Equipe, profissionais?: ProfissionalDados[]): VisitanteProjeto<string>;
}
