$ErrorActionPreference = 'Stop'

Push-Location (Join-Path $PSScriptRoot '..\frontend')
npm test
if ($LASTEXITCODE -ne 0) { $code = $LASTEXITCODE; Pop-Location; exit $code }
npm run build
if ($LASTEXITCODE -ne 0) { $code = $LASTEXITCODE; Pop-Location; exit $code }
Pop-Location

$backendPython = Join-Path $PSScriptRoot '..\backend\.venv\Scripts\python.exe'
Push-Location (Join-Path $PSScriptRoot '..\backend')
if (Test-Path $backendPython) {
    & $backendPython -m pytest
} else {
    python -m pytest
}
$backendTestExitCode = $LASTEXITCODE
Pop-Location
exit $backendTestExitCode
