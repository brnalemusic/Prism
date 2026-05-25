# Protocolo Visual, Interface e Mini Aplicativos

O Prism implementa um sistema visual sofisticado e moderno que define regras claras para a exibição de conteúdos na interface. O design baseia-se em estéticas escurecidas, efeitos de vidro (glassmorphism), gradientes vibrantes e transições suaves, com uma clara separação entre formatos de renderização textual, estrutural e interativa.

## 1. O Protocolo Visual Trilateral

Para manter a interface limpa e otimizar o desempenho, a inteligência artificial categoriza as respostas visuais em três níveis estritos de complexidade:

### Nível 1: Markdown Simples (Conversa Padrão)

- Utilizado em 95% das respostas cotidianas. Inclui explicações, revisões de texto, trechos de código e diálogos diretos.
- Utiliza a sintaxe clássica de Markdown (negrito, listas, tabelas básicas). É proibida a utilização de elementos HTML e estilos de CSS inline neste nível para evitar sobrecarga visual.

### Nível 2: Markdown Rico (Estruturas Visuais Estáticas)

- Ativado exclusivamente sob requisição explícita do usuário (ex: "crie um painel de ideias", "mostre um cartão de perfil", "crie um painel visual").
- Permite a inserção direta de tags HTML e propriedades de estilização CSS inline na mensagem. O renderizador interpreta essas tags para desenhar cartões com cantos arredondados, margens suaves, sombras sutis e fundos degradê.
- É vetado o uso de HTML estrutural para exibir textos simples ou análises puramente conversacionais.

### Nível 3: Mini Aplicativos (Contexto Interativo Dinâmico)

- Utilizado quando o usuário demanda um módulo funcional que exija interação com eventos de tela (clicar em botões que alteram estados locais, inserção de dados em formulários, jogos ou calculadoras).
- A inteligência gera esses módulos encapsulados em tags específicas de mini aplicativo contendo seções isoladas para estrutura física (HTML), estilo de interface (CSS) e lógica de eventos (Javascript).
- O renderizador hospeda e processa esses aplicativos dentro de estruturas de quadro isoladas (sandboxed iframes), prevenindo que erros do código gerado causem falhas na aplicação desktop hospedeira.
- O Prism permite abrir qualquer mini aplicativo de forma isolada em uma janela dedicada do sistema para melhor usabilidade, com suporte a visualização do código original e reinicialização.

## 2. A Barra de Entrada (Input Bar)

O canal primário de entrada do usuário foi projetado para acomodar textos extensos e comandos dinâmicos:

- **Redimensionamento Automático:** A caixa de texto expande sua altura dinamicamente para se adequar ao tamanho do texto inserido. Se o volume ultrapassar o limite recomendado, ela ativa barras de rolagem e revela um botão para abertura em modo tela cheia (Message Editor).
- **Atalhos e Comandos de Barra:** O Prism detecta se o texto começa com barra inclinada `/` para exibir menus flutuantes contendo atalhos rápidos como busca forçada, busca de vídeo ou configuração de enxame.
- **Sinalizadores de Modo:** Badges visuais mudam de cor na barra de entrada para evidenciar se o aplicativo está operando com busca web ativa, busca de vídeo, raciocínio avançado ou busca estendida.

## 3. Estética e Micro-Animações

A interface adota técnicas contemporâneas de design de produto:

- **Efeitos de Foco Dinâmicos:** A barra de entrada exibe um contorno brilhante com gradientes animados que correspondem ao modo selecionado pelo usuário (ex: tons amarelos para pensamento profundo, verdes para busca padrão e azuis para busca estendida).
- **Rolagem e Rolagem de Emergência:** A janela de chat acompanha as respostas em tempo real por meio de rolagem inteligente. Se o usuário subir a barra de rolagem manualmente para inspecionar um histórico anterior, a auto-rolagem é desativada imediatamente e um botão discreto com ícone de seta surge para retornar a tela ao final.
- **Indicadores de Processamento:** Estados de pensamento, carregamento de links e processamento de subagentes utilizam animações de pulsação e spinners minimalistas.
