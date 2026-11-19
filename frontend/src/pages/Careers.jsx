import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { api, errMsg, SEGMENT_LABEL } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, NativeSelect, Empty } from "@/components/common";
import { MapPin, Briefcase, CheckCircle2 } from "lucide-react";

export default function Careers() {
  const [jobs, setJobs] = useState([]);
  const [branch, setBranch] = useState("");
  const [job, setJob] = useState(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", cover: "" });
  const [cv, setCv] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => { api.get("/public/jobs").then((r) => setJobs(r.data)); }, []);
  const branches = [...new Map(jobs.map((j) => [j.branch_id, j.branch_name])).entries()];
  const shown = jobs.filter((j) => !branch || j.branch_id === branch);

  const submit = async (e) => {
    e.preventDefault();
    if (!cv) return toast.error("CV wajib diunggah");
    setBusy(true);
    const fd = new FormData();
    Object.entries(form).forEach(([k, v]) => fd.append(k, v));
    fd.append("job_id", job.id);
    fd.append("cv", cv);
    try {
      await api.post("/public/apply", fd);
      setDone(true);
    } catch (err) { toast.error(errMsg(err)); }
    setBusy(false);
  };

  return (
    <div className="min-h-screen">
      <header className="border-b bg-card">
        <div className="max-w-5xl mx-auto px-6 py-10">
          <Link to="/login" className="text-sm text-muted-foreground">← RestoHRIS</Link>
          <h1 className="text-4xl sm:text-5xl font-extrabold mt-3 tracking-tight">Karir di El Pico & Pahlawan Trip</h1>
          <p className="text-muted-foreground mt-3 max-w-xl">Bergabung dengan tim dapur, bar, dan pelayanan kami. Pilih posisi dan kirim lamaran beserta CV Anda.</p>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        <div className="max-w-xs">
          <NativeSelect testid="careers-branch-filter" value={branch} onChange={setBranch}
            options={[{ value: "", label: "Semua cabang" }, ...branches.map(([id, n]) => ({ value: id, label: n }))]} />
        </div>
        {shown.length === 0 && <Empty text="Belum ada lowongan dibuka" />}
        <div className="grid sm:grid-cols-2 gap-4">
          {shown.map((j) => (
            <div key={j.id} className="border rounded-xl p-5 bg-card rise hover:border-primary/50 transition-colors" data-testid={`job-card-${j.id}`}>
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><MapPin className="h-3.5 w-3.5" />{j.branch_name} · {SEGMENT_LABEL[j.segment]}</div>
              <h3 className="text-xl font-bold mt-2">{j.title}</h3>
              <p className="text-sm mt-2">{j.description}</p>
              <p className="text-sm text-muted-foreground mt-2">{j.requirements}</p>
              <Button className="mt-4" onClick={() => { setJob(j); setDone(false); }} data-testid={`apply-btn-${j.id}`}><Briefcase className="h-4 w-4 mr-2" />Lamar</Button>
            </div>
          ))}
        </div>
      </main>
      <Dialog open={!!job} onOpenChange={(o) => !o && setJob(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Lamar: {job?.title}</DialogTitle></DialogHeader>
          {done ? (
            <div className="text-center py-6" data-testid="apply-success">
              <CheckCircle2 className="h-12 w-12 text-[hsl(var(--success))] mx-auto" />
              <p className="mt-3 font-semibold">Lamaran terkirim!</p>
              <p className="text-sm text-muted-foreground">Tim HRD akan menghubungi Anda bila lolos seleksi berkas.</p>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-3">
              <Field label="Nama lengkap"><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="apply-name" /></Field>
              <Field label="Email"><Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="apply-email" /></Field>
              <Field label="No. HP / WhatsApp"><Input required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="apply-phone" /></Field>
              <Field label="Pesan singkat"><Textarea value={form.cover} onChange={(e) => setForm({ ...form, cover: e.target.value })} data-testid="apply-cover" /></Field>
              <Field label="CV (PDF/DOC/JPG, maks 5MB)"><Input type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={(e) => setCv(e.target.files[0])} data-testid="apply-cv" /></Field>
              <Button type="submit" className="w-full" disabled={busy} data-testid="apply-submit">{busy ? "Mengirim…" : "Kirim lamaran"}</Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
