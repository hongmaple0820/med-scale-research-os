# Data Sources Reference

## Authoritative Databases for Target Intelligence

### Expression & Tissue

| Database | URL | API | Auth | Key Data |
|----------|-----|-----|------|----------|
| GTEx v10 | gtexportal.org | REST API v2 | No | 54 tissues, median TPM, eQTL |
| HPA | proteinatlas.org | REST API | No | Protein expression, IHC, subcellular |
| TCGA | portal.gdc.cancer.gov | GDC API | No | Tumor expression, clinical, survival |
| GEO | ncbi.nlm.nih.gov/geo | REST API | No | Published expression datasets |
| CELLxGENE | cellxgene.cziscience.com | REST API | No | 61M+ single cells |

### Target-Disease Association

| Database | URL | API | Auth | Key Data |
|----------|-----|-----|------|----------|
| Open Targets | platform.opentargets.org | GraphQL | No | Association scores, genetics evidence |
| Pharos | pharos.nih.gov | REST API | No | Tclin/Tchem/Tbio/Tdark classification |
| canSAR | cansar.black | REST API | No | Druggability scores |

### Drug & Clinical

| Database | URL | API | Auth | Key Data |
|----------|-----|-----|------|----------|
| ChEMBL | ebi.ac.uk/chembl | REST API | No | Bioactivity, drug mechanisms |
| ClinicalTrials.gov | clinicaltrials.gov | API v2 | No | Trial status, phases, results |
| DrugBank | go.drugbank.com | REST API | Yes | Drug-target interactions |
| PubChem | pubchem.ncbi.nlm.nih.gov | REST API | No | Chemical structures, bioassays |

### Literature

| Database | URL | API | Auth | Key Data |
|----------|-----|-----|------|----------|
| PubMed | ncbi.nlm.nih.gov/pubmed | E-utilities | No | Abstracts, MeSH terms |
| bioRxiv | biorxiv.org | API | No | Preprints |
| OpenAlex | openalex.org | REST API | No | Citation network |

### Interactions & Pathways

| Database | URL | API | Auth | Key Data |
|----------|-----|-----|------|----------|
| STRING | string-db.org | REST API | No | PPI confidence scores |
| KEGG | kegg.jp | REST API | No | Pathways, drug-target |
| Reactome | reactome.org | REST API | No | Pathway analysis |

### Immune & Microenvironment

| Database | URL | API | Auth | Key Data |
|----------|-----|-----|------|----------|
| TIMER 2.0 | timer.cistrome.org | Web API | No | Immune infiltration estimates |
| CIBERSORT | cibersortx.stanford.edu | Web API | Yes | Immune deconvolution |

### Patents

| Database | URL | API | Auth | Key Data |
|----------|-----|-----|------|----------|
| USPTO PEDS | developer.uspto.gov | REST API | No | US patent applications |
| Google Patents | patents.google.com | Web | No | Global patent search |

## Cross-Validation Strategy

For each data claim, we verify against at least 2 independent sources:

| Claim Type | Primary Source | Validation Source |
|-----------|---------------|-------------------|
| Tissue expression | GTEx (RNA) | HPA (protein) |
| Tumor expression | TCGA | GEO datasets |
| Target-disease link | Open Targets | Literature (PubMed) |
| Druggability | Pharos | ChEMBL bioactivity |
| Clinical status | ClinicalTrials.gov | ChEMBL drug phase |
| Immune correlation | TIMER 2.0 | TCGA deconvolution |
