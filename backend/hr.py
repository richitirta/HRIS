import io
import math
from datetime import timedelta, date as date_cls
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from core import (db, ADMIN, GLOBAL_VIEW, PIC_ROLES, now, now_iso, today, uid, enc, dec, sha, parse_dt, daterange,
                  haversine, shift_window, get_settings, current_user, require, user_scope_query, visible_user_ids,
                  user_map, audit, notify, users_by_roles, save_data_url, safe_eval)

router = APIRouter()


# ================= FACE =================
def _dist(a, b):
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


async def face_match(user_id, descriptor):
    t = await db.face_templates.find_one({"user_id": user_id})
    if not t:
        raise HTTPException(400, "Wajah belum terdaftar. Lakukan pendaftaran wajah dulu.")
    if not descriptor or len(descriptor) != 128:
        raise HTTPException(400, "Data wajah tidak terbaca")
    s = await get_settings()
    d = _dist(dec(t["descriptor_enc"]), descriptor)
    return d <= s["face_threshold"], round(max(0.0, 1 - d), 3)


class EnrollIn(BaseModel):
    descriptor: List[float]
    consent: bool
    photo: Optional[str] = None
    liveness: bool = False


async def _enroll(user_id, body: EnrollIn, actor, via):
    if not body.consent:
        raise HTTPException(400, "Persetujuan penyimpanan data wajah wajib dicentang")
    if not body.liveness:
        raise HTTPException(400, "Liveness check belum lolos")
    if len(body.descriptor) != 128:
        raise HTTPException(400, "Data wajah tidak valid")
    if await db.face_templates.find_one({"user_id": user_id}):
        raise HTTPException(409, "Wajah sudah terdaftar. Minta HRD mereset bila perlu daftar ulang.")
    photo = await save_data_url(body.photo, "faces", user_id) if body.photo else None
    await db.face_templates.insert_one({"id": uid(), "user_id": user_id, "descriptor_enc": enc(body.descriptor),
                                        "photo_path": photo, "consent_at": now_iso(), "via": via})
    await db.users.update_one({"id": user_id}, {"$set": {"face_enrolled": True, "face_consent_at": now_iso()}})
    await audit(actor, "daftar_wajah", "user", user_id, {"via": via})
    return {"ok": True}


@router.post("/face/enroll")
async def enroll_self(body: EnrollIn, u: dict = Depends(current_user)):
    return await _enroll(u["id"], body, u, "self")


# ================= ATTENDANCE =================
class ClockIn(BaseModel):
    action: str
    branch_id: str
    lat: float
    lng: float
    accuracy: float = 0
    descriptor: List[float] = []
    liveness: bool = False
    photo: Optional[str] = None
    flags: List[str] = []
    user_id: Optional[str] = None
    reason: str = ""


async def _schedule_for(user_id, date_str):
    s = await db.schedules.find_one({"user_id": user_id, "date": date_str, "shift_id": {"$ne": None}}, {"_id": 0})
    if not s:
        return None, None
    return s, await db.shifts.find_one({"id": s["shift_id"]}, {"_id": 0})


async def do_clock(user, body: ClockIn, device_id, actor, master=None):
    if body.action not in ("in", "out"):
        raise HTTPException(400, "Aksi tidak valid")
    branch = await db.branches.find_one({"id": body.branch_id, "active": True}, {"_id": 0})
    if not branch:
        raise HTTPException(404, "Cabang tidak ditemukan")
    allowed = user.get("attendance_branch_ids") or user.get("branch_ids", [])
    if body.branch_id not in allowed:
        raise HTTPException(403, "Anda tidak terdaftar untuk absen di cabang ini")
    dist = haversine(body.lat, body.lng, branch["lat"], branch["lng"])
    flags = list(body.flags)
    if body.accuracy and body.accuracy <= 1:
        flags.append("akurasi_gps_tidak_wajar")
    if dist > branch["radius_m"]:
        await audit(actor, "absen_ditolak_luar_radius", "attendance", user["id"], {"distance": round(dist, 1), "branch": branch["name"]})
        raise HTTPException(403, f"Anda berada {round(dist)} m dari {branch['name']}. Maksimal {branch['radius_m']:.0f} m.")
    if not body.liveness:
        raise HTTPException(400, "Liveness check belum lolos")
    ok, score = await face_match(user["id"], body.descriptor)
    if not ok:
        await audit(actor, "absen_ditolak_wajah", "attendance", user["id"], {"score": score})
        raise HTTPException(403, f"Wajah tidak cocok dengan akun (skor {score}). Coba lagi dengan pencahayaan cukup.")
    if flags:
        await audit(actor, "absen_flag_keamanan", "attendance", user["id"], {"flags": flags})
    photo = await save_data_url(body.photo, "attendance", user["id"]) if body.photo else None
    t = now()
    entry = {"time": t.isoformat(), "lat": body.lat, "lng": body.lng, "accuracy": body.accuracy, "distance_m": round(dist, 1),
             "photo_path": photo, "device_id": device_id, "face_score": score, "via_master": bool(master),
             "master_device_id": master["id"] if master else None, "reason": body.reason, "flags": flags}
    s = await get_settings()
    if body.action == "in":
        d = t.date().isoformat()
        if await db.attendance.find_one({"user_id": user["id"], "date": d, "clock_in": {"$ne": None}}):
            raise HTTPException(409, "Anda sudah absen masuk hari ini")
        sched, shift = await _schedule_for(user["id"], d)
        late = early = 0
        if shift:
            st, _ = shift_window(d, shift)
            diff = (t - st).total_seconds() / 60
            late = max(0, int(diff)) if diff > s["late_grace_minutes"] else 0
            early = max(0, int(-diff))
        doc = {"id": uid(), "user_id": user["id"], "branch_id": branch["id"], "date": d, "shift_id": shift["id"] if shift else None,
               "shift_name": shift["name"] if shift else None, "clock_in": entry, "clock_out": None,
               "status": "telat" if late else "hadir", "late_minutes": late, "early_minutes": early,
               "early_ot_blocks": early // s["ot_block_minutes"], "after_ot_blocks": 0, "early_leave_minutes": 0,
               "via_master": bool(master), "created_at": now_iso()}
        await db.attendance.insert_one(doc)
        await audit(actor, "absen_masuk", "attendance", doc["id"], {"user": user["name"], "via_master": bool(master), "score": score})
    else:
        doc = await db.attendance.find_one({"user_id": user["id"], "clock_out": None,
                                            "date": {"$gte": (t - timedelta(days=1)).date().isoformat()}}, sort=[("date", -1)])
        if not doc:
            raise HTTPException(400, "Belum ada absen masuk yang terbuka")
        after = early_leave = 0
        if doc.get("shift_id"):
            shift = await db.shifts.find_one({"id": doc["shift_id"]})
            _, en = shift_window(doc["date"], shift)
            diff = (t - en).total_seconds() / 60
            after = max(0, int(diff))
            early_leave = max(0, int(-diff))
        upd = {"clock_out": entry, "after_minutes": after, "after_ot_blocks": after // s["ot_block_minutes"],
               "early_leave_minutes": early_leave, "via_master": doc.get("via_master") or bool(master)}
        await db.attendance.update_one({"id": doc["id"]}, {"$set": upd})
        doc.update(upd)
        await audit(actor, "absen_pulang", "attendance", doc["id"], {"user": user["name"], "via_master": bool(master), "score": score})
    doc.pop("_id", None)
    return doc


