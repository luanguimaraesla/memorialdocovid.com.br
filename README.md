# Memorial do Covid

[memorialdocovid.com.br](https://memorialdocovid.com.br) é um memorial às pessoas que
morreram de Covid-19 no Brasil. Cada vida é um ponto. Os pontos descem a página em linhas de
dez, na ordem da série oficial, e um contador mostra quantas vidas já ficaram para trás e
quantos dias correspondem à notificação alcançada. O site está em pt-BR.

> Não esqueceremos o papel da família bolsonaro e a negligência negacionista que ampliou
> inúmeras vezes a magnitude dessa catástrofe no Brasil

## Dados

Os óbitos vêm do Painel Coronavírus do Ministério da Saúde, versão
`HIST_PAINEL_COVIDBR_05set2025.zip`: série nacional de 17/03/2020 a 05/09/2025, com
**716.626 óbitos**. A linha do tempo usa a data de notificação, não a data em que cada pessoa
morreu. Quando o painel revisa o acumulado para baixo, cada acumulado anterior recebe o menor
valor entre ele e os seguintes. Isso preserva o total oficial e desloca algumas posições
diárias. A página `/referencias` reúne essa metodologia, a cobertura e as fontes.

Os marcos trazem **57 episódios documentados**, de 17/03/2020 a 23/05/2025: **42 notícias
históricas e 15 episódios com citações**. A cronologia inclui pesquisas e autorizações de
vacinas, campanhas em outros países e no Brasil, falta de resposta às ofertas de doses,
crise do oxigênio, colapso hospitalar, variantes e encerramento das emergências. Notícias são
resumos editoriais, não citações literais. A seleção é ampla, não exaustiva.

As falas preservadas são de Jair Bolsonaro,
Eduardo Pazuello, Marcelo Queiroga, Jorginho Mello, Magno Malta, Flávio e Eduardo Bolsonaro,
Silas Malafaia e Valdemiro Santiago. Os cargos e partidos são os da época da fala.
Cada marco destaca a data e um subtítulo editorial antes da citação literal. Esse cabeçalho
continua visível ao rolar uma citação longa. Trechos do mesmo pronunciamento ficam juntos.
As fontes, o contexto, as checagens e os
esclarecimentos posteriores estão em `/referencias` e em `public/data/declaracoes.json`.
A seleção registra minimização da doença, oposição à prevenção e à vacinação, defesa de
tratamentos sem eficácia demonstrada e campanhas ligadas a supostas curas. Não atribui um
número de mortes a cada frase. `/referencias` também cita um estudo sobre as falas de
Bolsonaro e o distanciamento social, sem estender seus resultados às demais pessoas.

O contrato dos arquivos, a origem exata e o procedimento para regenerar os dados ficam em
[`public/data/README.md`](public/data/README.md).

## Arquitetura

O site é estático, feito com Astro, sem backend. No navegador, `src/lib/state.ts` carrega e
valida `public/data/obitos.json` e `public/data/declaracoes.json`. Se algo faltar ou não
passar na validação, a página mostra um erro e não desenha nada.

`src/lib/layout.ts` concentra a geometria: cada ponto tem raio fixo de 12 px, com 2 px de
espaço, em linhas de 10 (`src/config.ts`). A coluna centralizada tem 258 px de largura,
deixando 31 px de margem em cada lado numa tela de 320 px, sem mudar o tamanho dos pontos
entre telas. As linhas alternam branco e cinza claro, mantendo suas cores durante a rolagem.
A cada 1.000 vidas, um separador mostra o total acumulado em destaque e ocupa o espaço de
três linhas (78 px). Esse espaço não representa vidas: as contagens de vidas e dias permanecem
estáveis até a próxima linha de pontos. Com os 716 separadores, a coluna tem 1.919.086 px de
altura, abaixo do limite de 16.000.000 px dos navegadores. `src/lib/render.ts` desenha só os pontos
visíveis e marca as semanas às segundas-feiras, a partir de 30/03/2020. Cada marco fica na
posição do primeiro óbito da semana; semanas sem novos óbitos não recebem marco. Os óbitos
anteriores continuam na coluna. Um marco por vez flutua sobre a coluna. Quando vários
caem na mesma linha, Anterior e Próximo permitem ler cada um; os links abrem a entrada
escolhida. A navegação não altera a contagem de vidas. No celular, o contador vira uma barra inferior
com espaço para a área segura e acompanha o meio do viewport visível. O tempo aparece
somente em dias, desde 17/03/2020 (dia 1), pela data de notificação da última vida alcançada.
As datas completas continuam nos marcos e nas referências.

`src/lib/referencias.ts` carrega a cobertura, as fontes e o contexto das declarações em
`/referencias`, sem depender do canvas ou do contador.

O canvas é decorativo e fica oculto para leitores de tela. O contador tem uma região
`aria-live` educada, atualizada no máximo a cada 2 segundos. Os controles funcionam pelo
teclado, e a rolagem automática só começa por ação explícita. Os marcadores semanais usam
fundo amarelo/dourado, texto escuro e negrito.

A rolagem automática segue o rolador do umpixel: começa apenas pelo botão "Começar a
rolagem" ou pelo controle de reprodução, com velocidades de 1×, 2× e 3×. A base é 1.920 px por
segundo, quatro vezes a velocidade original; 2× e 3× correspondem a 3.840 e 5.760 px/s.
O motor em `src/lib/autoscroll.ts` pausa ao rolar com mouse, deslizar a tela, usar
teclas de navegação ou arrastar a barra de rolagem, e para no fim da página. Compartilhar
também pausa a reprodução. O controle fica junto ao contador, na lateral no computador e
na barra inferior no celular.

## Compartilhamento

O contador compartilha o memorial; cada marco tem seu próprio botão. O navegador abre
o compartilhamento nativo quando disponível. Caso contrário, copia a mensagem e o link;
se a cópia estiver bloqueada, mostra um diálogo com o texto selecionável. O aviso de cópia
some após três segundos e renova o prazo a cada confirmação.

Os links dos marcos usam `/marcos/<id>/#declaracao-<id>` e abrem a coluna na linha daquela
declaração, sem iniciar a rolagem. Cada rota é gerada como HTML estático, com metadados Open
Graph próprios. Só o fragmento `#` não permite uma prévia diferente para o WhatsApp.
A descrição preserva a frase fornecida:
“Nunca esqueceremos nossas perdas, nem os responsáveis! Você se lembra lembra? <título do card>”.

As imagens em `public/previas/` mostram a data, o título editorial, a pessoa ou instituição
e o texto completo. Notícias são identificadas como marcos históricos. Cada imagem é em PNG de 1200×630, sem fotografias externas. As prévias são arquivos estáticos:
não dependem de backend ou de JavaScript para o aplicativo ler os metadados.
Para gerar novamente após mudar um marco ou a paleta, use um Chrome/Chromium já instalado:

```sh
# No macOS, usa o Chrome instalado no caminho padrão.
node scripts/gerar-previas.mjs
# Em outro sistema ou com Chromium:
CHROME_PATH=/caminho/do/chromium node scripts/gerar-previas.mjs
npm run build
node --test tests/share-delivery.mjs
```

O gerador usa apenas módulos nativos do Node e não acessa sites externos. O manifesto e os
checks detectam imagens desatualizadas, alteradas ou com dimensões incorretas.
As prévias no WhatsApp exigem que o site e os PNGs estejam publicados em HTTPS; a validação
local verifica os arquivos e os metadados, não o cache ou a apresentação do aplicativo.

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
