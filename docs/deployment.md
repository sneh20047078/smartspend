# Deployment hardening and rollout

The SAM template describes the Cognito-authenticated API, Lambda, and owner-partitioned DynamoDB stores for profiles, transactions, budgets, groups, shared expenses, and idempotency. The group API uses DynamoDB in AWS; it must never fall back to Lambda-local SQLite. Group membership values are ledger labels, not authentication identities or grants. API authorization and every persisted access remain scoped to the verified Cognito `sub`; the owner's email claim from the signed token is used only as a readable group member label.

## Required pre-deployment checks

1. Install the AWS SAM CLI, AWS CLI, Docker, and `cfn-lint`; select a non-production AWS account/profile for initial validation, and review the current template and estimated charges.
2. Set `WebOrigin` to the exact HTTPS origin of the separately hosted frontend. The parameter is required and rejects local HTTP origins, paths, query strings, and trailing slashes. The API stage is `v1` unless overridden.
3. Run `powershell -ExecutionPolicy Bypass -File .\scripts\validate-infrastructure.ps1`. With SAM CLI and cfn-lint installed on the host, it runs SAM validation and a containerized Linux build. Or use `powershell -ExecutionPolicy Bypass -File .\scripts\validate-infrastructure.ps1 -Containerized` to run the SAM CLI, cfn-lint, and Linux-native build inside a temporary Python 3.12 Docker container without installing them on the host. Both modes are validation/build only and do not deploy.
4. Deploy only to a disposable environment first: `sam deploy --guided --template-file infrastructure/template.yaml`. Inspect the change set, generated Lambda IAM policy, Cognito authorizer, API route authorization, log groups, table keys, PITR settings, and retained resources before approving it.
5. Configure the frontend's API base URL, Cognito region, user-pool ID, and public app-client ID from CloudFormation outputs. Never put AWS access keys, signing secrets, or service credentials into frontend variables.
6. Run authenticated end-to-end checks for sign-in, profile, transaction CRUD, budget progress, all group routes, reports, and owner isolation. Use two test users to verify one user's subject cannot read another user's records. Confirm shared group members do not gain API access.

## Data safety, cost, and deletion

All financial tables use on-demand billing, server-side encryption, point-in-time recovery, and `Retain` deletion/update-replacement policies. The Cognito user pool and operational log groups are also retained. Idempotency data is TTL-backed and is deleted with the stack. These defaults reduce accidental loss but can leave billable resources after stack deletion; record table names and retention decisions, and explicitly back up/export and remove retained resources only under an approved data-retention procedure. PITR, Lambda, API Gateway, Cognito, CloudWatch Logs, and data transfer can incur charges.

The API and Lambda logs retain 30 days and avoid logging request bodies, authorization headers, or source IPs. Review retention and access controls against operational needs. The SAM template does not host the frontend, configure a custom API domain/WAF, provide account-deletion workflows, or claim compliance certification. Local development remains separate from AWS and real user records.

## Validation status

Repository tests cover configuration fail-closed behavior, required SAM routes/table references, retention/encryption settings, and mocked DynamoDB transactions. The current template, including recurring schedules, passed `cfn-lint`, `sam validate --lint`, and `sam build` in a temporary Python 3.12 Linux container. Live AWS end-to-end verification remains unrun, consistent with the no-AWS-cost local setup. Do not describe the deployment as production-certified until integration checks are completed and reviewed in a disposable AWS environment.