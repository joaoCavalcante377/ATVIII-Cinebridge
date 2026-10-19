import { criarDataSource, RepositorioPostgres } from '../src/infrastructure/database.ts';
import { profissionaisExemplo } from './fixtures.ts';
import { profissionaisFamilias } from './family-fixtures.ts';

if (!process.env.DATABASE_URL) throw new Error('Defina DATABASE_URL');
const db = criarDataSource(process.env.DATABASE_URL);
await db.initialize();
try {
  const repositorio = new RepositorioPostgres(db);
  const profissionais = [...profissionaisExemplo(), ...profissionaisFamilias()];
  for (const profissional of profissionais) await repositorio.salvarProfissional(profissional);
  console.log(`${profissionais.length} profissionais fictícios cadastrados. Repetir o seed atualiza os mesmos IDs.`);
} finally { await db.destroy(); }
