# Uso da API

Todos os corpos são JSON. Envie `Content-Type: application/json`. IDs retornados pela API são UUIDs. As datas são `AAAA-MM-DD`, sem horário; o período inclui início e fim.

## Criar projeto

`POST /projetos` com o conteúdo de `examples/projeto.json`. O retorno 201 tem:

```text
projeto       dados, critérios e parâmetros efetivos
equipe        membros, custoCentavos, papeisPendentes e status
recomendacao  ranking por papel, motivos, estratégia, avisos e flag degradada
convites      histórico dos convites (inicialmente vazio)
excluidos     IDs descartados por papel
versao        revisão transacional do projeto
```

`estrategia`: `cosseno`, `colaborativa` ou `orcamento`. Os parâmetros opcionais são `pesoCompetencia`, `pesoAvaliacao`, `pesoPreco` (0 a 1, soma positiva) e `limiteCandidatos` (1 a 100). Pesos padrão: 0,65 / 0,25 / 0,10; limite: 10. Os pesos são normalizados pela soma no cálculo.

Cada papel recebe `papel`, `peso` positivo e `competencias: [{nome, nivel}]`. A importância do papel orienta a alocação da equipe. O projeto pode exigir de um a seis papéis, sem repetir: `DIRETOR`, `DIRETOR_FOTOGRAFIA`, `SONOPLASTA`, `EDITOR`, `ROTEIRISTA`, `EFEITOS_VISUAIS`.

## Aceitar sugestões

`POST /projetos/:id/aceitar`

```json
{}
```

Aceita todos os membros sugeridos. Para selecionar papéis específicos:

```json
{"papeis":["DIRETOR","EDITOR"]}
```

Cada novo aceite cria um convite `PENDENTE`. Repetir o aceite não duplica convites. O produtor não confirma em nome do profissional.

## Rejeitar ou substituir

`POST /projetos/:id/membros/EDITOR/substituir`

```json
{}
```

Exclui o atual do papel e busca outra opção. Os outros membros permanecem fixos. Para indicar uma pessoa do cadastro:

```json
{"profissionalId":"UUID_DO_PROFISSIONAL"}
```

O novo profissional precisa atender às restrições e ao orçamento restante. A escolha inválida retorna 422 e reverte a operação inteira. Quem recusou ou foi rejeitado não volta automaticamente ao mesmo papel nesse projeto.

## Responder convite

`POST /projetos/:id/convites/:conviteId/resposta`

```json
{"profissionalId":"UUID_DO_DESTINATARIO","resposta":"ACEITO"}
```

Use `RECUSADO` para recusar. A recusa dispara recomendação somente para o papel afetado. A nova sugestão não é convidada sem aceite do produtor. A última confirmação necessária muda a equipe para `CONFIRMADA` e registra `equipe.confirmada`.

## Reavaliar

`POST /projetos/:id/reavaliar`

```json
{"orcamentoCentavos":300000,"prazo":"2027-03-25","estrategia":"orcamento"}
```

Permite alterar orçamento, início, prazo, estratégia, parâmetros, `especificacoes` e `preferencias`. As especificações informadas são mescladas com as existentes e novamente validadas. `{}` também solicita uma nova avaliação com os mesmos critérios. Cancela os convites ativos e exige novo consenso sobre a equipe sugerida.

## Famílias e modelos (ATVII)

`POST /projetos` aceita `tipoProjeto`: `padrao`, `documentario`, `animacao` ou `publicitario`. Omitir o campo mantém o comportamento da ATVI. Exemplos completos estão em `examples/projeto-documentario.json`, `examples/projeto-animacao.json` e `examples/projeto-publicitario.json`.

`especificacoes` reúne os campos específicos da família. Valores monetários são centavos; a duração do projeto é em minutos, enquanto o limite do briefing é em segundos. A reserva de produção é descontada antes de montar a equipe. As regras estão em [atv2.md](atv2.md).

`GET /prototipos` lista `{nome, dados}` dos modelos disponíveis.

