import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errMsg, ROLE_LABEL } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PageHeader, Field, NativeSelect } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Trash2, Plus } from "lucide-react";

function Row({ label, hint, children }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-3 border-b last:border-0">
      <div><div className="text-sm font-medium">{label}</div>{hint && <div className="text-xs text-muted-foreground">{hint}</div>}</div>
      <div className="sm:w-56">{children}</div>
    </div>
  );
}

export default function SettingsPage() {
  const { user } = useAuth();
  const [s, setS] = useState(null);
  useEffect(() => { api.get("/settings").then((r) => setS(r.data)); }, []);
  if (!s) return null;
  const acc = user.role === "accounting";
  const num = (k) => <Input type="number" step="any" value={s[k]} onChange={(e) => setS({ ...s, [k]: Number(e.target.value) })} disabled={acc && k !== "payroll_divisor"} data-testid={`set-${k}`} />;
  const tax = s.tax;
  const setComp = (i, patch) => setS({ ...s, tax: { ...tax, components: tax.components.map((c, j) => (j === i ? { ...c, ...patch } : c)) } });
  const save = async () => {
    try { const r = await api.put("/settings", s); setS(r.data); toast.success("Pengaturan disimpan"); } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Pengaturan" subtitle="Semua aturan [asumsi] & [menunggu konfirmasi] dapat diubah di sini">
        <Button onClick={save} data-testid="settings-save">Simpan</Button>
      </PageHeader>
      {!acc && (
        <section className="border rounded-2xl p-5 bg-card">
          <h3 className="font-semibold mb-2">Absensi, lembur & jadwal</h3>
          <Row label="Lembur hanya dihitung jika ada request disetujui" hint="[asumsi] on/off"><Switch checked={s.overtime_requires_approval} onCheckedChange={(v) => setS({ ...s, overtime_requires_approval: v })} data-testid="set-ot-approval" /></Row>
          <Row label="Durasi 1 blok lembur (menit)">{num("ot_block_minutes")}</Row>
          <Row label="Toleransi telat (menit)">{num("late_grace_minutes")}</Row>
          <Row label="Jadwal maksimal ke depan (hari)">{num("schedule_max_days_ahead")}</Row>
          <Row label="Ambang kecocokan wajah" hint="jarak maks. (lebih kecil = lebih ketat)">{num("face_threshold")}</Row>
          <Row label="Jam pengingat laporan harian (WIB)">{num("daily_report_reminder_hour")}</Row>
          <Row label="Role yang wajib 1 akun = 1 HP" hint="Device binding">
            <div className="flex flex-wrap gap-1">{Object.keys(ROLE_LABEL).map((r) => (
              <button key={r} onClick={() => setS({ ...s, device_binding_roles: s.device_binding_roles.includes(r) ? s.device_binding_roles.filter((x) => x !== r) : [...s.device_binding_roles, r] })}
                className={`text-[11px] px-2 py-1 rounded-md border ${s.device_binding_roles.includes(r) ? "bg-primary text-primary-foreground border-primary" : ""}`}>{ROLE_LABEL[r]}</button>
            ))}</div>
          </Row>
        </section>
      )}
      {!acc && (
        <section className="border rounded-2xl p-5 bg-card">
          <h3 className="font-semibold mb-2">Approval & KPI</h3>
          <Row label="Cuti ≥ N hari wajib approval Management">{num("mgmt_min_cuti_days")}</Row>
          <Row label="Jenis request yang selalu ke Management">
            <div className="flex gap-1">{["ph", "cuti", "lembur"].map((t) => (
              <button key={t} onClick={() => setS({ ...s, mgmt_required_types: s.mgmt_required_types.includes(t) ? s.mgmt_required_types.filter((x) => x !== t) : [...s.mgmt_required_types, t] })}
                className={`text-xs px-2 py-1 rounded-md border uppercase ${s.mgmt_required_types.includes(t) ? "bg-primary text-primary-foreground border-primary" : ""}`}>{t}</button>
            ))}</div>
          </Row>
          <Row label="Bobot task terverifikasi pada skor KPI" hint="0–1 (mis. 0.3 = 30%)">{num("kpi_task_weight")}</Row>
          <Row label="Kuota cuti default / tahun">{num("default_leave_quota")}</Row>
        </section>
      )}
      <section className="border rounded-2xl p-5 bg-card space-y-3">
        <h3 className="font-semibold">Penggajian & pajak</h3>
        <Row label="Pembagi prorata gaji pokok" hint="Potongan = gaji pokok / N × hari tidak masuk">{num("payroll_divisor")}</Row>
        <Row label="Aktifkan komponen pajak" hint="[menunggu konfirmasi Finance]"><Switch checked={tax.enabled} onCheckedChange={(v) => setS({ ...s, tax: { ...tax, enabled: v } })} data-testid="set-tax-enabled" /></Row>
        {tax.components.map((c, i) => (
          <div key={i} className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end border rounded-lg p-3">
            <Field label="Nama"><Input value={c.name} onChange={(e) => setComp(i, { name: e.target.value })} /></Field>
            <Field label="Tipe"><NativeSelect value={c.type} onChange={(v) => setComp(i, { type: v })} options={[{ value: "percent", label: "% dari bruto" }, { value: "fixed", label: "Nominal tetap" }, { value: "formula", label: "Rumus" }]} /></Field>
            {c.type === "formula" ? <Field label="Rumus (gross, base, allowance)"><Input value={c.formula} placeholder="max(0, gross-4500000)*0.05" onChange={(e) => setComp(i, { formula: e.target.value })} /></Field>
              : <Field label="Nilai"><Input type="number" value={c.value} onChange={(e) => setComp(i, { value: Number(e.target.value) })} /></Field>}
            <Field label="Berlaku"><NativeSelect value={c.applies_to} onChange={(v) => setComp(i, { applies_to: v })} options={[{ value: "monthly", label: "Bulanan" }, { value: "weekly", label: "Mingguan" }, { value: "both", label: "Keduanya" }]} /></Field>
            <Button variant="ghost" onClick={() => setS({ ...s, tax: { ...tax, components: tax.components.filter((_, j) => j !== i) } })}><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => setS({ ...s, tax: { ...tax, components: [...tax.components, { name: "Komponen baru", type: "percent", value: 0, applies_to: "monthly", formula: "" }] } })} data-testid="add-tax-component"><Plus className="h-4 w-4 mr-1" />Komponen pajak</Button>
      </section>
    </div>
  );
}
