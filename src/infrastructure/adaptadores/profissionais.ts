import { ErroDominio } from '../../domain/types.ts';
import type { Avaliacao, Competencia, Papel, ProfissionalDados } from '../../domain/types.ts';
import { Profissional } from '../../domain/model.ts';
import { ValidadorConsistencia, normalizarTexto } from '../../domain/visitors.ts';
import { ErroIntegracao, filtrarProfissionais, traduzirCargo, validarAvaliacao } from '../../application/adaptadores.ts';
import type { AdaptadorProfissional, CriteriosProfissionais } from '../../application/adaptadores.ts';
import type { Repositorio } from '../../application/ports.ts';
import { FalhaExterna } from '../sistemas-externos.ts';
import type { ApiProfissionalExterna } from '../sistemas-externos.ts';

type Perfil = Record<string, unknown>;
const texto = (valor: unknown): string => typeof valor === 'string' ? valor.trim() : '';
const lista = (valor: unknown): unknown[] => Array.isArray(valor) ? valor : [];
const objeto = (valor: unknown): Perfil => valor && typeof valor === 'object' && !Array.isArray(valor) ? valor as Perfil : {};
const limitar = (valor: number, minimo: number, maximo: number): number => Math.min(maximo, Math.max(minimo, valor));

function unicasCompetencias(competencias: Competencia[]): Competencia[] {
  const porNome = new Map<string, Competencia>();
  for (const c of competencias) if (c.nome && !porNome.has(normalizarTexto(c.nome))) porNome.set(normalizarTexto(c.nome), c);
  return [...porNome.values()];
}

/** Etapas comuns às fontes externas: busca no formato do provedor e tradução do perfil. */
abstract class AdaptadorApiExterna implements AdaptadorProfissional {
  abstract readonly provedor: string;
  protected readonly api: ApiProfissionalExterna;
  constructor(api: ApiProfissionalExterna) { this.api = api; }
  /** Converte o perfil do provedor; retorna undefined quando não há papel técnico reconhecível. */
  protected abstract traduzir(perfil: Perfil): ProfissionalDados | undefined;
  protected abstract filtros(criterios: CriteriosProfissionais): Perfil;
  protected abstract notaExterna(nota: number): number;

  private idExterno(id: string): string {
    const prefixo = `${this.provedor}:`;
    if (typeof id !== 'string' || !id.startsWith(prefixo) || id.length === prefixo.length) throw new ErroIntegracao(`Identificador não pertence à fonte ${this.provedor}.`, 400);
    return id.slice(prefixo.length);
  }
  private falha(erro: unknown): never {
    if (erro instanceof FalhaExterna) {
      if (erro.codigo === '404') throw new ErroIntegracao('Profissional não encontrado na fonte externa.', 404);
      if (erro.codigo === '503') throw new ErroIntegracao(`Fonte ${this.provedor} indisponível.`, 503);
      throw new ErroIntegracao(`A fonte ${this.provedor} recusou a requisição: ${erro.message}.`);
    }
    throw erro;
  }
  async listarProfissionais(criterios: CriteriosProfissionais = {}): Promise<Profissional[]> {
    let perfis: Perfil[];
    try { perfis = await this.api.buscarProfissionais(this.filtros(criterios)); } catch (erro) { return this.falha(erro); }
    const traduzidos = perfis.map(p => this.traduzir(p)).filter((p): p is ProfissionalDados => p !== undefined);
    return filtrarProfissionais(traduzidos, criterios).map(p => new Profissional(p));
  }
  async detalharProfissional(id: string): Promise<Profissional> {
    let perfil: Perfil;
    try { perfil = await this.api.obterPerfil(this.idExterno(id)); } catch (erro) { return this.falha(erro); }
    const dados = this.traduzir(perfil);
    if (!dados) throw new ErroIntegracao('O perfil externo não informa um papel técnico reconhecido.', 422);
    return new Profissional(dados);
  }
  async registrarAvaliacao(id: string, avaliacao: Avaliacao): Promise<void> {
    validarAvaliacao(avaliacao);
    try { await this.api.avaliarProfissional(this.idExterno(id), this.notaExterna(avaliacao.nota)); } catch (erro) { this.falha(erro); }
  }
}

/**
 * Rede profissional. Perfil: firstName, lastName, emailAddress, headline, positions[{title}],
 * skills[{name, endorsements}], locationName, projectRate{amount}, availability{start, end},
 * recommendations[{rating 1–10, text, date}].
 */
