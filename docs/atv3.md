# Terceira atividade

A ATVIII continua o serviço da ATVII. Recomendação, convites, substituições, famílias de projeto e protótipos foram preservados. A mudança introduz três padrões estruturais: **Adapter** para sistemas externos, **Composite** para pacotes de serviços e **Decorator** para cache, auditoria e compressão. Antes de introduzi-los, o código da ATVII foi analisado em busca de anti-padrões.

## Anti-padrões encontrados na ATVII

| Problema | Onde estava | Por que é um anti-padrão | Refatoração |
|---|---|---|---|
| Objeto Deus em formação | `SistemaRecomendacao` | Concentrava fábricas, protótipos, criação do orquestrador, um cache por família e a seleção entre usar ou não o cache (`if (opcoes)`). Cada nova integração seria acrescentada ali. | Integrações entram por interfaces de adaptadores; o cache saiu da classe e virou um decorador; a pilha é montada por um registro. |
| Responsabilidade transversal acoplada | `CacheRecomendacoes` | Dependia da classe concreta `OrquestradorPadrao`, repetia a validação do projeto e não podia ser combinada com outras funções. Auditoria e compressão no mesmo estilo exigiriam uma subclasse ou condicional para cada combinação. | `CacheDecorator`, `AuditoriaDecorator` e `CompressaoDecorator` sobre `RecomendacaoStrategy`, combináveis em qualquer ordem. A classe antiga foi removida. |
| Dependência de implementação concreta | Catálogo lendo `repositorio.listarProfissionais()` | A lógica de negócio só conhecia a tabela local. Uma fonte externa exigiria mudar o serviço e conhecer o formato de cada provedor. | `AdaptadorProfissional`; o catálogo usa o adaptador configurado (`AdaptadorInterno` por padrão). |
| Estrutura achatada | `Projeto.papeis` | Uma lista simples não representa pacotes e subpacotes, nem custo e prazo por serviço. Operações sobre a hierarquia ficariam espalhadas em laços com verificação de tipo. | `ServicoProjeto`, `ServicoAtomico` e `PacoteServico`. O projeto passa a ter `servicoPrincipal`. |
| Custo escondido por um cache amplo | `OrquestradorPadrao.normalizarDados` | Cada recomendação revalidava o catálogo inteiro. O cache antigo, por guardar a orquestração completa, escondia esse custo. Ao mover o cache para a estratégia, a carga com 10 mil profissionais ficou cerca de dez vezes mais lenta. | Validação memorizada por objeto e normalização por versão do catálogo (ver [Desempenho](#desempenho)). |

### Padrões que podem virar anti-padrões

- **Abstract Factory da ATVII.** Quatro fábricas, um registro e protótipos são uma estrutura grande para diferenças que, em parte, são de configuração. A estrutura foi mantida porque é requisito da ATVII e já tem testes. Uma família nova cujos componentes difiram apenas em parâmetros deveria usar configuração, não outra hierarquia de fábricas.
- **Decorator.** Camadas demais dificultam a depuração, e a ordem muda o comportamento. Por isso cada decorador tem um nome no registro, a política é uma lista explícita, as métricas mostram o que cada camada fez e os testes fixam o efeito de três ordens diferentes.
- **Adapter.** Um adaptador que só repassa chamadas não justifica sua existência. Os adaptadores daqui fazem tradução real: unidade monetária, nomes de campos, status, escalas de nota, formato de perfil e identificadores.
- **Composite.** Uma referência circular ou a mesma instância em dois pacotes tornaria custo e prazo infinitos ou duplicados. `PacoteServico.adicionar` recusa os dois casos, e a reconstrução a partir de JSON limita a profundidade a 8 níveis e o total a 200 serviços.

## Adapter

| Interface | Implementações | Sistema externo simulado | Tradução feita pelo adaptador |
|---|---|---|---|
| `AdaptadorArmazenamento` | `AdaptadorS3`, `AdaptadorGoogleCloud`, `AdaptadorLocal` | `ArmazenamentoExterno` (`upload(File)`, `download`, `listar`) | `Buffer` e metadados → `File` com chave e tipo; chaves → `s3://bucket/…`, `gs://bucket/…` ou `local://…`; erros do provedor → 404/503/502 |
| `AdaptadorPagamento` | `AdaptadorStripe`, `AdaptadorPagSeguro`, `AdaptadorPayPal` | `GatewayPagamento` (`processarPagamento`, `estornarPagamento`, `consultarStatus`) | Centavos ↔ centavos (Stripe) ou reais (PagSeguro, PayPal); campos `customer/destination/idempotency_key`, `pagador/recebedor/reference_id` ou `payer_id/payee_email/invoice_id`; status do provedor → `APROVADO`, `PENDENTE`, `RECUSADO`, `CANCELADO` |
| `AdaptadorProfissional` | `AdaptadorLinkedIn`, `AdaptadorIndeed`, `AdaptadorInterno` | `ApiProfissionalExterna` (`buscarProfissionais`, `obterPerfil`, `avaliarProfissional`) | Perfis de rede profissional e de portal de vagas → `Profissional`; cargos em português ou inglês → papéis técnicos; endossos ou anos de experiência → nível 0–5; notas 1–10 ou 1–5 ↔ 0–5 |

`SistemaRecomendacao` recebe os três adaptadores pelo construtor ou por `configurarAdaptadores(armazenamento, pagamento, profissional)`. Se um deles faltar, a operação responde 503. `executarRecomendacao(projeto)` busca profissionais pela fonte configurada e devolve a equipe. As operações de negócio em `ServicoEquipes` (anexar e listar arquivos, pagar a equipe confirmada, registrar avaliação) usam somente as interfaces.

O diagrama indica cardinalidade `0..1` entre adaptador e sistema externo. `AdaptadorLocal` (disco) e `AdaptadorInterno` (repositório próprio) não adaptam um sistema externo; os demais adaptam exatamente um.

**Pagamentos.** Só equipes `CONFIRMADA` são pagas; cada integrante recebe o preço da sua alocação. A referência `projeto:equipe:papel` vai como chave de idempotência, portanto repetir a chamada não cobra de novo. O resultado é registrado no evento `pagamentos.processados`, na mesma transação que incrementa a versão do projeto.

**Arquivos.** Até 25 MiB, enviados em base64 pela API. Os nomes são normalizados para caracteres portáveis entre Windows e Linux. Os prefixos e identificadores locais são validados contra travessia de diretórios. A listagem e o download são limitados à pasta `projetos/<id>/` do projeto.

## Composite

| Classe | Papel no padrão | Comportamento |
|---|---|---|
| `ServicoProjeto` | Componente | `calcularCusto`, `listarSubservicos`, `obterPrazo`, `validar`; também `listarRequisitos` e `serializar` |
| `ServicoAtomico` | Folha | Custo em centavos, prazo em dias, papel técnico, peso e competências |
| `PacoteServico` | Composto | Lista de `ServicoProjeto`; execução `sequencial` (soma os prazos) ou `paralela` (maior prazo); prazo máximo opcional |

`Projeto.servicoPrincipal` é a raiz. `calcularCustoTotal()` e `calcularPrazoTotal()` delegam a ela, e a operação desce recursivamente pela hierarquia. A validação também é recursiva e informa o caminho do nó com problema, por exemplo `Produção completa › Pós-produção › Imagem › Coloração: papel técnico inválido.` O validador do projeto (Visitor da ATVII) inclui a validação da estrutura, portanto toda recomendação a executa. Além disso, verifica se o prazo total cabe no período, se o custo estimado não ultrapassa o orçamento e se os papéis do projeto correspondem às folhas.

A recomendação continua trabalhando com papéis. Eles são **derivados** das folhas: serviços do mesmo papel somam seus pesos e unem as competências, pelo maior nível. Assim, um editor que faz edição e coloração é escolhido considerando as duas exigências. `resumirServico` percorre qualquer nó da mesma forma e associa os integrantes da equipe aos serviços dos seus papéis (`GET /projetos/:id/servicos`).

Projetos sem `servicos` continuam válidos: são representados por um pacote paralelo, com um serviço por papel, custo zero (não informado) e prazo igual ao período. A hierarquia é persistida em JSONB e reconstruída ao carregar.

## Decorator

| Classe | Papel no padrão | Comportamento |
|---|---|---|
| `RecomendacaoStrategy` | Componente | Interface inalterada: `recomendar(projeto, profissionais)` |
| `RecomendadorBase` | Componente concreto | A lógica da ATVI/ATVII: estratégia escolhida (cosseno, colaborativa, orçamento) com a especialização da família do projeto |
| `RecomendacaoDecorator` | Decorador abstrato | Guarda a estratégia envolvida (recebida no construtor) e delega |
| `CacheDecorator` | Decorador concreto | Reaproveita o ranking de projetos com os mesmos critérios (sem considerar id e título) e o mesmo cadastro. LRU de 128 entradas, validade de 60 s |
| `AuditoriaDecorator` | Decorador concreto | Registra cada chamada: projeto, família, estratégia, quantidade de profissionais e candidatos, duração, sucesso ou erro |
| `CompressaoDecorator` | Decorador concreto | Compacta o ranking (pontuação com 4 casas, motivos sem repetição) e prepara uma versão gzip, com estatísticas de bytes |

`RegistroDecoradores` monta a pilha a partir de uma lista de nomes, e o primeiro nome fica mais próximo do recomendador base. `['cache', 'auditoria', 'compressao']` produz `Compressao(Auditoria(Cache(base)))`. A pilha é escolhida em tempo de execução, sem alterar `SistemaRecomendacao`:

1. preferência do produtor no projeto (`preferencias.decoradores`), persistida com ele;
2. política global, alterável por `PUT /recomendador/politica`;
3. variável `RECOMENDACAO_DECORADORES` na inicialização (padrão `cache,auditoria`).

A ordem tem efeito e é testada. Com a auditoria por fora do cache, ela registra também as respostas vindas do cache; com o cache por fora, as repetições não chegam à auditoria. Um decorador novo é registrado com `registrar(nome, fabrica)`, sem mudar o sistema (há um teste com um decorador `top3`). `definirEstrategia` troca o componente central, e a mesma política continua sendo aplicada sobre ele.

**Imutabilidade do cache.** O ranking guardado é congelado e compartilhado. Cada acerto devolve uma raiz nova, que aceita substituir listas, mas listas e candidatos não podem ser alterados; uma tentativa gera `TypeError` em vez de corromper o cache. Copiar 10 mil candidatos a cada acerto custava cerca de 16 ms.

**Compressão.** A interface não muda, portanto o decorador devolve um `Ranking`. A compactação reduz o JSON transmitido e persistido; o gzip fica disponível por `CompressaoDecorator.pacoteDe(ranking)` e é revertido por `descomprimir`. A API HTTP não envia essa versão gzip; ela demonstra o volume que um consumidor remoto receberia. Arredondar a pontuação para 4 casas pode alterar um desempate abaixo dessa precisão, por isso a compressão não faz parte da política padrão.

## Desempenho

O teste de carga da ATVII (10 mil profissionais, 100 requisições simultâneas por estratégia) foi repetido nesta máquina com as duas versões:

| Versão | Cosseno p50 | Colaborativa p50 | Orçamento p50 |
|---|---:|---:|---:|
| ATVII | 720 ms | 826 ms | 453 ms |
| ATVIII, primeira versão do decorador | 7.896 ms | 8.741 ms | 8.270 ms |
| ATVIII final | 1.039 ms | 1.129 ms | 747 ms |

A primeira versão foi reprovada pelo limite de 2 s do script. As correções foram: validar cada cadastro uma única vez por objeto; normalizar o catálogo uma vez por versão; não montar o mapa de membros fixos quando não há fixos; calcular a impressão do cadastro uma vez por lista; e devolver dados congelados no cache em vez de cópias. Todas dependem de os objetos do catálogo serem tratados como imutáveis; uma nova leitura gera novos objetos e invalida os resultados.

A versão final continua cerca de 40% mais lenta que a ATVII neste cenário. O cache agora guarda o ranking, como pede o padrão, e não a orquestração inteira; por isso a alocação da equipe (cerca de 5 ms com 10 mil candidatos) é executada a cada requisição. Registro: [carga.json](carga.json).

## Decisões e limites

- **Sistemas externos simulados.** `ArmazenamentoExterno`, `GatewayPagamento` e `ApiProfissionalExterna` imitam o vocabulário dos provedores, mas não fazem chamadas de rede nem usam credenciais. O estado de S3/GCS simulados e dos gateways fica em memória e se perde ao reiniciar. O armazenamento local grava em disco (`ARMAZENAMENTO_DIR`). Integrar um provedor real exige outro adaptador ou trocar o sistema simulado pelo SDK, sem mudar a regra de negócio.
- **Assinaturas assíncronas.** O diagrama mostra retornos como `string` e `Buffer`. Como armazenamento, pagamento e cadastros externos são operações de E/S, as implementações retornam `Promise<string>`, `Promise<Buffer>` etc. Nomes e parâmetros seguem o diagrama. `efetuarPagamento` aceita um quarto parâmetro opcional, `referencia`, para idempotência.
- **Três adaptadores por interface.** O enunciado pede ao menos dois; o diagrama mostra três (inclusive `AdaptadorLocal`, `AdaptadorPayPal` e `AdaptadorIndeed`), e os três foram implementados.
- **Fontes externas e o banco.** Os membros de equipe têm chave estrangeira para `profissionais`. Por isso a API usa o cadastro interno; LinkedIn e Indeed simulados são usados por `executarRecomendacao`, pela demonstração e pelos testes. Importar perfis externos para o cadastro seria o passo seguinte.
- **Avaliações.** O adaptador interno serializa avaliações do mesmo profissional dentro de um processo. Com várias instâncias da API, avaliações simultâneas da mesma pessoa ainda poderiam se sobrepor.
- **Auditoria e métricas dos decoradores** ficam em memória (últimos 1.000 registros) e são expostas em `GET /recomendador`. A auditoria de eventos da ATVII, em PostgreSQL, continua separada.

## Compatibilidade

Windows 10 ou superior e Ubuntu 24.04.3 ou superior (e derivados) exigem Node.js 24.12+ na série 24. Todas as dependências são JavaScript puro, sem compilação nativa. Os caminhos usam `node:path`, os identificadores de arquivo usam barras normais em qualquer sistema, e os scripts npm não dependem de shell. A validação está em [validacao.md](validacao.md).
