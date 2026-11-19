import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errMsg, fmtDate, fmtDateTime, todayWIB, ROLE_LABEL } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PageHeader, StatusBadge, Empty, Field, NativeSelect, Stat } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Check, X, Paperclip } from "lucide-react";
import { openBlob } from "@/lib/api";

const TYPE = { ph: "PH (Kerja Hari Libur)", cuti: "Cuti / Izin / Sakit", lembur: "Lembur" };
const SUB = [{ value: "cuti_tahunan", label: "Cuti tahunan" }, { value: "izin", label: "Izin (tidak dibayar)" }, { value: "izin_setengah_hari", label: "Izin setengah hari" }, { value: "sakit", label: "Sakit (wajib lampiran)" }];
const STEP = { pic: "PIC", spv_hrd: "SPV/HRD", management: "Management" };

function NewRequest({ onDone }) {
  const t = todayWIB();
  const [f, setF] = useState({ type: "cuti", subtype: "cuti_tahunan", date_start: t, date_end: t, hours: 0, reason: "", attachment_path: null });
  const [busy, setBusy] = useState(false);
  const upload = async (file) => {
    const fd = new FormData();
    fd.append("file", file);
    try { const r = await api.post("/upload", fd); setF((x) => ({ ...x, attachment_path: r.data.path })); toast.success("Lampiran terunggah"); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { await api.post("/requests", { ...f, hours: Number(f.hours) }); toast.success("Request terkirim"); onDone(); }
    catch (err) { toast.error(errMsg(err)); }
    setBusy(false);
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Jenis"><NativeSelect testid="req-type" value={f.type} onChange={(v) => setF({ ...f, type: v })} options={Object.entries(TYPE).map(([value, label]) => ({ value, label }))} /></Field>
      {f.type === "cuti" && <Field label="Kategori"><NativeSelect testid="req-subtype" value={f.subtype} onChange={(v) => setF({ ...f, subtype: v })} options={SUB} /></Field>}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Mulai"><Input type="date" value={f.date_start} onChange={(e) => setF({ ...f, date_start: e.target.value })} data-testid="req-start" /></Field>
        <Field label="Selesai"><Input type="date" value={f.date_end} onChange={(e) => setF({ ...f, date_end: e.target.value })} data-testid="req-end" /></Field>
      </div>
      {f.type === "lembur" && <Field label="Perkiraan jam lembur"><Input type="number" step="0.5" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} data-testid="req-hours" /></Field>}
      <Field label="Alasan"><Textarea required value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} data-testid="req-reason" /></Field>
      <Field label="Lampiran (opsional, wajib untuk sakit)"><Input type="file" onChange={(e) => e.target.files[0] && upload(e.target.files[0])} data-testid="req-attachment" /></Field>
      <Button type="submit" className="w-full" disabled={busy} data-testid="req-submit">Kirim request</Button>
    </form>
  );
}

function Card({ r, onAct, onCancel }) {
  const [note, setNote] = useState("");
  return (
    <div className="border rounded-xl p-4 bg-card space-y-2" data-testid={`request-${r.id}`}>
      <div className="flex justify-between gap-2 flex-wrap">
        <div>
          <div className="font-semibold">{TYPE[r.type]}{r.subtype ? ` · ${SUB.find((s) => s.value === r.subtype)?.label || r.subtype}` : ""}</div>
          <div className="text-sm text-muted-foreground">{r.user_name} · {fmtDate(r.date_start)}{r.date_end !== r.date_start ? ` – ${fmtDate(r.date_end)}` : ""}{r.hours ? ` · ${r.hours} jam` : ""}</div>
        </div>
        <StatusBadge status={r.status} />
      </div>
      <div className="text-sm">{r.reason}</div>
      {r.attachment_path && <button className="text-xs text-primary flex items-center gap-1" onClick={() => openBlob(`/files/${r.attachment_path}`)}><Paperclip className="h-3 w-3" />Lihat lampiran</button>}
      <div className="flex flex-wrap gap-1 text-xs">
        {r.steps.map((s, i) => {
          const h = r.history[i];
          const tone = h ? (h.approve ? "success" : "danger") : i === r.current_step && r.status === "menunggu" ? "warning" : "muted";
          return <StatusBadge key={i} tone={tone}>{i + 1}. {STEP[s]}{h ? ` · ${h.by}` : ""}</StatusBadge>;
        })}
      </div>
      {r.can_act && (
        <div className="flex gap-2 pt-1">
          <Input placeholder="Catatan (opsional)" value={note} onChange={(e) => setNote(e.target.value)} className="h-9" data-testid={`req-note-${r.id}`} />
          <Button size="sm" onClick={() => onAct(r, true, note)} data-testid={`req-approve-${r.id}`}><Check className="h-4 w-4" /></Button>
          <Button size="sm" variant="destructive" onClick={() => onAct(r, false, note)} data-testid={`req-reject-${r.id}`}><X className="h-4 w-4" /></Button>
        </div>
      )}
      {onCancel && r.status === "menunggu" && <Button size="sm" variant="ghost" onClick={() => onCancel(r)} data-testid={`req-cancel-${r.id}`}>Batalkan</Button>}
      <div className="text-[11px] text-muted-foreground">Diajukan {fmtDateTime(r.created_at)}</div>
    </div>
  );
}

