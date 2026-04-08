import onScan from "onscan.js";

erpnext.PointOfSale.ItemSelector = class {
	// eslint-disable-next-line no-unused-vars
	constructor({ frm, wrapper, events, pos_profile, settings }) {
		this.wrapper = wrapper;
		this.events = events;
		this.pos_profile = pos_profile;
		this.hide_images = settings.hide_images;
		this.item_display_class = this.hide_images ? "hide-item-image" : "show-item-image";
		this.auto_add_item = settings.auto_add_item_to_cart;

		this.item_ready_group = this.get_parent_item_group();
		this.inti_component();
	}

	inti_component() {
		this.prepare_dom();
		this.make_search_bar();
		this.load_items_data();
		this.bind_events();
		this.attach_shortcuts();
	}

	prepare_dom() {
		this.wrapper.append(
			`<section class="items-selector">
				<div class="filter-section">
					<div class="search-field"></div>
					<div class="filter-right">
						<div class="item-group-field"></div>
						<div class="label">${__("Ver Todos")}</div>
					</div>
				</div>
				<div class="groups-container show-item-image" style="display:none;"></div>
				<div class="items-container"></div>
			</section>`
		);

		this.$component = this.wrapper.find(".items-selector");
		this.$items_container = this.$component.find(".items-container");
		this.$groups_container = this.$component.find(".groups-container");
		this.$items_container.addClass(this.item_display_class);
	}

	async get_parent_item_group() {
		const r = await frappe.call({
			method: "erpnext.selling.page.point_of_sale.point_of_sale.get_parent_item_group",
			args: {
				pos_profile: this.pos_profile,
			},
		});
		if (r.message) this.item_group = this.parent_item_group = r.message;
	}

	async load_items_data() {
		await this.item_ready_group;

		this.start_item_loading_animation();

		if (!this.price_list) {
			const res = await frappe.db.get_value("POS Profile", this.pos_profile, "selling_price_list");
			this.price_list = res.message.selling_price_list;
		}

		this.get_items({})
			.then(({ message }) => {
				this.render_item_list(message.items);
			})
			.always(() => {
				this.stop_item_loading_animation();
			});
	}

	get_items({ start = 0, page_length = 40, search_term = "" }) {
		const doc = this.events.get_frm().doc;
		const price_list = (doc && doc.selling_price_list) || this.price_list;
		let { item_group, pos_profile } = this;

		return frappe.call({
			method: "erpnext.selling.page.point_of_sale.point_of_sale.get_items",
			freeze: true,
			args: { start, page_length, price_list, item_group, search_term, pos_profile },
		});
	}

	render_item_list(items) {
		this.$items_container.html("");

		if (!items?.length) {
			this.set_items_not_found_banner();
			return;
		}

		if (this.$items_container.hasClass("items-not-found")) {
			this.$items_container.removeClass("items-not-found");
			this.$items_container.addClass(this.item_display_class);
		}

		if (this.hide_images) {
			this.$items_container.append(this.render_item_list_column_header());
		}

		items?.forEach((item) => {
			const item_html = this.get_item_html(item);
			this.$items_container.append(item_html);
		});
	}

	set_items_not_found_banner() {
		this.$items_container.removeClass(this.item_display_class);
		this.$items_container.addClass("items-not-found");
		this.$items_container.html(__("Items not found."));
	}

	render_item_list_column_header() {
		return `<div class="list-column">
			<div class="column-name">Name</div>
			<div class="column-price">Price</div>
			<div class="column-uom">UOM</div>
			<div class="column-qty-available">Quantity Available</div>
		</div>`;
	}

	get_item_html(item) {
		const me = this;
		// eslint-disable-next-line no-unused-vars
		const { item_image, serial_no, batch_no, barcode, actual_qty, uom, price_list_rate, has_serial_no, has_batch_no } = item;
		const precision = flt(price_list_rate, 2) % 1 != 0 ? 2 : 0;
		let indicator_color;
		let qty_to_display = actual_qty;

		if (item.is_stock_item) {
			indicator_color = actual_qty > 10 ? "green" : actual_qty <= 0 ? "red" : "orange";

			if (Math.round(qty_to_display) > 999) {
				qty_to_display = Math.round(qty_to_display) / 1000;
				qty_to_display = qty_to_display.toFixed(1) + "K";
			}
		} else {
			indicator_color = "";
			qty_to_display = "";
		}

		function get_item_image_html() {
			if (me.hide_images) return "";
			if (item_image) {
				return `<div class="item-qty-pill">
							<span class="indicator-pill whitespace-nowrap ${indicator_color}">${qty_to_display}</span>
						</div>
						<div class="item-display">
							<img
								onerror="cur_pos.item_selector.handle_broken_image(this)"
								class="item-img" src="${item_image}"
								alt="${item.item_name}"
							>
						</div>`;
			} else {
				return `<div class="item-qty-pill">
							<span class="indicator-pill whitespace-nowrap ${indicator_color}">${qty_to_display}</span>
						</div>
						<div class="item-display abbr">${frappe.get_abbr(item.item_name)}</div>`;
			}
		}

		return `<div class="item-wrapper"
				data-item-code="${escape(item.item_code)}" data-serial-no="${escape(serial_no)}"
				data-batch-no="${escape(batch_no)}" data-uom="${escape(uom)}"
				data-rate="${escape(price_list_rate || 0)}"
				data-stock-uom="${escape(item.stock_uom)}"
				data-has-serial-no="${escape(has_serial_no)}"
				data-has-batch-no="${escape(has_batch_no)}"
				title="${item.item_name}">

				${get_item_image_html()}

				<div class="item-detail">
					<div class="item-name">
						${!me.hide_images ? frappe.ellipsis(item.item_name, 18) : item.item_name}
					</div>
					${
						!me.hide_images
							? `<div class="item-rate">
								${format_currency(price_list_rate, item.currency, precision) || 0} / ${uom}
							</div>`
							: `
							<div class="item-price">${format_currency(price_list_rate, item.currency, precision) || 0}</div>
							<div class="item-uom">${uom}</div>
							<div class="item-qty-available">${qty_to_display || "Non stock item"}</div>
							`
					}
				</div>
			</div>`;
	}

	handle_broken_image($img) {
		const item_abbr = $($img).attr("alt");
		$($img).parent().replaceWith(`<div class="item-display abbr">${item_abbr}</div>`);
	}

	make_search_bar() {
		const me = this;
		this.$component.find(".search-field").html("");
		this.$component.find(".item-group-field").html("");

		this.search_field = frappe.ui.form.make_control({
			df: {
				label: __("Search"),
				fieldtype: "Data",
				placeholder: __("Search by item code, serial number or barcode"),
			},
			parent: this.$component.find(".search-field"),
			render_input: true,
		});
		
		this.search_field.toggle_label(false);
		this.search_field.$wrapper.addClass("pos-search-with-icon");

		this.attach_clear_btn();
		// Botón para mostrar la cuadrícula de grupos
		this.$component.find(".item-group-field").append(`
			<button class="btn btn-pos-filter btn-show-groups">${__("Grupos")}</button>
			<button class="btn btn-pos-filter btn-show-all">${__("Ver Todos")}</button>
		`);
		this.$component.find(".btn-show-groups").on("click", () => {
			this.toggle_group_and_items();
		});
		this.$component.find(".btn-show-all").on("click", () => {
			this.item_group = this.parent_item_group;
			this.$groups_container.hide();
			this.$items_container.show();
			this.filter_items({ search_term: "" });
			this.$component.find(".label").text(__("Ver Todos"));
		});
	}
toggle_group_and_items() {
		if (this.$groups_container.is(":visible")) {
			// Si el grid de grupos está visible, mostrar items y ocultar grupos
			this.$groups_container.hide();
			this.$items_container.show();
			this.filter_items({ search_term: "" });
		} else {
			// Si el grid de grupos está oculto, mostrar grupos y ocultar items
			this.show_groups_container();
		}
	}

	set_item_selector_filter_label(value) {
		const $filter_label = this.$component.find(".label");

		$filter_label.html(value ? __(value) : __("Ver Todos"));
	}

	hide_open_link_btn() {
		$(this.item_group_field.$wrapper.find(".btn-open")).css("display", "none");
	}

	attach_clear_btn() {
		this.search_field.$wrapper.find(".control-input").prepend(
			`<span class="search-icon" aria-hidden="true">${frappe.utils.icon("search", "sm")}</span>`
		);

		this.search_field.$wrapper.find(".control-input").append(
			`<span class="link-btn">
				<a class="btn-open no-decoration" title="${__("Clear")}">
					${frappe.utils.icon("close", "sm")}
				</a>
			</span>`
		);

		this.$clear_search_btn = this.search_field.$wrapper.find(".link-btn");

		this.$clear_search_btn.on("click", "a", () => {
			this.set_search_value("");
			this.search_field.set_focus();
		});
	}

	set_search_value(value) {
		$(this.search_field.$input[0]).val(value).trigger("input");
	}

	bind_events() {
		const me = this;
		window.onScan = onScan;

		this.$component.on("click", ".group-wrapper", (e) => {
				const group = $(e.currentTarget).data("group");
				this.item_group = group;
				this.$groups_container.hide();
				this.$items_container.show();
				this.filter_items({ search_term: "" });
				this.$component.find(".label").text(group);
			});

		onScan.decodeKeyEvent = function (oEvent) {
			var iCode = this._getNormalizedKeyNum(oEvent);
			switch (true) {
				case iCode >= 48 && iCode <= 90: // numbers and letters
				case iCode >= 106 && iCode <= 111: // operations on numeric keypad (+, -, etc.)
				case (iCode >= 160 && iCode <= 164) || iCode == 170: // ^ ! # $ *
				case iCode >= 186 && iCode <= 194: // (; = , - . / `)
				case iCode >= 219 && iCode <= 222: // ([ \ ] ')
				case iCode == 32: // spacebar
					if (oEvent.key !== undefined && oEvent.key !== "") {
						return oEvent.key;
					}

					var sDecoded = String.fromCharCode(iCode);
					switch (oEvent.shiftKey) {
						case false:
							sDecoded = sDecoded.toLowerCase();
							break;
						case true:
							sDecoded = sDecoded.toUpperCase();
							break;
					}
					return sDecoded;
				case iCode >= 96 && iCode <= 105: // numbers on numeric keypad
					return 0 + (iCode - 96);
			}
			return "";
		};

		onScan.attachTo(document, {
			onScan: (sScancode) => {
				if (this.search_field && this.$component.is(":visible")) {
					this.search_field.set_focus();
					this.set_search_value(sScancode);
					this.barcode_scanned = true;
				}
			},
		});

		this.$component.on("click", ".item-wrapper", function () {
			const $item = $(this);
			const item_code = unescape($item.attr("data-item-code"));
			let batch_no = unescape($item.attr("data-batch-no"));
			let serial_no = unescape($item.attr("data-serial-no"));
			let uom = unescape($item.attr("data-uom"));
			let rate = unescape($item.attr("data-rate"));
			let stock_uom = unescape($item.attr("data-stock-uom"));
			let has_serial_no = unescape($item.attr("data-has-serial-no"));
			let has_batch_no = unescape($item.attr("data-has-batch-no"));

			// escape(undefined) returns "undefined" then unescape returns "undefined"
			batch_no = batch_no === "undefined" ? undefined : batch_no;
			serial_no = serial_no === "undefined" ? undefined : serial_no;
			uom = uom === "undefined" ? undefined : uom;
			rate = rate === "undefined" ? undefined : rate;
			stock_uom = stock_uom === "undefined" ? undefined : stock_uom;
			has_serial_no = has_serial_no === "undefined" ? undefined : has_serial_no;
			has_batch_no = has_batch_no === "undefined" ? undefined : has_batch_no;

			has_serial_no = parseInt(has_serial_no) || 0;
			has_batch_no = parseInt(has_batch_no) || 0;

			me.events.item_selected({
				field: "qty",
				value: "+1",
				item: { item_code, batch_no, serial_no, uom, rate, stock_uom, has_serial_no, has_batch_no },
			});
		});

		this.search_field.$input.on("input", (e) => {
			clearTimeout(this.last_search);
			this.last_search = setTimeout(() => {
				const search_term = e.target.value;
				this.filter_items({ search_term });
			}, 300);

			this.$clear_search_btn.toggle(Boolean(this.search_field.$input.val()));
		});

		this.search_field.$input.on("focus", () => {
			this.$clear_search_btn.toggle(Boolean(this.search_field.$input.val()));
		});
	}

	attach_shortcuts() {
		const ctrl_label = frappe.utils.is_mac() ? "⌘" : "Ctrl";
		this.search_field.parent.attr("title", `${ctrl_label}+I`);
		frappe.ui.keys.add_shortcut({
			shortcut: "ctrl+i",
			action: () => this.search_field.set_focus(),
			condition: () => this.$component.is(":visible"),
			description: __("Focus on search input"),
			ignore_inputs: true,
			page: cur_page.page.page,
		});
		//this.item_group_field.parent.attr("title", `${ctrl_label}+G`);
		frappe.ui.keys.add_shortcut({
			shortcut: "ctrl+g",
			action: () => this.item_group_field.set_focus(),
			condition: () => this.$component.is(":visible"),
			description: __("Focus on Item Group filter"),
			ignore_inputs: true,
			page: cur_page.page.page,
		});

		// for selecting the last filtered item on search
		frappe.ui.keys.on("enter", () => {
			const selector_is_visible = this.$component.is(":visible");
			if (!selector_is_visible || this.search_field.get_value() === "") return;

			if (this.items.length == 1) {
				this.$items_container.find(".item-wrapper").click();
				frappe.utils.play_sound("submit");
				this.set_search_value("");
			} else if (this.items.length == 0 && this.barcode_scanned) {
				// only show alert of barcode is scanned and enter is pressed
				frappe.show_alert({
					message: __("No items found. Scan barcode again."),
					indicator: "orange",
				});
				frappe.utils.play_sound("error");
				this.barcode_scanned = false;
				this.set_search_value("");
			}
		});
	}

	filter_items({ search_term = "" } = {}) {
		this.start_item_loading_animation();

		const selling_price_list = this.events.get_frm().doc.selling_price_list;

		if (search_term) {
			search_term = search_term.toLowerCase();

			// memoize
			this.search_index = this.search_index || {};
			this.search_index[selling_price_list] = this.search_index[selling_price_list] || {};
			if (this.search_index[selling_price_list][search_term]) {
				const items = this.search_index[selling_price_list][search_term];
				this.items = items;
				this.render_item_list(items);
				this.auto_add_item &&
					this.search_field.$input[0].value &&
					this.items.length == 1 &&
					this.add_filtered_item_to_cart();
				return;
			}
		}

		this.get_items({ search_term })
			.then(({ message }) => {
				// eslint-disable-next-line no-unused-vars
				const { items, serial_no, batch_no, barcode } = message;
				if (search_term && !barcode) {
					this.search_index[selling_price_list][search_term] = items;
				}
				this.items = items;
				this.render_item_list(items);
				this.auto_add_item &&
					this.search_field.$input[0].value &&
					this.items.length == 1 &&
					this.add_filtered_item_to_cart();
			})
			.always(() => {
				this.stop_item_loading_animation();
			});
	}

	start_item_loading_animation() {
		this.$items_container.addClass("is-loading");
	}

	stop_item_loading_animation() {
		this.$items_container.removeClass("is-loading");
	}

	add_filtered_item_to_cart() {
		this.$items_container.find(".item-wrapper").click();
		this.set_search_value("");
	}

	toggle_component(show) {
		this.set_search_value("");
		this.$component.css("display", show ? "flex" : "none");
	}

	// Modifica show_groups_container para usar el mismo estilo
	async show_groups_container() {
		const res = await frappe.call({
			method: "erpnext.selling.page.point_of_sale.point_of_sale.get_item_groups",
			args: { parent_item_group: this.parent_item_group },
		});
		const groups = res.message || [];
		this.$groups_container.html("");
		
		groups.forEach(group => {
			this.$groups_container.append(`
				<div class="group-wrapper" data-group="${group.name}">
					${this.get_group_image_html(group)}
					
					<div class="group-name">${frappe.ellipsis(group.name, 18)}</div>
					
				</div>
			`);
		});
		this.$groups_container.show();
		this.$items_container.hide();
	}

	
	get_group_image_html(group) {
		if (this.hide_images) return "";
		if (group.image) {
			return `<div class="group-image">
						<img
							onerror="cur_pos.item_selector.handle_broken_image(this)"
							class="item-img" src="${group.image}"
							alt="${group.name}"
						>
					</div>`;
		} else {
			return `<div class="item-display abbr">${frappe.get_abbr(group.name)}</div>`;
		}
	}

};
