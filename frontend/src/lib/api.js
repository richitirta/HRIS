import axios from "axios";

export const BACKEND = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND}/api`;

export function deviceId() {
  let id = localStorage.getItem("hris_device_id");
  if (!id) {
    id = "WEB-" + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
    localStorage.setItem("hris_device_id", id);
  }
  return id;
}

export const api = axios.create({ baseURL: API });
api.interceptors.request.use((cfg) => {
  const t = localStorage.getItem("hris_token");
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  cfg.headers["X-Device-Id"] = deviceId();
  const k = localStorage.getItem("hris_kiosk_token");
  if (k) cfg.headers["X-Kiosk-Token"] = k;
  return cfg;
});
api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401 && localStorage.getItem("hris_token") && !err.config.url.startsWith("/kiosk")) {
      localStorage.removeItem("hris_token");
      if (!window.location.pathname.startsWith("/login")) window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

export const errMsg = (e) => {
  const d = e?.response?.data?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((x) => x.msg).join(", ");
  return e?.message || "Terjadi kesalahan";
};

export async function openBlob(path, filename) {
  const r = await api.get(path, { responseType: "blob" });
  const url = URL.createObjectURL(r.data);
  if (filename) {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  } else window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export const rupiah = (n) => "Rp " + Math.round(n || 0).toLocaleString("id-ID");
export const fmtDate = (s) => (s ? new Date(s.length <= 10 ? s + "T00:00:00" : s).toLocaleDateString("id-ID", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" }) : "-");
export const fmtTime = (s) => (s ? new Date(s).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }) : "-");
export const fmtDateTime = (s) => (s ? `${fmtDate(s)} ${fmtTime(s)}` : "-");
export const todayWIB = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
export const addDays = (d, n) => {
  const x = new Date(d + "T00:00:00");
  x.setDate(x.getDate() + n);
  return x.toLocaleDateString("en-CA");
};
export const mondayOf = (d) => {
  const x = new Date(d + "T00:00:00");
  const wd = (x.getDay() + 6) % 7;
  return addDays(d, -wd);
};

export const ROLE_LABEL = {
  management: "Management", hrd: "HRD", accounting: "Accounting", purchasing: "Purchasing", spv: "SPV/Manager",
  pic_depan: "PIC Depan", pic_dapur: "PIC Dapur", pic_bar: "PIC Bar", staff: "Staff",
};
export const SEGMENT_LABEL = { depan: "Depan", dapur: "Dapur", bar: "Bar", backoffice: "BackOffice" };
export const PIC_ROLES = ["pic_depan", "pic_dapur", "pic_bar"];
export const isPic = (r) => PIC_ROLES.includes(r);
