import { ESTRATEGIAS, PAPEIS } from '../domain/types.ts';

const texto = { type: 'string', minLength: 1, maxLength: 200 };
const dinheiro = { type: 'integer', minimum: 0, maximum: 1_000_000_000_000 };
const data = { type: 'string', format: 'date' };
const papel = { type: 'string', enum: PAPEIS };
const nivel = { type: 'number', minimum: 0, maximum: 5 };
const tipoCaptacao = { type: 'string', enum: ['documentario', 'ficcao', 'animacao'] };
const competencias = {
  type: 'array', maxItems: 50, items: {
    type: 'object', additionalProperties: false, required: ['nome', 'nivel'],
    properties: { nome: texto, nivel },
  },
};
export const parametrosSchema = {
  type: 'object', additionalProperties: false, properties: {
    pesoCompetencia: { type: 'number', minimum: 0, maximum: 1 },
    pesoAvaliacao: { type: 'number', minimum: 0, maximum: 1 },
    pesoPreco: { type: 'number', minimum: 0, maximum: 1 },
    limiteCandidatos: { type: 'integer', minimum: 1, maximum: 100 },
  },
};
const atomicoSchema = {
  type: 'object', additionalProperties: false, required: ['tipo', 'nome', 'custoCentavos', 'prazoDias', 'papel'],
  properties: { tipo: { const: 'atomico' }, nome: texto, custoCentavos: dinheiro, prazoDias: { type: 'integer', minimum: 1, maximum: 3_650 },
    papel, peso: { type: 'number', exclusiveMinimum: 0, maximum: 1_000 }, competencias },
};
/** JSON Schema não recursivo: cada nível aninha o próximo, até a profundidade aceita pelo domínio. */
function servicoSchema(niveis: number): object {
  if (niveis <= 1) return atomicoSchema;
  return { oneOf: [atomicoSchema, {
    type: 'object', additionalProperties: false, required: ['tipo', 'nome', 'servicos'],
    properties: { tipo: { const: 'pacote' }, nome: texto, execucao: { type: 'string', enum: ['sequencial', 'paralela'] },
      prazoMaximoDias: { type: 'integer', minimum: 1, maximum: 3_650 },
      servicos: { type: 'array', minItems: 1, maxItems: 50, items: servicoSchema(niveis - 1) } },
  }] };
}
export const servicosSchema = servicoSchema(8);
export const preferenciasSchema = { type: 'object', additionalProperties: false, properties: {
  decoradores: { type: 'array', maxItems: 10, uniqueItems: true, items: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,39}$' } },
} };
export const projetoSchema = {
  type: 'object', additionalProperties: false,
  required: ['titulo', 'genero', 'duracaoMinutos', 'orcamentoCentavos', 'inicio', 'prazo', 'tipoCaptacao', 'localizacao', 'estrategia'],
  // Com a hierarquia de serviços, os papéis são derivados dos serviços atômicos.
  anyOf: [{ required: ['papeis'] }, { required: ['servicos'] }],
  properties: {
    titulo: texto, genero: texto, duracaoMinutos: { type: 'number', exclusiveMinimum: 0, maximum: 100_000 },
    orcamentoCentavos: dinheiro, inicio: data, prazo: data, tipoCaptacao, localizacao: texto,
    estrategia: { type: 'string', enum: ESTRATEGIAS }, parametros: parametrosSchema,
    tipoProjeto: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,39}$' },
    papeis: { type: 'array', minItems: 1, maxItems: 6, items: {
      type: 'object', additionalProperties: false, required: ['papel', 'peso', 'competencias'],
      properties: { papel, peso: { type: 'number', exclusiveMinimum: 0, maximum: 1_000 }, competencias },
    } },
  },
};
export const especificacoesSchema = {
  type: 'object', additionalProperties: false, properties: {
    reservaOrcamentoCentavos: dinheiro,
    tema: texto, entrevistados: { type: 'array', maxItems: 100, uniqueItems: true, items: texto }, autorizacoesConfirmadas: { type: 'boolean' },
    tecnica: { type: 'string', enum: ['2d', '3d'] }, software: texto,
    framesPorSegundo: { type: 'integer', minimum: 1, maximum: 120 },
    tempoRenderPorFrameSegundos: { type: 'number', exclusiveMinimum: 0, maximum: 86400 },
    horasRenderDisponiveis: { type: 'number', exclusiveMinimum: 0, maximum: 100000 },
    cliente: texto, produto: texto, publicoAlvo: texto, canais: { type: 'array', maxItems: 20, uniqueItems: true, items: texto },
    duracaoMaximaSegundos: { type: 'number', exclusiveMinimum: 0, maximum: 36000 },
  },
};
export const projetoFamiliaSchema = { ...projetoSchema, properties: { ...projetoSchema.properties, especificacoes: especificacoesSchema,
  servicos: servicosSchema, preferencias: preferenciasSchema } };
