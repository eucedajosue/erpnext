from frappe import _


def get_data():
	return {
		"fieldname": "prevdoc_docname",
		"non_standard_fieldnames": {
			"Auto Repeat": "reference_document",
		},
		"internal_links": {
			"Sales Invoice": ["items", "prevdoc_docname"],
		},
		"transactions": [
			{"label": _("Sales Order"), "items": ["Sales Order"]},
			{"label": _("Billing"), "items": ["Sales Invoice"]},
			{"label": _("Subscription"), "items": ["Auto Repeat"]},
		],
	}
