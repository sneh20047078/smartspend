const region = import.meta.env.VITE_AWS_REGION;
const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID;
const userPoolClientId = import.meta.env.VITE_COGNITO_APP_CLIENT_ID;

const cognitoValues = [region, userPoolId, userPoolClientId];
export const cognitoEnabled = cognitoValues.every(Boolean);

if (cognitoValues.some(Boolean) && !cognitoEnabled) {
  throw new Error('Configure VITE_AWS_REGION, VITE_COGNITO_USER_POOL_ID, and VITE_COGNITO_APP_CLIENT_ID together.');
}

let configuration: Promise<void> | null = null;

export function configureCognito(): Promise<void> {
  if (!cognitoEnabled) return Promise.resolve();
  if (configuration) return configuration;
  configuration = import('aws-amplify').then(({ Amplify }) => {
    Amplify.configure({
      Auth: {
        Cognito: {
          userPoolId: userPoolId!,
          userPoolClientId: userPoolClientId!,
          loginWith: { email: true },
        },
      },
    });
  });
  return configuration;
}
