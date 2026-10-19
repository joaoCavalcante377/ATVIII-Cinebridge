# ATVII — Cinebridge

API para recomendar profissionais e formar equipes de projetos audiovisuais. Continuação da [ATVI-Cinebridge](https://github.com/joaoCavalcante377/ATVI-Cinebridge), com suporte a documentários, animações e projetos publicitários.

O sistema considera competências, disponibilidade, localização e orçamento para sugerir uma equipe. O produtor pode aceitar as sugestões ou substituir integrantes, e cada profissional responde ao seu convite. A equipe só fica confirmada após os aceites necessários.

## Tecnologias

| Tecnologia | Uso |
|---|---|
| Node.js 24 | Execução dos arquivos TypeScript diretamente |
| TypeScript | Tipagem estática, verificada com `tsc --noEmit` |
| Fastify 5 | API HTTP e validação dos corpos das requisições |
| TypeORM 0.3 | Persistência com EntitySchema e migrações |
| PostgreSQL | Dados dos projetos, equipes, convites e eventos |
| EventEmitter | Distribuição de eventos para os observadores |
| node:test e c8 | Testes automatizados e cobertura |

A aplicação é um único serviço. O worker de eventos executa no mesmo processo da API. Não há interface gráfica ou menu interativo; os scripts de demonstração fazem requisições HTTP.

## Como executar

É necessário ter **Node.js 24.12 ou superior, dentro da versão 24**, npm e PostgreSQL. O arquivo Compose utiliza PostgreSQL 18.6; Docker com Compose é opcional para quem já tem o banco instalado.

### 1. Clonar e instalar

```sh
git clone https://github.com/joaoCavalcante377/ATVII-Cinebridge.git
cd ATVII-Cinebridge
npm ci
```

### 2. Configurar o ambiente

No PowerShell:

```powershell
Copy-Item .env.example .env
```

No Linux:

```sh
cp .env.example .env
```

O arquivo de exemplo contém:

```dotenv
DATABASE_URL=postgres://cinebridge:cinebridge@127.0.0.1:54329/cinebridge
TEST_DATABASE_URL=postgres://cinebridge:cinebridge@127.0.0.1:54329/cinebridge_test
HOST=127.0.0.1
PORT=3000
```

| Variável | Finalidade |
|---|---|
| `DATABASE_URL` | Conexão da aplicação com PostgreSQL |
| `TEST_DATABASE_URL` | Conexão usada pelos testes de integração e carga |
| `HOST` | Endereço de escuta da API; padrão `127.0.0.1` |
| `PORT` | Porta HTTP; padrão `3000` |

As credenciais acima correspondem ao ambiente local do Compose. Se usar outra instalação, ajuste usuário, senha, host e porta nas URLs.

### 3. Iniciar o PostgreSQL

Com Docker:

```sh
docker compose up -d --wait
```

O Compose publica a porta **54329** da máquina para a **5432** do contêiner. Na primeira inicialização de um volume vazio, cria os bancos `cinebridge` e `cinebridge_test`. Os registros permanecem no volume `cinebridge_pg` ao parar e iniciar o contêiner.

Sem Docker, crie os dois bancos na sua instalação e configure o `.env`. O usuário da conexão precisa poder criar tabelas e executar migrações; os testes também criam schemas isolados.

### 4. Aplicar as migrações e iniciar a API

```sh
npm run db:migrate
npm run db:seed
npm start
```

O seed cadastra **27 profissionais fictícios** para demonstração. Pode ser repetido: atualiza os mesmos IDs. É opcional se você for cadastrar os profissionais pela API.

A API fica em **http://localhost:3000**. Verifique `GET /health` e `GET /ready`. Não existe página inicial em `/`; essa rota retorna 404. Mantenha o terminal aberto e use `Ctrl+C` para encerrar. Para reiniciar automaticamente ao editar o código:

```sh
npm run dev
```

Para trocar a porta, altere `PORT` no `.env` antes de iniciar a aplicação.

## Banco de dados

O schema é criado por migrações, não por sincronização automática do ORM.

| Tabela | Conteúdo |
|---|---|
| `profissionais` | Cadastro, papéis, preço, disponibilidade e histórico |
| `competencias` | Competências e níveis dos profissionais |
| `avaliacoes` | Notas e comentários recebidos |
| `projetos` | Critérios, família, especificações e versão do projeto |
| `equipes` | Equipe atual, custo, estado e papéis pendentes |
| `membros_equipe` | Profissionais alocados e seus aceites |
| `recomendacoes` | Histórico dos rankings e avisos |
| `convites` | Convites e respostas dos profissionais |
| `outbox_eventos` | Eventos pendentes, entregues ou falhos |
| `notificacoes` | Notificações internas e registros locais de e-mail |
| `auditoria` | Registro dos eventos processados |

O TypeORM também mantém a tabela de controle das migrações. Há chaves estrangeiras, restrições de unicidade e transações para manter os dados relacionados consistentes. Campos estruturados, como especificações e rankings, usam JSONB.

**Banco da ATVI:** basta executar `npm run db:migrate`. A nova migração adiciona `tipoProjeto` e `especificacoes` sem apagar os registros existentes. Projetos antigos sem família explícita continuam usando o comportamento padrão.

## Rotas

URL base: `http://localhost:3000`. Envie os corpos como JSON, com `Content-Type: application/json`. Substitua `:id` e `:conviteId` pelos UUIDs retornados pela API.

| Método | Rota | Operação |
|---|---|---|
| GET | `/health` | Verificar se a API responde |
| GET | `/ready` | Verificar o banco e consultar o estado dos eventos |
| POST | `/profissionais` | Cadastrar profissional |
| POST | `/projetos` | Criar projeto e recomendar equipe |
| GET | `/projetos/:id` | Consultar projeto, equipe, recomendação e convites |
| GET | `/prototipos` | Listar os modelos disponíveis |
| POST | `/projetos/modelos/:nome` | Criar projeto a partir de um modelo, com ajustes |
| POST | `/projetos/:id/clonar` | Criar outro projeto a partir de um existente |
| POST | `/projetos/:id/aceitar` | Aceitar sugestões e emitir convites |
| POST | `/projetos/:id/membros/:papel/substituir` | Substituir um integrante |
| POST | `/projetos/:id/convites/:conviteId/resposta` | Aceitar ou recusar um convite |
| POST | `/projetos/:id/reavaliar` | Alterar critérios permitidos e recalcular a equipe |
| GET | `/projetos/:id/relatorio` | Consultar relatório, inconsistências e compatibilidade |
| GET | `/projetos/:id/notificacoes` | Consultar notificações registradas |
| GET | `/projetos/:id/auditoria` | Consultar eventos auditados |

Não há rotas de listagem geral de projetos/profissionais, exclusão ou edição genérica. Guarde os IDs retornados nas criações.

## Exemplos de uso

Os valores monetários são **centavos**: `300000` representa R$ 3.000,00. Datas usam `AAAA-MM-DD`; o período inclui início e fim. A duração do projeto é em minutos.

### Cadastrar profissional — POST /profissionais

```json
{
  "nome": "Ana Silva",
  "email": "ana@example.com",
  "papeis": ["EDITOR"],
  "competencias": [{"nome": "Blender", "nivel": 5}],
  "precoCentavos": 50000,
  "disponibilidade": {"inicio": "2027-03-01", "fim": "2027-03-30"},
  "localizacao": "São Paulo",
  "historico": [],
  "avaliacoes": []
}
```

Os níveis de competências e as notas variam de 0 a 5. O servidor gera o ID.

### Criar a partir de modelo — POST /projetos/modelos/animacao

```json
{
  "titulo": "Uma pequena viagem",
  "orcamentoCentavos": 300000,
  "inicio": "2027-03-01",
  "prazo": "2027-03-30",
  "especificacoes": {
    "tecnica": "3d",
    "software": "Blender",
    "horasRenderDisponiveis": 100
  }
}
```

Os demais campos vêm do modelo, incluindo os papéis necessários. O retorno 201 contém `projeto`, `equipe`, `recomendacao`, `convites`, `excluidos` e `versao`. Sem profissionais elegíveis, a criação pode retornar uma equipe parcial com os motivos.

Para criar diretamente por `POST /projetos`, use os exemplos completos:

- [Projeto padrão](examples/projeto.json)
- [Documentário](examples/projeto-documentario.json)
- [Animação](examples/projeto-animacao.json)
- [Publicidade](examples/projeto-publicitario.json)

### Aceitar sugestões — POST /projetos/:id/aceitar

```json
{}
```

Aceita todos os membros sugeridos. Para selecionar apenas alguns papéis, envie `{"papeis":["EDITOR"]}`. O retorno contém os convites criados; o aceite do produtor ainda não confirma o profissional.

### Responder convite — POST /projetos/:id/convites/:conviteId/resposta

```json
{
  "profissionalId": "UUID_DO_PROFISSIONAL",
  "resposta": "ACEITO"
}
```

Substitua o texto pelo UUID real do destinatário. Use `RECUSADO` para recusar. A recusa busca outra opção somente para aquele papel; o produtor precisa aceitar a nova sugestão.

### Substituir integrante — POST /projetos/:id/membros/EDITOR/substituir

Envie `{}` para buscar outra opção automaticamente, ou `{"profissionalId":"UUID_DO_PROFISSIONAL"}` para indicar alguém cadastrado. Os demais integrantes e seus aceites são preservados. Uma indicação que viole as restrições retorna 422.

### Reavaliar — POST /projetos/:id/reavaliar

```json
{
  "orcamentoCentavos": 350000,
  "estrategia": "orcamento"
}
```

Permite alterar orçamento, início, prazo, estratégia, parâmetros e especificações. Cancela os convites ativos e exige novos aceites. `{}` recalcula com os mesmos critérios.

### Clonar — POST /projetos/:id/clonar

```json
{
  "titulo": "Uma pequena viagem — versão 2",
  "orcamentoCentavos": 400000
}
```

Cria uma cópia independente, com novo ID e equipe recalculada. Não transfere convites, confirmações ou exclusões da origem. Permite ajustar os dados de produção, mas não trocar `tipoProjeto` ou escolher o ID. Objetos de especificações e parâmetros são mesclados; arrays informados substituem os anteriores.

## Famílias, estratégias e estados

| Família (`tipoProjeto`) | Características |
|---|---|
| `padrao` | Mantém o fluxo da ATVI; também é usado quando o campo é omitido |
| `documentario` | Tema, entrevistados, autorizações e competências de entrevista/captação |
| `animacao` | Técnica, software, capacidade e estimativa de renderização |
| `publicitario` | Cliente, produto, público, canais e limite de duração do briefing |

`tipoProjeto` identifica a família; `tipoCaptacao` aceita `documentario`, `ficcao` ou `animacao`. São campos diferentes. Para instanciar o modelo de documentário, preencha os entrevistados e confirme as autorizações em `especificacoes`. As regras completas estão em [docs/atv2.md](docs/atv2.md).

As estratégias disponíveis são `cosseno`, `colaborativa` e `orcamento`. A família acrescenta critérios especializados à pontuação. A reserva de produção, quando informada, é descontada do orçamento destinado à equipe.

Os papéis são `DIRETOR`, `DIRETOR_FOTOGRAFIA`, `SONOPLASTA`, `EDITOR`, `ROTEIRISTA` e `EFEITOS_VISUAIS`.

| Estado da equipe | Significado |
|---|---|
| `PARCIAL` | Há papéis sem profissional elegível dentro das restrições |
| `SUGERIDA` | Equipe completa, aguardando aceite do produtor |
| `AGUARDANDO` | Há convites emitidos e falta concluir os aceites |
| `CONFIRMADA` | Todos os integrantes receberam aceite do produtor e aceitaram seus convites |

## Eventos e notificações

As alterações e seus eventos são persistidos na mesma transação. Após o commit, o worker lê a outbox e aciona os observadores, com acompanhamento das promises, timeout e novas tentativas em caso de falha. As notificações são idempotentes para evitar duplicação na reentrega.

Por isso, notificações e auditoria podem aparecer depois da resposta HTTP da operação. O worker normalmente inicia uma nova rodada em até 200 ms. Eventos persistidos sobrevivem ao reinício da aplicação.

O canal de e-mail é **um registro local**, sem envio SMTP. Não há autenticação, reserva global de agenda ou integração financeira externa. O `profissionalId` na resposta de convite verifica o destinatário, mas não autentica o usuário.

## Respostas HTTP

| Código | Significado |
|---|---|
| 200 | Consulta ou operação concluída |
| 201 | Profissional ou projeto criado |
| 400 | Formato, tipo, campo ou parâmetro inválido |
| 403 | Profissional informado não é o destinatário do convite |
| 404 | Projeto, convite, modelo ou rota inexistente |
| 409 | Conflito de registro ou convite já respondido/cancelado |
| 413 | Corpo da requisição acima de 256 KiB |
| 422 | Violação de regra de domínio ou integridade |
| 503 | Banco indisponível ou cadastro indisponível para uma confirmação |
| 500 | Falha inesperada, registrada no log |

Orçamento insuficiente para preencher todos os papéis pode gerar equipe parcial, em vez de erro. A API fornece os motivos no resultado.

## Arquitetura e padrões

| Padrão | Aplicação |
|---|---|
| Strategy | Algoritmos de recomendação intercambiáveis |
| Template Method | Sequência de formação da equipe no orquestrador |
| Observer | Notificações e auditoria dos eventos |
| Visitor | Validação, compatibilidade e relatórios |
| Prototype | Clonagem profunda e registro de modelos |
| Factory Method | Subclasses de projeto selecionam sua fábrica |
| Abstract Factory | Criação dos componentes compatíveis de cada família |

```text
src/
  domain/          Entidades, regras, padrões e algoritmos
  application/     Casos de uso, catálogo e seleção de fábricas
  http/            Rotas e schemas de validação
  infrastructure/  TypeORM, migrações, barramento e worker
scripts/           Migrações, seed, demonstrações e avaliação
test/              Testes de domínio, aplicação e integração
examples/          Corpos JSON para criação de projetos
docs/              Análise, diagrama, API e resultados de validação
```

## Testes e demonstrações

| Comando | Finalidade |
|---|---|
| `npm run typecheck` | Conferir a tipagem sem gerar JavaScript |
| `npm test` | Executar testes que não dependem de PostgreSQL |
| `npm run test:integration` | Executar testes com PostgreSQL real |
| `npm run test:coverage` | Executar a suíte completa e gerar cobertura |
| `npm run demo` | Demonstrar o fluxo da ATVI por HTTP |
| `npm run demo:familias` | Demonstrar famílias, clones, relatórios e notificações |
| `npm run test:load` | Medir requisições concorrentes com PostgreSQL |
| `npm run evaluate` | Calcular métricas sobre uma fixture sintética |

Integração, cobertura e carga exigem `TEST_DATABASE_URL` e o PostgreSQL disponível. As demonstrações exigem a API em execução e os dados do seed. Rode-as em outro terminal. Se mudar a porta, configure a variável `BASE_URL` nesse terminal; no PowerShell:

```powershell
$env:BASE_URL = "http://127.0.0.1:3001"
npm run demo:familias
```

Na revalidação de **18/10/2026**, os **93 testes passaram**, com **97,74% de cobertura de linhas**. O relatório HTML é gerado em `coverage/index.html`. Os resultados foram obtidos em Windows com PostgreSQL real; não houve execução de validação em Ubuntu. Detalhes e condições da medição: [docs/validacao.md](docs/validacao.md).

## Problemas comuns

- **ECONNREFUSED na porta 54329:** confirme que o PostgreSQL terminou de iniciar e que a URL corresponde à porta configurada. Com Docker, consulte `docker compose ps` e `docker compose logs postgres`.
- **Tabela não encontrada:** execute `npm run db:migrate` no banco configurado.
- **Banco cinebridge_test não existe:** o script de inicialização do Compose só roda em volume vazio. Em um volume anterior, crie o banco de testes na instalação existente.
- **Porta 3000 ocupada:** encerre a outra instância ou altere `PORT` no `.env`.
- **404 ao abrir localhost:3000:** use uma rota existente, como `/health`; a aplicação não oferece página inicial.

## Documentação complementar

- [Uso detalhado da API](docs/api.md)
- [Análise e implementação da ATVII](docs/atv2.md)
- [Algoritmos de recomendação](docs/algoritmos.md)
- [Diagrama de classes em PlantUML](docs/diagrama.puml)
- [Validação e resultados dos testes](docs/validacao.md)
