import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errMsg, rupiah, fmtDate, fmtDateTime, openBlob, todayWIB, mondayOf, addDays } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PageHeader, StatusBadge, Empty, Field, NativeSelect } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileDown, FileSpreadsheet, Lock, Unlock, CheckCheck, Play, Pencil } from "lucide-react";

function MySlips() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  useEffect(() => { api.get("/payroll/my").then((r) => setItems(r.data)); }, []);
  return (
    <div className="grid md:grid-cols-2 gap-3" data-testid="my-slips">
      {items.length === 0 && <Empty text="Belum ada slip yang disetujui" />}
      {items.map((s) => (
        <div key={s.run_id} className="border rounded-xl p-4 bg-card flex justify-between items-center">
          <div>
            <StatusBadge tone={s.period_type === "monthly" ? "primary" : "info"}>{s.period_type === "monthly" ? "Gaji Bulanan" : "Uang Mingguan"}</StatusBadge>
            <div className="text-sm text-muted-foreground mt-1">{fmtDate(s.period_start)} – {fmtDate(s.period_end)}</div>
            <div className="text-xl font-bold mt-1">{rupiah(s.item.net)}</div>
          </div>
          <Button variant="outline" onClick={() => openBlob(`/payroll/runs/${s.run_id}/slip/${user.id}`)} data-testid={`slip-btn-${s.run_id}`}><FileDown className="h-4 w-4 mr-2" />Slip PDF</Button>
        </div>
      ))}
    </div>
  );
}

const COLS = {
  monthly: [["base_salary", "Gaji Pokok"], ["allowance", "Tunjangan"], ["absence_deduction", "Potongan"], ["adjustment", "Revisi"]],
  weekly: [["ot_pay", "Lembur"], ["meal_pay", "Uang Makan"], ["ph_pay", "Uang PH"], ["adjustment", "Revisi"]],
};

