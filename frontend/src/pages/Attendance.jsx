import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errMsg, fmtTime, todayWIB, fmtDate } from "@/lib/api";
import { haversine, securityFlags, watchGps } from "@/lib/geo";
import { useAuth } from "@/lib/auth";
import FaceCapture from "@/components/FaceCapture";
import { BranchMap } from "@/components/MapPicker";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { PageHeader, StatusBadge, Empty, NativeSelect } from "@/components/common";
import { MapPin, LogIn, LogOut, ShieldCheck, Clock } from "lucide-react";

function Enroll({ onDone }) {
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const send = async (r) => {
    setBusy(true);
    try {
      await api.post("/face/enroll", { ...r, consent: true });
      toast.success("Wajah berhasil didaftarkan");
      onDone();
    } catch (e) { toast.error(errMsg(e)); }
    setBusy(false);
  };
  return (
    <div className="max-w-md mx-auto border rounded-2xl p-6 bg-card space-y-4" data-testid="face-enroll-card">
      <h2 className="text-lg font-bold">Daftarkan wajah Anda</h2>
      <p className="text-sm text-muted-foreground">Wajah wajib terdaftar sebelum absen. Data wajah disimpan terenkripsi dan hanya dipakai untuk verifikasi absensi.</p>
      <label className="flex gap-3 items-start text-sm">
        <Checkbox checked={consent} onCheckedChange={(v) => setConsent(!!v)} data-testid="face-consent-checkbox" />
        <span>Saya menyetujui penyimpanan data wajah saya untuk keperluan absensi.</span>
      </label>
      {consent && <FaceCapture onResult={send} busy={busy} />}
    </div>
  );
}

export default function Attendance() {
  const { user, refresh } = useAuth();
  const [st, setSt] = useState(null);
  const [branchId, setBranchId] = useState("");
  const [pos, setPos] = useState(null);
  const [gpsErr, setGpsErr] = useState("");
  const [scan, setScan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [hist, setHist] = useState([]);

  const load = async () => {
    const r = await api.get("/attendance/status");
    setSt(r.data);
    setBranchId((b) => b || r.data.branches[0]?.id || "");
    const t = todayWIB();
    const h = await api.get("/attendance", { params: { start: new Date(Date.now() - 14 * 864e5).toLocaleDateString("en-CA"), end: t, user_id: user.id } });
    setHist(h.data.slice(0, 14));
  };
  useEffect(() => { load(); }, []);
  useEffect(() => watchGps((p) => { setPos(p); setGpsErr(""); }, setGpsErr), []);

  if (!st) return <div className="text-muted-foreground">Memuat…</div>;
  if (!st.face_enrolled) return (<><PageHeader title="Absensi" /><Enroll onDone={() => { refresh(); load(); }} /></>);

  const branch = st.branches.find((b) => b.id === branchId);
  const dist = branch && pos ? haversine(pos.coords.latitude, pos.coords.longitude, branch.lat, branch.lng) : null;
  const inside = dist !== null && dist <= branch.radius_m;
  const action = st.open_record ? "out" : "in";
  const doneToday = st.today_record?.clock_out;

  const submit = async (r) => {
    setBusy(true);
    try {
      await api.post("/attendance/clock", {
        action, branch_id: branchId, lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy,
        flags: securityFlags(pos), ...r,
      });
      toast.success(action === "in" ? "Absen masuk tercatat" : "Absen pulang tercatat");
      setScan(null);
      load();
    } catch (e) { toast.error(errMsg(e)); }
    setBusy(false);
  };

  return (
    <div>
      <PageHeader title="Absensi" subtitle={fmtDate(todayWIB())} />
      <div className="grid lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 space-y-4">
          {st.branches.length > 1 && <NativeSelect testid="att-branch-select" value={branchId} onChange={setBranchId} options={st.branches.map((b) => ({ value: b.id, label: b.name }))} />}
          {!branch && <Empty text="Anda belum terdaftar di cabang mana pun untuk absensi." />}
          {branch && (
            <div className="rounded-2xl border bg-card p-5 space-y-4 rise">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Cabang</div>
                  <div className="text-lg font-bold">{branch.name}</div>
                  <div className="text-xs text-muted-foreground">{branch.address}</div>
                </div>
                <div className={`px-3 py-1.5 rounded-full text-sm font-semibold ${inside ? "bg-[hsl(var(--success)/0.12)] text-[hsl(var(--success))]" : "bg-destructive/10 text-destructive"}`} data-testid="geofence-status">
                  {dist === null ? "Mencari GPS…" : inside ? `Dalam radius (${Math.round(dist)} m)` : `Jarak ${Math.round(dist)} m`}
                </div>
              </div>
              {pos && <BranchMap lat={branch.lat} lng={branch.lng} radius={branch.radius_m} height={220} extra={{ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy }} />}
              {gpsErr && <div className="text-sm text-destructive" data-testid="gps-error">{gpsErr}</div>}
              {pos && <div className="text-xs text-muted-foreground">Akurasi GPS ±{Math.round(pos.coords.accuracy)} m · Radius cabang {branch.radius_m} m</div>}
              {st.shift ? (
                <div className="flex items-center gap-2 text-sm"><Clock className="h-4 w-4 text-primary" />Jadwal hari ini: <b>{st.shift.name}</b> {st.shift.start}–{st.shift.end}</div>
              ) : <div className="text-sm text-muted-foreground">Tidak ada jadwal shift hari ini.</div>}
              {doneToday && !st.open_record ? (
                <div className="text-sm font-medium text-[hsl(var(--success))]" data-testid="att-done">Absensi hari ini sudah lengkap.</div>
              ) : scan ? (
                <FaceCapture onResult={submit} busy={busy} />
              ) : (
                <>
                  <Button className="w-full h-14 text-base" disabled={!inside} onClick={() => setScan(true)} data-testid="clock-action-btn">
                    {action === "in" ? <LogIn className="h-5 w-5 mr-2" /> : <LogOut className="h-5 w-5 mr-2" />}
                    {action === "in" ? "Absen Masuk" : "Absen Pulang"} + Scan Wajah
                  </Button>
                  {!inside && dist !== null && <p className="text-xs text-center text-destructive" data-testid="outside-radius-msg">Anda di luar radius {branch.radius_m} m dari {branch.name}. Mendekatlah ke titik cabang.</p>}
                </>
              )}
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5" />HP terdaftar · Verifikasi wajah + liveness wajib setiap absen</div>
            </div>
          )}
        </div>
        <div className="lg:col-span-2">
          <h3 className="font-semibold mb-3">Riwayat 14 hari</h3>
          <div className="space-y-2" data-testid="att-history">
            {hist.length === 0 && <Empty />}
            {hist.map((h) => (
              <div key={h.id} className="border rounded-xl p-3 bg-card flex items-center justify-between text-sm">
                <div>
                  <div className="font-medium">{fmtDate(h.date)}</div>
                  <div className="text-xs text-muted-foreground"><MapPin className="h-3 w-3 inline" /> {fmtTime(h.clock_in?.time)} – {h.clock_out ? fmtTime(h.clock_out.time) : "…"} {h.shift_name && `· ${h.shift_name}`}</div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <StatusBadge status={h.status}>{h.status === "telat" ? `Telat ${h.late_minutes}m` : "Hadir"}</StatusBadge>
                  {h.via_master && <StatusBadge tone="info">via HP Master</StatusBadge>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
