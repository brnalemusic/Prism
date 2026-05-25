# Arquitetura de Processos e Segurança

O Prism é construído sobre uma arquitetura de múltiplos processos que isola de forma estrita o ambiente de renderização visual (interface do usuário) das operações do sistema e acesso à rede (motor de execução). Esse modelo garante segurança, estabilidade e isolamento contra injeções ou comportamentos não autorizados.

## 1. Separação de Responsabilidades (Main vs. Renderer)

O aplicativo funciona dividindo as tarefas em duas camadas principais:

### Processo Principal (Main Process)

- Atua como o núcleo operacional do Prism, rodando diretamente sobre o sistema operacional.
- Gerencia o ciclo de vida do aplicativo, janelas de visualização, atalhos globais de teclado, e o ícone de bandeja do sistema.
- Executa todas as chamadas diretas de rede para a API de inteligência artificial e serviços de busca.
- Implementa a lógica das ferramentas do sistema (terminal, sistema de arquivos, scanner de aplicações e janelas de visualização web em segundo plano).
- Criptografa e descriptografa chaves de API usando o armazenamento seguro nativo do sistema operacional.

### Processo de Renderização (Renderer Process)

- Executa a interface visual em ambientes HTML, CSS e Javascript isolados.
- Não possui acesso direto aos recursos do sistema operacional ou variáveis de ambiente.
- Solicita ações do sistema operacional e exibe dados exclusivamente por meio de mensagens trocadas com o processo principal.

## 2. Ponte de Contexto e Comunicação IPC

Toda a interação entre o visual do aplicativo e o sistema operacional é mediada por uma ponte de contexto protegida. Essa ponte expõe uma API de comunicação bidirecional estritamente controlada que envia e recebe eventos específicos de forma assíncrona:

- **Eventos de Conversa:** Fluxo de texto gerado em tempo real, estados de pensamento e sinalizações de erros ou interrupções de geração.
- **Eventos de Ação:** Disparo de ferramentas, logs de progresso e retornos de execuções (outputs).
- **Configurações do Usuário:** Troca de atalhos personalizados, preferências de interface e validação de chaves.

## 3. Segurança e Criptografia da Chave de API

O Prism protege as chaves de API configuradas pelo usuário para que elas nunca fiquem expostas em texto plano nos arquivos de configuração do sistema:

- O processo principal intercepta a chave de API fornecida na interface e a submete à API de criptografia do sistema operacional hospedeiro.
- O resultado é salvo como uma cadeia de bytes em formato hexadecimal dentro de um arquivo de configuração local.
- Quando o aplicativo é reiniciado, a chave é recuperada pelo processo principal, descriptografada em tempo de execução e mantida apenas na memória volátil do processo seguro.
- A chave de API nunca é exposta para o processo de renderização ou gravada em texto plano no disco.

## 4. Tipologia de Janelas

A interface é distribuída em diferentes janelas especializadas, cada uma com seus próprios limites visuais e comportamentos:

- **Janela Principal:** Foco na experiência completa e persistência de dados.
- **Janela do Lançador Rápido:** Janela transparente, posicionada acima de todas as outras, sem bordas ou exibição na barra de tarefas, com fechamento automático ao perder o foco (blur).
- **Janela do Canal de Agentes:** Interface flutuante simulando um dispositivo de comunicação móvel, projetada para exibir as mensagens trocadas no chat de grupo entre os agentes em tempo real.
- **Janela de Configurações de Subagentes:** Painel exclusivo para definição das configurações da inteligência artificial dos subagentes.
- **Janelas de Mini Aplicativos:** Instâncias isoladas criadas sob demanda para renderizar ferramentas e painéis interativos gerados sob medida.

## 5. Ciclo de Atualizações Automáticas

O Prism monitora continuamente repositórios públicos em busca de novas versões distribuídas. Ao detectar uma nova versão estável, o sistema exibe notificações interativas que permitem ao usuário aceitar o download em segundo plano e, posteriormente, acionar o reinício e a instalação automática do pacote atualizado.
