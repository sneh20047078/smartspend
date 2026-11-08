import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReportsPage } from './ReportsPage';

const { useAuthMock, dashboardMock, listMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  dashboardMock: vi.fn(),
  listMock: vi.fn(),
}));

vi.mock('../auth/AuthContext', () => ({ useAuth: useAuthMock }));
vi.mock('../lib/finance', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/finance')>();
  return {
    ...actual,
    financeApi: {
      dashboard: dashboardMock,
      listTransactions: listMock,
    },
  };
});

const summary = {
  range_start: '2026-10-01', range_end: '2026-10-05', timezone: 'UTC',
  currencies: [{ currency: 'USD', income_minor: 125000, expense_minor: 3100, balance_minor: 121900 }],
  category_totals: [{ currency: 'USD', category: 'groceries', expense_minor: 3100 }],
  monthly_trend: [{ month: '2026-10', currency: 'USD', income_minor: 125000, expense_minor: 3100 }],
  recent_transactions: [],
};

const transaction = {
  transaction_id: 'txn-123', kind: 'expense' as const, amount_minor: 3100, currency: 'USD', category: 'groceries',
  occurred_at: '2026-10-05T12:00:00Z', notes: 'Market', payment_method: 'card' as const,
  created_at: '2026-10-05T12:00:00Z', updated_at: '2026-10-05T12:00:00Z', version: 1,
};

beforeEach(() => {
  useAuthMock.mockReset().mockReturnValue({ token: 'owner-token' });
  dashboardMock.mockReset().mockResolvedValue(summary);
  listMock.mockReset().mockResolvedValue({ items: [transaction], next_cursor: null });
});

describe('reports page', () => {
  it('loads owner-scoped report totals and transaction preview', async () => {
    render(<ReportsPage />);
    expect(await screen.findByText('Monthly cash flow')).toBeInTheDocument();
    expect(screen.getAllByText('groceries')).toHaveLength(2);
    expect(screen.getByText('Market')).toBeInTheDocument();
    expect(dashboardMock).toHaveBeenCalledWith('owner-token', expect.any(String), expect.any(String));
    expect(listMock).toHaveBeenCalledWith('owner-token', expect.objectContaining({ limit: 100 }));
  });

  it('follows transaction cursors for a complete export and downloads fresh owner records', async () => {
    const user = userEvent.setup();
    const nextTransaction = { ...transaction, transaction_id: 'txn-456', notes: '=1+1' };
    listMock.mockResolvedValueOnce({ items: [transaction], next_cursor: null })
      .mockResolvedValueOnce({ items: [transaction], next_cursor: 'cursor-2' })
      .mockResolvedValueOnce({ items: [nextTransaction], next_cursor: null });
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:report'), revokeObjectURL: vi.fn() });
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    render(<ReportsPage />);
    await screen.findByText('Monthly cash flow');
    await user.click(screen.getAllByRole('button', { name: 'Export CSV' })[0]);

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Exported 2 of your transactions as CSV.'));
    expect(listMock).toHaveBeenNthCalledWith(3, 'owner-token', expect.objectContaining({ cursor: 'cursor-2', limit: 100 }));
    anchorClick.mockRestore();
    vi.unstubAllGlobals();
  });
});
