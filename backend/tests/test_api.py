"""API endpoint tests against the light fixture database."""
import io

import pytest


class TestHealthAndAuth:
    def test_health(self, client):
        res = client.get("/api/health")
        assert res.status_code == 200
        assert res.json()["status"] == "ok"

    def test_login_success(self, client):
        res = client.post("/api/auth/login",
                          json={"email": "admin@supplychainiq.com", "password": "admin123"})
        assert res.status_code == 200
        assert res.json()["user"]["role"] == "admin"

    def test_login_wrong_password(self, client):
        res = client.post("/api/auth/login",
                          json={"email": "admin@supplychainiq.com", "password": "nope"})
        assert res.status_code == 401
        assert "message" in res.json()

    def test_login_invalid_email(self, client):
        res = client.post("/api/auth/login", json={"email": "not-an-email", "password": "admin123"})
        assert res.status_code == 422  # pydantic validation

    def test_me_requires_token(self, client):
        assert client.get("/api/auth/me").status_code == 401


class TestDashboard:
    def test_dashboard_payload(self, client, auth_headers):
        res = client.get("/api/dashboard", headers=auth_headers)
        assert res.status_code == 200
        body = res.json()
        assert set(body["kpis"].keys()) == {
            "inventory_value", "inventory_units", "stockout_risks",
            "overstock_products", "inventory_turnover", "supplier_delay_rate"}
        assert len(body["inventory_health"]) == 4
        assert isinstance(body["alerts"], list)
        assert len(body["summary"]) > 20

    def test_dashboard_period_validation(self, client, auth_headers):
        res = client.get("/api/dashboard?period=12", headers=auth_headers)
        assert res.status_code == 200  # falls back to default 90


class TestProducts:
    def test_list_paginates(self, client, auth_headers):
        res = client.get("/api/products?page=1&page_size=2", headers=auth_headers)
        body = res.json()
        assert res.status_code == 200
        assert len(body["items"]) == 2
        assert body["total"] == 5

    def test_search_filters(self, client, auth_headers):
        res = client.get("/api/products?search=steady", headers=auth_headers)
        assert res.status_code == 200
        assert res.json()["total"] == 1

    def test_status_filter(self, client, auth_headers):
        res = client.get("/api/products?status=Healthy", headers=auth_headers)
        assert all(i["status"] == "Healthy" for i in res.json()["items"])

    def test_detail_success(self, client, auth_headers):
        res = client.get("/api/products/1", headers=auth_headers)
        assert res.status_code == 200
        body = res.json()
        assert body["metrics"]["current_stock"] >= 0
        assert len(body["projection"]) > 0

    def test_detail_404(self, client, auth_headers):
        res = client.get("/api/products/9999", headers=auth_headers)
        assert res.status_code == 404

    def test_forecast(self, client, auth_headers):
        res = client.get("/api/forecasts/1?horizon=14", headers=auth_headers)
        assert res.status_code == 200
        body = res.json()
        assert len(body["forecast"]) == 14
        assert body["method"]


class TestPurchaseOrders:
    def test_list(self, client, auth_headers):
        res = client.get("/api/purchase-orders", headers=auth_headers)
        assert res.status_code == 200
        assert res.json()["total"] >= 2

    def test_create_success(self, client, auth_headers):
        res = client.post("/api/purchase-orders", headers=auth_headers,
                          json={"product_id": 1, "supplier_id": 1, "quantity": 120})
        assert res.status_code == 200
        assert res.json()["po_number"].startswith("PO-")
        assert res.json()["total_cost"] == 120 * 100.0

    def test_create_rejects_bad_product(self, client, auth_headers):
        res = client.post("/api/purchase-orders", headers=auth_headers,
                          json={"product_id": 999, "supplier_id": 1, "quantity": 10})
        assert res.status_code == 404

    def test_create_rejects_zero_qty(self, client, auth_headers):
        res = client.post("/api/purchase-orders", headers=auth_headers,
                          json={"product_id": 1, "supplier_id": 1, "quantity": 0})
        assert res.status_code == 422  # pydantic gt=0

    def test_update_status(self, client, auth_headers):
        res = client.put("/api/purchase-orders/2", headers=auth_headers,
                         json={"status": "Delivered"})
        assert res.status_code == 200
        assert res.json()["status"] == "Delivered"
        assert res.json()["actual_date"]

    def test_update_invalid_status(self, client, auth_headers):
        res = client.put("/api/purchase-orders/2", headers=auth_headers,
                         json={"status": "Zapped"})
        assert res.status_code == 422


class TestSuppliers:
    def test_list_scored(self, client, auth_headers):
        res = client.get("/api/suppliers", headers=auth_headers)
        body = res.json()
        assert res.status_code == 200
        assert len(body["items"]) == 2
        assert body["items"][0]["total"] >= body["items"][1]["total"]
        assert body["weights"]["delivery"] == 30

    def test_detail(self, client, auth_headers):
        res = client.get("/api/suppliers/1", headers=auth_headers)
        assert res.status_code == 200
        assert "summary" in res.json()

    def test_detail_404(self, client, auth_headers):
        assert client.get("/api/suppliers/999", headers=auth_headers).status_code == 404


