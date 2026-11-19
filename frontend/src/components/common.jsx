import { Badge } from "@/components/ui/badge";

const TONES = {
  success: "bg-[hsl(var(--success)/0.12)] text-[hsl(var(--success))] border-[hsl(var(--success)/0.3)]",
  warning: "bg-[hsl(var(--warning)/0.14)] text-[hsl(var(--warning))] border-[hsl(var(--warning)/0.3)]",
  danger: "bg-destructive/10 text-destructive border-destructive/30",
  info: "bg-[hsl(var(--info)/0.12)] text-[hsl(var(--info))] border-[hsl(var(--info)/0.3)]",
  muted: "bg-muted text-muted-foreground border-border",
  primary: "bg-primary/10 text-primary border-primary/30",
};

const STATUS_TONE = {
  hadir: "success", telat: "warning", menunggu: "warning", disetujui: "success", ditolak: "danger", dibatalkan: "muted",
  pending: "muted", on_progress: "info", done: "primary", closed: "success", scheduled: "info", draft: "muted", locked: "warning",
  approved: "success", belum: "muted", diverifikasi_spv: "info", masuk: "info", interview: "warning", seleksi: "primary",
  offering: "warning", diterima: "success",
};

export const STATUS_LABEL = {
  pending: "Pending", on_progress: "On Progress", done: "Sudah Dikerjakan", closed: "Closed", scheduled: "Terjadwal",
  draft: "Draft", locked: "Terkunci (Accounting)", approved: "Disetujui Management", hadir: "Hadir", telat: "Telat",
  menunggu: "Menunggu", disetujui: "Disetujui", ditolak: "Ditolak", dibatalkan: "Dibatalkan", belum: "Belum diverifikasi",
  diverifikasi_spv: "Diverifikasi SPV", masuk: "Pelamar Masuk", interview: "Interview", seleksi: "Seleksi", offering: "Offering", diterima: "Diterima",
};

export function StatusBadge({ status, tone, children, testid }) {
  return (
    <Badge variant="outline" data-testid={testid} className={`font-medium whitespace-nowrap ${TONES[tone || STATUS_TONE[status] || "muted"]}`}>
      {children || STATUS_LABEL[status] || status}
    </Badge>
  );
}

export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-6 rise">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight" data-testid="page-title">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

export function Empty({ text = "Belum ada data" }) {
  return <div className="text-sm text-muted-foreground border border-dashed rounded-lg p-8 text-center" data-testid="empty-state">{text}</div>;
}

export function Stat({ label, value, hint, tone = "", testid }) {
  return (
    <div className={`rounded-xl border bg-card p-4 rise ${tone}`} data-testid={testid}>
      <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
      {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}

export function Field({ label, children }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

export function NativeSelect({ value, onChange, options, testid, className = "" }) {
  return (
    <select
      data-testid={testid}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      className={`h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring ${className}`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}
