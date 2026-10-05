import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthPage } from '../pages/AuthPage';
import { ProtectedRoute } from './ProtectedRoute';

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock('./AuthContext', () => ({ useAuth: useAuthMock }));

function authValue(overrides: Record<string, unknown> = {}) {
  return {
    user: null,
    token: null,
    loading: false,
    mode: 'local',
    login: vi.fn().mockResolvedValue(undefined),
    register: vi.fn().mockResolvedValue(undefined),
    confirmRegistration: vi.fn().mockResolvedValue(undefined),
    beginPasswordReset: vi.fn().mockResolvedValue(undefined),
    finishPasswordReset: vi.fn().mockResolvedValue(undefined),
    saveProfile: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    refreshProfile: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('authentication screens', () => {
  beforeEach(() => useAuthMock.mockReset());

  it('submits the local email sign-in and does not ask for a password', async () => {
    const user = userEvent.setup();
    const context = authValue();
    useAuthMock.mockReturnValue(context);
    render(<MemoryRouter><AuthPage /></MemoryRouter>);

    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/email address/i), 'sam@example.com');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(context.login).toHaveBeenCalledWith('sam@example.com', undefined));
  });

  it('shows the Cognito registration form and submits the user-provided profile name', async () => {
    const user = userEvent.setup();
    const context = authValue({ mode: 'cognito' });
    useAuthMock.mockReturnValue(context);
    render(<MemoryRouter><AuthPage /></MemoryRouter>);

    await user.click(screen.getByRole('button', { name: /create account/i }));
    await user.type(screen.getByLabelText(/email address/i), 'sam@example.com');
    await user.type(screen.getByLabelText(/your name/i), 'Sam Lee');
    await user.type(screen.getByLabelText('Password'), 'SafePassword123!');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => expect(context.register).toHaveBeenCalledWith('sam@example.com', 'SafePassword123!', 'Sam Lee'));
    expect(await screen.findByRole('heading', { name: /check your inbox/i })).toBeInTheDocument();
  });

  it('redirects an unauthenticated visitor away from a protected route', async () => {
    useAuthMock.mockReturnValue(authValue());
    render(<MemoryRouter initialEntries={['/private']}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/private" element={<p>Private account content</p>} />
        </Route>
        <Route path="/login" element={<p>Sign-in screen</p>} />
      </Routes>
    </MemoryRouter>);
    expect(await screen.findByText('Sign-in screen')).toBeInTheDocument();
    expect(screen.queryByText('Private account content')).not.toBeInTheDocument();
  });

  it('renders protected content after identity has loaded', () => {
    useAuthMock.mockReturnValue(authValue({ user: { display_name: 'Sam Lee' } }));
    render(<MemoryRouter initialEntries={['/private']}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/private" element={<p>Private account content</p>} />
        </Route>
      </Routes>
    </MemoryRouter>);
    expect(screen.getByText('Private account content')).toBeInTheDocument();
  });
});
