import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errMsg, ROLE_LABEL, SEGMENT_LABEL } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PageHeader, Empty, Field, NativeSelect, StatusBadge } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Trophy } from "lucide-react";

const thisMonth = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }).slice(0, 7);

function Evaluate({ target, period, cats, onDone }) {
  const level = target.role === "staff" ? "staff" : "pic";
  const list = cats.filter((c) => c.active && c.target === level);
  const [scores, setScores] = useState({});
  const [note, setNote] = useState("");
  const submit = async () => {
    try { const r = await api.post("/kpi/scores", { employee_id: target.id, period, scores, note }); toast.success(`Tersimpan. Skor akhir ${r.data.final_score}`); onDone(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <div className="space-y-4">
      {list.map((c) => (
        <div key={c.id}>
          <div className="text-sm font-medium mb-1">{c.name} <span className="text-muted-foreground">(bobot {c.weight})</span></div>
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5].map((v) => (
              <button key={v} onClick={() => setScores({ ...scores, [c.id]: v })} data-testid={`kpi-${c.id}-${v}`}
                className={`h-10 w-10 rounded-lg border font-semibold ${scores[c.id] === v ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"}`}>{v}</button>
            ))}
          </div>
        </div>
      ))}
      <Field label="Catatan"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <Button className="w-full" disabled={list.some((c) => !scores[c.id])} onClick={submit} data-testid="kpi-submit">Simpan penilaian</Button>
    </div>
  );
}

function Categories({ cats, reload }) {
  const [f, setF] = useState({ name: "", weight: 20, target: "staff", active: true });
  const add = async () => { try { await api.post("/kpi/categories", f); setF({ ...f, name: "" }); reload(); } catch (e) { toast.error(errMsg(e)); } };
  const upd = async (c, patch) => { await api.put(`/kpi/categories/${c.id}`, { ...c, ...patch }); reload(); };
  return (
    <div className="space-y-3 max-w-2xl">
      <div className="grid grid-cols-4 gap-2 items-end">
        <Field label="Kategori"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="cat-name" /></Field>
        <Field label="Bobot"><Input type="number" value={f.weight} onChange={(e) => setF({ ...f, weight: Number(e.target.value) })} data-testid="cat-weight" /></Field>
        <Field label="Untuk"><NativeSelect value={f.target} onChange={(v) => setF({ ...f, target: v })} options={[{ value: "staff", label: "Staff" }, { value: "pic", label: "PIC" }]} /></Field>
        <Button onClick={add} disabled={!f.name} data-testid="cat-add">Tambah</Button>
      </div>
      {cats.map((c) => (
        <div key={c.id} className="border rounded-lg p-3 bg-card flex items-center gap-3 text-sm">
          <div className="flex-1 font-medium">{c.name}</div>
          <StatusBadge tone="info">{c.target === "pic" ? "PIC" : "Staff"}</StatusBadge>
          <Input type="number" className="w-20 h-8" defaultValue={c.weight} onBlur={(e) => upd(c, { weight: Number(e.target.value) })} />
          <Button size="sm" variant="ghost" onClick={() => upd(c, { active: !c.active })}>{c.active ? "Nonaktifkan" : "Aktifkan"}</Button>
        </div>
      ))}
    </div>
  );
}

