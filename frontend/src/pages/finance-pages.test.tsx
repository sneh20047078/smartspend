import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { DashboardPage } from './DashboardPage';
import { TransactionsPage } from './TransactionsPage';

const { useAuthMock, listMock, createMock, updateMock, deleteMock, dashboardMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  listMock: vi.fn(),
  createMock: vi.fn(),
  updateMock: vi.fn(),
  deleteMock: vi.fn(),
  dashboardMock: vi.fn(),
}));

vi.mock('../auth/AuthContext', () => ({ useAuth: useAuthMock }));
vi.mock('../lib/finance', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/finance')>();
  return {
    ...actual,
    financeApi: {
      listTransactions: listMock,
      createTransaction: createMock,
      updateTransaction: updateMock,
      deleteTransaction: deleteMock,
      dashboard: dashboardMock,
    },
  };
});

function renderInRouter(element: ReactNode) {
  return render(<MemoryRouter>{element}</MemoryRouter>);
}

const emptySummary = {
  range_start: '2026-10-01', range_end: '2026-10-05', timezone: 'UTC',
  currencies: [], category_totals: [], monthly_trend: [], recent_transactions: [],
};

beforeEach(() => {
  useAuthMock.mockReset().mockReturnValue({
    token: 'test-token',
    user: { email: 'sam@example.com', display_name: 'Sam', preferred_currency: 'USD', timezone: 'UTC', theme: 'light' },
  });
  listMock.mockReset().mockResolvedValue({ items: [], next_cursor: null });
  createMock.mockReset().mockResolvedValue({});
  updateMock.mockReset().mockResolvedValue({});
  deleteMock.mockReset().mockResolvedValue(undefined);
  dashboardMock.mockReset().mockResolvedValue(emptySummary);
});

describe('transactions page', () => {
  it('shows a meaningful empty state and applies text filters to the API request', async () => {
    const user = userEvent.setup();
    renderInRouter(<TransactionsPage />);
    expect(await screen.findByText('No transactions found')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Search'), 'team lunch');
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));
    await waitFor(() => expect(listMock).toHaveBeenLastCalledWith('test-token', expect.objectContaining({ search: 'team lunch', limit: 20 })));
  });

  it('submits a transaction form using integer minor units and an idempotency key', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('crypto', { randomUUID: () => 'test-idempotency-key-0001' });
    renderInRouter(<TransactionsPage />);
    await screen.findByText('No transactions found');
    await user.click(screen.getAllByRole('button', { name: 'Add transaction' })[0]);
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Amount (USD)'), '12.50');
    await user.type(within(dialog).getByLabelText('Category'), 'Food');
    await user.click(within(dialog).getByRole('button', { name: 'Add transaction' }));

    await waitFor(() => expect(createMock).toHaveBeenCalledWith(
      'test-token',
      expect.objectContaining({ kind: 'expense', amount_minor: 1250, currency: 'USD', category: 'food' }),
      'test-idempotency-key-0001',
    ));
    vi.unstubAllGlobals();
  });

  it('edits a loaded transaction using its version for optimistic concurrency', async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue({
      items: [{
        transaction_id: 'txn-123', kind: 'expense', amount_minor: 1500, currency: 'USD', category: 'food',
        occurred_at: '2026-10-05T12:00:00Z', notes: 'Lunch', payment_method: 'card',
        created_at: '2026-10-05T12:00:00Z', updated_at: '2026-10-05T12:00:00Z', version: 4,
      }],
      next_cursor: null,
    });
    renderInRouter(<TransactionsPage />);
    await screen.findByText('Lunch');
    await user.click(screen.getByRole('button', { name: 'Edit food' }));
    const dialog = screen.getByRole('dialog');
    const amount = within(dialog).getByLabelText('Amount (USD)');
    await user.clear(amount);
    await user.type(amount, '15.50');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updateMock).toHaveBeenCalledWith(
      'test-token', 'txn-123', expect.objectContaining({ expected_version: 4, amount_minor: 1550, category: 'food' }),
    ));
  });

  it('requires confirmation and sends the current version when deleting', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('confirm', () => true);
    listMock.mockResolvedValue({
      items: [{
        transaction_id: 'txn-456', kind: 'expense', amount_minor: 300, currency: 'USD', category: 'coffee',
        occurred_at: '2026-10-05T12:00:00Z', notes: null, payment_method: null,
        created_at: '2026-10-05T12:00:00Z', updated_at: '2026-10-05T12:00:00Z', version: 2,
      }],
      next_cursor: null,
    });
    renderInRouter(<TransactionsPage />);
    await screen.findByRole('button', { name: 'Delete coffee' });
    await user.click(screen.getByRole('button', { name: 'Delete coffee' }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('test-token', 'txn-456', 2));
    vi.unstubAllGlobals();
  });
});

describe('dashboard states', () => {
  it('shows a data-backed empty state when no transactions exist', async () => {
    renderInRouter(<DashboardPage />);
    expect(await screen.findByText('No activity in this date range')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add a transaction' })).toHaveAttribute('href', '/transactions');
  });

  it('renders currency-separated totals and a trend for returned records', async () => {
    dashboardMock.mockResolvedValue({
      ...emptySummary,
      currencies: [{ currency: 'USD', income_minor: 125000, expense_minor: 3100, balance_minor: 121900 }],
      category_totals: [{ currency: 'USD', category: 'groceries', expense_minor: 3100 }],
      monthly_trend: [{ month: '2026-10', currency: 'USD', income_minor: 125000, expense_minor: 3100 }],
    });
    renderInRouter(<DashboardPage />);
    expect(await screen.findByText('Income & expenses over time')).toBeInTheDocument();
    expect(screen.getByText('$1,250.00')).toBeInTheDocument();
    expect(screen.getAllByText('$31.00').length).toBeGreaterThan(0);
    expect(screen.getByText('groceries')).toBeInTheDocument();
  });
});