@router.get("/attendance/status")
async def att_status(u: dict = Depends(current_user)):
    ids = u.get("attendance_branch_ids") or u.get("branch_ids", [])
    branches = await db.branches.find({"id": {"$in": ids}, "active": True}, {"_id": 0}).to_list(20)
    d = today()
    rec = await db.attendance.find_one({"user_id": u["id"], "clock_out": None, "date": {"$gte": (now() - timedelta(days=1)).date().isoformat()}},
                                       {"_id": 0}, sort=[("date", -1)])
    today_rec = await db.attendance.find_one({"user_id": u["id"], "date": d}, {"_id": 0})
    sched, shift = await _schedule_for(u["id"], d)
    return {"branches": branches, "open_record": rec, "today_record": today_rec, "shift": shift,
            "face_enrolled": u.get("face_enrolled", False), "device_bound": bool(u.get("device_id"))}


@router.post("/attendance/clock")
async def clock(body: ClockIn, request: Request, u: dict = Depends(current_user)):
    dev = request.headers.get("x-device-id", "")
    if not u.get("device_id") or dev != u["device_id"]:
        raise HTTPException(403, "Absensi hanya bisa dari HP yang terdaftar di akun ini")
    return await do_clock(u, body, dev, u)


async def _att_query(u, start, end, branch_id=None, user_id=None):
    ids = await visible_user_ids(u)
    if user_id:
        ids = [i for i in ids if i == user_id]
    q = {"user_id": {"$in": ids}, "date": {"$gte": start, "$lte": end}}
    if branch_id:
        q["branch_id"] = branch_id
    return q


@router.get("/attendance")
async def list_att(start: str, end: str, branch_id: str = "", user_id: str = "", via_master: bool = False, u: dict = Depends(current_user)):
    q = await _att_query(u, start, end, branch_id, user_id)
    if via_master:
        q["via_master"] = True
    docs = await db.attendance.find(q, {"_id": 0}).sort("date", -1).to_list(3000)
    names = await user_map({d["user_id"] for d in docs})
    for d in docs:
        d["user_name"] = names.get(d["user_id"], "-")
    return docs


async def build_recap(u, start, end, branch_id=""):
    q = user_scope_query(u)
    if branch_id:
        q = {"$and": [q, {"branch_ids": branch_id}]}
    users = await db.users.find({**q, "active": True}, {"_id": 0, "id": 1, "name": 1, "position": 1, "segment": 1}).to_list(2000)
    ids = [x["id"] for x in users]
    att = await db.attendance.find({"user_id": {"$in": ids}, "date": {"$gte": start, "$lte": end}}, {"_id": 0}).to_list(10000)
    reqs = await db.requests.find({"user_id": {"$in": ids}, "type": "cuti", "status": "disetujui",
                                   "date_start": {"$lte": end}, "date_end": {"$gte": start}}, {"_id": 0}).to_list(5000)
    scheds = await db.schedules.find({"user_id": {"$in": ids}, "date": {"$gte": start, "$lte": min(end, today())}, "shift_id": {"$ne": None}}, {"_id": 0}).to_list(10000)
    rows = []
    for x in users:
        a = [r for r in att if r["user_id"] == x["id"]]
        leave_days = {}
        for r in reqs:
            if r["user_id"] == x["id"]:
                for d in daterange(max(r["date_start"], start), min(r["date_end"], end)):
                    leave_days[d] = r.get("subtype", "cuti")
        att_days = {r["date"] for r in a}
        alpha = sum(1 for s in scheds if s["user_id"] == x["id"] and s["date"] not in att_days and s["date"] not in leave_days and s["date"] < today())
        rows.append({"user_id": x["id"], "name": x["name"], "position": x.get("position", ""), "segment": x.get("segment"),
                     "hadir": sum(1 for r in a if r["status"] == "hadir"), "telat": sum(1 for r in a if r["status"] == "telat"),
                     "izin": sum(1 for v in leave_days.values() if v.startswith("izin")),
                     "sakit": sum(1 for v in leave_days.values() if v == "sakit"),
                     "cuti": sum(1 for v in leave_days.values() if v == "cuti_tahunan"), "alpha": alpha,
                     "via_master": sum(1 for r in a if r.get("via_master")),
                     "ot_blocks": sum(r.get("early_ot_blocks", 0) + r.get("after_ot_blocks", 0) for r in a)})
    return rows