export default function Kpi() {
  const { user } = useAuth();
  const [period, setPeriod] = useState(thisMonth());
  const [cats, setCats] = useState([]);
  const [targets, setTargets] = useState([]);
  const [scores, setScores] = useState([]);
  const [sel, setSel] = useState(null);
  const admin = ["management", "hrd"].includes(user.role);
  const loadCats = () => api.get("/kpi/categories").then((r) => setCats(r.data));
  const load = () => api.get("/kpi/scores", { params: { period } }).then((r) => setScores(r.data));
  useEffect(() => { loadCats(); api.get("/kpi/targets").then((r) => setTargets(r.data)); }, []);
  useEffect(() => { load(); }, [period]);
  const mine = scores.filter((s) => s.employee_id === user.id);

  return (
    <div>
      <PageHeader title="KPI Berjenjang" subtitle="SPV menilai PIC · PIC menilai Staff · skala 1–5 · bulanan">
        <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="w-44" data-testid="kpi-period" />
      </PageHeader>
      <Tabs defaultValue={targets.length ? "evaluate" : "mine"}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="mine" data-testid="tab-kpi-mine">Nilai saya</TabsTrigger>
          {targets.length > 0 && <TabsTrigger value="evaluate" data-testid="tab-kpi-evaluate">Menilai tim</TabsTrigger>}
          {(admin || user.role === "spv") && <TabsTrigger value="ranking" data-testid="tab-kpi-ranking">Ranking</TabsTrigger>}
          {admin && <TabsTrigger value="cats" data-testid="tab-kpi-cats">Kategori & bobot</TabsTrigger>}
        </TabsList>
        <TabsContent value="mine">
          {mine.length === 0 && <Empty text="Belum ada penilaian untuk periode ini" />}
          {mine.map((s) => (
            <div key={s.period} className="border rounded-2xl p-6 bg-card max-w-md" data-testid="my-kpi-card">
              <div className="text-5xl font-extrabold text-primary">{s.final_score}</div>
              <div className="text-sm text-muted-foreground mt-1">Nilai penilai {s.eval_score} · Task terverifikasi {s.task_score ?? "-"}</div>
              <div className="text-sm mt-2">Dinilai oleh {s.evaluator_name}{s.note ? ` — "${s.note}"` : ""}</div>
            </div>
          ))}
        </TabsContent>
        <TabsContent value="evaluate">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {targets.map((t) => {
              const s = scores.find((x) => x.employee_id === t.id);
              return (
                <div key={t.id} className="border rounded-xl p-4 bg-card flex justify-between items-center">
                  <div><div className="font-semibold">{t.name}</div><div className="text-xs text-muted-foreground">{ROLE_LABEL[t.role]} · {SEGMENT_LABEL[t.segment]}</div>{s && <div className="text-sm mt-1">Skor: <b>{s.final_score}</b></div>}</div>
                  <Button size="sm" variant={s ? "outline" : "default"} onClick={() => setSel(t)} data-testid={`evaluate-${t.id}`}>{s ? "Ubah" : "Nilai"}</Button>
                </div>
              );
            })}
          </div>
        </TabsContent>
        <TabsContent value="ranking">
          <div className="border rounded-xl bg-card divide-y max-w-3xl" data-testid="kpi-ranking">
            {scores.length === 0 && <Empty />}
            {scores.map((s, i) => (
              <div key={s.employee_id} className="p-3 flex items-center gap-3 text-sm">
                <span className={`w-8 text-center font-bold ${i < 3 ? "text-primary" : "text-muted-foreground"}`}>{i < 3 ? <Trophy className="h-4 w-4 inline" /> : i + 1}</span>
                <span className="flex-1 font-medium">{s.employee_name} <span className="text-muted-foreground font-normal">· {s.level.toUpperCase()} · {SEGMENT_LABEL[s.segment]}</span></span>
                <span className="text-muted-foreground">oleh {s.evaluator_name}</span>
                <span className="font-bold w-12 text-right">{s.final_score}</span>
              </div>
            ))}
          </div>
        </TabsContent>
        <TabsContent value="cats"><Categories cats={cats} reload={loadCats} /></TabsContent>
      </Tabs>
      <Dialog open={!!sel} onOpenChange={(o) => !o && setSel(null)}>
        <DialogContent><DialogHeader><DialogTitle>Nilai {sel?.name} · {period}</DialogTitle></DialogHeader>
          {sel && <Evaluate target={sel} period={period} cats={cats} onDone={() => { setSel(null); load(); }} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
