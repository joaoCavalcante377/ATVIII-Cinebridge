# Cinebridge

API para recomendar profissionais e montar equipes de projetos audiovisuais. Continuação da ATVI: acrescenta documentários, animações e projetos publicitários, usando Prototype, Factory Method e Abstract Factory junto dos quatro padrões anteriores.

## Tecnologias

Node.js 24, TypeScript, Fastify, TypeORM, PostgreSQL e EventEmitter. Testes com `node:test`.

## Executar

1. Instale as dependências com `npm ci`.
2. Copie `.env.example` para `.env` e configure a conexão com o banco.
3. Inicie o PostgreSQL. Se usar Docker, execute `docker compose up -d --wait`.
4. Execute:

```sh
npm run db:migrate
npm run db:seed
npm start
```

A API fica em `http://localhost:3000`. Em outro terminal, execute `npm run demo` para o fluxo original ou `npm run demo:familias` para as três famílias e a clonagem. Os scripts fazem chamadas HTTP à API.

Se estiver usando o banco da ATVI, aplique `npm run db:migrate` normalmente: a nova migração preserva os projetos existentes. O seed usa dados fictícios e pode ser repetido.

## Testes

```sh
npm test
npm run test:integration
npm run test:coverage
```

Os testes de integração e cobertura precisam de PostgreSQL e da variável `TEST_DATABASE_URL` configurada no `.env`.

As rotas estão descritas em [docs/api.md](docs/api.md). O projeto não possui interface gráfica; as notificações de e-mail são registradas localmente, sem envio SMTP.

A análise e os padrões da segunda atividade estão em [docs/atv2.md](docs/atv2.md). Resultados dos testes: [docs/validacao.md](docs/validacao.md).