@router.get("/attendance/recap")
async def recap(start: str, end: str, branch_id: str = "", u: dict = Depends(current_user)):
    return await build_recap(u, start, end, branch_id)


RECAP_COLS = [("name", "Nama"), ("position", "Jabatan"), ("hadir", "Hadir"), ("telat", "Telat"), ("izin", "Izin"), ("sakit", "Sakit"),
              ("cuti", "Cuti"), ("alpha", "Alpha"), ("via_master", "Via HP Master"), ("ot_blocks", "Blok Lembur")]


def xlsx_response(title, cols, rows, filename):
    from openpyxl import Workbook
    wb = Workbook()
    ws = wb.active
    ws.title = title[:30]
    ws.append([c[1] for c in cols])
    for r in rows:
        ws.append([r.get(c[0]) for c in cols])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": f'attachment; filename="{filename}"'})


def pdf_table(title, subtitle, cols, rows):
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib import colors
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=landscape(A4), leftMargin=24, rightMargin=24, topMargin=24, bottomMargin=24)
    st = getSampleStyleSheet()
    data = [[c[1] for c in cols]] + [[str(r.get(c[0], "")) for c in cols] for r in rows]
    t = Table(data, repeatRows=1)
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E8650F")), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                           ("GRID", (0, 0), (-1, -1), 0.3, colors.grey), ("FONTSIZE", (0, 0), (-1, -1), 8)]))
    doc.build([Paragraph(title, st["Title"]), Paragraph(subtitle, st["Normal"]), Spacer(1, 10), t])
    buf.seek(0)
    return buf


