import { randomBytes } from 'node:crypto';

/*
 * Simulações em memória de APIs de terceiros. Cada uma expõe o vocabulário do provedor,
 * não o da Cinebridge; os adaptadores fazem a tradução. Nenhuma realiza chamadas de rede.
 */

/** Falha simulada de comunicação, como timeout ou indisponibilidade do provedor. */
export class FalhaExterna extends Error {
  readonly codigo: string;
  constructor(codigo: string, mensagem: string) { super(mensagem); this.name = 'FalhaExterna'; this.codigo = codigo; }
}

/** Armazenamento de objetos no estilo S3/GCS: chaves planas, "pastas" são apenas prefixos. */
export class ArmazenamentoExterno {
  readonly servico: string;
  readonly bucket: string;
  indisponivel = false;
  private objetos = new Map<string, { dados: Uint8Array; tipo: string; modificadoEm: number }>();
  constructor(servico: string, bucket: string) { this.servico = servico; this.bucket = bucket; }
  private verificar(): void { if (this.indisponivel) throw new FalhaExterna('503', `${this.servico} indisponível`); }

  /** O nome do arquivo é a chave completa do objeto. Retorna a chave gravada. */
  async upload(arquivo: File): Promise<string> {
    this.verificar();
    if (!arquivo.name || arquivo.name.startsWith('/')) throw new FalhaExterna('400', 'InvalidObjectName');
    this.objetos.set(arquivo.name, { dados: new Uint8Array(await arquivo.arrayBuffer()), tipo: arquivo.type || 'application/octet-stream', modificadoEm: Date.now() });
    return arquivo.name;
  }
  async download(id: string): Promise<File> {
    this.verificar();
    const objeto = this.objetos.get(id);
    if (!objeto) throw new FalhaExterna('404', 'NoSuchKey');
    return new File([objeto.dados.slice()], id, { type: objeto.tipo, lastModified: objeto.modificadoEm });
  }
  async listar(pasta: string): Promise<string[]> {
    this.verificar();
    return [...this.objetos.keys()].filter(chave => chave.startsWith(pasta)).sort();
  }
}

export interface Transacao {
  id: string; valor: number; moeda: string; status: string; dados: Record<string, unknown>; criadaEm: string;
}

/** Vocabulário de cada gateway: unidade monetária, campos obrigatórios e nomes de status. */
export interface DialetoGateway {
  prefixo: string;
  unidade: 'centavos' | 'reais';
  campos: { origem: string; destino: string; referencia: string };
  status: { aprovado: string; pendente: string; recusado: string; estornado: string };
}
export const DIALETOS = {
  stripe: { prefixo: 'pi_', unidade: 'centavos', campos: { origem: 'customer', destino: 'destination', referencia: 'idempotency_key' },
    status: { aprovado: 'succeeded', pendente: 'processing', recusado: 'requires_payment_method', estornado: 'canceled' } },
  pagseguro: { prefixo: 'CHAR_', unidade: 'reais', campos: { origem: 'pagador', destino: 'recebedor', referencia: 'reference_id' },
    status: { aprovado: 'PAID', pendente: 'WAITING', recusado: 'DECLINED', estornado: 'CANCELED' } },
  paypal: { prefixo: 'PAYID-', unidade: 'reais', campos: { origem: 'payer_id', destino: 'payee_email', referencia: 'invoice_id' },
    status: { aprovado: 'COMPLETED', pendente: 'PENDING', recusado: 'DENIED', estornado: 'REFUNDED' } },
} as const satisfies Record<string, DialetoGateway>;
export type ProvedorPagamento = keyof typeof DIALETOS;

export class GatewayPagamento {
  readonly provedor: ProvedorPagamento;
  readonly dialeto: DialetoGateway;
  indisponivel = false;
  /** Valor acima do qual a cobrança é recusada, na unidade do provedor. */
  limiteAprovacao: number;
  private transacoes = new Map<string, Transacao>();
  private porReferencia = new Map<string, string>();
  constructor(provedor: ProvedorPagamento, opcoes: { limiteAprovacao?: number } = {}) {
    this.provedor = provedor; this.dialeto = DIALETOS[provedor];
    this.limiteAprovacao = opcoes.limiteAprovacao ?? Number.MAX_SAFE_INTEGER;
  }
  private verificar(): void { if (this.indisponivel) throw new FalhaExterna('503', `${this.provedor} indisponível`); }

