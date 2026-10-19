import { createHash } from 'node:crypto';
import type { Projeto } from './model.ts';
import type { RecomendacaoStrategy } from './strategies.ts';
import { criarEstrategia } from './strategies.ts';
import { ValidadorConsistencia, GeradorRelatorio, normalizarTexto } from './visitors.ts';
import type { Evento, Papel, ProfissionalDados, ProjetoDados, Ranking } from './types.ts';
import type { DestinoNotificacaoProjeto, ObservadorProjeto } from './factory-contracts.ts';

const preenchido = (texto: string | undefined): boolean => typeof texto === 'string' && texto.trim().length > 0;
const listaValida = (lista: string[] | undefined): boolean => Array.isArray(lista) && lista.length > 0
  && lista.every(preenchido) && new Set(lista.map(normalizarTexto)).size === lista.length;

export class ValidadorFamilia extends ValidadorConsistencia {
  protected tipo = 'padrao';
  protected papeisObrigatorios: Papel[] = [];
  override visitarProjeto(projeto: Projeto): string[] {
    const erros = super.visitarProjeto(projeto);
    const p = projeto.dados;
    if ((p.tipoProjeto ?? 'padrao') !== this.tipo) erros.push('Projeto e componentes pertencem a famílias diferentes.');
    const reserva = p.especificacoes?.reservaOrcamentoCentavos ?? 0;
    if (!Number.isSafeInteger(reserva) || reserva < 0 || reserva > p.orcamentoCentavos) erros.push('Reserva de orçamento inválida.');
    if (this.equipe && this.equipe.custoCentavos + reserva > p.orcamentoCentavos) erros.push('Equipe invade a reserva de orçamento do projeto.');
    for (const papel of this.papeisObrigatorios) if (!p.papeis.some(r => r.papel === papel)) erros.push(`A família ${this.tipo} exige o papel ${papel}.`);
    return erros;
  }
}
export class ValidadorDocumentario extends ValidadorFamilia {
  protected override tipo = 'documentario';
  protected override papeisObrigatorios: Papel[] = ['DIRETOR', 'SONOPLASTA'];
  override visitarProjeto(projeto: Projeto): string[] {
    const erros = super.visitarProjeto(projeto), e = projeto.dados.especificacoes;
    if (projeto.dados.tipoCaptacao !== 'documentario') erros.push('Documentário exige captação documentario.');
    if (!preenchido(e?.tema)) erros.push('Documentário exige tema.');
    if (!listaValida(e?.entrevistados)) erros.push('Informe entrevistados válidos, sem repetição.');
    if (e?.autorizacoesConfirmadas !== true) erros.push('Confirme as autorizações dos entrevistados antes de recomendar a equipe.');
    return erros;
  }
}

export function horasRender(projeto: ProjetoDados): number {
  const e = projeto.especificacoes;
  return projeto.duracaoMinutos * 60 * (e?.framesPorSegundo ?? 0) * (e?.tempoRenderPorFrameSegundos ?? 0) / 3600;
}
export class ValidadorAnimacao extends ValidadorFamilia {
  protected override tipo = 'animacao';
  protected override papeisObrigatorios: Papel[] = ['EFEITOS_VISUAIS', 'EDITOR'];
  override visitarProjeto(projeto: Projeto): string[] {
    const erros = super.visitarProjeto(projeto), p = projeto.dados, e = p.especificacoes;
    if (p.tipoCaptacao !== 'animacao') erros.push('Animação exige captação animacao.');
    if (!e || !['2d', '3d'].includes(e.tecnica ?? '') || !preenchido(e.software)) erros.push('Informe técnica 2d/3d e software de animação.');
    if (!Number.isInteger(e?.framesPorSegundo) || e!.framesPorSegundo! < 1 || e!.framesPorSegundo! > 120) erros.push('Frames por segundo devem estar entre 1 e 120.');
    if (!Number.isFinite(e?.tempoRenderPorFrameSegundos) || e!.tempoRenderPorFrameSegundos! <= 0 || !Number.isFinite(e?.horasRenderDisponiveis) || e!.horasRenderDisponiveis! <= 0) erros.push('Tempo de renderização e horas disponíveis devem ser positivos.');
    if (e && horasRender(p) > (e.horasRenderDisponiveis ?? 0)) erros.push('As horas disponíveis não cobrem a renderização estimada.');
    const horasPeriodo = (Date.parse(p.prazo) - Date.parse(p.inicio)) / 3_600_000 + 24;
    if (e && (e.horasRenderDisponiveis ?? 0) > horasPeriodo) erros.push('Horas de renderização disponíveis excedem o período do projeto.');
    return erros;
  }
}
export class ValidadorPublicitario extends ValidadorFamilia {
  protected override tipo = 'publicitario';
  protected override papeisObrigatorios: Papel[] = ['ROTEIRISTA', 'EDITOR'];
  override visitarProjeto(projeto: Projeto): string[] {
    const erros = super.visitarProjeto(projeto), p = projeto.dados, e = p.especificacoes;
    if (![e?.cliente, e?.produto, e?.publicoAlvo].every(preenchido)) erros.push('Publicidade exige cliente, produto e público-alvo.');
    if (!listaValida(e?.canais)) erros.push('Informe canais de veiculação válidos, sem repetição.');
    if (!Number.isFinite(e?.duracaoMaximaSegundos) || e!.duracaoMaximaSegundos! <= 0 || p.duracaoMinutos * 60 > e!.duracaoMaximaSegundos!) erros.push('A duração da peça excede o limite do briefing ou o limite é inválido.');
    return erros;
  }
}

