import os
from datetime import timedelta

from core import db, now, now_iso, today, uid, enc, hash_pw, logger, WIB

SHIFTS = [("Shift 1", "06:00", "14:00"), ("Shift 2", "08:00", "16:00"), ("Shift 3", "10:00", "18:00"),
          ("Shift 4", "14:00", "22:00"), ("Shift 5", "17:00", "01:00")]


async def default_shifts(branch_id):
    for i, (n, s, e) in enumerate(SHIFTS):
        await db.shifts.insert_one({"id": uid(), "branch_id": branch_id, "name": n, "start": s, "end": e, "order": i + 1})


def comp(base, allow=500000, meal=25000, ot=15000, ph=100000):
    return enc({"base_salary": base, "allowance": allow, "meal_rate": meal, "ot_rate": ot, "ph_rate": ph})


async def run():
    if await db.settings.find_one({"id": "seeded"}):
        return
    logger.info("Seeding demo data")
    pw = hash_pw(os.environ["DEMO_PASSWORD"])
    b1 = {"id": uid(), "name": "El Pico", "address": "[Contoh] Jl. Contoh No. 1, Malang", "lat": -7.966620, "lng": 112.632632, "radius_m": 10, "active": True}
    b2 = {"id": uid(), "name": "Pahlawan Trip", "address": "[Contoh] Jl. Pahlawan Trip, Malang", "lat": -7.968780, "lng": 112.615470, "radius_m": 10, "active": True}
    for b in (b1, b2):
        await db.branches.insert_one({**b, "created_at": now_iso()})
        await default_shifts(b["id"])
    from core import sha
    await db.master_devices.insert_many([
        {"id": uid(), "branch_id": b1["id"], "name": "HP Master Kantor El Pico", "active": True, "token_hash": sha("DEMO-KIOSK-ELPICO"), "activated_at": now_iso()},
        {"id": uid(), "branch_id": b2["id"], "name": "HP Master Kantor Pahlawan Trip", "active": True, "token_hash": sha("DEMO-KIOSK-PAHLAWAN"), "activated_at": now_iso()},
    ])
    both = [b1["id"], b2["id"]]

    def user(name, email, role, seg, pos, branches, base, pwh=pw, device=None):
        return {"id": uid(), "name": name, "email": email, "role": role, "segment": seg, "position": pos, "level": "", "phone": "",
                "nik": "", "branch_ids": branches, "attendance_branch_ids": branches, "active": True, "leave_quota": 12,
                "join_date": "2025-01-01", "password_hash": pwh, "comp_enc": comp(base), "device_id": device,
                "face_enrolled": False, "created_at": now_iso()}
    users = [
        user("Pemilik (Management)", os.environ["ADMIN_EMAIL"].lower(), "management", "backoffice", "Owner", both, 0, hash_pw(os.environ["ADMIN_PASSWORD"])),
        user("Sari HRD", "hrd@demo.id", "hrd", "backoffice", "HRD", both, 6000000),
        user("Budi Accounting", "accounting@demo.id", "accounting", "backoffice", "Accounting", both, 6000000),
        user("Rina Purchasing", "purchasing@demo.id", "purchasing", "backoffice", "Purchasing", both, 5500000),
        user("Andi SPV", "spv@demo.id", "spv", "backoffice", "Outlet Manager", both, 7000000),
        user("Dewi PIC Depan", "pic.depan@demo.id", "pic_depan", "depan", "PIC Depan", [b1["id"]], 5000000),
        user("Joko PIC Dapur", "pic.dapur@demo.id", "pic_dapur", "dapur", "PIC Dapur", [b1["id"]], 5000000),
        user("Maya PIC Bar", "pic.bar@demo.id", "pic_bar", "bar", "PIC Bar", [b1["id"]], 5000000),
        user("Staff Satu", "staff1@demo.id", "staff", "depan", "Waiter", [b1["id"]], 3500000, device="DEMO-DEVICE-STAFF1"),
        user("Staff Dua", "staff2@demo.id", "staff", "depan", "Kasir", [b1["id"]], 3500000),
        user("Staff Tiga", "staff3@demo.id", "staff", "dapur", "Cook", [b1["id"]], 3800000),
        user("Staff Empat", "staff4@demo.id", "staff", "bar", "Barista", [b1["id"]], 3600000),
        user("Staff Lima", "staff5@demo.id", "staff", "depan", "Waiter", [b2["id"]], 3500000),
        user("Staff Enam", "staff6@demo.id", "staff", "dapur", "Cook", [b2["id"]], 3800000),
    ]
    await db.users.insert_many(users)
    await db.devices.insert_one({"id": uid(), "user_id": users[8]["id"], "device_id": "DEMO-DEVICE-STAFF1", "info": "Demo Android", "bound_at": now_iso(), "active": True})
    shifts = {b: [s async for s in db.shifts.find({"branch_id": b}).sort("order", 1)] for b in both}
    n = now()
    monday = (n - timedelta(days=n.weekday())).date()
    staff = [u for u in users if u["role"] in ("staff", "pic_depan", "pic_dapur", "pic_bar")]
    for i, u in enumerate(staff):
        b = u["branch_ids"][0]
        for d in range(7):
            day = (monday + timedelta(days=d)).isoformat()
            off = (d + i) % 7 == 6
            sh = None if off else shifts[b][(i + d) % 4]["id"]
            await db.schedules.insert_one({"id": uid(), "user_id": u["id"], "branch_id": b, "date": day, "shift_id": sh, "updated_by": "Seed", "updated_at": now_iso()})
    for i, u in enumerate(staff):
        b = u["branch_ids"][0]
        br = b1 if b == b1["id"] else b2
        for d in range(n.weekday()):
            day = monday + timedelta(days=d)
            s = await db.schedules.find_one({"user_id": u["id"], "date": day.isoformat()})
            if not s or not s["shift_id"] or (i + d) % 5 == 4:
                continue
            sh = next(x for x in shifts[b] if x["id"] == s["shift_id"])
            h, m = map(int, sh["start"].split(":"))
            from datetime import datetime
            st = datetime(day.year, day.month, day.day, h, m, tzinfo=WIB)
            cin = st + timedelta(minutes=(-35 if i % 3 == 0 else (12 if i % 4 == 1 else -5)))
            cout = st + timedelta(hours=8, minutes=(65 if i % 2 == 0 else 3))
            late = max(0, int((cin - st).total_seconds() / 60))
            early = max(0, int((st - cin).total_seconds() / 60))
            after = max(0, int((cout - st - timedelta(hours=8)).total_seconds() / 60))
            mk = lambda t: {"time": t.isoformat(), "lat": br["lat"], "lng": br["lng"], "accuracy": 8, "distance_m": 3.2, "photo_path": None,
                            "device_id": u.get("device_id") or "seed", "face_score": 0.62, "via_master": False, "reason": "", "flags": []}
            await db.attendance.insert_one({"id": uid(), "user_id": u["id"], "branch_id": b, "date": day.isoformat(), "shift_id": sh["id"],
                                            "shift_name": sh["name"], "clock_in": mk(cin), "clock_out": mk(cout), "status": "telat" if late else "hadir",
                                            "late_minutes": late, "early_minutes": early, "early_ot_blocks": early // 30, "after_minutes": after,
                                            "after_ot_blocks": after // 30, "early_leave_minutes": 0, "via_master": d == 1 and i == 1, "created_at": now_iso()})
    s1, s2 = users[8], users[9]
    t = today()
    await db.requests.insert_many([
        {"id": uid(), "user_id": s1["id"], "user_name": s1["name"], "segment": "depan", "branch_ids": s1["branch_ids"], "type": "cuti",
         "subtype": "cuti_tahunan", "date_start": (n + timedelta(days=3)).date().isoformat(), "date_end": (n + timedelta(days=3)).date().isoformat(),
         "hours": 0, "reason": "Acara keluarga", "attachment_path": None, "status": "menunggu", "steps": ["pic", "spv_hrd"], "current_step": 0,
         "history": [], "created_at": now_iso()},
        {"id": uid(), "user_id": s2["id"], "user_name": s2["name"], "segment": "depan", "branch_ids": s2["branch_ids"], "type": "lembur",
         "subtype": "", "date_start": t, "date_end": t, "hours": 2, "reason": "Event ulang tahun tamu", "attachment_path": None,
         "status": "menunggu", "steps": ["pic", "spv_hrd"], "current_step": 1,
         "history": [{"step": "pic", "by": "Dewi PIC Depan", "role": "pic_depan", "approve": True, "note": "OK", "at": now_iso()}], "created_at": now_iso()},
    ])
    await db.kpi_categories.insert_many([
        {"id": uid(), "name": "Kedisiplinan", "weight": 30, "target": "staff", "active": True},
        {"id": uid(), "name": "Kualitas Kerja", "weight": 40, "target": "staff", "active": True},
        {"id": uid(), "name": "Kerja Sama Tim", "weight": 30, "target": "staff", "active": True},
        {"id": uid(), "name": "Kepemimpinan", "weight": 40, "target": "pic", "active": True},
        {"id": uid(), "name": "Pencapaian Target Outlet", "weight": 35, "target": "pic", "active": True},
        {"id": uid(), "name": "Pelaporan Harian", "weight": 25, "target": "pic", "active": True},
    ])
    pic_depan, pic_dapur = users[5], users[6]
    dl = lambda h: (n + timedelta(hours=h)).replace(microsecond=0).isoformat()
    tasks = [("Deep cleaning area bar", [users[11]["id"]], "bar", 20, "pending", users[7]),
             ("Training SOP penyajian menu baru", [s1["id"], s2["id"]], "depan", 30, "on_progress", pic_depan),
             ("Cek stok bahan kering mingguan", [users[10]["id"]], "dapur", -5, "done", pic_dapur),
             ("Briefing pagi tim depan", [s1["id"]], "depan", 48, "scheduled", pic_depan)]
    for title, ass, seg, h, st, by in tasks:
        await db.tasks.insert_one({"id": uid(), "title": title, "description": "", "assignee_ids": ass, "branch_id": b1["id"], "segment": seg,
                                   "project_id": "", "deadline": dl(h), "priority": "sedang", "status": st, "recurrence": "weekly" if "Briefing" in title else "none",
                                   "attachments": [], "created_by_id": by["id"], "created_by": by["name"], "created_role": by["role"],
                                   "verification": "menunggu" if st == "done" else "belum", "comments": [], "reminded": [], "created_at": now_iso()})
    await db.announcements.insert_one({"id": uid(), "title": "Selamat datang di HRIS Resto", "body": "Mulai minggu ini absensi wajib lewat aplikasi dengan verifikasi wajah dalam radius cabang.",
                                       "branch_ids": [], "segments": [], "pinned": True, "author": "Pemilik (Management)", "created_at": now_iso(), "read_by": []})
    await db.daily_reports.insert_one({"id": uid(), "branch_id": b1["id"], "income": 8750000, "work_done": "Briefing, training waiter baru, cek kebersihan",
                                       "appreciation": "Staff Satu mendapat pujian tamu", "busy_reason": "Ramai karena akhir pekan", "notes": "",
                                       "pic_id": pic_depan["id"], "pic_name": pic_depan["name"], "segment": "depan", "date": t, "submitted_at": now_iso()})
    job = {"id": uid(), "title": "Barista", "branch_id": b1["id"], "segment": "bar", "description": "Menyiapkan minuman kopi & non-kopi.",
           "requirements": "Pengalaman min. 1 tahun, ramah, siap shift.", "active": True, "created_at": now_iso()}
    await db.jobs.insert_many([job, {"id": uid(), "title": "Cook", "branch_id": b2["id"], "segment": "dapur", "description": "Memasak menu utama.",
                                     "requirements": "Menguasai masakan Indonesia.", "active": True, "created_at": now_iso()}])
    await db.applicants.insert_one({"id": uid(), "job_id": job["id"], "branch_id": b1["id"], "position": "Barista", "name": "Calon Contoh",
                                    "email": "calon@contoh.id", "phone": "08123456789", "cover": "Saya tertarik.", "cv_path": None, "cv_name": None,
                                    "stage": "masuk", "created_at": now_iso(), "interviews": [], "score": None, "notes": "", "offer": None})
    await db.settings.insert_one({"id": "seeded", "at": now_iso()})