@router.get("/attendance/export")
async def export_att(start: str, end: str, branch_id: str = "", fmt: str = "xlsx", u: dict = Depends(current_user)):
    rows = await build_recap(u, start, end, branch_id)
    if fmt == "pdf":
        buf = pdf_table("Rekap Absensi", f"Periode {start} s/d {end}", RECAP_COLS, rows)
        return StreamingResponse(buf, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="rekap-absensi-{start}.pdf"'})
    return xlsx_response("Rekap", RECAP_COLS, rows, f"rekap-absensi-{start}.xlsx")


# ================= KIOSK (HP MASTER) =================
async def kiosk_device(request: Request):
    token = request.headers.get("x-kiosk-token", "")
    m = await db.master_devices.find_one({"token_hash": sha(token), "active": True}, {"_id": 0, "token_hash": 0}) if token else None
    if not m:
        raise HTTPException(401, "HP Master belum diaktivasi atau nonaktif")
    m["branch"] = await db.branches.find_one({"id": m["branch_id"]}, {"_id": 0})
    return m


@router.get("/kiosk/me")
async def kiosk_me(m: dict = Depends(kiosk_device)):
    return m


@router.get("/kiosk/employees")
async def kiosk_emps(m: dict = Depends(kiosk_device)):
    q = {"active": True, "$or": [{"attendance_branch_ids": m["branch_id"]}, {"branch_ids": m["branch_id"]}]}
    emps = await db.users.find(q, {"_id": 0, "id": 1, "name": 1, "position": 1, "segment": 1, "face_enrolled": 1}).sort("name", 1).to_list(1000)
    d = today()
    att = {a["user_id"]: a async for a in db.attendance.find({"date": d, "user_id": {"$in": [e["id"] for e in emps]}}, {"_id": 0})}
    for e in emps:
        a = att.get(e["id"])
        e["state"] = "belum" if not a else ("pulang" if a.get("clock_out") else "masuk")
    return emps


@router.post("/kiosk/clock")
async def kiosk_clock(body: ClockIn, m: dict = Depends(kiosk_device)):
    if not body.reason.strip():
        raise HTTPException(400, "Alasan absen via HP Master wajib diisi")
    if body.branch_id != m["branch_id"]:
        raise HTTPException(403, "HP Master hanya berlaku di cabangnya")
    user = await db.users.find_one({"id": body.user_id, "active": True}, {"_id": 0})
    if not user:
        raise HTTPException(404, "Karyawan tidak ditemukan")
    actor = {"id": user["id"], "name": f"{user['name']} (HP Master {m['name']})", "role": user["role"]}
    return await do_clock(user, body, f"master:{m['id']}", actor, master=m)


class KioskEnrollIn(EnrollIn):
    user_id: str


@router.post("/kiosk/enroll")
async def kiosk_enroll(body: KioskEnrollIn, m: dict = Depends(kiosk_device)):
    user = await db.users.find_one({"id": body.user_id, "active": True})
    if not user:
        raise HTTPException(404, "Karyawan tidak ditemukan")
    return await _enroll(body.user_id, body, {"id": user["id"], "name": f"{user['name']} (HP Master)", "role": user["role"]}, f"master:{m['id']}")


class KioskResetIn(BaseModel):
    user_id: str
    descriptor: List[float]
    liveness: bool = False
    reason: str


@router.post("/kiosk/device-reset")
async def kiosk_reset(body: KioskResetIn, m: dict = Depends(kiosk_device)):
    user = await db.users.find_one({"id": body.user_id, "active": True})
    if not user or not body.reason.strip() or not body.liveness:
        raise HTTPException(400, "Data tidak lengkap")
    ok, score = await face_match(body.user_id, body.descriptor)
    if not ok:
        raise HTTPException(403, "Wajah tidak cocok")
    doc = {"id": uid(), "user_id": body.user_id, "reason": body.reason, "via": f"HP Master {m['name']}", "status": "menunggu",
           "created_at": now_iso(), "created_by": user["name"]}
    await db.device_resets.insert_one(doc)
    await audit({"id": user["id"], "name": user["name"], "role": user["role"]}, "ajukan_reset_device", "user", user["id"], {"via": "master"})
    await notify(await users_by_roles(["hrd", "management"]), "Permintaan Reset Device", f"{user['name']}: {body.reason}", "device", "/karyawan")
    return {"ok": True}


# ================= SHIFTS & SCHEDULES =================
class ShiftIn(BaseModel):
    name: str
    start: str
    end: str


@router.get("/shifts")
async def list_shifts(branch_id: str, u: dict = Depends(current_user)):
    return await db.shifts.find({"branch_id": branch_id}, {"_id": 0}).sort("order", 1).to_list(20)


@router.put("/shifts/{sid}")
async def update_shift(sid: str, body: ShiftIn, u: dict = Depends(require(*ADMIN))):
    await db.shifts.update_one({"id": sid}, {"$set": body.model_dump()})
    await audit(u, "ubah_shift", "shift", sid, body.model_dump())
    return {"ok": True}


def _monday(d):
    dd = date_cls.fromisoformat(d)
    return (dd - timedelta(days=dd.weekday())).isoformat()


@router.get("/schedules")
async def get_schedules(branch_id: str, start: str, u: dict = Depends(current_user)):
    days = [(date_cls.fromisoformat(start) + timedelta(days=i)).isoformat() for i in range(7)]
    q = user_scope_query(u)
    users = await db.users.find({"$and": [q, {"branch_ids": branch_id, "active": True}]},
                                {"_id": 0, "id": 1, "name": 1, "segment": 1, "role": 1, "position": 1}).sort("name", 1).to_list(1000)
    ids = [x["id"] for x in users]
    entries = await db.schedules.find({"user_id": {"$in": ids}, "date": {"$gte": days[0], "$lte": days[-1]}}, {"_id": 0}).to_list(5000)
    leaves = await db.requests.find({"user_id": {"$in": ids}, "type": "cuti", "status": {"$in": ["disetujui", "menunggu"]},
                                     "date_start": {"$lte": days[-1]}, "date_end": {"$gte": days[0]}}, {"_id": 0}).to_list(1000)
    return {"days": days, "users": users, "entries": entries, "leaves": leaves}


@router.get("/schedules/me")
async def my_schedule(start: str = "", u: dict = Depends(current_user)):
    start = start or _monday(today())
    end = (date_cls.fromisoformat(start) + timedelta(days=13)).isoformat()
    entries = await db.schedules.find({"user_id": u["id"], "date": {"$gte": start, "$lte": end}}, {"_id": 0}).sort("date", 1).to_list(100)
    shifts = {s["id"]: s async for s in db.shifts.find({}, {"_id": 0})}
    branches = {b["id"]: b["name"] async for b in db.branches.find({}, {"_id": 0})}
    for e in entries:
        e["shift"] = shifts.get(e.get("shift_id"))
        e["branch_name"] = branches.get(e["branch_id"])
    return entries


class SchedIn(BaseModel):
    user_id: str
    branch_id: str
    date: str
    shift_id: Optional[str] = None
    force: bool = False


@router.put("/schedules")
async def set_schedule(body: SchedIn, u: dict = Depends(require("management", "hrd", "spv", "pic_depan", "pic_dapur", "pic_bar"))):
    target = await db.users.find_one({"id": body.user_id}, {"_id": 0})
    if not target or body.branch_id not in target.get("branch_ids", []):
        raise HTTPException(404, "Karyawan tidak terdaftar di cabang ini")
    if u["role"] in PIC_ROLES and (target.get("segment") != PIC_ROLES[u["role"]] or body.branch_id not in u.get("branch_ids", [])):
        raise HTTPException(403, "PIC hanya dapat mengatur jadwal timnya sendiri")
    if u["role"] == "spv" and body.branch_id not in u.get("branch_ids", []):
        raise HTTPException(403, "Bukan cabang Anda")
    s = await get_settings()
    t = today()
    max_d = (now().date() + timedelta(days=s["schedule_max_days_ahead"])).isoformat()
    if body.date > max_d:
        raise HTTPException(400, f"Jadwal hanya bisa dibuat maksimal {s['schedule_max_days_ahead']} hari ke depan")
    if body.date < t and u["role"] not in ADMIN:
        raise HTTPException(400, "Jadwal yang sudah lewat hanya bisa diubah HRD")
    if body.shift_id:
        other = await db.schedules.find_one({"user_id": body.user_id, "date": body.date, "branch_id": {"$ne": body.branch_id}, "shift_id": {"$ne": None}})
        if other:
            raise HTTPException(409, "Konflik: karyawan sudah punya shift di cabang lain pada tanggal ini (double shift)")
        leave = await db.requests.find_one({"user_id": body.user_id, "type": "cuti", "status": "disetujui",
                                            "date_start": {"$lte": body.date}, "date_end": {"$gte": body.date}})
        if leave and not body.force:
            raise HTTPException(409, "Konflik: karyawan sedang cuti/izin yang disetujui pada tanggal ini")
    prev = await db.schedules.find_one({"user_id": body.user_id, "date": body.date, "branch_id": body.branch_id}, {"_id": 0})
    await db.schedules.update_one({"user_id": body.user_id, "date": body.date, "branch_id": body.branch_id},
                                  {"$set": {"shift_id": body.shift_id, "updated_by": u["name"], "updated_at": now_iso()},
                                   "$setOnInsert": {"id": uid()}}, upsert=True)
    shift = await db.shifts.find_one({"id": body.shift_id}) if body.shift_id else None
    label = f"{shift['name']} ({shift['start']}-{shift['end']})" if shift else "Libur"
    await audit(u, "ubah_jadwal", "schedule", body.user_id, {"date": body.date, "from": (prev or {}).get("shift_id"), "to": body.shift_id})
    await notify([body.user_id], "Jadwal diperbarui", f"{body.date}: {label}", "jadwal", "/jadwal")
    return {"ok": True}


# ================= REQUESTS =================
class ReqIn(BaseModel):
    type: str
    subtype: str = ""
    date_start: str
    date_end: str
    hours: float = 0
    reason: str
    attachment_path: Optional[str] = None


def _days(r):
    n = (date_cls.fromisoformat(r["date_end"]) - date_cls.fromisoformat(r["date_start"])).days + 1
    return 0.5 if r.get("subtype") == "izin_setengah_hari" else n


@router.post("/requests")
async def create_request(body: ReqIn, u: dict = Depends(current_user)):
    if body.type not in ("ph", "cuti", "lembur"):
        raise HTTPException(400, "Jenis request tidak valid")
    if body.date_end < body.date_start:
        raise HTTPException(400, "Tanggal selesai sebelum tanggal mulai")
    if body.type == "cuti" and body.subtype == "sakit" and not body.attachment_path:
        raise HTTPException(400, "Izin sakit wajib melampirkan surat/lampiran")
    s = await get_settings()
    doc = {"id": uid(), "user_id": u["id"], "user_name": u["name"], "segment": u.get("segment"), "branch_ids": u.get("branch_ids", []),
           **body.model_dump(), "status": "menunggu", "created_at": now_iso(), "history": []}
    if body.type == "cuti" and body.subtype == "cuti_tahunan":
        used = await _leave_used(u["id"])
        if used + _days(doc) > u.get("leave_quota", s["default_leave_quota"]):
            raise HTTPException(400, "Sisa kuota cuti tidak mencukupi")
    steps = []
    if u["role"] == "staff":
        steps.append("pic")
    if u["role"] in ("staff", *PIC_ROLES):
        steps.append("spv_hrd")
    need_mgmt = (body.type == "cuti" and _days(doc) >= s["mgmt_min_cuti_days"]) or body.type in s["mgmt_required_types"] \
        or u["role"] not in ("staff", *PIC_ROLES)
    if need_mgmt:
        steps.append("management")
    doc["steps"] = steps
    doc["current_step"] = 0
    await db.requests.insert_one(doc)
    await audit(u, "ajukan_request", "request", doc["id"], {"type": body.type})
    await notify(await _approvers(doc), "Request baru menunggu approval", f"{u['name']} - {body.type.upper()}", "approval", "/requests")
    doc.pop("_id", None)
    return doc


async def _approvers(r):
    step = r["steps"][r["current_step"]]
    if step == "pic":
        role = {v: k for k, v in PIC_ROLES.items()}.get(r.get("segment"))
        return await users_by_roles([role] if role else [], r["branch_ids"])
    if step == "spv_hrd":
        return await users_by_roles(["spv"], r["branch_ids"]) + await users_by_roles(["hrd"])
    return await users_by_roles(["management"])


def can_act(u, r):
    if r["status"] != "menunggu":
        return False
    step = r["steps"][r["current_step"]]
    if u["role"] == "management":
        return True
    if u["id"] == r["user_id"]:
        return False
    same_branch = bool(set(u.get("branch_ids", [])) & set(r["branch_ids"]))
    if step == "pic":
        return u["role"] == "hrd" or (u["role"] in PIC_ROLES and PIC_ROLES[u["role"]] == r.get("segment") and same_branch)
    if step == "spv_hrd":
        return u["role"] == "hrd" or (u["role"] == "spv" and same_branch)
    return False


async def _leave_used(user_id):
    y = str(now().year)
    rs = await db.requests.find({"user_id": user_id, "type": "cuti", "subtype": "cuti_tahunan", "status": "disetujui",
                                 "date_start": {"$regex": f"^{y}"}}).to_list(500)
    return sum(_days(r) for r in rs)


@router.get("/leave-quota/me")
async def leave_quota(u: dict = Depends(current_user)):
    s = await get_settings()
    q = u.get("leave_quota", s["default_leave_quota"])
    used = await _leave_used(u["id"])
    return {"quota": q, "used": used, "remaining": q - used}


@router.get("/requests")
async def list_requests(scope: str = "mine", status: str = "", type: str = "", u: dict = Depends(current_user)):
    if scope == "mine":
        q = {"user_id": u["id"]}
    else:
        q = {"user_id": {"$in": await visible_user_ids(u)}} if u["role"] not in ("management", "hrd") else {}
    if status:
        q["status"] = status
    if type:
        q["type"] = type
    docs = await db.requests.find(q, {"_id": 0}).sort("created_at", -1).to_list(1000)
    if scope == "approvals":
        docs = [d for d in docs if can_act(u, d)]
    for d in docs:
        d["can_act"] = can_act(u, d)
    return docs


class DecIn(BaseModel):
    approve: bool
    note: str = ""


@router.post("/requests/{rid}/decide")
async def decide_request(rid: str, body: DecIn, u: dict = Depends(current_user)):
    r = await db.requests.find_one({"id": rid}, {"_id": 0})
    if not r or not can_act(u, r):
        raise HTTPException(404, "Request tidak ditemukan atau bukan giliran Anda")
    h = {"step": r["steps"][r["current_step"]], "by": u["name"], "role": u["role"], "approve": body.approve, "note": body.note, "at": now_iso()}
    upd = {"history": r["history"] + [h]}
    if not body.approve:
        upd["status"] = "ditolak"
    elif r["current_step"] + 1 < len(r["steps"]):
        upd["current_step"] = r["current_step"] + 1
    else:
        upd["status"] = "disetujui"
    await db.requests.update_one({"id": rid}, {"$set": upd})
    r.update(upd)
    await audit(u, "approval_request", "request", rid, {"approve": body.approve, "step": h["step"]})
    if r["status"] == "menunggu":
        await notify(await _approvers(r), "Request menunggu approval", f"{r['user_name']} - {r['type'].upper()}", "approval", "/requests")
        await notify([r["user_id"]], "Request naik ke tahap berikutnya", f"Disetujui oleh {u['name']}", "approval", "/requests")
    else:
        await notify([r["user_id"]], f"Request {r['status']}", f"{r['type'].upper()} {r['date_start']} - {body.note}", "approval", "/requests")
        if r["status"] == "disetujui" and r["type"] == "cuti" and r.get("subtype") != "izin_setengah_hari":
            await db.schedules.update_many({"user_id": r["user_id"], "date": {"$gte": r["date_start"], "$lte": r["date_end"]}},
                                           {"$set": {"shift_id": None, "updated_by": "Sistem (cuti disetujui)"}})
    return r


@router.post("/requests/{rid}/cancel")
async def cancel_request(rid: str, u: dict = Depends(current_user)):
    r = await db.requests.find_one({"id": rid, "user_id": u["id"], "status": "menunggu"})
    if not r:
        raise HTTPException(404, "Request tidak dapat dibatalkan")
    await db.requests.update_one({"id": rid}, {"$set": {"status": "dibatalkan"}})
    await audit(u, "batal_request", "request", rid)
    return {"ok": True}


# ================= PAYROLL =================
class GenIn(BaseModel):
    period_type: str
    period_start: str
    period_end: str
    branch_id: str = ""


def _taxes(s, period_type, names):
    out = []
    tax = s["tax"]
    if not tax.get("enabled"):
        return out
    for c in tax.get("components", []):
        if c.get("applies_to", "monthly") not in (period_type, "both"):
            continue
        if c.get("type") == "percent":
            amt = names["gross"] * float(c.get("value") or 0) / 100
        elif c.get("type") == "fixed":
            amt = float(c.get("value") or 0)
        else:
            amt = safe_eval(c.get("formula") or "0", names)
        out.append({"name": c["name"], "amount": round(amt)})
    return out


async def _compute_item(user, ptype, start, end, s):
    comp = dec(user.get("comp_enc")) or {}
    uid_ = user["id"]
    end_eff = min(end, today())
    att = await db.attendance.find({"user_id": uid_, "date": {"$gte": start, "$lte": end}}, {"_id": 0}).to_list(500)
    reqs = await db.requests.find({"user_id": uid_, "status": "disetujui", "date_start": {"$lte": end}, "date_end": {"$gte": start}}, {"_id": 0}).to_list(500)
    item = {"user_id": uid_, "name": user["name"], "position": user.get("position", ""), "adjustment": 0, "adjust_note": ""}
    if ptype == "monthly":
        leave_days, unpaid = set(), 0
        for r in reqs:
            if r["type"] == "cuti" and r.get("subtype") != "izin_setengah_hari":
                for d in daterange(max(r["date_start"], start), min(r["date_end"], end)):
                    leave_days.add(d)
                    if r.get("subtype") == "izin":
                        unpaid += 1
        att_days = {a["date"] for a in att}
        scheds = await db.schedules.find({"user_id": uid_, "date": {"$gte": start, "$lte": end_eff}, "shift_id": {"$ne": None}}).to_list(500)
        alpha = sum(1 for x in scheds if x["date"] not in att_days and x["date"] not in leave_days and x["date"] < today())
        base = comp.get("base_salary", 0)
        days_off = unpaid + alpha
        deduction = round(base / s["payroll_divisor"] * days_off)
        gross = base + comp.get("allowance", 0) - deduction
        item.update({"base_salary": base, "allowance": comp.get("allowance", 0), "unpaid_days": unpaid, "alpha_days": alpha,
                     "absence_deduction": deduction, "gross": gross})
        names = {"gross": gross, "base": base, "allowance": comp.get("allowance", 0)}
    else:
        approved_ot = {}
        for r in reqs:
            if r["type"] == "lembur":
                for d in daterange(r["date_start"], r["date_end"]):
                    approved_ot[d] = approved_ot.get(d, 0) + (int(r.get("hours", 0) * 60 // s["ot_block_minutes"]) or 999)
        half_days = {d for r in reqs if r.get("subtype") == "izin_setengah_hari" for d in daterange(r["date_start"], r["date_end"])}
        blocks = 0
        for a in att:
            raw = a.get("early_ot_blocks", 0) + a.get("after_ot_blocks", 0)
            if s["overtime_requires_approval"]:
                raw = min(raw, approved_ot.get(a["date"], 0))
            blocks += raw
        meal_days = sum(1 for a in att if a.get("clock_in") and a.get("clock_out") and a["date"] not in half_days)
        ph_days = sum(len([d for d in daterange(max(r["date_start"], start), min(r["date_end"], end))]) for r in reqs if r["type"] == "ph")
        ot_pay, meal, ph = blocks * comp.get("ot_rate", 0), meal_days * comp.get("meal_rate", 0), ph_days * comp.get("ph_rate", 0)
        gross = ot_pay + meal + ph
        item.update({"ot_blocks": blocks, "ot_pay": ot_pay, "meal_days": meal_days, "meal_pay": meal, "ph_days": ph_days,
                     "ph_pay": ph, "gross": gross})
        names = {"gross": gross, "base": comp.get("base_salary", 0), "allowance": comp.get("allowance", 0)}
    item["taxes"] = _taxes(s, ptype, names)
    item["net"] = item["gross"] - sum(t["amount"] for t in item["taxes"])
    return item


def _run_out(run, items=True):
    out = {k: v for k, v in run.items() if k not in ("_id", "items_enc")}
    if items:
        out["items"] = dec(run.get("items_enc")) or []
    return out


@router.post("/payroll/generate")
async def gen_payroll(body: GenIn, u: dict = Depends(require("accounting", "management"))):
    if body.period_type not in ("weekly", "monthly"):
        raise HTTPException(400, "Periode tidak valid")
    existing = await db.payroll_runs.find_one({"period_type": body.period_type, "period_start": body.period_start,
                                               "period_end": body.period_end, "branch_id": body.branch_id})
    if existing and existing["status"] != "draft":
        raise HTTPException(409, "Periode ini sudah dikunci. Buka kunci dulu untuk revisi.")
    s = await get_settings()
    q = {"active": True, "role": {"$ne": "management"}}
    if body.branch_id:
        q["branch_ids"] = body.branch_id
    users = await db.users.find(q, {"_id": 0}).to_list(2000)
    items = [await _compute_item(x, body.period_type, body.period_start, body.period_end, s) for x in users]
    hist = {"at": now_iso(), "by": u["name"], "action": "generate"}
    coll = "payroll_monthly" if body.period_type == "monthly" else "payroll_weekly"
    if existing:
        await db.payroll_runs.update_one({"id": existing["id"]}, {"$set": {"items_enc": enc(items), "total": sum(i["net"] for i in items)},
                                                                   "$push": {"history": hist}})
        rid = existing["id"]
    else:
        rid = uid()
        await db.payroll_runs.insert_one({"id": rid, **body.model_dump(), "collection": coll, "status": "draft", "items_enc": enc(items),
                                          "total": sum(i["net"] for i in items), "created_at": now_iso(), "history": [hist]})
    await audit(u, "generate_payroll", "payroll", rid, body.model_dump())
    return _run_out(await db.payroll_runs.find_one({"id": rid}))


@router.get("/payroll/runs")
async def list_runs(u: dict = Depends(require("accounting", "management"))):
    runs = await db.payroll_runs.find({}).sort("period_start", -1).to_list(200)
    return [_run_out(r, items=False) for r in runs]


@router.get("/payroll/runs/{rid}")
async def get_run(rid: str, u: dict = Depends(require("accounting", "management"))):
    r = await db.payroll_runs.find_one({"id": rid})
    if not r:
        raise HTTPException(404, "Tidak ditemukan")
    return _run_out(r)


class AdjIn(BaseModel):
    adjustment: float
    note: str


@router.put("/payroll/runs/{rid}/items/{user_id}")
async def adjust_item(rid: str, user_id: str, body: AdjIn, u: dict = Depends(require("accounting"))):
    r = await db.payroll_runs.find_one({"id": rid, "status": "draft"})
    if not r:
        raise HTTPException(409, "Hanya periode draft yang bisa direvisi")
    items = dec(r["items_enc"])
    for i in items:
        if i["user_id"] == user_id:
            i["net"] = i["net"] - i.get("adjustment", 0) + body.adjustment
            i["adjustment"], i["adjust_note"] = body.adjustment, body.note
    await db.payroll_runs.update_one({"id": rid}, {"$set": {"items_enc": enc(items), "total": sum(i["net"] for i in items)},
                                                   "$push": {"history": {"at": now_iso(), "by": u["name"], "action": f"revisi {user_id}: {body.adjustment} ({body.note})"}}})
    await audit(u, "revisi_payroll", "payroll", rid, {"user_id": user_id, "adjustment": body.adjustment})
    return {"ok": True}


TRANSITIONS = {"lock": ("draft", "locked", ("accounting",)), "unlock": ("locked", "draft", ("accounting", "management")),
               "approve": ("locked", "approved", ("management",))}


@router.post("/payroll/runs/{rid}/{action}")
async def transition(rid: str, action: str, u: dict = Depends(require("accounting", "management"))):
    if action not in TRANSITIONS:
        raise HTTPException(404, "Aksi tidak dikenal")
    frm, to, roles = TRANSITIONS[action]
    if u["role"] not in roles:
        raise HTTPException(403, "Tidak punya akses")
    r = await db.payroll_runs.find_one({"id": rid, "status": frm})
    if not r:
        raise HTTPException(409, "Status periode tidak sesuai")
    await db.payroll_runs.update_one({"id": rid}, {"$set": {"status": to}, "$push": {"history": {"at": now_iso(), "by": u["name"], "action": action}}})
    await audit(u, f"payroll_{action}", "payroll", rid)
    if to == "approved":
        await notify([i["user_id"] for i in dec(r["items_enc"])], "Slip gaji tersedia",
                     f"Periode {r['period_start']} s/d {r['period_end']}", "payroll", "/payroll")
    elif to == "locked":
        await notify(await users_by_roles(["management"]), "Payroll menunggu persetujuan", f"{r['period_start']} - {r['period_end']}", "payroll", "/payroll")
    return {"ok": True}


PAY_COLS = {"monthly": [("name", "Nama"), ("position", "Jabatan"), ("base_salary", "Gaji Pokok"), ("allowance", "Tunjangan"),
                        ("unpaid_days", "Izin"), ("alpha_days", "Alpha"), ("absence_deduction", "Potongan"), ("adjustment", "Revisi"),
                        ("tax_total", "Pajak"), ("net", "Diterima")],
            "weekly": [("name", "Nama"), ("position", "Jabatan"), ("ot_blocks", "Blok Lembur"), ("ot_pay", "Uang Lembur"),
                       ("meal_days", "Hari Makan"), ("meal_pay", "Uang Makan"), ("ph_days", "Hari PH"), ("ph_pay", "Uang PH"),
                       ("adjustment", "Revisi"), ("tax_total", "Pajak"), ("net", "Diterima")]}


@router.get("/payroll/runs/{rid}/export")
async def export_run(rid: str, u: dict = Depends(require("accounting", "management"))):
    r = await db.payroll_runs.find_one({"id": rid})
    items = dec(r["items_enc"])
    for i in items:
        i["tax_total"] = sum(t["amount"] for t in i["taxes"])
    return xlsx_response("Payroll", PAY_COLS[r["period_type"]], items, f"payroll-{r['period_type']}-{r['period_start']}.xlsx")


@router.get("/payroll/my")
async def my_payroll(u: dict = Depends(current_user)):
    out = []
    async for r in db.payroll_runs.find({"status": "approved"}).sort("period_start", -1).limit(60):
        for i in dec(r["items_enc"]):
            if i["user_id"] == u["id"]:
                out.append({"run_id": r["id"], "period_type": r["period_type"], "period_start": r["period_start"],
                            "period_end": r["period_end"], "item": i})
    return out


@router.get("/payroll/runs/{rid}/slip/{user_id}")
async def slip_pdf(rid: str, user_id: str, u: dict = Depends(current_user)):
    if u["id"] != user_id and u["role"] not in ("accounting", "management"):
        raise HTTPException(404, "Tidak ditemukan")
    r = await db.payroll_runs.find_one({"id": rid})
    if not r or (u["id"] == user_id and u["role"] not in ("accounting", "management") and r["status"] != "approved"):
        raise HTTPException(404, "Tidak ditemukan")
    item = next((i for i in dec(r["items_enc"]) if i["user_id"] == user_id), None)
    if not item:
        raise HTTPException(404, "Tidak ditemukan")
    from reportlab.lib.pagesizes import A5
    from reportlab.pdfgen import canvas
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A5)
    w, h = A5
    rp = lambda v: "Rp " + f"{round(v or 0):,}".replace(",", ".")
    c.setFont("Helvetica-Bold", 14)
    c.drawString(30, h - 40, "SLIP GAJI " + ("BULANAN" if r["period_type"] == "monthly" else "MINGGUAN"))
    c.setFont("Helvetica", 9)
    c.drawString(30, h - 56, f"Periode: {r['period_start']} s/d {r['period_end']}")
    c.drawString(30, h - 68, f"Nama: {item['name']}   Jabatan: {item.get('position', '')}")
    rows = ([("Gaji Pokok", item.get("base_salary")), ("Tunjangan", item.get("allowance")),
             (f"Potongan tidak masuk ({item.get('unpaid_days', 0) + item.get('alpha_days', 0)} hari)", -item.get("absence_deduction", 0))]
            if r["period_type"] == "monthly" else
            [(f"Uang Lembur ({item.get('ot_blocks')} blok)", item.get("ot_pay")), (f"Uang Makan ({item.get('meal_days')} hari)", item.get("meal_pay")),
             (f"Uang PH ({item.get('ph_days')} hari)", item.get("ph_pay"))])
    rows += [(f"Revisi: {item.get('adjust_note', '')}", item.get("adjustment"))] if item.get("adjustment") else []
    rows += [(t["name"], -t["amount"]) for t in item["taxes"]]
    y = h - 100
    for label, v in rows:
        c.drawString(30, y, label[:60])
        c.drawRightString(w - 30, y, rp(v))
        y -= 16
    c.line(30, y + 8, w - 30, y + 8)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(30, y - 8, "Total Diterima")
    c.drawRightString(w - 30, y - 8, rp(item["net"]))
    c.showPage()
    c.save()
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="slip-{r["period_start"]}.pdf"'})