export default function Requests() {
  const { user } = useAuth();
  const approver = user.role !== "staff";
  const [mine, setMine] = useState([]);
  const [appr, setAppr] = useState([]);
  const [all, setAll] = useState([]);
  const [quota, setQuota] = useState(null);
  const [open, setOpen] = useState(false);
  const load = () => {
    api.get("/requests", { params: { scope: "mine" } }).then((r) => setMine(r.data));
    api.get("/leave-quota/me").then((r) => setQuota(r.data));
    if (approver) {
      api.get("/requests", { params: { scope: "approvals" } }).then((r) => setAppr(r.data));
      api.get("/requests", { params: { scope: "all" } }).then((r) => setAll(r.data));
    }
  };
  useEffect(load, []);
  const act = async (r, approve, note) => {
    try { await api.post(`/requests/${r.id}/decide`, { approve, note }); toast.success(approve ? "Disetujui" : "Ditolak"); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const cancel = async (r) => { await api.post(`/requests/${r.id}/cancel`); load(); };

  return (
    <div>
      <PageHeader title="Request PH / Cuti / Lembur" subtitle={`Alur approval berjenjang · ${ROLE_LABEL[user.role]}`}>
        <Button onClick={() => setOpen(true)} data-testid="new-request-btn"><Plus className="h-4 w-4 mr-2" />Ajukan</Button>
      </PageHeader>
      {quota && <div className="grid grid-cols-3 gap-3 mb-6"><Stat label="Kuota cuti" value={quota.quota} /><Stat label="Terpakai" value={quota.used} /><Stat label="Sisa" value={quota.remaining} testid="leave-remaining" /></div>}
      <Tabs defaultValue={approver ? "approvals" : "mine"}>
        <TabsList>
          {approver && <TabsTrigger value="approvals" data-testid="tab-approvals">Perlu persetujuan ({appr.length})</TabsTrigger>}
          <TabsTrigger value="mine" data-testid="tab-mine">Request saya</TabsTrigger>
          {approver && <TabsTrigger value="all" data-testid="tab-all">Semua</TabsTrigger>}
        </TabsList>
        <TabsContent value="approvals"><div className="grid md:grid-cols-2 gap-3">{appr.length === 0 && <Empty text="Tidak ada request menunggu Anda" />}{appr.map((r) => <Card key={r.id} r={r} onAct={act} />)}</div></TabsContent>
        <TabsContent value="mine"><div className="grid md:grid-cols-2 gap-3">{mine.length === 0 && <Empty />}{mine.map((r) => <Card key={r.id} r={r} onCancel={cancel} />)}</div></TabsContent>
        <TabsContent value="all"><div className="grid md:grid-cols-2 gap-3">{all.map((r) => <Card key={r.id} r={r} onAct={act} />)}</div></TabsContent>
      </Tabs>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent><DialogHeader><DialogTitle>Ajukan request</DialogTitle></DialogHeader>{open && <NewRequest onDone={() => { setOpen(false); load(); }} />}</DialogContent>
      </Dialog>
    </div>
  );
}
