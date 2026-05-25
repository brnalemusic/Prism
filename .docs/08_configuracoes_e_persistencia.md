# Configurações do Sistema e Persistência de Histórico

O Prism mantém suas configurações e arquivos de conversação armazenados de forma estruturada no disco rígido do usuário. Os arquivos residem no diretório de dados local do sistema operacional hospedeiro, sob a pasta dedicada do aplicativo.

## 1. Arquivo de Preferências do Sistema

As preferências de uso do Prism são salvas em um arquivo formatado em notação de dados padrão localizado no diretório de dados local do usuário (pasta de dados locais de aplicativos, subpasta do Prism). O arquivo contém as seguintes propriedades ajustáveis:

- **Atalho do Lançador (launcherShortcut):** Combinação de teclas globais que aciona o painel flutuante (padrão: Ctrl+Space ou Cmd+Space).
- **Atalho de Seleção de Modelo (modelSelectionShortcut):** Atalho para alternar motores rapidamente dentro do lançador flutuante (padrão: Ctrl+M ou Cmd+M).
- **Inteligência Padrão (defaultModel):** ID do modelo carregado na inicialização do chat principal (padrão: Prism 5).
- **Inteligência de Enxame (subagentModel):** ID do modelo encarregado de rodar as instruções dos subtrabalhadores (padrão: Prism 4.2).
- **Minimizar para a Bandeja (minimizeToTray):** Parâmetro booleano. Se ativado, fechar a janela principal não encerra o aplicativo; em vez disso, oculta-o na área de ícones da bandeja do sistema (System Tray).
- **Iniciar com o Login (autoLaunch):** Indica se o aplicativo deve ser adicionado ao registro de inicialização nativo do sistema operacional para carregar automaticamente após o logon.
- **Modo do Lançador Rápido (quickLauncherMode):** Opção entre modo simplificado (conversas rápidas na área de trabalho) ou avançado (foco direto no chat principal).
- **Chave de API do Usuário (userGeminiKey):** Cadeia hexadecimal que representa a chave de API segura criptografada pela proteção nativa da máquina.

## 2. Persistência de Sessões de Chat

O histórico de diálogos é gravado em arquivos individuais organizados em uma subpasta específica de histórico (pasta de conversas/chats):

- Cada arquivo de chat é salvo sob a nomenclatura de identificação única da sessão correspondente.
- A estrutura de dados interna armazena o identificador da sessão (ID), o título resumido da conversa, o registro de data e hora da última alteração (timestamp) e a lista ordenada de mensagens trocadas.
- O Prism salva as mensagens sequencialmente a cada interação humana ou robótica, garantindo que o progresso não seja perdido em caso de encerramentos inesperados.

## 3. Mecanismo de Busca na Memória de Conversas

O aplicativo permite que a inteligência artificial acione a ferramenta de busca de histórico para resgatar preferências antigas, decisões passadas ou contextos específicos do usuário em chats anteriores:

- A consulta fornecida pela inteligência é dividida em palavras-chave independentes.
- O Prism varre recursivamente todos os arquivos de chat em disco.
- O sistema calcula uma pontuação baseada na frequência de ocorrência dos termos de busca nas mensagens de cada arquivo, descartando textos internos do sistema.
- Para cada correspondência encontrada, o Prism reconstrói o par de diálogo (a pergunta do usuário e a resposta da IA relacionada) e insere uma tag descritiva indicando o título do chat e a data da interação.
- Os dez melhores contextos pontuados são mesclados e enviados como resposta para a inteligência, permitindo uma contextualização contínua através do tempo.
