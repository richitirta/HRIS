import time
from datetime import timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query
from pydantic import BaseModel

from core import (db, ADMIN, GLOBAL_VIEW, PIC_ROLES, SEGMENTS, now, now_iso, today, uid, parse_dt, get_settings, current_user,
                  require, user_scope_query, visible_user_ids, user_map, audit, notify, users_by_roles, save_file, hash_pw, enc)

router = APIRouter()

# ================= RECRUITMENT =================
STAGES = ["masuk", "interview", "seleksi", "offering", "diterima", "ditolak"]


class JobIn(BaseModel):
    title: str
    branch_id: str
    segment: str = "depan"
    description: str = ""
    requirements: str = ""
    active: bool = True


@router.get("/public/jobs")
async def public_jobs():
    jobs = await db.jobs.find({"active": True}, {"_id": 0}).sort("created_at", -1).to_list(200)
    br = {b["id"]: b["name"] async for b in db.branches.find({}, {"_id": 0})}
    for j in jobs:
        j["branch_name"] = br.get(j["branch_id"], "-")
    return jobs


@router.post("/public/apply")
async def apply(job_id: str = Form(...), name: str = Form(...), email: str = Form(...), phone: str = Form(...),
                cover: str = Form(""), cv: UploadFile = File(...)):
    job = await db.jobs.find_one({"id": job_id, "active": True})
    if not job:
        raise HTTPException(404, "Lowongan tidak ditemukan")
    data = await cv.read()
    ext = cv.filename.rsplit(".", 1)[-1].lower() if "." in cv.filename else ""
    if ext not in ("pdf", "doc", "docx", "jpg", "jpeg", "png") or len(data) > 5 * 1024 * 1024:
        raise HTTPException(400, "CV harus PDF/DOC/JPG maksimal 5MB")
    path = await save_file(data, cv.content_type or "application/octet-stream", ext, "cv", "public", cv.filename)
    doc = {"id": uid(), "job_id": job_id, "branch_id": job["branch_id"], "position": job["title"], "name": name.strip(),
           "email": email.strip().lower(), "phone": phone.strip(), "cover": cover, "cv_path": path, "cv_name": cv.filename,
           "stage": "masuk", "created_at": now_iso(), "interviews": [], "score": None, "notes": "", "offer": None}
    await db.applicants.insert_one(doc)
    await notify(await users_by_roles(["hrd"]), "Pelamar baru", f"{name} - {job['title']}", "recruitment", "/rekrutmen")
    return {"ok": True}


@router.get("/jobs")
async def list_jobs(u: dict = Depends(require(*ADMIN))):
    return await db.jobs.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)


@router.post("/jobs")
async def create_job(body: JobIn, u: dict = Depends(require(*ADMIN))):
    doc = {"id": uid(), **body.model_dump(), "created_at": now_iso()}
    await db.jobs.insert_one(doc)
    await audit(u, "buat_lowongan", "job", doc["id"], {"title": body.title})
    doc.pop("_id", None)
    return doc


@router.put("/jobs/{jid}")
async def update_job(jid: str, body: JobIn, u: dict = Depends(require(*ADMIN))):
    await db.jobs.update_one({"id": jid}, {"$set": body.model_dump()})
    return {"ok": True}


@router.get("/applicants")
async def list_applicants(job_id: str = "", q: str = "", u: dict = Depends(require(*ADMIN))):
    flt = {}
    if job_id:
        flt["job_id"] = job_id
    if q:
        flt["$or"] = [{"name": {"$regex": q, "$options": "i"}}, {"position": {"$regex": q, "$options": "i"}}]
    return await db.applicants.find(flt, {"_id": 0}).sort("created_at", -1).to_list(1000)


class StageIn(BaseModel):
    stage: str
    note: str = ""


async def _app(aid):
    a = await db.applicants.find_one({"id": aid}, {"_id": 0})
    if not a:
        raise HTTPException(404, "Pelamar tidak ditemukan")
    return a


