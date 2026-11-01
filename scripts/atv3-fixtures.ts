import type { ServicoDados } from '../src/domain/types.ts';
import type { NovoProjeto } from '../src/application/service.ts';

/** Perfis fictícios no formato da rede profissional simulada (nota de recomendação de 1 a 10). */
export function perfisLinkedIn(): Record<string, unknown>[] {
  const pessoa = (id: string, firstName: string, headline: string, skills: [string, number][], amount: number, locationName = 'São Paulo') => ({
    id, firstName, lastName: 'Silva', emailAddress: `${id}@linkedin.example`, headline, positions: [{ title: headline }],
    skills: skills.map(([name, endorsements]) => ({ name, endorsements })), locationName, projectRate: { amount, currency: 'BRL' },
    availability: { start: '2026-01-01', end: '2035-12-31' },
    recommendations: [{ rating: 9, text: 'Entrega no prazo.', date: '2026-05-10' }],
  });
  return [
    pessoa('li-001', 'Marina', 'Film Director', [['direção', 45], ['narrativa', 30]], 900),
    pessoa('li-002', 'Caio', 'Video Editor', [['montagem', 50], ['colorização', 22]], 600),
    pessoa('li-003', 'Lia', 'Sound Designer', [['mixagem', 41]], 500),
    pessoa('li-004', 'Rafael', 'VFX Artist', [['composição', 38]], 700, 'Remoto'),
    pessoa('li-005', 'Bia', 'Marketing Manager', [['vendas', 12]], 300),
  ];
}

/** Perfis fictícios no formato do portal de vagas simulado (avaliação de 1 a 5 estrelas). */
export function perfisIndeed(): Record<string, unknown>[] {
  const candidato = (candidate_id: string, full_name: string, job_titles: string[], skills: [string, number][], amount_brl: number) => ({
    candidate_id, full_name, email: `${candidate_id}@indeed.example`, job_titles, skills: skills.map(([skill, years]) => ({ skill, years })),
    city: 'São Paulo', desired_pay: { amount_brl, period: 'project' }, available: { from: '2026-01-01', until: '2035-12-31' },
    reviews: [{ stars: 4, comment: 'Boa comunicação.', date: '2026-04-02' }],
  });
  return [
    candidato('in-101', 'Paulo Souza', ['Diretor'], [['direção', 6]], 800),
    candidato('in-102', 'Rita Lima', ['Editora de vídeo', 'Colorista'], [['montagem', 4], ['colorização', 5]], 550),
    candidato('in-103', 'Igor Melo', ['Técnico de mixagem'], [['mixagem', 3]], 450),
    candidato('in-104', 'Nina Reis', ['Motion designer'], [['composição', 5]], 650),
  ];
}

/** Pós-produção da atividade: subpacotes paralelos e serviços atômicos com papel, custo e prazo. */
export function servicosPosProducao(): ServicoDados {
  return { tipo: 'pacote', nome: 'Produção completa', execucao: 'sequencial', servicos: [
    { tipo: 'atomico', nome: 'Direção', custoCentavos: 90_000, prazoDias: 10, papel: 'DIRETOR', peso: 2, competencias: [{ nome: 'direção', nivel: 5 }] },
    { tipo: 'pacote', nome: 'Pós-produção', execucao: 'paralela', prazoMaximoDias: 12, servicos: [
      { tipo: 'pacote', nome: 'Imagem', execucao: 'sequencial', servicos: [
        { tipo: 'atomico', nome: 'Edição', custoCentavos: 40_000, prazoDias: 6, papel: 'EDITOR', competencias: [{ nome: 'montagem', nivel: 5 }] },
        { tipo: 'atomico', nome: 'Coloração', custoCentavos: 20_000, prazoDias: 3, papel: 'EDITOR', competencias: [{ nome: 'colorização', nivel: 4 }] },
      ] },
      { tipo: 'atomico', nome: 'Mixagem de áudio', custoCentavos: 25_000, prazoDias: 5, papel: 'SONOPLASTA', competencias: [{ nome: 'mixagem', nivel: 4 }] },
      { tipo: 'atomico', nome: 'Efeitos visuais', custoCentavos: 35_000, prazoDias: 8, papel: 'EFEITOS_VISUAIS', competencias: [{ nome: 'composição', nivel: 4 }] },
    ] },
  ] };
}

export function projetoComServicos(alteracoes: Partial<NovoProjeto> = {}): NovoProjeto {
  return {
    titulo: 'Curta com pós-produção', genero: 'drama', duracaoMinutos: 15, orcamentoCentavos: 400_000,
    inicio: '2027-03-01', prazo: '2027-03-30', tipoCaptacao: 'ficcao', localizacao: 'São Paulo', estrategia: 'cosseno',
    papeis: [], servicos: servicosPosProducao(), ...alteracoes,
  };
}
