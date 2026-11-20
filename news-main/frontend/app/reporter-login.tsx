import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
  StatusBar,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';

const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL || 'https://public-samachar-api.onrender.com';
const REPORTER_UNLOCK_KEY = 'reporter_unlocked_v1';

export default function ReporterLoginScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ expired?: string; returnTo?: string }>();
  const expired  = params.expired === 'true';
  const returnTo = params.returnTo || '';

  const [username, setUsername]         = useState('');
  const [password, setPassword]         = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading]           = useState(false);
  const [errorMsg, setErrorMsg]         = useState('');

  // Pre-fill saved reporter username or name
  useEffect(() => {
    AsyncStorage.getItem('reporter_username').then(u => {
      if (u) {
        setUsername(u);
      } else {
        AsyncStorage.getItem('reporter_name').then(n => {
          if (n) setUsername(n);
        }).catch(() => {});
      }
    }).catch(() => {});
  }, []);

  const handleLogin = useCallback(async () => {
    const user = username.trim().toLowerCase();
    const pass = password.trim();

    if (!user) {
      setErrorMsg('Please enter your username.');
      return;
    }
    if (!pass) {
      setErrorMsg('Please enter your password.');
      return;
    }

    setLoading(true);
    setErrorMsg('');

    try {
      const res = await fetch(`${BACKEND}/api/reporter-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password: pass }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const detail = data?.detail || 'Login failed. Please check your username and password.';
        setErrorMsg(detail);
        setLoading(false);
        return;
      }

      // ── Store JWT & reporter info ──────────────────────────────────────────
      await AsyncStorage.setItem('reporter_jwt_token', data.token);
      await AsyncStorage.setItem('reporter_name', data.full_name || data.reporter_name || user);
      await AsyncStorage.setItem('reporter_username', data.username || user);
      await AsyncStorage.setItem('reporter_district', data.district || 'Karnataka');
      if (data.role) {
        await AsyncStorage.setItem('reporter_role', data.role);
      }
      await AsyncStorage.setItem(REPORTER_UNLOCK_KEY, 'true');

      // Navigate back
      if (returnTo) {
        router.replace(returnTo as any);
      } else if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/(tabs)/user' as any);
      }
    } catch {
      setErrorMsg('Connection failed. Please check your internet and try again.');
    }

    setLoading(false);
  }, [username, password, returnTo, router]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar barStyle="light-content" backgroundColor="#0A1628" />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Header ───────────────────────────────────────────────────── */}
          <View style={styles.header}>
            {router.canGoBack() && (
              <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
                <MaterialIcons name="arrow-back" size={22} color="#fff" />
              </TouchableOpacity>
            )}
            <Text style={styles.headerTitle}>Reporter Login</Text>
            <View style={{ width: 40 }} />
          </View>

          {/* ── Session-expired banner ────────────────────────────────────── */}
          {expired && (
            <View style={styles.expiredBanner}>
              <MaterialIcons name="warning" size={18} color="#FF8A65" />
              <Text style={styles.expiredText}>
                Session expired. Please login again.
              </Text>
            </View>
          )}

          {/* ── Logo ─────────────────────────────────────────────────────── */}
          <View style={styles.logoSection}>
            <View style={styles.logoCircle}>
              <MaterialIcons name="verified" size={44} color="#1AAA94" />
            </View>
            <Text style={styles.appName}>Public Samachar</Text>
            <Text style={styles.appSub}>Reporter Portal</Text>
          </View>

          {/* ── Form card ────────────────────────────────────────────────── */}
          <View style={styles.card}>
            <Text style={styles.fieldLabel}>Reporter Username</Text>
            <View style={styles.inputRow}>
              <MaterialIcons name="person" size={18} color="#1AAA94" />
              <TextInput
                testID="reporter-username-input"
                style={styles.input}
                value={username}
                onChangeText={t => { setUsername(t); setErrorMsg(''); }}
                placeholder="e.g. sharanappa.g or girish.p.s"
                placeholderTextColor="#888"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
                blurOnSubmit={false}
              />
            </View>

            <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Password</Text>
            <View style={styles.inputRow}>
              <MaterialIcons name="lock" size={18} color="#1AAA94" />
              <TextInput
                testID="reporter-password-input"
                style={styles.input}
                value={password}
                onChangeText={t => { setPassword(t); setErrorMsg(''); }}
                placeholder="Enter your password..."
                placeholderTextColor="#888"
                autoCapitalize="none"
                secureTextEntry={!showPassword}
                returnKeyType="done"
                onSubmitEditing={handleLogin}
              />
              <TouchableOpacity
                testID="toggle-password-visibility"
                onPress={() => setShowPassword(v => !v)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                style={{ paddingHorizontal: 6 }}
              >
                <MaterialIcons
                  name={showPassword ? 'visibility' : 'visibility-off'}
                  size={20}
                  color="#888"
                />
              </TouchableOpacity>
            </View>

            {/* Error message */}
            {!!errorMsg && (
              <View style={styles.errorBox}>
                <MaterialIcons name="error-outline" size={16} color="#F44336" />
                <Text style={styles.errorText}>{errorMsg}</Text>
              </View>
            )}

            {/* Login button */}
            <TouchableOpacity
              style={[styles.loginBtn, loading && { opacity: 0.65 }]}
              onPress={handleLogin}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <MaterialIcons name="login" size={20} color="#fff" />
                  <Text style={styles.loginBtnText}>Login as Reporter</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {/* ── Footer note ──────────────────────────────────────────────── */}
          <Text style={styles.footerNote}>
            Contact your editor for reporter login credentials.{'\n'}
            Your session stays active for 90 days.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0A1628',
  },
  scroll: {
    paddingBottom: 64,
  },

  // ── Header ──────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#fff',
  },

  // ── Expired banner ───────────────────────────────────────────────────────
  expiredBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,138,101,0.15)',
    borderRadius: 12,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,138,101,0.35)',
  },
  expiredText: {
    color: '#FF8A65',
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },

  // ── Logo ─────────────────────────────────────────────────────────────────
  logoSection: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  logoCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: '#E6F7F3',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    shadowColor: '#1AAA94',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  appName: {
    fontSize: 24,
    fontWeight: '900',
    color: '#fff',
    marginBottom: 4,
  },
  appSub: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.5)',
  },

  // ── Form card ─────────────────────────────────────────────────────────────
  card: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 20,
    marginHorizontal: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.65)',
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.09)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: '#fff',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(244,67,54,0.12)',
    borderRadius: 10,
    padding: 10,
    marginTop: 14,
    borderWidth: 1,
    borderColor: 'rgba(244,67,54,0.3)',
  },
  errorText: {
    color: '#F44336',
    fontSize: 13,
    flex: 1,
    lineHeight: 18,
  },
  loginBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#1AAA94',
    borderRadius: 30,
    paddingVertical: 15,
    marginTop: 20,
    elevation: 4,
    shadowColor: '#1AAA94',
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  loginBtnText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 16,
  },

  // ── Footer ────────────────────────────────────────────────────────────────
  footerNote: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.38)',
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 22,
    paddingHorizontal: 32,
  },
});
