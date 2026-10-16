#!/usr/bin/env python3
"""Importa a planilha do acervo e relaciona as capturas sem alterar os originais.

A planilha é interna: fica fora de public/ e do controle de versão. Do acervo, só
manchete, veículo, links, data de publicação e capturas chegam ao site.
"""

import hashlib
import json
import struct
import sys
from datetime import datetime, timedelta
from pathlib import Path
from xml.etree import ElementTree
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
ARCHIVE = PUBLIC / "acervo-covid"
SPREADSHEET = ROOT / "acervo-interno/timeline-covid.xlsx"
DATA = PUBLIC / "data/declaracoes.json"
NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}

MERGES = {
    "COV-0002": "pronunciamento-2020-03-24",
    "COV-0004": "e-dai-2020-04-28",
    "COV-0025": "coronavac-2020-10-21",
    "COV-0027": "maricas-2020-11-10",
    "COV-0032": "vacina-jacare-2020-12-17",
    "COV-0043": "mimimi-2021-03-04",
    "COV-0046": "pfizer-primeiro-contrato-2021-03-19",
    "COV-0051": "pfizer-primeiro-lote-2021-04-29",
    "COV-0053": "pfizer-cpi-2021-05-13",
    "COV-0057": "meio-milhao-2021-06-19",
    "COV-0067": "cpi-relatorio-2021-10-26",
}

INTERNATIONAL = {
    "oxford-ensaio-humano-2020-04-23", "pfizer-resultados-2020-11-09",
    "moderna-resultados-2020-11-16", "moscou-vacinacao-2020-12-05",
    "reino-unido-vacinacao-2020-12-08", "estados-unidos-vacinacao-2020-12-14",
    "canada-vacinacao-2020-12-14", "alpha-beta-2020-12-18",
    "mexico-chile-vacinacao-2020-12-24", "uniao-europeia-vacinacao-2020-12-27",
    "oms-primeira-vacina-2020-12-31", "india-vacinacao-2021-01-16",
    "covax-ghana-entrega-2021-02-24", "ghana-costa-marfim-vacinacao-2021-03-01",
    "delta-preocupacao-2021-05-11", "omicron-2021-11-26",
    "jn1-2023-12-19", "nb181-2025-05-23",
}

# Células com dia e mês invertidos, corrigidas pela data visível na captura.
DATE_CORRECTIONS = {
    "COV-0005": {"B": "2020-05-07", "C": "2020-05-07"},
    "COV-0006": {"C": "2020-05-09"},
    "COV-0012": {"B": "2020-06-11", "C": "2020-06-11"},
}