`POST /projetos/modelos/:nome` recebe apenas os ajustes desejados, por exemplo:

```json
{"titulo":"Curta em animação","especificacoes":{"software":"Blender","horasRenderDisponiveis":80}}
```

Com `nome=animacao`, retorna 201 e um novo projeto recomendado. Para documentário, forneça também `entrevistados` e `autorizacoesConfirmadas: true` nas especificações. Um modelo não é alterado por essa operação. Modelo desconhecido retorna 404.

`POST /projetos/:id/clonar` recebe `{}` ou ajustes como título, orçamento, papéis e especificações. Retorna 201, com nova identidade, equipe recalculada e sem convites anteriores. Não altera a origem. Não permite trocar `tipoProjeto` ou fornecer `id` nos ajustes. As novas especificações são mescladas; arrays informados substituem integralmente os anteriores.

As três famílias possuem relatórios e notificações internas específicos nas mesmas rotas de leitura. Tipo não registrado ou regra específica violada retorna 422. Campo desconhecido retorna 400.

## Pacotes de serviços (ATVIII)

`POST /projetos` aceita `servicos` no lugar de `papeis`. Pelo menos um dos dois é obrigatório. Cada nó é um serviço atômico ou um pacote:

```json
{
  "titulo": "Curta com pós-produção", "genero": "drama", "duracaoMinutos": 15, "orcamentoCentavos": 900000,
  "inicio": "2027-03-01", "prazo": "2027-03-30", "tipoCaptacao": "ficcao", "localizacao": "São Paulo", "estrategia": "cosseno",
  "servicos": {
    "tipo": "pacote", "nome": "Produção completa", "execucao": "sequencial", "servicos": [
      {"tipo": "atomico", "nome": "Direção", "custoCentavos": 90000, "prazoDias": 10, "papel": "DIRETOR", "peso": 2},
      {"tipo": "pacote", "nome": "Pós-produção", "execucao": "paralela", "prazoMaximoDias": 12, "servicos": [
        {"tipo": "atomico", "nome": "Edição", "custoCentavos": 40000, "prazoDias": 6, "papel": "EDITOR",
         "competencias": [{"nome": "montagem", "nivel": 5}]},
        {"tipo": "atomico", "nome": "Mixagem de áudio", "custoCentavos": 25000, "prazoDias": 5, "papel": "SONOPLASTA"}
      ]}
    ]
  }
}
```

| Campo | Regra |
|---|---|
| `tipo` | `atomico` ou `pacote` |
| `custoCentavos`, `prazoDias`, `papel` | Obrigatórios na folha. Custo inteiro ≥ 0; prazo inteiro ≥ 1; `peso` (padrão 1) e `competencias` opcionais |
| `execucao` | `sequencial` (padrão) soma os prazos dos filhos; `paralela` usa o maior |
| `prazoMaximoDias` | Opcional; o prazo calculado do pacote não pode excedê-lo |

Até 8 níveis, 50 filhos por pacote e 200 serviços no total. Os papéis do projeto são derivados das folhas; folhas do mesmo papel somam pesos e unem competências. O prazo total precisa caber no período e o custo estimado no orçamento; caso contrário, a criação retorna 422 com o caminho do serviço inválido.

`GET /projetos/:id/servicos` retorna `custoTotalCentavos`, `prazoTotalDias`, `erros` e `arvore`, em que cada nó tem nome, custo, prazo, papéis, responsáveis da equipe e subserviços. Projetos sem `servicos` mostram um pacote derivado dos papéis, com custo zero.

## Arquivos (ATVIII)

`POST /projetos/:id/arquivos`, limitado a 25 MiB de conteúdo:

```json
{"nome": "roteiro final.pdf", "tipo": "application/pdf", "categoria": "roteiro", "conteudoBase64": "JVBERi0x..."}
```

`categoria`: `roteiro`, `storyboard`, `amostra` ou `outro`. Retorna 201 com `{id, provedor, bytes}`. O formato do `id` depende do provedor configurado: `local://…`, `s3://…` ou `gs://…`.

