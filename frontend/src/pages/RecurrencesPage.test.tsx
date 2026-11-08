import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecurrencesPage } from './RecurrencesPage';

const { useAuthMock, listMock, updateMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  listMock: vi.fn(),
  updateMock: vi.fn(),
}));

vi.mock('../auth/AuthContext', () => ({ useAuth: useAuthMock }));
vi.mock('../lib/finance', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/finance')>();
  return {
    ...actual,
    financeApi: {
      listRecurrences: listMock,
      updateRecurrence: updateMock,
    },
  };
});

const schedule = {
  schedule_id: 'schedule-1', description: 'Rent', amount_minor: 150000, currency: 'USD', category: 'housing',
  notes: null, payment_method: null, frequency: 'monthly' as const, interval: 1,
  starts_on: '2026-11-01', ends_on: null, next_occurrence_on: '2026-12-01', enabled: true,
  created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', version: 1,
};

beforeEach(() => {
  useAuthMock.mockReset().mockReturnValue({ token: 'local-token', user: { preferred_currency: 'USD' } });
  listMock.mockReset().mockResolvedValue([schedule]);
  updateMock.mockReset().mockResolvedValue({ ...schedule, enabled: false, version: 2 });
});

describe('recurring expenses page', () => {
  it('lists schedules and pauses one with optimistic versioning', async () => {
    const user = userEvent.setup();
    render(<RecurrencesPage />);
    expect(await screen.findByText('Rent')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith('local-token', 'schedule-1', { expected_version: 1, enabled: false }));
  });
});
