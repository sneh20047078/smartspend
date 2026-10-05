import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, type Profile } from '../lib/api';
import { cognitoEnabled, configureCognito } from '../lib/cognito';

const TOKEN_KEY = 'smartspend.local.token';

type AuthContextValue = {
  user: Profile | null;
  token: string | null;
  loading: boolean;
  mode: 'local' | 'cognito';
  login: (email: string, password?: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  confirmRegistration: (email: string, code: string) => Promise<void>;
  beginPasswordReset: (email: string) => Promise<void>;
  finishPasswordReset: (email: string, code: string, password: string) => Promise<void>;
  saveProfile: (patch: Partial<Pick<Profile, 'display_name' | 'preferred_currency' | 'timezone' | 'theme'>>) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function currentCognitoToken(): Promise<string | null> {
  await configureCognito();
  const { fetchAuthSession } = await import('aws-amplify/auth');
  const session = await fetchAuthSession();
  return session.tokens?.idToken?.toString() ?? null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Profile | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (activeToken: string) => {
    const profile = await api.profile(activeToken);
    setToken(activeToken);
    setUser(profile);
  }, []);

  const refreshProfile = useCallback(async () => {
    const activeToken = cognitoEnabled ? await currentCognitoToken() : sessionStorage.getItem(TOKEN_KEY);
    if (!activeToken) {
      setUser(null);
      setToken(null);
      return;
    }
    await loadProfile(activeToken);
  }, [loadProfile]);

  useEffect(() => {
    let mounted = true;
    const initialize = async () => {
      try {
        const activeToken = cognitoEnabled ? await currentCognitoToken() : sessionStorage.getItem(TOKEN_KEY);
        if (activeToken) {
          const profile = await api.profile(activeToken);
          if (mounted) {
            setToken(activeToken);
            setUser(profile);
          }
        }
      } catch {
        if (!cognitoEnabled) sessionStorage.removeItem(TOKEN_KEY);
        if (mounted) {
          setToken(null);
          setUser(null);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void initialize();
    return () => { mounted = false; };
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    token,
    loading,
    mode: cognitoEnabled ? 'cognito' : 'local',
    async login(email, password) {
      if (cognitoEnabled) {
        if (!password) throw new Error('Enter your password.');
        await configureCognito();
        const { signIn } = await import('aws-amplify/auth');
        const result = await signIn({ username: email, password });
        if (!result.isSignedIn) {
          if (result.nextStep.signInStep === 'CONFIRM_SIGN_IN_WITH_SMS_CODE' || result.nextStep.signInStep === 'CONFIRM_SIGN_IN_WITH_TOTP_CODE') {
            throw new Error('A multi-factor authentication challenge is required. Configure this challenge in your Cognito sign-in flow.');
          }
          if (result.nextStep.signInStep === 'RESET_PASSWORD') throw new Error('Password reset is required. Use Forgot password to continue.');
          throw new Error(`Sign-in requires an additional step: ${result.nextStep.signInStep}.`);
        }
        const activeToken = await currentCognitoToken();
        if (!activeToken) throw new Error('Cognito did not return an identity token.');
        await loadProfile(activeToken);
      } else {
        const result = await api.localLogin(email);
        sessionStorage.setItem(TOKEN_KEY, result.access_token);
        await loadProfile(result.access_token);
      }
    },
    async register(email, password, displayName) {
      if (!cognitoEnabled) throw new Error('Account registration requires a configured Cognito User Pool. Local mode does not store passwords.');
      await configureCognito();
      const { signUp } = await import('aws-amplify/auth');
      const result = await signUp({
        username: email,
        password,
        options: { userAttributes: { email, name: displayName } },
      });
      if (result.nextStep.signUpStep !== 'CONFIRM_SIGN_UP' && result.nextStep.signUpStep !== 'DONE') {
        throw new Error(`Sign-up requires an additional step: ${result.nextStep.signUpStep}.`);
      }
    },
    async confirmRegistration(email, code) {
      if (!cognitoEnabled) throw new Error('Account registration requires Cognito.');
      await configureCognito();
      const { confirmSignUp } = await import('aws-amplify/auth');
      await confirmSignUp({ username: email, confirmationCode: code });
    },
    async beginPasswordReset(email) {
      if (!cognitoEnabled) throw new Error('Password reset requires Cognito. Local mode does not use passwords.');
      await configureCognito();
      const { resetPassword } = await import('aws-amplify/auth');
      await resetPassword({ username: email });
    },
    async finishPasswordReset(email, code, password) {
      if (!cognitoEnabled) throw new Error('Password reset requires Cognito.');
      await configureCognito();
      const { confirmResetPassword } = await import('aws-amplify/auth');
      await confirmResetPassword({ username: email, confirmationCode: code, newPassword: password });
    },
    async saveProfile(patch) {
      if (!token) throw new Error('Your session has expired. Sign in again.');
      const updated = await api.updateProfile(token, patch);
      setUser(updated);
    },
    async logout() {
      if (cognitoEnabled) {
        await configureCognito();
        const { signOut } = await import('aws-amplify/auth');
        await signOut();
      } else {
        if (token) await api.logout(token).catch(() => undefined);
        sessionStorage.removeItem(TOKEN_KEY);
      }
      setToken(null);
      setUser(null);
    },
    async refreshProfile() { await refreshProfile(); },
  }), [user, token, loading, loadProfile, refreshProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