# Contexto público de cada notícia importada. As observações da planilha são notas de
# edição e nunca são publicadas; eventos sem ressalva pública ficam sem contexto.
PUBLIC_CONTEXT = {
    "COV-0001": "A fala se refere ao próprio presidente.",
    "COV-0005": "O registro é do anúncio do churrasco, não de sua realização.",
    "COV-0006": "Coluna Radar, que reúne fatos relatados e comentários de opinião do autor.",
    "COV-0007": "Teich pediu demissão; seu antecessor, Luiz Henrique Mandetta, havia sido demitido pelo presidente.",
    "COV-0008": "A Gazeta do Povo também registrou a fala em reportagem de 20/05/2020.",
    "COV-0009": "O protocolo é de 20/05/2020. O recorde de 1.179 óbitos registrados e a fala sobre tubaína, citados na reportagem, são de 19/05/2020.",
    "COV-0010": "Os novos óbitos do balanço diário são registros daquele dia, não mortes que ocorreram todas nele.",
    "COV-0011": "As reações são de 06/06/2020, anteriores à decisão judicial sobre os dados.",
    "COV-0013": "Casos confirmados não são o total de infecções. As cifras são o balanço divulgado na época, não o total revisado depois.",
    "COV-0014": "A fala também pede uma reabertura com responsabilidade. O país já havia passado de 50 mil mortes, e os balanços de diferentes fontes divergiam.",
    "COV-0015": "A data é a da publicação no Diário Oficial da União. Os vetos não revogaram regras estaduais ou municipais. Segundo o Senado, o veto foi derrubado em 19/08/2020.",
    "COV-0016": "A melhora relatada pelo presidente não comprova a eficácia do medicamento. A reportagem descreve hidroxicloroquina, embora a manchete fale em cloroquina.",
    "COV-0017": "A data é a da publicação no Diário Oficial da União. A justificativa citada para os vetos foi a falta de demonstração do impacto orçamentário e financeiro; os vetos ainda seriam examinados pelo Congresso.",
    "COV-0018": "Os óbitos do balanço são registros daquele dia, não mortes que ocorreram todas nele.",
    "COV-0019": "A fala inclui um lamento pelas mortes e ocorreu antes de o balanço oficial passar de 100 mil.",
    "COV-0020": "Cifras do balanço do Ministério da Saúde na época, distintas de estimativas e de revisões posteriores. A data do registro não é a data em que as mortes ocorreram.",
    "COV-0021": "A reportagem ressalta que não há comprovação de eficácia. A recuperação individual do presidente não demonstra benefício do tratamento.",
    "COV-0022": "Segundo a reportagem, o presidente reconheceu que não havia comprovação científica. A afirmação é política, não uma conclusão científica.",
    "COV-0023": "A fala trata da obrigatoriedade da vacinação, não da suspensão da compra de vacinas.",
    "COV-0024": "A data é a da exibição do discurso, não a da gravação. A manchete destaca o meio ambiente, mas o texto também cobre a pandemia. As afirmações são do presidente.",
    "COV-0026": "É a opinião do presidente naquele momento, não uma descrição da competência dos tribunais.",
    "COV-0028": "Os novos registros não são mortes que ocorreram todas no dia. A taxa de transmissão é uma estimativa daquele relatório, e outros balanços podem trazer números diferentes.",
    "COV-0030": "As falas de março de 2020 sobre a ‘gripezinha’ também estão neste memorial.",
    "COV-0031": "Declaração de dezembro, distinta da transmissão de 26/11/2020.",
    "COV-0033": "A data é a da exibição, segundo a reportagem. São afirmações do presidente, não uma avaliação epidemiológica.",
    "COV-0034": "A fonte registra a piada de Bolsonaro e a apresentação do projeto por Cherini; não mostra o presidente defendendo o tratamento.",
    "COV-0035": "A reportagem reproduz o texto publicado no Facebook.",
    "COV-0036": "São óbitos acumulados registrados, não mortes ocorridas somente nesse dia.",
    "COV-0037": "O capítulo sobre o Brasil está na página 58 do relatório.",
    "COV-0038": "A reportagem traz uma retrospectiva dos fatos e o vídeo de uma transmissão com o ministro da Saúde da época.",
    "COV-0039": "O registro regulatório não significou chegada imediata de doses.",
    "COV-0040": "A transmissão ocorreu no mesmo dia em que o país registrou o recorde de mortes em 24 horas até então.",
    "COV-0041": "No mesmo dia, Jair Bolsonaro fez uma transmissão questionando a eficácia das máscaras.",
    "COV-0044": "O registro não equivale à produção integralmente nacional do insumo, aprovada em 2022.",
    "COV-0045": "Queiroga foi o quarto ministro da Saúde durante a pandemia. Segundo a reportagem, Pazuello deu uma entrevista coletiva em tom de despedida e afirmou que Bolsonaro estava reorganizando a pasta.",
    "COV-0047": "Na época, o Brasil havia vacinado 5,5% da população. No mesmo mês, Bolsonaro pediu ao STF a derrubada de decretos com medidas de proteção em alguns estados. Na véspera da reportagem, mais de 500 economistas e empresários divulgaram um manifesto pedindo vacinação em massa e distanciamento social.",
    "COV-0048": "A criação ocorreu após o atraso na compra de vacinas, a falta de oxigênio no Amazonas, o uso de dinheiro público em medicamentos sem comprovação científica, como a hidroxicloroquina, e o aumento das mortes, que levaram a pressão para que o Senado investigasse possíveis desvios e mau uso de verbas da União.",
    "COV-0049": "Após a abertura, parlamentares governistas tentaram impedir a instalação. O senador Ciro Nogueira (PP-PI), aliado de Bolsonaro na época, pediu a Otto Alencar a suspensão da sessão. No mesmo dia, Renan Calheiros apresentou 11 requerimentos de convocação de depoentes.",
    "COV-0050": "Naquele momento, o Brasil havia ultrapassado o Reino Unido e era o 11º país com mais mortes por Covid-19 por milhão de habitantes.",
    "COV-0054": "É a posição do depoente, não uma conclusão independente sobre as negociações.",
    "COV-0055": "A denominação é a usada pela reportagem na época. A confirmação em tripulantes não comprova transmissão comunitária.",
    "COV-0056": "A autorização regulatória não define o calendário de aplicação.",
    "COV-0058": "São relatos e suspeitas apresentados à CPI, não condenações judiciais.",
    "COV-0059": "A suspensão foi uma medida preventiva e não prova, por si, a ocorrência de corrupção.",
    "COV-0060": "É uma alegação do depoente, contestada durante os trabalhos da CPI, não uma condenação.",
    "COV-0061": "A data consta no histórico oficial da Anvisa, uma cronologia atualizada sem data única de publicação.",
    "COV-0062": "A data é a do anúncio da política, não a do início das aplicações.",
    "COV-0063": "O discurso apresenta a posição política do presidente.",
    "COV-0064": "São denúncias relatadas em depoimento, não condenações judiciais. A operadora negou as acusações.",
    "COV-0065": "A marca é a do consórcio de veículos de imprensa, citada pela fonte. São óbitos acumulados registrados.",
    "COV-0066": "A associação divulgada é falsa. A transmissão é de 21/10/2021 e a reportagem, de 25/10/2021; a remoção posterior faz parte do mesmo episódio.",
    "COV-0068": "O anúncio da agência naquele dia era preliminar.",
    "COV-0069": "A reportagem documenta a indisponibilidade dos sistemas, não a perda definitiva de todos os dados.",
    "COV-0070": "As suspeitas são falas do presidente, que a reportagem caracteriza como infundadas. Não são evidência de irregularidade na agência.",
    "COV-0071": "O episódio é posterior ao de 06/01/2022. A reportagem informa que a Anvisa avaliou os benefícios da vacinação infantil como superiores aos riscos.",
    "COV-0072": "A reportagem contrapõe os riscos de sobrecarga hospitalar e a existência de mortes infantis.",
    "COV-0073": "São registros do balanço, não infecções e mortes ocorridas todas naquele dia.",
    "COV-0074": "Um ato posterior encerrou a emergência nacional, não a circulação do vírus nem a emergência internacional da OMS.",
    "COV-0075": "A data é a da exibição. A reportagem contesta a alegação sobre vacinação após a infecção e informa que os medicamentos não têm eficácia contra a Covid. O status vacinal é declarado pelo próprio presidente.",
    "COV-0076": "A fonte é a transcrição da entrevista. A posição do candidato não demonstra a eficácia dos medicamentos.",
    "COV-0077": "É o balanço político do presidente, não uma conclusão independente.",
    "COV-0078": "É a justificativa do presidente e não comprova que não houve atraso. As ofertas e os contratos de vacinas estão em outros marcos do memorial.",
    "COV-0079": "O UOL classificou as duas alegações sobre vacinas como falsas, citando ofertas de 2020 e a importância da vacinação mesmo após a infecção.",
}

