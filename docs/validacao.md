# Validação da ATVII

Execução em 17/10/2026, Windows, Node 24.14.0 e PostgreSQL 18.6 local.

| Verificação | Resultado |
|---|---|
| npm run typecheck | Sem erros com TypeScript estrito |
| npm run test:coverage | 93 testes aprovados, nenhum ignorado |
| Linhas e instruções | 97,74% |
| Ramificações | 97,98% |
| Funções | 97,10% |
| npm run db:migrate | Nova migração aplicada sobre o banco anterior |
| npm run db:seed | 27 profissionais fictícios |
| npm run demo | Recomendação, recusa, substituição e confirmação por HTTP |
| npm run demo:familias | Três famílias, relatórios, notificações, clones e rejeição de renderização inviável |
| npm run evaluate | Métrica sintética das três estratégias originais recalculada |
| npm run test:load | 300 requisições HTTP, sem erros |

Os 93 testes incluem os 77 da ATVI, nove testes de domínio sobre fábricas e sete de integração das famílias. Os testes de integração usam PostgreSQL real em schemas isolados. Há casos de clonagem sem referências compartilhadas, preservação de subtipo, mistura inválida de famílias, extensão com quarta família, migração reversível, rollback, reavaliação parcial e reentrega idempotente de eventos após reinício.

O escopo de cobertura inclui todos os arquivos src/**/*.ts. server.ts aparece com 0% porque a inicialização real foi exercitada separadamente pelas demonstrações HTTP. Cobertura mede execução, não comprova ausência de defeitos. Dados brutos: [testes.txt](testes.txt) e [cobertura.json](cobertura.json).

## Revalidação em 18/10/2026

Tipagem, os 93 testes e as duas demonstrações HTTP foram executados novamente com sucesso. Nenhum teste foi ignorado ou cancelado na execução final. O PostgreSQL estava desligado no início; após iniciar o serviço e aguardar sua disponibilidade, a integração passou. Não foi necessária alteração no código da aplicação. Os dados de carga abaixo são da execução de 17/10/2026.

## Carga

Cadastro de 10 mil profissionais no PostgreSQL. Cada estratégia recebe 100 requisições simultâneas de criação por HTTP TCP. O cliente roda em outro processo Node e o worker de eventos permanece ativo. O catálogo e o cálculo começam frios em cada rodada. Os títulos variam, mas os critérios de recomendação são iguais dentro de cada rodada, permitindo uso do cache. O logger HTTP fica desabilitado nesta medição.

| Estratégia | p50 | p95 | Máximo | Erros |
|---|---:|---:|---:|---:|
| Cosseno | 925 ms | 993 ms | 994 ms | 0 |
| Colaborativa | 907 ms | 966 ms | 967 ms | 0 |
| Orçamento | 484 ms | 556 ms | 558 ms | 0 |

O cliente valida resposta 201, seis membros diferentes, orçamento e ausência de degradação. O script falha se houver resposta inválida ou tempo máximo de dois segundos ou mais. Registro: [carga.json](carga.json). Esse teste reproduz o cenário da ATVI; não mede 100 combinações inéditas de critérios nem garante o mesmo desempenho em outra máquina.

## Limites

A avaliação de precision@3 usa uma fixture pequena com rótulos sintéticos: 1,00 para cosseno, 0,67 para colaborativa e 0,00 para orçamento. Não representa qualidade em produção; os rótulos favorecem adequação técnica, não menor preço. Veja [avaliacao.json](avaliacao.json).

A execução foi verificada em Windows; não foi executada em Ubuntu. Os scripts usam APIs Node e caminhos portáveis. E-mail é persistido localmente, sem provedor SMTP. Autenticação e reserva global da agenda dos profissionais não estão implementadas. As métricas de renderização são estimativas a partir dos dados fornecidos.
