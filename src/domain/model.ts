import type { ProjetoDados, ProfissionalDados } from './types.ts';
import type { FabricaProjeto } from './factory-contracts.ts';
import { FabricaPadrao, FabricaDocumentario, FabricaAnimacao, FabricaPublicitario } from './project-factories.ts';

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