@router.put("/applicants/{aid}/stage")
async def set_stage(aid: str, body: StageIn, u: dict = Depends(require(*ADMIN))):
    a = await _app(aid)
    if body.stage not in STAGES or body.stage == "diterima":
        raise HTTPException(400, "Tahap tidak valid (penerimaan lewat Offering)")
    await db.applicants.update_one({"id": aid}, {"$set": {"stage": body.stage}})
    await audit(u, "ubah_tahap_pelamar", "applicant", aid, {"from": a["stage"], "to": body.stage})
    return {"ok": True}


class InterviewIn(BaseModel):
    date: str
    time: str
    interviewer_id: str
    notes: str = ""


@router.post("/applicants/{aid}/interview")
async def schedule_interview(aid: str, body: InterviewIn, u: dict = Depends(require(*ADMIN))):
    a = await _app(aid)
    names = await user_map([body.interviewer_id])
    iv = {**body.model_dump(), "interviewer_name": names.get(body.interviewer_id, "-"), "created_at": now_iso()}
    await db.applicants.update_one({"id": aid}, {"$push": {"interviews": iv}, "$set": {"stage": "interview"}})
    await notify([body.interviewer_id], "Jadwal interview", f"{a['name']} ({a['position']}) {body.date} {body.time}", "recruitment", "/rekrutmen")
    await audit(u, "jadwal_interview", "applicant", aid, body.model_dump())
    return {"ok": True}


class ScoreIn(BaseModel):
    score: float
    notes: str = ""


@router.post("/applicants/{aid}/score")
async def score_applicant(aid: str, body: ScoreIn, u: dict = Depends(require(*ADMIN, "spv"))):
    await _app(aid)
    await db.applicants.update_one({"id": aid}, {"$set": {"score": body.score, "notes": body.notes, "stage": "seleksi", "scored_by": u["name"]}})
    await audit(u, "nilai_pelamar", "applicant", aid, body.model_dump())
    return {"ok": True}


class OfferIn(BaseModel):
    position: str
    role: str = "staff"
    segment: str = "depan"
    start_date: str
    base_salary: float
    allowance: float = 0
    meal_rate: float = 0
    ot_rate: float = 0
    ph_rate: float = 0
    letter: str = ""


@router.post("/applicants/{aid}/offer")
async def make_offer(aid: str, body: OfferIn, u: dict = Depends(require(*ADMIN))):
    await _app(aid)
    offer = {**body.model_dump(), "status": "menunggu_management", "created_by": u["name"], "created_at": now_iso()}
    await db.applicants.update_one({"id": aid}, {"$set": {"offer": offer, "stage": "offering"}})
    await notify(await users_by_roles(["management"]), "Offering menunggu persetujuan", body.position, "recruitment", "/rekrutmen")
    await audit(u, "buat_offering", "applicant", aid)
    return {"ok": True}


class BoolIn(BaseModel):
    approve: bool
    note: str = ""


@router.post("/applicants/{aid}/offer/approve")
async def approve_offer(aid: str, body: BoolIn, u: dict = Depends(require("management"))):
    a = await _app(aid)
    if not a.get("offer") or a["offer"]["status"] != "menunggu_management":
        raise HTTPException(409, "Offering tidak menunggu persetujuan")
    st = "disetujui_management" if body.approve else "ditolak_management"
    await db.applicants.update_one({"id": aid}, {"$set": {"offer.status": st, "offer.mgmt_note": body.note}})
    await notify(await users_by_roles(["hrd"]), f"Offering {st.replace('_', ' ')}", a["name"], "recruitment", "/rekrutmen")
    await audit(u, "approval_offering", "applicant", aid, {"approve": body.approve})
    return {"ok": True}


