import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { useTheme } from "next-themes";
import {
  LayoutDashboard, MapPin, CalendarDays, FileText, Banknote, CheckSquare, Award, Megaphone, ClipboardCheck, Users,
  Building2, Settings, ScrollText, UserPlus, ShoppingCart, Bell, Moon, Sun, LogOut, Menu, Camera, Home, ListChecks, User,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { api, ROLE_LABEL, fmtDateTime } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const ALL = null;
const NAV = [
  { group: "Operasional", items: [
    { to: "/", label: "Dashboard", icon: LayoutDashboard, roles: ALL },
    { to: "/absensi", label: "Absensi Saya", icon: MapPin, roles: ALL },
    { to: "/tasks", label: "Task & Proyek", icon: CheckSquare, roles: ALL },
    { to: "/laporan-harian", label: "Laporan Harian", icon: ClipboardCheck, roles: ["management", "hrd", "spv", "accounting", "pic_depan", "pic_dapur", "pic_bar"] },
    { to: "/pengumuman", label: "Pengumuman", icon: Megaphone, roles: ALL },
  ]},
  { group: "SDM & Kehadiran", items: [
    { to: "/jadwal", label: "Jadwal Shift", icon: CalendarDays, roles: ALL },
    { to: "/requests", label: "Request PH/Cuti/Lembur", icon: FileText, roles: ALL },
    { to: "/rekap-absensi", label: "Rekap Absensi", icon: ListChecks, roles: ["management", "hrd", "spv", "accounting", "pic_depan", "pic_dapur", "pic_bar"] },
    { to: "/kpi", label: "KPI", icon: Award, roles: ALL },
    { to: "/payroll", label: "Penggajian", icon: Banknote, roles: ALL },
  ]},
  { group: "Administrasi", items: [
    { to: "/rekrutmen", label: "Rekrutmen", icon: UserPlus, roles: ["management", "hrd"] },
    { to: "/karyawan", label: "Karyawan & Device", icon: Users, roles: ["management", "hrd"] },
    { to: "/cabang", label: "Cabang & HP Master", icon: Building2, roles: ["management", "hrd"] },
    { to: "/purchasing", label: "Purchasing", icon: ShoppingCart, roles: ["management", "purchasing"] },
    { to: "/pengaturan", label: "Pengaturan", icon: Settings, roles: ["management", "hrd", "accounting"] },
    { to: "/audit-log", label: "Audit Log", icon: ScrollText, roles: ["management", "hrd"] },
  ]},
];

const slug = (to) => (to === "/" ? "dashboard" : to.slice(1));

function NavList({ role, onNav }) {
  return (
    <nav className="space-y-5">
      {NAV.map((g) => {
        const items = g.items.filter((i) => !i.roles || i.roles.includes(role));
        if (!items.length) return null;
        return (
          <div key={g.group}>
            <div className="px-3 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{g.group}</div>
            {items.map((i) => (
              <NavLink key={i.to} to={i.to} end={i.to === "/"} onClick={onNav} data-testid={`nav-${slug(i.to)}`}
                className={({ isActive }) => `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${isActive ? "bg-primary text-primary-foreground" : "hover:bg-accent text-foreground/80"}`}>
                <i.icon className="h-4 w-4 shrink-0" /> {i.label}
              </NavLink>
            ))}
          </div>
        );
      })}
    </nav>
  );
}

function Bell_() {
  const [data, setData] = useState({ items: [], unread: 0 });
  const nav = useNavigate();
  const load = () => api.get("/notifications").then((r) => setData(r.data)).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);
  return (
    <Popover onOpenChange={(o) => { if (!o && data.unread) api.post("/notifications/read-all").then(load); }}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" data-testid="notif-bell">
          <Bell className="h-5 w-5" />
          {data.unread > 0 && <span data-testid="notif-count" className="absolute -top-0.5 -right-0.5 bg-destructive text-white text-[10px] rounded-full h-4 min-w-4 px-1 grid place-items-center">{data.unread}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="px-4 py-3 border-b font-semibold text-sm">Notifikasi</div>
        <div className="max-h-96 overflow-auto" data-testid="notif-list">
          {data.items.length === 0 && <div className="p-4 text-sm text-muted-foreground">Tidak ada notifikasi</div>}
          {data.items.map((n) => (
            <button key={n.id} onClick={() => n.link && nav(n.link)} className={`w-full text-left px-4 py-3 border-b last:border-0 hover:bg-accent ${n.read ? "" : "bg-primary/5"}`}>
              <div className="text-sm font-medium">{n.title}</div>
              {n.body && <div className="text-xs text-muted-foreground line-clamp-2">{n.body}</div>}
              <div className="text-[11px] text-muted-foreground mt-1">{fmtDateTime(n.at)}</div>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

const BOTTOM = [
  { to: "/", label: "Beranda", icon: Home },
  { to: "/jadwal", label: "Jadwal", icon: CalendarDays },
  { to: "/absensi", label: "Absen", icon: Camera, fab: true },
  { to: "/requests", label: "Ajukan", icon: FileText },
  { to: "/profil", label: "Profil", icon: User },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const { resolvedTheme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const loc = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);
  const ThemeBtn = (
    <Button variant="ghost" size="icon" data-testid="theme-toggle" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
      {resolvedTheme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </Button>
  );
  const Brand = (
    <div className="flex items-center gap-2.5 px-3">
      <div className="h-9 w-9 rounded-xl bg-primary text-primary-foreground grid place-items-center font-extrabold">R</div>
      <div>
        <div className="font-bold leading-tight">RestoHRIS</div>
        <div className="text-[11px] text-muted-foreground">El Pico · Pahlawan Trip</div>
      </div>
    </div>
  );
  return (
    <div className="min-h-screen flex">
      <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r bg-card sticky top-0 h-screen">
        <div className="py-5">{Brand}</div>
        <div className="flex-1 overflow-auto px-3 pb-4"><NavList role={user.role} /></div>
        <div className="border-t p-3 flex items-center gap-2">
          <button onClick={() => nav("/profil")} className="flex-1 text-left min-w-0" data-testid="sidebar-profile">
            <div className="text-sm font-semibold truncate">{user.name}</div>
            <div className="text-xs text-muted-foreground">{ROLE_LABEL[user.role]}</div>
          </button>
          <Button variant="ghost" size="icon" onClick={() => { logout(); nav("/login"); }} data-testid="logout-btn"><LogOut className="h-4 w-4" /></Button>
        </div>
      </aside>
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 h-14 border-b bg-background/80 backdrop-blur-xl flex items-center gap-2 px-3 sm:px-6">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" data-testid="mobile-menu-btn"><Menu className="h-5 w-5" /></Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 overflow-auto">
              <SheetTitle className="sr-only">Menu</SheetTitle>
              <div className="mb-5">{Brand}</div>
              <NavList role={user.role} onNav={() => setOpen(false)} />
              <Button variant="outline" className="w-full mt-6" onClick={() => { logout(); nav("/login"); }} data-testid="mobile-logout-btn"><LogOut className="h-4 w-4 mr-2" />Keluar</Button>
            </SheetContent>
          </Sheet>
          <div className="lg:hidden font-bold">RestoHRIS</div>
          <div className="flex-1" />
          <span className="hidden sm:inline text-xs text-muted-foreground mr-2">{ROLE_LABEL[user.role]} · WIB</span>
          {ThemeBtn}
          <Bell_ />
        </header>
        <main className="flex-1 px-4 sm:px-6 lg:px-10 py-6 pb-28 lg:pb-10 max-w-[1400px] w-full mx-auto">
          <Outlet />
        </main>
      </div>
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t bg-card/95 backdrop-blur-xl grid grid-cols-5 h-16">
        {BOTTOM.map((b) => (
          <NavLink key={b.to} to={b.to} end={b.to === "/"} data-testid={`bottom-nav-${slug(b.to)}`}
            className={({ isActive }) => `flex flex-col items-center justify-center text-[11px] gap-0.5 ${isActive ? "text-primary font-semibold" : "text-muted-foreground"}`}>
            {b.fab ? (
              <span className="-mt-7 h-14 w-14 rounded-full bg-primary text-primary-foreground grid place-items-center shadow-lg shadow-primary/30"><b.icon className="h-6 w-6" /></span>
            ) : <b.icon className="h-5 w-5" />}
            {b.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
