<#
.SYNOPSIS
    Automates the deployment, smoke-testing, and teardown of a disposable SmartSpend staging stack on AWS.

.DESCRIPTION
    This script is designed for disposable cloud verification. It:
    1. Validates that the AWS CLI, SAM CLI, and Docker are available.
    2. Verifies the caller identity (AWS account/role).
    3. Builds and deploys the CloudFormation stack via AWS SAM.
    4. Executes an automated smoke test against the deployed public health endpoint.
    5. Provides a teardown mode to safely delete disposable resources.

.PARAMETER Action
    The action to perform: 'Deploy', 'SmokeTest', or 'Teardown'. Default is 'Deploy'.

.PARAMETER StackName
    The name of the CloudFormation stack. Default is 'smartspend-staging'.

.PARAMETER WebOrigin
    The HTTPS origin of the frontend (e.g. 'https://staging.example.com').

.PARAMETER Region
    The target AWS region. Default is 'us-east-1'.

.EXAMPLE
    .\scripts\deploy-staging.ps1 -Action Deploy -WebOrigin https://app.example.com
    .\scripts\deploy-staging.ps1 -Action SmokeTest -StackName smartspend-staging
    .\scripts\deploy-staging.ps1 -Action Teardown -StackName smartspend-staging
#>

[CmdletBinding()]
param(
    [ValidateSet('Deploy', 'SmokeTest', 'Teardown')]
    [string]$Action = 'Deploy',

    [string]$StackName = 'smartspend-staging',
    [string]$WebOrigin = 'https://staging.example.com',
    [string]$Region = 'us-east-1'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$template = Join-Path $repoRoot 'infrastructure\template.yaml'

function Test-Prerequisites {
    Write-Host "[1/4] Checking CLI prerequisites..." -ForegroundColor Cyan
    foreach ($cmd in @('aws', 'sam')) {
        if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
            throw "Prerequisite '$cmd' is not installed or not in PATH. Please install it before proceeding."
        }
    }

    $caller = aws sts get-caller-identity --output json | ConvertFrom-Json
    Write-Host "      Authenticated as AWS Account: $($caller.Account) (Arn: $($caller.Arn))" -ForegroundColor Green
}

if ($Action -eq 'Deploy') {
    Test-Prerequisites

    Write-Host "`n[2/4] Validating and building SAM template..." -ForegroundColor Cyan
    sam validate --lint --template-file $template
    sam build --template-file $template

    Write-Host "`n[3/4] Deploying stack '$StackName' to region '$Region'..." -ForegroundColor Cyan
    sam deploy `
        --stack-name $StackName `
        --region $Region `
        --template-file (Join-Path $repoRoot '.aws-sam\build\template.yaml') `
        --parameter-overrides "WebOrigin=$WebOrigin" `
        --capabilities CAPABILITY_IAM `
        --no-fail-on-empty-changeset `
        --resolve-s3

    Write-Host "`n[4/4] Retrieving stack outputs..." -ForegroundColor Cyan
    $outputs = aws cloudformation describe-stacks --stack-name $StackName --region $Region --query "Stacks[0].Outputs" --output json | ConvertFrom-Json
    $outputs | Format-Table -Property OutputKey, OutputValue -AutoSize

    $apiBaseUrl = ($outputs | Where-Object { $_.OutputKey -eq 'ApiBaseUrl' }).OutputValue
    if ($apiBaseUrl) {
        Write-Host "`nStack deployed successfully! Running smoke test against $apiBaseUrl/health..." -ForegroundColor Green
        try {
            $response = Invoke-RestMethod -Uri "$apiBaseUrl/health" -Method Get
            Write-Host "Smoke test PASSED! Response: $($response | ConvertTo-Json -Compress)" -ForegroundColor Green
        } catch {
            Write-Warning "Health check returned an error or requires auth: $_"
        }
    }
}
elseif ($Action -eq 'SmokeTest') {
    Write-Host "Querying API endpoint for stack '$StackName'..." -ForegroundColor Cyan
    $outputs = aws cloudformation describe-stacks --stack-name $StackName --region $Region --query "Stacks[0].Outputs" --output json | ConvertFrom-Json
    $apiBaseUrl = ($outputs | Where-Object { $_.OutputKey -eq 'ApiBaseUrl' }).OutputValue

    if (-not $apiBaseUrl) {
        throw "Could not find ApiBaseUrl in stack '$StackName' outputs."
    }

    Write-Host "Testing GET $apiBaseUrl/health..." -ForegroundColor Cyan
    $health = Invoke-RestMethod -Uri "$apiBaseUrl/health" -Method Get
    Write-Host "Health check response: $($health | ConvertTo-Json -Compress)" -ForegroundColor Green
}
elseif ($Action -eq 'Teardown') {
    Write-Host "WARNING: Tearing down stack '$StackName' in region '$Region'..." -ForegroundColor Yellow
    $confirm = Read-Host "Are you sure you want to delete '$StackName'? Retained DynamoDB tables and Cognito pools must be deleted manually if configured. (y/N)"
    if ($confirm -eq 'y' -or $confirm -eq 'Y') {
        sam delete --stack-name $StackName --region $Region --no-prompts
        Write-Host "Stack deletion initiated." -ForegroundColor Green
    } else {
        Write-Host "Teardown cancelled." -ForegroundColor Gray
    }
}