const { tipoProjeto: _tipoProjeto, ...propriedadesAjustaveis } = projetoFamiliaSchema.properties;
export const ajustesSchema = { type: 'object', additionalProperties: false, properties: propriedadesAjustaveis };
export const modeloParams = { type: 'object', required: ['nome'], properties: { nome: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,39}$' } } };
export const profissionalSchema = {
  type: 'object', additionalProperties: false,
  required: ['nome', 'email', 'papeis', 'competencias', 'precoCentavos', 'disponibilidade', 'localizacao', 'historico', 'avaliacoes'],
  properties: {
    nome: texto, email: { type: 'string', format: 'email', maxLength: 254 },
    papeis: { type: 'array', minItems: 1, maxItems: 6, uniqueItems: true, items: papel },
    competencias, precoCentavos: dinheiro, localizacao: texto,
    disponibilidade: { type: 'object', additionalProperties: false, required: ['inicio', 'fim'], properties: { inicio: data, fim: data } },
    historico: { type: 'array', maxItems: 100, items: {
      type: 'object', additionalProperties: false, required: ['genero', 'tipoCaptacao', 'papel'],
      properties: { genero: texto, tipoCaptacao, papel, projetoId: texto, nota: nivel },
    } },
    avaliacoes: { type: 'array', maxItems: 100, items: {
      type: 'object', additionalProperties: false, required: ['nota', 'comentario', 'data'],
      properties: { nota: nivel, comentario: { type: 'string', maxLength: 2_000 }, data },
    } },
  },
};
export const idParams = { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } };
export const membroParams = { type: 'object', required: ['id', 'papel'], properties: { ...idParams.properties, papel } };
export const conviteParams = { type: 'object', required: ['id', 'conviteId'], properties: { ...idParams.properties, conviteId: { type: 'string', format: 'uuid' } } };
export const aceitarSchema = { type: 'object', additionalProperties: false, properties: { papeis: { type: 'array', minItems: 1, maxItems: 6, uniqueItems: true, items: papel } } };
export const substituirSchema = { type: 'object', additionalProperties: false, properties: { profissionalId: { type: 'string', format: 'uuid' } } };
export const respostaSchema = { type: 'object', additionalProperties: false, required: ['profissionalId', 'resposta'], properties: {
  profissionalId: { type: 'string', format: 'uuid' }, resposta: { type: 'string', enum: ['ACEITO', 'RECUSADO'] },
} };
export const reavaliarSchema = { type: 'object', additionalProperties: false, properties: {
  orcamentoCentavos: dinheiro, inicio: data, prazo: data, estrategia: { type: 'string', enum: ESTRATEGIAS }, parametros: parametrosSchema,
  especificacoes: especificacoesSchema, preferencias: preferenciasSchema,
} };
export const avaliacaoSchema = { type: 'object', additionalProperties: false, required: ['nota', 'comentario', 'data'], properties: {
  nota: nivel, comentario: { type: 'string', maxLength: 2_000 }, data,
} };
export const arquivoSchema = { type: 'object', additionalProperties: false, required: ['nome', 'conteudoBase64'], properties: {
  nome: texto, tipo: { type: 'string', pattern: '^[a-z0-9.+-]+/[a-z0-9.+-]+$', maxLength: 100 },
  categoria: { type: 'string', enum: ['roteiro', 'storyboard', 'amostra', 'outro'] },
  conteudoBase64: { type: 'string', minLength: 4, maxLength: 36_000_000, pattern: '^[A-Za-z0-9+/]*={0,2}$' },
} };
export const conteudoQuery = { type: 'object', additionalProperties: false, required: ['arquivoId'], properties: { arquivoId: { type: 'string', minLength: 1, maxLength: 1_000 } } };
export const transacaoParams = { type: 'object', required: ['transacaoId'], properties: { transacaoId: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,100}$' } } };
export const politicaSchema = { type: 'object', additionalProperties: false, required: ['decoradores'], properties: { decoradores: preferenciasSchema.properties.decoradores } };