EXTRA_SOURCES = {
    "COV-0037": {
        "nome": "Human Rights Watch — World Report 2021 (Brasil, p. 58)",
        "url": "https://www.hrw.org/sites/default/files/media_2021/01/2021_hrw_world_report.pdf",
    },
    "COV-0042": {
        "nome": "Fiocruz — Boletim do Observatório Covid-19: retrospectiva 2021",
        "url": "https://fiocruz.br/documento/2021/12/boletim-do-observatorio-covid-19-retrospectiva-2021",
    },
    "COV-0077": {
        "nome": "UOL Confere — checagem do discurso de Bolsonaro na ONU",
        "url": "https://noticias.uol.com.br/confere/ultimas-noticias/2022/09/20/bolsonaro-mentiras-onu-assembleia-geral-2022.htm",
    },
}

TITLES = {
    "COV-0035": "Bolsonaro anuncia suspensão da compra de seringas",
    "COV-0037": "Human Rights Watch critica a resposta de Bolsonaro à pandemia",
    "COV-0038": "Bolsonaro diz que o governo fez sua parte durante o colapso no Amazonas",
    "COV-0040": "Bolsonaro desestimula máscaras para crianças em live",
    "COV-0041": "Consórcio de imprensa registra 1.582 mortes em 24 horas",
    "COV-0042": "Fiocruz alerta para a pior ocupação de UTIs desde o início da pandemia",
    "COV-0045": "Bolsonaro escolhe Queiroga para substituir Pazuello na Saúde",
    "COV-0047": "Bolsonaro compara as mortes no Brasil às do restante do mundo",
    "COV-0048": "Senado formaliza a criação da CPI da Covid",
    "COV-0049": "CPI da Covid é instalada no Senado",
    "COV-0050": "Brasil ultrapassa 400 mil mortes registradas",
}

