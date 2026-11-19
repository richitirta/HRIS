import asyncio
import secrets
from datetime import timedelta
from typing import List, Optional

from fastapi import FastAPI, APIRouter, Depends, HTTPException, Request, UploadFile, File, Query
from fastapi.responses import Response
from pydantic import BaseModel
from starlette.middleware.cors import CORSMiddleware
from pymongo import ASCENDING, IndexModel
import os

from core import (db, client, logger, ROLES, ADMIN, GLOBAL_VIEW, PIC_ROLES, DEFAULT_SETTINGS, now, now_iso, uid, enc,
                  hash_pw, check_pw, make_token, sha, get_settings, public_user, current_user, require, user_scope_query,
                  audit, notify, users_by_roles, init_storage, get_object, save_file, parse_dt)
import hr
import ops
import seed

app = FastAPI(title="HRIS Resto")
api = APIRouter(prefix="/api")


class LoginIn(BaseModel):
    email: str
    password: str
    device_id: Optional[str] = None
    device_info: Optional[str] = ""


@api.get("/")
async def root():
    return {"message": "HRIS Resto API"}


@api.post("/auth/login")
async def login(body: LoginIn, request: Request):
    email = body.email.lower().strip()
    ip = (request.headers.get("x-forwarded-for") or (request.client.host if request.client else "")).split(",")[0].strip()
    key = f"{ip}:{email}"
    att = await db.login_attempts.find_one({"key": key}) or {}
    if att.get("locked_until") and parse_dt(att["locked_until"]) > now():
        raise HTTPException(429, "Terlalu banyak percobaan gagal. Coba lagi 15 menit lagi.")
    u = await db.users.find_one({"email": email}, {"_id": 0})
    if not u or not check_pw(body.password, u["password_hash"]):
        cnt = att.get("count", 0) + 1
        upd = {"count": cnt}
        if cnt >= 5:
            upd = {"count": 0, "locked_until": (now() + timedelta(minutes=15)).isoformat()}
        await db.login_attempts.update_one({"key": key}, {"$set": upd}, upsert=True)
        raise HTTPException(401, "Email atau password salah")
    if not u.get("active", True):
        raise HTTPException(403, "Akun dinonaktifkan")
    s = await get_settings()
    if u["role"] in s["device_binding_roles"]:
        if not body.device_id:
            raise HTTPException(400, "Device ID tidak terbaca")
        if u.get("device_id") and u["device_id"] != body.device_id:
            await audit(u, "login_ditolak_device_lain", "user", u["id"], {"device_id": body.device_id, "info": body.device_info})
            raise HTTPException(403, "Akun ini sudah terikat ke HP lain. Ajukan Reset Device lewat HP Master atau HRD.")
        if not u.get("device_id"):
            await db.users.update_one({"id": u["id"]}, {"$set": {"device_id": body.device_id, "device_info": body.device_info, "device_bound_at": now_iso()}})
            await db.devices.insert_one({"id": uid(), "user_id": u["id"], "device_id": body.device_id, "info": body.device_info, "bound_at": now_iso(), "active": True})
            await audit(u, "device_terikat", "user", u["id"], {"device_id": body.device_id, "info": body.device_info})
            u["device_id"] = body.device_id
    await db.login_attempts.delete_one({"key": key})
    await audit(u, "login", "user", u["id"])
    return {"token": make_token(u["id"]), "user": public_user(u)}


@api.get("/auth/me")
async def me(u: dict = Depends(current_user)):
    return public_user(u)


class PwIn(BaseModel):
    old_password: str
    new_password: str


@api.post("/auth/change-password")
async def change_pw(body: PwIn, u: dict = Depends(current_user)):
    if not check_pw(body.old_password, u["password_hash"]) or len(body.new_password) < 8:
        raise HTTPException(400, "Password lama salah atau password baru kurang dari 8 karakter")
    await db.users.update_one({"id": u["id"]}, {"$set": {"password_hash": hash_pw(body.new_password)}})
    await audit(u, "ganti_password", "user", u["id"])
    return {"ok": True}


# ---------- branches ----------
class BranchIn(BaseModel):
    name: str
    address: str = ""
    lat: float
    lng: float
    radius_m: float = 10
    active: bool = True


