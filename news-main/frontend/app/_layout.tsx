import React, { useEffect } from 'react';
import { Stack, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LogBox } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LanguageProvider } from '../context/LanguageContext';
import { AuthProvider } from '../context/AuthContext';
import { registerForPushNotifications, addNotificationTapListener } from '../utils/notifications';
import { ToastHost } from '../components/Toast';
import { useIconFonts } from '@/src/hooks/use-icon-fonts';

// Silence Metro dev-only noise
LogBox.ignoreAllLogs(true);

// Keep native splash visible until icon fonts register.
// Required because @expo/vector-icons' fallback fires against a broken
// vendor path if any <Icon> mounts before the family is registered
// (throws on Android Expo Go).
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useIconFonts();

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  useEffect(() => {
    // Register for push notifications on first open
    registerForPushNotifications().catch(e => console.warn('[Layout] Push setup:', e));
    // Open the correct video when a push notification is tapped
    const unsubscribe = addNotificationTapListener(videoId => {
      router.push(videoId ? `/(tabs)/video?videoId=${videoId}` : '/(tabs)/video');
    });
    // Onboarding gate
    AsyncStorage.getItem('onboarding_complete').then(val => {
      if (!val) router.replace('/onboarding');
    });
    return unsubscribe;
  }, []);

  if (!loaded && !error) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <LanguageProvider>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="article/[id]" options={{ headerShown: false, animation: 'slide_from_right' }} />
              <Stack.Screen name="reporters" options={{ headerShown: false, animation: 'slide_from_right' }} />
              <Stack.Screen name="onboarding" options={{ headerShown: false, animation: 'fade' }} />
              <Stack.Screen name="preferences" options={{ headerShown: false, animation: 'slide_from_right' }} />
              <Stack.Screen name="video-editor" options={{ headerShown: false, animation: 'slide_from_bottom' }} />
              <Stack.Screen name="youtube-upload" options={{ headerShown: false, animation: 'slide_from_bottom' }} />
              <Stack.Screen name="reporter-login" options={{ headerShown: false, animation: 'slide_from_bottom' }} />
            </Stack>
            {/* Global toast host — mounted once at root so it overlays everything */}
            <ToastHost />
          </LanguageProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
