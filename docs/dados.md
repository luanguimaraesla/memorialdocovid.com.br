# Dados

A página carrega dois arquivos de `public/data/`, servidos em `/data/<arquivo>.json`:
`obitos.json` e `declaracoes.json`. `src/lib/state.ts` valida os dois no carregamento. Se
algum arquivo faltar ou não passar na validação, a página mostra o aviso de erro, não desenha
pontos e deixa os controles desabilitados. Nenhum valor é corrigido ou inventado no navegador.

## `obitos.json`

Série nacional diária de óbitos acumulados por Covid-19, do Painel Coronavírus do Ministério
da Saúde.

- `fontes[].{nome,url}`: o painel e o arquivo exato da versão usada.
- `acessado_em`: data do download, no formato `AAAA-MM-DD`.
- `criterio`: sempre `"data de notificação"`.
- `dias[].{data,acumulado}`: datas `AAAA-MM-DD` em ordem estritamente crescente e acumulados
  inteiros, não negativos e não decrescentes. O último acumulado é o total oficial.

O arquivo não tem a marca `sintetico`. Dados sintéticos de óbitos são rejeitados.

### Origem

- Painel: <https://covid.saude.gov.br/>
- Versão: `HIST_PAINEL_COVIDBR_05set2025.zip`, a mais recente publicada pelo painel no
  acesso de 08/10/2026:
  <https://mobileapps-prd.saude.gov.br/esus-vepi/files/unAFkcaNDeXajurGB7LChj8SgQYS2ptm/60598ca6c2629df8753074196f6bc72b_HIST_PAINEL_COVIDBR_05set2025.zip>
- O link da versão vem do campo `arquivo.url` da API do painel
  (`https://qd28tcd6b5.execute-api.sa-east-1.amazonaws.com/prod/PortalGeral`, com o cabeçalho
  `X-Parse-Application-Id` usado pelo próprio site).
- O ZIP traz 12 CSVs, de `HIST_PAINEL_COVIDBR_2020_Parte1` a `2025_Parte2`, separados por
  ponto e vírgula.

### Cobertura

Só entram as linhas com `regiao` igual a `Brasil`; linhas de estados e municípios são
ignoradas. A série vai da primeira data com óbito acumulado positivo, **17/03/2020**, até a
última data do painel, **05/09/2025**: 1.999 dias, sem lacunas. O total oficial nessa data é
**716.626 óbitos**.

### Data de notificação

O painel conta óbitos pela data em que foram notificados, não pela data em que cada pessoa
morreu. As posições na linha do tempo seguem essa data.

### Revisões para baixo

O total acumulado do painel cai em três dias da série (12/11/2022, 02/09/2023 e
04/01/2025), quando registros foram revistos. Para manter um ponto por vida, cada acumulado
recebe o menor valor entre ele e todos os acumulados seguintes:

```
acumulado[d] = min(acumulado[d..fim])
```

Isso preserva o total oficial mais recente, mas desloca algumas posições diárias no
histórico. Os acumulados diários deste arquivo, portanto, não são os totais diários oficiais
intactos, nem datas individuais de óbito. A página explica isso ao lado da linha do tempo.

### Como regenerar

```sh
mkdir -p /tmp/painel && cd /tmp/painel
curl -sS -o painel.zip '<arquivo.url da versão mais recente>'
unzip -o painel.zip
cd -
node scripts/obitos-painel.mjs \
  --arquivo-url '<arquivo.url da versão mais recente>' \
  --versao '<nome do ZIP sem o prefixo de hash>' \
  --acessado-em AAAA-MM-DD \
  --saida public/data/obitos.json \
  /tmp/painel/HIST_PAINEL_COVIDBR_*.csv
```

Os arquivos brutos ficam fora do repositório. O conversor usa só módulos nativos do Node e
falha, sem escrever nada, se faltar uma coluna obrigatória (`regiao`, `data`,
`obitosAcumulado`), se uma linha nacional tiver data ou contagem inválida, se a mesma data
nacional aparecer com contagens diferentes ou se o total final não for positivo.

Ao trocar de versão, confira a cobertura e o total direto nos CSVs brutos e atualize as
expectativas de `tests/delivery.mjs` com esses valores, não com os do JSON convertido.

## `declaracoes.json`

Marcadores da linha do tempo com citações, notícias históricas e suas fontes.
O nome do arquivo é preservado para manter os links e o contrato de carregamento.

- `sintetico`: `false` para citações reais; `true` apenas para exemplos claramente rotulados.
- `aviso`: texto obrigatório quando `sintetico` é `true`.
- `declaracoes[].{id,data,texto,fontes,acessado_em}`: `id` único, `data` dentro da cobertura
  de `obitos.json`, `fontes[].{nome,url}` e data de acesso por entrada.
- `declaracoes[].tipo`: `noticia` para um resumo editorial ou `declaracao` para uma citação.
  Ausência do campo preserva o comportamento das citações anteriores. Outros valores são rejeitados.
