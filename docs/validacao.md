# Validação da ATVIII

Execução em 01/11/2026, com PostgreSQL 18.6 local (mesma versão do `compose.yaml`) em dois ambientes:

| Ambiente | Sistema | Node |
|---|---|---|
| Linux | Ubuntu 26.04.1 LTS (WSL2, kernel 6.18) | 24.22.1 |
| Windows | Windows 11, build 10.0.26200 (nativo, não WSL) | 24.14.0 |

No Windows, o projeto foi instalado do zero (`npm ci`) em uma pasta do próprio Windows, e os testes de integração usaram o mesmo PostgreSQL pela rede local.

| Verificação | Linux | Windows |
|---|---|---|
| `npm ci` | 195 pacotes, sem compilação nativa | 195 pacotes |
| `npm run typecheck` | Sem erros com TypeScript estrito | Sem erros |
| `npm test` (sem banco) | 92 aprovados | 92 aprovados |
| `npm run test:coverage` (com PostgreSQL) | 120 aprovados, nenhum ignorado ou cancelado | 120 aprovados, nenhum ignorado ou cancelado |
| Linhas e instruções | 98,09% | 98,09% |
| Ramificações | 95,71% | 95,71% |
| Funções | 98,46% | 98,46% |
| `npm run demo:atv3` | Três padrões, sem banco | Inclui armazenamento em disco com caminhos do Windows |
| `npm run db:migrate` | Três migrações, incluindo `ServicosProjeto1794000000000` | — |
| `npm run db:seed` | 27 profissionais fictícios | — |
| `npm run demo` e `npm run demo:familias` | Fluxos da ATVI e da ATVII por HTTP | — |
| `npm run demo:atv3:http` | Hierarquia, confirmação, arquivo, pagamento idempotente e métricas por HTTP | — |
| `npm run test:load` | 300 requisições, sem erros | — |

Os 120 testes incluem os 92 da ATVII, menos o teste do cache removido, e 28 novos: 8 do Composite, 8 do Adapter, 8 do Decorator, 1 de HTTP e 3 de integração com PostgreSQL. A cobertura inclui todos os arquivos `src/**/*.ts`; `server.ts` aparece com 0% porque a inicialização real foi exercitada pelas demonstrações HTTP. Cobertura mede execução, não comprova ausência de defeitos. Dados brutos: [testes.txt](testes.txt) e [cobertura.json](cobertura.json).

## O que os testes demonstram

| Padrão | Verificação |
|---|---|
| Adapter | O mesmo método de `ServicoEquipes` grava, lista e recupera arquivos em S3, Google Cloud e disco local, trocando apenas o adaptador injetado. A mesma equipe confirmada é paga por Stripe, PagSeguro e PayPal, com valor na unidade de cada gateway e repetição idempotente. LinkedIn, Indeed e o cadastro interno produzem a mesma equipe em `executarRecomendacao`. Também são verificadas a tradução de falhas (404/503), as escalas de nota, a recusa de identificadores de outro provedor e de travessia de diretórios. |
| Composite | Custo e prazo em profundidades 1, 2, 4 e 8, em pacotes sequenciais e paralelos. A validação recursiva informa o caminho do nó. São recusados ciclos e instâncias repetidas. O projeto delega custo e prazo ao serviço principal, deriva os papéis e verifica prazo e orçamento. A hierarquia sobrevive à clonagem e à persistência em PostgreSQL. |
| Decorator | O cache reduz o tempo de requisições repetidas: com 1.200 profissionais e estratégia colaborativa, o teste exige menos da metade do tempo sem cache, e o componente interno executa uma vez. A auditoria registra sucessos, falhas e durações. A compressão reduz o JSON e gera um gzip menor que um quinto do original, sem mudar candidatos nem ordem. Três ordens de pilha produzem o mesmo ranking, com efeitos diferentes e documentados. A pilha é escolhida por política ou preferência do produtor; o recomendador base nunca é alterado. |

## Carga

Cadastro de 10 mil profissionais no PostgreSQL; 100 requisições simultâneas de criação por estratégia, por HTTP TCP, com o cliente em outro processo e o worker de eventos ativo. Linux, AMD Ryzen 5 3600, política padrão `cache,auditoria`.

| Estratégia | p50 | p95 | Máximo | Erros |
|---|---:|---:|---:|---:|
| Cosseno | 1.039 ms | 1.094 ms | 1.096 ms | 0 |
| Colaborativa | 1.129 ms | 1.179 ms | 1.182 ms | 0 |
| Orçamento | 747 ms | 788 ms | 789 ms | 0 |

Na mesma máquina, a ATVII mediu 720, 826 e 453 ms. A diferença e as otimizações estão em [atv3.md](atv3.md#desempenho). Registro: [carga.json](carga.json). O teste reproduz o cenário da ATVI, com critérios iguais dentro de cada rodada; não mede combinações inéditas de critérios nem garante o mesmo desempenho em outra máquina.

## Limites

- No Windows foram executados a instalação, a tipagem, todos os testes e a demonstração sem banco. Migração, seed, demonstrações HTTP e carga foram executados no Linux.
- A validação em Linux foi feita no Ubuntu 26.04 (WSL2), não em uma instalação 24.04.3. O projeto não usa recursos posteriores ao Node 24.12 nem dependências nativas.
- O PostgreSQL de validação é o binário oficial 18.6 executado como processo local, não o contêiner do `compose.yaml`; versão e configuração de acesso são as mesmas do `.env.example`.
- Provedores de armazenamento, pagamento e cadastro externo são simulações; nenhum serviço real foi contatado.
- A avaliação de precision@3 (`npm run evaluate`) foi recalculada e não mudou: 1,00 para cosseno, 0,67 para colaborativa e 0,00 para orçamento, sobre uma fixture sintética. Veja [avaliacao.json](avaliacao.json).
