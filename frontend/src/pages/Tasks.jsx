import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errMsg, fmtDateTime, SEGMENT_LABEL, isPic, openBlob } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PageHeader, StatusBadge, STATUS_LABEL, Field, NativeSelect, Empty } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Paperclip, Repeat, ChevronLeft, ChevronRight } from "lucide-react";

const STATUSES = ["scheduled", "pending", "on_progress", "done", "closed"];
const PRIO = { rendah: "muted", sedang: "info", tinggi: "danger" };

function TaskForm({ users, branches, projects, onDone }) {
  const { user } = useAuth();
  const [f, setF] = useState({ title: "", description: "", assignee_ids: [], branch_id: user.branch_ids[0] || "", segment: isPic(user.role) ? user.role.slice(4) : "depan", project_id: "", deadline: "", priority: "sedang", status: "pending", recurrence: "none", attachments: [] });
  const upload = async (file) => {
    const fd = new FormData(); fd.append("file", file);
    const r = await api.post("/upload", fd);
    setF((x) => ({ ...x, attachments: [...x.attachments, r.data] }));
  };
  const save = async () => {
    try { await api.post("/tasks", { ...f, deadline: f.deadline + ":00+07:00" }); toast.success("Task dibuat"); onDone(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <div className="space-y-3">
      <Field label="Judul"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} data-testid="task-title" /></Field>
      <Field label="Deskripsi"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <Field label="Assignee">
        <div className="border rounded-lg max-h-36 overflow-auto p-2 grid grid-cols-2 gap-1 text-sm" data-testid="task-assignees">
          {users.map((u) => (
            <label key={u.id} className="flex gap-2 items-center"><input type="checkbox" checked={f.assignee_ids.includes(u.id)}
              onChange={(e) => setF({ ...f, assignee_ids: e.target.checked ? [...f.assignee_ids, u.id] : f.assignee_ids.filter((x) => x !== u.id) })} />{u.name}</label>
          ))}
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Cabang"><NativeSelect value={f.branch_id} onChange={(v) => setF({ ...f, branch_id: v })} options={branches.map((b) => ({ value: b.id, label: b.name }))} /></Field>
        <Field label="Segmen"><NativeSelect value={f.segment} onChange={(v) => setF({ ...f, segment: v })} options={Object.entries(SEGMENT_LABEL).map(([value, label]) => ({ value, label }))} /></Field>
        <Field label="Deadline"><Input type="datetime-local" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} data-testid="task-deadline" /></Field>
        <Field label="Prioritas"><NativeSelect value={f.priority} onChange={(v) => setF({ ...f, priority: v })} options={["rendah", "sedang", "tinggi"].map((p) => ({ value: p, label: p }))} /></Field>
        <Field label="Status awal"><NativeSelect value={f.status} onChange={(v) => setF({ ...f, status: v })} options={["pending", "scheduled"].map((s) => ({ value: s, label: STATUS_LABEL[s] }))} /></Field>
        <Field label="Berulang"><NativeSelect testid="task-recurrence" value={f.recurrence} onChange={(v) => setF({ ...f, recurrence: v })} options={[{ value: "none", label: "Tidak" }, { value: "daily", label: "Harian" }, { value: "weekly", label: "Mingguan" }]} /></Field>
        <Field label="Project"><NativeSelect value={f.project_id} onChange={(v) => setF({ ...f, project_id: v })} options={[{ value: "", label: "-" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} /></Field>
        <Field label="Lampiran"><Input type="file" onChange={(e) => e.target.files[0] && upload(e.target.files[0])} /></Field>
      </div>
      <Button className="w-full" disabled={!f.title || !f.deadline} onClick={save} data-testid="task-save">Simpan task</Button>
    </div>
  );
}

function TaskDetail({ t, onDone }) {
  const { user } = useAuth();
  const [c, setC] = useState("");
  const [note, setNote] = useState("");
  const run = async (fn, msg) => { try { await fn(); toast.success(msg); onDone(); } catch (e) { toast.error(errMsg(e)); } };
  const canVerify = (user.role === "management" && ["menunggu", "diverifikasi_spv"].includes(t.verification)) || (user.role === "spv" && t.verification === "menunggu");
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap gap-1"><StatusBadge status={t.status} /><StatusBadge tone={PRIO[t.priority]}>{t.priority}</StatusBadge><StatusBadge status={t.verification} testid="task-verification" />{t.recurrence !== "none" && <StatusBadge tone="info"><Repeat className="h-3 w-3 mr-1" />{t.recurrence === "daily" ? "Harian" : "Mingguan"}</StatusBadge>}</div>
      <p>{t.description || <span className="text-muted-foreground">Tanpa deskripsi</span>}</p>
      <div className="text-muted-foreground">Deadline {fmtDateTime(t.deadline)} · Dibuat {t.created_by} · {SEGMENT_LABEL[t.segment] || "-"} · Assignee: {t.assignee_names.join(", ") || "-"}</div>
      {t.attachments.map((a) => <button key={a.path} className="text-primary text-xs flex gap-1 items-center" onClick={() => openBlob(`/files/${a.path}`)}><Paperclip className="h-3 w-3" />{a.name}</button>)}
      <Field label="Ubah status">
        <NativeSelect testid="task-status-select" value={t.status} onChange={(v) => run(() => api.put(`/tasks/${t.id}`, { status: v }), "Status diperbarui")} options={STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))} />
      </Field>
      {canVerify && (
        <div className="border rounded-lg p-3 space-y-2 bg-primary/5">
          <div className="font-semibold">Verifikasi {user.role === "spv" ? "awal (SPV)" : "Management"}</div>
          <Input placeholder="Catatan" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => run(() => api.post(`/tasks/${t.id}/verify`, { approve: true, note }), "Task diverifikasi")} data-testid="task-verify-approve">Setujui</Button>
            <Button size="sm" variant="destructive" onClick={() => run(() => api.post(`/tasks/${t.id}/verify`, { approve: false, note }), "Task ditolak")} data-testid="task-verify-reject">Tolak</Button>
          </div>
        </div>
      )}
      <div className="space-y-2">
        <div className="font-semibold">Komentar</div>
        {t.comments.map((x) => <div key={x.id} className="bg-muted rounded-lg p-2"><b>{x.by}</b> <span className="text-xs text-muted-foreground">{fmtDateTime(x.at)}</span><div>{x.text}</div></div>)}
        <div className="flex gap-2"><Input value={c} onChange={(e) => setC(e.target.value)} placeholder="Tulis komentar" data-testid="task-comment-input" />
          <Button size="sm" disabled={!c} onClick={() => run(() => api.post(`/tasks/${t.id}/comments`, { text: c }).then(() => setC("")), "Komentar terkirim")} data-testid="task-comment-btn">Kirim</Button></div>
      </div>
    </div>
  );
}

