frappe.listview_settings["Item"] = {
	add_fields: [
		"item_name",
		"stock_uom",
		"item_group",
		"image",
		"has_variants",
		"end_of_life",
		"disabled",
		"variant_of",
		"is_stock_item",
		"is_fixed_asset",
		"is_sales_item",
		"is_purchase_item",
	],
	filters: [["disabled", "=", "0"]],
	// el buscador de abajo reemplaza al filtro por ID
	hide_name_filter: true,

	formatters: {
		is_fixed_asset: function (value, df, doc) {
			if (doc.is_fixed_asset) return __("Fixed Asset");
			if (doc.is_stock_item) return __("Stock");
			return __("Service");
		},

		is_sales_item: function (value, df, doc) {
			const sales = cint(doc.is_sales_item);
			const purchases = cint(doc.is_purchase_item);
			if (sales && purchases) return __("Sales & Purchase");
			if (sales) return __("Sales");
			if (purchases) return __("Purchase");
			return "—";
		},
	},

	onload: function (listview) {
		make_pos_like_search(listview);

		if (listview.view === "List") {
			listview.columns = listview.columns.map((col) => {
				if (!col.df) return col;
				const renames = {
					is_fixed_asset: __("Item Type"),
					is_sales_item: __("Purpose"),
					stock_uom: __("UOM"),
				};
				if (col.df.fieldname in renames) {
					return { ...col, df: { ...col.df, label: renames[col.df.fieldname] } };
				}
				return col;
			});
			listview.render_header(true);
		}
	},

	get_indicator: function (doc) {
		if (doc.disabled) {
			return [__("Disabled"), "grey", "disabled,=,Yes"];
		} else if (doc.end_of_life && doc.end_of_life < frappe.datetime.get_today()) {
			return [__("Expired"), "grey", "end_of_life,<,Today"];
		} else if (doc.has_variants) {
			return [__("Template"), "orange", "has_variants,=,Yes"];
		} else if (doc.variant_of) {
			return [__("Variant"), "green", "variant_of,=," + doc.variant_of];
		}
	},

	reports: [
		{
			name: "Stock Summary",
			route: "/app/stock-balance",
		},
		{
			name: "Stock Ledger",
			report_type: "Script Report",
		},
		{
			name: "Stock Balance",
			report_type: "Script Report",
		},
		{
			name: "Stock Projected Qty",
			report_type: "Script Report",
		},
	],
};

frappe.help.youtube_id["Item"] = "qXaEwld4_Ps";

// Mismo buscador del POS: varias palabras en cualquier orden sobre código, nombre,
// campos de búsqueda del POS y códigos de barras. Reemplaza a los buscadores por campo
// (ID y Nombre); cualquier otro campo sigue disponible desde Filtros.
function make_pos_like_search(listview) {
	const apply = frappe.utils.debounce(async (value) => {
		value = (value || "").trim();
		await listview.filter_area.remove("name");
		if (!value) return listview.refresh();

		const { message } = await frappe.call({
			method: "erpnext.stock.doctype.item.item_search.search_items_for_list",
			args: { search_term: value },
		});
		// sin coincidencias: un código imposible deja la lista vacía
		await listview.filter_area.add([["Item", "name", "in", message?.length ? message : ["\u0000"]]]);
	}, 400);

	const build = () => {
		const wrapper = listview.filter_area?.standard_filters_wrapper;
		const fields = listview.page.fields_dict;
		// los filtros estándar los crea el framework de forma asíncrona: esperar a que existan
		if (!wrapper || !wrapper.length || !fields.item_name) return false;

		fields.item_name.wrapper.remove();
		delete fields.item_name;

		const field = listview.page.add_field(
			{
				fieldtype: "Data",
				fieldname: "pos_like_search",
				label: __("Search Item"),
				placeholder: __("Search by code, name or barcode"),
				onchange: () => apply(field.get_value()),
			},
			wrapper
		);
		// fuera de fields_dict: el framework convierte cada campo ahí en un filtro de la consulta
		delete fields.pos_like_search;

		// en celular la sección de filtros estándar está oculta: el framework solo muestra ahí
		// la caja de ID, así que el buscador se mueve a ese hueco y vuelve al cambiar el ancho
		const mobile_query = window.matchMedia("(max-width: 767.98px)");
		const place = () => {
			const mobile_target = listview.filter_area.$mobile_id_filter;
			if (mobile_query.matches && mobile_target?.length) {
				mobile_target.prepend(field.wrapper);
				$(field.wrapper).css({ width: "100%", "max-width": "none" });
			} else {
				wrapper.prepend(field.wrapper);
				$(field.wrapper).css({ width: "", "max-width": "" });
			}
		};
		place();
		mobile_query.addEventListener("change", place);
		return true;
	};

	let attempts = 0;
	const timer = setInterval(() => {
		if (build() || ++attempts > 50) clearInterval(timer);
	}, 100);
}
