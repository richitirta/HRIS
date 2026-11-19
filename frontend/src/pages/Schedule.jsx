import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errMsg, todayWIB, mondayOf, addDays, fmtDate, SEGMENT_LABEL } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PageHeader, NativeSelect, Empty } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChevronLeft, ChevronRight, Settings2 } from "lucide-react";

const DAY = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
const COLORS = ["bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100", "bg-orange-100 text-orange-900 dark:bg-orange-900/40 dark:text-orange-100",
  "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100", "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100", "bg-violet-100 text-violet-900 dark:bg-violet-900/40 dark:text-violet-100"];

function MySchedule() {
  const [items, setItems] = useState([]);
  useEffect(() => { api.get("/schedules/me").then((r) => setItems(r.data)); }, []);
  return (
    <div className="space-y-2" data-testid="my-schedule">
      {items.length === 0 && <Empty text="Belum ada jadwal" />}
      {items.map((e) => (
        <div key={e.id} className={`border rounded-xl p-4 bg-card flex justify-between ${e.date === todayWIB() ? "border-primary" : ""}`}>
          <div><div className="font-semibold">{fmtDate(e.date)}</div><div className="text-xs text-muted-foreground">{e.branch_name}</div></div>
          <div className="text-right">{e.shift ? <><div className="font-semibold">{e.shift.name}</div><div className="text-sm text-muted-foreground">{e.shift.start}–{e.shift.end}</div></> : <span className="text-muted-foreground">Libur</span>}</div>
        </div>
      ))}
    </div>
  );
}

function ShiftSettings({ branchId, shifts, onSaved }) {
  const [rows, setRows] = useState(shifts);
  const save = async () => {
    try {
      await Promise.all(rows.map((s) => api.put(`/shifts/${s.id}`, { name: s.name, start: s.start, end: s.end })));
      toast.success("Shift disimpan");
      onSaved();
    } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <div className="space-y-2">
      {rows.map((s, i) => (
        <div key={s.id} className="grid grid-cols-3 gap-2">
          <Input value={s.name} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} data-testid={`shift-name-${i}`} />
          <Input type="time" value={s.start} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
          <Input type="time" value={s.end} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />
        </div>
      ))}
      <Button className="w-full" onClick={save} data-testid="save-shifts-btn">Simpan shift</Button>
    </div>
  );
}

