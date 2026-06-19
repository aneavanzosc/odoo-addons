# Copyright 2025 Ane Gurruchaga - AvanzOSC
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

from odoo import fields, models


class CreateProductPricelistItemDiscounts(models.TransientModel):
    _name = "create.pricelist.item.discount"
    _description = "Wizard to apply pricelist item discounts"

    discount = fields.Float(string="Discount", required=True)
    positive = fields.Boolean(string="Positive", help="Apply increment on price")
    price = fields.Boolean(string="Price", default=True)
    pvp = fields.Boolean(string="PVP")
    distribution_price = fields.Boolean(string="Distribution Price")

    def _get_discount_price_fields(self):
        self.ensure_one()
        return [
            (self.price, "fixed_price"),
            (self.pvp, "pvp_price"),
            (self.distribution_price, "distribution_price"),
        ]

    def button_apply_discounts(self):
        self.ensure_one()
        selected_ids = self.env.context.get("active_ids", [])
        price_fields = [
            price_field
            for apply_discount, price_field in self._get_discount_price_fields()
            if apply_discount
        ]
        item_ids = self.env["product.pricelist.item"].browse(selected_ids)
        item_ids.apply_discount(
            self.discount, positive=self.positive, price_fields=price_fields
        )
