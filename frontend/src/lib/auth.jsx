import { createContext, useContext, useEffect, useState } from "react";
import { api, deviceId } from "@/lib/api";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    if (!localStorage.getItem("hris_token")) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const r = await api.get("/auth/me");
      setUser(r.data);
    } catch {
      setUser(null);
    }
    setLoading(false);
  };

  useEffect(() => {
    refresh();
  }, []);

  const login = async (email, password) => {
    const r = await api.post("/auth/login", { email, password, device_id: deviceId(), device_info: navigator.userAgent.slice(0, 120) });
    localStorage.setItem("hris_token", r.data.token);
    setUser(r.data.user);
    return r.data.user;
  };

  const logout = () => {
    localStorage.removeItem("hris_token");
    setUser(null);
  };

  return <AuthCtx.Provider value={{ user, loading, login, logout, refresh }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);

export const can = (user, ...roles) => !!user && roles.includes(user.role);
