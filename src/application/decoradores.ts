import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { gunzipSync, gzipSync } from 'node:zlib';
import { ErroDominio } from '../domain/types.ts';
import type { ProfissionalDados, ProjetoDados, Ranking } from '../domain/types.ts';
import type { RecomendacaoStrategy } from '../domain/strategies.ts';
import type { RegistroFabricas } from '../domain/project-factories.ts';

/** Componente concreto: a recomendação da ATVI/ATVII, com a especialização da família do projeto. */
export class RecomendadorBase implements RecomendacaoStrategy {
  private fabricas: RegistroFabricas;
  constructor(fabricas: RegistroFabricas) { this.fabricas = fabricas; }
  recomendar(projeto: ProjetoDados, profissionais: ProfissionalDados[]): Ranking {
    return this.fabricas.obter(projeto.tipoProjeto).criarRecomendador(projeto).recomendar(projeto, profissionais);
  }
}

/** Decorator abstrato: mesma interface do componente e delegação ao objeto envolvido. */
export abstract class RecomendacaoDecorator implements RecomendacaoStrategy {
  protected readonly interno: RecomendacaoStrategy;
  constructor(interno: RecomendacaoStrategy) { this.interno = interno; }
  recomendar(projeto: ProjetoDados, profissionais: ProfissionalDados[]): Ranking {
    return this.interno.recomendar(projeto, profissionais);
  }
}

const sha1 = (texto: string): string => createHash('sha1').update(texto).digest('hex');
// Os cadastros são tratados como imutáveis: uma nova leitura produz novos objetos e, portanto, nova impressão.
const impressoes = new WeakMap<ProfissionalDados, string>();
function impressao(profissional: ProfissionalDados): string {
  let valor = impressoes.get(profissional);
  if (!valor) { valor = sha1(JSON.stringify(profissional)); impressoes.set(profissional, valor); }
  return valor;
}

const impressoesLista = new WeakMap<ProfissionalDados[], string>();
function impressaoLista(profissionais: ProfissionalDados[]): string {
  let valor = impressoesLista.get(profissionais);
  if (!valor) { valor = sha1(profissionais.map(impressao).join(',')); impressoesLista.set(profissionais, valor); }
  return valor;
}

export interface OpcoesCache { limite?: number; ttlMs?: number; relogio?: () => number }
export interface EstatisticasCache { acertos: number; falhas: number; entradas: number }

function congelar<T>(valor: T): T {
  if (valor && typeof valor === 'object' && !Object.isFrozen(valor)) {
    for (const item of Object.values(valor)) congelar(item);
    Object.freeze(valor);
  }
  return valor;
}

/**
 * Reaproveita rankings de requisições com os mesmos critérios e o mesmo cadastro.
 * O resultado guardado é congelado e compartilhado: cada acerto devolve um objeto raiz novo
 * (que aceita substituir listas), mas listas e candidatos não podem ser alterados. Copiar
 * milhares de candidatos a cada acerto custaria quase tanto quanto recalcular.
 */
export class CacheDecorator extends RecomendacaoDecorator {
  private entradas = new Map<string, { ranking: Ranking; criadoEm: number }>();
  private limite: number;
  private ttlMs: number;
  private relogio: () => number;
  private acertos = 0;
  private falhas = 0;
  constructor(interno: RecomendacaoStrategy, opcoes: OpcoesCache = {}) {
    super(interno);
    this.limite = opcoes.limite ?? 128; this.ttlMs = opcoes.ttlMs ?? 60_000; this.relogio = opcoes.relogio ?? Date.now;
    if (!Number.isInteger(this.limite) || this.limite < 1 || !Number.isFinite(this.ttlMs) || this.ttlMs <= 0) throw new Error('Limite e validade do cache devem ser positivos');
  }
  override recomendar(projeto: ProjetoDados, profissionais: ProfissionalDados[]): Ranking {
    // Identificador e título não mudam o ranking; projetos semelhantes compartilham o resultado.
    const { id: _id, titulo: _titulo, ...criterios } = projeto;
    const chave = `${sha1(JSON.stringify(criterios))}:${impressaoLista(profissionais)}`;
    const agora = this.relogio();
    const entrada = this.entradas.get(chave);
    if (entrada && agora - entrada.criadoEm < this.ttlMs) {
      this.acertos++;
      this.entradas.delete(chave); this.entradas.set(chave, entrada);
      return { ...entrada.ranking };
    }
    this.falhas++;
    const ranking = super.recomendar(projeto, profissionais);
    this.entradas.delete(chave);
    this.entradas.set(chave, { ranking: congelar(structuredClone(ranking)), criadoEm: agora });
    while (this.entradas.size > this.limite) this.entradas.delete(this.entradas.keys().next().value!);
    return ranking;
  }
  invalidar(): void { this.entradas.clear(); }
  get estatisticas(): EstatisticasCache { return { acertos: this.acertos, falhas: this.falhas, entradas: this.entradas.size }; }
}

