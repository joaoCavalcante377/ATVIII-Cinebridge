import { ErroDominio, PAPEIS } from './types.ts';
import type { Competencia, Papel, RequisitoPapel, ServicoDados, ServicoAtomicoDados, PacoteServicoDados } from './types.ts';

/** Composite: serviço atômico e pacote são tratados pela mesma interface. */
export interface ServicoProjeto {
  readonly nome: string;
  /** Custo estimado em centavos. */
  calcularCusto(): number;
  listarSubservicos(): ServicoProjeto[];
  /** Prazo em dias corridos. */
  obterPrazo(): number;
  /** Lista vazia quando o nó e todos os seus descendentes são válidos. */
  validar(): string[];
  /** Papéis técnicos exigidos pelo nó e por seus descendentes. */
  listarRequisitos(): RequisitoPapel[];
  serializar(): ServicoDados;
}

export const PROFUNDIDADE_MAXIMA_SERVICOS = 8;
export const QUANTIDADE_MAXIMA_SERVICOS = 200;

const normalizar = (valor: string): string => valor.trim().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const preenchido = (valor: unknown): boolean => typeof valor === 'string' && valor.trim().length > 0;

export class ServicoAtomico implements ServicoProjeto {
  readonly nome: string;
  readonly custoCentavos: number;
  readonly prazoDias: number;
  readonly papel: Papel;
  readonly peso: number;
  readonly competencias: Competencia[];
  constructor(nome: string, custoCentavos: number, prazoDias: number, papel: Papel, competencias: Competencia[] = [], peso = 1) {
    this.nome = nome; this.custoCentavos = custoCentavos; this.prazoDias = prazoDias; this.papel = papel;
    this.competencias = structuredClone(competencias); this.peso = peso;
  }
  calcularCusto(): number { return this.custoCentavos; }
  listarSubservicos(): ServicoProjeto[] { return []; }
  obterPrazo(): number { return this.prazoDias; }
  validar(): string[] {
    const erros: string[] = [];
    const rotulo = preenchido(this.nome) ? this.nome : '(sem nome)';
    if (!preenchido(this.nome)) erros.push('Serviço atômico exige nome.');
    if (!PAPEIS.includes(this.papel)) erros.push(`${rotulo}: papel técnico inválido.`);
    if (!Number.isSafeInteger(this.custoCentavos) || this.custoCentavos < 0) erros.push(`${rotulo}: custo deve ser inteiro não negativo em centavos.`);
    if (!Number.isInteger(this.prazoDias) || this.prazoDias < 1) erros.push(`${rotulo}: prazo deve ser um número inteiro de dias, a partir de 1.`);
    if (!Number.isFinite(this.peso) || this.peso <= 0) erros.push(`${rotulo}: peso deve ser positivo.`);
    const nomes = this.competencias.map(c => preenchido(c.nome) ? normalizar(c.nome) : '');
    if (this.competencias.some(c => !preenchido(c.nome) || !Number.isFinite(c.nivel) || c.nivel < 0 || c.nivel > 5) || new Set(nomes).size !== nomes.length) {
      erros.push(`${rotulo}: competências inválidas ou repetidas.`);
    }
    return erros;
  }
  listarRequisitos(): RequisitoPapel[] { return [{ papel: this.papel, peso: this.peso, competencias: structuredClone(this.competencias) }]; }
  serializar(): ServicoAtomicoDados {
    return { tipo: 'atomico', nome: this.nome, custoCentavos: this.custoCentavos, prazoDias: this.prazoDias, papel: this.papel,
      peso: this.peso, competencias: structuredClone(this.competencias) };
  }
}

export interface OpcoesPacote {
  /** Sequencial soma os prazos; paralela usa o maior prazo entre os filhos. */
  execucao?: 'sequencial' | 'paralela';
  prazoMaximoDias?: number;
}

export class PacoteServico implements ServicoProjeto {
  readonly nome: string;
  readonly execucao: 'sequencial' | 'paralela';
  readonly prazoMaximoDias: number | undefined;
  private servicos: ServicoProjeto[] = [];
  constructor(nome: string, servicos: ServicoProjeto[] = [], opcoes: OpcoesPacote = {}) {
    this.nome = nome; this.execucao = opcoes.execucao ?? 'sequencial'; this.prazoMaximoDias = opcoes.prazoMaximoDias;
    for (const servico of servicos) this.adicionar(servico);
  }
  adicionar(servico: ServicoProjeto): this {
    // Um ciclo tornaria custo e prazo infinitos; uma instância repetida contaria o custo duas vezes.
    if (servico === this || contem(servico, this)) throw new ErroDominio(`O pacote ${this.nome} não pode conter a si mesmo.`);
    if (contem(this, servico)) throw new ErroDominio(`O serviço ${servico.nome} já faz parte do pacote ${this.nome}.`);
    this.servicos.push(servico);
    return this;
  }
  remover(servico: ServicoProjeto): boolean {
    const indice = this.servicos.indexOf(servico);
    if (indice < 0) return false;
    this.servicos.splice(indice, 1);
    return true;
  }
  calcularCusto(): number { return this.servicos.reduce((soma, s) => soma + s.calcularCusto(), 0); }
  listarSubservicos(): ServicoProjeto[] { return [...this.servicos]; }
  obterPrazo(): number {
    const prazos = this.servicos.map(s => s.obterPrazo());
    if (!prazos.length) return 0;
    return this.execucao === 'paralela' ? Math.max(...prazos) : prazos.reduce((a, b) => a + b, 0);
  }
  validar(): string[] {
    const rotulo = preenchido(this.nome) ? this.nome : '(sem nome)';
    const erros: string[] = [];
    if (!preenchido(this.nome)) erros.push('Pacote de serviços exige nome.');
    if (!['sequencial', 'paralela'].includes(this.execucao)) erros.push(`${rotulo}: execução deve ser sequencial ou paralela.`);
    if (!this.servicos.length) erros.push(`${rotulo}: o pacote precisa conter ao menos um serviço.`);
    const nomes = this.servicos.map(s => preenchido(s.nome) ? normalizar(s.nome) : '');
    if (new Set(nomes).size !== nomes.length) erros.push(`${rotulo}: há serviços com o mesmo nome no pacote.`);
    // A validação desce pela hierarquia; o caminho identifica o nó com problema.
    for (const servico of this.servicos) erros.push(...servico.validar().map(erro => `${rotulo} › ${erro}`));
    if (this.prazoMaximoDias !== undefined) {
      if (!Number.isInteger(this.prazoMaximoDias) || this.prazoMaximoDias < 1) erros.push(`${rotulo}: prazo máximo deve ser um número inteiro de dias, a partir de 1.`);
      else if (this.obterPrazo() > this.prazoMaximoDias) erros.push(`${rotulo}: prazo calculado de ${this.obterPrazo()} dia(s) excede o máximo de ${this.prazoMaximoDias}.`);
    }
    return erros;
  }
  listarRequisitos(): RequisitoPapel[] { return agregarRequisitos(this.servicos.flatMap(s => s.listarRequisitos())); }
  serializar(): PacoteServicoDados {
    return { tipo: 'pacote', nome: this.nome, execucao: this.execucao,
      ...(this.prazoMaximoDias !== undefined ? { prazoMaximoDias: this.prazoMaximoDias } : {}),
      servicos: this.servicos.map(s => s.serializar()) };
  }
}

