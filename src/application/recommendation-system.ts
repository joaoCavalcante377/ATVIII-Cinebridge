import { OrquestradorPadrao } from '../domain/orchestrator.ts';
import type { OpcoesOrquestracao, ResultadoOrquestracao } from '../domain/orchestrator.ts';
import type { DestinoNotificacaoProjeto, ObservadorProjeto } from '../domain/factory-contracts.ts';
import { fabricasPadrao, RegistroPrototipos } from '../domain/project-factories.ts';
import type { RegistroFabricas } from '../domain/project-factories.ts';
import type { Projeto } from '../domain/model.ts';
import type { RecomendacaoStrategy } from '../domain/strategies.ts';
import { ErroDominio } from '../domain/types.ts';
import type { Equipe, Evento, ProjetoDados, ProfissionalDados } from '../domain/types.ts';
import type { AdaptadorArmazenamento, AdaptadorPagamento, AdaptadorProfissional } from './adaptadores.ts';
import { decoradoresPadrao, MonitorDecoradores, RecomendadorBase } from './decoradores.ts';
import type { RegistroDecoradores } from './decoradores.ts';

export interface OpcoesSistema {
  armazenamento?: AdaptadorArmazenamento;
  pagamento?: AdaptadorPagamento;
  profissional?: AdaptadorProfissional;
  /** Pilha usada quando o produtor não informa preferência. O primeiro nome fica mais próximo do recomendador base. */
  politicaDecoradores?: string[];
  decoradores?: RegistroDecoradores;
  monitor?: MonitorDecoradores;
}

export const POLITICA_PADRAO = ['cache', 'auditoria'];

/**
 * Núcleo da recomendação. Depende apenas das interfaces dos adaptadores e de RecomendacaoStrategy;
 * provedores e decoradores são escolhidos por quem monta o sistema.
 */
export class SistemaRecomendacao {
  readonly fabricas: RegistroFabricas;
  readonly prototipos = new RegistroPrototipos();
  readonly decoradores: RegistroDecoradores;
  readonly monitor: MonitorDecoradores;
  private adaptadorArmazenamento: AdaptadorArmazenamento | undefined;
  private adaptadorPagamento: AdaptadorPagamento | undefined;
  private adaptadorProfissional: AdaptadorProfissional | undefined;
  private estrategiaAtual: RecomendacaoStrategy;
  private politica: string[];
  // Cada política mantém sua pilha (e o estado do cache) entre requisições.
  private pilhas = new Map<string, RecomendacaoStrategy>();

  constructor(fabricas = fabricasPadrao(), opcoes: OpcoesSistema = {}) {
    this.fabricas = fabricas;
    for (const tipo of fabricas.listar()) this.prototipos.registrar(tipo, fabricas.obter(tipo).criarProjeto({}));
    this.monitor = opcoes.monitor ?? new MonitorDecoradores();
    this.decoradores = opcoes.decoradores ?? decoradoresPadrao(this.monitor);
    this.estrategiaAtual = new RecomendadorBase(fabricas);
    this.politica = [...(opcoes.politicaDecoradores ?? POLITICA_PADRAO)];
    this.decoradores.validar(this.politica);
    this.adaptadorArmazenamento = opcoes.armazenamento;
    this.adaptadorPagamento = opcoes.pagamento;
    this.adaptadorProfissional = opcoes.profissional;
  }

  configurarAdaptadores(armazenamento: AdaptadorArmazenamento, pagamento: AdaptadorPagamento, profissional: AdaptadorProfissional): void {
    this.adaptadorArmazenamento = armazenamento; this.adaptadorPagamento = pagamento; this.adaptadorProfissional = profissional;
  }
  /** Preenche apenas os adaptadores ainda não configurados. */
  completarAdaptadores(padroes: { armazenamento?: AdaptadorArmazenamento; pagamento?: AdaptadorPagamento; profissional?: AdaptadorProfissional }): void {
    this.adaptadorArmazenamento ??= padroes.armazenamento;
    this.adaptadorPagamento ??= padroes.pagamento;
    this.adaptadorProfissional ??= padroes.profissional;
  }
  get adaptadoresConfigurados(): { armazenamento?: string; pagamento?: string; profissional?: string } {
    return { armazenamento: this.adaptadorArmazenamento?.provedor, pagamento: this.adaptadorPagamento?.provedor, profissional: this.adaptadorProfissional?.provedor };
  }
  get armazenamento(): AdaptadorArmazenamento { return this.exigir(this.adaptadorArmazenamento, 'armazenamento'); }
  get pagamento(): AdaptadorPagamento { return this.exigir(this.adaptadorPagamento, 'pagamento'); }
  get profissional(): AdaptadorProfissional { return this.exigir(this.adaptadorProfissional, 'cadastro de profissionais'); }
  private exigir<T>(adaptador: T | undefined, nome: string): T {
    if (!adaptador) throw new ErroDominio(`Adaptador de ${nome} não configurado.`, 503);
    return adaptador;
  }

  /** Troca o componente central; a política de decoradores continua sendo aplicada sobre ele. */
  definirEstrategia(estrategia: RecomendacaoStrategy): void { this.estrategiaAtual = estrategia; this.pilhas.clear(); }
  /** Altera em tempo de execução a pilha usada por projetos sem preferência própria. */
  definirPoliticaDecoradores(politica: string[]): void { this.decoradores.validar(politica); this.politica = [...politica]; }
  get politicaDecoradores(): string[] { return [...this.politica]; }

  estrategiaPara(projeto: ProjetoDados): RecomendacaoStrategy {
    const politica = projeto.preferencias?.decoradores ?? this.politica;
    const chave = politica.join('>');
    let pilha = this.pilhas.get(chave);
    if (!pilha) { pilha = this.decoradores.montar(this.estrategiaAtual, politica); this.pilhas.set(chave, pilha); }
    return pilha;
  }

  criarProjeto(dados: ProjetoDados) { return this.fabricas.obter(dados.tipoProjeto).criarProjeto(dados); }
  recomendar(projeto: ProjetoDados, profissionais: ProfissionalDados[], opcoes?: OpcoesOrquestracao): ResultadoOrquestracao {
    const orquestrador = new OrquestradorPadrao(this.fabricas.obter(projeto.tipoProjeto), this.estrategiaPara(projeto));
    return orquestrador.orquestrar(projeto, profissionais, opcoes);
  }

  /** Busca os profissionais pela fonte configurada e forma a equipe do projeto. */
  async executarRecomendacao(projeto: Projeto): Promise<Equipe> {
    const p = projeto.dados;
    const profissionais = await this.profissional.listarProfissionais({ papeis: p.papeis.map(r => r.papel), localizacao: p.localizacao,
      periodo: { inicio: p.inicio, fim: p.prazo } });
    return this.recomendar(p, profissionais.map(prof => prof.dados)).equipe;
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