export interface EntradaAuditoriaRecomendacao {
  id: string; projetoId: string; tipoProjeto: string; estrategia: string; profissionais: number;
  candidatos: number; duracaoMs: number; sucesso: boolean; erro?: string; ocorridoEm: string;
}
export interface DestinoAuditoriaRecomendacao { registrar(entrada: EntradaAuditoriaRecomendacao): void }

/** Destino em memória com tamanho limitado, suficiente para métricas e testes. */
export class AuditoriaMemoria implements DestinoAuditoriaRecomendacao {
  private entradas: EntradaAuditoriaRecomendacao[] = [];
  private limite: number;
  constructor(limite = 1_000) { this.limite = limite; }
  registrar(entrada: EntradaAuditoriaRecomendacao): void {
    this.entradas.push(structuredClone(entrada));
    if (this.entradas.length > this.limite) this.entradas.splice(0, this.entradas.length - this.limite);
  }
  listar(): EntradaAuditoriaRecomendacao[] { return structuredClone(this.entradas); }
}

/** Registra cada chamada, inclusive as que falham, com o tempo de resposta observado. */
export class AuditoriaDecorator extends RecomendacaoDecorator {
  private destino: DestinoAuditoriaRecomendacao;
  private relogio: () => number;
  constructor(interno: RecomendacaoStrategy, destino: DestinoAuditoriaRecomendacao = new AuditoriaMemoria(), relogio: () => number = () => performance.now()) {
    super(interno); this.destino = destino; this.relogio = relogio;
  }
  override recomendar(projeto: ProjetoDados, profissionais: ProfissionalDados[]): Ranking {
    const inicio = this.relogio();
    const base = { id: randomUUID(), projetoId: projeto.id, tipoProjeto: projeto.tipoProjeto ?? 'padrao', estrategia: projeto.estrategia,
      profissionais: profissionais.length, ocorridoEm: new Date().toISOString() };
    try {
      const ranking = super.recomendar(projeto, profissionais);
      this.destino.registrar({ ...base, candidatos: Object.values(ranking).reduce((s, lista) => s + lista.length, 0),
        duracaoMs: this.relogio() - inicio, sucesso: true });
      return ranking;
    } catch (erro) {
      this.destino.registrar({ ...base, candidatos: 0, duracaoMs: this.relogio() - inicio, sucesso: false,
        erro: erro instanceof Error ? erro.message : String(erro) });
      throw erro;
    }
  }
}

export interface OpcoesCompressao { casasDecimais?: number }
export interface EstatisticasCompressao { chamadas: number; bytesOriginais: number; bytesCompactados: number; bytesComprimidos: number }
const pacotes = new WeakMap<Ranking, Buffer>();

/** Reduz o volume transmitido: compacta o ranking e mantém sua versão gzip pronta para envio. */
export class CompressaoDecorator extends RecomendacaoDecorator {
  private casas: number;
  private totais: EstatisticasCompressao = { chamadas: 0, bytesOriginais: 0, bytesCompactados: 0, bytesComprimidos: 0 };
  constructor(interno: RecomendacaoStrategy, opcoes: OpcoesCompressao = {}) {
    super(interno);
    this.casas = opcoes.casasDecimais ?? 4;
    if (!Number.isInteger(this.casas) || this.casas < 1 || this.casas > 12) throw new Error('Casas decimais devem estar entre 1 e 12');
  }
  override recomendar(projeto: ProjetoDados, profissionais: ProfissionalDados[]): Ranking {
    const ranking = super.recomendar(projeto, profissionais);
    const fator = 10 ** this.casas;
    const compacto: Ranking = {};
    for (const [papel, candidatos] of Object.entries(ranking) as [keyof Ranking, NonNullable<Ranking[keyof Ranking]>][]) {
      // Pontuações com precisão de ponto flutuante completa e motivos repetidos não mudam a decisão exibida.
      compacto[papel] = candidatos.map(c => ({ ...c, pontuacao: Math.round(c.pontuacao * fator) / fator, motivos: [...new Set(c.motivos)] }));
    }
    const json = JSON.stringify(compacto);
    const pacote = gzipSync(json, { level: 6 });
    pacotes.set(compacto, pacote);
    this.totais.chamadas++;
    this.totais.bytesOriginais += Buffer.byteLength(JSON.stringify(ranking));
    this.totais.bytesCompactados += Buffer.byteLength(json);
    this.totais.bytesComprimidos += pacote.length;
    return compacto;
  }
  get estatisticas(): EstatisticasCompressao { return { ...this.totais }; }
  /** Conteúdo gzip de um ranking produzido por este decorador. */
  static pacoteDe(ranking: Ranking): Buffer | undefined { return pacotes.get(ranking); }
  static descomprimir(pacote: Buffer): Ranking { return JSON.parse(gunzipSync(pacote).toString('utf8')) as Ranking; }
}

