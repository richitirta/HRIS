import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { errMsg, deviceId } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/common";
import { Loader2, Smartphone, Briefcase, MonitorSmartphone } from "lucide-react";

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(email, password);
      nav("/");
    } catch (err) {
      setError(errMsg(err));
      toast.error(errMsg(err));
    }
    setBusy(false);
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between p-12 bg-[hsl(224_25%_10%)] text-white relative overflow-hidden">
        <div className="absolute inset-0 grain opacity-60" />
        <div className="relative flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-primary grid place-items-center font-extrabold text-lg">R</div>
          <div className="font-bold text-lg">RestoHRIS</div>
        </div>
        <div className="relative max-w-md">
          <h1 className="text-4xl xl:text-5xl font-extrabold leading-tight">Satu sistem untuk seluruh tim dapur, bar & depan.</h1>
          <p className="mt-4 text-white/70">Absensi radius cabang + verifikasi wajah, jadwal 5 shift, lembur, penggajian, KPI, dan laporan harian PIC — El Pico & Pahlawan Trip.</p>
        </div>
        <div className="relative text-xs text-white/50">Zona waktu WIB · Rupiah (IDR)</div>
      </div>
      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-5 rise" data-testid="login-form">
          <div className="lg:hidden flex items-center gap-2 mb-2">
            <div className="h-10 w-10 rounded-xl bg-primary text-primary-foreground grid place-items-center font-extrabold">R</div>
            <div className="font-bold text-lg">RestoHRIS</div>
          </div>
          <div>
            <h2 className="text-2xl font-bold">Masuk</h2>
            <p className="text-sm text-muted-foreground">Gunakan akun yang diberikan HRD.</p>
          </div>
          <Field label="Email"><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} data-testid="login-email-input" /></Field>
          <Field label="Password"><Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} data-testid="login-password-input" /></Field>
          {error && <div className="text-sm text-destructive bg-destructive/10 rounded-lg p-3" data-testid="login-error">{error}</div>}
          <Button type="submit" className="w-full h-11" disabled={busy} data-testid="login-submit-button">
            {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Masuk
          </Button>
          <div className="text-xs text-muted-foreground flex items-start gap-2 bg-muted rounded-lg p-3">
            <Smartphone className="h-4 w-4 shrink-0 mt-0.5" />
            <span>1 akun hanya untuk 1 HP. Login pertama otomatis mendaftarkan HP ini. ID perangkat: <span className="font-mono break-all" data-testid="device-id">{deviceId()}</span></span>
          </div>
          <div className="flex justify-between text-sm">
            <Link to="/karir" className="text-primary font-medium flex items-center gap-1" data-testid="careers-link"><Briefcase className="h-4 w-4" />Lowongan kerja</Link>
            <Link to="/kiosk" className="text-muted-foreground flex items-center gap-1" data-testid="kiosk-link"><MonitorSmartphone className="h-4 w-4" />Mode HP Master</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
