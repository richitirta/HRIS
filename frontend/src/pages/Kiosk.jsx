import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errMsg, fmtDate } from "@/lib/api";
import { haversine, securityFlags, watchGps } from "@/lib/geo";
import FaceCapture from "@/components/FaceCapture";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, StatusBadge } from "@/components/common";
import { MonitorSmartphone, ArrowLeft, Search } from "lucide-react";

const MODES = { clock: "Absen", enroll: "Daftar Wajah", reset: "Reset Device" };

export default function Kiosk() {
  const [dev, setDev] = useState(null);
  const [token, setToken] = useState("");
  const [emps, setEmps] = useState([]);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(null);
  const [mode, setMode] = useState("clock");
  const [reason, setReason] = useState("");
  const [consent, setConsent] = useState(false);
  const [scan, setScan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pos, setPos] = useState(null);

  const load = async () => {
    try {
      const r = await api.get("/kiosk/me");
      setDev(r.data);
      setEmps((await api.get("/kiosk/employees")).data);
    } catch { setDev(false); }
  };
  useEffect(() => { if (localStorage.getItem("hris_kiosk_token")) load(); else setDev(false); }, []);
  useEffect(() => watchGps(setPos, () => {}), []);

  const activate = () => { localStorage.setItem("hris_kiosk_token", token.trim()); load(); };
  const reset = () => { setSel(null); setScan(false); setReason(""); setConsent(false); };

  if (dev === null) return <div className="p-8">Memuat…</div>;
  if (!dev) return (
    <div className="min-h-screen grid place-items-center p-6">
      <div className="max-w-sm w-full space-y-4 border rounded-2xl p-6 bg-card">
        <MonitorSmartphone className="h-10 w-10 text-primary" />
        <h1 className="text-xl font-bold">Aktivasi HP Master</h1>
        <p className="text-sm text-muted-foreground">Masukkan kode aktivasi dari HRD (menu Cabang &amp; HP Master → Aktivasi).</p>
        <Input value={token} onChange={(e) => setToken(e.target.value)} placeholder="Kode aktivasi" data-testid="kiosk-token-input" />
        <Button className="w-full" onClick={activate} data-testid="kiosk-activate-btn">Aktifkan</Button>
      </div>
    </div>
  );

  const b = dev.branch;
  const dist = pos ? haversine(pos.coords.latitude, pos.coords.longitude, b.lat, b.lng) : null;
  const inside = dist !== null && dist <= b.radius_m;
  const list = emps.filter((e) => e.name.toLowerCase().includes(q.toLowerCase()));

  const submit = async (r) => {
    setBusy(true);
    try {
      if (mode === "enroll") await api.post("/kiosk/enroll", { ...r, user_id: sel.id, consent: true });
      else if (mode === "reset") await api.post("/kiosk/device-reset", { ...r, user_id: sel.id, reason });
      else await api.post("/kiosk/clock", {
        ...r, user_id: sel.id, reason, branch_id: b.id, action: sel.state === "masuk" ? "out" : "in",
        lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, flags: securityFlags(pos),
      });
      toast.success("Berhasil dicatat");
      reset();
      load();
    } catch (e) { toast.error(errMsg(e)); setScan(false); }
    setBusy(false);
  };

  const ready = mode === "enroll" ? consent : mode === "reset" ? reason.trim() : reason.trim() && inside;

  return (
    <div className="min-h-screen max-w-2xl mx-auto p-4 sm:p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="text-xs uppercase tracking-wider text-primary font-bold">Mode HP Master</div>
          <h1 className="text-2xl font-bold" data-testid="kiosk-branch-name">{b.name}</h1>
          <div className="text-xs text-muted-foreground">{dev.name} · {fmtDate(new Date().toISOString())}</div>
        </div>
        <StatusBadge tone={inside ? "success" : "danger"} testid="kiosk-geofence">{dist === null ? "GPS…" : `${Math.round(dist)} m`}</StatusBadge>
      </div>
      {!sel ? (
        <>
          <div className="flex gap-2 mb-4">
            {Object.entries(MODES).map(([k, v]) => <Button key={k} variant={mode === k ? "default" : "outline"} size="sm" onClick={() => setMode(k)} data-testid={`kiosk-mode-${k}`}>{v}</Button>)}
          </div>
          <div className="relative mb-3"><Search className="h-4 w-4 absolute left-3 top-2.5 text-muted-foreground" /><Input className="pl-9" placeholder="Cari nama staff" value={q} onChange={(e) => setQ(e.target.value)} data-testid="kiosk-search" /></div>
          <div className="grid sm:grid-cols-2 gap-2">
            {list.filter((e) => (mode === "enroll" ? !e.face_enrolled : e.face_enrolled)).map((e) => (
              <button key={e.id} onClick={() => setSel(e)} className="text-left border rounded-xl p-3 bg-card hover:border-primary" data-testid={`kiosk-emp-${e.id}`}>
                <div className="font-semibold">{e.name}</div>
                <div className="text-xs text-muted-foreground">{e.position} · {e.state === "belum" ? "Belum absen" : e.state === "masuk" ? "Sudah masuk" : "Sudah pulang"}</div>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="space-y-4 border rounded-2xl p-5 bg-card">
          <Button variant="ghost" size="sm" onClick={reset} data-testid="kiosk-back"><ArrowLeft className="h-4 w-4 mr-1" />Kembali</Button>
          <div className="text-lg font-bold">{sel.name} — {mode === "clock" ? (sel.state === "masuk" ? "Absen Pulang" : "Absen Masuk") : MODES[mode]}</div>
          {mode !== "enroll" && <Field label={mode === "reset" ? "Alasan ganti HP" : "Alasan absen via HP Master (wajib)"}><Input value={reason} onChange={(e) => setReason(e.target.value)} data-testid="kiosk-reason" /></Field>}
          {mode === "enroll" && <label className="flex gap-3 text-sm"><Checkbox checked={consent} onCheckedChange={(v) => setConsent(!!v)} data-testid="kiosk-consent" />Karyawan menyetujui penyimpanan data wajah.</label>}
          {mode === "clock" && !inside && <div className="text-sm text-destructive">HP Master berada di luar radius cabang.</div>}
          {scan ? <FaceCapture onResult={submit} busy={busy} /> : <Button className="w-full h-12" disabled={!ready || sel.state === "pulang" && mode === "clock"} onClick={() => setScan(true)} data-testid="kiosk-scan-btn">Scan wajah {sel.name}</Button>}
        </div>
      )}
    </div>
  );
}