CAPTURES = """
COV-0001 20032020_gripezinha
COV-0002 24032020_davialcolumbre
COV-0002 24032020_fhc
COV-0003 20042020_naosoucoveiro
COV-0004 28042020_edai_lamento
COV-0005 07052020_churrasco
COV-0006 09052020_jetski
COV-0007 15052020_demissao_teich
COV-0008 19052020_cloroquina_tubaiba
COV-0009 20052020_cloroquina
COV-0010 21052020_20mil_mortes
COV-0011 06062020_transparencia
COV-0012 11062020_fiscalizacao_hospitais
COV-0013 19062020_1milhao_casos
COV-0014 22062020_reabertura
COV-0015 03072020_veto_mascaras
COV-0016 07072020_bolsonaro_cloroquina
COV-0017 08072020_veto_indigenas
COV-0018 29072020_90mil_mortes
COV-0019 06082020_tocar_a_vida
COV-0020 08082020_100mil_mortes
COV-0021 13082020_cloroquina
COV-0022 24082020_cloroquina2
COV-0023 31082020_vacina
COV-0024 22092020_onu
COV-0025 21102020_coronavac
COV-0026 26102926_obrigatoriedade_vacina
COV-0027 10112020_maricas
COV-0028 24112020_170mil_mortes
COV-0029 26112020_nao_vou_tomar_vacina
COV-0030 27112020_negacao_gripezinha
COV-0031 15122020_nao_vou_tomar_vacina
COV-0032 18122020_jacare
COV-0034 06082020_ozonio
COV-0036 07012021_200mil_mortes
COV-0037 13012021_human_rights
COV-0038 15012021_colapso_amazonas
COV-0041 25022021_record_mortes
COV-0042 26022021_utis
COV-0043 04032021_frescura
COV-0045 15032021_queiroga
COV-0047 23032021_lamento
COV-0048 13042021_cpi
COV-0050 29042021_400mil_mortes
COV-0053 13052021_pfizer
COV-0057 19062021_500mil_mortes
COV-0060 01072021_propina
COV-0066 25102021_aids
COV-0070 06012022_vacina_crianca
COV-0071 10012022_vacina_filha
COV-0072 12012022_omicron
COV-0073 03022022_omicron
COV-0074 13032022_fim_pandemia
COV-0075 20062022_minimiza
COV-0076 22082022_jornal_nacional
"""


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def spreadsheet_rows(path):
    with ZipFile(path) as workbook:
        shared = ElementTree.fromstring(workbook.read("xl/sharedStrings.xml"))
        strings = ["".join(item.itertext()) for item in shared.findall("s:si", NS)]
        sheet = ElementTree.fromstring(workbook.read("xl/worksheets/sheet1.xml"))
        rows = []
        for row in sheet.findall(".//s:row", NS):
            cells = {}
            for cell in row.findall("s:c", NS):
                value = cell.find("s:v", NS)
                if value is None:
                    continue
                text = strings[int(value.text)] if cell.get("t") == "s" else value.text
                column = "".join(char for char in cell.get("r") if char.isalpha())
                cells[column] = text.strip()
            if cells.get("A", "").startswith("COV-"):
                rows.append(cells)
        return rows


