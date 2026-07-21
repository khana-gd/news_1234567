/**
 * Push Notification Setup
 * - Requests permission on first open
 * - Registers Expo Push Token
 * - Saves token to backend
 * - Sets up foreground notification handler
 */
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL || '';

// How notifications appear when the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function registerForPushNotifications(): Promise<string | null> {
  // Push only works on a physical device
  if (!Device.isDevice) {
    console.log('[Notifications] Skipped – not a physical device');
    return null;
  }

  // Check / request permissions
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('[Notifications] Permission denied');
    return null;
  }

  // Android channel
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Public Samachar',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#1AAA94',
      sound: 'default',
    });
  }

  // Get Expo push token
  try {
    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: process.env.EXPO_PUBLIC_PROJECT_ID,
    });
    const token = tokenData.data;
    console.log('[Notifications] Push token:', token);

    // Save to backend
    if (BACKEND) {
      await fetch(`${BACKEND}/api/push-token`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ token }),
      }).catch(e => console.warn('[Notifications] Token save failed:', e));
    }

    return token;
  } catch (e) {
    console.warn('[Notifications] Token fetch error:', e);
    return null;
  }
}

/**
 * Listen for notification taps and open the correct video.
 * Handles both warm taps (app in background) and cold-start taps.
 * Returns an unsubscribe function.
 */
export function addNotificationTapListener(
  onOpenVideo: (videoId: string) => void
): () => void {
  if (Platform.OS === 'web') return () => {};

  const handle = (response: Notifications.NotificationResponse | null) => {
    const data: any = response?.notification?.request?.content?.data;
    if (!data) return;
    if (data.type === 'new_cf_video' && data.video_id) {
      onOpenVideo(String(data.video_id));
    } else if (data.type === 'new_video') {
      onOpenVideo(''); // WP video — just open the video feed tab
    }
  };

  const sub = Notifications.addNotificationResponseReceivedListener(handle);

  // Cold start: app was killed and opened by tapping the notification
  Notifications.getLastNotificationResponseAsync()
    .then(handle)
    .catch(() => {});

  return () => sub.remove();
}