export type FabricaDecorador = (interno: RecomendacaoStrategy) => RecomendacaoStrategy;

/** Monta a pilha a partir de nomes; o primeiro nome fica mais próximo do recomendador base. */
export class RegistroDecoradores {
  private fabricas = new Map<string, FabricaDecorador>();
  registrar(nome: string, fabrica: FabricaDecorador): this {
    if (!/^[a-z][a-z0-9-]{0,39}$/.test(nome) || this.fabricas.has(nome)) throw new ErroDominio('Decorador inválido ou já registrado');
    this.fabricas.set(nome, fabrica);
    return this;
  }
  listar(): string[] { return [...this.fabricas.keys()]; }
  validar(politica: string[]): void {
    const desconhecidos = politica.filter(nome => !this.fabricas.has(nome));
    if (desconhecidos.length) throw new ErroDominio(`Decorador desconhecido: ${desconhecidos.join(', ')}. Disponíveis: ${this.listar().join(', ')}.`);
    if (new Set(politica).size !== politica.length) throw new ErroDominio('Um decorador não pode se repetir na mesma pilha.');
  }
  montar(base: RecomendacaoStrategy, politica: string[]): RecomendacaoStrategy {
    this.validar(politica);
    return politica.reduce((interno, nome) => this.fabricas.get(nome)!(interno), base);
  }
}

/** Instâncias criadas pelas políticas padrão, para expor métricas sem acoplar o sistema a cada classe. */
export class MonitorDecoradores {
  readonly auditoria = new AuditoriaMemoria();
  readonly caches: CacheDecorator[] = [];
  readonly compressoes: CompressaoDecorator[] = [];
  metricas() {
    const cache = this.caches.reduce((s, c) => { const e = c.estatisticas; return { acertos: s.acertos + e.acertos, falhas: s.falhas + e.falhas, entradas: s.entradas + e.entradas }; }, { acertos: 0, falhas: 0, entradas: 0 });
    const compressao = this.compressoes.reduce((s, c) => {
      const e = c.estatisticas;
      return { chamadas: s.chamadas + e.chamadas, bytesOriginais: s.bytesOriginais + e.bytesOriginais, bytesCompactados: s.bytesCompactados + e.bytesCompactados, bytesComprimidos: s.bytesComprimidos + e.bytesComprimidos };
    }, { chamadas: 0, bytesOriginais: 0, bytesCompactados: 0, bytesComprimidos: 0 });
    const auditoria = this.auditoria.listar();
    return { cache, compressao, auditoria: { chamadas: auditoria.length, ultimas: auditoria.slice(-20) } };
  }
}

export function decoradoresPadrao(monitor = new MonitorDecoradores(), opcoes: { cache?: OpcoesCache; compressao?: OpcoesCompressao } = {}): RegistroDecoradores {
  return new RegistroDecoradores()
    .registrar('cache', interno => { const d = new CacheDecorator(interno, opcoes.cache); monitor.caches.push(d); return d; })
    .registrar('auditoria', interno => new AuditoriaDecorator(interno, monitor.auditoria))
    .registrar('compressao', interno => { const d = new CompressaoDecorator(interno, opcoes.compressao); monitor.compressoes.push(d); return d; });
}

/** Converte uma política textual, como `cache,auditoria,compressao`. */
export function lerPolitica(texto: string | undefined, padrao: string[]): string[] {
  if (texto === undefined) return [...padrao];
  return texto.split(',').map(nome => nome.trim()).filter(Boolean);
}
