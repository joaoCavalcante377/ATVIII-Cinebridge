import { randomUUID } from 'node:crypto';
import { Projeto, ProjetoAnimacao, ProjetoDocumentario, ProjetoPublicitario } from './model.ts';
import type { VisitanteProjeto } from './model.ts';
import type { DestinoNotificacaoProjeto, FabricaProjeto, ObservadorProjeto } from './factory-contracts.ts';
import { ErroDominio, PARAMETROS_PADRAO } from './types.ts';
import type { Equipe, Papel, ProfissionalDados, ProjetoDados } from './types.ts';
import { criarEstrategia } from './strategies.ts';
import type { RecomendacaoStrategy } from './strategies.ts';
import { GeradorRelatorio } from './visitors.ts';
import { NotificadorFamilia, NotificadorAnimacao, NotificadorDocumentario, NotificadorPublicitario,
  RecomendadorAnimacao, RecomendadorDocumentario, RecomendadorPublicitario,
  ValidadorFamilia, ValidadorAnimacao, ValidadorDocumentario, ValidadorPublicitario,
  RelatorioAnimacao, RelatorioDocumentario, RelatorioPublicitario } from './family-components.ts';

function dadosModelo(tipo: string, papeis: Papel[]): ProjetoDados {
  return { id: `modelo-${tipo}`, titulo: `Novo projeto ${tipo}`, genero: 'drama', duracaoMinutos: 1,
    orcamentoCentavos: 300_000, inicio: '2027-03-01', prazo: '2027-03-30', tipoCaptacao: 'ficcao',
    localizacao: 'São Paulo', estrategia: 'cosseno', parametros: { ...PARAMETROS_PADRAO },
    papeis: papeis.map(papel => ({ papel, peso: 1, competencias: [] })) };
}

export class FabricaPadrao implements FabricaProjeto {
  readonly tipo: string = 'padrao';
  protected prototipo: Projeto;
  constructor(prototipo = new Projeto(dadosModelo('padrao', ['DIRETOR', 'EDITOR']))) {
    if (new.target === FabricaPadrao && prototipo.dados.tipoProjeto && prototipo.dados.tipoProjeto !== 'padrao') throw new ErroDominio('Protótipo incompatível com a fábrica padrão');
    this.prototipo = prototipo.clonar();
  }
  criarProjeto(dados: Partial<ProjetoDados>): Projeto {
    if (dados.tipoProjeto !== undefined && dados.tipoProjeto !== this.tipo) throw new ErroDominio('Tipo de projeto incompatível com a fábrica');
    const copia = this.prototipo.clonar();
    const ajustes = structuredClone(dados);
    const completos: ProjetoDados = { ...copia.dados, ...ajustes, id: ajustes.id ?? randomUUID(),
      parametros: { ...copia.dados.parametros, ...ajustes.parametros } };
    if (copia.dados.especificacoes || ajustes.especificacoes) completos.especificacoes = { ...copia.dados.especificacoes, ...ajustes.especificacoes };
    // A identidade da família vem da fábrica, nunca de uma combinação de produtos do cliente.
    if (this.tipo !== 'padrao' || dados.tipoProjeto) completos.tipoProjeto = this.tipo;
    Object.assign(copia, { dados: completos });
    return copia;
  }
  criarValidador(equipe?: Equipe): VisitanteProjeto<string[]> { return new ValidadorFamilia(equipe); }
  criarRecomendador(projeto: ProjetoDados): RecomendacaoStrategy { return criarEstrategia(projeto); }
  criarNotificador(destino: DestinoNotificacaoProjeto): ObservadorProjeto { return new NotificadorFamilia(destino); }
  criarRelatorio(equipe?: Equipe, profissionais: ProfissionalDados[] = []): VisitanteProjeto<string> { return new GeradorRelatorio(equipe, profissionais); }
}

