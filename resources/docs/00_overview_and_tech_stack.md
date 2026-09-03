# Documentação Técnica: Visão Geral, Arquitetura e Pilha Tecnológica do Prism

## 1. O que é o Prism?

O **Prism** é um assistente de IA para desktop de código aberto, multiplataforma e multi-provedor construído sobre **Electron** e **React**. Ele integra inteligência artificial generativa com execução direta no sistema operacional do usuário, combinando um espaço de trabalho de chat com painéis múltiplos, um **Quick Launcher** transparente global, conteinerização de comandos locais em sandbox, automação de navegador via Playwright, miniaplicativos interativos, ditado por voz, síntese de fala (TTS) e ferramentas de manipulação de artefatos (como PDF, PPTX, código e tarefas).

---

## 2. Pilha Tecnológica (Tech Stack)

| Camada / Componente | Tecnologia Utilizada |
| --- | --- |
| Runtime de Desktop | Electron 39+ (Node.js + Chromium) |
| UI Framework | React 19 + TypeScript 5.9 |
| Bundler & Build | Vite 7 / `electron-vite` |
| Integração de IA | `@google/genai`, `openai`, `undici` |
| Automação de Navegador | Playwright (Chromium CDPSession) |
| Formatação & Matemática | `react-markdown`, `rehype-raw`, `rehype-katex`, `katex`, `prismjs` |
| Motor de Estilização | Tailwind CSS v4 + LightningCSS |
| Geração de Apresentações | `PptxGenJS` + Offscreen Captures em Chromium |
| Segurança de Credenciais | Electron `safeStorage` (Windows DPAPI / Mac Keychain) |
| Empacotador de Distribuição | `electron-builder` (Instaladores NSIS / Portables) |

---

## 3. Arquitetura Multi-Provedor

 O Prism quebra a dependência de um fornecedor único de API. O usuário pode registrar múltiplos perfis de API e alternar dinamica e independentemente entre os modelos para cada funcionalidade:

1. **Google AI Studio**: Suporte nativo para a família Gemini (ex: `gemini-3.6-flash`, `gemini-3.6-pro`).
2. **OpenAI**: Endpoints GPT (ex: `gpt-5.6-sol`, `gpt-4o`).
3. **Anthropic Claude**: Endpoint de mensagens nativo Anthropic (ex: `claude-sonnet-5`).
4. **Provedores de Nuvem Acelerados**: OpenRouter, NVIDIA NIM, GroqCloud, Cerebras AI, Puter.js.
5. **Modelos Locais & Endpoints Customizados**: Integração com Ollama, LM Studio, vLLM e LocalAI através de Base URL configurável e suporte às APIs compatíveis com OpenAI ou Anthropic.

---

## 4. Quick Launcher e Modos de Operação

O Quick Launcher é acionado via atalho global de sistema (por padrão `Ctrl+Space`):

- **Modo Simples**: Mini-chat renderizado diretamente sobre o desktop, permitindo cálculos rápidos, abertura de aplicativos instalados, busca em arquivos do workspace e respostas ágeis de IA.
- **Modo Avançado**: Envia a consulta diretamente para o espaço de trabalho principal do chat ao pressionar Enter.
- **Modos de Atalho**:
  - `Ctrl+M`: Seleção rápida de modelo de IA.
  - `Ctrl+Alt+Space`: Screenshot instantâneo da tela com visual glow que anexa a captura na mensagem.

---

## 5. Ferramentas do Sistema e Segurança

O Prism provê um conjunto amplo de ferramentas nativas para a IA interagir com o ambiente:
- **Sandbox de Comandos Locais**: Executa scripts e comandos shell em PowerShell/CMD isolados com controle de permissão e timeout.
- **Ferramentas de Arquivo**: Leitura, gravação, listagem e substituição cirúrgica de conteúdo de arquivos no disco.
- **Automação Playwright**: Inspeção, navegação e interação com páginas web ativas.
- **Geração de Artefatos**: Compilação de PDFs profissionais e apresentações PPTX widescreen 16:9.
- **Base de Conhecimento Interna**: Navegação e busca nativa (`internal_docs_list`, `internal_docs_read`, `internal_docs_search`) sobre a documentação do aplicativo.
