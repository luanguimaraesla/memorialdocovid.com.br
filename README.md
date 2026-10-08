# Memorial do Covid

[memorialdocovid.com.br](https://memorialdocovid.com.br) é um memorial às pessoas que
morreram de Covid-19 no Brasil. Cada vida é um ponto. Os pontos descem a página em linhas de
dez, na ordem da série oficial, e um contador mostra quantas vidas já ficaram para trás e em
que data. O site está em pt-BR.

> Não esqueceremos o papel da família bolsonaro e a negligência negacionista que ampliou
> inúmeras vezes a magnitude dessa catástrofe no Brasil

## Dados

Os óbitos vêm do Painel Coronavírus do Ministério da Saúde, versão
`HIST_PAINEL_COVIDBR_05set2025.zip`: série nacional de 17/03/2020 a 05/09/2025, com
**716.626 óbitos**. A linha do tempo usa a data de notificação, não a data em que cada pessoa
morreu. Quando o painel revisa o acumulado para baixo, cada acumulado anterior recebe o menor
valor entre ele e os seguintes. Isso preserva o total oficial e desloca algumas posições
diárias. A página explica as duas coisas ao lado da coluna.

As declarações na linha do tempo ainda são **exemplos sintéticos**, marcados como tal na
página e nos dados, sem fonte real. Nenhuma fala foi inventada ou atribuída a alguém. Elas
serão trocadas por citações verificadas, com fonte.

O contrato dos arquivos, a origem exata e o procedimento para regenerar os dados ficam em
[`public/data/README.md`](public/data/README.md).

## Arquitetura

O site é estático, feito com Astro, sem backend. No navegador, `src/lib/state.ts` carrega e
valida `public/data/obitos.json` e `public/data/declaracoes.json`. Se algo faltar ou não
passar na validação, a página mostra um erro e não desenha nada.

`src/lib/layout.ts` concentra a geometria: cada ponto tem raio fixo de 3 px, com 2 px de
espaço, em linhas de 10 (`src/config.ts`). A coluna completa tem 573.304 px de altura, abaixo
do limite de 16.000.000 px dos navegadores. `src/lib/render.ts` desenha num canvas fixo só os
pontos visíveis, marca o primeiro dia com óbitos de cada mês e posiciona as declarações na
linha da data delas.

O canvas é decorativo e fica oculto para leitores de tela. O contador tem uma região
`aria-live` educada, atualizada no máximo a cada 2 segundos. Os botões "Ir ao início" e
"Ir ao fim" funcionam pelo teclado, e a rolagem suave é desligada quando o sistema pede menos
movimento.

## Como rodar

Precisa de Node 22.20+, 24.12+ ou 25+ e npm 10+, como declarado em `engines` no `package.json`.
Versões mais antigas ficam fora do que as dependências travadas no `package-lock.json` aceitam.
Os testes e o build foram rodados no Node 26.10 com npm 11.19.

```sh
make install                    # instala as dependências
make dev                        # servidor de desenvolvimento
make build                      # gera o site estático em dist/
make preview                    # serve o build de produção
make check                      # verificação de tipos (astro check)
npm test                        # testes offline: geometria, conversor, validação e página
node --test tests/delivery.mjs  # gate de entrega dos dados publicados
```

Rode `make` sem argumentos para ver todos os alvos.

`make check` só verifica tipos. O projeto ainda não tem linter nem verificação de formatação,
e adicionar um exige uma nova dependência de desenvolvimento.

`npm test` usa só dados de teste embutidos. `tests/delivery.mjs` é obrigatório antes de
qualquer entrega: confere os arquivos de `public/data/` contra a cobertura e o total checados
nos CSVs oficiais. Se os dados oficiais não puderem ser obtidos ou validados, a entrega fica
bloqueada. Não existe fonte alternativa nem série sintética de óbitos.

## Licença

[AGPL-3.0](LICENSE). Você pode usar, estudar, modificar e redistribuir, inclusive em serviços
de rede, desde que mantenha a mesma licença e disponibilize o código-fonte.
