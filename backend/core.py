import os
import ast
import json
import math
import uuid
import hashlib
import logging
import operator
from datetime import datetime, timezone, timedelta, date as date_cls
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import bcrypt
import jwt
import requests
from cryptography.fernet import Fernet
from fastapi import Depends, HTTPException, Request
from motor.motor_asyncio import AsyncIOMotorClient

logger = logging.getLogger("hris")
client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]

WIB = timezone(timedelta(hours=7))
JWT_SECRET = os.environ["JWT_SECRET"]
fernet = Fernet(os.environ["FIELD_ENC_KEY"].encode())
APP_NAME = os.environ["APP_NAME"]

ROLES = ["management", "hrd", "accounting", "purchasing", "spv", "pic_depan", "pic_dapur", "pic_bar", "staff"]
PIC_ROLES = {"pic_depan": "depan", "pic_dapur": "dapur", "pic_bar": "bar"}
GLOBAL_VIEW = {"management", "hrd", "accounting"}
ADMIN = ("management", "hrd")
SEGMENTS = ["depan", "dapur", "bar", "backoffice"]

DEFAULT_SETTINGS = {
    "overtime_requires_approval": True,
    "ot_block_minutes": 30,
    "late_grace_minutes": 0,
    "schedule_max_days_ahead": 7,
    "payroll_divisor": 26,
    "mgmt_min_cuti_days": 3,
    "mgmt_required_types": [],
    "kpi_task_weight": 0.3,
    "face_threshold": 0.5,
    "daily_report_reminder_hour": 20,
    "device_binding_roles": ["staff", "pic_depan", "pic_dapur", "pic_bar", "spv"],
    "default_leave_quota": 12,
    "tax": {"enabled": False, "components": [
        {"name": "PPh 21 (menunggu konfirmasi Finance)", "type": "percent", "value": 0, "applies_to": "monthly", "formula": ""}
    ]},
}


def now():
    return datetime.now(WIB)


def now_iso():
    return now().isoformat()


def today():
    return now().date().isoformat()


def uid():
    return str(uuid.uuid4())


def parse_dt(s):
    return datetime.fromisoformat(s)


def daterange(start, end):
    d, e = date_cls.fromisoformat(start), date_cls.fromisoformat(end)
    while d <= e:
        yield d.isoformat()
        d += timedelta(days=1)


def enc(obj):
    return fernet.encrypt(json.dumps(obj).encode()).decode()


def dec(s):
    return json.loads(fernet.decrypt(s.encode())) if s else None


def hash_pw(p):
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()


def check_pw(p, h):
    return bcrypt.checkpw(p.encode(), h.encode())


def make_token(user_id):
    return jwt.encode({"sub": user_id, "exp": datetime.now(timezone.utc) + timedelta(days=7)}, JWT_SECRET, "HS256")


def sha(s):
    return hashlib.sha256(s.encode()).hexdigest()


def haversine(lat1, lng1, lat2, lng2):
    r = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def shift_window(date_str, shift):
    d = date_cls.fromisoformat(date_str)
    sh, sm = map(int, shift["start"].split(":"))
    eh, em = map(int, shift["end"].split(":"))
    start = datetime(d.year, d.month, d.day, sh, sm, tzinfo=WIB)
    end = datetime(d.year, d.month, d.day, eh, em, tzinfo=WIB)
    if end <= start:
        end += timedelta(days=1)
    return start, end


async def get_settings():
    doc = await db.settings.find_one({"id": "global"}, {"_id": 0}) or {}
    return {**DEFAULT_SETTINGS, **{k: v for k, v in doc.items() if k in DEFAULT_SETTINGS}}


def public_user(u, with_comp=False):
    out = {k: v for k, v in u.items() if k not in ("_id", "password_hash", "comp_enc")}
    if with_comp:
        out["comp"] = dec(u.get("comp_enc")) or {}
    return out


async def current_user(request: Request):
    auth = request.headers.get("authorization", "")
    token = auth[7:] if auth.lower().startswith("bearer ") else request.query_params.get("auth", "")
    if not token:
        raise HTTPException(401, "Belum login")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(401, "Sesi tidak valid atau kedaluwarsa")
    u = await db.users.find_one({"id": payload["sub"]}, {"_id": 0})
    if not u or not u.get("active", True):
        raise HTTPException(401, "Akun tidak aktif")
    s = await get_settings()
    if u["role"] in s["device_binding_roles"] and u.get("device_id"):
        dev = request.headers.get("x-device-id") or request.query_params.get("device", "")
        if dev != u["device_id"]:
            raise HTTPException(401, "Perangkat tidak terdaftar untuk akun ini")
    return u


