from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import json
import re
import io
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timedelta, timezone
import anthropic
from openai import AsyncOpenAI
from pypdf import PdfReader
import certifi

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

MONGO_URL = os.environ['MONGO_URL']
DB_NAME = os.environ['DB_NAME']
ANTHROPIC_API_KEY = os.environ['ANTHROPIC_API_KEY']
OPENAI_API_KEY = os.environ['OPENAI_API_KEY']          # replaces EMERGENT_LLM_KEY
CLAUDE_MODEL = os.environ.get('CLAUDE_MODEL', 'claude-sonnet-5')

mongo_client = AsyncIOMotorClient(MONGO_URL, tls=True, tlsCAFile=certifi.where())
db = mongo_client[DB_NAME]

anthropic_client = anthropic.AsyncAnthropic(api_key=ANTHROPIC_API_KEY)
openai_client = AsyncOpenAI(api_key=OPENAI_API_KEY)

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def today_key() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")

def yesterday_key() -> str:
    return (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")

def extract_json(text: str) -> Dict[str, Any]:
    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if fence:
        return json.loads(fence.group(1))
    start = text.find('{')
    end = text.rfind('}')
    if start != -1 and end != -1 and end > start:
        return json.loads(text[start:end+1])
    raise ValueError("No JSON found in LLM response")


# ============== MODELS ==============

class BodyMetrics(BaseModel):
    current_weight_kg: float
    target_weight_kg: float
    height_cm: float
    age: int
    sex: str

class Training(BaseModel):
    days_per_week: int
    minutes_per_session: int
    preferred_window: str

class Diet(BaseModel):
    diet_type: str
    meal_pattern: str
    cheat_day_policy: str
    meals_per_day: Optional[int] = None

class Goals(BaseModel):
    aesthetic_goal: str
    focus_muscles: List[str]
    pace: str
    goal_tags: List[str] = []

class UserProfile(BaseModel):
    name: str
    email: str
    phone: Optional[str] = None
    updated_at: str = Field(default_factory=utcnow_iso)

class PlanInput(BaseModel):
    body: BodyMetrics
    duration_months: int
    training: Training
    diet: Diet
    injuries: str
    goals: Goals
    daily_schedule: str


class PlanRecord(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    created_at: str = Field(default_factory=utcnow_iso)
    input: Dict[str, Any]
    plan: Dict[str, Any]


class MorningCheckin(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    date: str = Field(default_factory=today_key)
    created_at: str = Field(default_factory=utcnow_iso)
    transcript: str
    weight_kg: Optional[float] = None
    bowel_movement: Optional[str] = None
    sleep_quality: Optional[str] = None


class ManualCheckin(BaseModel):
    weight_kg: Optional[float] = None
    bowel_movement: Optional[str] = None
    sleep_quality: Optional[str] = None
    energy: Optional[int] = None
    soreness: Optional[str] = None


class FoodEntry(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    date: str = Field(default_factory=today_key)
    created_at: str = Field(default_factory=utcnow_iso)
    source: str
    transcript: Optional[str] = None
    food_items: List[str] = []
    estimated_calories: int = 0
    protein_g: Optional[float] = None
    carbs_g: Optional[float] = None
    fat_g: Optional[float] = None
    notes: Optional[str] = None


class KitchenSuggestInput(BaseModel):
    items: List[str]


class SupplementLog(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    date: str = Field(default_factory=today_key)
    created_at: str = Field(default_factory=utcnow_iso)
    supplement_name: str


class HealthSample(BaseModel):
    date: str
    steps: int = 0
    active_energy_kcal: float = 0
    resting_hr: Optional[float] = None
    avg_hr: Optional[float] = None
    sleep_hours: Optional[float] = None
    workouts: int = 0


class ImagePayload(BaseModel):
    image_base64: str
    mime_type: str = "image/jpeg"


class WorkoutSetLog(BaseModel):
    exercise: str
    sets_done: int
    reps: str
    weight_kg: Optional[float] = None
    notes: Optional[str] = None

class WorkoutLog(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    date: str = Field(default_factory=today_key)
    created_at: str = Field(default_factory=utcnow_iso)
    day_label: Optional[str] = None
    exercise_name: str
    sets_done: int
    reps: str
    weight_kg: Optional[float] = None
    notes: Optional[str] = None


class SessionSet(BaseModel):
    r: Optional[int] = None  # reps
    w: Optional[float] = None  # weight kg

class SessionExercise(BaseModel):
    name: str
    equipment: Optional[str] = None
    sets: List[SessionSet] = []

class WorkoutSessionInput(BaseModel):
    session: str
    exercises: List[SessionExercise]


class BloodworkRecord(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    created_at: str = Field(default_factory=utcnow_iso)
    source: str  # "image" | "pdf" | "manual"
    markers: List[Dict[str, Any]] = []
    raw_extract: Optional[str] = None
    suggestions: Dict[str, Any] = {}


# ============== CLAUDE ==============

PLAN_SYSTEM_PROMPT = """You are an elite S&C coach and registered dietitian. Return ONLY valid JSON with these exact top-level keys:

- summary (string, 3-4 sentences)
- targets: { start_weight_kg:number, target_weight_kg:number, duration_months:int, weekly_rate_kg:number }
- training_split: { structure:string, table:[ { day:string, focus:string, is_rest_day:boolean, water_intake_ml:int, recovery_recommendations:[ { name, description } ], exercises:[ { name, exercise_type:"warmup"|"strength"|"cardio"|"cooldown", sets, reps, rest_between_sets_seconds:int, notes, demo_query:string, image_query:string, muscle_group:string } ] } ] }
  demo_query is a YouTube search string like "barbell back squat proper form" — a search string only, never a direct video URL. image_query is 2-3 words like "barbell squat". muscle_group ∈ {chest,back,legs,shoulders,arms,core,cardio}.
  On training days (is_rest_day=false): exercises MUST start with exactly 1 warmup entry, end with exactly 1 cardio or cooldown entry, with strength exercises in between. rest_between_sets_seconds must be a realistic number per exercise (e.g. 60-90 for strength, 0 for warmup/cardio). recovery_recommendations must be an empty array.
  On rest/recovery days (is_rest_day=true): exercises MUST be an empty array. recovery_recommendations must contain 2-3 very low-effort options (e.g. short walk, light stretching, foam rolling), each with a one-sentence description.
  water_intake_ml must be a realistic integer for that day (higher for training days, e.g. 500-1000; lower for rest days, e.g. 250-500).
- monthly_progression: [ { month:int, focus, weight_target_kg:number, volume_notes, intensity_notes } ]
- nutrition_framework: { daily_calories:int, protein_g:int, carbs_g:int, fat_g:int, meal_structure, cheat_day_rule, hydration_l:number }
- meal_plan: [ { meal:string (e.g. "Breakfast"), time_window:string, target_calories:int, target_protein_g:int, options:[ { name, description, calories:int, protein_g:int, carbs_g:int, fat_g:int, prep_time_min:int } ] } ]  provide EXACTLY 2 options per meal. HARD CONSTRAINT: every single option must strictly comply with the user's stated diet_type — if vegetarian, NEVER include meat, poultry, fish, or seafood in any option; if vegan, NEVER include any animal product including dairy, eggs, or honey; if eggetarian, eggs are fine but no meat/fish/poultry. This is non-negotiable regardless of other goals.
- supplement_stack: [ { name, dose, timing, purpose, priority:"core"|"situational", requires_bloodwork:boolean, target_marker:string|null } ]  mark supplements that depend on bloodwork readings (e.g. Vit D3 -> "vitamin_d")
- blood_panel: { recommended_tests:[string], frequency, flags_to_watch:[string], why_it_matters:string }
- weekly_rate_validation: { target_weekly_loss_kg:number, safe_range_kg:string, verdict:"safe"|"aggressive"|"unrealistic", explanation }
- injury_risk_flag: { level:"low"|"moderate"|"high", concerns:[string], movements_to_avoid:[string], substitutions:[{avoid,use}] }
- recovery_and_sleep: { sleep_target_hours:number, recovery_protocols:[string], deload_frequency }

Rules: JSON only, no markdown, no preamble. Populate every key. Keep output under ~13000 tokens."""


async def call_claude_json(
    system_prompt: str,
    user_text: str,
    session_id: str,
    image_b64: Optional[str] = None,
    mime_type: str = "image/jpeg",
    max_tokens: int = 12000,
) -> Dict[str, Any]:
    content: List[Dict[str, Any]] = []

    if image_b64:
        content.append({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": mime_type,
                "data": image_b64,
            },
        })

    content.append({"type": "text", "text": user_text})

    response = await anthropic_client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=max_tokens,
        system=system_prompt,
        messages=[{"role": "user", "content": content}],
    )

    text_block = next((block.text for block in response.content if getattr(block, "type", None) == "text"), None)
    if text_block is None:
        raise ValueError("No text content block found in Claude response")
    return extract_json(text_block)


async def transcribe_audio(audio_bytes: bytes, filename: str = "audio.m4a", mime: str = "audio/m4a") -> str:
    try:
        audio_file = io.BytesIO(audio_bytes)
        audio_file.name = filename
        result = await openai_client.audio.transcriptions.create(
            model="whisper-1",
            file=audio_file,
        )
        return result.text
    except Exception as e:
        logger.exception("Whisper transcription failed")
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")


# ============== ROUTES ==============

@api_router.get("/")
async def root():
    return {"app": "FitForge AI", "status": "ok"}


@api_router.post("/profile")
async def save_profile(payload: UserProfile):
    doc = payload.dict()
    await db.profile.update_one({}, {"$set": doc}, upsert=True)
    return doc

@api_router.get("/profile")
async def get_profile():
    doc = await db.profile.find_one({}, {"_id": 0})
    return doc or {}


NONVEG_KEYWORDS = [
    "chicken", "beef", "pork", "lamb", "mutton", "fish", "salmon", "tuna", "shrimp",
    "prawn", "crab", "turkey", "bacon", "ham", "meat", "seafood", "anchovy", "sausage", "gelatin",
]
VEGAN_EXTRA_KEYWORDS = ["egg", "milk", "cheese", "yogurt", "yoghurt", "paneer", "butter", "ghee", "honey", "cream", "whey"]

def find_diet_violations(plan_json: Dict[str, Any], diet_type: str) -> List[str]:
    dt = (diet_type or "").lower()
    if "vegan" in dt:
        banned = NONVEG_KEYWORDS + VEGAN_EXTRA_KEYWORDS
    elif "eggetarian" in dt:
        banned = NONVEG_KEYWORDS
    elif "vegetarian" in dt:
        banned = NONVEG_KEYWORDS + ["egg"]
    else:
        return []
    violations = []
    for meal in plan_json.get("meal_plan", []):
        for opt in meal.get("options", []):
            text = f"{opt.get('name','')} {opt.get('description','')}".lower()
            hit = next((k for k in banned if k in text), None)
            if hit:
                violations.append(f"{meal.get('meal','?')}: '{opt.get('name','?')}' (contains '{hit}')")
    return violations


@api_router.post("/plan/generate")
async def generate_plan(payload: PlanInput):
    try:
        meals_line = f", meals_per_day: {payload.diet.meals_per_day}" if payload.diet.meals_per_day else ""
        goals_line = f", goal_tags: {', '.join(payload.goals.goal_tags)}" if payload.goals.goal_tags else ""

        user_prompt = f"""Generate a full fat-loss + strength plan. Return valid JSON only per system schema.

BODY: {payload.body.current_weight_kg} kg -> {payload.body.target_weight_kg} kg, height {payload.body.height_cm} cm, age {payload.body.age}, sex {payload.body.sex}
TIMELINE: {payload.duration_months} months
TRAINING: {payload.training.days_per_week} days/wk, {payload.training.minutes_per_session} min/session, window: {payload.training.preferred_window}
DIET: type {payload.diet.diet_type}, pattern "{payload.diet.meal_pattern}", cheat: "{payload.diet.cheat_day_policy}"{meals_line}
INJURIES: {payload.injuries or 'None'}
GOALS: {payload.goals.aesthetic_goal}, focus {', '.join(payload.goals.focus_muscles)}, pace {payload.goals.pace}{goals_line}
SCHEDULE: {payload.daily_schedule}

For every exercise include demo_query (YouTube search string) and image_query (2-3 words for stock image). Provide 2-3 options per meal in meal_plan respecting diet_type. Mark supplements that depend on bloodwork with requires_bloodwork=true and target_marker (e.g. "vitamin_d","ferritin","testosterone")."""

        try:
            plan_json = await call_claude_json(
                PLAN_SYSTEM_PROMPT, user_prompt,
                session_id=f"plan-{uuid.uuid4()}", max_tokens=16000,
            )
        except (json.JSONDecodeError, ValueError):
            logger.warning("Plan JSON parse failed on first attempt, retrying once")
            plan_json = await call_claude_json(
                PLAN_SYSTEM_PROMPT, user_prompt,
                session_id=f"plan-retry-{uuid.uuid4()}", max_tokens=16000,
            )

        # Deterministic diet-compliance safety net — don't rely on the prompt alone for a
        # health/allergy-adjacent correctness issue.
        violations = find_diet_violations(plan_json, payload.diet.diet_type)
        if violations:
            logger.warning(f"Diet violations found, retrying with correction: {violations}")
            correction_prompt = user_prompt + (
                f"\n\nYour previous attempt incorrectly included these non-compliant items: "
                f"{'; '.join(violations)}. Regenerate the ENTIRE plan, making sure every single "
                f"meal_plan option strictly complies with diet_type={payload.diet.diet_type}."
            )
            plan_json = await call_claude_json(
                PLAN_SYSTEM_PROMPT, correction_prompt,
                session_id=f"plan-dietfix-{uuid.uuid4()}", max_tokens=16000,
            )
            violations = find_diet_violations(plan_json, payload.diet.diet_type)
            if violations:
                # Last resort: strip non-compliant options rather than serve them.
                logger.warning(f"Diet violations persisted after retry, filtering: {violations}")
                for meal in plan_json.get("meal_plan", []):
                    dt = (payload.diet.diet_type or "").lower()
                    banned = (
                        NONVEG_KEYWORDS + VEGAN_EXTRA_KEYWORDS if "vegan" in dt
                        else NONVEG_KEYWORDS if "eggetarian" in dt
                        else NONVEG_KEYWORDS + ["egg"] if "vegetarian" in dt
                        else []
                    )
                    if banned:
                        meal["options"] = [
                            o for o in meal.get("options", [])
                            if not any(k in f"{o.get('name','')} {o.get('description','')}".lower() for k in banned)
                        ] or meal.get("options", [])[:1]

        record = PlanRecord(input=payload.dict(), plan=plan_json)
        await db.plans.insert_one(record.dict())
        return {"id": record.id, "plan": plan_json, "created_at": record.created_at}
    except HTTPException:
        raise
    except json.JSONDecodeError:
        logger.exception("Plan JSON parse failed after retry")
        raise HTTPException(status_code=500, detail="Claude returned non-JSON twice. Try again.")
    except Exception:
        logger.exception("Plan generation failed")
        raise HTTPException(status_code=500, detail="Plan generation failed.")


@api_router.get("/plan/latest")
async def latest_plan():
    doc = await db.plans.find_one({}, {"_id": 0}, sort=[("created_at", -1)])
    if not doc:
        return {"plan": None}
    return doc


# ------ Transcription / Voice ------

@api_router.post("/transcribe")
async def transcribe_only(file: UploadFile = File(...)):
    audio_bytes = await file.read()
    text = await transcribe_audio(audio_bytes, file.filename or "audio.m4a", file.content_type or "audio/m4a")
    return {"text": text}


CHECKIN_SYSTEM_PROMPT = """Extract morning check-in data from a voice transcript. Return ONLY JSON:
{ "weight_kg": <number or null>, "bowel_movement": "<normal|loose|constipated|none|null>", "sleep_quality": "<poor|fair|good|excellent|null>" }
If field not mentioned, return null."""


@api_router.post("/checkin/morning")
async def morning_checkin(file: UploadFile = File(...)):
    try:
        audio_bytes = await file.read()
        transcript = await transcribe_audio(audio_bytes, file.filename or "checkin.m4a", file.content_type or "audio/m4a")
        parsed = await call_claude_json(
            CHECKIN_SYSTEM_PROMPT,
            f"Voice transcript: \"{transcript}\"\nExtract structured data.",
            session_id=f"checkin-{uuid.uuid4()}",
            max_tokens=500,
        )
        entry = MorningCheckin(
            transcript=transcript,
            weight_kg=parsed.get("weight_kg"),
            bowel_movement=parsed.get("bowel_movement"),
            sleep_quality=parsed.get("sleep_quality"),
        )
        await db.checkins.insert_one(entry.dict())
        return entry.dict()
    except HTTPException:
        raise
    except Exception:
        logger.exception("Morning checkin failed")
        raise HTTPException(status_code=500, detail="Check-in analysis failed.")


@api_router.post("/checkin/manual")
async def manual_checkin(payload: ManualCheckin):
    """Non-voice, tap-log check-in. Writes to the same `checkins` collection as the
    voice path so /api/overview's latest-weight logic picks it up automatically."""
    entry = {
        "id": str(uuid.uuid4()),
        "date": today_key(),
        "created_at": utcnow_iso(),
        "transcript": None,
        "weight_kg": payload.weight_kg,
        "bowel_movement": payload.bowel_movement,
        "sleep_quality": payload.sleep_quality,
        "energy": payload.energy,
        "soreness": payload.soreness,
    }
    await db.checkins.insert_one(entry)
    entry.pop("_id", None)
    return entry


FOOD_TEXT_PROMPT = """Dietitian. From food description, estimate calories/macros. Return ONLY JSON:
{ "food_items":[string], "estimated_calories":int, "protein_g":number, "carbs_g":number, "fat_g":number, "notes":string }"""

FOOD_IMAGE_PROMPT = """Dietitian analyzing a food photo. Identify visible items and estimate calories/macros. Return ONLY JSON:
{ "food_items":[string], "estimated_calories":int, "protein_g":number, "carbs_g":number, "fat_g":number, "notes":string }"""

KITCHEN_SUGGEST_PROMPT = """You are a dietitian. Given a list of ingredients the user currently has on hand, their diet type, and their daily nutrition targets, suggest ONE recipe that primarily uses those on-hand ingredients. Return ONLY JSON:
{ "name":string, "description":string, "calories":int, "protein_g":number, "carbs_g":number, "fat_g":number, "prep_time_min":int, "ingredients_used":[string], "ingredients_needed":[string], "steps":[string] }
ingredients_used must be a subset of the provided items that this recipe actually uses. ingredients_needed lists any additional common pantry items required that were NOT in the provided list (keep this short). steps should be 4-8 concise instructions.
HARD CONSTRAINT: the recipe must strictly comply with the user's stated diet type — if vegetarian, NEVER include meat, poultry, fish, or seafood; if vegan, NEVER include any animal product; if eggetarian, eggs are fine but no meat/fish/poultry. This is non-negotiable."""


@api_router.post("/food/log-voice")
async def food_log_voice(file: UploadFile = File(...)):
    try:
        audio_bytes = await file.read()
        transcript = await transcribe_audio(audio_bytes, file.filename or "food.m4a", file.content_type or "audio/m4a")
        parsed = await call_claude_json(
            FOOD_TEXT_PROMPT,
            f"Food eaten: \"{transcript}\"",
            session_id=f"food-{uuid.uuid4()}",
            max_tokens=500,
        )
        entry = FoodEntry(
            source="voice", transcript=transcript,
            food_items=parsed.get("food_items", []),
            estimated_calories=int(parsed.get("estimated_calories", 0)),
            protein_g=parsed.get("protein_g"), carbs_g=parsed.get("carbs_g"),
            fat_g=parsed.get("fat_g"), notes=parsed.get("notes"),
        )
        await db.food_logs.insert_one(entry.dict())
        return entry.dict()
    except HTTPException:
        raise
    except Exception:
        logger.exception("Food voice log failed")
        raise HTTPException(status_code=500, detail="Food voice analysis failed.")


@api_router.post("/food/log-image")
async def food_log_image(payload: ImagePayload):
    try:
        parsed = await call_claude_json(
            FOOD_IMAGE_PROMPT,
            "Analyse this food photo and estimate calories/macros. Return JSON only.",
            session_id=f"food-img-{uuid.uuid4()}",
            image_b64=payload.image_base64,
            mime_type=payload.mime_type,
            max_tokens=500,
        )
    except HTTPException:
        raise
    except Exception as ex:
        msg = str(ex).lower()
        if "could not process image" in msg or "invalid_request_error" in msg or "invalid image" in msg:
            parsed = {
                "food_items": ["unreadable image"],
                "estimated_calories": 0, "protein_g": 0, "carbs_g": 0, "fat_g": 0,
                "notes": "Could not read the food image. Please try again with better lighting.",
            }
        else:
            logger.exception("Food image log failed")
            raise HTTPException(status_code=500, detail="Food image analysis failed.")
    entry = FoodEntry(
        source="photo", transcript=None,
        food_items=parsed.get("food_items", []),
        estimated_calories=int(parsed.get("estimated_calories", 0)),
        protein_g=parsed.get("protein_g"), carbs_g=parsed.get("carbs_g"),
        fat_g=parsed.get("fat_g"), notes=parsed.get("notes"),
    )
    await db.food_logs.insert_one(entry.dict())
    return entry.dict()


# ------ Logs / Aggregates ------

async def _day_totals(date: str) -> Dict[str, Any]:
    food = await db.food_logs.find({"date": date}, {"_id": 0}).sort("created_at", -1).to_list(200)
    total_cal = sum(int(f.get("estimated_calories", 0)) for f in food)
    total_p = sum(float(f.get("protein_g") or 0) for f in food)
    total_c = sum(float(f.get("carbs_g") or 0) for f in food)
    total_f = sum(float(f.get("fat_g") or 0) for f in food)
    return {
        "food_entries": food,
        "totals": {
            "calories": total_cal,
            "protein_g": round(total_p, 1),
            "carbs_g": round(total_c, 1),
            "fat_g": round(total_f, 1),
        },
    }

@api_router.get("/logs/today")
async def logs_today():
    date = today_key()
    day = await _day_totals(date)
    checkin = await db.checkins.find_one({"date": date}, {"_id": 0}, sort=[("created_at", -1)])
    health = await db.health_samples.find_one({"date": date}, {"_id": 0}, sort=[("_id", -1)])
    return {"date": date, **day, "morning_checkin": checkin, "health": health}


@api_router.get("/overview")
async def overview():
    today = today_key()
    yday = yesterday_key()
    tday = await _day_totals(today)
    yday_data = await _day_totals(yday)
    checkin = await db.checkins.find_one({"date": today}, {"_id": 0}, sort=[("created_at", -1)])
    latest_checkin = await db.checkins.find_one({}, {"_id": 0}, sort=[("created_at", -1)])
    health = await db.health_samples.find_one({"date": today}, {"_id": 0}, sort=[("_id", -1)])
    plan_doc = await db.plans.find_one({}, {"_id": 0}, sort=[("created_at", -1)])
    nutri = (plan_doc or {}).get("plan", {}).get("nutrition_framework")
    targets = (plan_doc or {}).get("plan", {}).get("targets")
    return {
        "date": today,
        "today": tday,
        "yesterday": {"date": yday, "totals": yday_data["totals"]},
        "morning_checkin": checkin,
        "latest_weight": (checkin or latest_checkin or {}).get("weight_kg"),
        "health": health,
        "targets": targets,
        "nutrition_targets": nutri,
    }


@api_router.delete("/food/{entry_id}")
async def delete_food(entry_id: str):
    res = await db.food_logs.delete_one({"id": entry_id})
    return {"deleted": res.deleted_count}


@api_router.post("/health/sync")
async def sync_health(sample: HealthSample):
    doc = sample.dict()
    doc["updated_at"] = utcnow_iso()
    await db.health_samples.update_one({"date": sample.date}, {"$set": doc}, upsert=True)
    doc.pop("_id", None)
    return doc


# ------ Workout logging ------

@api_router.post("/workouts/log")
async def log_workout(payload: WorkoutLog):
    doc = payload.dict()
    await db.workout_logs.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api_router.post("/workouts/log-session")
async def log_workout_session(payload: WorkoutSessionInput):
    """Logs a full workout session (multiple exercises, each with its own sets) in one call.
    Writes one workout_logs document per exercise so existing /workouts/today and
    /workouts/history endpoints keep working unchanged."""
    date = today_key()
    saved = []
    for ex in payload.exercises:
        sets_done = len(ex.sets)
        reps_str = ",".join(str(s.r) for s in ex.sets if s.r is not None)
        weight_kg = next((s.w for s in reversed(ex.sets) if s.w is not None), None)
        doc = {
            "id": str(uuid.uuid4()),
            "date": date,
            "created_at": utcnow_iso(),
            "day_label": payload.session,
            "exercise_name": ex.name,
            "sets_done": sets_done,
            "reps": reps_str,
            "weight_kg": weight_kg,
            "notes": ex.equipment,
        }
        await db.workout_logs.insert_one(doc)
        doc.pop("_id", None)
        saved.append(doc)
    return {"date": date, "session": payload.session, "logged": saved}

@api_router.get("/workouts/today")
async def workouts_today():
    date = today_key()
    logs = await db.workout_logs.find({"date": date}, {"_id": 0}).sort("created_at", 1).to_list(200)
    return {"date": date, "logs": logs}

@api_router.get("/workouts/history")
async def workouts_history(days: int = 14):
    logs = await db.workout_logs.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return {"logs": logs[: days * 20]}

@api_router.delete("/workouts/{log_id}")
async def delete_workout(log_id: str):
    res = await db.workout_logs.delete_one({"id": log_id})
    return {"deleted": res.deleted_count}


# ------ Bloodwork ------

BLOODWORK_PROMPT = """You are a physician analysing a blood test report. Extract measurable markers and produce tailored advice.
Return ONLY valid JSON with this exact schema:
{
  "markers": [ { "name":string, "value":number|string, "unit":string, "reference_range":string|null, "flag":"low"|"normal"|"high"|"unknown" } ],
  "summary": { "normal_count":int, "flagged_count":int, "unknown_count":int },
  "abnormal_findings": [ { "marker":string, "finding":string, "clinical_significance":string } ],
  "supplement_recommendations": [
    { "name":string, "dose":string, "timing":string, "rationale":string, "based_on_marker":string, "priority":"high"|"medium"|"low" }
  ],
  "lifestyle_recommendations": [ string ],
  "dietary_recommendations": [ string ],
  "retest_in_weeks": int,
  "flags_for_doctor": [ string ],
  "overall_summary": string
}
CRITICAL flagging rules — do not skip this step:
1. reference_range must be copied verbatim from the source report for every marker where a range is printed. Never leave it null if the report shows one.
2. For every marker, explicitly compare its numeric value against the low/high bounds of its reference_range before assigning flag. A value below the low bound is "low", above the high bound is "high", within bounds is "normal". Only use "unknown" if the report genuinely provides no reference range to compare against — never default to "normal" without actually performing this comparison.
3. summary must be computed by counting the actual flags in the markers array (normal_count = markers with flag "normal", flagged_count = markers with flag "high" or "low", unknown_count = markers with flag "unknown"). These numbers must be internally consistent with the markers list — never guess or leave at zero if markers exist.
Ground every recommendation in a specific marker reading. If report unclear or unreadable, return markers:[], summary with all zeros, and set overall_summary explaining what you couldn't parse."""


@api_router.post("/bloodwork/upload-image")
async def bloodwork_upload_image(payload: ImagePayload):
    try:
        parsed = await call_claude_json(
            BLOODWORK_PROMPT,
            "Analyse this blood report image. Extract all readable markers with values, units and flags. Return JSON only.",
            session_id=f"blood-img-{uuid.uuid4()}",
            image_b64=payload.image_base64,
            mime_type=payload.mime_type,
            max_tokens=4000,
        )
    except HTTPException:
        raise
    except Exception as ex:
        msg = str(ex).lower()
        if "could not process image" in msg or "invalid_request_error" in msg or "invalid image" in msg:
            parsed = {
                "markers": [],
                "abnormal_findings": [],
                "supplement_recommendations": [],
                "lifestyle_recommendations": [],
                "dietary_recommendations": [],
                "retest_in_weeks": 0,
                "flags_for_doctor": [],
                "overall_summary": "Could not read the report image. Please retake the photo in good light with the report flat and text sharp, or upload a PDF.",
            }
        else:
            logger.exception("Bloodwork image failed")
            raise HTTPException(status_code=500, detail="Bloodwork image analysis failed.")

    record = BloodworkRecord(
        source="image",
        markers=parsed.get("markers", []),
        raw_extract=None,
        suggestions=parsed,
    )
    await db.bloodwork.insert_one(record.dict())
    return record.dict()


@api_router.post("/bloodwork/upload-pdf")
async def bloodwork_upload_pdf(file: UploadFile = File(...)):
    try:
        raw = await file.read()
        try:
            reader = PdfReader(io.BytesIO(raw))
            text = "\n".join((p.extract_text() or "") for p in reader.pages)
        except Exception:
            raise HTTPException(status_code=400, detail="Unable to read PDF.")
        if not text.strip():
            raise HTTPException(status_code=400, detail="PDF appears empty or is image-only. Use the photo upload instead.")

        parsed = await call_claude_json(
            BLOODWORK_PROMPT,
            f"Blood report text extracted from PDF:\n\n{text[:15000]}\n\nAnalyse and return JSON only.",
            session_id=f"blood-pdf-{uuid.uuid4()}",
            max_tokens=4000,
        )
        record = BloodworkRecord(
            source="pdf",
            markers=parsed.get("markers", []),
            raw_extract=text[:5000],
            suggestions=parsed,
        )
        await db.bloodwork.insert_one(record.dict())
        return record.dict()
    except HTTPException:
        raise
    except Exception:
        logger.exception("Bloodwork PDF failed")
        raise HTTPException(status_code=500, detail="Bloodwork PDF analysis failed.")


@api_router.get("/bloodwork/latest")
async def bloodwork_latest():
    doc = await db.bloodwork.find_one({}, {"_id": 0}, sort=[("created_at", -1)])
    return doc or {}


@api_router.delete("/bloodwork/{record_id}")
async def bloodwork_delete(record_id: str):
    res = await db.bloodwork.delete_one({"id": record_id})
    return {"deleted": res.deleted_count}


# ------ Kitchen-based recipe suggestion ------

@api_router.post("/nutrition/kitchen-suggest")
async def kitchen_suggest(payload: KitchenSuggestInput):
    try:
        plan_doc = await db.plans.find_one({}, {"_id": 0}, sort=[("created_at", -1)])
        nutri = (plan_doc or {}).get("plan", {}).get("nutrition_framework", {})
        diet_type = (plan_doc or {}).get("input", {}).get("diet", {}).get("diet_type", "no restriction stated")
        user_prompt = (
            f"Ingredients on hand: {', '.join(payload.items) if payload.items else 'none listed'}\n"
            f"User's diet type (MUST strictly follow): {diet_type}\n"
            f"User's daily nutrition targets: {json.dumps(nutri)}\n"
            "Suggest one recipe using mostly these ingredients, strictly respecting the diet type above."
        )
        result = await call_claude_json(
            KITCHEN_SUGGEST_PROMPT, user_prompt,
            session_id=f"kitchen-{uuid.uuid4()}", max_tokens=1500,
        )
        return result
    except HTTPException:
        raise
    except Exception:
        logger.exception("Kitchen suggest failed")
        raise HTTPException(status_code=500, detail="Could not generate a kitchen-based suggestion.")


# ------ Supplement logging ------

@api_router.post("/supplements/log")
async def log_supplement(payload: SupplementLog):
    doc = payload.dict()
    await db.supplement_logs.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api_router.get("/supplements/today")
async def supplements_today():
    date = today_key()
    logs = await db.supplement_logs.find({"date": date}, {"_id": 0}).to_list(100)
    return {"date": date, "taken": [l["supplement_name"] for l in logs], "logs": logs}

@api_router.delete("/supplements/{log_id}")
async def delete_supplement_log(log_id: str):
    res = await db.supplement_logs.delete_one({"id": log_id})
    return {"deleted": res.deleted_count}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware, allow_credentials=True,
    allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    mongo_client.close()