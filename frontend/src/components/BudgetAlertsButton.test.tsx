import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { BudgetAlertsButton } from './BudgetAlertsButton';

const { useAuthMock, listBudgetsMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  listBudgetsMock: vi.fn(),
}));

vi.mock('../auth/AuthContext', () => ({ useAuth: useAuthMock }));
vi.mock('../lib/finance', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/finance')>();
  return { ...actual, financeApi: { listBudgets: listBudgetsMock } };
});

beforeEach(() => {
  useAuthMock.mockReset().mockReturnValue({ token: 'local-token' });
  listBudgetsMock.mockReset().mockResolvedValue({ items: [{
    budget_id: 'budget-1', name: 'Monthly plan', currency: 'USD', alert_threshold_percent: 80,
    categories: [{ category: 'groceries', percent_used: 95, threshold_reached: true }],
  }] });
});

describe('budget alert center', () => {
  it('loads active threshold alerts and lets the user dismiss one in the current view', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><BudgetAlertsButton /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: 'No budget alerts' }));
    expect(await screen.findByText('Monthly plan · 95% used · USD')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Dismiss groceries alert' }));
    expect(await screen.findByText('You’re all caught up')).toBeInTheDocument();
  });
});
