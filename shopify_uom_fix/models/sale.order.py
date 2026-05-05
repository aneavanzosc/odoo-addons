from odoo import models


class SaleOrder(models.Model):
    _inherit = "sale.order"

    def shopify_create_sale_order_line(
        self,
        line,
        product,
        quantity,
        product_name,
        price,
        order_response,
        is_shipping=False,
        previous_line=False,
        is_discount=False,
        is_duties=False,
    ):
        order_line = super().shopify_create_sale_order_line(
            line,
            product,
            quantity,
            product_name,
            price,
            order_response,
            is_shipping=is_shipping,
            previous_line=previous_line,
            is_discount=is_discount,
            is_duties=is_duties,
        )

        if order_line and product and order_line.product_uom != product.uom_id:
            order_line.product_uom = product.uom_id.id

        return order_line