@router.post("/applicants/{aid}/offer/response")
async def offer_response(aid: str, body: BoolIn, u: dict = Depends(require(*ADMIN))):
    a = await _app(aid)
    if not a.get("offer") or a["offer"]["status"] != "disetujui_management":
        raise HTTPException(409, "Offering belum disetujui Management")
    if not body.approve:
        await db.applicants.update_one({"id": aid}, {"$set": {"stage": "ditolak", "offer.status": "ditolak_kandidat"}})
        return {"ok": True}
    if await db.users.find_one({"email": a["email"]}):
        raise HTTPException(409, "Email pelamar sudah terdaftar sebagai karyawan")
    o = a["offer"]
    import secrets
    pw = secrets.token_urlsafe(8)
    comp = {k: float(o.get(k) or 0) for k in ("base_salary", "allowance", "meal_rate", "ot_rate", "ph_rate")}
    user = {"id": uid(), "name": a["name"], "email": a["email"], "phone": a["phone"], "role": o["role"], "segment": o["segment"],
            "position": o["position"], "level": "", "nik": "", "branch_ids": [a["branch_id"]], "attendance_branch_ids": [a["branch_id"]],
            "active": True, "leave_quota": 12, "join_date": o["start_date"], "password_hash": hash_pw(pw), "comp_enc": enc(comp),
            "device_id": None, "face_enrolled": False, "created_at": now_iso(), "onboarding": True}
    await db.users.insert_one(user)
    await db.applicants.update_one({"id": aid}, {"$set": {"stage": "diterima", "offer.status": "diterima", "employee_id": user["id"]}})
    await audit(u, "pelamar_jadi_karyawan", "user", user["id"], {"applicant": aid})
    return {"ok": True, "employee_id": user["id"], "email": user["email"], "temp_password": pw}


# ================= KPI =================
class CatIn(BaseModel):
    name: str
    weight: float
    target: str = "staff"
    active: bool = True


@router.get("/kpi/categories")
async def kpi_cats(u: dict = Depends(current_user)):
    return await db.kpi_categories.find({}, {"_id": 0}).sort("name", 1).to_list(200)


@router.post("/kpi/categories")
async def add_cat(body: CatIn, u: dict = Depends(require(*ADMIN))):
    doc = {"id": uid(), **body.model_dump()}
    await db.kpi_categories.insert_one(doc)
    await audit(u, "buat_kategori_kpi", "kpi", doc["id"], body.model_dump())
    doc.pop("_id", None)
    return doc


@router.put("/kpi/categories/{cid}")
async def edit_cat(cid: str, body: CatIn, u: dict = Depends(require(*ADMIN))):
    await db.kpi_categories.update_one({"id": cid}, {"$set": body.model_dump()})
    await audit(u, "ubah_kategori_kpi", "kpi", cid, body.model_dump())
    return {"ok": True}


async def _kpi_targets(u):
    if u["role"] == "spv":
        q = {"role": {"$in": list(PIC_ROLES)}, "branch_ids": {"$in": u.get("branch_ids", [])}}
    elif u["role"] in PIC_ROLES:
        q = {"role": "staff", "segment": PIC_ROLES[u["role"]], "branch_ids": {"$in": u.get("branch_ids", [])}}
    else:
        return []
    return await db.users.find({**q, "active": True}, {"_id": 0, "id": 1, "name": 1, "role": 1, "segment": 1, "position": 1}).to_list(500)


@router.get("/kpi/targets")
async def kpi_targets(u: dict = Depends(current_user)):
    return await _kpi_targets(u)


async def task_score(user_id, period):
    tasks = await db.tasks.find({"assignee_ids": user_id, "deadline": {"$regex": f"^{period}"}}).to_list(500)
    if not tasks:
        return None
    ok = sum(1 for t in tasks if t.get("verification") == "disetujui")
    return round(ok / len(tasks) * 100, 1)


class ScoreKpiIn(BaseModel):
    employee_id: str
    period: str
    scores: dict
    note: str = ""


