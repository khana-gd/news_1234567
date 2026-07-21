/**
 * VideoPlayerModal — In-app YouTube player
 *
 * Opens a full-screen modal with the YouTube iframe player.
 * This prevents the app from redirecting users to the external YouTube app.
 */

import React from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Platform,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';

// Lazy-load YoutubePlayer to avoid web crash
let YoutubePlayer: any = null;
try {
  YoutubePlayer = require('react-native-youtube-iframe').default;
} catch {}

const { width: SCREEN_W } = Dimensions.get('window');
const VIDEO_H = Math.round(SCREEN_W * 9 / 16);

interface VideoPlayerModalProps {
  visible: boolean;
  videoId: string;
  title: string;
  onClose: () => void;
}

export default function VideoPlayerModal({
  visible,
  videoId,
  title,
  onClose,
}: VideoPlayerModalProps) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={s.container}>
        <StatusBar backgroundColor="#000" barStyle="light-content" />

        {/* Header */}
        <SafeAreaView style={s.safeHeader} edges={['top']}>
          <View style={s.header}>
            <TouchableOpacity onPress={onClose} style={s.backBtn}>
              <MaterialIcons name="arrow-back" size={24} color="#fff" />
            </TouchableOpacity>
            <Text style={s.title} numberOfLines={2}>
              {title}
            </Text>
          </View>
        </SafeAreaView>

        {/* Player */}
        <View style={s.playerContainer}>
          {YoutubePlayer && Platform.OS !== 'web' ? (
            <YoutubePlayer
              height={VIDEO_H}
              width={SCREEN_W}
              videoId={videoId}
              play
              webViewStyle={{ opacity: 0.99 }}
              initialPlayerParams={{
                controls: true,
                modestbranding: true,
                rel: false,
                showinfo: false,
              }}
            />
          ) : (
            <View style={s.webFallback}>
              <MaterialIcons name="play-circle-outline" size={64} color="rgba(255,255,255,0.5)" />
              <Text style={s.webFallbackText}>
                Video player available in the mobile app
              </Text>
            </View>
          )}
        </View>

        {/* Footer info */}
        <View style={s.footer}>
          <Text style={s.footerText} numberOfLines={2}>{title}</Text>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  safeHeader: {
    backgroundColor: '#000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  backBtn: {
    padding: 4,
    marginTop: 2,
  },
  title: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
    lineHeight: 21,
  },
  playerContainer: {
    width: SCREEN_W,
    height: VIDEO_H,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  webFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 32,
  },
  webFallbackText: {
    color: '#888',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#111',
  },
  footerText: {
    color: '#ccc',
    fontSize: 13,
    lineHeight: 19,
  },
});