- `declaracoes[].subtitulo` e `autor`: obrigatórios para entradas reais. `contexto` é
  obrigatório nas citações; nas notícias, aparece quando há uma ressalva a registrar.
  Nas notícias, `autor` identifica a instituição ou o lugar relacionado, não a autoria de uma fala.
  O subtítulo é um resumo editorial do episódio, não uma citação literal. No marco, a data
  fica em destaque, seguida do subtítulo e do autor; a citação aparece abaixo. O contexto
  completo fica em `/referencias` junto das fontes.

O arquivo reúne 107 marcos de 17/03/2020 a 05/05/2023: 92 notícias históricas e os 15 episódios
com citações já documentados. Notícias usam parágrafos, nunca elementos de citação; fontes e
qualificações ficam em `/referencias`. As fontes anteriores de notícias mantêm o acesso de
10/10/2026; as notícias do acervo, de 09/10/2026.
A seleção se concentra no Brasil: vacinação, compras, crises assistenciais, transparência e
CPI. Foram retirados 18 marcos de pesquisas, campanhas e variantes internacionais. Não é
exaustiva. Preserva os sete
marcos de Jair Bolsonaro e acrescenta falas de Eduardo Pazuello, Marcelo Queiroga, Jorginho
Mello, Magno Malta, Flávio e Eduardo Bolsonaro, Silas Malafaia e Valdemiro Santiago.
Os episódios com citações identificam as fontes do trecho, do contexto e de eventuais
contrapontos, acessadas em 09/10/2026. Citações de um mesmo pronunciamento ficam no mesmo
marco. Marcos na mesma linha de pontos aparecem um de cada vez; os links selecionam a entrada
exata, mesmo quando as datas coincidem. As quebras de parágrafo separam trechos diferentes.

O contexto registra os cargos e partidos da época: Jorginho Mello era senador pelo PL-SC;
Magno Malta era ex-senador pelo PL-ES; Eduardo Bolsonaro era deputado pelo PSL-SP; e Flávio
Bolsonaro era senador pelo Patriota-RJ na sessão citada. A proximidade dos líderes religiosos
com Bolsonaro também tem fontes. O registro não generaliza sua atuação às pessoas evangélicas.
Mudanças posteriores relevantes ficam explícitas, como a suspensão dos cultos de Malafaia,
a vacinação de Flávio e as explicações de Pazuello e da assessoria de Mello.

`data` é a data da declaração ou do acontecimento, não necessariamente a da reportagem.
Para notícias, pode indicar a classificação de uma variante, a divulgação de um estudo ou
uma decisão. A data anterior de surgimento ou coleta de amostra fica no contexto, quando relevante. A resposta ‘E daí?’
ocorreu em 28/04/2020 e foi registrada pela Câmara no dia 29. A fala do ‘jacaré’ ocorreu em
17/12/2020 e foi publicada pelo SBT no dia 18. A live de Eduardo Bolsonaro foi em 10/03/2021,
noticiada no dia 11. O vídeo de Magno Malta é de 01/02/2022, anterior à checagem. O contexto
explicita essas diferenças.

A seleção registra as falas e seu contexto; não calcula óbitos atribuíveis a uma citação.
A posição de um marco acompanha a série de notificações, não representa uma relação causal.
O estudo sobre discursos e distanciamento social citado em `/referencias` analisa Bolsonaro
e mede comportamento, não mortes por frase nem os efeitos individuais dos demais autores. A leitura das fontes é uma revisão editorial; a validação automática
confere o formato, as datas e as URLs, mas não comprova sozinha a autenticidade de uma fala.

### Acervo

`acervo` no nível do arquivo registra a cobertura: 79 acontecimentos e 55 capturas. As capturas
em `public/acervo-covid/` são os arquivos originais, sem edição.

`declaracoes[].acervo` traz a manchete, o veículo, o link da reportagem, a data de publicação
e, quando existe, a fonte primária, além das capturas associadas. Cada captura registra caminho
local, legenda, largura, altura e hash SHA-256. O carregador rejeita caminhos fora do acervo,
dimensões inválidas, datas impossíveis e URLs inseguras.

Onze acontecimentos do acervo correspondem a marcos que já estavam no memorial e se juntam a
eles. Os outros 68 têm IDs `acervo-cov-NNNN` e `tipo: noticia`, mesmo quando resumem uma fala;
os resumos nunca são apresentados como citações literais. Quando o nome de um arquivo diverge
da data visível na captura, vale a data da captura.

Os cards mostram recortes das manchetes e subtítulos; o clique abre a captura completa.
Os originais e seus hashes não mudam. O modo guiado para em cada marco até o visitante
continuar. No modo contínuo, só o cabeçalho flutua. Os detalhes ficam em Leia mais.
Cada card fica na linha de pontos da sua data, sem espaços extras. O percurso leva
exatamente 1,6 s entre marcos; a velocidade varia porque a distância entre eles acompanha
as vidas perdidas no intervalo.

Para adicionar uma citação, confira o trecho literal e a data na fonte, registre autor,
subtítulo e contexto e não misture comentários editoriais com palavras entre aspas.
O subtítulo deve resumir o episódio sem transformar uma hipótese, proposta ou relato em um
fato comprovado. URLs `.invalid`
são rejeitadas quando `sintetico` é `false`. Exemplos sintéticos continuam exigindo o prefixo
`[Exemplo sintético` e nunca são apresentados como falas reais.