@router.post("/kpi/scores")
async def submit_kpi(body: ScoreKpiIn, u: dict = Depends(current_user)):
    targets = {t["id"]: t for t in await _kpi_targets(u)}
    if body.employee_id not in targets:
        raise HTTPException(403, "Anda hanya dapat menilai satu level di bawah Anda")
    t = targets[body.employee_id]
    level = "pic" if t["role"] in PIC_ROLES else "staff"
    cats = await db.kpi_categories.find({"active": True, "target": level}, {"_id": 0}).to_list(100)
    if not cats:
        raise HTTPException(400, "Belum ada kategori KPI aktif")
    tw = sum(c["weight"] for c in cats) or 1
    total = 0
    for c in cats:
        v = float(body.scores.get(c["id"], 0))
        if not 1 <= v <= 5:
            raise HTTPException(400, f"Nilai '{c['name']}' harus 1-5")
        total += v * c["weight"]
    eval_score = round(total / tw * 20, 1)
    s = await get_settings()
    ts = await task_score(body.employee_id, body.period)
    w = s["kpi_task_weight"] if ts is not None else 0
    final = round(eval_score * (1 - w) + (ts or 0) * w, 1)
    doc = {"employee_id": body.employee_id, "employee_name": t["name"], "segment": t.get("segment"), "level": level,
           "period": body.period, "scores": body.scores, "note": body.note, "evaluator_id": u["id"], "evaluator_name": u["name"],
           "eval_score": eval_score, "task_score": ts, "final_score": final, "updated_at": now_iso()}
    await db.kpi_scores.update_one({"employee_id": body.employee_id, "period": body.period}, {"$set": doc, "$setOnInsert": {"id": uid()}}, upsert=True)
    await notify([body.employee_id], "Nilai KPI baru", f"Periode {body.period}: {final}", "kpi", "/kpi")
    await audit(u, "nilai_kpi", "kpi", body.employee_id, {"period": body.period, "final": final})
    return doc


@router.get("/kpi/scores")
async def list_kpi(period: str = "", u: dict = Depends(current_user)):
    q = {} if u["role"] in ("management", "hrd") else {"$or": [{"employee_id": {"$in": await visible_user_ids(u)}}, {"evaluator_id": u["id"]}]}
    if period:
        q["period"] = period
    return await db.kpi_scores.find(q, {"_id": 0}).sort("final_score", -1).to_list(2000)


# ================= TASKS & PROJECTS =================
TASK_STATUS = ["pending", "on_progress", "done", "closed", "scheduled"]


class ProjectIn(BaseModel):
    name: str
    description: str = ""
    branch_id: str = ""


@router.get("/projects")
async def list_projects(u: dict = Depends(current_user)):
    return await db.projects.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)


@router.post("/projects")
async def create_project(body: ProjectIn, u: dict = Depends(require("management", "hrd", "spv", *PIC_ROLES))):
    doc = {"id": uid(), **body.model_dump(), "created_by": u["name"], "created_at": now_iso()}
    await db.projects.insert_one(doc)
    doc.pop("_id", None)
    return doc


class TaskIn(BaseModel):
    title: str
    description: str = ""
    assignee_ids: List[str] = []
    branch_id: str = ""
    segment: str = ""
    project_id: str = ""
    deadline: str
    priority: str = "sedang"
    status: str = "pending"
    recurrence: str = "none"
    attachments: List[dict] = []


def _task_scope(u):
    r = u["role"]
    if r in ("management", "hrd"):
        return {}
    if r == "spv":
        return {"$or": [{"branch_id": {"$in": u.get("branch_ids", [])}}, {"assignee_ids": u["id"]}]}
    if r in PIC_ROLES:
        return {"$or": [{"created_by_id": u["id"]}, {"assignee_ids": u["id"]},
                        {"branch_id": {"$in": u.get("branch_ids", [])}, "segment": PIC_ROLES[r]}]}
    return {"$or": [{"assignee_ids": u["id"]}, {"created_by_id": u["id"]}]}


