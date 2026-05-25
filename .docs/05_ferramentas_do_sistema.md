# Ferramentas do Sistema e Integração Local

O Prism opera como uma extensão direta do sistema do usuário, oferecendo capacidades de interação em baixo nível com o sistema operacional. Para isso, dispõe de ferramentas dedicadas que cobrem terminal, sistema de arquivos e gerenciamento de aplicativos instalados.

## 1. Ferramenta de Terminal

A execução de instruções de terminal permite rodar scripts, compilar projetos, configurar dependências e consultar informações de rede de forma autônoma:

- **Execução Adaptativa:** Em ambientes Windows, o Prism ajusta a página de códigos do terminal para UTF-8 de forma implícita antes de rodar o comando principal. Isso garante a exibição correta de caracteres especiais e acentos nos logs de retorno.
- **Proteção contra Sobrecarga:** Caso um comando gere logs extremamente extensos (loops infinitos, dumps de memória), o sistema interrompe a captura do fluxo de saída ao atingir 50.000 caracteres, truncando a mensagem enviada à inteligência artificial para proteger o renderizador contra travamentos.
- **Cancelamento em Tempo Real:** Se o usuário clicar no botão de parada na interface enquanto um comando demorado estiver em execução, o Prism envia um sinal de interrupção para encerrar o subprocesso do sistema operacional.

## 2. Conjunto de Manipulação do Sistema de Arquivos

O Prism implementa um conjunto abrangente de ferramentas de manipulação de arquivos e pastas no disco:

- **Criação de Arquivos:** Grava novos arquivos contendo texto. O sistema cria automaticamente pastas intermediárias se necessário, mas falha se o arquivo já existir no local especificado, evitando sobreposições acidentais de projetos.
- **Edição Direcionada (Substituição de Texto):** Permite alterar trechos específicos de arquivos maiores. A ferramenta localiza a correspondência exata de um bloco de texto antigo e o substitui por um novo texto. A alteração falha se o bloco antigo não for localizado, evitando modificações incorretas ou desordenadas.
- **Gravação Direta (Salvar/Sobrescrever):** Grava ou substitui integralmente o conteúdo de um arquivo em disco, criando diretórios pais automaticamente.
- **Anexação de Dados:** Insere textos no final de arquivos existentes sem alterar o conteúdo original.
- **Movimentação e Cópia:** Suporta realocação de arquivos e estruturas de pastas complexas com flags opcionais para sobrescrever destinos conflitantes.
- **Leitura de Metadados:** Retorna dados descritivos detalhados de um caminho específico, como tamanho em bytes, tipo (arquivo, pasta ou link), datas de criação, modificação e permissões de acesso.
- **Listagem e Leitura de Conteúdo:** Recupera a árvore de arquivos de diretórios ou lê o conteúdo de texto de arquivos específicos.

### Salvaguardas de Segurança no Disco

Todas as ferramentas que interagem com caminhos de arquivos executam validações rigorosas antes de tocar no disco físico:

- **Bloqueio de Placeholders:** O sistema rejeita caminhos que contenham palavras genéricas como substitutos temporários, forçando o assistente a trabalhar apenas com caminhos explícitos e reais.
- **Bloqueio de Diretório Raiz:** O Prism recusa sumariamente a execução de operações destrutivas ou de escrita que tenham como alvo as pastas raiz dos discos (como caminhos principais do sistema), prevenindo danos acidentais à instalação do sistema operacional.

## 3. Scanner e Gerenciador de Aplicações

O Prism possui a habilidade de consultar os softwares instalados na máquina do usuário e abri-los diretamente:

- **Varredura Híbrida do Registro:** O scanner mapeia as chaves de desinstalação registradas no sistema operacional (cobrindo chaves locais do usuário corrente e de máquina inteira em estruturas de 32 e 64 bits).
- **Varredura Física de Caminhos Comuns:** Varre diretórios padrão como arquivos de programas, caminhos locais de aplicações e pastas de atalhos do Menu Iniciar.
- **Resolução de Atalhos e Executáveis:** Resolve arquivos de atalho para identificar os caminhos reais dos programas executáveis correspondentes.
- **Heurística Anti-Desinstaladores:** Filtra os executáveis encontrados para ignorar utilitários de suporte, instaladores, reportadores de travamentos ou desinstaladores automáticos, priorizando apenas a aplicação útil principal.
- **Cache Otimizado:** Os resultados da varredura de programas são salvos em cache na interface do usuário. O sistema monitora o tempo decorrido e atualiza esta lista em segundo plano a cada 5 minutos.
- **Abertura Segura:** A abertura de aplicações é acionada passando o caminho resolvido do executável para as funções nativas de abertura de programas do sistema operacional.
