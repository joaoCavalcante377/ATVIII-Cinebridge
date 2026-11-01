import { ErroDominio, PAPEIS } from '../domain/types.ts';
import type { Avaliacao, Papel, ProfissionalDados } from '../domain/types.ts';
import type { Profissional } from '../domain/model.ts';
import { normalizarTexto } from '../domain/visitors.ts';

/** Falha ou recusa de um sistema externo, traduzida para o vocabulário da aplicação. */
export class ErroIntegracao extends ErroDominio {
  constructor(message: string, status = 502) { super(message, status); this.name = 'ErroIntegracao'; }
}

export interface MetadadosArquivo {
  nome: string;
  /** Tipo MIME; o padrão é application/octet-stream. */
  tipo?: string;
  /** Pasta lógica, por exemplo `projetos/<id>/`. */
  prefixo?: string;
  [chave: string]: unknown;
}

/** Contrato padronizado para provedores de armazenamento de mídia. */
export interface AdaptadorArmazenamento {
  readonly provedor: string;
  /** Retorna o identificador do arquivo no provedor. */
  salvarArquivo(conteudo: Buffer, metadados: MetadadosArquivo): Promise<string>;
  recuperarArquivo(id: string): Promise<Buffer>;
  listarArquivos(prefixo: string): Promise<string[]>;
}

export type StatusPagamento = 'PENDENTE' | 'APROVADO' | 'RECUSADO' | 'CANCELADO';

/** Contrato padronizado para gateways de pagamento. Valores sempre em centavos de real. */
export interface AdaptadorPagamento {
  readonly provedor: string;
  /** `referencia` torna a cobrança idempotente: repetir a chamada devolve a mesma transação. */
  efetuarPagamento(valor: number, origem: string, destino: string, referencia?: string): Promise<string>;
  cancelarPagamento(id: string): Promise<boolean>;
  verificarPagamento(id: string): Promise<StatusPagamento>;
}

export interface CriteriosProfissionais {
  papeis?: Papel[];
  localizacao?: string;
  /** Período que o profissional precisa cobrir. */
  periodo?: { inicio: string; fim: string };
  limite?: number;
}

/** Contrato padronizado para fontes de cadastro de profissionais. */
export interface AdaptadorProfissional {
  readonly provedor: string;
  listarProfissionais(criterios?: CriteriosProfissionais): Promise<Profissional[]>;
  detalharProfissional(id: string): Promise<Profissional>;
  registrarAvaliacao(id: string, avaliacao: Avaliacao): Promise<void>;
}

export function validarPagamento(valor: number, origem: string, destino: string): void {
  if (!Number.isSafeInteger(valor) || valor <= 0) throw new ErroDominio('O valor do pagamento deve ser um inteiro positivo em centavos.');
  if (!origem?.trim() || !destino?.trim() || origem === destino) throw new ErroDominio('Informe origem e destino diferentes para o pagamento.');
}

export function validarAvaliacao(avaliacao: Avaliacao): void {
  if (!Number.isFinite(avaliacao?.nota) || avaliacao.nota < 0 || avaliacao.nota > 5) throw new ErroDominio('A nota deve estar entre 0 e 5.');
  if (typeof avaliacao.comentario !== 'string' || typeof avaliacao.data !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(avaliacao.data)) {
    throw new ErroDominio('Avaliação exige comentário e data no formato AAAA-MM-DD.');
  }
}

/** Filtros aplicados igualmente a qualquer fonte depois da tradução para o modelo interno. */
export function filtrarProfissionais(profissionais: ProfissionalDados[], criterios: CriteriosProfissionais = {}): ProfissionalDados[] {
  const local = criterios.localizacao ? normalizarTexto(criterios.localizacao) : undefined;
  const filtrados = profissionais.filter(p =>
    (!criterios.papeis?.length || p.papeis.some(papel => criterios.papeis!.includes(papel)))
    && (!local || [local, 'remoto'].includes(normalizarTexto(p.localizacao)) || local === 'remoto')
    && (!criterios.periodo || (p.disponibilidade.inicio <= criterios.periodo.inicio && p.disponibilidade.fim >= criterios.periodo.fim)));
  return criterios.limite ? filtrados.slice(0, criterios.limite) : filtrados;
}

/** Converte títulos de cargos de qualquer provedor nos papéis técnicos da plataforma. */
const SINONIMOS: [Papel, string[]][] = [
  ['DIRETOR_FOTOGRAFIA', ['diretor de fotografia', 'director of photography', 'cinematographer', 'dop', 'fotografia']],
  ['DIRETOR', ['diretor', 'diretora', 'director', 'direcao']],
  ['SONOPLASTA', ['sonoplasta', 'sound designer', 'audio', 'som', 'mixagem', 'sound']],
  ['EDITOR', ['editor', 'editora', 'montador', 'montadora', 'video editor', 'colorista', 'colorist']],
  ['ROTEIRISTA', ['roteirista', 'screenwriter', 'writer', 'roteiro']],
  ['EFEITOS_VISUAIS', ['efeitos visuais', 'vfx', 'visual effects', 'animador', 'animator', 'motion designer']],
];
export function traduzirCargo(cargo: string): Papel | undefined {
  const texto = ` ${normalizarTexto(cargo).replace(/[^a-z0-9]+/g, ' ').trim()} `;
  const direto = PAPEIS.find(p => ` ${normalizarTexto(p).replaceAll('_', ' ')} ` === texto);
  if (direto) return direto;
  // Compara palavras inteiras ("audio" não casa com "audiovisual"). A ordem prioriza o termo
  // mais específico: "diretor de fotografia" antes de "diretor".
  return SINONIMOS.find(([, termos]) => termos.some(t => texto.includes(` ${t} `)))?.[0];
}