@router.get("/tasks")
async def list_tasks(status: str = "", branch_id: str = "", segment: str = "", u: dict = Depends(current_user)):
    q = _task_scope(u)
    if status:
        q["status"] = status
    if branch_id:
        q["branch_id"] = branch_id
    if segment:
        q["segment"] = segment
    docs = await db.tasks.find(q, {"_id": 0}).sort("deadline", 1).to_list(2000)
    names = await user_map({i for d in docs for i in d.get("assignee_ids", [])})
    for d in docs:
        d["assignee_names"] = [names.get(i, "-") for i in d.get("assignee_ids", [])]
    return docs


@router.post("/tasks")
async def create_task(body: TaskIn, u: dict = Depends(require("management", "hrd", "spv", "accounting", "purchasing", *PIC_ROLES))):
    if body.status not in TASK_STATUS:
        raise HTTPException(400, "Status tidak valid")
    doc = {"id": uid(), **body.model_dump(), "created_by_id": u["id"], "created_by": u["name"], "created_role": u["role"],
           "verification": "belum", "comments": [], "reminded": [], "created_at": now_iso()}
    if not doc["segment"] and u["role"] in PIC_ROLES:
        doc["segment"] = PIC_ROLES[u["role"]]
    await db.tasks.insert_one(doc)
    await notify(body.assignee_ids, "Task baru untuk Anda", f"{body.title} (deadline {body.deadline[:16].replace('T', ' ')})", "task", "/tasks")
    await audit(u, "buat_task", "task", doc["id"], {"title": body.title, "assignees": body.assignee_ids})
    doc.pop("_id", None)
    return doc


async def _task(tid, u):
    t = await db.tasks.find_one({"id": tid, **_task_scope(u)}, {"_id": 0})
    if not t:
        raise HTTPException(404, "Task tidak ditemukan")
    return t


@router.put("/tasks/{tid}")
async def update_task(tid: str, body: dict, u: dict = Depends(current_user)):
    t = await _task(tid, u)
    allowed = {"status"} if u["role"] == "staff" else {"title", "description", "assignee_ids", "branch_id", "segment", "project_id",
                                                       "deadline", "priority", "status", "recurrence", "attachments"}
    data = {k: v for k, v in body.items() if k in allowed}
    if "status" in data and data["status"] not in TASK_STATUS:
        raise HTTPException(400, "Status tidak valid")
    if data.get("status") == "closed" and t.get("verification") != "disetujui":
        raise HTTPException(400, "Task hanya bisa ditutup setelah diverifikasi Management")
    if data.get("status") == "done" and t["status"] != "done":
        data["verification"] = "menunggu"
        data["done_at"] = now_iso()
        await notify(await users_by_roles(["management"]) + await users_by_roles(["spv"], [t["branch_id"]] if t.get("branch_id") else None),
                     "Task menunggu verifikasi", t["title"], "task", "/tasks")
        if t.get("recurrence") in ("daily", "weekly"):
            nd = parse_dt(t["deadline"]) + timedelta(days=1 if t["recurrence"] == "daily" else 7)
            nxt = {**{k: v for k, v in t.items() if k not in ("assignee_names",)}, "id": uid(), "deadline": nd.isoformat(),
                   "status": "scheduled", "verification": "belum", "comments": [], "reminded": [], "created_at": now_iso()}
            await db.tasks.insert_one(nxt)
    await db.tasks.update_one({"id": tid}, {"$set": data})
    await audit(u, "ubah_task", "task", tid, data)
    return {"ok": True}


class CommentIn(BaseModel):
    text: str


@router.post("/tasks/{tid}/comments")
async def comment(tid: str, body: CommentIn, u: dict = Depends(current_user)):
    await _task(tid, u)
    c = {"id": uid(), "by": u["name"], "text": body.text, "at": now_iso()}
    await db.tasks.update_one({"id": tid}, {"$push": {"comments": c}})
    return c


class VerifyIn(BaseModel):
    approve: bool
    note: str = ""


