# Imagem customizada do n8n desta automação.
#
# Cópia versionada do que está em ~/n8n-custom/Dockerfile na VM (spec 7.6, em
# docs/spec/01-arquitetura-infra.md). O arquivo que vale é o da VM. Este aqui existe para ter
# o histórico da mudança e para conferência: os comandos abaixo são idênticos aos da VM
# (conferido em 28/10/2026).
#
# Por que uma pasta isolada em vez de instalar junto do n8n: o package.json do n8n usa o
# formato `catalog:` do pnpm, incompatível com npm comum. Instalar ali quebra a imagem.
#
# As três bibliotecas, cada uma pelo que as outras não fazem:
#   exceljs — LEITURA do Cost Report (.xlsx). É a única que expõe a COR de preenchimento da
#             célula, que é o que separa AREP de REUNION (spec seção 6). Nunca usar para
#             GRAVAR: o writeBuffer reconstrói o pacote e destrói a formatação condicional.
#   xlsx    — planilhas de Contratos (.xlsb). O exceljs não lê .xlsb, e falha CALADO:
#             abre o arquivo e devolve zero abas, o que faria a automação tratar todo
#             mundo como "sem contrato". Verificado nos 3 arquivos reais.
#   jszip   — ESCRITA cirúrgica no Cost (scripts/lib/xlsx_cirurgico.js): abre o .xlsx como
#             ZIP e reescreve só o XML da aba-alvo. Necessária porque `fs` e `zlib` são
#             bloqueados no Code node.
#
# Depois de mudar aqui, as duas coisas precisam andar juntas:
#   1. rebuild da imagem
#   2. NODE_FUNCTION_ALLOW_EXTERNAL no `docker run` listando as três: exceljs,xlsx,jszip
#      (valor atual na VM, conferido em 28/10/2026)
# Sem o passo 2, o require() é bloqueado pelo n8n mesmo com a lib instalada.

FROM n8nio/n8n:latest
USER root
RUN mkdir -p /usr/local/lib/node_modules_extra
WORKDIR /usr/local/lib/node_modules_extra
RUN npm init -y
RUN npm install exceljs xlsx jszip
USER node
