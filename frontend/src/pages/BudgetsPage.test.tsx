import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ApiError } from '../lib/api';
import { BudgetsPage } from './BudgetsPage';

const { useAuthMock, listBudgetsMock, createBudgetMock, updateBudgetMock, deleteBudgetMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  listBudgetsMock: vi.fn(),
  createBudgetMock: vi.fn(),
  updateBudgetMock: vi.fn(),
  deleteBudgetMock: vi.fn(),
}));

vi.mock('../auth/AuthContext', () => ({ useAuth: useAuthMock }));
vi.mock('../lib/finance', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/finance')>();
  return {
    ...actual,
    financeApi: {
      ...actual.financeApi,
      listBudgets: listBudgetsMock,
      createBudget: createBudgetMock,
      updateBudget: updateBudgetMock,
      deleteBudget: deleteBudgetMock,
    },
  };
});

const savedBudget = {
  budget_id: 'budget-123', name: 'October plan', period_type: 'monthly' as const,
  start_date: '2026-10-01', end_date: '2026-10-31', currency: 'USD', total_limit_minor: 5000,
  category_limits: { groceries: 4000 }, alert_threshold_percent: 80, version: 3,
  categories: [
    { category: 'all spending', limit_minor: 5000, spent_minor: 3500, remaining_minor: 1500, percent_used: 70, threshold_reached: false },
    { category: 'groceries', limit_minor: 4000, spent_minor: 3400, remaining_minor: 600, percent_used: 85, threshold_reached: true },
  ],
};

function renderPage() {
  return render(<MemoryRouter><BudgetsPage /></MemoryRouter>);
}

beforeEach(() => {
  useAuthMock.mockReset().mockReturnValue({
    token: 'test-token',
    user: { email: 'sam@example.com', display_name: 'Sam', preferred_currency: 'USD', timezone: 'UTC', theme: 'light' },
  });
  listBudgetsMock.mockReset().mockResolvedValue({ items: [] });
  createBudgetMock.mockReset().mockResolvedValue({});
  updateBudgetMock.mockReset().mockResolvedValue({});
  deleteBudgetMock.mockReset().mockResolvedValue(undefined);
});

describe('budgets page', () => {
  it('shows saved progress and the configured threshold warning', async () => {
    listBudgetsMock.mockResolvedValue({ items: [savedBudget] });
    renderPage();

    expect(await screen.findByRole('heading', { name: 'October plan' })).toBeInTheDocument();
    expect(screen.getByText('85% used')).toBeInTheDocument();
    expect(screen.getByText('80% alert threshold reached')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'groceries budget usage' })).toHaveAttribute('aria-valuenow', '85');
  });

  it('creates a monthly budget with integer minor units and an idempotency key', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('crypto', { randomUUID: () => 'test-budget-idempotency-0001' });
    renderPage();
    expect(await screen.findByText('No budgets yet')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create your first budget' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Budget name'), 'October plan');
    await user.type(within(dialog).getByLabelText('Overall limit (USD, optional)'), '25.00');
    await user.click(within(dialog).getByRole('button', { name: 'Create budget' }));

    await waitFor(() => expect(createBudgetMock).toHaveBeenCalledWith(
      'test-token',
      expect.objectContaining({
        name: 'October plan', period_type: 'monthly', currency: 'USD', total_limit_minor: 2500,
        category_limits: {}, alert_threshold_percent: 80,
        start_date: expect.stringMatching(/^\d{4}-\d{2}-01$/),
        end_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
      'test-budget-idempotency-0001',
    ));
    vi.unstubAllGlobals();
  });

  it('uses the current version and explains a stale edit conflict', async () => {
    const user = userEvent.setup();
    listBudgetsMock.mockResolvedValue({ items: [savedBudget] });
    updateBudgetMock.mockRejectedValue(new ApiError('Budget changed since it was loaded; refresh and retry', 409));
    renderPage();
    await screen.findByRole('heading', { name: 'October plan' });
    await user.click(screen.getByRole('button', { name: 'Edit October plan' }));
    const dialog = screen.getByRole('dialog');
    const totalLimit = within(dialog).getByLabelText('Overall limit (USD, optional)');
    await user.clear(totalLimit);
    await user.type(totalLimit, '40.00');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updateBudgetMock).toHaveBeenCalledWith('test-token', 'budget-123', expect.objectContaining({
      expected_version: 3, total_limit_minor: 4000, name: 'October plan',
    })));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Budget changed since it was loaded; refresh and retry');
  });

  it('confirms deletion and sends the latest version', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('confirm', () => true);
    listBudgetsMock.mockResolvedValue({ items: [savedBudget] });
    renderPage();
    await screen.findByRole('heading', { name: 'October plan' });
    await user.click(screen.getByRole('button', { name: 'Delete October plan' }));
    await waitFor(() => expect(deleteBudgetMock).toHaveBeenCalledWith('test-token', 'budget-123', 3));
    vi.unstubAllGlobals();
  });
});