export default function Schedule() {
  const { user } = useAuth();
  const editor = ["management", "hrd", "spv", "pic_depan", "pic_dapur", "pic_bar"].includes(user.role);
  const [branches, setBranches] = useState([]);
  const [branch, setBranch] = useState("");
  const [start, setStart] = useState(mondayOf(todayWIB()));
  const [shifts, setShifts] = useState([]);
  const [data, setData] = useState(null);
  const [cfg, setCfg] = useState(false);

  useEffect(() => {
    if (!editor) return;
    api.get("/branches").then((r) => {
      const mine = ["management", "hrd"].includes(user.role) ? r.data : r.data.filter((b) => user.branch_ids.includes(b.id));
      setBranches(mine);
      setBranch(mine[0]?.id || "");
    });
  }, []);
  const load = () => {
    if (!branch) return;
    api.get("/shifts", { params: { branch_id: branch } }).then((r) => setShifts(r.data));
    api.get("/schedules", { params: { branch_id: branch, start } }).then((r) => setData(r.data));
  };
  useEffect(load, [branch, start]);

  if (!editor) return (<><PageHeader title="Jadwal Saya" subtitle="2 minggu" /><MySchedule /></>);

  const maxDate = addDays(todayWIB(), 7);
  const set = async (u, date, shift_id, force = false) => {
    try {
      await api.put("/schedules", { user_id: u.id, branch_id: branch, date, shift_id: shift_id || null, force });
      toast.success("Jadwal disimpan, staff dinotifikasi");
      load();
    } catch (e) {
      if (e.response?.status === 409 && e.response.data.detail.includes("cuti") && window.confirm(`${errMsg(e)}. Tetap jadwalkan?`)) return set(u, date, shift_id, true);
      toast.error(errMsg(e));
    }
  };
  const idx = Object.fromEntries(shifts.map((s, i) => [s.id, i]));

  return (
    <div>
      <PageHeader title="Jadwal Shift" subtitle="Grid karyawan × hari · maksimal 7 hari ke depan">
        <NativeSelect className="w-44" testid="sched-branch" value={branch} onChange={setBranch} options={branches.map((b) => ({ value: b.id, label: b.name }))} />
        {["management", "hrd"].includes(user.role) && <Button variant="outline" onClick={() => setCfg(true)} data-testid="shift-settings-btn"><Settings2 className="h-4 w-4 mr-2" />Atur 5 shift</Button>}
      </PageHeader>
      <div className="flex items-center gap-2 mb-4">
        <Button size="icon" variant="outline" onClick={() => setStart(addDays(start, -7))} data-testid="week-prev"><ChevronLeft className="h-4 w-4" /></Button>
        <div className="font-semibold text-sm" data-testid="week-label">{fmtDate(start)} – {fmtDate(addDays(start, 6))}</div>
        <Button size="icon" variant="outline" onClick={() => setStart(addDays(start, 7))} data-testid="week-next"><ChevronRight className="h-4 w-4" /></Button>
      </div>
      <div className="flex flex-wrap gap-2 mb-4 text-xs">
        {shifts.map((s, i) => <span key={s.id} className={`px-2 py-1 rounded-md ${COLORS[i]}`}>{s.name} {s.start}–{s.end}</span>)}
      </div>
      {data && (
        <div className="border rounded-xl overflow-x-auto bg-card">
          <table className="w-full text-sm min-w-[900px]" data-testid="schedule-grid">
            <thead className="bg-muted text-xs"><tr><th className="p-3 text-left sticky left-0 bg-muted">Karyawan</th>
              {data.days.map((d, i) => <th key={d} className={`p-2 ${d === todayWIB() ? "text-primary" : ""}`}>{DAY[i]}<div className="font-normal text-muted-foreground">{d.slice(8)}/{d.slice(5, 7)}</div></th>)}</tr></thead>
            <tbody>
              {data.users.map((u) => (
                <tr key={u.id} className="border-t">
                  <td className="p-3 sticky left-0 bg-card"><div className="font-medium">{u.name}</div><div className="text-xs text-muted-foreground">{SEGMENT_LABEL[u.segment]} · {u.position}</div></td>
                  {data.days.map((d) => {
                    const e = data.entries.find((x) => x.user_id === u.id && x.date === d);
                    const leave = data.leaves.find((l) => l.user_id === u.id && l.date_start <= d && l.date_end >= d);
                    const locked = d > maxDate || (d < todayWIB() && !["management", "hrd"].includes(user.role));
                    const val = e?.shift_id || "";
                    return (
                      <td key={d} className="p-1.5 text-center">
                        <select disabled={locked} value={val} onChange={(ev) => set(u, d, ev.target.value)} data-testid={`cell-${u.id}-${d}`}
                          className={`w-full rounded-md text-xs py-1.5 px-1 border-0 ${val ? COLORS[idx[val]] : "bg-muted text-muted-foreground"} ${locked ? "opacity-60" : "cursor-pointer"}`}>
                          <option value="">Libur</option>
                          {shifts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                        {leave && <div className={`text-[10px] mt-0.5 ${leave.status === "disetujui" ? "text-destructive" : "text-amber-600"}`}>Cuti {leave.status === "menunggu" ? "(menunggu)" : ""}</div>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {data.users.length === 0 && <Empty text="Tidak ada karyawan di cabang ini" />}
        </div>
      )}
      <div className="mt-8"><h3 className="font-semibold mb-3">Jadwal saya</h3><MySchedule /></div>
      <Dialog open={cfg} onOpenChange={setCfg}>
        <DialogContent><DialogHeader><DialogTitle>Pengaturan 5 Shift</DialogTitle></DialogHeader>
          {cfg && <ShiftSettings branchId={branch} shifts={shifts} onSaved={() => { setCfg(false); load(); }} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
