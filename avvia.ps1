param([int]$Port = 8765)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
try {
    $running = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/studio" -TimeoutSec 2
    if ($running.models.'gemini-4-hydrogen' -eq 'Hydrogen') {
        Write-Host "Indice è già attivo su http://127.0.0.1:$Port"
        exit 0
    }
} catch {
    # Il servizio si avvia qui sotto quando la porta è libera.
}
uv sync --locked --python 3.12
if ($LASTEXITCODE) { exit $LASTEXITCODE }
if (!(Test-Path -LiteralPath 'node_modules')) {
    npm.cmd ci
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
}
npm.cmd run build
if ($LASTEXITCODE) { exit $LASTEXITCODE }
Write-Host "Indice: http://127.0.0.1:$Port"
uv run --no-sync uvicorn server.app:app --host 127.0.0.1 --port $Port
