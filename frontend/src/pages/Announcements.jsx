import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errMsg, fmtDateTime, SEGMENT_LABEL } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PageHeader, Field, Empty, StatusBadge } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Pin, Trash2, Eye } from "lucide-react";

export default function Announcements() {
  const { user } = useAuth();
  const admin = ["management", "hrd"].includes(user.role);
  const [items, setItems] = useState([]);
  const [branches, setBranches] = useState([]);
  const [f, setF] = useState(null);
  const load = () => api.get("/announcements").then((r) => setItems(r.data));
  useEffect(() => { load(); api.get("/branches").then((r) => setBranches(r.data)); }, []);
  const toggle = (k, v) => setF({ ...f, [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] });
  const save = async () => {
    try { await api.post("/announcements", f); setF(null); load(); toast.success("Pengumuman dikirim"); } catch (e) { toast.error(errMsg(e)); }
  };
  const markRead = async (a) => { if (!a.is_read) { await api.post(`/announcements/${a.id}/read`); load(); } };
  return (
    <div className="max-w-3xl">
      <PageHeader title="Pengumuman">
        {admin && <Button onClick={() => setF({ title: "", body: "", branch_ids: [], segments: [], pinned: false })} data-testid="new-ann-btn"><Plus className="h-4 w-4 mr-1" />Buat</Button>}
      </PageHeader>
      <div className="space-y-3" data-testid="ann-list">
        {items.length === 0 && <Empty />}
        {items.map((a) => (
          <div key={a.id} onClick={() => markRead(a)} className={`border rounded-2xl p-5 bg-card cursor-pointer ${a.pinned ? "border-primary/40" : ""} ${a.is_read ? "" : "ring-1 ring-primary/30"}`} data-testid={`ann-${a.id}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="font-semibold text-lg flex items-center gap-2">{a.pinned && <Pin className="h-4 w-4 text-primary" />}{a.title}</div>
              <div className="flex gap-1 items-center">
                {!a.is_read && <StatusBadge tone="primary">Baru</StatusBadge>}
                {admin && <Button size="icon" variant="ghost" onClick={async (e) => { e.stopPropagation(); await api.delete(`/announcements/${a.id}`); load(); }}><Trash2 className="h-4 w-4" /></Button>}
              </div>
            </div>
            <p className="text-sm mt-2 whitespace-pre-line">{a.body}</p>
            <div className="text-xs text-muted-foreground mt-3 flex flex-wrap gap-3">
              <span>{a.author} · {fmtDateTime(a.created_at)}</span>
              <span>Untuk: {a.branch_ids.length ? a.branch_ids.map((b) => branches.find((x) => x.id === b)?.name).join(", ") : "Semua cabang"} · {a.segments.length ? a.segments.map((s) => SEGMENT_LABEL[s]).join(", ") : "Semua segmen"}</span>
              {admin && <span className="flex items-center gap-1"><Eye className="h-3 w-3" />Dibaca {a.read_count}</span>}
            </div>
          </div>
        ))}
      </div>
      <Dialog open={!!f} onOpenChange={(o) => !o && setF(null)}>
        <DialogContent><DialogHeader><DialogTitle>Pengumuman baru</DialogTitle></DialogHeader>
          {f && <div className="space-y-3">
            <Field label="Judul"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} data-testid="ann-title" /></Field>
            <Field label="Isi"><Textarea rows={5} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} data-testid="ann-body" /></Field>
            <div className="text-sm font-medium">Cabang (kosong = semua)</div>
            <div className="flex flex-wrap gap-2">{branches.map((b) => <Button key={b.id} size="sm" type="button" variant={f.branch_ids.includes(b.id) ? "default" : "outline"} onClick={() => toggle("branch_ids", b.id)}>{b.name}</Button>)}</div>
            <div className="text-sm font-medium">Segmen (kosong = semua)</div>
            <div className="flex flex-wrap gap-2">{Object.entries(SEGMENT_LABEL).map(([k, l]) => <Button key={k} size="sm" type="button" variant={f.segments.includes(k) ? "default" : "outline"} onClick={() => toggle("segments", k)}>{l}</Button>)}</div>
            <label className="flex gap-2 text-sm"><input type="checkbox" checked={f.pinned} onChange={(e) => setF({ ...f, pinned: e.target.checked })} data-testid="ann-pinned" />Pin di atas</label>
            <Button className="w-full" disabled={!f.title || !f.body} onClick={save} data-testid="ann-save">Kirim pengumuman</Button>
          </div>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
