# =====================================================================
#  publish.ps1 - Lê GH_TOKEN do .env e publica a release no GitHub
#  (gera o build + instalador + latest.yml e envia para o repositório).
# =====================================================================
$ErrorActionPreference = 'Stop'
$proj = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $proj

# Carrega variáveis do .env (ex.: GH_TOKEN)
$envFile = Join-Path $proj '.env'
if (-not (Test-Path $envFile)) { throw ".env não encontrado em $proj" }
Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([^#=]+)=(.*)$') {
        Set-Item -Path ("Env:" + $matches[1].Trim()) -Value $matches[2].Trim()
    }
}
if (-not $env:GH_TOKEN) { throw "GH_TOKEN não definido no .env" }

# Não assinamos o app; evita o passo de winCodeSign.
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'

Write-Host "==> Publicando release no GitHub (electron-builder --publish always)..." -ForegroundColor Cyan
npx electron-builder --publish always

Write-Host "==> Concluido. Verifique as releases em:" -ForegroundColor Green
Write-Host "    https://github.com/gabrielcamposmartins/todo-app/releases"
