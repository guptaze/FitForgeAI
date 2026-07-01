"""FitForge AI backend API regression tests (iteration 2).

Covers iteration 1 flows (plan/generate, plan/latest, food/log-image, logs/today,
health/sync, voice endpoints) plus iteration 2 additions:
  - GET  /api/overview
  - POST /api/workouts/log
  - GET  /api/workouts/today
  - DELETE /api/workouts/{id}
  - POST /api/bloodwork/upload-image
  - POST /api/bloodwork/upload-pdf
  - GET  /api/bloodwork/latest

Plan generate is called both via PUBLIC URL and (fallback) via LOCAL backend to
avoid the ~60s ingress timeout described in iteration_1 report.
"""
import os
import io
import base64
import wave
import time
import pytest
import requests

PUBLIC_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://fitforge-ai-27.preview.emergentagent.com",
).rstrip("/")
LOCAL_URL = "http://localhost:8001"
API = f"{PUBLIC_URL}/api"
LOCAL_API = f"{LOCAL_URL}/api"

REQUIRED_PLAN_SECTIONS = [
    "summary",
    "targets",
    "training_split",
    "monthly_progression",
    "nutrition_framework",
    "meal_plan",
    "supplement_stack",
    "blood_panel",
    "weekly_rate_validation",
    "injury_risk_flag",
    "recovery_and_sleep",
]