def require(*roles):
    async def check(u: dict = Depends(current_user)):
        if u["role"] not in roles:
            raise HTTPException(403, "Anda tidak punya akses untuk aksi ini")
        return u
    return check


def user_scope_query(u):
    r = u["role"]
    if r in GLOBAL_VIEW:
        return {}
    if r == "spv":
        return {"branch_ids": {"$in": u.get("branch_ids", [])}}
    if r in PIC_ROLES:
        return {"$or": [{"id": u["id"]}, {"branch_ids": {"$in": u.get("branch_ids", [])}, "segment": PIC_ROLES[r], "role": "staff"}]}
    return {"id": u["id"]}


async def visible_user_ids(u):
    return [x["id"] async for x in db.users.find(user_scope_query(u), {"id": 1, "_id": 0})]


async def user_map(ids=None):
    q = {"id": {"$in": list(ids)}} if ids is not None else {}
    return {x["id"]: x["name"] async for x in db.users.find(q, {"id": 1, "name": 1, "_id": 0})}


async def audit(actor, action, entity="", entity_id="", detail=None):
    await db.audit_logs.insert_one({
        "id": uid(), "at": now_iso(), "actor_id": actor.get("id") if actor else None,
        "actor_name": actor.get("name") if actor else "Sistem", "actor_role": actor.get("role") if actor else None,
        "action": action, "entity": entity, "entity_id": entity_id, "detail": detail or {},
    })


async def notify(user_ids, title, body="", kind="info", link=""):
    docs = [{"id": uid(), "user_id": i, "title": title, "body": body, "kind": kind, "link": link,
             "read": False, "at": now_iso()} for i in set(user_ids) if i]
    if docs:
        await db.notifications.insert_many(docs)


async def users_by_roles(roles, branch_ids=None):
    q = {"role": {"$in": list(roles)}, "active": True}
    if branch_ids:
        q["branch_ids"] = {"$in": list(branch_ids)}
    return [x["id"] async for x in db.users.find(q, {"id": 1, "_id": 0})]


# ---------- object storage ----------
STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
_storage_key = None


def init_storage(force=False):
    global _storage_key
    if _storage_key and not force:
        return _storage_key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": os.environ["EMERGENT_LLM_KEY"]}, timeout=30)
    resp.raise_for_status()
    _storage_key = resp.json()["storage_key"]
    return _storage_key


def put_object(path, data, content_type):
    resp = requests.put(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": init_storage(), "Content-Type": content_type},
                        data=data, timeout=120)
    if resp.status_code == 404:
        resp = requests.put(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": init_storage(True), "Content-Type": content_type},
                            data=data, timeout=120)
    resp.raise_for_status()
    return resp.json()


def get_object(path):
    resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": init_storage()}, timeout=60)
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


async def save_file(data: bytes, content_type: str, ext: str, folder: str, owner_id: str, original=""):
    path = f"{APP_NAME}/{folder}/{owner_id or 'public'}/{uid()}.{ext}"
    res = put_object(path, data, content_type)
    await db.files.insert_one({"id": uid(), "storage_path": res["path"], "owner_id": owner_id, "content_type": content_type,
                               "original_filename": original, "is_deleted": False, "created_at": now_iso()})
    return res["path"]


async def save_data_url(data_url: str, folder: str, owner_id: str):
    import base64
    if not data_url or "," not in data_url:
        return None
    head, b64 = data_url.split(",", 1)
    ctype = head.split(";")[0].replace("data:", "") or "image/jpeg"
    return await save_file(base64.b64decode(b64), ctype, ctype.split("/")[-1], folder, owner_id)


# ---------- safe formula eval for configurable tax ----------
_OPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv,
        ast.USub: operator.neg, ast.Pow: operator.pow}


def safe_eval(expr, names):
    def ev(n):
        if isinstance(n, ast.Expression):
            return ev(n.body)
        if isinstance(n, ast.Constant) and isinstance(n.value, (int, float)):
            return n.value
        if isinstance(n, ast.Name) and n.id in names:
            return names[n.id]
        if isinstance(n, ast.BinOp) and type(n.op) in _OPS:
            return _OPS[type(n.op)](ev(n.left), ev(n.right))
        if isinstance(n, ast.UnaryOp) and type(n.op) in _OPS:
            return _OPS[type(n.op)](ev(n.operand))
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id in ("min", "max"):
            return {"min": min, "max": max}[n.func.id](*[ev(a) for a in n.args])
        raise ValueError("Rumus tidak valid")
    return float(ev(ast.parse(expr, mode="eval")))
