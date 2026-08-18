# Copyright (c) 2015, Frappe Technologies Pvt. Ltd. and Contributors
# License: GNU General Public License v3. See license.txt


import json

import frappe
from frappe import _
from frappe.utils import cint, cstr, flt, getdate

from erpnext.stock.doctype.item.item import get_last_purchase_details, validate_end_of_life


def update_last_purchase_rate(doc, is_submit) -> None:
	"""updates last_purchase_rate in item table for each item"""

	if doc.get("is_internal_supplier"):
		return

	this_purchase_date = getdate(doc.get("posting_date") or doc.get("transaction_date"))

	for d in doc.get("items"):
		if d.get("is_free_item"):
			continue

		# get last purchase details
		last_purchase_details = get_last_purchase_details(d.item_code, doc.name)

		# compare last purchase date and this transaction's date
		last_purchase_rate = None
		if last_purchase_details and (
			doc.get("docstatus") == 2 or last_purchase_details.purchase_date > this_purchase_date
		):
			last_purchase_rate = last_purchase_details["base_net_rate"]
		elif is_submit == 1:
			# even if this transaction is the latest one, it should be submitted
			# for it to be considered for latest purchase rate
			if flt(d.conversion_factor):
				last_purchase_rate = flt(d.base_net_rate) / flt(d.conversion_factor)
			# Check if item code is present
			# Conversion factor should not be mandatory for non itemized items
			elif d.item_code:
				frappe.throw(_("UOM Conversion factor is required in row {0}").format(d.idx))

		# update last purchsae rate
		frappe.db.set_value("Item", d.item_code, "last_purchase_rate", flt(last_purchase_rate))

		# actualiza el campo custom_valuation_rate
		frappe.db.set_value("Item", d.item_code, "custom_valuation_rate_top", flt(last_purchase_rate))
		frappe.db.set_value("Item", d.item_code, "valuation_rate", flt(last_purchase_rate))

		# Mantener el margen consistente con el cálculo realizado en el formulario de Item.
		standard_rate = flt(frappe.db.get_value("Item", d.item_code, "standard_rate"))
		sales_tax_rate = get_sales_tax_rate(d.item_code)
		tax_multiplier = 1 + (sales_tax_rate / 100)
		net_selling_rate = standard_rate / tax_multiplier if tax_multiplier > 0 else standard_rate
		profit_margin = (
			(1 - (flt(last_purchase_rate) / net_selling_rate)) * 100 if net_selling_rate > 0 else 0
		)
		frappe.db.set_value("Item", d.item_code, "custom_profit_margin", flt(profit_margin))
		# actualizar el precio de compra en la lista de precios
		update_buying_price_list_rate(doc, d, last_purchase_rate)
  


def get_sales_tax_rate(item_code: str) -> float:
	"""Return the combined rate from the item's assigned tax templates."""

	template_names = set(
		frappe.get_all(
			"Item Tax",
			filters={"parent": item_code, "parenttype": "Item"},
			pluck="item_tax_template",
		)
	)
	if not template_names:
		return 0

	tax_rates = frappe.get_all(
		"Item Tax Template Detail",
		filters={"parent": ["in", list(template_names)]},
		pluck="tax_rate",
	)
	return sum(flt(tax_rate) for tax_rate in tax_rates)


