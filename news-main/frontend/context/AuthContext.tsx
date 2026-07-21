import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

interface ReporterState {
  isReporter: boolean;
  reporterName: string;
  reporterToken: string | null;
}

interface AuthContextType {
  isLoggedIn: boolean;
  setIsLoggedIn: (value: boolean) => void;
  logout: () => void;
  reporter: ReporterState;
  refreshReporterAuth: () => Promise<void>;
  clearReporterAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  isLoggedIn: false,
  setIsLoggedIn: () => {},
  logout: () => {},
  reporter: { isReporter: false, reporterName: '', reporterToken: null },
  refreshReporterAuth: async () => {},
  clearReporterAuth: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isLoggedIn, setIsLoggedInState] = useState(false);
  const [reporter, setReporter] = useState<ReporterState>({
    isReporter: false,
    reporterName: '',
    reporterToken: null,
  });

  const setIsLoggedIn = (value: boolean) => {
    setIsLoggedInState(value);
    AsyncStorage.setItem('wp_logged_in', String(value));
  };

  const logout = () => {
    setIsLoggedIn(false);
  };

  // Verify stored JWT and update reporter state
  const refreshReporterAuth = useCallback(async () => {
    try {
      const token     = await AsyncStorage.getItem('reporter_jwt_token');
      const savedName = (await AsyncStorage.getItem('reporter_name')) || '';

      if (!token) {
        setReporter({ isReporter: false, reporterName: '', reporterToken: null });
        return;
      }

      // Quick local expiry check
      try {
        const base64Payload = token.split('.')[1] || '';
        const padded = base64Payload + '='.repeat((4 - base64Payload.length % 4) % 4);
        const payload = JSON.parse(atob(padded.replace(/-/g, '+').replace(/_/g, '/')));
        if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
          await AsyncStorage.multiRemove(['reporter_jwt_token', 'reporter_unlocked_v1']);
          setReporter({ isReporter: false, reporterName: '', reporterToken: null });
          return;
        }
      } catch { /* decode failed — let backend decide */ }

      // Verify with backend
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(`${BACKEND_URL}/api/verify-reporter-token`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (res.ok) {
          const data = await res.json();
          setReporter({
            isReporter: true,
            reporterName: data.reporter_name || savedName,
            reporterToken: token,
          });
        } else {
          await AsyncStorage.multiRemove(['reporter_jwt_token', 'reporter_unlocked_v1']);
          setReporter({ isReporter: false, reporterName: '', reporterToken: null });
        }
      } catch {
        // Network error — use local state (offline-tolerant)
        setReporter({ isReporter: true, reporterName: savedName, reporterToken: token });
      }
    } catch {
      setReporter({ isReporter: false, reporterName: '', reporterToken: null });
    }
  }, []);

  const clearReporterAuth = useCallback(async () => {
    await AsyncStorage.multiRemove(['reporter_jwt_token', 'reporter_unlocked_v1']);
    setReporter({ isReporter: false, reporterName: '', reporterToken: null });
  }, []);

  useEffect(() => {
    AsyncStorage.getItem('wp_logged_in').then(val => {
      if (val === 'true') setIsLoggedInState(true);
    });
    refreshReporterAuth();
  }, []);

  return (
    <AuthContext.Provider
      value={{ isLoggedIn, setIsLoggedIn, logout, reporter, refreshReporterAuth, clearReporterAuth }}
    >
      {children}
    </AuthContext.Provider>
  );
}