@api.get("/branches")
async def list_branches(u: dict = Depends(current_user)):
    return await db.branches.find({}, {"_id": 0}).sort("name", 1).to_list(200)


@api.get("/public/branches")
async def public_branches():
    return await db.branches.find({"active": True}, {"_id": 0, "id": 1, "name": 1, "address": 1}).to_list(200)


@api.post("/branches")
async def create_branch(body: BranchIn, u: dict = Depends(require(*ADMIN))):
    doc = {"id": uid(), **body.model_dump(), "created_at": now_iso()}
    await db.branches.insert_one(doc)
    await seed.default_shifts(doc["id"])
    await audit(u, "buat_cabang", "branch", doc["id"], body.model_dump())
    doc.pop("_id", None)
    return doc


@api.put("/branches/{bid}")
async def update_branch(bid: str, body: BranchIn, u: dict = Depends(require(*ADMIN))):
    r = await db.branches.update_one({"id": bid}, {"$set": body.model_dump()})
    if not r.matched_count:
        raise HTTPException(404, "Cabang tidak ditemukan")
    await audit(u, "ubah_cabang", "branch", bid, body.model_dump())
    return await db.branches.find_one({"id": bid}, {"_id": 0})


# ---------- master devices ----------
class MasterIn(BaseModel):
    branch_id: str
    name: str
    active: bool = True


@api.get("/master-devices")
async def list_masters(u: dict = Depends(require(*ADMIN))):
    return await db.master_devices.find({}, {"_id": 0, "token_hash": 0}).to_list(200)


@api.post("/master-devices")
async def create_master(body: MasterIn, u: dict = Depends(require(*ADMIN))):
    doc = {"id": uid(), **body.model_dump(), "activated_at": None, "created_at": now_iso()}
    await db.master_devices.insert_one(doc)
    await audit(u, "buat_hp_master", "master_device", doc["id"], body.model_dump())
    doc.pop("_id", None)
    return doc


@api.put("/master-devices/{mid}")
async def update_master(mid: str, body: MasterIn, u: dict = Depends(require(*ADMIN))):
    await db.master_devices.update_one({"id": mid}, {"$set": body.model_dump()})
    await audit(u, "ubah_hp_master", "master_device", mid, body.model_dump())
    return {"ok": True}


@api.post("/master-devices/{mid}/activate")
async def activate_master(mid: str, u: dict = Depends(require(*ADMIN))):
    m = await db.master_devices.find_one({"id": mid})
    if not m:
        raise HTTPException(404, "HP Master tidak ditemukan")
    token = secrets.token_urlsafe(24)
    await db.master_devices.update_one({"id": mid}, {"$set": {"token_hash": sha(token), "activated_at": now_iso(), "activated_by": u["name"]}})
    await audit(u, "aktivasi_hp_master", "master_device", mid)
    return {"kiosk_token": token}


# ---------- users ----------
class UserIn(BaseModel):
    name: str
    email: str
    role: str
    segment: str = "depan"
    position: str = ""
    level: str = ""
    phone: str = ""
    nik: str = ""
    branch_ids: List[str] = []
    attendance_branch_ids: List[str] = []
    active: bool = True
    leave_quota: int = 12
    join_date: str = ""
    password: Optional[str] = None
    comp: Optional[dict] = None


def _comp(c):
    c = c or {}
    return {k: float(c.get(k) or 0) for k in ("base_salary", "allowance", "meal_rate", "ot_rate", "ph_rate")}


@api.get("/users")
async def list_users(u: dict = Depends(current_user)):
    docs = await db.users.find(user_scope_query(u), {"_id": 0}).sort("name", 1).to_list(2000)
    return [public_user(d, with_comp=u["role"] in GLOBAL_VIEW) for d in docs]


async def _validate_user(body: UserIn, u):
    if body.role not in ROLES:
        raise HTTPException(400, "Role tidak valid")
    if body.role == "management" and u["role"] != "management":
        raise HTTPException(403, "Hanya Management yang dapat membuat akun Management")


