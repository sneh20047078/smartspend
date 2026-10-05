# SmartSpend workspace notes

- This application is being delivered in verified phases; consult README.md for current completion status.
- Never store passwords or trust frontend-supplied subject/user IDs. Production auth is Cognito JWT verification.
- Use integer minor units and explicit currency codes for financial data. Persist UTC timestamps.
- Keep local development auth isolated from AWS and real user data.
- Run backend pytest and frontend npm test/build when changing their respective code.