def update_buying_price_list_rate(doc, item_row, base_purchase_rate: float) -> None:
	"""Upsert purchase price into Item Price for the buying price list."""

	if not item_row.get("item_code"):
		return

	buying_price_list = doc.get("buying_price_list") or frappe.db.get_single_value(
		"Buying Settings", "buying_price_list"
	)
	if not buying_price_list:
		return

	price_list_currency = frappe.db.get_value("Price List", buying_price_list, "currency")
	if not price_list_currency:
		return

	stock_uom = frappe.db.get_value("Item", item_row.item_code, "stock_uom")
	if not stock_uom:
		return

	company_currency = None
	if doc.get("company"):
		company_currency = frappe.get_cached_value("Company", doc.company, "default_currency")

	price_list_rate = 0.0
	if price_list_currency == doc.get("currency"):
		conversion_factor = flt(item_row.get("conversion_factor"))
		if conversion_factor:
			price_list_rate = flt(item_row.get("net_rate") or item_row.get("rate")) / conversion_factor
	elif company_currency and price_list_currency == company_currency:
		price_list_rate = flt(base_purchase_rate)

	if not price_list_rate:
		return

	existing_item_price = frappe.db.get_value(
		"Item Price",
		{
			"item_code": item_row.item_code,
			"price_list": buying_price_list,
			"currency": price_list_currency,
			"uom": stock_uom,
		},
		"name",
	)

	if existing_item_price:
		frappe.db.set_value("Item Price", existing_item_price, "price_list_rate", flt(price_list_rate))
		return

	frappe.get_doc(
		{
			"doctype": "Item Price",
			"item_code": item_row.item_code,
			"price_list": buying_price_list,
			"price_list_rate": flt(price_list_rate),
			"currency": price_list_currency,
			"uom": stock_uom,
		}
	).insert(ignore_permissions=True)


def validate_for_items(doc) -> None:
	items = []
	for d in doc.get("items"):
		set_stock_levels(row=d)  # update with latest quantities
		item = validate_item_and_get_basic_data(row=d)
		validate_stock_item_warehouse(row=d, item=item)
		validate_end_of_life(d.item_code, item.end_of_life, item.disabled)

		items.append(cstr(d.item_code))

	if (
		items
		and len(items) != len(set(items))
		and not cint(frappe.db.get_single_value("Buying Settings", "allow_multiple_items") or 0)
	):
		frappe.throw(_("Same item cannot be entered multiple times."))


def set_stock_levels(row) -> None:
	projected_qty = frappe.db.get_value(
		"Bin",
		{
			"item_code": row.item_code,
			"warehouse": row.warehouse,
		},
		"projected_qty",
	)

	qty_data = {
		"projected_qty": flt(projected_qty),
		"ordered_qty": 0,
		"received_qty": 0,
	}
	if row.doctype in ("Purchase Receipt Item", "Purchase Invoice Item"):
		qty_data.pop("received_qty")

	for field in qty_data:
		if row.meta.get_field(field):
			row.set(field, qty_data[field])


def validate_item_and_get_basic_data(row) -> dict:
	item = frappe.db.get_values(
		"Item",
		filters={"name": row.item_code},
		fieldname=["is_stock_item", "is_sub_contracted_item", "end_of_life", "disabled"],
		as_dict=1,
	)
	if not item:
		frappe.throw(_("Row #{0}: Item {1} does not exist").format(row.idx, frappe.bold(row.item_code)))

	return item[0]


def validate_stock_item_warehouse(row, item) -> None:
	if item.is_stock_item == 1 and row.qty and not row.warehouse and not row.get("delivered_by_supplier"):
		frappe.throw(
			_("Row #{1}: Warehouse is mandatory for stock Item {0}").format(
				frappe.bold(row.item_code), row.idx
			)
		)


def check_on_hold_or_closed_status(doctype, docname) -> None:
	status = frappe.db.get_value(doctype, docname, "status")

	if status in ("Closed", "On Hold"):
		frappe.throw(
			_("{0} {1} status is {2}.").format(
				frappe.bold(_(doctype)),
				frappe.bold(docname),
				frappe.bold(_(status)),
			),
			frappe.InvalidStatusError,
		)


@frappe.whitelist()
def get_linked_material_requests(items):
	items = json.loads(items)
	mr_list = []
	for item in items:
		material_request = frappe.db.sql(
			"""SELECT distinct mr.name AS mr_name,
				(mr_item.qty - mr_item.ordered_qty) AS qty,
				mr_item.item_code AS item_code,
				mr_item.name AS mr_item
			FROM `tabMaterial Request` mr, `tabMaterial Request Item` mr_item
			WHERE mr.name = mr_item.parent
				AND mr_item.item_code = %(item)s
				AND mr.material_request_type = 'Purchase'
				AND mr.per_ordered < 99.99
				AND mr.docstatus = 1
				AND mr.status != 'Stopped'
                        ORDER BY mr_item.item_code ASC""",
			{"item": item},
			as_dict=1,
		)
		if material_request:
			mr_list.append(material_request)

	return mr_list
