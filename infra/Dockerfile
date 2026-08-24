# Imagem customizada do n8n desta automação.
#
# Cópia versionada do que está em ~/n8n-custom/Dockerfile na VM (spec.md 7.5). O arquivo
# que vale é o da VM — este aqui existe pra ter histórico da mudança e pra conferência.
#
# Por que uma pasta isolada em vez de instalar junto do n8n: o package.json do n8n usa o
# formato `catalog:` do pnpm, incompatível com npm comum. Instalar ali quebra a imagem.
#
# As duas bibliotecas, cada uma pelo que a outra não faz:
#   exceljs — Cost Report (.xlsx). É a única que expõe a COR de preenchimento da célula,
#             que é o que separa AREP de REUNION (spec.md seção 6).
#   xlsx    — planilhas de Contratos (.xlsb). O exceljs não lê .xlsb, e falha CALADO:
#             abre o arquivo e devolve zero abas, o que faria a automação tratar todo
#             mundo como "sem contrato". Verificado nos 3 arquivos reais.
#
# Depois de mudar aqui, as duas coisas precisam andar juntas:
#   1. rebuild da imagem
#   2. NODE_FUNCTION_ALLOW_EXTERNAL no `docker run` listando as duas: exceljs,xlsx
# Sem o passo 2, o require('xlsx') é bloqueado pelo n8n mesmo com a lib instalada.

FROM n8nio/n8n:latest
USER root
RUN mkdir -p /usr/local/lib/node_modules_extra
WORKDIR /usr/local/lib/node_modules_extra
RUN npm init -y
RUN npm install exceljs xlsx
USER node
