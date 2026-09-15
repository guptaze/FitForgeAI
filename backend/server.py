from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File, Header, Depends
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
from pywebpush import webpush, WebPushException
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
import bcrypt
import jwt as pyjwt

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

MONGO_URL = os.environ['MONGO_URL']
DB_NAME = os.environ['DB_NAME']
ANTHROPIC_API_KEY = os.environ['ANTHROPIC_API_KEY']
OPENAI_API_KEY = os.environ['OPENAI_API_KEY']          # replaces EMERGENT_LLM_KEY
CLAUDE_MODEL = os.environ.get('CLAUDE_MODEL', 'claude-sonnet-5')
VAPID_PRIVATE_KEY = os.environ.get('VAPID_PRIVATE_KEY', '')
VAPID_PUBLIC_KEY = os.environ.get('VAPID_PUBLIC_KEY', '')
VAPID_CONTACT_EMAIL = os.environ.get('VAPID_CONTACT_EMAIL', 'mailto:admin@fitforgeai.app')
JWT_SECRET = os.environ.get('JWT_SECRET', 'insecure-dev-secret-change-me')
JWT_ALGO = "HS256"

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


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), password_hash.encode())
    except Exception:
        return False

def create_token(user_id: str) -> str:
    payload = {"user_id": user_id, "exp": datetime.now(timezone.utc) + timedelta(days=30)}
    return pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)