@router.post("/tasks/{tid}/verify")
async def verify_task(tid: str, body: VerifyIn, u: dict = Depends(require("management", "spv"))):
    t = await _task(tid, u)
    if t.get("verification") not in ("menunggu", "diverifikasi_spv"):
        raise HTTPException(409, "Task belum dikerjakan / sudah diverifikasi")
    if u["role"] == "spv":
        upd = {"verification": "diverifikasi_spv" if body.approve else "ditolak", "spv_note": body.note}
        if not body.approve:
            upd["status"] = "on_progress"
    else:
        upd = {"verification": "disetujui" if body.approve else "ditolak", "mgmt_note": body.note, "verified_by": u["name"], "verified_at": now_iso()}
        upd["status"] = "closed" if body.approve else "on_progress"
    await db.tasks.update_one({"id": tid}, {"$set": upd})
    await notify(t.get("assignee_ids", []) + [t["created_by_id"]], f"Task {upd['verification'].replace('_', ' ')}", f"{t['title']} {body.note}", "task", "/tasks")
    await audit(u, "verifikasi_task", "task", tid, upd)
    return {"ok": True}


# ================= ANNOUNCEMENTS =================
class AnnIn(BaseModel):
    title: str
    body: str
    branch_ids: List[str] = []
    segments: List[str] = []
    pinned: bool = False


def _ann_visible(a, u):
    if u["role"] in ("management", "hrd"):
        return True
    ok_b = not a["branch_ids"] or bool(set(a["branch_ids"]) & set(u.get("branch_ids", [])))
    ok_s = not a["segments"] or u.get("segment") in a["segments"]
    return ok_b and ok_s


@router.get("/announcements")
async def list_ann(u: dict = Depends(current_user)):
    docs = await db.announcements.find({"deleted": {"$ne": True}}, {"_id": 0}).sort([("pinned", -1), ("created_at", -1)]).to_list(300)
    out = []
    for a in docs:
        if _ann_visible(a, u):
            a["is_read"] = u["id"] in a.get("read_by", [])
            a["read_count"] = len(a.get("read_by", []))
            a.pop("read_by", None)
            out.append(a)
    return out


@router.post("/announcements")
async def create_ann(body: AnnIn, u: dict = Depends(require(*ADMIN))):
    doc = {"id": uid(), **body.model_dump(), "author": u["name"], "created_at": now_iso(), "read_by": []}
    await db.announcements.insert_one(doc)
    q = {"active": True}
    if body.branch_ids:
        q["branch_ids"] = {"$in": body.branch_ids}
    if body.segments:
        q["segment"] = {"$in": body.segments}
    ids = [x["id"] async for x in db.users.find(q, {"id": 1})]
    await notify(ids, "Pengumuman: " + body.title, body.body[:120], "announcement", "/pengumuman")
    await audit(u, "buat_pengumuman", "announcement", doc["id"])
    return {"ok": True}


@router.put("/announcements/{aid}")
async def update_ann(aid: str, body: AnnIn, u: dict = Depends(require(*ADMIN))):
    await db.announcements.update_one({"id": aid}, {"$set": body.model_dump()})
    return {"ok": True}


@router.delete("/announcements/{aid}")
async def delete_ann(aid: str, u: dict = Depends(require(*ADMIN))):
    await db.announcements.update_one({"id": aid}, {"$set": {"deleted": True}})
    await audit(u, "hapus_pengumuman", "announcement", aid)
    return {"ok": True}


@router.post("/announcements/{aid}/read")
async def read_ann(aid: str, u: dict = Depends(current_user)):
    await db.announcements.update_one({"id": aid}, {"$addToSet": {"read_by": u["id"]}})
    return {"ok": True}


# ================= DAILY REPORTS =================
class ReportIn(BaseModel):
    branch_id: str
    income: float
    work_done: str
    appreciation: str = ""
    busy_reason: str = ""
    notes: str = ""