class TestRecommendationsAndAnalytics:
    def test_recommendations_shape(self, client, auth_headers):
        res = client.get("/api/recommendations", headers=auth_headers)
        body = res.json()
        assert res.status_code == 200
        assert {"critical", "warning", "opportunity", "info"} <= set(body["counts"].keys())
        actions = {i["action"] for i in body["items"]}
        assert actions <= {"NO ACTION", "MONITOR", "REORDER SOON", "ORDER NOW",
                           "REDUCE FUTURE ORDERS", "REVIEW SUPPLIER"}
        zero_demand = next(i for i in body["items"] if i["sku"] == "DEAD-003")
        assert zero_demand["action"] == "REDUCE FUTURE ORDERS"

    def test_analytics(self, client, auth_headers):
        res = client.get("/api/analytics", headers=auth_headers)
        body = res.json()
        assert res.status_code == 200
        assert body["inventory"]["turnover"] is not None
        assert body["procurement"]["po_count"] >= 2
        assert len(body["abc"]["summary"]) == 3

    def test_analytics_includes_insights(self, client, auth_headers):
        body = client.get("/api/analytics", headers=auth_headers).json()
        titles = {i["title"] for i in body["insights"]}
        assert "Value concentration" in titles


class TestSettingsAndIO:
    def test_get_settings(self, client, auth_headers):
        res = client.get("/api/settings", headers=auth_headers)
        assert res.status_code == 200
        assert res.json()["values"]["service_level"]["value"] == 0.95

    def test_update_settings_validates(self, client, auth_headers):
        res = client.put("/api/settings", headers=auth_headers,
                         json={"values": {"demand_window_days": "not-a-number"}})
        assert res.status_code == 422

    def test_reset_demo_requires_admin(self, client):
        # no token -> 401/403 (guard rejects before role check)
        assert client.post("/api/settings/reset-demo").status_code in (401, 403)

    def test_export_inventory_csv(self, client, auth_headers):
        res = client.get("/api/export/inventory", headers=auth_headers)
        assert res.status_code == 200
        assert "closing_stock" in res.text
        assert res.text.count(",") > 5

    def test_export_unknown_entity(self, client, auth_headers):
        res = client.get("/api/export/nope", headers=auth_headers)
        assert res.status_code == 400

    def test_import_products_with_row_errors(self, client, auth_headers):
        csv = "sku,name,category,unit_cost\nOK-1,Valid Product,Electronics,10\nBAD,,\n"
        res = client.post("/api/import/products", headers=auth_headers,
                          files={"file": ("p.csv", io.BytesIO(csv.encode()), "text/csv")})
        body = res.json()
        assert res.status_code == 200
        assert body["imported"] == 1
        assert body["failed"] == 1
        assert body["errors"][0]["row"] == 3

    def test_import_rejects_non_csv(self, client, auth_headers):
        res = client.post("/api/import/products", headers=auth_headers,
                          files={"file": ("p.txt", io.BytesIO(b"x"), "text/plain")})
        assert res.status_code == 400

    def test_import_wrong_entity(self, client, auth_headers):
        res = client.post("/api/import/widgets", headers=auth_headers,
                          files={"file": ("p.csv", io.BytesIO(b"a,b\n1,2"), "text/csv")})
        assert res.status_code == 400

    def test_import_preview_reports_update_diff(self, client, auth_headers):
        """Preview is a pure dry-run: it diffs upserts without writing anything."""
        # Existing product from the seed fixture.
        existing = client.get("/api/products?page_size=1", headers=auth_headers).json()["items"][0]
        sku, old_cost, old_name = existing["sku"], existing["unit_cost"], existing["name"]
        new_cost = round(old_cost + 111.11, 2)

        csv = (f"sku,name,category,unit_cost\n"
               f"{sku},Renamed via CSV,Electronics,{new_cost}\n"
               f"BRAND-NEW-1,New Product,Electronics,10\n"
               f"BAD-ROW,,Electronics,0\n")
        res = client.post("/api/import/products/preview", headers=auth_headers,
                          files={"file": ("p.csv", io.BytesIO(csv.encode()), "text/csv")})
        assert res.status_code == 200
        body = res.json()
        assert body["mode"] == "upsert"
        assert body["updates"] == 1
        assert body["creates"] == 1
        assert body["invalid_count"] == 1
        change = body["changes"][0]
        assert change["key"] == sku
        field_by_name = {f["field"]: f for f in change["fields"]}
        assert field_by_name["name"]["old"] == old_name
        assert field_by_name["name"]["new"] == "Renamed via CSV"
        assert field_by_name["unit_cost"]["old"] == old_cost
        assert field_by_name["unit_cost"]["new"] == new_cost

        # Dry-run guarantee: nothing was written.
        after = client.get("/api/products?page_size=100", headers=auth_headers).json()["items"]
        match = [p for p in after if p["sku"] == sku][0]
        assert match["unit_cost"] == old_cost
        assert match["name"] == old_name
        assert not any(p["sku"] == "BRAND-NEW-1" for p in after)

    def test_import_preview_suppliers_and_append_mode(self, client, auth_headers):
        res = client.post("/api/import/suppliers/preview", headers=auth_headers,
                          files={"file": ("s.csv", io.BytesIO(
                              b"name,on_time_rate\nNobody Knows Ltd,0.5\n"), "text/csv")})
        assert res.status_code == 200
        assert res.json()["mode"] == "upsert"

        res = client.post("/api/import/sales/preview", headers=auth_headers,
                          files={"file": ("s.csv", io.BytesIO(
                              b"sku,sale_date,quantity\nGHOST,2026-01-01,1\n"), "text/csv")})
        assert res.status_code == 200
        body = res.json()
        assert body["mode"] == "append"
        assert body["invalid_count"] == 1  # unknown SKU

    def test_import_preview_rejects_bad_entity_and_file(self, client, auth_headers):
        assert client.post("/api/import/widgets/preview", headers=auth_headers,
                           files={"file": ("p.csv", io.BytesIO(b"a\n1"), "text/csv")}).status_code == 400
        assert client.post("/api/import/products/preview", headers=auth_headers,
                           files={"file": ("p.txt", io.BytesIO(b"x"), "text/plain")}).status_code == 400

    def test_import_xlsx_roundtrip(self, client, auth_headers):
        """A real .xlsx workbook imports exactly like its CSV twin."""
        openpyxl = pytest.importorskip("openpyxl")
        from io import BytesIO as _Bio

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.append(["sku", "name", "category", "unit_cost"])
        ws.append(["XLSX-001", "Excel Gadget", "Electronics", 77.5])
        ws.append(["XLSX-002", "Excel Widget", "Electronics", 12.25])
        ws.append(["XLSX-BAD", "No Cost", "Electronics", None])
        buf = _Bio()
        wb.save(buf)
        xlsx_bytes = buf.getvalue()

        # Preview first (rows don't exist yet): 2 creates, 1 invalid.
        res = client.post("/api/import/products/preview", headers=auth_headers,
                          files={"file": ("p.xlsx", io.BytesIO(xlsx_bytes),
                                          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")})
        body = res.json()
        assert res.status_code == 200
        assert body["creates"] == 2
        assert body["invalid_count"] == 1

        # Then the real import.
        res = client.post("/api/import/products", headers=auth_headers,
                          files={"file": ("p.xlsx", io.BytesIO(xlsx_bytes),
                                          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")})
        body = res.json()
        assert res.status_code == 200
        assert body["imported"] == 2
        assert body["failed"] == 1  # the None unit_cost row

        after = client.get("/api/products?page_size=100", headers=auth_headers).json()["items"]
        by_sku = {p["sku"]: p for p in after}
        assert by_sku["XLSX-001"]["unit_cost"] == 77.5
        assert by_sku["XLSX-002"]["name"] == "Excel Widget"

        # Previewing the same workbook again now reports updates, not creates.
        res = client.post("/api/import/products/preview", headers=auth_headers,
                          files={"file": ("p.xlsx", io.BytesIO(xlsx_bytes),
                                          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")})
        body = res.json()
        assert res.status_code == 200
        assert body["updates"] == 0  # importing the same file again is a no-op diff

    def test_import_history_records_and_redownload(self, client, auth_headers):
        """Every import is logged with who ran it, and the file can be re-downloaded byte-for-byte."""
        marker = "HIST-404,History Probe,Electronics,31.5"
        csv = f"sku,name,category,unit_cost\n{marker}\n"
        res = client.post("/api/import/products", headers=auth_headers,
                          files={"file": ("history_probe.csv", io.BytesIO(csv.encode()), "text/csv")})
        assert res.status_code == 200

        # Logged with correct metadata.
        hist = client.get("/api/import/history", headers=auth_headers).json()["items"]
        entry = next(h for h in hist if h["filename"] == "history_probe.csv")
        assert entry["entity"] == "products"
        assert entry["uploaded_by"] == "admin@supplychainiq.com"
        assert entry["imported"] == 1 and entry["failed"] == 0
        assert entry["ran_at"] is not None
        assert entry["file_available"] is True

        # Re-download returns the exact original bytes.
        dl = client.get(f"/api/import/history/{entry['id']}/file", headers=auth_headers)
        assert dl.status_code == 200
        assert dl.headers["content-disposition"].startswith("attachment")
        assert f"sku,name,category,unit_cost".encode() in dl.content
        assert marker.encode() in dl.content

        # Unknown id -> 404.
        assert client.get("/api/import/history/999999/file", headers=auth_headers).status_code == 404
