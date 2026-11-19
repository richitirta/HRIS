import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errMsg, fmtDateTime } from "@/lib/api";
import { PageHeader, Field, NativeSelect, StatusBadge } from "@/components/common";
import { BranchMap, AddressSearch } from "@/components/MapPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, MapPin, Smartphone, KeyRound } from "lucide-react";

function BranchForm({ init, onDone }) {
  const [f, setF] = useState(init);
  const save = async () => {
    try { f.id ? await api.put(`/branches/${f.id}`, f) : await api.post("/branches", f); toast.success("Cabang disimpan"); onDone(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <div className="space-y-3">
      <Field label="Nama cabang"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="branch-name" /></Field>
      <AddressSearch onPick={(lat, lng, addr) => setF({ ...f, lat, lng, address: f.address || addr })} />
      <BranchMap lat={f.lat} lng={f.lng} radius={f.radius_m} onChange={(lat, lng) => setF({ ...f, lat, lng })} height={260} />
      <p className="text-xs text-muted-foreground">Klik peta atau geser pin untuk titik absensi yang akurat.</p>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Latitude"><Input type="number" step="0.000001" value={f.lat} onChange={(e) => setF({ ...f, lat: Number(e.target.value) })} data-testid="branch-lat" /></Field>
        <Field label="Longitude"><Input type="number" step="0.000001" value={f.lng} onChange={(e) => setF({ ...f, lng: Number(e.target.value) })} data-testid="branch-lng" /></Field>
        <Field label="Radius (m)"><Input type="number" value={f.radius_m} onChange={(e) => setF({ ...f, radius_m: Number(e.target.value) })} data-testid="branch-radius" /></Field>
      </div>
      <Field label="Alamat lengkap"><Textarea value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} data-testid="branch-address" /></Field>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Aktif</label>
      <Button className="w-full" onClick={save} disabled={!f.name} data-testid="branch-save">Simpan cabang</Button>
    </div>
  );
}

export default function Branches() {
  const [branches, setBranches] = useState([]);
  const [masters, setMasters] = useState([]);
  const [form, setForm] = useState(null);
  const [mf, setMf] = useState(null);
  const [code, setCode] = useState(null);
  const load = () => { api.get("/branches").then((r) => setBranches(r.data)); api.get("/master-devices").then((r) => setMasters(r.data)); };
  useEffect(load, []);
  const saveMaster = async () => {
    try { mf.id ? await api.put(`/master-devices/${mf.id}`, mf) : await api.post("/master-devices", mf); setMf(null); load(); } catch (e) { toast.error(errMsg(e)); }
  };
  const activate = async (m) => { const r = await api.post(`/master-devices/${m.id}/activate`); setCode({ name: m.name, token: r.data.kiosk_token }); load(); };
  return (
    <div>
      <PageHeader title="Cabang & HP Master" subtitle="Titik koordinat dan radius menjadi acuan satu-satunya validasi absensi">
        <Button onClick={() => setForm({ name: "", address: "", lat: -7.9666, lng: 112.6326, radius_m: 10, active: true })} data-testid="new-branch-btn"><Plus className="h-4 w-4 mr-1" />Cabang</Button>
      </PageHeader>
      <div className="grid lg:grid-cols-2 gap-5">
        {branches.map((b) => (
          <div key={b.id} className="border rounded-2xl p-4 bg-card space-y-3 rise" data-testid={`branch-card-${b.id}`}>
            <div className="flex justify-between items-start">
              <div><div className="font-bold text-lg">{b.name}</div><div className="text-xs text-muted-foreground">{b.address}</div>
                <div className="text-xs mt-1 font-mono"><MapPin className="h-3 w-3 inline" /> {b.lat.toFixed(6)}, {b.lng.toFixed(6)} · radius {b.radius_m} m</div></div>
              <div className="flex gap-2 items-center"><StatusBadge tone={b.active ? "success" : "muted"}>{b.active ? "Aktif" : "Nonaktif"}</StatusBadge><Button size="sm" variant="outline" onClick={() => setForm(b)} data-testid={`edit-branch-${b.id}`}>Ubah</Button></div>
            </div>
            <BranchMap lat={b.lat} lng={b.lng} radius={b.radius_m} height={200} />
            <div className="space-y-2">
              <div className="flex justify-between items-center"><div className="text-sm font-semibold">HP Master</div><Button size="sm" variant="ghost" onClick={() => setMf({ branch_id: b.id, name: "", active: true })} data-testid={`add-master-${b.id}`}>+ Tambah</Button></div>
              {masters.filter((m) => m.branch_id === b.id).map((m) => (
                <div key={m.id} className="flex items-center justify-between border rounded-lg p-2 text-sm">
                  <span className="flex items-center gap-2"><Smartphone className="h-4 w-4 text-primary" />{m.name}</span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">{m.activated_at ? `Aktif sejak ${fmtDateTime(m.activated_at)}` : "Belum aktivasi"}
                    <Button size="sm" variant="outline" onClick={() => activate(m)} data-testid={`activate-master-${m.id}`}><KeyRound className="h-3.5 w-3.5 mr-1" />Kode aktivasi</Button></span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-w-xl max-h-[92vh] overflow-auto"><DialogHeader><DialogTitle>{form?.id ? "Ubah cabang" : "Cabang baru"}</DialogTitle></DialogHeader>
          {form && <BranchForm init={form} onDone={() => { setForm(null); load(); }} />}
        </DialogContent>
      </Dialog>
      <Dialog open={!!mf} onOpenChange={(o) => !o && setMf(null)}>
        <DialogContent><DialogHeader><DialogTitle>HP Master</DialogTitle></DialogHeader>
          {mf && <div className="space-y-3">
            <Field label="Nama perangkat"><Input value={mf.name} onChange={(e) => setMf({ ...mf, name: e.target.value })} data-testid="master-name" /></Field>
            <Field label="Cabang"><NativeSelect value={mf.branch_id} onChange={(v) => setMf({ ...mf, branch_id: v })} options={branches.map((b) => ({ value: b.id, label: b.name }))} /></Field>
            <Button className="w-full" onClick={saveMaster} disabled={!mf.name} data-testid="master-save">Simpan</Button>
          </div>}
        </DialogContent>
      </Dialog>
      <Dialog open={!!code} onOpenChange={(o) => !o && setCode(null)}>
        <DialogContent><DialogHeader><DialogTitle>Kode aktivasi · {code?.name}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Buka <b>/kiosk</b> di HP Master dan masukkan kode ini. Kode lama otomatis tidak berlaku.</p>
          <div className="font-mono text-lg bg-muted rounded-lg p-4 break-all select-all" data-testid="kiosk-code">{code?.token}</div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