function RunDetail({ id, onChange }) {
  const { user } = useAuth();
  const [run, setRun] = useState(null);
  const [edit, setEdit] = useState(null);
  const load = () => api.get(`/payroll/runs/${id}`).then((r) => setRun(r.data));
  useEffect(() => { load(); }, [id]);
  if (!run) return null;
  const tr = async (a) => {
    try { await api.post(`/payroll/runs/${id}/${a}`); toast.success("Status diperbarui"); load(); onChange(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const saveAdj = async () => {
    try { await api.put(`/payroll/runs/${id}/items/${edit.user_id}`, { adjustment: Number(edit.adjustment), note: edit.note }); setEdit(null); load(); onChange(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const isAcc = user.role === "accounting";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <StatusBadge status={run.status} testid="run-status" />
        <span className="text-sm text-muted-foreground">Total {rupiah(run.total)}</span>
        <div className="flex-1" />
        {run.status === "draft" && isAcc && <Button size="sm" onClick={() => tr("lock")} data-testid="run-lock-btn"><Lock className="h-4 w-4 mr-1" />Setujui & Kunci (Accounting)</Button>}
        {run.status === "locked" && <Button size="sm" variant="outline" onClick={() => tr("unlock")} data-testid="run-unlock-btn"><Unlock className="h-4 w-4 mr-1" />Buka kunci</Button>}
        {run.status === "locked" && user.role === "management" && <Button size="sm" onClick={() => tr("approve")} data-testid="run-approve-btn"><CheckCheck className="h-4 w-4 mr-1" />Setujui (Management)</Button>}
        <Button size="sm" variant="outline" onClick={() => openBlob(`/payroll/runs/${id}/export`, `payroll-${run.period_start}.xlsx`)} data-testid="run-export-btn"><FileSpreadsheet className="h-4 w-4 mr-1" />Excel</Button>
      </div>
      <div className="border rounded-xl overflow-x-auto">
        <table className="w-full text-sm" data-testid="payroll-table">
          <thead className="bg-muted text-xs uppercase text-muted-foreground"><tr className="text-left"><th className="p-2">Nama</th>{COLS[run.period_type].map(([, l]) => <th key={l} className="p-2">{l}</th>)}<th className="p-2">Pajak</th><th className="p-2">Diterima</th><th /></tr></thead>
          <tbody>
            {run.items.map((i) => (
              <tr key={i.user_id} className="border-t">
                <td className="p-2 font-medium">{i.name}<div className="text-xs text-muted-foreground">{run.period_type === "monthly" ? `Izin ${i.unpaid_days} · Alpha ${i.alpha_days}` : `${i.ot_blocks} blok · ${i.meal_days} hari makan · ${i.ph_days} PH`}</div></td>
                {COLS[run.period_type].map(([k]) => <td key={k} className="p-2">{rupiah(i[k])}</td>)}
                <td className="p-2">{rupiah(i.taxes.reduce((a, t) => a + t.amount, 0))}</td>
                <td className="p-2 font-semibold">{rupiah(i.net)}</td>
                <td className="p-2 whitespace-nowrap">
                  {run.status === "draft" && isAcc && <Button size="icon" variant="ghost" onClick={() => setEdit({ user_id: i.user_id, name: i.name, adjustment: i.adjustment, note: i.adjust_note })} data-testid={`adj-${i.user_id}`}><Pencil className="h-4 w-4" /></Button>}
                  <Button size="icon" variant="ghost" onClick={() => openBlob(`/payroll/runs/${id}/slip/${i.user_id}`)}><FileDown className="h-4 w-4" /></Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">Histori perubahan</summary>
        {run.history.map((h, i) => <div key={i} className="text-xs py-1">{fmtDateTime(h.at)} · {h.by} · {h.action}</div>)}
      </details>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent><DialogHeader><DialogTitle>Revisi: {edit?.name}</DialogTitle></DialogHeader>
          {edit && <div className="space-y-3">
            <Field label="Penyesuaian (Rp, bisa negatif)"><Input type="number" value={edit.adjustment} onChange={(e) => setEdit({ ...edit, adjustment: e.target.value })} data-testid="adj-amount" /></Field>
            <Field label="Catatan"><Input value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} data-testid="adj-note" /></Field>
            <Button className="w-full" onClick={saveAdj} data-testid="adj-save">Simpan revisi</Button>
          </div>}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Admin() {
  const { user } = useAuth();
  const [runs, setRuns] = useState([]);
  const [sel, setSel] = useState(null);
  const t = todayWIB();
  const [g, setG] = useState({ period_type: "weekly", period_start: mondayOf(t), period_end: addDays(mondayOf(t), 6) });
  const load = () => api.get("/payroll/runs").then((r) => setRuns(r.data));
  useEffect(() => { load(); }, []);
  const setType = (v) => {
    if (v === "monthly") setG({ period_type: v, period_start: t.slice(0, 8) + "01", period_end: addDays(new Date(new Date(t).getFullYear(), new Date(t).getMonth() + 1, 1).toLocaleDateString("en-CA"), -1) });
    else setG({ period_type: v, period_start: mondayOf(t), period_end: addDays(mondayOf(t), 6) });
  };
  const gen = async () => {
    try { const r = await api.post("/payroll/generate", g); toast.success("Payroll dihitung dari absensi & request"); load(); setSel(r.data.id); }
    catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <div className="space-y-6">
      <div className="border rounded-xl p-4 bg-card grid sm:grid-cols-4 gap-3 items-end">
        <Field label="Periode"><NativeSelect testid="gen-type" value={g.period_type} onChange={setType} options={[{ value: "weekly", label: "Mingguan (lembur, makan, PH)" }, { value: "monthly", label: "Bulanan (gaji pokok, tunjangan)" }]} /></Field>
        <Field label="Mulai"><Input type="date" value={g.period_start} onChange={(e) => setG({ ...g, period_start: e.target.value })} data-testid="gen-start" /></Field>
        <Field label="Selesai"><Input type="date" value={g.period_end} onChange={(e) => setG({ ...g, period_end: e.target.value })} data-testid="gen-end" /></Field>
        <Button onClick={gen} disabled={user.role !== "accounting" && user.role !== "management"} data-testid="gen-btn"><Play className="h-4 w-4 mr-2" />Hitung / Preview</Button>
      </div>
      <div className="grid lg:grid-cols-4 gap-4">
        <div className="space-y-2">
          {runs.length === 0 && <Empty text="Belum ada periode" />}
          {runs.map((r) => (
            <button key={r.id} onClick={() => setSel(r.id)} className={`w-full text-left border rounded-xl p-3 bg-card ${sel === r.id ? "border-primary" : ""}`} data-testid={`run-${r.id}`}>
              <div className="text-sm font-semibold">{r.period_type === "monthly" ? "Bulanan" : "Mingguan"}</div>
              <div className="text-xs text-muted-foreground">{fmtDate(r.period_start)} – {fmtDate(r.period_end)}</div>
              <div className="flex justify-between mt-1"><StatusBadge status={r.status} /><span className="text-sm">{rupiah(r.total)}</span></div>
            </button>
          ))}
        </div>
        <div className="lg:col-span-3">{sel ? <RunDetail id={sel} onChange={load} /> : <Empty text="Pilih periode di kiri" />}</div>
      </div>
    </div>
  );
}

export default function Payroll() {
  const { user } = useAuth();
  const admin = ["accounting", "management"].includes(user.role);
  return (
    <div>
      <PageHeader title="Penggajian" subtitle="Gaji pokok & tunjangan bulanan · Lembur, uang makan & PH mingguan" />
      <Tabs defaultValue={admin ? "admin" : "mine"}>
        <TabsList>{admin && <TabsTrigger value="admin" data-testid="tab-payroll-admin">Proses payroll</TabsTrigger>}<TabsTrigger value="mine" data-testid="tab-my-slips">Slip saya</TabsTrigger></TabsList>
        {admin && <TabsContent value="admin"><Admin /></TabsContent>}
        <TabsContent value="mine"><MySlips /></TabsContent>
      </Tabs>
    </div>
  );
}