def iso_date(value):
    if not value:
        return None
    if "/" in value:
        return datetime.strptime(value, "%d/%m/%Y").date().isoformat()
    return (datetime(1899, 12, 30) + timedelta(days=float(value))).date().isoformat()


def captures_by_event(rows):
    files = {path.stem: path for path in ARCHIVE.rglob("*.png")}
    captures = {}
    used = set()
    headlines = {row["A"]: row["G"] for row in rows}
    for line in CAPTURES.strip().splitlines():
        event_id, stem = line.split()
        path = files[stem]
        if path in used:
            raise ValueError(f"Captura repetida: {path}")
        used.add(path)
        width, height = struct.unpack(">II", path.read_bytes()[16:24])
        caption = headlines[event_id]
        if stem.endswith("_fhc"):
            caption = "Publicação de Fernando Henrique Cardoso em reação ao pronunciamento de 24/03/2020"
        if stem.endswith("_davialcolumbre"):
            caption = "Publicação de Davi Alcolumbre sobre a nota do Senado em 24/03/2020"
        captures.setdefault(event_id, []).append({
            "arquivo": path.relative_to(PUBLIC).as_posix(),
            "legenda": caption, "largura": width, "altura": height,
            "sha256": digest(path),
        })
    if used != set(files.values()):
        raise ValueError(f"Capturas sem evento: {set(files.values()) - used}")
    return captures


def import_archive(spreadsheet):
    rows = spreadsheet_rows(spreadsheet)
    if len(rows) != 79 or len({row["A"] for row in rows}) != 79:
        raise ValueError("Esperados os 79 IDs permanentes da planilha")
    captures = captures_by_event(rows)
    existing = json.loads(DATA.read_text())
    entries = [entry for entry in existing["declaracoes"]
               if entry["id"] not in INTERNATIONAL and not entry["id"].startswith("acervo-cov-")]
    by_id = {entry["id"]: entry for entry in entries}
    for row in rows:
        event_id = row["A"]
        dates = {column: iso_date(row.get(column)) for column in ["B", "C"]}
        dates.update(DATE_CORRECTIONS.get(event_id, {}))
        archive = {"manchete": row["G"], "veiculo": row["H"], "url": row["J"]}
        for key, value in {"publicado_em": dates["C"], "fonte_primaria": row.get("L")}.items():
            if value:
                archive[key] = value
        archive["documentos"] = captures.get(event_id, [])
        if event_id in MERGES:
            entry = by_id[MERGES[event_id]]
            if entry["data"] != dates["B"]:
                raise ValueError(f"Datas diferentes ao reunir {event_id}")
        else:
            entry = {
                "id": f"acervo-{event_id.lower()}", "tipo": "noticia", "data": dates["B"],
                "subtitulo": TITLES.get(event_id, row["E"]), "autor": row["H"], "texto": row["F"],
            }
            if event_id in PUBLIC_CONTEXT:
                entry["contexto"] = PUBLIC_CONTEXT[event_id]
            entry["fontes"] = [{"nome": row["H"] + " — " + row["G"], "url": row["J"]}]
            if event_id in EXTRA_SOURCES:
                entry["fontes"].append(EXTRA_SOURCES[event_id])
            entry["acessado_em"] = "2026-10-09"
            entries.append(entry)
        entry["acervo"] = archive
    entries.sort(key=lambda entry: entry["data"])
    result = {"sintetico": False, "acervo": {
        "eventos": len(rows), "documentos": sum(map(len, captures.values())),
    }, "declaracoes": entries}
    DATA.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(f"{len(entries)} marcos, {len(rows)} eventos do acervo, {result['acervo']['documentos']} capturas")


if __name__ == "__main__":
    import_archive(Path(sys.argv[1]) if len(sys.argv) > 1 else SPREADSHEET)