@router.post("/daily-reports")
async def submit_report(body: ReportIn, u: dict = Depends(require(*PIC_ROLES))):
    if body.branch_id not in u.get("branch_ids", []):
        raise HTTPException(403, "Bukan cabang Anda")
    d = today()
    doc = {**body.model_dump(), "pic_id": u["id"], "pic_name": u["name"], "segment": PIC_ROLES[u["role"]], "date": d, "submitted_at": now_iso()}
    await db.daily_reports.update_one({"pic_id": u["id"], "date": d, "branch_id": body.branch_id}, {"$set": doc, "$setOnInsert": {"id": uid()}}, upsert=True)
    await audit(u, "isi_laporan_harian", "daily_report", u["id"], {"date": d, "income": body.income})
    return doc


@router.get("/daily-reports")
async def list_reports(date: str = "", branch_id: str = "", u: dict = Depends(current_user)):
    q = {}
    if u["role"] in PIC_ROLES:
        q["pic_id"] = u["id"]
    elif u["role"] == "spv":
        q["branch_id"] = {"$in": u.get("branch_ids", [])}
    elif u["role"] not in GLOBAL_VIEW:
        raise HTTPException(403, "Tidak punya akses")
    if date:
        q["date"] = date
    if branch_id:
        q["branch_id"] = branch_id
    return await db.daily_reports.find(q, {"_id": 0}).sort("submitted_at", -1).to_list(500)


async def report_status(d, branch_ids=None, segment=None):
    q = {"role": {"$in": list(PIC_ROLES)}, "active": True}
    if segment and segment in PIC_ROLES.values():
        q["segment"] = segment
    pics = await db.users.find(q, {"_id": 0, "id": 1, "name": 1, "role": 1, "branch_ids": 1}).to_list(500)
    reps = {(r["pic_id"], r["branch_id"]): r async for r in db.daily_reports.find({"date": d}, {"_id": 0})}
    br = {b["id"]: b["name"] async for b in db.branches.find({"active": True}, {"_id": 0})}
    out = []
    for p in pics:
        for b in p.get("branch_ids", []):
            if b in br and (not branch_ids or b in branch_ids):
                r = reps.get((p["id"], b))
                out.append({"pic_id": p["id"], "pic_name": p["name"], "segment": PIC_ROLES[p["role"]], "branch_id": b,
                            "branch_name": br[b], "submitted": bool(r), "report": r})
    return out


@router.get("/daily-reports/status")
async def reports_status(date: str = "", u: dict = Depends(require("management", "hrd", "spv", "accounting"))):
    return await report_status(date or today(), u.get("branch_ids") if u["role"] == "spv" else None)


