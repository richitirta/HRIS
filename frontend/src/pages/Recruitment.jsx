import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errMsg, fmtDate, openBlob, rupiah, SEGMENT_LABEL, ROLE_LABEL } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PageHeader, StatusBadge, Field, NativeSelect, Empty } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, FileText, Search, ExternalLink } from "lucide-react";

const STAGES = [["masuk", "Pelamar Masuk"], ["interview", "Interview"], ["seleksi", "Seleksi"], ["offering", "Offering"], ["diterima", "Diterima"], ["ditolak", "Ditolak"]];

function ApplicantDialog({ a, users, onClose, onDone }) {
  const { user } = useAuth();
  const [iv, setIv] = useState({ date: "", time: "10:00", interviewer_id: users[0]?.id || "", notes: "" });
  const [sc, setSc] = useState({ score: a.score || 0, notes: a.notes || "" });
  const [of, setOf] = useState({ position: a.position, role: "staff", segment: "depan", start_date: "", base_salary: 3500000, allowance: 500000, meal_rate: 25000, ot_rate: 15000, ph_rate: 100000, letter: `Dengan hormat, kami menawarkan posisi ${a.position} kepada ${a.name}.` });
  const call = async (fn, msg) => {
    try { const r = await fn(); toast.success(msg); onDone(r?.data); } catch (e) { toast.error(errMsg(e)); }
  };
  const o = a.offer;
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-auto">
        <DialogHeader><DialogTitle>{a.name} · {a.position}</DialogTitle></DialogHeader>
        <div className="text-sm space-y-1">
          <div>{a.email} · {a.phone} · melamar {fmtDate(a.created_at)}</div>
          <div className="text-muted-foreground">{a.cover}</div>
          {a.cv_path && <Button size="sm" variant="outline" onClick={() => openBlob(`/files/${a.cv_path}`)} data-testid="view-cv-btn"><FileText className="h-4 w-4 mr-1" />Lihat CV</Button>}
        </div>
        <Tabs defaultValue={a.stage === "masuk" ? "interview" : a.stage === "interview" ? "seleksi" : "offering"}>
          <TabsList><TabsTrigger value="interview">Interview</TabsTrigger><TabsTrigger value="seleksi">Seleksi</TabsTrigger><TabsTrigger value="offering" data-testid="tab-offering">Offering</TabsTrigger></TabsList>
          <TabsContent value="interview" className="space-y-3">
            {a.interviews.map((x, i) => <div key={i} className="text-sm border rounded-lg p-2">{fmtDate(x.date)} {x.time} · {x.interviewer_name} · {x.notes}</div>)}
            <div className="grid grid-cols-2 gap-2">
              <Field label="Tanggal"><Input type="date" value={iv.date} onChange={(e) => setIv({ ...iv, date: e.target.value })} data-testid="iv-date" /></Field>
              <Field label="Jam"><Input type="time" value={iv.time} onChange={(e) => setIv({ ...iv, time: e.target.value })} /></Field>
            </div>
            <Field label="Interviewer"><NativeSelect testid="iv-interviewer" value={iv.interviewer_id} onChange={(v) => setIv({ ...iv, interviewer_id: v })} options={users.map((u) => ({ value: u.id, label: `${u.name} (${ROLE_LABEL[u.role]})` }))} /></Field>
            <Field label="Catatan"><Input value={iv.notes} onChange={(e) => setIv({ ...iv, notes: e.target.value })} /></Field>
            <Button disabled={!iv.date} onClick={() => call(() => api.post(`/applicants/${a.id}/interview`, iv), "Interview dijadwalkan, interviewer dinotifikasi")} data-testid="iv-save">Jadwalkan interview</Button>
          </TabsContent>
          <TabsContent value="seleksi" className="space-y-3">
            <Field label="Skor (0-100)"><Input type="number" value={sc.score} onChange={(e) => setSc({ ...sc, score: Number(e.target.value) })} data-testid="score-input" /></Field>
            <Field label="Catatan seleksi"><Textarea value={sc.notes} onChange={(e) => setSc({ ...sc, notes: e.target.value })} /></Field>
            <Button onClick={() => call(() => api.post(`/applicants/${a.id}/score`, sc), "Skor disimpan")} data-testid="score-save">Simpan skor</Button>
          </TabsContent>
          <TabsContent value="offering" className="space-y-3">
            {o && <div className="border rounded-lg p-3 text-sm space-y-1"><StatusBadge tone="warning" testid="offer-status">{o.status.replaceAll("_", " ")}</StatusBadge><div>{o.position} · Gaji {rupiah(o.base_salary)} · mulai {o.start_date}</div><div className="text-muted-foreground whitespace-pre-line">{o.letter}</div></div>}
            {o?.status === "menunggu_management" && user.role === "management" && (
              <div className="flex gap-2">
                <Button onClick={() => call(() => api.post(`/applicants/${a.id}/offer/approve`, { approve: true }), "Offering disetujui")} data-testid="offer-approve">Setujui offering</Button>
                <Button variant="destructive" onClick={() => call(() => api.post(`/applicants/${a.id}/offer/approve`, { approve: false }), "Offering ditolak")}>Tolak</Button>
              </div>
            )}
            {o?.status === "disetujui_management" && (
              <div className="flex gap-2">
                <Button onClick={() => call(() => api.post(`/applicants/${a.id}/offer/response`, { approve: true }), "Kandidat diterima & akun karyawan dibuat")} data-testid="offer-accepted">Kandidat menerima → buat karyawan</Button>
                <Button variant="outline" onClick={() => call(() => api.post(`/applicants/${a.id}/offer/response`, { approve: false }), "Kandidat menolak")}>Kandidat menolak</Button>
              </div>
            )}
            {(!o || o.status.startsWith("ditolak")) && (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Posisi"><Input value={of.position} onChange={(e) => setOf({ ...of, position: e.target.value })} /></Field>
                <Field label="Mulai kerja"><Input type="date" value={of.start_date} onChange={(e) => setOf({ ...of, start_date: e.target.value })} data-testid="offer-start" /></Field>
                <Field label="Role"><NativeSelect value={of.role} onChange={(v) => setOf({ ...of, role: v })} options={["staff", "pic_depan", "pic_dapur", "pic_bar"].map((r) => ({ value: r, label: ROLE_LABEL[r] }))} /></Field>
                <Field label="Segmen"><NativeSelect value={of.segment} onChange={(v) => setOf({ ...of, segment: v })} options={Object.entries(SEGMENT_LABEL).map(([value, label]) => ({ value, label }))} /></Field>
                {["base_salary", "allowance", "meal_rate", "ot_rate", "ph_rate"].map((k) => (
                  <Field key={k} label={{ base_salary: "Gaji pokok/bln", allowance: "Tunjangan/bln", meal_rate: "Uang makan/hari", ot_rate: "Lembur/blok 30m", ph_rate: "Uang PH/hari" }[k]}>
                    <Input type="number" value={of[k]} onChange={(e) => setOf({ ...of, [k]: Number(e.target.value) })} />
                  </Field>
                ))}
                <div className="col-span-2"><Field label="Surat penawaran"><Textarea rows={4} value={of.letter} onChange={(e) => setOf({ ...of, letter: e.target.value })} /></Field></div>
                <Button className="col-span-2" disabled={!of.start_date} onClick={() => call(() => api.post(`/applicants/${a.id}/offer`, of), "Offering dikirim ke Management")} data-testid="offer-submit">Kirim offering untuk approval Management</Button>
              </div>
            )}
          </TabsContent>
        </Tabs>
        <Button variant="ghost" className="text-destructive" onClick={() => call(() => api.put(`/applicants/${a.id}/stage`, { stage: "ditolak" }), "Pelamar ditolak")} data-testid="reject-applicant">Tolak pelamar</Button>
      </DialogContent>
    </Dialog>
  );
}

