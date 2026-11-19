import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errMsg, rupiah, fmtDateTime, ROLE_LABEL, SEGMENT_LABEL } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PageHeader, Field, NativeSelect, StatusBadge, Empty } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Search, Smartphone, ScanFace } from "lucide-react";

const COMP = [["base_salary", "Gaji pokok / bulan"], ["allowance", "Tunjangan / bulan"], ["meal_rate", "Uang makan / hari"], ["ot_rate", "Lembur / blok 30 menit"], ["ph_rate", "Uang PH / hari"]];

function UserForm({ init, branches, onDone }) {
  const { user } = useAuth();
  const [f, setF] = useState(init);
  const roles = Object.keys(ROLE_LABEL).filter((r) => r !== "management" || user.role === "management");
  const toggle = (k, id) => setF({ ...f, [k]: f[k].includes(id) ? f[k].filter((x) => x !== id) : [...f[k], id] });
  const save = async () => {
    try {
      const r = f.id ? await api.put(`/users/${f.id}`, f) : await api.post("/users", f);
      if (r.data.temp_password) toast.success(`Akun dibuat. Password: ${r.data.temp_password}`, { duration: 20000 });
      else toast.success("Tersimpan");
      onDone();
    } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      <Field label="Nama"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="emp-name" /></Field>
      <Field label="Email (login)"><Input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} data-testid="emp-email" /></Field>
      <Field label="Role"><NativeSelect testid="emp-role" value={f.role} onChange={(v) => setF({ ...f, role: v })} options={roles.map((r) => ({ value: r, label: ROLE_LABEL[r] }))} /></Field>
      <Field label="Segmen"><NativeSelect testid="emp-segment" value={f.segment} onChange={(v) => setF({ ...f, segment: v })} options={Object.entries(SEGMENT_LABEL).map(([value, label]) => ({ value, label }))} /></Field>
      <Field label="Jabatan"><Input value={f.position} onChange={(e) => setF({ ...f, position: e.target.value })} data-testid="emp-position" /></Field>
      <Field label="Level (untuk tarif)"><Input value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })} /></Field>
      <Field label="No. HP"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
      <Field label="Kuota cuti / tahun"><Input type="number" value={f.leave_quota} onChange={(e) => setF({ ...f, leave_quota: Number(e.target.value) })} /></Field>
      <div className="sm:col-span-2 space-y-2">
        <div className="text-sm font-medium">Cabang penugasan</div>
        <div className="flex flex-wrap gap-2">{branches.map((b) => <Button key={b.id} type="button" size="sm" variant={f.branch_ids.includes(b.id) ? "default" : "outline"} onClick={() => toggle("branch_ids", b.id)} data-testid={`emp-branch-${b.id}`}>{b.name}</Button>)}</div>
        <div className="text-sm font-medium">Cabang yang boleh dipakai absen</div>
        <div className="flex flex-wrap gap-2">{branches.map((b) => <Button key={b.id} type="button" size="sm" variant={f.attendance_branch_ids.includes(b.id) ? "default" : "outline"} onClick={() => toggle("attendance_branch_ids", b.id)}>{b.name}</Button>)}</div>
      </div>
      <div className="sm:col-span-2 text-sm font-semibold pt-2">Komponen gaji (terenkripsi)</div>
      {COMP.map(([k, l]) => <Field key={k} label={l}><Input type="number" value={f.comp?.[k] ?? 0} onChange={(e) => setF({ ...f, comp: { ...f.comp, [k]: Number(e.target.value) } })} data-testid={`emp-${k}`} /></Field>)}
      <Field label={f.id ? "Password baru (opsional)" : "Password (kosong = acak)"}><Input type="text" value={f.password || ""} onChange={(e) => setF({ ...f, password: e.target.value })} data-testid="emp-password" /></Field>
      <label className="flex gap-2 text-sm items-center"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Aktif</label>
      <Button className="sm:col-span-2" onClick={save} disabled={!f.name || !f.email || !f.branch_ids.length} data-testid="emp-save">Simpan</Button>
    </div>
  );
}