function contem(raiz: ServicoProjeto, alvo: ServicoProjeto): boolean {
  return raiz.listarSubservicos().some(filho => filho === alvo || contem(filho, alvo));
}

/** Um profissional ocupa cada papel; serviços do mesmo papel somam pesos e unem competências. */
export function agregarRequisitos(requisitos: RequisitoPapel[]): RequisitoPapel[] {
  const porPapel = new Map<Papel, { peso: number; competencias: Map<string, Competencia> }>();
  for (const requisito of requisitos) {
    const atual = porPapel.get(requisito.papel) ?? { peso: 0, competencias: new Map<string, Competencia>() };
    atual.peso += requisito.peso;
    for (const competencia of requisito.competencias) {
      const chave = normalizar(competencia.nome), anterior = atual.competencias.get(chave);
      if (!anterior || competencia.nivel > anterior.nivel) atual.competencias.set(chave, { ...competencia });
    }
    porPapel.set(requisito.papel, atual);
  }
  return [...porPapel].map(([papel, { peso, competencias }]) => ({ papel, peso, competencias: [...competencias.values()] }));
}

/** Reconstrói a hierarquia a partir do JSON persistido ou recebido pela API. */
export function criarServico(dados: ServicoDados): ServicoProjeto {
  let quantidade = 0;
  const construir = (no: ServicoDados, profundidade: number): ServicoProjeto => {
    if (++quantidade > QUANTIDADE_MAXIMA_SERVICOS) throw new ErroDominio(`A hierarquia aceita até ${QUANTIDADE_MAXIMA_SERVICOS} serviços.`);
    if (profundidade > PROFUNDIDADE_MAXIMA_SERVICOS) throw new ErroDominio(`A hierarquia aceita até ${PROFUNDIDADE_MAXIMA_SERVICOS} níveis.`);
    if (no?.tipo === 'atomico') return new ServicoAtomico(no.nome, no.custoCentavos, no.prazoDias, no.papel, no.competencias ?? [], no.peso ?? 1);
    if (no?.tipo === 'pacote' && Array.isArray(no.servicos)) {
      return new PacoteServico(no.nome, no.servicos.map(filho => construir(filho, profundidade + 1)),
        { execucao: no.execucao ?? 'sequencial', ...(no.prazoMaximoDias !== undefined ? { prazoMaximoDias: no.prazoMaximoDias } : {}) });
    }
    throw new ErroDominio('Serviço deve ser do tipo atomico ou pacote.');
  };
  return construir(dados, 1);
}

/** Projetos anteriores à ATVIII só têm papéis; cada um vira um serviço sem custo informado. */
export function servicoDePapeis(papeis: RequisitoPapel[], prazoDias: number): PacoteServico {
  return new PacoteServico('Equipe do projeto', papeis.map(r => new ServicoAtomico(r.papel, 0, Math.max(1, prazoDias), r.papel, r.competencias, r.peso)),
    { execucao: 'paralela' });
}

export interface ResumoServico {
  nome: string; custoCentavos: number; prazoDias: number; papeis: Papel[];
  responsaveis: { papel: Papel; profissionalId: string }[]; subservicos: ResumoServico[];
}

/** Percorre qualquer nó da mesma forma e associa os membros da equipe aos serviços de seus papéis. */
export function resumirServico(servico: ServicoProjeto, membros: { papel: Papel; profissionalId: string }[] = []): ResumoServico {
  const papeis = servico.listarRequisitos().map(r => r.papel);
  return {
    nome: servico.nome, custoCentavos: servico.calcularCusto(), prazoDias: servico.obterPrazo(), papeis,
    responsaveis: membros.filter(m => papeis.includes(m.papel)).map(m => ({ papel: m.papel, profissionalId: m.profissionalId })),
    subservicos: servico.listarSubservicos().map(filho => resumirServico(filho, membros)),
  };
}

export function diasDoPeriodo(inicio: string, fim: string): number {
  return Math.floor((Date.parse(fim) - Date.parse(inicio)) / 86_400_000) + 1;
}
