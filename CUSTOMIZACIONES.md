# Customizaciones de Compumundo en ERPNext (rama `version-16-custom`)

Este fork = `version-16` de upstream + los cambios de abajo. Sirve para resolver los
conflictos del merge sin adivinar. Las del core de Frappe están en
`apps/frappe/CUSTOMIZACIONES.md`.

Para ver la lista real y actual de lo que difiere de upstream (la fuente de verdad):

```bash
git diff --stat version-16 version-16-custom -- . ':!erpnext/locale'
```

## Cómo actualizar (flujo normal)

Desde la carpeta del bench: `./actualizar_ramas.sh` (hace `pull` en `version-16`, vuelve a
`version-16-custom` y hace `merge version-16`; si hay conflictos deja la app a medio merge).
Al terminar, `./push_apps.sh` sube las ramas.

Pasos para resolver conflictos:

1. `git diff --name-only --diff-filter=U` (o `git ls-files -u`) lista los archivos sin resolver.
   **Ojo:** un archivo puede aparecer ahí aunque ya no tenga marcas `<<<<<<<` (por ejemplo si se
   resolvió a mano y falta `git add`). Con `git ls-files -u` vacío, el índice está limpio.
2. Resolver cada archivo con la tabla de abajo. Regla general: **la lógica de upstream entra
   completa y se reaplican nuestros cambios encima**, nunca al revés.
3. Validar antes de `git add`:
   ```bash
   grep -rnE '^(<<<<<<<|=======$|>>>>>>>)' --include=*.py --include=*.js --include=*.json erpnext | grep -v locale
   python3 -m py_compile <archivos .py>      # sintaxis Python
   node --check <archivos .js>               # sintaxis JS
   python3 -c "import json,sys; json.load(open(sys.argv[1]))" <archivo.json>
   ```
4. `git add <archivos>` y `git commit --no-edit`.
5. Si algo sale mal: `git merge --abort` (solo mientras el merge no esté commiteado).

## Qué cambiamos y dónde (por área)

### Punto de venta (POS) — lo que más entra en conflicto
Archivos: `erpnext/selling/page/point_of_sale/{pos_controller,pos_item_cart,pos_item_selector,pos_item_details,pos_payment}.js`,
`point_of_sale.py`, `point_of_sale.css`, `erpnext/public/scss/point-of-sale.scss`,
`erpnext/public/js/point-of-sale.bundle.js` (orden de imports).

Son reescrituras grandes (más de 3.000 líneas). Reglas para conflictos:
- **`pos_item_selector.js`**: la selección de ítems usa `get_item_data_from_wrapper($item)`
  (nuestro). Si upstream vuelve a leer `data-*` a mano dentro del click, se descarta lo de upstream
  y se conserva el método.
- **`pos_controller.js` → `get_item_from_frm`**: la coincidencia de fila usa tolerancia de precio
  (`rate_matches`, 0.0001) y un respaldo por candidatos (nuestro). De upstream se conserva
  `warehouse` (`(!warehouse || i.warehouse === warehouse)`). No volver a `i.price_list_rate === flt(rate)`.
- **`pos_controller.js` → `on_cart_update`**: el desestructurado de `item` incluye
  `warehouse` (upstream) **y** `has_serial_no`, `has_batch_no` (nuestros).
- `group_same_items` (campo de POS Profile) controla si un ítem repetido suma cantidad o crea fila.
- `point-of-sale.bundle.js`: el orden de los imports importa (`pos_controller` antes de `pos_item_selector`).

### Cierre de caja (POS Closing Entry)
- `pos_closing_entry.py`: `get_session_invoices()` agrega `payment_details` a cada factura
  (`get_invoice_payment_details`). Upstream separó esa función; si cambia otra vez, hay que
  mantener que **devuelva la lista de facturas con `payment_details`** y que `get_invoices()` arme
  `{"invoices", "payments", "taxes"}` a partir de ella.
- Doctypes nuevos nuestros: **POS Payment Entry** y **Sales Invoices Outstanding** (tablas hijas
  `pos_payment_entries`, `pos_received_payment_entries`, `sales_invoices_outstanding`).
  `payment_details` en POS Invoice Reference y Sales Invoice Reference.
- `naming_rule` del JSON es `Expression` (no `Expression (old style)`).

### Pagos (Payment Entry)
- `posting_date` es **Datetime** (default `Now`), `payment_type` con opciones `Pay\nReceive\nInternal Transfer`,
  `mode_of_payment` obligatorio, campos `pos_profile`, `is_pos_cash_movement` (default 1), `pos_closing_entry`.
- `payment_entry.js`: al elegir cliente + `Receive` se cargan automáticamente las facturas pendientes
  (`allocate_payment_amount`).
