# To-Do Overlay

Overlay de lista de tarefas para Windows: transparente, sempre no topo e com
**click-through** — os cliques passam direto para o que estiver atrás, então o
overlay não atrapalha o uso do computador. Só os **cards** e **botões** capturam
o mouse.

## Como rodar (desenvolvimento)

```powershell
npm install
npm start
```

> `npm start` no PowerShell pode falhar por ser um `.cmd`; nesse caso rode
> direto o binário: `& "node_modules\electron\dist\electron.exe" .`

## Build + atalho + iniciar com o Windows

Um único script faz tudo:

```powershell
npm run setup
# ou: powershell -ExecutionPolicy Bypass -File build.ps1
```

O `build.ps1`:
1. Prepara o winCodeSign (workaround dos symlinks de macOS — veja nota abaixo).
2. Instala dependências (se necessário) e gera:
   - o build empacotado em `dist\win-unpacked\TODO-APP.exe`;
   - o **instalador** em `dist\TODO-APP-Setup-<versão>.exe`.
3. Cria um **atalho na área de trabalho** (`TODO-APP.lnk`).
4. Configura o **início automático com o Windows** — aparece como **TODO-APP**
   no *Gerenciador de Tarefas → Inicializar*.

O atalho e o auto-início apontam para o **mesmo** executável do build descompactado.

### Instalador

`dist\TODO-APP-Setup-<versão>.exe` é um instalador NSIS distribuível: permite
escolher a pasta de instalação e cria atalhos na área de trabalho e no menu
Iniciar automaticamente. Use-o para instalar em outras máquinas.

> **Nota sobre assinatura:** o electron-builder baixa o pacote `winCodeSign`,
> cujo arquivo contém symlinks de macOS que o Windows não extrai sem privilégio
> — o que abortava o build. O `build.ps1` contorna isso pré-extraindo apenas as
> ferramentas do Windows (ignorando os symlinks) no cache. Como o app não é
> assinado, a etapa de assinatura é apenas pulada.

**Para desativar o início automático:**

```powershell
Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'TODO-APP'
```

## Funcionalidades

- **Posição:** arraste pela **alça (⠿) à direita** dos cards para mover o app
  para qualquer ponto da tela (a posição é salva).
- **Perfis e projetos (abas):** organize tarefas em perfis (ex.: Trabalho,
  Financeiro) e, dentro de cada um, projetos/sub-abas (ex.: Proj1, Proj2 /
  Contas, Investimentos). Tudo parametrizável nas configurações.
- **Botões redondos:** `+` (nova tarefa), `▤` (modo do card), `👁` (modo
  passivo), `⚙` (configurações), `▾` (recolher).
- **Cadastro de tarefa:** nome, prioridade, descrição, prazo (datetime) e
  **anexos** (copiados para a pasta de dados do app).
- **Modos de card:**
  - **Detalhado:** nome, badge, descrição, prazo e ações.
  - **Compacto:** só o nome, com mini-botões à direita.
  - **Clicar no card o expande/recolhe** (não edita — para editar use o ✎).
- **Modos de exibição** (além de normal):
  - **Recolhido (▾):** vira uma bolha, com **aviso vermelho** indicando o nº de
    tarefas não concluídas (estilo WhatsApp).
  - **Passivo (👁):** mostra só os cards, sem botões/abas e **sem capturar
    cliques** — o overlay fica puramente visual. Volte com `Ctrl + Alt + M`.
- **Prioridades parametrizáveis:** nome, cor e ordem (setas ▲▼).
- **Ordenação parametrizável:** por prioridade, prazo, nome ou criação, em ordem
  crescente/decrescente.
- **Transparência e largura** ajustáveis por sliders.

## Atalhos

- `Ctrl + Alt + T` — mostra/esconde o overlay.
- `Ctrl + Alt + M` — alterna entre modo **normal** e **passivo**.

## Onde ficam os dados

`%APPDATA%\todo-overlay\`
- `data.json` — tarefas e configurações.
- `attachments\` — cópias dos arquivos anexados.

## Próximos passos (sugestões para futuras features)

- Iniciar com o Windows (atalho na pasta Startup ou `auto-launch`).
- Notificações de prazo.
- Empacotar com `electron-builder` para gerar um `.exe` instalável.
- Sincronização / backup (ex.: Supabase).
