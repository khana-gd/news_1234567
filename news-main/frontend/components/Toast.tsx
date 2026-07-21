/**
 * Toast — global lightweight in-app notification system
 * Replaces Alert.alert() throughout the app for a modern, non-blocking feel.
 *
 * Usage:
 *   import { showToast } from '@/components/Toast';
 *   showToast('Saved successfully');                   // info
 *   showToast('Failed to save', 'error');              // error
 *   showToast('Follow added', 'success');              // success
 *
 * Mount <ToastHost /> once at the very top of your app tree (in _layout.tsx).
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Animated, TouchableOpacity,
  Dimensions, Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { BRAND } from '../constants/theme';

export type ToastKind = 'info' | 'success' | 'error' | 'warning';

type ToastMsg = {
  id: number;
  text: string;
  kind: ToastKind;
  duration: number;
};

const listeners = new Set<(m: ToastMsg) => void>();
let nextId = 1;

export function showToast(text: string, kind: ToastKind = 'info', duration = 2400) {
  const msg: ToastMsg = { id: nextId++, text, kind, duration };
  listeners.forEach(fn => fn(msg));
}

const KIND_STYLE: Record<ToastKind, { bg: string; icon: keyof typeof MaterialIcons.glyphMap }> = {
  info:    { bg: BRAND.primaryDark, icon: 'info-outline' },
  success: { bg: BRAND.success,     icon: 'check-circle' },
  error:   { bg: BRAND.danger,      icon: 'error-outline' },
  warning: { bg: BRAND.warning,     icon: 'warning-amber' },
};

export function ToastHost() {
  const [current, setCurrent] = useState<ToastMsg | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(20)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const listener = (m: ToastMsg) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setCurrent(m);
      Animated.parallel([
        Animated.timing(opacity,    { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: 220, useNativeDriver: true }),
      ]).start();
      timerRef.current = setTimeout(() => hide(), m.duration);
    };
    listeners.add(listener);
    return () => { listeners.delete(listener); if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  const hide = () => {
    Animated.parallel([
      Animated.timing(opacity,    { toValue: 0, duration: 180, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 20, duration: 200, useNativeDriver: true }),
    ]).start(() => setCurrent(null));
  };

  if (!current) return null;

  const kind = KIND_STYLE[current.kind];

  return (
    <View pointerEvents="box-none" style={styles.host}>
      <Animated.View
        pointerEvents="box-none"
        style={[styles.wrap, { opacity, transform: [{ translateY }] }]}
      >
        <TouchableOpacity
          testID={`toast-${current.kind}`}
          activeOpacity={0.9}
          onPress={hide}
          style={[styles.toast, { backgroundColor: kind.bg }]}
        >
          <MaterialIcons name={kind.icon} size={20} color="#fff" />
          <Text style={styles.text} numberOfLines={3}>{current.text}</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const { width } = Dimensions.get('window');
const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0, top: 0,
    justifyContent: 'flex-end',
    alignItems: 'center',
    // Keep above tab bar & FABs
    zIndex: 9999,
    elevation: 30,
  },
  wrap: {
    marginBottom: Platform.OS === 'ios' ? 110 : 100,
    maxWidth: width - 32,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
    minWidth: 200,
  },
  text: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
});
