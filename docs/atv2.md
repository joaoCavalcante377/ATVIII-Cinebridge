# Segunda atividade

A ATVII continua o serviço da ATVI. A recomendação, o aceite do produtor, os convites, as substituições e a reavaliação foram preservados. A mudança concentra a criação dos componentes de cada tipo de projeto em famílias consistentes.

## Análise da primeira versão

O orquestrador instanciava a estratégia diretamente; o serviço criava o orquestrador e a API montava validadores e relatórios genéricos. Era suficiente para as três estratégias da ATVI, mas adicionar regras por tipo de produção exigiria alterar vários pontos.

- Rigidez: novos tipos exigiriam condicionais no processo de recomendação e nas rotas.
- Fragilidade: selecionar separadamente um validador, uma estratégia e um notificador permitiria combinar componentes de famílias diferentes.
- Imobilidade: reutilizar uma configuração de projeto exigiria repetir seus campos e suas restrições, com risco de compartilhar arrays e objetos mutáveis.

Isso não significa que a primeira versão falhava em seus requisitos. São dificuldades que surgem com a ampliação pedida na segunda atividade.

## Padrões na implementação

| Padrão | Implementação e uso |
|---|---|
| Prototype | `Projeto.clonar()` copia os dados profundamente e preserva a classe concreta. `RegistroPrototipos` protege modelos contra alterações externas. |
| Factory Method | `Projeto.criarFabrica()` é sobrescrito em `ProjetoDocumentario`, `ProjetoAnimacao` e `ProjetoPublicitario`. A criação a partir de modelo e a clonagem usam esse método polimórfico. |
| Abstract Factory | `FabricaProjeto` define criação de projeto, validador, recomendador, notificador e relatório. As três fábricas concretas produzem componentes da mesma família. |
| Template Method | `OrquestradorEquipe.orquestrar()` preserva a sequência de validação, normalização, recomendação, alocação e pós-processamento. Recebe a fábrica por construtor. |
| Strategy | Cosseno, filtragem colaborativa e orçamento permanecem disponíveis. Os recomendadores de família compõem essas estratégias com a adequação especializada. |
| Observer | Eventos persistidos na outbox são entregues a e-mail local, notificador da família e auditoria, com controle das tarefas assíncronas. |
| Visitor | Validadores, relatórios e compatibilidade visitam as entidades. Cada família fornece seus visitors específicos. |

`SistemaRecomendacao` consulta o registro de fábricas pelo `tipoProjeto`. O orquestrador não contém uma seleção condicional entre documentário, animação e publicidade. Projetos antigos sem esse campo usam a família `padrao`, mantendo seu comportamento.

## Regras adotadas

O enunciado pede diferenças entre as famílias, mas não determina todos os campos, pesos ou limites numéricos. As seguintes regras são decisões desta implementação, expostas na API e verificadas nos testes:

| Família | Regras e componentes específicos |
|---|---|
| Documentário | Tema, entrevistados distintos e autorizações confirmadas; exige direção e som. Favorece competências em entrevista e captação direta. Relatório e notificação incluem o contexto de documentário. |
| Animação | Técnica 2D/3D, software, taxa de quadros e capacidade de renderização; exige efeitos visuais e edição. Favorece a técnica e o software informados. Relatório mostra horas estimadas e utilização da capacidade. |
| Publicidade | Cliente, produto, público e canais distintos; duração dentro do limite do briefing; exige roteiro e edição. Favorece publicidade e storytelling. |

O orçamento disponível à equipe é o total menos a reserva de produção. A pontuação de família usa 60% da estratégia selecionada e 40% da adequação especializada. A renderização é estimada por `minutos × 60 × quadros/segundo × segundos/quadro ÷ 3600`; não executa renderização real e não modela paralelismo de GPUs. A capacidade informada também deve caber no período do projeto.

Os modelos são configurações iniciais ajustáveis, não produções concluídas. O modelo de documentário exige preencher entrevistas e autorizações antes de persistir um projeto válido. Datas e nomes fictícios devem ser adaptados ao uso.

## Clonagem e persistência

A operação de domínio `clonar()` preserva inclusive o identificador e copia os objetos e arrays internos sem referências compartilhadas. Ao criar um novo projeto pela API, a fábrica atribui outro UUID, recalcula a equipe e inicia novos convites. Confirmações, exclusões e eventos do projeto de origem não são transferidos: pertencem ao seu ciclo de execução, não ao modelo de produção.

O banco armazena o discriminador de família e suas especificações em duas novas colunas. Ao carregar um registro, a fábrica reconstitui a classe concreta antes de executar os comportamentos. A migração original permanece intacta. Os testes aplicam e revertem a nova migração preservando um projeto da primeira versão.

## Assincronismo

Projeto e eventos são gravados na mesma transação. O worker só publica eventos confirmados, acompanha as promises dos observadores, controla timeout e tenta novamente em caso de falha. IDs determinísticos impedem duplicar notificações na reentrega. A família é incluída nos dados do evento, portanto o processamento após reinício continua selecionando o notificador correto. E-mail e auditoria mantêm observadores independentes; a notificação interna usa o componente da fábrica.

## Extensão e verificação

Para outra família, implemente a subclasse de projeto e sua fábrica com os componentes adequados; registre-a em `RegistroFabricas` antes de construir `SistemaRecomendacao`. Injete esse sistema na API. Campos adicionais de entrada também precisam ser incluídos no schema HTTP quando não fazem parte do contrato atual.

O teste de realidade virtual em `test/factories.test.ts` demonstra a extensão sem modificar o orquestrador. `test/integration/families.test.ts` verifica as três famílias contra PostgreSQL real, persistência, validação, relatórios, notificações, clonagem, reavaliação e reentrega após reinício. Os testes anteriores continuam incluídos.

O diagrama de implementação está em `diagrama.puml`. A aplicação continua sendo um único serviço; a separação em módulos não cria outros microsserviços.
