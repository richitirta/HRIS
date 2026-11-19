import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/lib/auth";
import Layout from "@/components/Layout";
import Login from "@/pages/Login";
import Careers from "@/pages/Careers";
import Kiosk from "@/pages/Kiosk";
import Dashboard from "@/pages/Dashboard";
import Attendance from "@/pages/Attendance";
import AttendanceRecap from "@/pages/AttendanceRecap";
import Schedule from "@/pages/Schedule";
import Requests from "@/pages/Requests";
import Payroll from "@/pages/Payroll";
import Recruitment from "@/pages/Recruitment";
import Kpi from "@/pages/Kpi";
import Tasks from "@/pages/Tasks";
import Announcements from "@/pages/Announcements";
import DailyReports from "@/pages/DailyReports";
import Employees from "@/pages/Employees";
import Branches from "@/pages/Branches";
import SettingsPage from "@/pages/Settings";
import AuditLog from "@/pages/AuditLog";
import Purchasing from "@/pages/Purchasing";
import Profile from "@/pages/Profile";

function Protected({ roles, children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen grid place-items-center text-muted-foreground">Memuat…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

const ADM = ["management", "hrd"];
const REPORT_ROLES = ["management", "hrd", "spv", "accounting", "pic_depan", "pic_dapur", "pic_bar"];

function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      <div className="App">
        <BrowserRouter>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/karir" element={<Careers />} />
              <Route path="/kiosk" element={<Kiosk />} />
              <Route element={<Protected><Layout /></Protected>}>
                <Route index element={<Dashboard />} />
                <Route path="absensi" element={<Attendance />} />
                <Route path="rekap-absensi" element={<Protected roles={REPORT_ROLES}><AttendanceRecap /></Protected>} />
                <Route path="jadwal" element={<Schedule />} />
                <Route path="requests" element={<Requests />} />
                <Route path="payroll" element={<Payroll />} />
                <Route path="rekrutmen" element={<Protected roles={ADM}><Recruitment /></Protected>} />
                <Route path="kpi" element={<Kpi />} />
                <Route path="tasks" element={<Tasks />} />
                <Route path="pengumuman" element={<Announcements />} />
                <Route path="laporan-harian" element={<Protected roles={REPORT_ROLES}><DailyReports /></Protected>} />
                <Route path="karyawan" element={<Protected roles={ADM}><Employees /></Protected>} />
                <Route path="cabang" element={<Protected roles={ADM}><Branches /></Protected>} />
                <Route path="pengaturan" element={<Protected roles={[...ADM, "accounting"]}><SettingsPage /></Protected>} />
                <Route path="audit-log" element={<Protected roles={ADM}><AuditLog /></Protected>} />
                <Route path="purchasing" element={<Protected roles={["management", "purchasing"]}><Purchasing /></Protected>} />
                <Route path="profil" element={<Profile />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
        <Toaster position="top-center" richColors />
      </div>
    </ThemeProvider>
  );
}

export default App;