  async processarPagamento(valor: number, dados: Record<string, unknown>): Promise<Transacao> {
    this.verificar();
    const { campos, status, unidade, prefixo } = this.dialeto;
    if (typeof valor !== 'number' || !(valor > 0) || (unidade === 'centavos' && !Number.isInteger(valor))) throw new FalhaExterna('400', 'invalid_amount');
    for (const campo of [campos.origem, campos.destino]) if (typeof dados[campo] !== 'string' || !dados[campo]) throw new FalhaExterna('400', `missing_${campo}`);
    const referencia = dados[campos.referencia];
    if (typeof referencia === 'string' && this.porReferencia.has(referencia)) return structuredClone(this.transacoes.get(this.porReferencia.get(referencia)!)!);
    const transacao: Transacao = { id: `${prefixo}${randomBytes(8).toString('hex').toUpperCase()}`, valor, moeda: 'BRL',
      status: valor > this.limiteAprovacao ? status.recusado : status.aprovado, dados: structuredClone(dados), criadaEm: new Date().toISOString() };
    this.transacoes.set(transacao.id, transacao);
    if (typeof referencia === 'string') this.porReferencia.set(referencia, transacao.id);
    return structuredClone(transacao);
  }
  async estornarPagamento(id: string): Promise<boolean> {
    this.verificar();
    const transacao = this.transacoes.get(id);
    if (!transacao || transacao.status !== this.dialeto.status.aprovado) return false;
    transacao.status = this.dialeto.status.estornado;
    return true;
  }
  async consultarStatus(id: string): Promise<string> {
    this.verificar();
    const transacao = this.transacoes.get(id);
    if (!transacao) throw new FalhaExterna('404', 'resource_missing');
    return transacao.status;
  }
}

/** API de rede profissional ou portal de vagas. Os perfis seguem o formato do provedor. */
export class ApiProfissionalExterna {
  readonly fonte: string;
  readonly campoId: string;
  indisponivel = false;
  private perfis: Map<string, Record<string, unknown>>;
  private notas = new Map<string, number[]>();
  readonly escalaNota: { minimo: number; maximo: number };
  constructor(fonte: string, perfis: Record<string, unknown>[], opcoes: { campoId?: string; escalaNota?: { minimo: number; maximo: number } } = {}) {
    this.fonte = fonte; this.campoId = opcoes.campoId ?? 'id'; this.escalaNota = opcoes.escalaNota ?? { minimo: 1, maximo: 5 };
    this.perfis = new Map(perfis.map(p => [String(p[this.campoId]), structuredClone(p)]));
  }
  private verificar(): void { if (this.indisponivel) throw new FalhaExterna('503', `${this.fonte} indisponível`); }

  /** Cada filtro compara um campo do perfil; listas aceitam qualquer valor informado. Aceita `limit`. */
  async buscarProfissionais(filtros: Record<string, unknown>): Promise<Record<string, unknown>[]> {
    this.verificar();
    const { limit, ...campos } = filtros;
    const normal = (v: unknown) => String(v).trim().toLowerCase();
    const resultado = [...this.perfis.values()].filter(perfil => Object.entries(campos).every(([campo, esperado]) => {
      if (esperado === undefined) return true;
      const valor = perfil[campo];
      const aceitos = (Array.isArray(esperado) ? esperado : [esperado]).map(normal);
      const presentes = (Array.isArray(valor) ? valor : [valor]).map(normal);
      return presentes.some(p => aceitos.some(a => p.includes(a)));
    }));
    return structuredClone(typeof limit === 'number' ? resultado.slice(0, limit) : resultado);
  }
  async obterPerfil(id: string): Promise<Record<string, unknown>> {
    this.verificar();
    const perfil = this.perfis.get(id);
    if (!perfil) throw new FalhaExterna('404', 'profile_not_found');
    return { ...structuredClone(perfil), notasRecebidas: [...(this.notas.get(id) ?? [])] };
  }
  async avaliarProfissional(id: string, nota: number): Promise<void> {
    this.verificar();
    if (!this.perfis.has(id)) throw new FalhaExterna('404', 'profile_not_found');
    if (!Number.isFinite(nota) || nota < this.escalaNota.minimo || nota > this.escalaNota.maximo) throw new FalhaExterna('400', 'invalid_rating');
    this.notas.set(id, [...(this.notas.get(id) ?? []), nota]);
  }
}
