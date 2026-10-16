# Memorial do Covid

[memorialdocovid.com.br](https://memorialdocovid.com.br) é um memorial às pessoas que
morreram de Covid-19 no Brasil. Cada vida é um ponto. Os pontos descem a página em linhas de
dez, na ordem da série oficial, e um contador mostra quantas vidas já ficaram para trás e
quantos dias correspondem à notificação alcançada. O site está em pt-BR.

> Não esqueceremos o papel da família Bolsonaro e a negligência negacionista que ampliou
> inúmeras vezes a magnitude dessa catástrofe no Brasil

## Dados

Os óbitos vêm do Painel Coronavírus do Ministério da Saúde, versão
`HIST_PAINEL_COVIDBR_05set2025.zip`: série nacional de 17/03/2020 a 05/09/2025, com
**716.626 óbitos**. A linha do tempo usa a data de notificação, não a data em que cada pessoa
morreu. Quando o painel revisa o acumulado para baixo, cada acumulado anterior recebe o menor
valor entre ele e os seguintes. Isso preserva o total oficial e desloca algumas posições
diárias. A página `/referencias` reúne essa metodologia, a cobertura e as fontes.

Os marcos trazem **106 episódios documentados**, de 17/03/2020 a 05/05/2023: **92 notícias
históricas e 14 episódios com citações**. O foco é a resposta brasileira à pandemia:
prevenção, vacinação, compras de doses, crise do oxigênio, colapso hospitalar e CPI.
As campanhas país a país e boa parte dos marcos internacionais saíram da seleção.
O encerramento da emergência da OMS permanece como contexto. Notícias são resumos editoriais,
não citações literais. A seleção é ampla, não exaustiva.

Os **79 acontecimentos e as 55 capturas** do acervo estão integrados. Onze episódios já
existentes receberam as capturas e as fontes do acervo, sem duplicar suas entradas nem alterar
as citações. As manchetes aparecem diretamente nos cards; o contexto e as fontes ficam em
**Leia mais** e em `/referencias`. As capturas ficam em `public/acervo-covid/`, sem
alterações. A data do fato continua separada da publicação.

O site publica só informações públicas do acervo: manchete, veículo, links, data de
publicação e capturas. A planilha de trabalho é interna, com observações de edição e status
de checagem, e não entra no repositório nem em `public/`. O contexto exibido nas notícias é
escrito para o público em `PUBLIC_CONTEXT`, no importador.

As falas preservadas são de Jair Bolsonaro,
Eduardo Pazuello, Marcelo Queiroga, Jorginho Mello, Magno Malta, Flávio e Eduardo Bolsonaro
e Valdemiro Santiago. Os cargos e partidos são os da época da fala.
Cada marco destaca a data e um subtítulo editorial antes da citação literal. Esse cabeçalho
continua visível ao rolar uma citação longa. Trechos do mesmo pronunciamento ficam juntos.
As fontes, o contexto, as checagens e os
esclarecimentos posteriores estão em `/referencias` e em `public/data/declaracoes.json`.
A seleção registra minimização da doença, oposição à prevenção e à vacinação, defesa de
tratamentos sem eficácia demonstrada e campanhas ligadas a supostas curas. Não atribui um
número de mortes a cada frase. `/referencias` também cita um estudo sobre as falas de
Bolsonaro e o distanciamento social, sem estender seus resultados às demais pessoas.

O contrato dos arquivos, a origem exata e o procedimento para regenerar os dados ficam em
[`docs/dados.md`](docs/dados.md).

## Arquitetura

O site é estático, feito com Astro, sem backend. No navegador, `src/lib/state.ts` carrega e
valida `public/data/obitos.json` e `public/data/declaracoes.json`. Se algo faltar ou não
passar na validação, a página mostra um erro e não desenha nada.

`src/lib/layout.ts` concentra a geometria: cada ponto tem raio fixo de 12 px, com 2 px de
espaço, em linhas de 10 (`src/config.ts`). A coluna centralizada tem 258 px de largura,
deixando 31 px de margem em cada lado numa tela de 320 px, sem mudar o tamanho dos pontos
entre telas. As linhas alternam branco e cinza claro, mantendo suas cores durante a rolagem.
A cada 1.000 vidas, um separador ocupa três linhas (78 px), sem acrescentar vidas.
A coluna mede 1.919.086 px, abaixo do limite de 16.000.000 px dos navegadores, sem
espaços extras: cada card fica na linha de pontos da sua data. Os pontos fazem parte da
página: cada bloco de mil vidas é um elemento pintado por um padrão CSS de círculos. Assim o
navegador rola pontos, datas, contadores e notícias na mesma camada, sem que um se atrase em
relação ao outro no celular. Os marcos semanais continuam nas segundas-feiras a partir de
30/03/2020, na posição do primeiro óbito da semana.

A linha onde cada marco para fica fixa, a 90 px do topo. Ela não depende da altura da tela,
que muda no celular quando a barra de endereço aparece ou some; essa mudança também não
refaz a disposição da coluna, que só é recalculada quando a largura muda.

A barra inferior mostra duas informações separadas: vidas perdidas e tempo de pandemia.
Os dias são contados desde 17/03/2020 (dia 1), pela data de notificação da última vida
alcançada no meio do viewport. Os pontos ficam ocultos para leitores de tela; o contador
tem anúncios educados, limitados a uma atualização a cada dois segundos.
As fontes e o contexto completos continuam disponíveis em `/referencias`.

A abertura apresenta o percurso. Depois de um trecho sem notícias, o primeiro marco
explica a dimensão da tragédia e o significado de cada ponto. O segundo trata de memória
e responsabilidade. Só depois começam as notícias em ordem cronológica.

No modo guiado, os cards ficam em posições fixas no documento e sobem com a página.
A rolagem para em cada marco e espera pelo botão **Continuar**, sem prazo de leitura.
Gestos manuais e cliques também pausam. Não há scroll interno: a imagem aparece diretamente
ou, quando ela não existe, aparece a descrição. Contexto, resumo e fontes ficam em **Leia mais**.
Quando dois cards cairiam um sobre o outro, só o marco atual aparece; marcos na mesma
linha de pontos trocam no lugar ao tocar em **Continuar**. Embaixo de cada notícia, um
marcador no estilo dos separadores mostra quantas vidas a coluna já contou naquele ponto, ao
menos uma linha de pontos abaixo do card e alinhado às linhas. Como nos separadores, o número
conta os pontos acima dele, então os números sempre crescem de cima para baixo. Se um separador de milhar estiver
a até 160 px desse marcador, o marcador ocupa o espaço reservado ao separador, que é omitido;
assim nenhum espaço de separador fica vazio. As datas semanais que ficariam atrás de um card
ou do seu marcador também são omitidas, assim como as que ficariam a menos de quatro linhas
da data anterior, comuns nas semanas com poucas mortes.

O percurso termina no encerramento, depois da coluna: o total oficial de vidas perdidas, a
mensagem "Nunca esqueceremos. Essa família não pode voltar ao poder! A ignorância não pode
vencer." e um botão para compartilhar o memorial. Ali a barra de controles some.

A barra flutuante divide a largura entre **Continuar**, **Compartilhar** e **Sem pausas**.
Compartilhar envia o marco atual ou, antes do primeiro marco, o memorial. Cada notícia também
tem um botão pequeno de compartilhar ao lado da data, inclusive no cabeçalho flutuante.

O botão **Sem pausas** ativa o modo contínuo. Nesse modo, apenas o cabeçalho da notícia
flutua até o próximo marco. **Leia mais** volta ao card fixo, abre o conteúdo e pausa
para leitura. O visitante pode alternar entre os dois modos a qualquer momento.

Cada marco chega exatamente 1,6 s depois do anterior (`SECONDS_BETWEEN_MILESTONES`),
incluindo a abertura, as duas introduções e o encerramento. A distância entre publicações é a da coluna:
as vidas perdidas entre as duas datas. Por isso a velocidade é calculada trecho a trecho:
distância dividida por 1,6 s. No modo guiado, cada trecho acelera em 0,24 s, segue na
velocidade máxima e freia em 0,24 s até parar no marco, sem se arrastar até o lugar.
No modo contínuo, a velocidade em cada marco é a média harmônica dos trechos vizinhos, o que
mantém a rolagem sempre para a frente e sem ultrapassar marcos. `src/lib/journey.ts` faz
esses cálculos.

Nas 106 publicações, a distância vai de 0 px (7 trechos na mesma linha de pontos) a
121.420 px, com mediana de 7.748 px. A velocidade média vai de 0 a 75.888 px/s, com
mediana de 4.843 px/s. O trecho mais longo, de 23/03/2021 a 08/04/2021, atravessa cerca
de 47 mil vidas e chega a 89.279 px/s. Como os trechos seguem a série, 51 deles são mais
curtos que o anterior: a velocidade sobe nos períodos com mais mortes, não de forma constante.
Para reproduzir a tabela completa, com distância, velocidade e aceleração por trecho:

```sh
npm run medir:percurso
```

Os recortes em `src/lib/headline-crops.ts` priorizam manchetes e subtítulos, sem menus,
anúncios ou fotografias intermediárias. O limite de altura redimensiona a prévia sem
cortar seu texto. Os cards imitam recortes de jornal: papel com granulação, corte de
tesoura irregular, linha de data e a captura impressa em tons de cinza sobre o papel. As capturas completas permanecem intactas e acessíveis pelo clique
na imagem; a página de referências mostra os originais.

A música, “Pandemia” (14 min 48 s, em `public/musica/pandemia.mp3`), começa com o gesto de
iniciar o percurso, nunca antes.
O botão circular no alto silencia ou restaura o som sem reiniciar nem pausar a faixa.
Pausar a rolagem não pausa a música. Sem JavaScript, os controles nativos permanecem
disponíveis; falhas mostram uma mensagem de recuperação e um link para o áudio original.

Para importar novamente, coloque a planilha em `acervo-interno/timeline-covid.xlsx`, pasta
ignorada pelo Git, ou passe outro caminho. O importador usa só a biblioteca padrão do Python 3:

```sh
python3 scripts/importar-acervo.py [caminho/da/planilha.xlsx]
node scripts/gerar-previas.mjs
npm run build
node --test tests/delivery.mjs tests/acervo-delivery.mjs tests/share-delivery.mjs
```

O importador relaciona todas as capturas aos acontecimentos e falha se sobrar algum arquivo.
Os testes de entrega conferem cobertura, dimensões, hashes e publicação dos originais, e
falham se a planilha ou algum campo interno chegar ao site.

## Compartilhamento

O botão Compartilhar, ao lado de Continuar, envia o marco atual: uma das mensagens de
abertura ou a notícia em destaque. Antes do primeiro marco, envia o memorial. O ícone ao lado
da data de cada notícia envia aquela notícia. O navegador abre
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

## Publicação

O site é publicado no GitHub Pages pelo workflow `.github/workflows/deploy.yml`, a cada push
na `main` ou manualmente pela aba Actions. Antes de publicar `dist/`, o workflow roda os testes,
a verificação de tipos, o build e o gate de entrega; se algo falhar, nada é publicado.

Configuração única no repositório e no domínio:

1. Em Settings → Pages, a fonte é **GitHub Actions** e o domínio personalizado é
   `memorialdocovid.com.br`. Com publicação por Actions, um arquivo `CNAME` não é necessário.
2. No DNS, o domínio aponta para o GitHub Pages com registros A `185.199.108.153`,
   `185.199.109.153`, `185.199.110.153` e `185.199.111.153`, registros AAAA
   `2606:50c0:8000::153` a `2606:50c0:8003::153` e `www` como CNAME para
   `luanguimaraesla.github.io`.
3. Depois que o GitHub emitir o certificado, ative **Enforce HTTPS** em Settings → Pages.

## Licença

O código usa [AGPL-3.0](LICENSE). Você pode usar, estudar, modificar e redistribuir, inclusive
em serviços de rede, desde que mantenha a mesma licença e disponibilize o código-fonte.
As capturas de notícias e a música têm direitos próprios; a licença do código não os substitui.
