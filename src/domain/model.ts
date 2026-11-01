import { ErroDominio } from './types.ts';
import type { ProjetoDados, ProfissionalDados } from './types.ts';
import type { FabricaProjeto } from './factory-contracts.ts';
import { FabricaPadrao, FabricaDocumentario, FabricaAnimacao, FabricaPublicitario } from './project-factories.ts';
import { criarServico, diasDoPeriodo, servicoDePapeis } from './servicos.ts';
import type { ServicoProjeto } from './servicos.ts';

// A hierarquia é derivada dos dados; um novo objeto de dados (clone, ajuste) gera outra árvore.
const servicosPorDados = new WeakMap<ProjetoDados, ServicoProjeto>();

/** As operações transversais ficam nos visitantes; entidades só fazem o despacho. */
export interface VisitanteProjeto<T> {
  visitarProjeto(projeto: Projeto): T;
  visitarProfissional(profissional: Profissional): T;
}

export class Projeto {
  readonly dados: ProjetoDados;
  constructor(dados: ProjetoDados) { this.dados = dados; }
  aceitar<T>(visitante: VisitanteProjeto<T>): T { return visitante.visitarProjeto(this); }
  clonar(): this {
    // structuredClone sozinho perderia a subclasse e seus métodos.
    return Object.assign(Object.create(Object.getPrototypeOf(this)) as this, structuredClone({ ...this }));
  }
  orcamentoEquipe(): number { return this.dados.orcamentoCentavos - (this.dados.especificacoes?.reservaOrcamentoCentavos ?? 0); }
  criarFabrica(): FabricaProjeto { return new FabricaPadrao(this); }

  /** Composite: raiz da hierarquia de serviços. Projetos sem `servicos` usam um pacote derivado dos papéis. */
  get servicoPrincipal(): ServicoProjeto {
    let servico = servicosPorDados.get(this.dados);
    if (!servico) {
      servico = this.dados.servicos ? criarServico(this.dados.servicos)
        : servicoDePapeis(this.dados.papeis, diasDoPeriodo(this.dados.inicio, this.dados.prazo));
      servicosPorDados.set(this.dados, servico);
    }
    return servico;
  }
  /** Substitui a hierarquia e mantém os papéis usados pela recomendação coerentes com ela. */
  definirServicoPrincipal(servico: ServicoProjeto): void {
    this.dados.servicos = servico.serializar();
    this.dados.papeis = servico.listarRequisitos();
    servicosPorDados.set(this.dados, servico);
  }
  calcularCustoTotal(): number { return this.servicoPrincipal.calcularCusto(); }
  calcularPrazoTotal(): number { return this.servicoPrincipal.obterPrazo(); }
  /** Validação recursiva da hierarquia e de sua coerência com o projeto. */
  validarEstrutura(): string[] {
    if (!this.dados.servicos) return [];
    let servico: ServicoProjeto;
    try { servico = this.servicoPrincipal; } catch (erro) {
      if (erro instanceof ErroDominio) return [erro.message];
      throw erro;
    }
    const erros = servico.validar();
    if (erros.length) return erros;
    const dias = diasDoPeriodo(this.dados.inicio, this.dados.prazo);
    if (Number.isFinite(dias) && servico.obterPrazo() > dias) erros.push(`Os serviços exigem ${servico.obterPrazo()} dia(s), mas o período do projeto tem ${dias}.`);
    if (servico.calcularCusto() > this.dados.orcamentoCentavos) erros.push('O custo estimado dos serviços excede o orçamento do projeto.');
    const derivados = servico.listarRequisitos().map(r => r.papel).sort();
    const informados = this.dados.papeis.map(r => r.papel).sort();
    if (derivados.join() !== informados.join()) erros.push('Os papéis do projeto não correspondem aos serviços atômicos.');
    return erros;
  }
}

// Factory Method: cada subclasse decide a família de componentes que fabrica.
export class ProjetoDocumentario extends Projeto {
  override clonar(): this { return super.clonar(); }
  override criarFabrica(): FabricaProjeto { return new FabricaDocumentario(this); }
}
export class ProjetoAnimacao extends Projeto {
  override clonar(): this { return super.clonar(); }
  override criarFabrica(): FabricaProjeto { return new FabricaAnimacao(this); }
}
export class ProjetoPublicitario extends Projeto {
  override clonar(): this { return super.clonar(); }
  override criarFabrica(): FabricaProjeto { return new FabricaPublicitario(this); }
}

export class Profissional {
  readonly dados: ProfissionalDados;
  constructor(dados: ProfissionalDados) { this.dados = dados; }
  aceitar<T>(visitante: VisitanteProjeto<T>): T { return visitante.visitarProfissional(this); }
}