abstract class RecomendadorFamilia implements RecomendacaoStrategy {
  protected base: RecomendacaoStrategy;
  constructor(projeto: ProjetoDados) { this.base = criarEstrategia(projeto); }
  protected abstract competencias(projeto: ProjetoDados): string[];
  recomendar(projeto: ProjetoDados, profissionais: ProfissionalDados[]): Ranking {
    const ranking = this.base.recomendar(projeto, profissionais);
    const porId = new Map(profissionais.map(p => [p.id, p]));
    const procuradas = this.competencias(projeto).map(normalizarTexto);
    for (const lista of Object.values(ranking)) {
      for (const candidato of lista) {
        const profissional = porId.get(candidato.profissionalId)!;
        const niveis = procuradas.map(nome => profissional.competencias.find(c => normalizarTexto(c.nome) === nome)?.nivel ?? 0);
        const adequacao = niveis.reduce((s, n) => s + n, 0) / (5 * Math.max(1, niveis.length));
        candidato.pontuacao = 0.6 * candidato.pontuacao + 0.4 * adequacao;
        candidato.motivos.push(`Especialização ${projeto.tipoProjeto}: ${(adequacao * 100).toFixed(1)}% em ${procuradas.join(', ')}.`);
      }
      lista.sort((a, b) => b.pontuacao - a.pontuacao || a.precoCentavos - b.precoCentavos || a.profissionalId.localeCompare(b.profissionalId));
    }
    return ranking;
  }
}
export class RecomendadorDocumentario extends RecomendadorFamilia {
  protected competencias(): string[] { return ['entrevista', 'captacao direta']; }
}
export class RecomendadorAnimacao extends RecomendadorFamilia {
  protected competencias(p: ProjetoDados): string[] { return [p.especificacoes?.tecnica === '2d' ? 'animacao 2d' : 'modelagem 3d', p.especificacoes?.software ?? '']; }
}
export class RecomendadorPublicitario extends RecomendadorFamilia {
  protected competencias(): string[] { return ['publicidade', 'storytelling']; }
}

export class RelatorioDocumentario extends GeradorRelatorio {
  override visitarProjeto(projeto: Projeto): string {
    return `${super.visitarProjeto(projeto)}\nDocumentário: ${projeto.dados.especificacoes?.tema}; entrevistas: ${projeto.dados.especificacoes?.entrevistados?.join(', ')}.`;
  }
}
export class RelatorioAnimacao extends GeradorRelatorio {
  override visitarProjeto(projeto: Projeto): string {
    const e = projeto.dados.especificacoes, estimada = horasRender(projeto.dados);
    const utilizacao = estimada / (e?.horasRenderDisponiveis || 1) * 100;
    return `${super.visitarProjeto(projeto)}\nAnimação ${e?.tecnica}: ${e?.software}; renderização estimada ${estimada.toFixed(2)} h; utilização da capacidade ${utilizacao.toFixed(1)}%.`;
  }
}
export class RelatorioPublicitario extends GeradorRelatorio {
  override visitarProjeto(projeto: Projeto): string {
    const e = projeto.dados.especificacoes;
    return `${super.visitarProjeto(projeto)}\nPublicidade: ${e?.cliente}; produto: ${e?.produto}; público: ${e?.publicoAlvo}; canais: ${e?.canais?.join(', ')}.`;
  }
}

export class NotificadorFamilia implements ObservadorProjeto {
  readonly nome = 'notificador-familia';
  protected tipo = 'padrao';
  protected titulo = 'Projeto';
  private destino: DestinoNotificacaoProjeto;
  constructor(destino: DestinoNotificacaoProjeto) { this.destino = destino; }
  async atualizar(evento: Evento, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const tipo = evento.dados.tipoProjeto ?? 'padrao';
    if (tipo !== this.tipo) throw new Error('Evento incompatível com a família do notificador');
    const destinatarios = evento.dados.destinatarios;
    if (!Array.isArray(destinatarios)) return;
    for (const destinatario of new Set(destinatarios.filter((v): v is string => typeof v === 'string' && v.length > 0))) {
      signal.throwIfAborted();
      const id = createHash('sha256').update(JSON.stringify([evento.id, 'interno', destinatario])).digest('hex');
      await this.destino.salvarNotificacao({ id, eventoId: evento.id, canal: 'interno', destinatario,
        assunto: `${this.titulo}: ${evento.tipo}`, dados: structuredClone(evento.dados), criadaEm: evento.ocorridoEm });
    }
  }
}
export class NotificadorDocumentario extends NotificadorFamilia { protected override tipo = 'documentario'; protected override titulo = 'Documentário / entrevistas'; }
export class NotificadorAnimacao extends NotificadorFamilia { protected override tipo = 'animacao'; protected override titulo = 'Animação / renderização'; }
export class NotificadorPublicitario extends NotificadorFamilia { protected override tipo = 'publicitario'; protected override titulo = 'Publicidade / briefing'; }
