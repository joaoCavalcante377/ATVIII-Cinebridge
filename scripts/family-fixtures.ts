import { FabricaDocumentario, FabricaAnimacao, FabricaPublicitario, PAPEIS } from '../src/domain/index.ts';
import type { ProfissionalDados, ProjetoDados } from '../src/domain/types.ts';

export function projetosFamilias(): ProjetoDados[] {
  return [
    new FabricaDocumentario().criarProjeto({ titulo: 'Vozes do bairro', especificacoes: {
      tema: 'Memórias do bairro', entrevistados: ['Maria', 'José'], autorizacoesConfirmadas: true,
    } }).dados,
    new FabricaAnimacao().criarProjeto({ titulo: 'Uma pequena viagem' }).dados,
    new FabricaPublicitario().criarProjeto({ titulo: 'Campanha do café', especificacoes: {
      cliente: 'Café da praça', produto: 'Café especial', publicoAlvo: 'Moradores do bairro', canais: ['internet', 'televisao'],
    } }).dados,
  ];
}

export function profissionaisFamilias(): ProfissionalDados[] {
  const especialidades = [['entrevista', 'captacao direta'], ['modelagem 3d', 'Blender'], ['publicidade', 'storytelling']];
  return especialidades.flatMap((competencias, familia) => Array.from({ length: 3 }, (_, i) => ({
    id: `10000000-0000-4000-8000-${String(familia * 3 + i + 1).padStart(12, '0')}`,
    nome: `${['Documentarista', 'Animador', 'Publicitário'][familia]} ${i + 1}`,
    email: `familia${familia}-profissional${i}@example.com`, papeis: [...PAPEIS],
    competencias: competencias.map(nome => ({ nome, nivel: 5 })), precoCentavos: 50_000,
    disponibilidade: { inicio: '2026-01-01', fim: '2035-12-31' }, localizacao: 'São Paulo',
    historico: [], avaliacoes: [{ nota: 4, comentario: 'Dado fictício para demonstração', data: '2026-06-01' }],
  })));
}
