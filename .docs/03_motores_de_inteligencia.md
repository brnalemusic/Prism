# Motores de Inteligência e Modelo de Redundância

O Prism gerencia a execução de inteligência artificial traduzindo chaves internas em chamadas de modelos específicos com diferentes perfis de capacidade, custos de processamento e níveis de raciocínio. A aplicação implementa um sistema inovador de tolerância a falhas (fallback dinâmico) e um modo de raciocínio profundo sob demanda.

## 1. Mapeamento de Modelos (Família Prism)

A aplicação abstrai os nomes reais dos motores de inteligência artificial por meio de uma taxonomia amigável:

- **Prism 5 (Motor: gemini-3.5-flash):** Recomendado como o modelo padrão para automações complexas, escrita rápida de código e raciocínio ágil geral.
- **Prism 4.3 (Motor: gemma-4-31b-it):** Focado em raciocínio analítico denso, planejamento meticuloso de tarefas em etapas e deduções lógicas complexas.
- **Prism 4.2 (Motor: gemma-4-26b-a4b-it):** Balanceado para automações de fluxos de trabalho locais no desktop com múltiplas ferramentas sequenciais.
- **Prism 4.1 (Motor: gemini-3-flash-preview):** Projetado para respostas de latência ultra-baixa em interações conversacionais cotidianas.
- **Prism 4 (Motor: gemini-3.1-flash-lite):** Motor leve para respostas rápidas e simples com baixo consumo de cota de chamadas.

## 2. Mecanismo de Redundância Automática (Fallback)

Durante a execução de tarefas complexas que demandam múltiplas chamadas consecutivas de ferramentas, falhas de rede ou estouros de cota da API podem interromper o processo de geração. O Prism soluciona este problema de forma automática:

- Se uma chamada à API retornar um erro técnico durante o fluxo principal da conversa, o sistema intercepta o erro.
- Em vez de repassar a falha diretamente ao usuário, o Prism identifica a posição do modelo atual na escala de redundância (da maior capacidade para a menor).
- O sistema altera dinamicamente a configuração da sessão de chat para o próximo motor disponível e injeta uma mensagem interna do sistema.
- Esta instrução de contingência ordena que o novo modelo analise o histórico completo de mensagens e continue a execução exatamente do ponto onde o modelo anterior falhou.
- O usuário é informado visualmente e sutilmente sobre a troca automática de motor, mantendo a continuidade do fluxo sem necessidade de reinício manual.

## 3. Modo de Raciocínio (Think Mode)

O usuário pode alternar a capacidade de raciocínio profundo de qualquer modelo a qualquer momento:

- **Nível Mínimo de Pensamento:** Executado por padrão em conversas cotidianas para garantir que as respostas sejam geradas de forma rápida e direta.
- **Nível Elevado de Pensamento:** Ativado pelo usuário (atalho global) ou imposto em tarefas críticas de planejamento. Sob esta configuração, a inteligência é instruída a gerar uma seção explícita contendo o fluxo de ideias e inferências antes de emitir a resposta final ou as chamadas de ferramentas.
- **Processamento de Pensamento na Interface:** O fluxo de pensamento gerado é encapsulado e enviado em tempo real ao visual do aplicativo. O renderizador oculta os pensamentos do texto de resposta final e os insere em painéis expansíveis específicos. O título desse painel atualiza-se dinamicamente com base nas linhas destacadas em negrito geradas pelo próprio modelo durante seu processo reflexivo.

## 4. Parâmetros de Temperatura Operacional

Para otimizar o comportamento dos motores de acordo com o objetivo da interação, o Prism calibra a temperatura da inteligência artificial em duas faixas distintas:

- **Geração Conversacional e Execução de Ferramentas (Temperatura 0.7):** Um equilíbrio que assegura criatividade comedida e conformidade estrita com o formato técnico esperado pelas ferramentas.
- **Geração de Títulos de Sessão (Temperatura 1.4):** Aplicada de forma isolada ao motor de sumarização para produzir títulos curtos (de até 5 palavras), criativos e representativos para o histórico. Este processo de titulação detecta automaticamente a linguagem usada pelo usuário e gera o título exatamente no mesmo idioma.
