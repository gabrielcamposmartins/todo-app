# Build e Release — TODO-APP

Guia para gerar o app, o instalador e publicar releases (com atualização
automática) no GitHub.

## Pré-requisitos

- **Node.js** 18+ e **npm** (testado com Node 24 / npm 11).
- **Windows** (o build alvo é Windows / NSIS).
- Dependências instaladas:

  ```powershell
  npm install
  ```

---

## Rodar em desenvolvimento

```powershell
npm start
```

> Se `npm start` falhar no PowerShell (por ser `.cmd`), rode o binário direto:
>
> ```powershell
> & "node_modules\electron\dist\electron.exe" .
> ```

A atualização automática **não** funciona em desenvolvimento (só na versão
empacotada) — a tela de Atualização mostra "Disponível apenas na versão
instalada".

---

## Build (gera app + instalador localmente)

Um único comando faz tudo:

```powershell
npm run setup
# equivalente a: powershell -ExecutionPolicy Bypass -File build.ps1
```

O `build.ps1`:

1. Prepara o `winCodeSign` (workaround dos symlinks de macOS — veja Notas).
2. Roda `electron-builder` e gera:
   - **App descompactado:** `dist\win-unpacked\TODO-APP.exe`
   - **Instalador:** `dist\TODO-APP-Setup-<versão>.exe`
3. Cria **atalho na área de trabalho** (`TODO-APP.lnk`).
4. Configura o **início automático com o Windows** (entrada `TODO-APP` no
   *Gerenciador de Tarefas → Inicializar*).

O atalho e o auto-início apontam para o **mesmo** `dist\win-unpacked\TODO-APP.exe`.

> Só gerar o build/instalador, sem atalho/auto-início:
>
> ```powershell
> npm run build
> ```

Para desativar o início automático:

```powershell
Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'TODO-APP'
```

---

## Release (publicar no GitHub + atualização automática)

### Pré-requisito: token do GitHub

1. Gere um **Personal Access Token** com permissão de escrita no repositório:
   - Fine-grained: repo `todo-app`, permissão **Contents: Read and write**.
   - Ou clássico: escopo **`repo`**.
2. Coloque-o no arquivo **`.env`** na raiz do projeto (já está no `.gitignore`,
   não é commitado):

   ```
   GH_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```

### Publicar

1. **Suba a versão** em `package.json` (ex.: `0.1.0` → `0.2.0`). A atualização
   automática só dispara para versões **maiores** que a instalada.
2. Rode:

   ```powershell
   powershell -ExecutionPolicy Bypass -File publish.ps1
   ```

O `publish.ps1`:

1. Lê o `GH_TOKEN` do `.env`.
2. Roda `electron-builder --publish always`, enviando para o GitHub (como
   **rascunho**) o instalador + `latest.yml` + `.blockmap`.
3. **Publica o rascunho automaticamente** (deixa a release pública) e mostra a URL.

> O padrão de rascunho garante que todos os arquivos terminem o upload antes de
> a release ficar visível — sem risco de alguém baixar uma release incompleta.

### Resultado

- Página pública: `https://github.com/gabrielcamposmartins/todo-app/releases`
- Os apps já instalados detectam a nova versão (na checagem automática ao
  iniciar ou em **Configurações → Atualização → Verificar atualizações**),
  baixam e instalam.

---

## Notas

- **winCodeSign / symlinks:** o electron-builder baixa um pacote de assinatura
  cujo `.7z` contém symlinks de macOS que o Windows não extrai sem privilégio,
  o que abortava o build. O `build.ps1` contorna isso pré-extraindo apenas as
  ferramentas do Windows no cache. Como o app **não é assinado**, a etapa de
  assinatura é apenas pulada.
- **SmartScreen:** por não ser assinado com certificado, o Windows pode exibir
  "Windows protegeu o seu PC" ao instalar. O usuário clica em **Mais
  informações → Executar assim mesmo**. Para remover, é necessário um
  certificado de *code signing* (pago).
- **Segurança do token:** nunca comite o `.env`. Se o token vazar, **revogue-o**
  em <https://github.com/settings/tokens> e gere outro, atualizando o `.env`.
- **Onde ficam os dados do app:** `%APPDATA%\todo-overlay\` (`data.json` e a
  pasta `attachments`).

---

## Resumo dos scripts

| Comando | O que faz |
|---|---|
| `npm start` | Roda em desenvolvimento |
| `npm run build` | Gera app + instalador em `dist\` |
| `npm run setup` | Build + atalho + início automático |
| `publish.ps1` | Build + publica a release no GitHub (auto-update) |
