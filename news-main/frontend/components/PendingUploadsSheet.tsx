import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import {
  QueuedUploadItem,
  subscribeToQueue,
  retryQueueItem,
  removeQueueItem,
  processNextInQueue,
} from '../utils/uploadQueue';

interface Props {
  language?: string;
}

function getStatusDotColor(status: string): string {
  if (status === 'uploading' || status === 'optimizing') return '#2196F3';
  if (status === 'failed') return '#F44336';
  return '#FF9800';
}

export default function PendingUploadsSheet({ language = 'kn' }: Props) {
  const isKn = language === 'kn';
  const [queue, setQueue] = useState<QueuedUploadItem[]>([]);
  const [modalVisible, setModalVisible] = useState(false);

  useEffect(() => {
    const unsub = subscribeToQueue(items => setQueue(items));
    return unsub;
  }, []);

  if (queue.length === 0) return null;

  const activeItem = queue.find(i => i.status === 'uploading' || i.status === 'optimizing');
  const pendingCount = queue.length;

  return (
    <>
      {/* ── Top Notification Banner ── */}
      <TouchableOpacity
        style={styles.banner}
        activeOpacity={0.88}
        onPress={() => setModalVisible(true)}
      >
        <View style={styles.bannerIcon}>
          {activeItem ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <MaterialIcons name="cloud-queue" size={20} color="#fff" />
          )}
        </View>

        <View style={{ flex: 1 }}>
          <Text style={styles.bannerTitle}>
            {activeItem
              ? (isKn ? '📤 ವಿಡಿಯೋ ಅಪ್ಲೋಡ್ ಆಗುತ್ತಿದೆ...' : '📤 Uploading video...')
              : (isKn ? `⏳ ${pendingCount} ವಿಡಿಯೋ ಕಾಯುತ್ತಿದೆ (ನೆಟ್‌ವರ್ಕ್ ಬಂದಾಗ ಅಪ್ಲೋಡ್)` : `⏳ ${pendingCount} video(s) queued (Uploads when online)`)}
          </Text>
          <Text style={styles.bannerSub} numberOfLines={1}>
            {activeItem?.progressMsg || (isKn ? 'ವಿವರಗಳನ್ನು ನೋಡಲು ಇಲ್ಲಿ ಟ್ಯಾಪ್ ಮಾಡಿ' : 'Tap to view upload status / retry')}
          </Text>
        </View>

        <MaterialIcons name="chevron-right" size={22} color="rgba(255,255,255,0.7)" />
      </TouchableOpacity>

      {/* ── Modal / Sheet ── */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.sheet}>
            {/* Header */}
            <View style={styles.sheetHdr}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <MaterialIcons name="cloud-upload" size={24} color="#1AAA94" />
                <Text style={styles.sheetTitle}>
                  {isKn ? 'ಕಾಯುತ್ತಿರುವ ಅಪ್ಲೋಡ್‌ಗಳು' : 'Pending Uploads'} ({queue.length})
                </Text>
              </View>
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={() => setModalVisible(false)}
              >
                <MaterialIcons name="close" size={22} color="#333" />
              </TouchableOpacity>
            </View>

            <Text style={styles.sheetNote}>
              {isKn
                ? 'ಗ್ರಾಮೀಣ ಭಾಗದಲ್ಲಿ ನೆಟ್‌ವರ್ಕ್ ಕಡಿಮೆಯಿದ್ದರೂ ನಿಮ್ಮ ವಿಡಿಯೋ ಸುರಕ್ಷಿತವಾಗಿದೆ. ಇಂಟರ್ನೆಟ್ ಸಂಪರ್ಕ ಬಂದಾಗ ಸ್ವಯಂಚಾಲಿತವಾಗಿ ಅಪ್ಲೋಡ್ ಆಗುತ್ತದೆ.'
                : 'Videos are safely queued on your device. They will automatically upload as soon as a stable connection is reached.'}
            </Text>

            <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
              {queue.map(item => (
                <View key={item.id} style={styles.itemCard}>
                  <View style={styles.itemRow}>
                    <View style={[styles.statusDot, { backgroundColor: getStatusDotColor(item.status) }]} />
                    <Text style={styles.itemTitle} numberOfLines={1}>
                      {item.title || (isKn ? 'ಶೀರ್ಷಿಕೆ ಇಲ್ಲ' : 'Untitled')}
                    </Text>
                    <Text style={styles.itemMode}>
                      {item.qualityMode === 'rural' ? '⚡ Rural Fast' : 'HD'}
                    </Text>
                  </View>

                  <Text style={styles.itemMsg} numberOfLines={2}>
                    {item.progressMsg || item.error || 'Waiting for network...'}
                  </Text>

                  {/* Progress bar */}
                  {item.status !== 'failed' && (
                    <View style={styles.barTrack}>
                      <View style={[styles.barFill, { width: `${item.progress}%` as any }]} />
                    </View>
                  )}

                  <View style={styles.actionRow}>
                    <Text style={styles.timeTxt}>
                      {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>

                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      {item.status === 'failed' && (
                        <TouchableOpacity
                          style={styles.actionBtnRetry}
                          onPress={() => retryQueueItem(item.id)}
                        >
                          <MaterialIcons name="refresh" size={16} color="#fff" />
                          <Text style={styles.actionTxtRetry}>{isKn ? 'ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ' : 'Retry'}</Text>
                        </TouchableOpacity>
                      )}

                      <TouchableOpacity
                        style={styles.actionBtnDelete}
                        onPress={() => {
                          Alert.alert(
                            isKn ? 'ರದ್ದುಗೊಳಿಸುವುದೇ?' : 'Delete upload?',
                            isKn ? 'ಈ ವಿಡಿಯೋ ಅಪ್ಲೋಡ್ ರದ್ದುಗೊಳಿಸಲಾಗುವುದು.' : 'This pending upload will be removed from your device.',
                            [
                              { text: isKn ? 'ಬೇಡ' : 'Cancel', style: 'cancel' },
                              { text: isKn ? 'ರದ್ದುಮಾಡಿ' : 'Delete', style: 'destructive', onPress: () => removeQueueItem(item.id) },
                            ]
                          );
                        }}
                      >
                        <MaterialIcons name="delete-outline" size={16} color="#D32F2F" />
                        <Text style={styles.actionTxtDelete}>{isKn ? 'ರದ್ದುಮಾಡಿ' : 'Delete'}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              ))}
            </ScrollView>

            <TouchableOpacity
              style={styles.syncAllBtn}
              onPress={() => {
                processNextInQueue();
                setModalVisible(false);
              }}
            >
              <MaterialIcons name="sync" size={20} color="#fff" />
              <Text style={styles.syncAllTxt}>
                {isKn ? 'ಈಗಲೇ ಅಪ್ಲೋಡ್ ಪ್ರಯತ್ನಿಸಿ' : 'Sync All Now'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#0E7A68',
    paddingHorizontal: 16,
    paddingVertical: 10,
    elevation: 3,
  },
  bannerIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerTitle: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  bannerSub: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 11,
    marginTop: 2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '75%',
    padding: 20,
    paddingBottom: 30,
  },
  sheetHdr: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#111',
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f2f2f2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetNote: {
    fontSize: 12,
    color: '#666',
    lineHeight: 17,
    marginBottom: 16,
  },
  list: {
    marginBottom: 16,
  },
  itemCard: {
    backgroundColor: '#F8F9FA',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E8ECF0',
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  itemTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#222',
    flex: 1,
  },
  itemMode: {
    fontSize: 10,
    fontWeight: '700',
    color: '#1AAA94',
    backgroundColor: 'rgba(26,170,148,0.1)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  itemMsg: {
    fontSize: 12,
    color: '#555',
    marginBottom: 8,
  },
  barTrack: {
    height: 6,
    backgroundColor: '#E0E0E0',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 10,
  },
  barFill: {
    height: '100%',
    backgroundColor: '#1AAA94',
    borderRadius: 3,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  timeTxt: {
    fontSize: 11,
    color: '#999',
  },
  actionBtnRetry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#1AAA94',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  actionTxtRetry: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  actionBtnDelete: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFEBEE',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  actionTxtDelete: {
    color: '#D32F2F',
    fontSize: 12,
    fontWeight: '600',
  },
  syncAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#1AAA94',
    borderRadius: 14,
    paddingVertical: 14,
  },
  syncAllTxt: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
  },
});
