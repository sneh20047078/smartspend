from __future__ import annotations

import hashlib
import json
import uuid
from datetime import UTC, datetime

from app.group_repository import GroupRepository
from app.models.group import (
    GroupBalance,
    GroupCreate,
    GroupExpenseCreate,
    GroupExpenseRecord,
    GroupPatch,
    GroupRecord,
    GroupSettlement,
    GroupSettlementSummary,
)
from app.transaction_repository import VersionConflict


class GroupService:
    def __init__(self, repository: GroupRepository):
        self.repository = repository

    @staticmethod
    def _owner_member_id(owner_id: str, email_claim: str | None = None) -> str:
        if email_claim and email_claim.strip():
            return email_claim.strip().casefold()
        if owner_id.startswith(("local:", "usr:")):
            return owner_id.split(":", 1)[1]
        return owner_id

    @classmethod
    def _normalize_members(cls, owner_id: str, members: list[str], email_claim: str | None = None) -> list[str]:
        seen: set[str] = set()
        normalized: list[str] = []
        owner_email = cls._owner_member_id(owner_id, email_claim)
        for member in members:
            key = member.strip().casefold()
            if not key:
                continue
            if key not in seen:
                normalized.append(key)
                seen.add(key)
        if owner_email.casefold() not in seen:
            normalized.insert(0, owner_email.casefold())
        return normalized

    @staticmethod
    def _split_equal(amount_minor: int, members: list[str]) -> dict[str, int]:
        shares: dict[str, int] = {member: 0 for member in members}
        if not members:
            return shares
        base = amount_minor // len(members)
        remainder = amount_minor % len(members)
        for index, member in enumerate(members):
            shares[member] = base + (1 if index < remainder else 0)
        return shares

    def create(self, owner_id: str, payload: GroupCreate, idempotency_key: str, email_claim: str | None = None) -> GroupRecord:
        members = self._normalize_members(owner_id, payload.members, email_claim)
        record = GroupRecord(
            group_id=str(uuid.uuid4()),
            name=payload.name,
            description=payload.description,
            currency=payload.currency,
            members=members,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
            version=1,
        )
        canonical = json.dumps({**payload.model_dump(mode="json"), "members": members}, sort_keys=True, separators=(",", ":"))
        payload_hash = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        return self.repository.create(owner_id, record, idempotency_key, payload_hash)

    def get(self, owner_id: str, group_id: str) -> GroupRecord:
        return self.repository.get(owner_id, group_id)

    def list(self, owner_id: str) -> list[GroupRecord]:
        return self.repository.list(owner_id)

    def update(self, owner_id: str, group_id: str, patch: GroupPatch, email_claim: str | None = None) -> GroupRecord:
        current = self.repository.get(owner_id, group_id)
        if current.version != patch.expected_version:
            raise VersionConflict
        changes = patch.model_dump(exclude={"expected_version"}, exclude_unset=True)
        updated = current.model_copy(update={**changes, "updated_at": datetime.now(UTC), "version": current.version + 1})
        if "members" in changes:
            updated.members = self._normalize_members(owner_id, updated.members, email_claim)
        return self.repository.update(owner_id, updated, patch.expected_version)

    def delete(self, owner_id: str, group_id: str, expected_version: int) -> None:
        self.repository.delete(owner_id, group_id, expected_version)

    def create_expense(self, owner_id: str, group_id: str, payload: GroupExpenseCreate, idempotency_key: str) -> GroupExpenseRecord:
        group = self.repository.get(owner_id, group_id)
        if payload.currency != group.currency:
            raise ValueError("Expense currency must match the group currency")
        if payload.paid_by.casefold() not in {member.casefold() for member in group.members}:
            raise ValueError("The payer must be a member of the group")
        member_set = {member.casefold() for member in group.members}
        if payload.split_type == "equal":
            splits = self._split_equal(payload.amount_minor, group.members)
        else:
            if payload.splits is None:
                raise ValueError("Custom split expenses require a split map")
            splits = {member.casefold(): share for member, share in payload.splits.items()}
            if set(splits) != member_set:
                raise ValueError("Custom split amounts must cover every group member")
            if sum(splits.values()) != payload.amount_minor:
                raise ValueError("Custom split values must add up to the total amount")
        record = GroupExpenseRecord(
            expense_id=str(uuid.uuid4()),
            group_id=group_id,
            description=payload.description,
            amount_minor=payload.amount_minor,
            currency=payload.currency,
            paid_by=payload.paid_by.casefold(),
            split_type=payload.split_type,
            splits=splits,
            occurred_at=payload.occurred_at.astimezone(UTC),
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
            version=1,
        )
        canonical = json.dumps({
            "description": payload.description,
            "amount_minor": payload.amount_minor,
            "currency": payload.currency,
            "paid_by": payload.paid_by.casefold(),
            "split_type": payload.split_type,
            "splits": splits,
            "occurred_at": payload.occurred_at.astimezone(UTC).isoformat(),
        }, sort_keys=True, separators=(",", ":"))
        payload_hash = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        return self.repository.create_expense(owner_id, group_id, record, idempotency_key, payload_hash)

    def list_expenses(self, owner_id: str, group_id: str) -> list[GroupExpenseRecord]:
        self.repository.get(owner_id, group_id)
        return self.repository.list_expenses(owner_id, group_id)

    def settlement_summary(self, owner_id: str, group_id: str) -> GroupSettlementSummary:
        """Calculate member net balances and generate a minimal debt settlement plan.

        Algorithm: Greedy Bipartite Debt Simplification (Cash Flow Minimization)
        -----------------------------------------------------------------------
        1. Net Balance Calculation:
           - Iterate over all group expenses:
             * Credit the payer by amount_minor: balances[paid_by] += amount_minor
             * Debit each participant by their share: balances[member] -= share
           - The sum of all net balances is strictly conserved and equals 0.

        2. Greedy Two-Pointer Netting:
           - Partition members into debtors (balance < 0) and creditors (balance > 0).
           - Sort deterministically by member ID for stable, reproducible settlement plans.
           - Greedily transfer min(|debtor_balance|, creditor_balance) between the current debtor
             and creditor until all debts are fully cleared.

        Complexity & Trade-offs:
        ------------------------
        - Time Complexity: O(E + M log M), where E is the number of expenses and M is the
          number of group members. Sorting dominates the settlement phase.
        - Space Complexity: O(M) auxiliary space to store balances and settlement transfers.
        - Theoretical Optimality: Finding the absolute minimum number of settlement transactions
          is NP-complete (reducible to the Subset Sum Problem). The greedy heuristic guarantees
          at most (M - 1) transactions and runs in O(M log M) time, making it the industry standard
          for peer-to-peer expense simplification (e.g., Splitwise).
        """
        group = self.repository.get(owner_id, group_id)
        expenses = self.repository.list_expenses(owner_id, group_id)
        balances: dict[str, int] = {member: 0 for member in group.members}
        for expense in expenses:
            balances[expense.paid_by] = balances.get(expense.paid_by, 0) + expense.amount_minor
            for member, share in expense.splits.items():
                balances[member] = balances.get(member, 0) - share
        entries = [GroupBalance(member_id=member, net_minor=balances.get(member, 0)) for member in group.members]
        debtors = sorted([(member, amount) for member, amount in balances.items() if amount < 0], key=lambda item: item[0])
        creditors = sorted([(member, amount) for member, amount in balances.items() if amount > 0], key=lambda item: item[0])
        settlements: list[GroupSettlement] = []
        for debtor_member, debtor_amount in debtors:
            remaining = abs(debtor_amount)
            for index, (creditor_member, creditor_amount) in enumerate(creditors):
                if remaining <= 0:
                    break
                if creditor_amount <= 0:
                    continue
                transfer = min(remaining, creditor_amount)
                if transfer > 0:
                    settlements.append(GroupSettlement(from_member=debtor_member, to_member=creditor_member, amount_minor=transfer))
                    remaining -= transfer
                    creditors[index] = (creditor_member, creditor_amount - transfer)
        return GroupSettlementSummary(
            group_id=group_id,
            currency=group.currency,
            members=group.members,
            balances=entries,
            settlements=settlements,
            expenses=expenses,
        )
