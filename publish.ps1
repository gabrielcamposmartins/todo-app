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

Write-Host "==> Enviando build/instalador para o GitHub (rascunho)..." -ForegroundColor Cyan
npx electron-builder --publish always

# O electron-builder cria a release como RASCUNHO (assim todos os assets sobem
# antes de ficar pública). Aqui publicamos o rascunho automaticamente.
$repo = 'gabrielcamposmartins/todo-app'
$h = @{ Authorization = "token $env:GH_TOKEN"; 'User-Agent' = 'todo-app' }
$releases = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases" -Headers $h
$draft = $releases | Where-Object { $_.draft } | Select-Object -First 1
if ($draft) {
    $body = @{ draft = $false } | ConvertTo-Json
    $pub = Invoke-RestMethod -Method Patch `
        -Uri "https://api.github.com/repos/$repo/releases/$($draft.id)" `
        -Headers $h -Body $body -ContentType 'application/json'
    Write-Host "==> Release publicada: $($pub.tag_name) -> $($pub.html_url)" -ForegroundColor Green
} else {
    Write-Host "==> Nenhum rascunho pendente (release ja publicada)." -ForegroundColor Yellow
}

Write-Host "==> Concluido. Releases em:" -ForegroundColor Green
Write-Host "    https://github.com/$repo/releases"