export class FabricaDocumentario extends FabricaPadrao {
  override readonly tipo: string = 'documentario';
  constructor(prototipo?: ProjetoDocumentario) {
    super(prototipo ?? new ProjetoDocumentario({ ...dadosModelo('documentario', ['DIRETOR', 'SONOPLASTA', 'EDITOR']),
      tipoProjeto: 'documentario', tipoCaptacao: 'documentario', duracaoMinutos: 20,
      especificacoes: { tema: 'Tema do documentário', entrevistados: [], autorizacoesConfirmadas: false, reservaOrcamentoCentavos: 20_000 } }));
    if (!(this.prototipo instanceof ProjetoDocumentario) || this.prototipo.dados.tipoProjeto !== this.tipo) throw new ErroDominio('Protótipo incompatível com documentário');
  }
  override criarValidador(equipe?: Equipe): VisitanteProjeto<string[]> { return new ValidadorDocumentario(equipe); }
  override criarRecomendador(projeto: ProjetoDados): RecomendacaoStrategy { return new RecomendadorDocumentario(projeto); }
  override criarNotificador(destino: DestinoNotificacaoProjeto): ObservadorProjeto { return new NotificadorDocumentario(destino); }
  override criarRelatorio(equipe?: Equipe, profissionais: ProfissionalDados[] = []): VisitanteProjeto<string> { return new RelatorioDocumentario(equipe, profissionais); }
}
export class FabricaAnimacao extends FabricaPadrao {
  override readonly tipo: string = 'animacao';
  constructor(prototipo?: ProjetoAnimacao) {
    super(prototipo ?? new ProjetoAnimacao({ ...dadosModelo('animacao', ['EFEITOS_VISUAIS', 'EDITOR']),
      tipoProjeto: 'animacao', tipoCaptacao: 'animacao',
      especificacoes: { tecnica: '3d', software: 'Blender', framesPorSegundo: 24, tempoRenderPorFrameSegundos: 10,
        horasRenderDisponiveis: 100, reservaOrcamentoCentavos: 40_000 } }));
    if (!(this.prototipo instanceof ProjetoAnimacao) || this.prototipo.dados.tipoProjeto !== this.tipo) throw new ErroDominio('Protótipo incompatível com animação');
  }
  override criarValidador(equipe?: Equipe): VisitanteProjeto<string[]> { return new ValidadorAnimacao(equipe); }
  override criarRecomendador(projeto: ProjetoDados): RecomendacaoStrategy { return new RecomendadorAnimacao(projeto); }
  override criarNotificador(destino: DestinoNotificacaoProjeto): ObservadorProjeto { return new NotificadorAnimacao(destino); }
  override criarRelatorio(equipe?: Equipe, profissionais: ProfissionalDados[] = []): VisitanteProjeto<string> { return new RelatorioAnimacao(equipe, profissionais); }
}
export class FabricaPublicitario extends FabricaPadrao {
  override readonly tipo: string = 'publicitario';
  constructor(prototipo?: ProjetoPublicitario) {
    super(prototipo ?? new ProjetoPublicitario({ ...dadosModelo('publicitario', ['ROTEIRISTA', 'EDITOR']),
      tipoProjeto: 'publicitario', duracaoMinutos: 0.5,
      especificacoes: { cliente: 'Cliente', produto: 'Produto', publicoAlvo: 'Público da campanha', canais: ['internet'],
        duracaoMaximaSegundos: 60, reservaOrcamentoCentavos: 30_000 } }));
    if (!(this.prototipo instanceof ProjetoPublicitario) || this.prototipo.dados.tipoProjeto !== this.tipo) throw new ErroDominio('Protótipo incompatível com publicidade');
  }
  override criarValidador(equipe?: Equipe): VisitanteProjeto<string[]> { return new ValidadorPublicitario(equipe); }
  override criarRecomendador(projeto: ProjetoDados): RecomendacaoStrategy { return new RecomendadorPublicitario(projeto); }
  override criarNotificador(destino: DestinoNotificacaoProjeto): ObservadorProjeto { return new NotificadorPublicitario(destino); }
  override criarRelatorio(equipe?: Equipe, profissionais: ProfissionalDados[] = []): VisitanteProjeto<string> { return new RelatorioPublicitario(equipe, profissionais); }
}

export class RegistroFabricas {
  private fabricas = new Map<string, FabricaProjeto>();
  registrar(fabrica: FabricaProjeto): void {
    if (!/^[a-z][a-z0-9-]{0,39}$/.test(fabrica.tipo) || this.fabricas.has(fabrica.tipo)) throw new ErroDominio('Família inválida ou já registrada');
    this.fabricas.set(fabrica.tipo, fabrica);
  }
  obter(tipo = 'padrao'): FabricaProjeto {
    const fabrica = this.fabricas.get(tipo);
    if (!fabrica) throw new ErroDominio(`Tipo de projeto não registrado: ${tipo}`);
    return fabrica;
  }
  listar(): string[] { return [...this.fabricas.keys()]; }
}
export function fabricasPadrao(): RegistroFabricas {
  const registro = new RegistroFabricas();
  for (const fabrica of [new FabricaPadrao(), new FabricaDocumentario(), new FabricaAnimacao(), new FabricaPublicitario()]) registro.registrar(fabrica);
  return registro;
}

export class RegistroPrototipos {
  private modelos = new Map<string, Projeto>();
  registrar(nome: string, projeto: Projeto): void {
    if (!nome.trim() || this.modelos.has(nome)) throw new ErroDominio('Protótipo inválido ou já registrado');
    this.modelos.set(nome, projeto.clonar());
  }
  clonar(nome: string): Projeto {
    const prototipo = this.modelos.get(nome);
    if (!prototipo) throw new ErroDominio('Protótipo não encontrado', 404);
    return prototipo.clonar();
  }
  listar(): { nome: string; dados: ProjetoDados }[] {
    return [...this.modelos].map(([nome, p]) => ({ nome, dados: p.clonar().dados }));
  }
}