function Resets({ reload }) {
  const [items, setItems] = useState([]);
  const load = () => api.get("/device-resets").then((r) => setItems(r.data));
  useEffect(() => { load(); }, []);
  const decide = async (r, approve) => {
    try { await api.post(`/device-resets/${r.id}/decide`, { approve }); toast.success(approve ? "Device dilepas, HP baru bisa didaftarkan" : "Ditolak"); load(); reload(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <div className="space-y-2" data-testid="reset-list">
      {items.length === 0 && <Empty text="Belum ada permintaan reset device" />}
      {items.map((r) => (
        <div key={r.id} className="border rounded-xl p-3 bg-card flex flex-wrap justify-between gap-2 items-center text-sm">
          <div><b>{r.user_name}</b> · via {r.via} · {fmtDateTime(r.created_at)}<div className="text-muted-foreground">{r.reason}</div></div>
          {r.status === "menunggu" ? (
            <div className="flex gap-2"><Button size="sm" onClick={() => decide(r, true)} data-testid={`reset-approve-${r.id}`}>Setujui</Button><Button size="sm" variant="outline" onClick={() => decide(r, false)}>Tolak</Button></div>
          ) : <StatusBadge status={r.status} />}
        </div>
      ))}
    </div>
  );
}

export default function Employees() {
  const [users, setUsers] = useState([]);
  const [branches, setBranches] = useState([]);
  const [q, setQ] = useState("");
  const [form, setForm] = useState(null);
  const load = () => api.get("/users").then((r) => setUsers(r.data));
  useEffect(() => { load(); api.get("/branches").then((r) => setBranches(r.data)); }, []);
  const blank = { name: "", email: "", role: "staff", segment: "depan", position: "", level: "", phone: "", nik: "", branch_ids: [], attendance_branch_ids: [], active: true, leave_quota: 12, join_date: "", comp: {} };
  const resetDevice = async (u) => {
    const reason = window.prompt(`Alasan reset device ${u.name}?`);
    if (!reason) return;
    try {
      const r = await api.post("/device-resets", { user_id: u.id, reason });
      await api.post(`/device-resets/${r.data.id}/decide`, { approve: true });
      toast.success("Device dilepas");
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };
  const resetFace = async (u) => {
    if (!window.confirm(`Reset data wajah ${u.name}?`)) return;
    await api.post(`/users/${u.id}/reset-face`);
    toast.success("Data wajah direset");
    load();
  };
  const shown = users.filter((u) => u.name.toLowerCase().includes(q.toLowerCase()) || u.email.includes(q.toLowerCase()));
  return (
    <div>
      <PageHeader title="Karyawan & Device" subtitle={`${users.length} akun · 1 akun = 1 HP terdaftar`}>
        <Button onClick={() => setForm(blank)} data-testid="new-employee-btn"><Plus className="h-4 w-4 mr-1" />Karyawan</Button>
      </PageHeader>
      <Tabs defaultValue="list">
        <TabsList><TabsTrigger value="list">Daftar</TabsTrigger><TabsTrigger value="resets" data-testid="tab-resets">Permintaan reset device</TabsTrigger></TabsList>
        <TabsContent value="list">
          <div className="relative max-w-xs mb-3"><Search className="h-4 w-4 absolute left-3 top-2.5 text-muted-foreground" /><Input className="pl-9" placeholder="Cari" value={q} onChange={(e) => setQ(e.target.value)} data-testid="emp-search" /></div>
          <div className="border rounded-xl bg-card overflow-x-auto">
            <table className="w-full text-sm" data-testid="employee-table">
              <thead className="bg-muted text-xs uppercase text-muted-foreground"><tr className="text-left"><th className="p-3">Nama</th><th>Role / Segmen</th><th>Cabang</th><th>Gaji pokok</th><th>Device</th><th>Wajah</th><th /></tr></thead>
              <tbody>
                {shown.map((u) => (
                  <tr key={u.id} className={`border-t ${u.active ? "" : "opacity-50"}`}>
                    <td className="p-3"><div className="font-medium">{u.name}</div><div className="text-xs text-muted-foreground">{u.email}</div></td>
                    <td>{ROLE_LABEL[u.role]}<div className="text-xs text-muted-foreground">{SEGMENT_LABEL[u.segment]} · {u.position}</div></td>
                    <td className="text-xs">{u.branch_ids.map((b) => branches.find((x) => x.id === b)?.name).join(", ")}</td>
                    <td>{rupiah(u.comp?.base_salary)}</td>
                    <td>{u.device_id ? <button onClick={() => resetDevice(u)} title="Reset device" className="flex items-center gap-1 text-xs" data-testid={`reset-device-${u.id}`}><Smartphone className="h-3.5 w-3.5 text-[hsl(var(--success))]" /><span className="font-mono truncate max-w-[90px]">{u.device_id}</span></button> : <span className="text-xs text-muted-foreground">Belum terikat</span>}</td>
                    <td>{u.face_enrolled ? <button onClick={() => resetFace(u)} data-testid={`reset-face-${u.id}`}><StatusBadge tone="success"><ScanFace className="h-3 w-3 mr-1" />Terdaftar</StatusBadge></button> : <StatusBadge tone="warning">Belum</StatusBadge>}</td>
                    <td><Button size="sm" variant="ghost" onClick={() => setForm({ ...u, comp: u.comp || {} })} data-testid={`edit-emp-${u.id}`}>Ubah</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>
        <TabsContent value="resets"><Resets reload={load} /></TabsContent>
      </Tabs>
      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-auto"><DialogHeader><DialogTitle>{form?.id ? "Ubah karyawan" : "Karyawan baru"}</DialogTitle></DialogHeader>
          {form && <UserForm init={form} branches={branches} onDone={() => { setForm(null); load(); }} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