function CalendarView({ tasks, onOpen }) {
  const [m, setM] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const first = (m.getDay() + 6) % 7;
  const days = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
  const cells = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const key = (d) => `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Button size="icon" variant="outline" onClick={() => setM(new Date(m.getFullYear(), m.getMonth() - 1, 1))}><ChevronLeft className="h-4 w-4" /></Button>
        <div className="font-semibold">{m.toLocaleDateString("id-ID", { month: "long", year: "numeric" })}</div>
        <Button size="icon" variant="outline" onClick={() => setM(new Date(m.getFullYear(), m.getMonth() + 1, 1))}><ChevronRight className="h-4 w-4" /></Button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-xs" data-testid="task-calendar">
        {["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"].map((d) => <div key={d} className="text-center font-semibold text-muted-foreground py-1">{d}</div>)}
        {cells.map((d, i) => (
          <div key={i} className={`min-h-20 rounded-lg border p-1 ${d ? "bg-card" : "border-transparent"}`}>
            {d && <div className="text-muted-foreground">{d}</div>}
            {d && tasks.filter((t) => t.deadline.slice(0, 10) === key(d)).map((t) => (
              <button key={t.id} onClick={() => onOpen(t)} className="block w-full text-left truncate rounded bg-primary/10 text-primary px-1 mt-0.5">{t.title}</button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Tasks() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [branches, setBranches] = useState([]);
  const [projects, setProjects] = useState([]);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(null);
  const [proj, setProj] = useState("");
  const canCreate = user.role !== "staff";
  const load = () => api.get("/tasks").then((r) => { setTasks(r.data); setSel((s) => (s ? r.data.find((x) => x.id === s.id) : null)); });
  useEffect(() => {
    load();
    api.get("/users").then((r) => setUsers(r.data));
    api.get("/branches").then((r) => setBranches(r.data));
    api.get("/projects").then((r) => setProjects(r.data));
  }, []);
  const addProject = async () => { const name = window.prompt("Nama project"); if (name) { await api.post("/projects", { name }); api.get("/projects").then((r) => setProjects(r.data)); } };
  const shown = tasks.filter((t) => !proj || t.project_id === proj);
  const Card = ({ t }) => (
    <button onClick={() => setSel(t)} className="w-full text-left bg-card border rounded-lg p-3 hover:border-primary space-y-1" data-testid={`task-card-${t.id}`}>
      <div className="font-medium text-sm">{t.title}</div>
      <div className="text-xs text-muted-foreground">{fmtDateTime(t.deadline)}</div>
      <div className="flex flex-wrap gap-1"><StatusBadge tone={PRIO[t.priority]}>{t.priority}</StatusBadge>{t.verification !== "belum" && <StatusBadge status={t.verification} />}</div>
    </button>
  );
  return (
    <div>
      <PageHeader title="Task & Proyek" subtitle="Task PIC wajib diverifikasi Management · berpengaruh ke KPI">
        <NativeSelect className="w-44" testid="project-filter" value={proj} onChange={setProj} options={[{ value: "", label: "Semua project" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} />
        {canCreate && <Button variant="outline" onClick={addProject} data-testid="new-project-btn">+ Project</Button>}
        {canCreate && <Button onClick={() => setOpen(true)} data-testid="new-task-btn"><Plus className="h-4 w-4 mr-1" />Task</Button>}
      </PageHeader>
      <Tabs defaultValue="kanban">
        <TabsList><TabsTrigger value="kanban">Kanban</TabsTrigger><TabsTrigger value="list" data-testid="tab-task-list">Daftar</TabsTrigger><TabsTrigger value="calendar" data-testid="tab-task-calendar">Kalender</TabsTrigger></TabsList>
        <TabsContent value="kanban">
          <div className="flex gap-3 overflow-x-auto pb-4" data-testid="task-kanban">
            {STATUSES.map((s) => (
              <div key={s} className="min-w-[240px] w-[240px] bg-muted/60 rounded-xl p-2">
                <div className="text-xs font-semibold uppercase px-1 mb-2 flex justify-between">{STATUS_LABEL[s]}<span>{shown.filter((t) => t.status === s).length}</span></div>
                <div className="space-y-2">{shown.filter((t) => t.status === s).map((t) => <Card key={t.id} t={t} />)}</div>
              </div>
            ))}
          </div>
        </TabsContent>
        <TabsContent value="list">
          <div className="border rounded-xl bg-card divide-y">
            {shown.length === 0 && <Empty />}
            {shown.map((t) => (
              <button key={t.id} onClick={() => setSel(t)} className="w-full p-3 flex flex-wrap gap-2 items-center text-left text-sm hover:bg-accent">
                <span className="flex-1 font-medium">{t.title}</span><span className="text-muted-foreground">{t.assignee_names.join(", ")}</span>
                <span className="text-muted-foreground">{fmtDateTime(t.deadline)}</span><StatusBadge status={t.status} />
              </button>
            ))}
          </div>
        </TabsContent>
        <TabsContent value="calendar"><CalendarView tasks={shown} onOpen={setSel} /></TabsContent>
      </Tabs>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-auto"><DialogHeader><DialogTitle>Task baru</DialogTitle></DialogHeader>
          {open && <TaskForm users={users} branches={branches} projects={projects} onDone={() => { setOpen(false); load(); }} />}
        </DialogContent>
      </Dialog>
      <Dialog open={!!sel} onOpenChange={(o) => !o && setSel(null)}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-auto"><DialogHeader><DialogTitle>{sel?.title}</DialogTitle></DialogHeader>
          {sel && <TaskDetail t={sel} onDone={load} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
