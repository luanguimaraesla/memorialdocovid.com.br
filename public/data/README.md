# Dados

A página carrega dois arquivos desta pasta, servidos em `/data/<arquivo>.json`:
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

Marcadores da linha do tempo com declarações e suas fontes.

- `sintetico`: `true` enquanto o arquivo tiver só exemplos.
- `aviso`: texto obrigatório quando `sintetico` é `true`.
- `declaracoes[].{id,data,texto,fontes,acessado_em}`: `id` único, `data` dentro da cobertura
  de `obitos.json`, `fontes[].{nome,url}` e data de acesso por entrada.

**Hoje o arquivo é sintético.** As cinco entradas são textos de exemplo que começam com
`[Exemplo sintético` e não reproduzem nem parafraseiam nenhuma fala real. As URLs
`https://example.invalid/...` só preenchem o formato. A página mostra o aviso
"Declarações sintéticas de exemplo", marca cada marcador como exemplo sintético e não
transforma essas URLs em links.

Para publicar declarações verificadas, troque `sintetico` para `false`, remova o prefixo de
exemplo e informe a fala exata, a data e uma fonte verificável para cada entrada. Com
`sintetico: false`, URLs `.invalid` são rejeitadas.
