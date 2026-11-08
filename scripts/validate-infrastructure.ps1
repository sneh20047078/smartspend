param(
    [switch]$Containerized
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$template = Join-Path $repoRoot 'infrastructure\template.yaml'

if ($Containerized) {
    if (-not (Get-Command 'docker' -ErrorAction SilentlyContinue)) {
        throw "Docker is required for containerized validation. See docs/deployment.md."
    }

    $dockerRoot = $repoRoot.Replace('\', '/')
    docker run --rm --volume "${dockerRoot}:/workspace" --workdir /workspace --env SAM_CLI_TELEMETRY=0 python:3.12-slim sh -c 'set -e; python -m pip install --quiet --index-url https://pypi.org/simple --retries 10 --timeout 120 aws-sam-cli cfn-lint; cfn-lint infrastructure/template.yaml; sam validate --lint --template-file infrastructure/template.yaml; sam build --template-file infrastructure/template.yaml'
    if ($LASTEXITCODE -ne 0) { throw "Containerized SAM validation/build failed with exit code $LASTEXITCODE." }
    exit 0
}

foreach ($tool in @('cfn-lint', 'sam', 'docker')) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        throw "Required deployment validation tool '$tool' is not installed or not on PATH. See docs/deployment.md."
    }
}

Push-Location $repoRoot
try {
    cfn-lint $template
    if ($LASTEXITCODE -ne 0) { throw "cfn-lint failed with exit code $LASTEXITCODE." }

    sam validate --lint --template-file $template
    if ($LASTEXITCODE -ne 0) { throw "SAM validation failed with exit code $LASTEXITCODE." }

    sam build --use-container --template-file $template
    if ($LASTEXITCODE -ne 0) { throw "SAM build failed with exit code $LASTEXITCODE." }
}
finally {
    Pop-Location
}