export class AdaptadorLinkedIn extends AdaptadorApiExterna {
  readonly provedor = 'linkedin';
  protected filtros(criterios: CriteriosProfissionais): Perfil {
    return { locationName: criterios.localizacao && normalizarTexto(criterios.localizacao) !== 'remoto' ? [criterios.localizacao, 'Remoto'] : undefined };
  }
  protected notaExterna(nota: number): number { return limitar(Math.round(nota * 2), 1, 10); }
  protected traduzir(perfil: Perfil): ProfissionalDados | undefined {
    const cargos = [texto(perfil.headline), ...lista(perfil.positions).map(p => texto(objeto(p).title))];
    const papeis = [...new Set(cargos.map(traduzirCargo).filter((p): p is Papel => p !== undefined))];
    if (!papeis.length) return undefined;
    const disponibilidade = objeto(perfil.availability);
    return {
      id: `linkedin:${texto(perfil.id)}`, nome: `${texto(perfil.firstName)} ${texto(perfil.lastName)}`.trim(),
      email: texto(perfil.emailAddress), papeis,
      // Endossos indicam reconhecimento, não nível; cada dez endossos sobem um nível, até 5.
      competencias: unicasCompetencias(lista(perfil.skills).map(s => ({ nome: texto(objeto(s).name), nivel: limitar(1 + Math.floor(Number(objeto(s).endorsements ?? 0) / 10), 1, 5) }))),
      precoCentavos: Math.round(Number(objeto(perfil.projectRate).amount ?? 0) * 100),
      disponibilidade: { inicio: texto(disponibilidade.start), fim: texto(disponibilidade.end) }, localizacao: texto(perfil.locationName),
      historico: [],
      avaliacoes: lista(perfil.recommendations).map(r => ({ nota: limitar(Number(objeto(r).rating) / 2, 0, 5), comentario: texto(objeto(r).text), data: texto(objeto(r).date) })),
    };
  }
}

/**
 * Portal de vagas. Perfil: candidate_id, full_name, email, job_titles[], skills[{skill, years}], city,
 * desired_pay{amount_brl}, available{from, until}, reviews[{stars 1–5, comment, date}].
 */
export class AdaptadorIndeed extends AdaptadorApiExterna {
  readonly provedor = 'indeed';
  protected filtros(criterios: CriteriosProfissionais): Perfil {
    return { city: criterios.localizacao && normalizarTexto(criterios.localizacao) !== 'remoto' ? [criterios.localizacao, 'Remoto'] : undefined };
  }
  protected notaExterna(nota: number): number { return limitar(Math.round(nota), 1, 5); }
  protected traduzir(perfil: Perfil): ProfissionalDados | undefined {
    const papeis = [...new Set(lista(perfil.job_titles).map(t => traduzirCargo(texto(t))).filter((p): p is Papel => p !== undefined))];
    if (!papeis.length) return undefined;
    const periodo = objeto(perfil.available);
    return {
      id: `indeed:${texto(perfil.candidate_id)}`, nome: texto(perfil.full_name), email: texto(perfil.email), papeis,
      // Anos de experiência na habilidade como nível, limitado à escala da plataforma.
      competencias: unicasCompetencias(lista(perfil.skills).map(s => ({ nome: texto(objeto(s).skill), nivel: limitar(Number(objeto(s).years ?? 0), 0, 5) }))),
      precoCentavos: Math.round(Number(objeto(perfil.desired_pay).amount_brl ?? 0) * 100),
      disponibilidade: { inicio: texto(periodo.from), fim: texto(periodo.until) }, localizacao: texto(perfil.city),
      historico: [],
      avaliacoes: lista(perfil.reviews).map(r => ({ nota: limitar(Number(objeto(r).stars), 0, 5), comentario: texto(objeto(r).comment), data: texto(objeto(r).date) })),
    };
  }
}

/** Cadastro próprio da plataforma, persistido pelo repositório. Não há sistema externo a adaptar. */
export class AdaptadorInterno implements AdaptadorProfissional {
  readonly provedor = 'interno';
  private repositorio: Pick<Repositorio, 'listarProfissionais' | 'salvarProfissional'>;
  private filas = new Map<string, Promise<void>>();
  constructor(repositorio: Pick<Repositorio, 'listarProfissionais' | 'salvarProfissional'>) { this.repositorio = repositorio; }
  async listarProfissionais(criterios: CriteriosProfissionais = {}): Promise<Profissional[]> {
    return filtrarProfissionais(await this.repositorio.listarProfissionais(), criterios).map(p => new Profissional(p));
  }
  async detalharProfissional(id: string): Promise<Profissional> {
    const dados = (await this.repositorio.listarProfissionais()).find(p => p.id === id);
    if (!dados) throw new ErroDominio('Profissional não encontrado', 404);
    return new Profissional(dados);
  }
  async registrarAvaliacao(id: string, avaliacao: Avaliacao): Promise<void> {
    validarAvaliacao(avaliacao);
    // Leitura e gravação do mesmo profissional são serializadas neste processo para não perder avaliações.
    const anterior = this.filas.get(id) ?? Promise.resolve();
    const atual = anterior.then(async () => {
      const profissional = await this.detalharProfissional(id);
      const dados = { ...profissional.dados, avaliacoes: [...profissional.dados.avaliacoes, { nota: avaliacao.nota, comentario: avaliacao.comentario, data: avaliacao.data }] };
      const erros = new Profissional(dados).aceitar(new ValidadorConsistencia());
      if (erros.length) throw new ErroDominio(erros.join(' '));
      await this.repositorio.salvarProfissional(dados);
    });
    const fila = atual.catch(() => undefined);
    this.filas.set(id, fila);
    try { await atual; } finally { if (this.filas.get(id) === fila) this.filas.delete(id); }
  }
}
