# =====================================================================
#  build.ps1 - Gera o build do TODO-APP, cria atalho na area de trabalho
#  e configura o inicio automatico com o Windows.
#  Atalho e auto-inicio apontam para o MESMO executavel do build.
# =====================================================================
$ErrorActionPreference = 'Stop'

# Raiz do projeto (pasta onde este script esta)
$proj = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $proj

Write-Host "==> Projeto: $proj" -ForegroundColor Cyan

# 1) Garante dependencias instaladas
if (-not (Test-Path (Join-Path $proj 'node_modules\electron-builder'))) {
    Write-Host "==> Instalando dependencias (npm install)..." -ForegroundColor Cyan
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install falhou." }
}

# 2) Workaround do winCodeSign:
# O pacote de assinatura do electron-builder contem symlinks de macOS que o
# Windows nao consegue extrair sem privilegio, abortando o build. Como nao
# assinamos o app, pre-extraimos as ferramentas do Windows ignorando os symlinks.
$cache = Join-Path $env:LOCALAPPDATA 'electron-builder\Cache\winCodeSign'
$wcsDir = Join-Path $cache 'winCodeSign-2.6.0'
if (-not (Test-Path (Join-Path $wcsDir 'windows-10'))) {
    Write-Host "==> Preparando winCodeSign (sem symlinks)..." -ForegroundColor Cyan
    New-Item -ItemType Directory -Force -Path $cache | Out-Null
    $7za = Join-Path $proj 'node_modules\7zip-bin\win\x64\7za.exe'
    $archive = Get-ChildItem $cache -Filter *.7z -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $archive) {
        $url = 'https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z'
        $archivePath = Join-Path $cache 'winCodeSign-2.6.0.7z'
        Invoke-WebRequest -Uri $url -OutFile $archivePath
        $archive = Get-Item $archivePath
    }
    # As 2 falhas de symlink (.dylib do macOS) sao esperadas e irrelevantes.
    & $7za x $archive.FullName "-o$wcsDir" -y -bso0 -bsp0 2>$null
    Remove-Item (Join-Path $wcsDir 'darwin') -Recurse -Force -ErrorAction SilentlyContinue
}

# Gera o build: pasta descompactada + instalador NSIS (conforme package.json).
# Desabilita a descoberta de certificado (nao assinamos o app).
Write-Host "==> Gerando build (electron-builder)..." -ForegroundColor Cyan
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
npx electron-builder
# Nao usamos $LASTEXITCODE como criterio: a etapa de assinatura pode ser pulada
# sem impedir o empacotamento. O sucesso e verificado pela existencia do .exe.

# 3) Localiza o executavel gerado
$exe = Join-Path $proj 'dist\win-unpacked\TODO-APP.exe'
if (-not (Test-Path $exe)) {
    # Fallback: procura qualquer .exe na pasta win-unpacked
    $found = Get-ChildItem -Path (Join-Path $proj 'dist\win-unpacked') -Filter *.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { $exe = $found.FullName } else { throw "Build falhou: executavel nao encontrado em dist\win-unpacked." }
}
Write-Host "==> Build pronto: $exe" -ForegroundColor Green

# 4) Atalho na area de trabalho
$desktop = [Environment]::GetFolderPath('Desktop')
$lnk = Join-Path $desktop 'TODO-APP.lnk'
$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut($lnk)
$sc.TargetPath = $exe
$sc.WorkingDirectory = Split-Path $exe -Parent
$sc.Description = 'TODO Overlay'
$sc.Save()
Write-Host "==> Atalho criado na area de trabalho: $lnk" -ForegroundColor Green

# 5) Inicio automatico com o Windows (aparece como 'TODO-APP' no Gerenciador de Tarefas > Inicializar)
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
Set-ItemProperty -Path $runKey -Name 'TODO-APP' -Value ('"{0}"' -f $exe)
Write-Host "==> Inicio automatico configurado (TODO-APP -> $exe)" -ForegroundColor Green

# 6) Informa o instalador NSIS gerado (se houver)
$installer = Get-ChildItem (Join-Path $proj 'dist') -Filter 'TODO-APP-Setup-*.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($installer) {
    Write-Host "==> Instalador gerado: $($installer.FullName)" -ForegroundColor Green
}

Write-Host ""
Write-Host "Concluido!" -ForegroundColor Cyan
Write-Host "  Build/atalho/auto-inicio: $exe"
if ($installer) { Write-Host "  Instalador distribuivel : $($installer.FullName)" }
Write-Host "Para remover o inicio automatico: Remove-ItemProperty -Path '$runKey' -Name 'TODO-APP'"