- `GET /projetos/:id/arquivos` lista `{provedor, arquivos}` do projeto.
- `GET /projetos/:id/arquivos/conteudo?arquivoId=<id>` devolve o conteúdo binário. Um arquivo de outro projeto retorna 404.

## Pagamentos (ATVIII)

`POST /projetos/:id/pagamentos`, sem corpo. Paga cada integrante de uma equipe `CONFIRMADA` pelo gateway configurado e retorna `{provedor, pagamentos: [{papel, profissionalId, valorCentavos, transacaoId, status}]}`. Equipe não confirmada retorna 409. A operação é idempotente: repeti-la devolve as mesmas transações, sem nova cobrança. O resultado é registrado no evento `pagamentos.processados`.

`GET /pagamentos/:transacaoId` retorna `{provedor, transacaoId, status}`, em que `status` é `APROVADO`, `PENDENTE`, `RECUSADO` ou `CANCELADO`.

## Avaliações (ATVIII)

`POST /profissionais/:id/avaliacoes` registra uma avaliação pela fonte de profissionais configurada. Retorna 204.

```json
{"nota": 4.5, "comentario": "Entrega no prazo", "data": "2027-04-01"}
```

## Decoradores da recomendação (ATVIII)

`GET /recomendador` retorna a política atual, os decoradores disponíveis (`cache`, `auditoria`, `compressao`), os provedores configurados e métricas: acertos e falhas do cache, bytes antes e depois da compressão, chamadas auditadas e os últimos 20 registros.

`PUT /recomendador/politica` altera a pilha global em execução. O primeiro nome fica mais próximo do recomendador base:

```json
{"decoradores": ["cache", "auditoria", "compressao"]}
```

O produtor pode escolher a pilha de um projeto com `"preferencias": {"decoradores": ["auditoria"]}` na criação, no clone ou na reavaliação. A preferência tem precedência sobre a política global. Nome desconhecido ou repetido retorna 422.

## Estados e leitura

- `PARCIAL`: existe papel sem profissional elegível dentro do orçamento.
- `SUGERIDA`: equipe completa, ainda sem convites aceitos pelo produtor.
- `AGUARDANDO`: pelo menos um convite emitido, faltando consenso.
- `CONFIRMADA`: todos os papéis preenchidos, com aceite do produtor e de cada profissional.

Uma equipe parcial também pode conter convites ativos para os papéis já preenchidos. `papeisPendentes` trata falta de profissional; `confirmado` trata a resposta do convite. Não são a mesma coisa.

`GET /projetos/:id/relatorio` retorna texto, inconsistências, compatibilidade de 0 a 1 e informações de contingência. A compatibilidade avalia a composição real, sem trocar integrantes por opções melhores do ranking.

`GET /projetos/:id/notificacoes` e `/auditoria` têm consistência eventual: a resposta de uma alteração pode chegar antes do processamento dos observadores. Normalmente a próxima rodada do worker começa em até 200 ms. A outbox sobrevive ao reinício do processo.

## Respostas de erro

| Código | Significado |
|---|---|
| 400 | Formato, campo, enumeração ou tipo inválido |
| 403 | `profissionalId` diferente do destinatário do convite; não substitui autenticação |
| 404 | Projeto, convite, arquivo ou transação inexistente |
| 409 | Convite cancelado/respondido em sentido contrário, conflito de unicidade ou pagamento de equipe não confirmada |
| 413 | Corpo maior que 256 KiB (36 MiB no envio de arquivos) ou arquivo acima de 25 MiB |
| 422 | Regra de domínio ou integridade violada |
| 502 | Provedor externo recusou a operação |
| 503 | Persistência, cadastro ou provedor externo indisponível, ou adaptador não configurado |
| 500 | Falha inesperada registrada no log, sem expor detalhes internos |

Um orçamento insuficiente não é, por si só, erro 422: retorna equipe parcial com explicação. Se o próprio banco da aplicação estiver indisponível, a API não promete persistir uma nova recomendação; a contingência do cadastro não substitui a persistência transacional.