# ================= DASHBOARD =================
@router.get("/dashboard")
async def dashboard(segment: str = "", branch_id: str = "", u: dict = Depends(current_user)):
    d = today()
    if u["role"] in PIC_ROLES:
        segment = PIC_ROLES[u["role"]]
    elif u["role"] in ("accounting", "purchasing", "hrd") and not segment:
        segment = ""
    branches = await db.branches.find({"active": True}, {"_id": 0}).to_list(50)
    if u["role"] not in GLOBAL_VIEW:
        branches = [b for b in branches if b["id"] in u.get("branch_ids", [])]
    bids = [branch_id] if branch_id else [b["id"] for b in branches]
    uq = {"active": True, "branch_ids": {"$in": bids}}
    if segment:
        uq["segment"] = segment
    team = await db.users.find(uq, {"_id": 0, "id": 1, "name": 1, "role": 1, "segment": 1, "position": 1}).to_list(2000)
    ids = [x["id"] for x in team]
    names = {x["id"]: x["name"] for x in team}
    sched = await db.schedules.find({"user_id": {"$in": ids}, "date": d, "branch_id": {"$in": bids}, "shift_id": {"$ne": None}}, {"_id": 0}).to_list(2000)
    att = await db.attendance.find({"user_id": {"$in": ids}, "date": d}, {"_id": 0}).to_list(2000)
    present = [{"name": names.get(a["user_id"]), "status": a["status"], "in": a["clock_in"]["time"][11:16],
                "out": a["clock_out"]["time"][11:16] if a.get("clock_out") else None, "via_master": a.get("via_master")} for a in att]
    tq = {"branch_id": {"$in": bids + [""]}}
    if segment:
        tq["segment"] = segment
    tasks = await db.tasks.find(tq, {"_id": 0, "comments": 0}).to_list(3000)
    counts = {s: sum(1 for t in tasks if t["status"] == s) for s in TASK_STATUS}
    overdue = [t for t in tasks if t["status"] in ("pending", "on_progress") and t["deadline"] < now_iso()][:8]
    pending_verif = sum(1 for t in tasks if t.get("verification") in ("menunggu", "diverifikasi_spv"))
    pic_ids = [x["id"] for x in team if x["role"] in PIC_ROLES]
    activity = await db.audit_logs.find({"actor_id": {"$in": pic_ids}, "action": {"$nin": ["login"]}}, {"_id": 0}).sort("at", -1).to_list(12)
    reports = await report_status(d, bids, segment or None)
    by_branch = []
    for b in branches:
        if branch_id and b["id"] != branch_id:
            continue
        b_ids = [x["id"] async for x in db.users.find({"branch_ids": b["id"], "active": True}, {"id": 1})]
        inc = sum(r["report"]["income"] for r in reports if r["branch_id"] == b["id"] and r["submitted"])
        by_branch.append({"branch_id": b["id"], "name": b["name"],
                          "scheduled": await db.schedules.count_documents({"branch_id": b["id"], "date": d, "shift_id": {"$ne": None}}),
                          "present": await db.attendance.count_documents({"branch_id": b["id"], "date": d}),
                          "late": await db.attendance.count_documents({"branch_id": b["id"], "date": d, "status": "telat"}),
                          "reports_missing": sum(1 for r in reports if r["branch_id"] == b["id"] and not r["submitted"]),
                          "income_today": inc, "employees": len(b_ids)})
    pinned = [a for a in await db.announcements.find({"pinned": True, "deleted": {"$ne": True}}, {"_id": 0, "read_by": 0}).sort("created_at", -1).to_list(3)]
    return {"date": d, "segment": segment, "attendance": {"scheduled": len(sched), "present": len(att),
            "late": sum(1 for a in att if a["status"] == "telat"), "via_master": sum(1 for a in att if a.get("via_master")), "list": present},
            "tasks": {"counts": counts, "overdue": overdue, "pending_verification": pending_verif},
            "activity": activity, "reports": reports, "branches": by_branch, "pinned": pinned}


# ================= SWEEPS (reminders, lazily triggered) =================
_last_sweep = {"t": 0}


async def run_sweeps():
    if time.time() - _last_sweep["t"] < 300:
        return
    _last_sweep["t"] = time.time()
    n = now()
    async for t in db.tasks.find({"status": {"$in": ["pending", "on_progress", "scheduled"]}}, {"_id": 0}):
        try:
            hours = (parse_dt(t["deadline"]) - n).total_seconds() / 3600
        except ValueError:
            continue
        for tag, lim in (("h1", 24), ("h3", 3)):
            if 0 < hours <= lim and tag not in t.get("reminded", []):
                await notify(t.get("assignee_ids", []) + [t.get("created_by_id")], f"Pengingat task ({'H-1' if tag == 'h1' else '3 jam lagi'})",
                             t["title"], "task", "/tasks")
                await db.tasks.update_one({"id": t["id"]}, {"$push": {"reminded": tag}})
        if t["status"] == "scheduled" and hours <= 24:
            await db.tasks.update_one({"id": t["id"]}, {"$set": {"status": "pending"}})
    s = await get_settings()
    d = today()
    if n.hour >= s["daily_report_reminder_hour"] and not await db.sweep_flags.find_one({"key": f"report:{d}"}):
        await db.sweep_flags.insert_one({"key": f"report:{d}", "at": now_iso()})
        missing = [r["pic_id"] for r in await report_status(d) if not r["submitted"]]
        await notify(missing, "Laporan harian belum diisi", "Segera isi laporan harian hari ini.", "report", "/laporan-harian")
