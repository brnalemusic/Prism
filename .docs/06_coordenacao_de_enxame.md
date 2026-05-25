# Coordenação de Enxame Multilaterais (Subagentes)

Para tarefas complexas que exigem divisão de trabalho e processamento paralelo, o Prism implementa um sistema de orquestração de enxame de agentes (Swarm Coordinator). Esse mecanismo permite que múltiplos agentes virtuais colaborem de forma assíncrona, compartilhando uma memória comum e cooperando sob a liderança de um coordenador dedicado.

## 1. Topologia do Enxame

Ao acionar a ferramenta de agentes, o Prism estabelece uma hierarquia de comunicação com papéis definidos:

### Agente Coordenador (Master Coordinator)

- Atua como a mente analítica central do enxame. Sua função principal não é executar ferramentas locais de terminal ou arquivos, mas sim orientar o trabalho dos agentes de campo.
- Monitora continuamente as mensagens trocadas no canal de comunicação do grupo.
- Distribui metas específicas para cada trabalhador, avalia os resultados entregues e compila o relatório estratégico final.
- Controla a terminação do enxame, encerrando o grupo quando a meta global é atingida ou considerada impossível.

### Agentes Trabalhadores (Worker Subagents)

- Recebem tarefas específicas e focadas do coordenador.
- Têm acesso completo às ferramentas locais do sistema (arquivos, buscas, terminal) para executar suas tarefas.
- Relatam obrigatoriamente seus planejamentos de curto prazo, progressos parciais, resultados e impasses no canal compartilhado.
- Solicitam permissão de encerramento ao Coordenador antes de saírem do ar.

## 2. O Canal Compartilhado (Blackboard Memory)

A comunicação e a sincronização do enxame ocorrem por meio de um chat de grupo persistente mantido em memória (quadro de avisos ou blackboard):

- **Envio de Mensagens:** Os agentes transmitem mensagens contendo o conteúdo informativo e o status operacional corrente (trabalhando, finalizado com sucesso ou erro).
- **Leitura do Histórico:** Os agentes recuperam mensagens do histórico para sincronizar o progresso coletivo, filtrando por tempo de envio e quantidade máxima.
- **Suspensão Assíncrona (Wait for Updates):** Para evitar o consumo desnecessário de processamento em loops de espera ativa, os agentes entram em suspensão (sono assíncrono). Eles pausam sua execução até que um novo sinal chegue ao chat de grupo ou o limite de tempo expire.

## 3. Injeção de Estado em Tempo Real

Em cada iteração de raciocínio de qualquer agente do enxame, o Prism injeta automaticamente no contexto do modelo informações atualizadas sobre a rede:

- A lista completa de novas mensagens que o agente ainda não processou (mensagens não lidas).
- Um mapa de status operacional com a situação atualizada de todos os componentes do grupo (ativo, inativo, finalizado ou com falha).

## 4. Visualização do Enxame na Interface do Usuário

A interação do enxame é representada visualmente para o usuário de forma dinâmica e interativa:

- **Gráfico SVG Dinâmico:** Um diagrama de nós exibe o Coordenador e os Trabalhadores dispostos graficamente. As linhas de conexão alteram sua aparência em tempo real: ficam sólidas se os agentes estiverem ociosos, ou tracejadas com fluxo de movimento ondulatório enquanto pensam ou operam ferramentas do sistema.
- **Painéis de Detalhes:** O usuário pode clicar em qualquer nó do gráfico para abrir um cartão descritivo contendo a fase atual de atividade, o comando de terminal/arquivo sendo executado no momento e o log de saída correspondente.
- **Nexus de Subagentes (Visualização Móvel):** Uma janela dedicada simula a interface de um chat de grupo móvel. Nela, o usuário acompanha todas as mensagens de rádio trocadas pelos robôs em tempo real e pode atuar como um "operador humano", enviando orientações adicionais que são injetadas diretamente na memória do enxame.
