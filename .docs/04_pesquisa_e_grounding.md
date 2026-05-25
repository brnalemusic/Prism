# Protocolos de Pesquisa e Grounding Web

O Prism dispõe de ferramentas nativas para busca e extração de informações da web em tempo real. A aplicação não depende de APIs pagas de busca externa; em vez disso, implementa rotinas resilientes de raspagem, navegação virtual em segundo plano e protocolos de pesquisa profunda para garantir respostas fundamentadas e atualizadas.

## 1. Protocolo de Pesquisa Ativa (Active Search)

Este protocolo é acionado automaticamente em conversas comuns sempre que o usuário solicita informações sobre tópicos atuais, fatos científicos, desenvolvimento de código moderno, notícias ou qualquer assunto que exija fundamentação empírica externa:

- A inteligência detecta a necessidade de fatos externos e aciona a ferramenta de busca web.
- Ela lê o resultado das consultas e navega de forma autônoma pelas páginas mais promissoras.
- O modelo só avança no raciocínio se extrair dados confiáveis das páginas lidas.
- Caso o conteúdo não seja localizado após tentativas repetidas, o sistema encerra a geração informando as limitações e exibindo apenas os dados parciais encontrados, prevenindo alucinações.

## 2. Protocolo de Pesquisa Profunda (Deep Research)

Quando a opção de Busca Estendida é ativada na interface pelo usuário, o Prism assume uma postura de investigação sistemática e exaustiva estruturada em cinco fases bem delimitadas:

- **Fase 1. Compreensão do Escopo:** O assistente decompõe a solicitação do usuário em tópicos primários e secundários de busca.
- **Fase 2. Contextualização Inicial:** Realiza uma ou duas buscas rápidas para capturar palavras-chave alternativas, sinônimos, termos técnicos e fontes relevantes.
- **Fase 3. Plano de Pesquisa e Parada de Confirmação:** O assistente elabora um resumo do contexto inicial encontrado, descreve um plano de investigação detalhado (quais termos serão buscados, quais fontes serão priorizadas e que tipo de dados serão coletados) e solicita a aprovação explícita do usuário. Neste ponto, **a geração de IA é interrompida imediatamente** e o aplicativo aguarda a resposta humana.
- **Fase 4. Investigação Exhaustiva:** Após a aprovação do usuário (ex: "prosseguir", "iniciar"), o assistente inicia a fase de pesquisa massiva. Ele executa um ciclo de no mínimo 10 iterações sequenciais de buscas e leituras de páginas web. Este processo cruza dados de múltiplas fontes de forma lenta e detalhada. Cada etapa do progresso é detalhada e registrada na linha de pensamentos do assistente.
- **Fase 5. Síntese Estruturada:** Os resultados coletados são refinados, classificados e consolidados em relatórios informativos de alta densidade no chat.

## 3. Funcionamento da Busca Web (Mecanismo DuckDuckGo Scraper)

Para realizar pesquisas na internet, o Prism simula conexões a mecanismos de busca públicos por meio de cabeçalhos de navegador realistas:

- A consulta é enviada para a versão HTML simples do DuckDuckGo para contornar proteções complexas contra robôs de navegação baseados em Javascript.
- O código de resposta é analisado por expressões regulares projetadas para isolar blocos de resultados de forma independente, resistindo a pequenas mudanças na estrutura da página.
- O Prism limpa os links de redirecionamento internos do mecanismo para obter a URL de destino direta da fonte.
- Retorna o título, a URL limpa e o trecho de texto descritivo (snippet) dos cinco primeiros resultados relevantes.

## 4. Funcionamento do Leitor de Links (Web Reader com Navegador Offscreen)

Quando o assistente precisa ler o conteúdo textual completo de uma página web específica, ele utiliza uma estratégia de duas camadas:

- **Camada 1 (Requisição Direta):** Tenta realizar uma requisição HTTP convencional utilizando cabeçalhos de identificação de navegador comum para obter o HTML. Se obtiver sucesso, remove tags de formatação, scripts de rastreamento e blocos de estilos, filtrando apenas o texto limpo com limitação de caracteres para evitar estouro de memória da inteligência.
- **Camada 2 (Navegador Invisível / Offscreen Fallback):** Caso a requisição direta seja bloqueada por sistemas de proteção contra automação (como Cloudflare) ou resulte em erro de carregamento, o aplicativo cria uma instância invisível de um navegador integrado em segundo plano (offscreen window). Esse navegador carrega a URL por completo, processa o Javascript da página original e extrai dinamicamente a propriedade de texto visual exibida no corpo do documento (innerText). O conteúdo textual purificado é retornado ao fluxo da inteligência.

## 5. Comando Especial de Vídeo (/youtube)

A interface do Lançador Rápido e a Janela Principal oferecem suporte ao comando de barra `/youtube`. Quando inserido no início de uma mensagem, este atalho força a inteligência artificial a traduzir a intenção do usuário em uma busca web direcionada para vídeos ou álbuns musicais. Após localizar o melhor link direto, o assistente invoca imediatamente a ferramenta do sistema que abre a URL de vídeo diretamente no navegador padrão do usuário.
