export type Profile = {
  email: string;
  display_name: string;
  preferred_currency: string;
  timezone: string;
  theme: 'light' | 'dark' | 'system';
};

type ApiErrorBody = { error?: { message?: string; code?: string; fields?: { field: string; message: string }[] }; detail?: string };

const baseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

export class ApiError extends Error {
  status: number;
  fields: { field: string; message: string }[];

  constructor(message: string, status: number, fields: { field: string; message: string }[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.fields = fields;
  }
}

export async function request<T>(path: string, token?: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
    throw new ApiError(body.error?.message || body.detail || 'The request could not be completed.', response.status, body.error?.fields);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  login: (email: string, password: string) =>
    request<{ access_token: string; expires_in: number }>('/auth/login', undefined, {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  register: (email: string, password: string, displayName: string) =>
    request<{ access_token: string; expires_in: number }>('/auth/register', undefined, {
      method: 'POST',
      body: JSON.stringify({ email, password, display_name: displayName }),
    }),
  localLogin: (email: string) => request<{ access_token: string; expires_in: number }>('/auth/dev-login', undefined, {
    method: 'POST',
    body: JSON.stringify({ email }),
  }),
  profile: (token: string) => request<Profile>('/me', token),
  updateProfile: (token: string, patch: Partial<Pick<Profile, 'display_name' | 'preferred_currency' | 'timezone' | 'theme'>>) =>
    request<Profile>('/me', token, { method: 'PATCH', body: JSON.stringify(patch) }),
  logout: (token: string) => request<void>('/auth/logout', token, { method: 'POST' }),
};
