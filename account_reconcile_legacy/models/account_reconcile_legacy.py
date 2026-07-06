# Copyright 2026 Ane Gurruchaga - AvanzOSC
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl.html).

from odoo import Command, api, fields, models
from odoo.tools.misc import formatLang


class AccountReconcileLegacy(models.AbstractModel):
    _name = "account.reconcile.legacy"
    _description = "Classic account reconciliation helpers"

    @api.model
    def get_manual_groups(self, limit=50):
        line_model = self.env["account.move.line"]
        domain = self._get_unreconciled_domain()
        grouped_accounts = line_model.read_group(
            domain,
            ["account_id"],
            ["account_id"],
            limit=limit,
            orderby="account_id",
        )
        groups = []
        for grouped_account in grouped_accounts:
            account = grouped_account.get("account_id")
            if not account:
                continue
            line = line_model.search(
                domain + [("account_id", "=", account[0])],
                limit=1,
                order="date desc, id desc",
            )
            if not line:
                continue
            groups.append(
                {
                    "id": str(line.account_id.id),
                    "account_id": [
                        line.account_id.id,
                        line.account_id.display_name,
                    ],
                    "accountLabel": line.account_id.display_name,
                    "amountLabel": self._format_amount(
                        line.amount_residual,
                        line.company_currency_id,
                    ),
                    "amountRaw": line.amount_residual,
                    "currencyName": line.company_currency_id.name,
                    "date": fields.Date.to_string(line.date),
                    "mainLineId": line.id,
                    "partner_id": (
                        [line.partner_id.id, line.partner_id.display_name]
                        if line.partner_id
                        else False
                    ),
                    "displayName": line.account_id.display_name,
                    "label": (
                        line.name
                        or line.ref
                        or line.move_name
                        or line.move_id.display_name
                    ),
                    "lineCount": grouped_account.get("account_id_count", 0),
                }
            )
        return groups

    @api.model
    def get_manual_lines(self, group):
        account_id = self._get_relational_id(group.get("account_id"))
        domain = self._get_unreconciled_domain(account_id=account_id)
        lines = self.env["account.move.line"].search(
            domain,
            limit=80,
            order="date desc, id desc",
        )
        return [self._format_line(line) for line in lines]

    @api.model
    def reconcile_manual_lines(self, line_ids, form=None):
        form = form or {}
        line_ids = [line_id for line_id in line_ids if isinstance(line_id, int)]
        lines = self.env["account.move.line"].browse(line_ids).exists()
        if len(lines) < 2:
            return False
        wizard = self.env["account.reconcile.wizard"].create(
            self._prepare_wizard_values(lines, form)
        )
        wizard.reconcile()
        return True

    def _get_unreconciled_domain(self, account_id=False, partner_id=None):
        domain = [
            ("parent_state", "=", "posted"),
            ("amount_residual", "!=", 0),
            ("account_id.reconcile", "=", True),
            ("full_reconcile_id", "=", False),
        ]
        if account_id:
            domain.append(("account_id", "=", account_id))
        if partner_id is not None:
            domain.append(("partner_id", "=", partner_id or False))
        return domain

    def _format_line(self, line):
        return {
            "id": line.id,
            "account_id": [line.account_id.id, line.account_id.display_name],
            "amountRaw": line.amount_residual,
            "amountLabel": self._format_amount(
                line.amount_residual,
                line.company_currency_id,
            ),
            "currencyName": line.company_currency_id.name,
            "date": fields.Date.to_string(line.date),
            "label": (
                line.name or line.ref or line.move_name or line.move_id.display_name
            ),
            "move_id": [line.move_id.id, line.move_id.display_name],
            "move_name": line.move_name,
            "partner_id": (
                [line.partner_id.id, line.partner_id.display_name]
                if line.partner_id
                else False
            ),
            "ref": line.ref,
        }

    def _format_amount(self, amount, currency):
        return formatLang(
            self.env,
            amount,
            currency_obj=currency,
        )

    def _prepare_wizard_values(self, lines, form):
        values = {
            "move_line_ids": [Command.set(lines.ids)],
            "allow_partials": False,
        }
        account = self._get_record_from_form("account.account", form.get("accountId"))
        journal = self._get_record_from_form("account.journal", form.get("journalId"))
        tax = self._get_record_from_form("account.tax", form.get("taxId"))
        partner = self._get_record_from_form("res.partner", form.get("partnerId"))
        if account:
            values["account_id"] = account.id
        if journal:
            values["journal_id"] = journal.id
        if tax:
            values["tax_id"] = tax.id
        if partner:
            values["to_partner_id"] = partner.id
        if form.get("label"):
            values["label"] = form["label"]
        if form.get("writeoffDate"):
            values["date"] = form["writeoffDate"]
        return values

    def _get_record_from_form(self, model, record_id):
        if not record_id:
            return self.env[model]
        return self.env[model].browse(record_id).exists()

    def _get_relational_id(self, value):
        if isinstance(value, list):
            return value[0] if value else False
        return value or False