- En `payment_entry.py` solo hay anotaciones de tipos (`DF.*`), que son **autogeneradas**: en un
  conflicto en ese bloque se toma el de upstream y se reponen nuestros campos
  (`is_pos_cash_movement`, `pos_closing_entry`, `pos_profile`, `posting_date: DF.Datetime`,
  `payment_type` con nuestro orden, `mode_of_payment: DF.Link`).
- `payment_entry.json`: si la unión automática falla, hay que quedarse con **nuestros** campos
  (los de arriba) y con el **orden y secciones de upstream** (`bank_account`, `reference_no`,
  `payment_term_discounts_calculated`...).

### Facturas de venta y contabilidad
- `sales_invoice.py`: chequeo de límite de crédito cuando `paid_amount < total`
  (`get_credit_limit`, error "Credit limit not set for customer"). El import debe incluir **ambos**:
  `get_credit_limit` (nuestro) e `is_sales_order_credit_check_bypassed` (upstream).
  `custom_saldo_anterior` (campo de moneda). Se permite el pago en facturas POS
  (`depends_on` ya no excluye `is_pos` en los campos de pago).
- `accounts_controller.py` (**riesgo alto, afecta saldos**):
  1. Se quitó la condición `self.doctype == "Sales Invoice" and self.is_pos` en dos lugares
     (≈ línea 806 y ≈ 2902).
  2. En el cálculo de saldo pendiente de facturas POS con `paid_amount`, se resta el monto pagado
     del total (`base_grand_total -= base_paid_amount`, o `grand_total -= paid_amount` según moneda).
  Si upstream toca estas funciones, **no resolver a ciegas**: revisar con contabilidad.
- `accounts_receivable.py`/`.html`: se pide el campo `custom_numero_factura` además de los de upstream
  (`fields=[... "custom_numero_factura", "sales_partner", "is_return"]`) y el HTML lo muestra
  como "Numero Factura".

### Inventario
- `stock_reconciliation.py` (**riesgo alto**): al enviar, los ítems sin cambio no se eliminan del
  documento; se guardan en `items_with_change` y se ignoran solo al enviar
  (`run_on_changed_items`, condicionado a `self._action == "submit"`). Valuación toma primero el
  `valuation_rate` del Item. Filtro por ubicación en `get_items` (`filter_items_by_shelf_location`).
  Pruebas nuestras en `test_stock_reconciliation.py`.
- `stock/utils.py` → `scan_barcode`: si el texto no es un código de barras, busca por `Item.name`
  (código de producto) antes de rendirse.
- `buying/utils.py`: funciones `get_sales_tax_rate` y `update_buying_price_list_rate`.
- Item / Item Barcode: `in_filter`, `search_fields` sin `customer_code`; `item.js` con protección si
  falta `prices_html`. `Reporte "Cantidades y Precios"`.
- Doctypes/tarjetas/espacios de trabajo: `selling.json`, `stock.json`, `annual_sales_invoices`,
  `total_outgoing_bills`.

## Ruido que NO es una customización (fácil de confundir)

- Varios `.py` tienen **solo formato distinto** (líneas largas en una línea en vez de varias,
  imports reordenados): `item.py`, `item_barcode.py`, `payment_entry.py` (imports),
  `sales_invoice.py` (el bloque `status: DF.Literal[...]`). Si chocan en un merge, **gana upstream**
  y se reponen solo las líneas funcionales.
- `erpnext/locale/es copy.po` es una copia suelta de la traducción (62.000 líneas), no la usa nada.
  Candidato a borrarse.

## Plan de migración a `cm_app` (para reducir estos conflictos)

Estado: **solo planeado, nada movido todavía**. Orden de menor a mayor riesgo:
1. Doctypes/reportes/workspaces nuevos + borrar `es copy.po`.
2. Campos personalizados (mismos `fieldname` y tipo, sin renombrar; quitarlos del core y crearlos en
   `cm_app` **en el mismo despliegue**, y comparar columnas y propiedades antes/después).
3. Python de bajo riesgo (`scan_barcode`, `buying/utils`, límite de crédito con `doc_events`).
   `accounts_controller` y `stock_reconciliation` se quedan en el core hasta tener pruebas.
4. POS (página propia en `cm_app`).
Siempre: respaldo y prueba en una copia de producción primero.

## Nota sobre `bench migrate` lento (~20 min)

~17 min se van en "Removing orphan doctypes/entities": `glob(".../**/doctype/**/*.json")` entra por
los enlaces `apps/<app>/<app>/public/node_modules` → `apps/<app>/node_modules` (decenas de miles
de archivos, disco lento de WSL). Afecta a frappe, erpnext y builder. Pendiente de decidir si se
quitan los enlaces durante el migrate.