@api.post("/users")
async def create_user(body: UserIn, u: dict = Depends(require(*ADMIN))):
    await _validate_user(body, u)
    email = body.email.lower().strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(409, "Email sudah dipakai")
    data = body.model_dump(exclude={"password", "comp"})
    pw = body.password or secrets.token_urlsafe(8)
    doc = {"id": uid(), **data, "email": email, "password_hash": hash_pw(pw), "comp_enc": enc(_comp(body.comp)),
           "attendance_branch_ids": body.attendance_branch_ids or body.branch_ids, "device_id": None,
           "face_enrolled": False, "created_at": now_iso()}
    await db.users.insert_one(doc)
    await audit(u, "buat_karyawan", "user", doc["id"], {"name": body.name, "role": body.role})
    return {**public_user(doc), "temp_password": pw}


@api.put("/users/{user_id}")
async def update_user(user_id: str, body: UserIn, u: dict = Depends(require(*ADMIN))):
    await _validate_user(body, u)
    target = await db.users.find_one({"id": user_id})
    if not target:
        raise HTTPException(404, "Karyawan tidak ditemukan")
    if target["role"] == "management" and u["role"] != "management":
        raise HTTPException(403, "Tidak boleh mengubah akun Management")
    data = body.model_dump(exclude={"password", "comp"})
    data["email"] = body.email.lower().strip()
    if body.comp is not None:
        data["comp_enc"] = enc(_comp(body.comp))
    if body.password:
        data["password_hash"] = hash_pw(body.password)
    await db.users.update_one({"id": user_id}, {"$set": data})
    await audit(u, "ubah_karyawan", "user", user_id, {"name": body.name, "role": body.role, "comp_changed": body.comp is not None})
    return {"ok": True}


@api.post("/users/{user_id}/reset-face")
async def reset_face(user_id: str, u: dict = Depends(require(*ADMIN))):
    await db.face_templates.delete_many({"user_id": user_id})
    await db.users.update_one({"id": user_id}, {"$set": {"face_enrolled": False}})
    await audit(u, "reset_wajah", "user", user_id)
    await notify([user_id], "Data wajah direset", "Silakan daftarkan ulang wajah Anda sebelum absen.", "face", "/absensi")
    return {"ok": True}


# ---------- device resets ----------
class ResetIn(BaseModel):
    user_id: str
    reason: str


async def release_device(user_id):
    await db.users.update_one({"id": user_id}, {"$set": {"device_id": None, "device_info": None}})
    await db.devices.update_many({"user_id": user_id, "active": True}, {"$set": {"active": False, "released_at": now_iso()}})


@api.post("/device-resets")
async def create_reset(body: ResetIn, u: dict = Depends(current_user)):
    if u["role"] not in ADMIN and body.user_id != u["id"]:
        raise HTTPException(403, "Tidak diizinkan")
    doc = {"id": uid(), "user_id": body.user_id, "reason": body.reason, "via": "hrd" if u["role"] in ADMIN else "self",
           "status": "menunggu", "created_at": now_iso(), "created_by": u["name"]}
    await db.device_resets.insert_one(doc)
    await audit(u, "ajukan_reset_device", "user", body.user_id, {"reason": body.reason})
    await notify(await users_by_roles(["hrd", "management"]), "Permintaan Reset Device", body.reason, "device", "/karyawan")
    doc.pop("_id", None)
    return doc


@api.get("/device-resets")
async def list_resets(u: dict = Depends(require(*ADMIN))):
    docs = await db.device_resets.find({}, {"_id": 0}).sort("created_at", -1).to_list(300)
    names = {x["id"]: x["name"] async for x in db.users.find({}, {"id": 1, "name": 1, "_id": 0})}
    for d in docs:
        d["user_name"] = names.get(d["user_id"], "-")
    return docs


class DecideIn(BaseModel):
    approve: bool
    note: str = ""


@api.post("/device-resets/{rid}/decide")
async def decide_reset(rid: str, body: DecideIn, u: dict = Depends(require(*ADMIN))):
    r = await db.device_resets.find_one({"id": rid, "status": "menunggu"})
    if not r:
        raise HTTPException(404, "Permintaan tidak ditemukan")
    status = "disetujui" if body.approve else "ditolak"
    await db.device_resets.update_one({"id": rid}, {"$set": {"status": status, "decided_by": u["name"], "decided_at": now_iso(), "note": body.note}})
    if body.approve:
        await release_device(r["user_id"])
    await audit(u, f"reset_device_{status}", "user", r["user_id"])
    await notify([r["user_id"]], f"Reset Device {status}", "Silakan login di HP baru Anda." if body.approve else body.note, "device")
    return {"ok": True}


