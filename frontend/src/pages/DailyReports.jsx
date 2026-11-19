import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errMsg, rupiah, todayWIB, fmtDate, fmtDateTime, SEGMENT_LABEL, isPic } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PageHeader, Field, Empty, NativeSelect, StatusBadge } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle } from "lucide-react";

function Form({ branches, existing, onDone }) {
  const [f, setF] = useState({ branch_id: branches[0]?.id || "", income: 0, work_done: "", appreciation: "", busy_reason: "", notes: "", ...(existing || {}) });
  const save = async () => {
    try { await api.post("/daily-reports", { ...f, income: Number(f.income) }); toast.success("Laporan harian terkirim"); onDone(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <div className="border rounded-2xl p-5 bg-card space-y-3" data-testid="daily-report-form">
      <div className="font-semibold">Laporan hari ini · {fmtDate(todayWIB())}</div>
      {branches.length > 1 && <Field label="Cabang"><NativeSelect value={f.branch_id} onChange={(v) => setF({ ...f, branch_id: v })} options={branches.map((b) => ({ value: b.id, label: b.name }))} /></Field>}
      <Field label="Total pemasukan (Rp)"><Input type="number" value={f.income} onChange={(e) => setF({ ...f, income: e.target.value })} data-testid="dr-income" /></Field>
      <Field label="Pekerjaan yang dilakukan"><Textarea value={f.work_done} onChange={(e) => setF({ ...f, work_done: e.target.value })} data-testid="dr-work" /></Field>
      <Field label="Apresiasi (jika ada)"><Input value={f.appreciation} onChange={(e) => setF({ ...f, appreciation: e.target.value })} data-testid="dr-appreciation" /></Field>
      <Field label="Penyebab outlet ramai/sepi"><Input value={f.busy_reason} onChange={(e) => setF({ ...f, busy_reason: e.target.value })} data-testid="dr-busy" /></Field>
      <Field label="Catatan"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      <Button className="w-full" disabled={!f.work_done} onClick={save} data-testid="dr-submit">{existing ? "Perbarui laporan" : "Kirim laporan"}</Button>
    </div>
  );
}

function ReportCard({ r }) {
  return (
    <div className="border rounded-xl p-4 bg-card text-sm space-y-1">
      <div className="flex justify-between"><b>{r.pic_name} · {SEGMENT_LABEL[r.segment]}</b><span className="text-muted-foreground">{fmtDate(r.date)}</span></div>
      <div className="text-lg font-bold text-primary">{rupiah(r.income)}</div>
      <div><span className="text-muted-foreground">Pekerjaan:</span> {r.work_done}</div>
      {r.appreciation && <div><span className="text-muted-foreground">Apresiasi:</span> {r.appreciation}</div>}
      {r.busy_reason && <div><span className="text-muted-foreground">Ramai/sepi:</span> {r.busy_reason}</div>}
      {r.notes && <div><span className="text-muted-foreground">Catatan:</span> {r.notes}</div>}
      <div className="text-xs text-muted-foreground">Dikirim {fmtDateTime(r.submitted_at)}</div>
    </div>
  );
}

export default function DailyReports() {
  const { user } = useAuth();
  const pic = isPic(user.role);
  const [date, setDate] = useState(todayWIB());
  const [reports, setReports] = useState([]);
  const [status, setStatus] = useState([]);
  const [branches, setBranches] = useState([]);
  const load = () => {
    api.get("/daily-reports", { params: pic ? {} : { date } }).then((r) => setReports(r.data));
    if (!pic) api.get("/daily-reports/status", { params: { date } }).then((r) => setStatus(r.data));
  };
  useEffect(() => { api.get("/branches").then((r) => setBranches(r.data.filter((b) => user.branch_ids.includes(b.id)))); }, []);
  useEffect(load, [date]);
  const todayMine = reports.find((r) => r.date === todayWIB());

  return (
    <div>
      <PageHeader title="Laporan Harian PIC" subtitle="Wajib diisi setiap hari oleh PIC Depan, Dapur, dan Bar">
        {!pic && <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" data-testid="dr-date" />}
      </PageHeader>
      {pic ? (
        <div className="grid lg:grid-cols-2 gap-6">
          {branches.length > 0 && <Form branches={branches} existing={todayMine} onDone={load} />}
          <div className="space-y-3"><h3 className="font-semibold">Riwayat</h3>{reports.length === 0 && <Empty />}{reports.map((r) => <ReportCard key={r.pic_id + r.date + r.branch_id} r={r} />)}</div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="dr-status-grid">
            {status.map((s) => (
              <div key={s.pic_id + s.branch_id} className={`border rounded-xl p-4 ${s.submitted ? "bg-card" : "bg-destructive/5 border-destructive/40"}`}>
                <div className="font-semibold">{s.pic_name}</div>
                <div className="text-xs text-muted-foreground">{SEGMENT_LABEL[s.segment]} · {s.branch_name}</div>
                <div className="mt-2">{s.submitted ? <StatusBadge tone="success">Sudah diisi</StatusBadge> : <span className="text-destructive text-sm font-semibold flex items-center gap-1"><AlertTriangle className="h-4 w-4" />Belum diisi</span>}</div>
              </div>
            ))}
          </div>
          <div className="grid md:grid-cols-2 gap-3">{reports.map((r) => <ReportCard key={r.pic_id + r.branch_id} r={r} />)}</div>
        </div>
      )}
    </div>
  );
}