async def get_current_user_id(authorization: Optional[str] = Header(None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated. Please log in.")
    token = authorization.split(" ", 1)[1]
    try:
        payload = pyjwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
        return payload["user_id"]
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired. Please log in again.")
    except pyjwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid session. Please log in again.")


# ============== MODELS ==============

class UserAccount(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    email: str
    password_hash: str
    name: str
    created_at: str = Field(default_factory=utcnow_iso)

class RegisterInput(BaseModel):
    email: str
    password: str
    name: str

class LoginInput(BaseModel):
    email: str
    password: str


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
    foods_to_avoid: List[str] = []

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


class FoodTextInput(BaseModel):
    description: str


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
- meal_plan: [ { meal:string (e.g. "Breakfast"), time_window:string, target_calories:int, target_protein_g:int, options:[ { name, description, calories:int, protein_g:int, carbs_g:int, fat_g:int, prep_time_min:int, common_substitutions:string } ] } ]  provide 4 distinct options per meal (varied cuisines/prep styles, not near-duplicates), each with a common_substitutions note (1 short sentence on an easy swap, e.g. "swap paneer for tofu for a lighter version"). HARD CONSTRAINT: every single option must strictly comply with the user's stated diet_type — if vegetarian, NEVER include meat, poultry, fish, or seafood in any option; if vegan, NEVER include any animal product including dairy, eggs, or honey; if eggetarian, eggs are fine but no meat/fish/poultry. This is non-negotiable regardless of other goals.
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


# ------ Auth ------

@api_router.post("/auth/register")
async def register(payload: RegisterInput):
    email = payload.email.lower().strip()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Please enter a valid email address.")
    if len(payload.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="An account with this email already exists.")
    user = UserAccount(email=email, password_hash=hash_password(payload.password), name=payload.name.strip())
    await db.users.insert_one(user.dict())
    token = create_token(user.id)
    return {"token": token, "user": {"id": user.id, "email": user.email, "name": user.name}}


@api_router.post("/auth/login")
async def login(payload: LoginInput):
    email = payload.email.lower().strip()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password.")
    token = create_token(user["id"])
    return {"token": token, "user": {"id": user["id"], "email": user["email"], "name": user["name"]}}


@api_router.get("/auth/me")
async def get_me(user_id: str = Depends(get_current_user_id)):
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    return user


@api_router.post("/profile")
async def save_profile(payload: UserProfile, user_id: str = Depends(get_current_user_id)):
    doc = payload.dict()
    doc["user_id"] = user_id
    await db.profile.update_one({"user_id": user_id}, {"$set": doc}, upsert=True)
    return doc

@api_router.get("/profile")
async def get_profile(user_id: str = Depends(get_current_user_id)):
    doc = await db.profile.find_one({"user_id": user_id}, {"_id": 0})
    return doc or {}


NONVEG_KEYWORDS = [
    "chicken", "beef", "pork", "lamb", "mutton", "fish", "salmon", "tuna", "shrimp",
    "prawn", "crab", "turkey", "bacon", "ham", "meat", "seafood", "anchovy", "sausage", "gelatin",
]
VEGAN_EXTRA_KEYWORDS = ["egg", "milk", "cheese", "yogurt", "yoghurt", "paneer", "butter", "ghee", "honey", "cream", "whey"]

def normalize_diet_type(diet_type: str) -> str:
    dt = (diet_type or "").strip().lower()
    if "non-veg" in dt or "non veg" in dt or "nonveg" in dt or "pescatarian" in dt or "omnivore" in dt:
        return "none"
    if "vegan" in dt:
        return "vegan"
    if "eggetarian" in dt:
        return "eggetarian"
    if "vegetarian" in dt or dt == "veg" or dt.startswith("veg "):
        return "vegetarian"
    return "none"

def banned_keywords_for_diet(diet_type: str) -> List[str]:
    norm = normalize_diet_type(diet_type)
    if norm == "vegan":
        return NONVEG_KEYWORDS + VEGAN_EXTRA_KEYWORDS
    if norm == "eggetarian":
        return NONVEG_KEYWORDS
    if norm == "vegetarian":
        return NONVEG_KEYWORDS + ["egg"]
    return []

def text_violates_diet(name: str, description: str, diet_type: str, extra_avoid: List[str] = None) -> Optional[str]:
    banned = banned_keywords_for_diet(diet_type) + [w.lower().strip() for w in (extra_avoid or []) if w.strip()]
    if not banned:
        return None
    text = f"{name or ''} {description or ''}".lower()
    # Word-boundary matching, not raw substring — "egg" must not match inside "veggies",
    # "meat" must not match inside "oatmeal", etc.
    for k in banned:
        if re.search(r'\b' + re.escape(k) + r'\b', text):
            return k
    return None

def find_diet_violations(plan_json: Dict[str, Any], diet_type: str, extra_avoid: List[str] = None) -> List[str]:
    banned = banned_keywords_for_diet(diet_type) + [w.lower().strip() for w in (extra_avoid or []) if w.strip()]
    if not banned:
        return []
    violations = []
    for meal in plan_json.get("meal_plan", []):
        for opt in meal.get("options", []):
            hit = text_violates_diet(opt.get("name", ""), opt.get("description", ""), diet_type, extra_avoid)
            if hit:
                violations.append(f"{meal.get('meal','?')}: '{opt.get('name','?')}' (contains '{hit}')")
    return violations


@api_router.post("/plan/generate")
async def generate_plan(payload: PlanInput, user_id: str = Depends(get_current_user_id)):
    try:
        meals_line = f", meals_per_day: {payload.diet.meals_per_day}" if payload.diet.meals_per_day else ""
        goals_line = f", goal_tags: {', '.join(payload.goals.goal_tags)}" if payload.goals.goal_tags else ""
        avoid_line = f"\nFOODS TO AVOID (HARD CONSTRAINT, never include any of these in any meal option): {', '.join(payload.diet.foods_to_avoid)}" if payload.diet.foods_to_avoid else ""

        user_prompt = f"""Generate a full fat-loss + strength plan. Return valid JSON only per system schema.

BODY: {payload.body.current_weight_kg} kg -> {payload.body.target_weight_kg} kg, height {payload.body.height_cm} cm, age {payload.body.age}, sex {payload.body.sex}
TIMELINE: {payload.duration_months} months
TRAINING: {payload.training.days_per_week} days/wk, {payload.training.minutes_per_session} min/session, window: {payload.training.preferred_window}
DIET: type {payload.diet.diet_type}, pattern "{payload.diet.meal_pattern}", cheat: "{payload.diet.cheat_day_policy}"{meals_line}{avoid_line}
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
        # health/allergy-adjacent correctness issue. Covers both the diet_type category
        # AND the user's own custom foods_to_avoid list.
        logger.info(
            f"Diet check: raw diet_type='{payload.diet.diet_type}' "
            f"normalized='{normalize_diet_type(payload.diet.diet_type)}' "
            f"banned_keywords={len(banned_keywords_for_diet(payload.diet.diet_type))} "
            f"foods_to_avoid={payload.diet.foods_to_avoid}"
        )
        violations = find_diet_violations(plan_json, payload.diet.diet_type, payload.diet.foods_to_avoid)
        if violations:
            logger.warning(f"Diet violations found, retrying with correction: {violations}")
            correction_prompt = user_prompt + (
                f"\n\nYour previous attempt incorrectly included these non-compliant items: "
                f"{'; '.join(violations)}. Regenerate the ENTIRE plan, making sure every single "
                f"meal_plan option strictly complies with diet_type={payload.diet.diet_type} "
                f"and avoids: {', '.join(payload.diet.foods_to_avoid) if payload.diet.foods_to_avoid else '(none)'}."
            )
            plan_json = await call_claude_json(
                PLAN_SYSTEM_PROMPT, correction_prompt,
                session_id=f"plan-dietfix-{uuid.uuid4()}", max_tokens=16000,
            )
            violations = find_diet_violations(plan_json, payload.diet.diet_type, payload.diet.foods_to_avoid)
            if violations:
                # Last resort: strip non-compliant options rather than serve them.
                logger.warning(f"Diet violations persisted after retry, filtering: {violations}")
                banned = banned_keywords_for_diet(payload.diet.diet_type) + payload.diet.foods_to_avoid
                if banned:
                    for meal in plan_json.get("meal_plan", []):
                        meal["options"] = [
                            o for o in meal.get("options", [])
                            if not text_violates_diet(o.get("name", ""), o.get("description", ""), payload.diet.diet_type, payload.diet.foods_to_avoid)
                        ] or meal.get("options", [])[:1]

        record = PlanRecord(input=payload.dict(), plan=plan_json)
        doc = record.dict()
        doc["user_id"] = user_id
        await db.plans.insert_one(doc)
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
async def latest_plan(user_id: str = Depends(get_current_user_id)):
    doc = await db.plans.find_one({"user_id": user_id}, {"_id": 0}, sort=[("created_at", -1)])
    if not doc:
        return {"plan": None}
    # Defensive filter: clean non-compliant meal options on every READ, not just at
    # generation time. Catches old cached plans, frontend hiccups, or any future gap —
    # uses the diet_type/foods_to_avoid actually stored with this plan, so it's correct
    # regardless of what happened when it was generated.
    diet_input = (doc.get("input") or {}).get("diet") or {}
    diet_type = diet_input.get("diet_type", "")
    foods_to_avoid = diet_input.get("foods_to_avoid", [])
    banned = banned_keywords_for_diet(diet_type) + [w.lower().strip() for w in (foods_to_avoid or []) if w.strip()]
    total_removed = 0
    logger.info(
        f"Plan read filter: plan_created_at='{doc.get('created_at')}' "
        f"stored_diet_type='{diet_type}' stored_foods_to_avoid={foods_to_avoid} "
        f"banned_count={len(banned)} has_meal_plan={bool(doc.get('plan', {}).get('meal_plan'))}"
    )
    if banned and doc.get("plan", {}).get("meal_plan"):
        for meal in doc["plan"]["meal_plan"]:
            before = len(meal.get("options", []))
            clean = [
                o for o in meal.get("options", [])
                if not text_violates_diet(o.get("name", ""), o.get("description", ""), diet_type, foods_to_avoid)
            ]
            total_removed += before - len(clean)
            if clean:
                meal["options"] = clean
            # If every option happened to violate (shouldn't happen, but don't leave the
            # meal empty) — leave the original options in place rather than showing nothing.
    logger.info(f"Plan read filter: removed {total_removed} non-compliant option(s) on this read")
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
async def morning_checkin(file: UploadFile = File(...), user_id: str = Depends(get_current_user_id)):
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
        doc = entry.dict()
        doc["user_id"] = user_id
        await db.checkins.insert_one(doc)
        return entry.dict()
    except HTTPException:
        raise
    except Exception:
        logger.exception("Morning checkin failed")
        raise HTTPException(status_code=500, detail="Check-in analysis failed.")


@api_router.post("/checkin/manual")
async def manual_checkin(payload: ManualCheckin, user_id: str = Depends(get_current_user_id)):
    """Non-voice, tap-log check-in. Writes to the same `checkins` collection as the
    voice path so /api/overview's latest-weight logic picks it up automatically."""
    entry = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
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


@api_router.post("/food/log-text")
async def food_log_text(payload: FoodTextInput, user_id: str = Depends(get_current_user_id)):
    try:
        parsed = await call_claude_json(
            FOOD_TEXT_PROMPT,
            f"Food eaten: \"{payload.description}\"",
            session_id=f"food-text-{uuid.uuid4()}",
            max_tokens=500,
        )
        entry = FoodEntry(
            source="text", transcript=payload.description,
            food_items=parsed.get("food_items", []),
            estimated_calories=int(parsed.get("estimated_calories", 0)),
            protein_g=parsed.get("protein_g"), carbs_g=parsed.get("carbs_g"),
            fat_g=parsed.get("fat_g"), notes=parsed.get("notes"),
        )
        doc = entry.dict()
        doc["user_id"] = user_id
        await db.food_logs.insert_one(doc)
        doc.pop("_id", None)
        return doc
    except HTTPException:
        raise
    except Exception:
        logger.exception("Food text log failed")
        raise HTTPException(status_code=500, detail="Food text analysis failed.")


@api_router.post("/food/log-voice")
async def food_log_voice(file: UploadFile = File(...), user_id: str = Depends(get_current_user_id)):
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
        doc = entry.dict()
        doc["user_id"] = user_id
        await db.food_logs.insert_one(doc)
        return entry.dict()
    except HTTPException:
        raise
    except Exception:
        logger.exception("Food voice log failed")
        raise HTTPException(status_code=500, detail="Food voice analysis failed.")


@api_router.post("/food/log-image")
async def food_log_image(payload: ImagePayload, user_id: str = Depends(get_current_user_id)):
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
    doc = entry.dict()
    doc["user_id"] = user_id
    await db.food_logs.insert_one(doc)
    return entry.dict()


# ------ Logs / Aggregates ------

async def _day_totals(date: str, user_id: str) -> Dict[str, Any]:
    food = await db.food_logs.find({"date": date, "user_id": user_id}, {"_id": 0}).sort("created_at", -1).to_list(200)
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
async def logs_today(user_id: str = Depends(get_current_user_id)):
    date = today_key()
    day = await _day_totals(date, user_id)
    checkin = await db.checkins.find_one({"date": date, "user_id": user_id}, {"_id": 0}, sort=[("created_at", -1)])
    health = await db.health_samples.find_one({"date": date, "user_id": user_id}, {"_id": 0}, sort=[("_id", -1)])
    return {"date": date, **day, "morning_checkin": checkin, "health": health}


@api_router.get("/logs/day")
async def logs_by_date(date: str, user_id: str = Depends(get_current_user_id)):
    """Full detail log sheet for any specific date (YYYY-MM-DD) — food, check-in,
    workouts, and supplements taken that day."""
    day = await _day_totals(date, user_id)
    checkin = await db.checkins.find_one({"date": date, "user_id": user_id}, {"_id": 0}, sort=[("created_at", -1)])
    workouts = await db.workout_logs.find({"date": date, "user_id": user_id}, {"_id": 0}).sort("created_at", 1).to_list(200)
    supplements = await db.supplement_logs.find({"date": date, "user_id": user_id}, {"_id": 0}).to_list(100)
    health = await db.health_samples.find_one({"date": date, "user_id": user_id}, {"_id": 0}, sort=[("_id", -1)])
    return {
        "date": date, **day,
        "morning_checkin": checkin,
        "workouts": workouts,
        "supplements_taken": [s["supplement_name"] for s in supplements],
        "health": health,
    }


@api_router.get("/history")
async def history(days: int = 30, user_id: str = Depends(get_current_user_id)):
    """Aggregated daily data across a date range, for charting weight/calorie/macro/
    workout/supplement trends. Frontend picks `days` per filter: 7 for weekly, 30 for
    monthly, 365 for yearly."""
    start_date = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")

    checkins = await db.checkins.find(
        {"date": {"$gte": start_date}, "user_id": user_id}, {"_id": 0}
    ).sort("date", 1).to_list(days + 50)
    weight_by_date: Dict[str, float] = {}
    for c in checkins:
        if c.get("weight_kg") is not None:
            weight_by_date[c["date"]] = c["weight_kg"]

    food_logs = await db.food_logs.find(
        {"date": {"$gte": start_date}, "user_id": user_id}, {"_id": 0}
    ).to_list(10000)
    food_by_date: Dict[str, Dict[str, float]] = {}
    for f in food_logs:
        d = f["date"]
        agg = food_by_date.setdefault(d, {"calories": 0, "protein_g": 0.0, "carbs_g": 0.0, "fat_g": 0.0})
        agg["calories"] += int(f.get("estimated_calories", 0))
        agg["protein_g"] += float(f.get("protein_g") or 0)
        agg["carbs_g"] += float(f.get("carbs_g") or 0)
        agg["fat_g"] += float(f.get("fat_g") or 0)

    workouts = await db.workout_logs.find(
        {"date": {"$gte": start_date}, "user_id": user_id}, {"_id": 0}
    ).to_list(10000)
    workout_by_date: Dict[str, int] = {}
    for w in workouts:
        workout_by_date[w["date"]] = workout_by_date.get(w["date"], 0) + 1

    supp_logs = await db.supplement_logs.find(
        {"date": {"$gte": start_date}, "user_id": user_id}, {"_id": 0}
    ).to_list(10000)
    supp_by_date: Dict[str, set] = {}
    for s in supp_logs:
        supp_by_date.setdefault(s["date"], set()).add(s["supplement_name"])

    all_dates = sorted(set(weight_by_date) | set(food_by_date) | set(workout_by_date) | set(supp_by_date))
    entries = []
    for d in all_dates:
        fd = food_by_date.get(d, {})
        entries.append({
            "date": d,
            "weight_kg": weight_by_date.get(d),
            "calories": fd.get("calories"),
            "protein_g": round(fd["protein_g"], 1) if "protein_g" in fd else None,
            "carbs_g": round(fd["carbs_g"], 1) if "carbs_g" in fd else None,
            "fat_g": round(fd["fat_g"], 1) if "fat_g" in fd else None,
            "workout_count": workout_by_date.get(d, 0),
            "supplements_taken": len(supp_by_date.get(d, [])),
        })

    plan_doc = await db.plans.find_one({"user_id": user_id}, {"_id": 0}, sort=[("created_at", -1)])
    goal_weight_kg = (plan_doc or {}).get("input", {}).get("body", {}).get("target_weight_kg")

    return {"days_requested": days, "goal_weight_kg": goal_weight_kg, "entries": entries}


@api_router.get("/overview")
async def overview(user_id: str = Depends(get_current_user_id)):
    today = today_key()
    yday = yesterday_key()
    tday = await _day_totals(today, user_id)
    yday_data = await _day_totals(yday, user_id)
    checkin = await db.checkins.find_one({"date": today, "user_id": user_id}, {"_id": 0}, sort=[("created_at", -1)])
    latest_checkin = await db.checkins.find_one({"user_id": user_id}, {"_id": 0}, sort=[("created_at", -1)])
    health = await db.health_samples.find_one({"date": today, "user_id": user_id}, {"_id": 0}, sort=[("_id", -1)])
    plan_doc = await db.plans.find_one({"user_id": user_id}, {"_id": 0}, sort=[("created_at", -1)])
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
async def delete_food(entry_id: str, user_id: str = Depends(get_current_user_id)):
    res = await db.food_logs.delete_one({"id": entry_id, "user_id": user_id})
    return {"deleted": res.deleted_count}


@api_router.post("/health/sync")
async def sync_health(sample: HealthSample, user_id: str = Depends(get_current_user_id)):
    doc = sample.dict()
    doc["updated_at"] = utcnow_iso()
    doc["user_id"] = user_id
    await db.health_samples.update_one({"date": sample.date, "user_id": user_id}, {"$set": doc}, upsert=True)
    doc.pop("_id", None)
    return doc


# ------ Workout logging ------

@api_router.post("/workouts/log")
async def log_workout(payload: WorkoutLog, user_id: str = Depends(get_current_user_id)):
    doc = payload.dict()
    doc["user_id"] = user_id
    await db.workout_logs.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api_router.post("/workouts/log-session")
async def log_workout_session(payload: WorkoutSessionInput, user_id: str = Depends(get_current_user_id)):
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
            "user_id": user_id,
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
async def workouts_today(user_id: str = Depends(get_current_user_id)):
    date = today_key()
    logs = await db.workout_logs.find({"date": date, "user_id": user_id}, {"_id": 0}).sort("created_at", 1).to_list(200)
    return {"date": date, "logs": logs}

@api_router.get("/workouts/history")
async def workouts_history(days: int = 14, user_id: str = Depends(get_current_user_id)):
    logs = await db.workout_logs.find({"user_id": user_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return {"logs": logs[: days * 20]}

@api_router.delete("/workouts/{log_id}")
async def delete_workout(log_id: str, user_id: str = Depends(get_current_user_id)):
    res = await db.workout_logs.delete_one({"id": log_id, "user_id": user_id})
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
async def bloodwork_upload_image(payload: ImagePayload, user_id: str = Depends(get_current_user_id)):
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
    doc = record.dict()
    doc["user_id"] = user_id
    await db.bloodwork.insert_one(doc)
    return record.dict()


@api_router.post("/bloodwork/upload-pdf")
async def bloodwork_upload_pdf(file: UploadFile = File(...), user_id: str = Depends(get_current_user_id)):
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
        doc = record.dict()
        doc["user_id"] = user_id
        await db.bloodwork.insert_one(doc)
        return record.dict()
    except HTTPException:
        raise
    except Exception:
        logger.exception("Bloodwork PDF failed")
        raise HTTPException(status_code=500, detail="Bloodwork PDF analysis failed.")


@api_router.get("/bloodwork/latest")
async def bloodwork_latest(user_id: str = Depends(get_current_user_id)):
    doc = await db.bloodwork.find_one({"user_id": user_id}, {"_id": 0}, sort=[("created_at", -1)])
    return doc or {}


@api_router.delete("/bloodwork/{record_id}")
async def bloodwork_delete(record_id: str, user_id: str = Depends(get_current_user_id)):
    res = await db.bloodwork.delete_one({"id": record_id, "user_id": user_id})
    return {"deleted": res.deleted_count}


# ------ Kitchen-based recipe suggestion ------

@api_router.post("/nutrition/kitchen-suggest")
async def kitchen_suggest(payload: KitchenSuggestInput, user_id: str = Depends(get_current_user_id)):
    try:
        plan_doc = await db.plans.find_one({"user_id": user_id}, {"_id": 0}, sort=[("created_at", -1)])
        nutri = (plan_doc or {}).get("plan", {}).get("nutrition_framework", {})
        diet_type = (plan_doc or {}).get("input", {}).get("diet", {}).get("diet_type", "no restriction stated")
        foods_to_avoid = (plan_doc or {}).get("input", {}).get("diet", {}).get("foods_to_avoid", [])
        avoid_line = f"\nFoods to avoid (MUST strictly follow): {', '.join(foods_to_avoid)}" if foods_to_avoid else ""
        user_prompt = (
            f"Ingredients on hand: {', '.join(payload.items) if payload.items else 'none listed'}\n"
            f"User's diet type (MUST strictly follow): {diet_type}{avoid_line}\n"
            f"User's daily nutrition targets: {json.dumps(nutri)}\n"
            "Suggest one recipe using mostly these ingredients, strictly respecting the diet type and avoid-list above."
        )
        result = await call_claude_json(
            KITCHEN_SUGGEST_PROMPT, user_prompt,
            session_id=f"kitchen-{uuid.uuid4()}", max_tokens=1500,
        )

        hit = text_violates_diet(result.get("name", ""), result.get("description", ""), diet_type, foods_to_avoid)
        if hit:
            logger.warning(f"Kitchen suggestion violated diet ({hit}), retrying")
            correction_prompt = user_prompt + (
                f"\n\nYour previous suggestion incorrectly contained '{hit}', which violates diet type "
                f"{diet_type} or the avoid-list. Suggest a different recipe that strictly complies."
            )
            result = await call_claude_json(
                KITCHEN_SUGGEST_PROMPT, correction_prompt,
                session_id=f"kitchen-dietfix-{uuid.uuid4()}", max_tokens=1500,
            )

        return result
    except HTTPException:
        raise
    except Exception:
        logger.exception("Kitchen suggest failed")
        raise HTTPException(status_code=500, detail="Could not generate a kitchen-based suggestion.")


# ------ Supplement logging ------

@api_router.post("/supplements/log")
async def log_supplement(payload: SupplementLog, user_id: str = Depends(get_current_user_id)):
    doc = payload.dict()
    doc["user_id"] = user_id
    await db.supplement_logs.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api_router.get("/supplements/today")
async def supplements_today(user_id: str = Depends(get_current_user_id)):
    date = today_key()
    logs = await db.supplement_logs.find({"date": date, "user_id": user_id}, {"_id": 0}).to_list(100)
    return {"date": date, "taken": [l["supplement_name"] for l in logs], "logs": logs}

@api_router.delete("/supplements/{log_id}")
async def delete_supplement_log(log_id: str, user_id: str = Depends(get_current_user_id)):
    res = await db.supplement_logs.delete_one({"id": log_id, "user_id": user_id})
    return {"deleted": res.deleted_count}


# ------ Push notifications ------

class PushSubscription(BaseModel):
    endpoint: str
    keys: Dict[str, str]  # {"p256dh": "...", "auth": "..."}

@api_router.get("/push/vapid-public-key")
async def push_public_key():
    return {"publicKey": VAPID_PUBLIC_KEY}

@api_router.post("/push/subscribe")
async def push_subscribe(payload: PushSubscription):
    doc = payload.dict()
    doc["id"] = str(uuid.uuid4())
    doc["created_at"] = utcnow_iso()
    # One subscription per endpoint (avoids duplicates if the same device re-subscribes)
    await db.push_subscriptions.update_one(
        {"endpoint": payload.endpoint}, {"$set": doc}, upsert=True
    )
    return {"subscribed": True}

@api_router.delete("/push/unsubscribe")
async def push_unsubscribe(payload: PushSubscription):
    res = await db.push_subscriptions.delete_one({"endpoint": payload.endpoint})
    return {"deleted": res.deleted_count}


async def send_push_to_all(title: str, body: str, url: str = "/"):
    if not VAPID_PRIVATE_KEY or not VAPID_PUBLIC_KEY:
        logger.warning("Push notification skipped: VAPID keys not configured")
        return
    subs = await db.push_subscriptions.find({}, {"_id": 0}).to_list(200)
    payload = json.dumps({"title": title, "body": body, "url": url})
    for sub in subs:
        try:
            webpush(
                subscription_info={"endpoint": sub["endpoint"], "keys": sub["keys"]},
                data=payload,
                vapid_private_key=VAPID_PRIVATE_KEY,
                vapid_claims={"sub": VAPID_CONTACT_EMAIL},
            )
        except WebPushException as e:
            logger.warning(f"Push failed for one subscription, removing it: {e}")
            # Dead/expired subscription — clean it up so it stops being retried daily.
            await db.push_subscriptions.delete_one({"endpoint": sub["endpoint"]})
        except Exception:
            logger.exception("Unexpected push error")

@api_router.post("/push/test")
async def push_test():
    """Manual trigger to verify push notifications actually work end to end."""
    await send_push_to_all("FitForgeAI", "Test notification — if you see this, push works.", "/")
    return {"sent": True}


async def morning_sleep_reminder():
    await send_push_to_all(
        "Good morning ☀️",
        "How did you sleep? Tap to log in one second.",
        "/log?quick=sleep",
    )

async def evening_supplement_reminder():
    await send_push_to_all(
        "Wind-down check 🌙",
        "Taken your evening supplements yet?",
        "/log?quick=supplements",
    )

scheduler = AsyncIOScheduler()
scheduler.add_job(morning_sleep_reminder, CronTrigger(hour=7, minute=30))
scheduler.add_job(evening_supplement_reminder, CronTrigger(hour=21, minute=30))


# ------ Smart training recommendation (based on real history, not just the static plan) ------

TRAINING_RECOMMENDATION_PROMPT = """You are a strength coach reviewing a client's actual recent training history against their base program. Return ONLY JSON:
{ "session_focus":string, "adjustment_note":string, "exercises":[ { "name":string, "sets":int, "reps":string, "notes":string, "demo_query":string } ] }
session_focus is what today's session should target given the base plan and recent history. adjustment_note is 1-2 sentences explaining any change from the base plan (e.g. "increasing bench press weight since you hit all reps last 2 sessions" or "swapping in more core work since you've skipped it 3 sessions running"). Ground every adjustment in the actual history provided — don't invent progress that isn't there."""

@api_router.get("/training/todays-recommendation")
async def todays_recommendation(user_id: str = Depends(get_current_user_id)):
    try:
        plan_doc = await db.plans.find_one({"user_id": user_id}, {"_id": 0}, sort=[("created_at", -1)])
        if not plan_doc:
            raise HTTPException(status_code=404, detail="No plan found. Generate a plan first.")
        base_training = plan_doc.get("plan", {}).get("training_split", {})
        recent_logs = await db.workout_logs.find({"user_id": user_id}, {"_id": 0}).sort("created_at", -1).to_list(40)
        user_prompt = (
            f"Base training plan: {json.dumps(base_training)[:4000]}\n"
            f"Last {len(recent_logs)} logged workout entries (most recent first): {json.dumps(recent_logs)[:4000]}\n"
            "Recommend today's session, adjusted for what's actually been happening."
        )
        result = await call_claude_json(
            TRAINING_RECOMMENDATION_PROMPT, user_prompt,
            session_id=f"training-rec-{uuid.uuid4()}", max_tokens=2000,
        )
        return result
    except HTTPException:
        raise
    except Exception:
        logger.exception("Training recommendation failed")
        raise HTTPException(status_code=500, detail="Could not generate today's recommendation.")


# ------ Deterministic progression, pre-fill, 1RM, and muscle heatmap ------
# (ported concepts from openGym's rule-based progression system — deterministic,
# no AI call needed, computed straight from logged history)

def epley_1rm(weight_kg: float, reps: int) -> float:
    if reps <= 1:
        return weight_kg
    if reps > 12:
        return weight_kg  # formula gets unreliable past ~12 reps, don't overclaim
    return round(weight_kg * (1 + reps / 30), 1)


@api_router.get("/workouts/last-weights")
async def last_weights(user_id: str = Depends(get_current_user_id)):
    """Most recent weight/reps logged per exercise, so the workout screen can pre-fill
    today's session instead of starting from blank fields."""
    logs = await db.workout_logs.find({"user_id": user_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
    last_by_exercise: Dict[str, Dict[str, Any]] = {}
    for log in logs:
        name = log.get("exercise_name")
        if name and name not in last_by_exercise:
            last_by_exercise[name] = {
                "weight_kg": log.get("weight_kg"),
                "reps": log.get("reps"),
                "sets_done": log.get("sets_done"),
                "date": log.get("date"),
            }
    return {"exercises": last_by_exercise}


@api_router.get("/training/progression")
async def training_progression(exercise: str, user_id: str = Depends(get_current_user_id)):
    """Deterministic next-session suggestion for one exercise — no AI call, just a rule:
    increase weight after 2 clean sessions hitting top of rep range, deload after 2
    straight misses. This is the openGym-style rule-based approach, complementing (not
    replacing) the AI-narrative /training/todays-recommendation."""
    logs = await db.workout_logs.find(
        {"user_id": user_id, "exercise_name": exercise}, {"_id": 0}
    ).sort("created_at", -1).to_list(10)

    if not logs:
        return {"exercise": exercise, "history_found": False, "suggestion": "No history yet for this exercise — log a session to start tracking progression."}

    last = logs[0]
    last_weight = last.get("weight_kg")
    last_reps_str = last.get("reps") or ""
    rep_values = [int(r) for r in last_reps_str.split(",") if r.strip().isdigit()]
    target_reps = 10  # generic top-of-range assumption when the plan doesn't specify one

    hit_target_streak = 0
    missed_streak = 0
    for log in logs:
        reps_str = log.get("reps") or ""
        vals = [int(r) for r in reps_str.split(",") if r.strip().isdigit()]
        if not vals:
            break
        if min(vals) >= target_reps:
            hit_target_streak += 1
            missed_streak = 0
        else:
            missed_streak += 1
            break  # streak broken, stop counting

    best_1rm = None
    if last_weight and rep_values:
        best_1rm = epley_1rm(last_weight, max(rep_values))

    if hit_target_streak >= 2 and last_weight:
        increment = 2.5 if last_weight >= 20 else 1.0
        return {
            "exercise": exercise, "history_found": True,
            "suggested_weight_kg": round(last_weight + increment, 1),
            "suggested_reps": target_reps,
            "reason": f"Hit {target_reps}+ reps for {hit_target_streak} sessions running — time to add weight.",
            "estimated_1rm_kg": best_1rm,
        }
    if missed_streak >= 2 and last_weight:
        deload = round(last_weight * 0.9, 1)
        return {
            "exercise": exercise, "history_found": True,
            "suggested_weight_kg": deload,
            "suggested_reps": target_reps,
            "reason": f"Missed target reps {missed_streak} sessions running — deloading 10% to reset.",
            "estimated_1rm_kg": best_1rm,
        }
    return {
        "exercise": exercise, "history_found": True,
        "suggested_weight_kg": last_weight,
        "suggested_reps": target_reps,
        "reason": "Stay at the same weight — keep building consistency at this load before increasing.",
        "estimated_1rm_kg": best_1rm,
    }


@api_router.get("/training/muscle-heatmap")
async def muscle_heatmap(days: int = 30, user_id: str = Depends(get_current_user_id)):
    """Aggregates logged workout volume by muscle group over the given window. Muscle
    group is looked up by matching the logged exercise name against the current plan's
    training_split (best-effort — exercises not found in the plan count as 'other')."""
    start_date = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")

    plan_doc = await db.plans.find_one({"user_id": user_id}, {"_id": 0}, sort=[("created_at", -1)])
    name_to_muscle: Dict[str, str] = {}
    if plan_doc:
        for day in plan_doc.get("plan", {}).get("training_split", {}).get("table", []):
            for ex in day.get("exercises", []):
                if ex.get("name"):
                    name_to_muscle[ex["name"].lower()] = ex.get("muscle_group", "other")

    logs = await db.workout_logs.find(
        {"user_id": user_id, "date": {"$gte": start_date}}, {"_id": 0}
    ).to_list(2000)

    volume_by_muscle: Dict[str, int] = {}
    for log in logs:
        muscle = name_to_muscle.get((log.get("exercise_name") or "").lower(), "other")
        volume_by_muscle[muscle] = volume_by_muscle.get(muscle, 0) + int(log.get("sets_done") or 0)

    all_muscle_groups = ["chest", "back", "legs", "shoulders", "arms", "core", "cardio", "other"]
    trained = set(volume_by_muscle.keys())
    untrained = [m for m in all_muscle_groups if m not in trained and m != "other"]

    return {
        "days": days,
        "volume_by_muscle": volume_by_muscle,
        "untrained_muscle_groups": untrained,
    }


# ------ Basic import from Strong / Hevy style CSV exports ------

class ImportRow(BaseModel):
    date: str
    exercise_name: str
    weight_kg: Optional[float] = None
    reps: Optional[int] = None
    day_label: Optional[str] = None

class ImportInput(BaseModel):
    rows: List[ImportRow]

@api_router.post("/workouts/import")
async def import_workouts(payload: ImportInput, user_id: str = Depends(get_current_user_id)):
    """Bulk-import previously logged workouts (e.g. parsed from a Strong or Hevy CSV
    export). The frontend is responsible for parsing the CSV into this row shape —
    column layouts differ slightly per app, easier to map on the client than guess here."""
    grouped: Dict[tuple, List[ImportRow]] = {}
    for row in payload.rows:
        key = (row.date, row.exercise_name)
        grouped.setdefault(key, []).append(row)

    imported = 0
    for (date, exercise_name), rows in grouped.items():
        weights = [r.weight_kg for r in rows if r.weight_kg is not None]
        reps_list = [str(r.reps) for r in rows if r.reps is not None]
        doc = {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "date": date,
            "created_at": utcnow_iso(),
            "day_label": rows[0].day_label or "Imported",
            "exercise_name": exercise_name,
            "sets_done": len(rows),
            "reps": ",".join(reps_list),
            "weight_kg": max(weights) if weights else None,
            "notes": "Imported from external app",
        }
        await db.workout_logs.insert_one(doc)
        imported += 1
    return {"imported_exercise_entries": imported, "total_sets": len(payload.rows)}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware, allow_credentials=True,
    allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)


@app.on_event("startup")
async def start_scheduler():
    if VAPID_PRIVATE_KEY and VAPID_PUBLIC_KEY:
        scheduler.start()
        logger.info("Push notification scheduler started")
    else:
        logger.warning("VAPID keys not set — push notification scheduler NOT started")


@app.on_event("shutdown")
async def shutdown_db_client():
    mongo_client.close()