# ---------- settings / notifications / audit / files ----------
@api.get("/settings")
async def read_settings(u: dict = Depends(current_user)):
    return await get_settings()


@api.put("/settings")
async def write_settings(body: dict, u: dict = Depends(require("management", "hrd", "accounting"))):
    data = {k: v for k, v in body.items() if k in DEFAULT_SETTINGS}
    if u["role"] == "accounting":
        data = {k: v for k, v in data.items() if k in ("tax", "payroll_divisor")}
    await db.settings.update_one({"id": "global"}, {"$set": data}, upsert=True)
    await audit(u, "ubah_pengaturan", "settings", "global", data)
    return await get_settings()


@api.get("/notifications")
async def list_notifs(u: dict = Depends(current_user)):
    await ops.run_sweeps()
    items = await db.notifications.find({"user_id": u["id"]}, {"_id": 0}).sort("at", -1).to_list(50)
    unread = await db.notifications.count_documents({"user_id": u["id"], "read": False})
    return {"items": items, "unread": unread}


@api.post("/notifications/read-all")
async def read_all(u: dict = Depends(current_user)):
    await db.notifications.update_many({"user_id": u["id"]}, {"$set": {"read": True}})
    return {"ok": True}


@api.get("/audit-logs")
async def audit_logs(q: str = "", limit: int = Query(200, le=1000), u: dict = Depends(require(*ADMIN))):
    flt = {"action": {"$regex": q, "$options": "i"}} if q else {}
    return await db.audit_logs.find(flt, {"_id": 0}).sort("at", -1).to_list(limit)


@api.post("/upload")
async def upload(file: UploadFile = File(...), u: dict = Depends(current_user)):
    data = await file.read()
    if len(data) > 8 * 1024 * 1024:
        raise HTTPException(400, "Ukuran file maksimal 8MB")
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else "bin"
    path = await save_file(data, file.content_type or "application/octet-stream", ext, "attachments", u["id"], file.filename)
    return {"path": path, "name": file.filename}


@api.get("/files/{path:path}")
async def get_file(path: str, u: dict = Depends(current_user)):
    rec = await db.files.find_one({"storage_path": path, "is_deleted": False})
    if not rec:
        raise HTTPException(404, "File tidak ditemukan")
    if u["role"] == "staff" and rec.get("owner_id") != u["id"]:
        raise HTTPException(404, "File tidak ditemukan")
    data, ctype = await asyncio.to_thread(get_object, path)
    return Response(content=data, media_type=rec.get("content_type") or ctype)


api.include_router(hr.router)
api.include_router(ops.router)
app.include_router(api)
app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
                   allow_methods=["*"], allow_headers=["*"])

INDEXES = {
    "users": [IndexModel([("id", ASCENDING)], unique=True), IndexModel([("email", ASCENDING)], unique=True)],
    "attendance": [IndexModel([("user_id", ASCENDING), ("date", ASCENDING)]), IndexModel([("date", ASCENDING)])],
    "schedules": [IndexModel([("user_id", ASCENDING), ("date", ASCENDING)]), IndexModel([("branch_id", ASCENDING), ("date", ASCENDING)])],
    "notifications": [IndexModel([("user_id", ASCENDING), ("at", ASCENDING)])],
    "audit_logs": [IndexModel([("at", ASCENDING)])],
    "requests": [IndexModel([("user_id", ASCENDING)]), IndexModel([("status", ASCENDING)])],
    "tasks": [IndexModel([("deadline", ASCENDING)])],
    "files": [IndexModel([("storage_path", ASCENDING)])],
}


@app.on_event("startup")
async def startup():
    for coll, models in INDEXES.items():
        for m in models:
            try:
                await db[coll].create_indexes([m])
            except Exception as exc:
                logger.error("index %s: %s", coll, exc)
    try:
        await asyncio.to_thread(init_storage)
    except Exception as exc:
        logger.error("Storage init failed: %s", exc)
    await seed.run()


@app.on_event("shutdown")
async def shutdown():
    client.close()