function Jobs({ branches, onChange }) {
  const [jobs, setJobs] = useState([]);
  const [f, setF] = useState(null);
  const load = () => api.get("/jobs").then((r) => setJobs(r.data));
  useEffect(() => { load(); }, []);
  const save = async () => {
    try { f.id ? await api.put(`/jobs/${f.id}`, f) : await api.post("/jobs", f); setF(null); load(); onChange(); toast.success("Lowongan disimpan"); }
    catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <div className="space-y-3">
      <div className="flex gap-2"><Button onClick={() => setF({ title: "", branch_id: branches[0]?.id, segment: "depan", description: "", requirements: "", active: true })} data-testid="new-job-btn"><Plus className="h-4 w-4 mr-1" />Lowongan</Button>
        <Button variant="outline" onClick={() => window.open("/karir", "_blank")}><ExternalLink className="h-4 w-4 mr-1" />Job portal publik</Button></div>
      {jobs.map((j) => (
        <div key={j.id} className="border rounded-xl p-3 bg-card flex justify-between items-center">
          <div><b>{j.title}</b> · {branches.find((b) => b.id === j.branch_id)?.name} · {SEGMENT_LABEL[j.segment]}</div>
          <div className="flex gap-2 items-center"><StatusBadge tone={j.active ? "success" : "muted"}>{j.active ? "Aktif" : "Ditutup"}</StatusBadge><Button size="sm" variant="ghost" onClick={() => setF(j)}>Ubah</Button></div>
        </div>
      ))}
      <Dialog open={!!f} onOpenChange={(o) => !o && setF(null)}>
        <DialogContent><DialogHeader><DialogTitle>Lowongan</DialogTitle></DialogHeader>
          {f && <div className="space-y-3">
            <Field label="Judul posisi"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} data-testid="job-title" /></Field>
            <Field label="Cabang"><NativeSelect value={f.branch_id} onChange={(v) => setF({ ...f, branch_id: v })} options={branches.map((b) => ({ value: b.id, label: b.name }))} /></Field>
            <Field label="Segmen"><NativeSelect value={f.segment} onChange={(v) => setF({ ...f, segment: v })} options={Object.entries(SEGMENT_LABEL).map(([value, label]) => ({ value, label }))} /></Field>
            <Field label="Deskripsi"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
            <Field label="Persyaratan"><Textarea value={f.requirements} onChange={(e) => setF({ ...f, requirements: e.target.value })} /></Field>
            <label className="flex gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Aktif (tampil di job portal)</label>
            <Button className="w-full" onClick={save} data-testid="job-save">Simpan</Button>
          </div>}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function Recruitment() {
  const [apps, setApps] = useState([]);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(null);
  const [branches, setBranches] = useState([]);
  const [users, setUsers] = useState([]);
  const load = () => api.get("/applicants", { params: { q } }).then((r) => { setApps(r.data); setSel((s) => (s ? r.data.find((x) => x.id === s.id) : null)); });
  useEffect(() => { api.get("/branches").then((r) => setBranches(r.data)); api.get("/users").then((r) => setUsers(r.data.filter((u) => u.role !== "staff"))); }, []);
  useEffect(() => { load(); }, [q]);
  const onDone = (d) => { if (d?.temp_password) toast.success(`Akun dibuat: ${d.email} / ${d.temp_password}`, { duration: 20000 }); load(); };
  return (
    <div>
      <PageHeader title="Rekrutmen" subtitle="Pelamar → Interview → Seleksi → Offering → Karyawan baru" />
      <Tabs defaultValue="pipeline">
        <TabsList><TabsTrigger value="pipeline">Pipeline</TabsTrigger><TabsTrigger value="jobs" data-testid="tab-jobs">Lowongan</TabsTrigger></TabsList>
        <TabsContent value="pipeline">
          <div className="relative max-w-xs mb-4"><Search className="h-4 w-4 absolute left-3 top-2.5 text-muted-foreground" /><Input className="pl-9" placeholder="Cari nama/posisi" value={q} onChange={(e) => setQ(e.target.value)} data-testid="applicant-search" /></div>
          <div className="flex gap-3 overflow-x-auto pb-4" data-testid="recruit-kanban">
            {STAGES.map(([k, l]) => (
              <div key={k} className="min-w-[230px] w-[230px] bg-muted/60 rounded-xl p-2">
                <div className="text-xs font-semibold uppercase px-1 mb-2 flex justify-between">{l}<span>{apps.filter((a) => a.stage === k).length}</span></div>
                <div className="space-y-2">
                  {apps.filter((a) => a.stage === k).map((a) => (
                    <button key={a.id} onClick={() => setSel(a)} className="w-full text-left bg-card border rounded-lg p-3 hover:border-primary" data-testid={`applicant-${a.id}`}>
                      <div className="font-medium text-sm">{a.name}</div>
                      <div className="text-xs text-muted-foreground">{a.position}</div>
                      {a.score != null && <div className="text-xs mt-1">Skor {a.score}</div>}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {apps.length === 0 && <Empty text="Belum ada pelamar" />}
        </TabsContent>
        <TabsContent value="jobs"><Jobs branches={branches} onChange={load} /></TabsContent>
      </Tabs>
      {sel && <ApplicantDialog a={sel} users={users} onClose={() => setSel(null)} onDone={onDone} />}
    </div>
  );
}