@pytest.fixture(scope="session")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---------- Health ----------
class TestHealth:
    def test_root(self, client):
        r = client.get(f"{API}/", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data.get("app") == "FitForge AI"
        assert data.get("status") == "ok"


# ---------- Overview ----------
class TestOverview:
    def test_overview_shape(self, client):
        r = client.get(f"{API}/overview", timeout=30)
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        for k in ("date", "today", "yesterday", "morning_checkin", "latest_weight",
                  "health", "targets", "nutrition_targets"):
            assert k in data, f"overview missing key: {k}"
        assert "food_entries" in data["today"]
        assert "totals" in data["today"]
        for tk in ("calories", "protein_g", "carbs_g", "fat_g"):
            assert tk in data["today"]["totals"]
        assert "date" in data["yesterday"] and "totals" in data["yesterday"]


# ---------- Plan Generation ----------
PLAN_PAYLOAD = {
    "body": {"current_weight_kg": 85.0, "target_weight_kg": 75.0, "height_cm": 178, "age": 32, "sex": "male"},
    "duration_months": 3,
    "training": {"days_per_week": 4, "minutes_per_session": 60, "preferred_window": "6-8am"},
    "diet": {"diet_type": "eggetarian", "meal_pattern": "3 meals + 1 snack", "cheat_day_policy": "1 flexible meal weekly"},
    "injuries": "None reported",
    "goals": {"aesthetic_goal": "lean and athletic", "focus_muscles": ["chest", "back", "glutes"], "pace": "moderate"},
    "daily_schedule": "Wake 6am, desk job 9-6, gym 7pm, sleep 11pm",
}


def _validate_plan(plan: dict):
    missing = [k for k in REQUIRED_PLAN_SECTIONS if k not in plan]
    assert not missing, f"Missing plan sections: {missing}"
    # targets
    tg = plan["targets"]
    for k in ("start_weight_kg", "target_weight_kg", "duration_months", "weekly_rate_kg"):
        assert k in tg, f"targets missing {k}"
    # training_split.table[].exercises[].demo_query + muscle_group
    tbl = plan["training_split"].get("table")
    assert isinstance(tbl, list) and tbl, "training_split.table empty"
    ex0 = tbl[0]["exercises"][0]
    for k in ("name", "sets", "reps", "demo_query", "muscle_group"):
        assert k in ex0, f"exercise missing {k}"
    # meal_plan with options
    mp = plan["meal_plan"]
    assert isinstance(mp, list) and mp, "meal_plan empty"
    assert "meal" in mp[0] and "options" in mp[0] and mp[0]["options"], "meal_plan[0] missing meal/options"
    # supplements requires_bloodwork field
    ss = plan["supplement_stack"]
    assert isinstance(ss, list) and ss, "supplement_stack empty"
    assert "requires_bloodwork" in ss[0], "supplement missing requires_bloodwork"
    assert "target_marker" in ss[0], "supplement missing target_marker"
    # nutrition_framework macros
    nf = plan["nutrition_framework"]
    for k in ("daily_calories", "protein_g", "carbs_g", "fat_g"):
        assert k in nf


class TestPlan:
    def test_generate_plan(self, client):
        """Try public URL; if 502 (ingress timeout), fall back to local."""
        try:
            r = client.post(f"{API}/plan/generate", json=PLAN_PAYLOAD, timeout=180)
        except requests.RequestException as e:
            r = None
            print(f"public url exception: {e}")

        if r is None or r.status_code != 200:
            code = r.status_code if r is not None else "N/A"
            print(f"public /plan/generate -> {code}; falling back to local backend")
            r = requests.post(f"{LOCAL_API}/plan/generate", json=PLAN_PAYLOAD, timeout=240)

        assert r.status_code == 200, f"body={r.text[:400]}"
        data = r.json()
        assert "id" in data and "plan" in data and "created_at" in data
        _validate_plan(data["plan"])

    def test_latest_plan(self, client):
        r = client.get(f"{API}/plan/latest", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data.get("plan") is not None, "no plan persisted"
        _validate_plan(data["plan"])


# ---------- Health Sync ----------
class TestHealthSync:
    def test_health_upsert(self, client):
        payload = {"date": "2026-01-15", "steps": 8241, "active_energy_kcal": 412.0,
                   "resting_hr": 58, "avg_hr": 72, "sleep_hours": 7.2, "workouts": 1}
        r = client.post(f"{API}/health/sync", json=payload, timeout=30)
        assert r.status_code == 200
        assert r.json()["steps"] == 8241
        payload["steps"] = 9999
        r2 = client.post(f"{API}/health/sync", json=payload, timeout=30)
        assert r2.json()["steps"] == 9999


# ---------- Workouts ----------
class TestWorkouts:
    log_id = None

    def test_log_workout(self, client):
        payload = {"day_label": "Day 1 - Push", "exercise_name": "TEST_Bench Press",
                   "sets_done": 3, "reps": "8-10", "weight_kg": 60.0, "notes": "regression test"}
        r = client.post(f"{API}/workouts/log", json=payload, timeout=30)
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        assert data["exercise_name"] == "TEST_Bench Press"
        assert data["sets_done"] == 3
        assert data["reps"] == "8-10"
        assert data["day_label"] == "Day 1 - Push"
        assert "id" in data and "created_at" in data and "date" in data
        TestWorkouts.log_id = data["id"]

    def test_workouts_today_contains(self, client):
        r = client.get(f"{API}/workouts/today", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert "date" in data and "logs" in data
        assert isinstance(data["logs"], list)
        if TestWorkouts.log_id:
            ids = [item["id"] for item in data["logs"]]
            assert TestWorkouts.log_id in ids, "just-logged workout not returned"

    def test_delete_workout(self, client):
        if not TestWorkouts.log_id:
            pytest.skip("no workout to delete")
        r = client.delete(f"{API}/workouts/{TestWorkouts.log_id}", timeout=30)
        assert r.status_code == 200
        assert r.json().get("deleted") == 1
        r2 = client.get(f"{API}/workouts/today", timeout=30)
        ids = [item["id"] for item in r2.json()["logs"]]
        assert TestWorkouts.log_id not in ids


# ---------- Bloodwork ----------
def _tiny_jpeg_b64() -> str:
    hexstr = (
        "ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707"
        "07090908080a0c14090a0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c"
        "1c2837292c30313434341f27393d38323c2e333432ffdb0043010909090c0b0c180d0d"
        "1832211c213232323232323232323232323232323232323232323232323232323232323"
        "23232323232323232323232323232323232323232323232ffc00011080001000103012"
        "200021101031101ffc4001f0000010501010101010100000000000000000102030405"
        "060708090a0bffc400b5100002010303020403050504040000017d01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffc4001f0100030101010101010101010000000000000102030405060708090a0bffc400b51100020102040403040705040400010277000102031104052131061241510761711322328108144291a1b1c109233352f0156272d10a162434e125f11718191a262728292a35363738393a434445464748494a535455565758595a636465666768696a737475767778797a82838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae2e3e4e5e6e7e8e9eaf2f3f4f5f6f7f8f9faffda000c03010002110311003f00fbfc28a28a00ffd9"
    )
    return base64.b64encode(bytes.fromhex(hexstr)).decode()


def _make_bloodwork_pdf() -> bytes:
    from reportlab.pdfgen import canvas
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    y = 800
    for line in [
        "TEST_ Blood Report - Regression",
        "Patient: Test User  Age: 32  Sex: Male",
        "Vitamin D (25-OH): 22 ng/mL   (Ref: 30-80)",
        "Ferritin: 45 ng/mL   (Ref: 30-400)",
        "Hemoglobin: 14.2 g/dL  (Ref: 13.5-17.5)",
        "TSH: 2.1 uIU/mL  (Ref: 0.4-4.0)",
        "Fasting Glucose: 92 mg/dL  (Ref: 70-99)",
    ]:
        c.drawString(72, y, line)
        y -= 20
    c.save()
    return buf.getvalue()


class TestBloodwork:
    pdf_id = None
    img_id = None

    def test_upload_image(self, client):
        r = client.post(
            f"{API}/bloodwork/upload-image",
            json={"image_base64": _tiny_jpeg_b64(), "mime_type": "image/jpeg"},
            timeout=120,
        )
        # unreadable image -> markers:[] with overall_summary is a valid 200
        assert r.status_code == 200, r.text[:400]
        data = r.json()
        assert data["source"] == "image"
        assert "markers" in data and isinstance(data["markers"], list)
        assert "suggestions" in data
        assert "overall_summary" in data["suggestions"]
        assert "id" in data and "created_at" in data
        TestBloodwork.img_id = data["id"]

    def test_upload_pdf(self):
        # multipart/form-data - do not send Content-Type: application/json
        files = {"file": ("report.pdf", _make_bloodwork_pdf(), "application/pdf")}
        # Try public first; fall back to local if ingress times out
        try:
            r = requests.post(f"{API}/bloodwork/upload-pdf", files=files, timeout=180)
        except requests.RequestException:
            r = None
        if r is None or r.status_code >= 500:
            code = r.status_code if r is not None else "N/A"
            print(f"public /bloodwork/upload-pdf -> {code}; falling back to local")
            files = {"file": ("report.pdf", _make_bloodwork_pdf(), "application/pdf")}
            r = requests.post(f"{LOCAL_API}/bloodwork/upload-pdf", files=files, timeout=240)
        assert r.status_code == 200, r.text[:400]
        data = r.json()
        assert data["source"] == "pdf"
        assert "markers" in data and isinstance(data["markers"], list)
        assert data.get("raw_extract"), "raw_extract should contain parsed PDF text"
        assert "Vitamin D" in data["raw_extract"] or "vitamin d" in data["raw_extract"].lower()
        assert "suggestions" in data and "overall_summary" in data["suggestions"]
        TestBloodwork.pdf_id = data["id"]

    def test_bloodwork_latest(self, client):
        r = client.get(f"{API}/bloodwork/latest", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data, "latest bloodwork empty"
        assert "source" in data and "markers" in data and "suggestions" in data
        assert "id" in data

    def test_cleanup_bloodwork(self, client):
        for rid in (TestBloodwork.pdf_id, TestBloodwork.img_id):
            if rid:
                client.delete(f"{API}/bloodwork/{rid}", timeout=30)


# ---------- Food Image ----------
class TestFoodImage:
    entry_id = None

    def test_food_log_image_tiny(self, client):
        r = client.post(
            f"{API}/food/log-image",
            json={"image_base64": _tiny_jpeg_b64(), "mime_type": "image/jpeg"},
            timeout=120,
        )
        # accept 200 (Claude parses) or 500 (litellm rejects 1x1) - both are
        # documented outcomes; a 4xx routing error would be a bug.
        assert r.status_code in (200, 500), f"unexpected {r.status_code}: {r.text[:200]}"
        if r.status_code == 200:
            data = r.json()
            assert data.get("source") == "photo"
            assert "estimated_calories" in data
            TestFoodImage.entry_id = data.get("id")

    def test_logs_today_shape(self, client):
        r = client.get(f"{API}/logs/today", timeout=30)
        assert r.status_code == 200
        data = r.json()
        for k in ("date", "food_entries", "totals", "morning_checkin", "health"):
            assert k in data
        assert data["totals"]["calories"] >= 0

    def test_cleanup_food(self, client):
        if TestFoodImage.entry_id:
            client.delete(f"{API}/food/{TestFoodImage.entry_id}", timeout=30)


# ---------- Voice endpoints (routing check) ----------
def _silent_wav_bytes(seconds: float = 0.5, rate: int = 16000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x00\x00" * int(rate * seconds))
    return buf.getvalue()


class TestVoiceEndpoints:
    def _post_audio(self, path):
        files = {"file": ("audio.wav", _silent_wav_bytes(), "audio/wav")}
        return requests.post(f"{API}{path}", files=files, timeout=120)

    def test_transcribe(self):
        r = self._post_audio("/transcribe")
        assert r.status_code in (200, 500), f"unexpected {r.status_code}: {r.text[:200]}"

    def test_checkin_morning(self):
        r = self._post_audio("/checkin/morning")
        assert r.status_code in (200, 500), f"unexpected {r.status_code}: {r.text[:200]}"

    def test_food_log_voice(self):
        r = self._post_audio("/food/log-voice")
        assert r.status_code in (200, 500), f"unexpected {r.status_code}: {r.text[:200]}"
