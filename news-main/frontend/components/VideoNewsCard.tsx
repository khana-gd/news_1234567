/**
 * VideoNewsCard — Public Samachar Social Feed Card
 * Matches the reference layout exactly:
 *   Header → Title → Video (location tag + PS watermark) → Branding Bar
 *   → Description → Engagement → Actions → Reporter
 */
import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Image, Dimensions, Linking, Share, Platform,
  ActivityIndicator, Modal, TextInput, Alert,
} from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { MaterialIcons, Ionicons } from '@expo/vector-icons';
import CommentSheet from './CommentSheet';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

let YoutubePlayer: any = null;
try { YoutubePlayer = require('react-native-youtube-iframe').default; } catch {}

const { width: W } = Dimensions.get('window');
const VIDEO_H = Math.round(W * 9 / 16);
const SHARE_BASE = BACKEND_URL; // share URLs: ${SHARE_BASE}/api/cf/share/{id}
const LOCATION_TEAL = '#00897B';
const GP_URL = 'https://play.google.com/store/apps/details?id=com.sudhu1234.publicsamacharmobile';

export type VideoItem = {
  id: string;
  title: string;
  description: string;
  videoUrl: string;
  thumbUrl: string;
  reporterName: string;
  timestamp: number;
  location: string;
  youtubeId?: string;
  source: 'ps' | 'youtube';
  cfId?: string;
  reach?: number;
  cautionFlag?: boolean;
  verified?: boolean;
};

function timeAgo(ts: number): string {
  if (!ts) return '';
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60)    return 'just now';
  if (diff < 120)   return '1 minute ago';
  if (diff < 3600)  return `${Math.floor(diff / 60)} minutes ago`;
  if (diff < 7200)  return '1 hour ago';
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
  if (diff < 172800) return '1 day ago';
  return `${Math.floor(diff / 86400)} days ago`;
}

// ── Lazy video player: only created when user taps play ────────────────────
// This avoids creating N player instances for N cards in the FlatList.
// The player is instantiated ONLY when this component is mounted.
function ActiveVideoPlayer({ url, onStop }: { url: string; onStop: () => void }) {
  const [buffering, setBuffering] = useState(true);

  const player = useVideoPlayer(url, (p) => {
    p.loop = false;
    try { p.play(); } catch {}
  });

  // Detect when buffering/ready
  useEffect(() => {
    if (!player) return;
    const sub = player.addListener('statusChange', (status: any) => {
      if (status?.status === 'readyToPlay' || status?.isPlaying) {
        setBuffering(false);
      }
    });
    // Also stop buffering indicator after 3s max
    const t = setTimeout(() => setBuffering(false), 3000);
    return () => {
      try { sub?.remove?.(); } catch {}
      clearTimeout(t);
    };
  }, [player]);

  return (
    <View style={{ width: W, height: VIDEO_H, backgroundColor: '#000' }}>
      <VideoView
        player={player}
        style={{ width: W, height: VIDEO_H }}
        contentFit="contain"
        nativeControls
        allowsFullscreen
      />
      {buffering && (
        <View style={styles.bufferingOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.bufferingTxt}>Loading video...</Text>
        </View>
      )}
      {/* Tap to stop */}
      <TouchableOpacity
        style={styles.stopBtn}
        onPress={() => { try { player.pause(); } catch {} onStop(); }}
        hitSlop={{ top: 4, right: 4, bottom: 4, left: 4 }}
      >
        <MaterialIcons name="close" size={18} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

interface Props {
  item: VideoItem;
  isLiked: boolean;
  onLike: (id: string) => void;
}

export default function VideoNewsCard({ item, isLiked, onLike }: Props) {
  const [isPlaying, setIsPlaying]       = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [isDescExpanded, setIsDescExpanded] = useState(false);
  const [localLikes] = useState(() =>
    item.reach ? Math.max(1, Math.floor(item.reach / 200)) : Math.floor(Math.random() * 40) + 1
  );
  const reach = item.reach ?? (Math.floor(Math.random() * 4500) + 300);

  const isCF = item.source === 'ps' && !!item.videoUrl;
  const isYT = item.source === 'youtube' && !!item.youtubeId;
  const useYTPlayer = isYT && !!YoutubePlayer && Platform.OS !== 'web';

  const videoId = item.cfId || item.id || '';
  const shareUrl = item.source === 'youtube' && item.youtubeId
    ? `https://www.youtube.com/watch?v=${item.youtubeId}`
    : `${BACKEND_URL}/api/cf/share/${videoId}`;

  const shareMsg =
    `📺 ${item.title}\nWatch here: ${shareUrl}\n📱 Download app: https://mypublicsamachar.com/download`;

  const handleWhatsApp = useCallback(() => {
    Linking.openURL(`whatsapp://send?text=${encodeURIComponent(shareMsg)}`).catch(() =>
      Linking.openURL(`https://wa.me/?text=${encodeURIComponent(shareMsg)}`)
    );
  }, [shareMsg]);

  const handleShare = useCallback(async () => {
    try {
      await Share.share({ message: shareMsg, title: item.title });
    } catch {}
  }, [shareMsg]);

  const handleRepost = useCallback(async () => {
    try {
      await Share.share({ message: shareMsg, title: 'Re-share from Public Samachar' });
    } catch {}
  }, [shareMsg]);

  const handleSubmitReport = useCallback(async () => {
    if (!reportReason.trim()) {
      Alert.alert('Reason required', 'Please enter or select a reason for reporting.');
      return;
    }
    setReportSubmitting(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/cf/flag-video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_id: videoId, reason: reportReason.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setShowReportModal(false);
        setReportReason('');
        Alert.alert('✅ Reported', 'Thank you. Our team will review this video.');
      } else {
        Alert.alert('Error', 'Could not submit report. Please try again.');
      }
    } catch {
      Alert.alert('Error', 'Failed to submit report. Check your connection.');
    }
    setReportSubmitting(false);
  }, [reportReason, videoId]);

  const initials  = (item.reporterName || 'P').charAt(0).toUpperCase();
  const colors    = ['#2E7D32', '#1AAA94', '#6A1B9A', '#E65100', '#00695C', '#B71C1C'];
  const avatarBg  = colors[(item.reporterName || 'P').charCodeAt(0) % colors.length];
  const likes     = isLiked ? localLikes + 1 : localLikes;

  return (
    <View style={styles.card}>

      {/* ── Header ───────────────────────────────────────────────── */}
      <View style={styles.header}>
        <Image
          source={require('../assets/images/logo.png')}
          style={styles.headerLogo}
          resizeMode="contain"
        />
        <View style={styles.headerInfo}>
          <Text style={styles.brandName}>Public Samachar</Text>
          <Text style={styles.timeAgoTxt}>{timeAgo(item.timestamp)}</Text>
        </View>
        <TouchableOpacity
          hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
          onPress={() => setShowReportModal(true)}
        >
          <MaterialIcons name="more-vert" size={22} color="#555" />
        </TouchableOpacity>
      </View>

      {/* ── Caution flag badge (Part 6) ───────────────────────────── */}
      {item.cautionFlag && (
        <View style={styles.cautionBadge}>
          <MaterialIcons name="warning" size={13} color="#E65100" />
          <Text style={styles.cautionTxt}>⚠️ Unverified — content not fact-checked</Text>
        </View>
      )}

      {/* ── Title (bold, above video) ────────────────────────────── */}
      <Text style={styles.title}>{item.title}</Text>

      {/* ── Video Container ──────────────────────────────────────── */}
      <View style={styles.videoWrap}>
        {useYTPlayer ? (
          <YoutubePlayer
            height={VIDEO_H}
            width={W}
            videoId={item.youtubeId!}
            play={false}
            webViewStyle={{ opacity: 0.99 }}
            initialPlayerParams={{ controls: true, modestbranding: true, rel: false }}
            onError={() => {}}
          />
        ) : isCF && isPlaying && Platform.OS !== 'web' ? (
          <ActiveVideoPlayer
            url={item.videoUrl}
            onStop={() => setIsPlaying(false)}
          />
        ) : (
          <TouchableOpacity
            onPress={() => isCF && setIsPlaying(true)}
            activeOpacity={0.92}
            style={{ width: W, height: VIDEO_H }}
          >
            {item.thumbUrl ? (
              <Image
                source={{ uri: item.thumbUrl }}
                style={{ width: W, height: VIDEO_H }}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.thumbPlaceholder, { height: VIDEO_H }]}>
                <View style={styles.thumbGradientTop} />
                <MaterialIcons name="play-circle-filled" size={64} color="rgba(255,255,255,0.85)" />
                <Text style={styles.thumbPreviewTitle} numberOfLines={2}>{item.title}</Text>
                <View style={styles.thumbBrandBadge}>
                  <Text style={styles.thumbBrandTxt}>📺 Public Samachar</Text>
                </View>
              </View>
            )}
            {isCF && (
              <View style={StyleSheet.absoluteFill} pointerEvents="none">
                <View style={styles.playOverlay}>
                  <View style={styles.playCircle}>
                    <MaterialIcons name="play-arrow" size={38} color="#fff" />
                  </View>
                </View>
              </View>
            )}
          </TouchableOpacity>
        )}

        {/* Location tag — bottom left, green pill */}
        {!!item.location && (
          <View style={styles.locationTag} pointerEvents="none">
            <Text style={styles.locationDot}>📍</Text>
            <Text style={styles.locationTxt}>{item.location}</Text>
          </View>
        )}

        {/* PS logo badge — top right (Part 2) */}
        <View pointerEvents="none" style={styles.videoBadgeOverlay}>
          <Image
            source={require('../assets/images/video-badge.png')}
            style={{ width: '100%', height: '100%' }}
            resizeMode="contain"
          />
        </View>
      </View>

      {/* ── Branding Bar removed — using video badge overlay only ── */}

      {/* ── Description (YouTube style expand/collapse) ───────────── */}
      {!!item.description && (
        <TouchableOpacity
          activeOpacity={0.88}
          onPress={() => setIsDescExpanded(prev => !prev)}
          style={styles.descWrap}
        >
          <Text style={styles.desc} numberOfLines={isDescExpanded ? undefined : 3}>
            {item.description}
          </Text>
          {item.description.length > 90 && (
            <Text style={styles.moreBtnTxt}>
              {isDescExpanded ? 'Show less' : '...more'}
            </Text>
          )}
        </TouchableOpacity>
      )}

      {/* ── Engagement row ───────────────────────────────────────── */}
      <View style={styles.engagement}>
        <Text style={styles.reachTxt}>{reach.toLocaleString()} Reach</Text>
        <View style={styles.engRight}>
          <Text style={styles.engTxt}>{likes} Like</Text>
          <Text style={styles.engTxt}>0 Comment</Text>
        </View>
      </View>

      {/* ── Divider ──────────────────────────────────────────────── */}
      <View style={styles.divider} />

      {/* ── Action bar (5 items) ─────────────────────────────────── */}
      <View style={styles.actions}>
        <TouchableOpacity style={styles.actionItem} onPress={() => onLike(item.id)}>
          <MaterialIcons
            name={isLiked ? 'thumb-up' : 'thumb-up-off-alt'}
            size={24}
            color={isLiked ? '#1AAA94' : '#555'}
          />
          <Text style={[styles.actionLbl, isLiked && { color: '#1AAA94' }]}>Like</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionItem} onPress={() => setShowComments(true)}>
          <MaterialIcons name="chat-bubble-outline" size={24} color="#555" />
          <Text style={styles.actionLbl}>Comment</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionItem} onPress={handleShare}>
          <MaterialIcons name="reply" size={24} color="#555" style={{ transform: [{ scaleX: -1 }] }} />
          <Text style={styles.actionLbl}>Share</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionItem} onPress={handleWhatsApp}>
          <View style={styles.waCircle}>
            <Ionicons name="logo-whatsapp" size={20} color="#fff" />
          </View>
          <Text style={styles.actionLbl}>Whatsapp</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionItem} onPress={handleRepost}>
          <MaterialIcons name="repeat" size={24} color="#555" />
          <Text style={styles.actionLbl}>Re-post</Text>
        </TouchableOpacity>
      </View>

      {/* ── Get App link ─────────────────────────────────────────── */}
      <TouchableOpacity
        style={styles.getAppRow}
        onPress={() => Linking.openURL('https://mypublicsamachar.com/download').catch(() => {})}
        activeOpacity={0.75}
      >
        <MaterialIcons name="file-download" size={14} color="#1AAA94" />
        <Text style={styles.getAppTxt}>📲 Get Public Samachar App — Free Download</Text>
        <MaterialIcons name="chevron-right" size={14} color="#1AAA94" />
      </TouchableOpacity>

      {/* ── Divider ──────────────────────────────────────────────── */}
      <View style={styles.divider} />

      {/* ── Reporter section (Part 4: verified badge) ────────────── */}
      <View style={styles.reporter}>
        <View style={[styles.repAvatar, { backgroundColor: avatarBg }]}>
          <Text style={styles.repInitial}>{initials}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.repNameRow}>
            <Text style={styles.repName} numberOfLines={1}>{item.reporterName}</Text>
            {item.verified && (
              <View style={styles.verifiedBadge}>
                <MaterialIcons name="verified" size={14} color="#1AAA94" />
                <Text style={styles.verifiedTxt}>Verified</Text>
              </View>
            )}
          </View>
          {!!item.location && (
            <Text style={styles.repLocation} numberOfLines={1}>📍 {item.location}</Text>
          )}
        </View>
      </View>

      {/* ── Comment Sheet ────────────────────────────────────────── */}
      <CommentSheet
        visible={showComments}
        onClose={() => setShowComments(false)}
        source={item.source === 'youtube' ? 'youtube' : item.source === 'ps' ? 'ps' : 'wp'}
        contentId={item.source === 'ps' ? (item.cfId || item.id) : (item.youtubeId || item.id)}
        title={item.title}
      />

      {/* ── Report Modal (Part 5) ─────────────────────────────────── */}
      <Modal
        visible={showReportModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowReportModal(false)}
      >
        <View style={styles.reportOverlay}>
          <TouchableOpacity style={{ flex: 1 }} onPress={() => setShowReportModal(false)} />
          <View style={styles.reportSheet}>
            <View style={styles.handle} />
            <Text style={styles.reportTitle}>Report Video</Text>
            <Text style={styles.reportSubtitle}>Why are you reporting this video?</Text>

            {['Misleading information', 'Fake news', 'Inappropriate content', 'Violence', 'Spam', 'Other'].map(reason => (
              <TouchableOpacity
                key={reason}
                style={[styles.reportOption, reportReason === reason && styles.reportOptionSelected]}
                onPress={() => setReportReason(reason)}
              >
                <MaterialIcons
                  name={reportReason === reason ? 'radio-button-checked' : 'radio-button-unchecked'}
                  size={18}
                  color={reportReason === reason ? '#1AAA94' : '#999'}
                />
                <Text style={[styles.reportOptionTxt, reportReason === reason && { color: '#1AAA94', fontWeight: '700' }]}>
                  {reason}
                </Text>
              </TouchableOpacity>
            ))}

            <TextInput
              style={styles.reportInput}
              value={reportReason}
              onChangeText={setReportReason}
              placeholder="Or type custom reason..."
              placeholderTextColor="#bbb"
              maxLength={200}
            />

            <View style={styles.reportActions}>
              <TouchableOpacity
                style={styles.reportCancelBtn}
                onPress={() => { setShowReportModal(false); setReportReason(''); }}
              >
                <Text style={styles.reportCancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.reportSubmitBtn, reportSubmitting && { opacity: 0.6 }]}
                onPress={handleSubmitReport}
                disabled={reportSubmitting}
              >
                {reportSubmitting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.reportSubmitTxt}>Submit Report</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', overflow: 'hidden' },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 6,
  },
  headerLogo: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#f5f5f5' },
  headerInfo: { flex: 1, gap: 2 },
  brandName: { fontSize: 15, fontWeight: '700', color: '#111', letterSpacing: 0.1 },
  timeAgoTxt: { fontSize: 12, color: '#757575' },

  // Title
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111',
    lineHeight: 28,
    paddingHorizontal: 12,
    paddingBottom: 6,
  },

  // Video
  videoWrap: { position: 'relative', backgroundColor: '#000' },
  thumbPlaceholder: {
    width: '100%',
    backgroundColor: '#0D1B2A',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbGradientTop: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: '#0D1B2A',
    opacity: 0.92,
  },
  thumbPreviewTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
    paddingHorizontal: 24,
    marginTop: 14,
    lineHeight: 21,
    zIndex: 2,
  },
  thumbBrandBadge: {
    position: 'absolute',
    bottom: 14,
    left: 14,
    backgroundColor: 'rgba(27,94,32,0.85)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  thumbBrandTxt: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.7)',
  },
  bufferingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  bufferingTxt: { color: '#fff', fontSize: 13, fontWeight: '600' },
  stopBtn: {
    position: 'absolute',
    top: 8,
    left: 8,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationTag: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: LOCATION_TEAL,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  locationDot: { fontSize: 11 },
  locationTxt: { color: '#fff', fontSize: 14, fontWeight: '800' },
  videoBadgeOverlay: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 42,
    height: 42,
    borderRadius: 8,
    overflow: 'hidden',
  },
  cautionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFF3E0',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderLeftWidth: 3,
    borderLeftColor: '#E65100',
  },
  cautionTxt: { fontSize: 11, color: '#E65100', fontWeight: '600', flex: 1 },
  repNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  verifiedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#E6F7F3', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2,
  },
  verifiedTxt: { fontSize: 10, color: '#1AAA94', fontWeight: '700' },
  repLocation: { fontSize: 11, color: '#999', marginTop: 1 },
  // Report modal
  reportOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  reportSheet: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 36 },
  handle: { width: 40, height: 4, backgroundColor: '#E0E0E0', borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  reportTitle: { fontSize: 18, fontWeight: '800', color: '#111', marginBottom: 4 },
  reportSubtitle: { fontSize: 13, color: '#888', marginBottom: 12 },
  reportOption: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderRadius: 8, paddingHorizontal: 4 },
  reportOptionSelected: { backgroundColor: '#E6F7F3' },
  reportOptionTxt: { fontSize: 14, color: '#333' },
  reportInput: { borderWidth: 1, borderColor: '#E0E0E0', borderRadius: 8, padding: 10, fontSize: 13, color: '#333', marginTop: 8, backgroundColor: '#FAFAFA' },
  reportActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  reportCancelBtn: { flex: 1, borderWidth: 1, borderColor: '#E0E0E0', borderRadius: 24, paddingVertical: 12, alignItems: 'center' },
  reportCancelTxt: { fontSize: 14, color: '#555', fontWeight: '600' },
  reportSubmitBtn: { flex: 2, backgroundColor: '#D32F2F', borderRadius: 24, paddingVertical: 12, alignItems: 'center' },
  reportSubmitTxt: { fontSize: 14, color: '#fff', fontWeight: '700' },

  // Get App row (replaces old branding bar)
  getAppRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 9,
    paddingHorizontal: 16,
    backgroundColor: '#F0F4FF',
    borderTopWidth: 1,
    borderTopColor: '#E6F7F3',
  },
  getAppTxt: { fontSize: 12, color: '#1AAA94', fontWeight: '600', flex: 1, textAlign: 'center' },

  // Description
  descWrap: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  desc: {
    fontSize: 13.5,
    color: '#222',
    lineHeight: 20,
  },
  moreBtnTxt: {
    fontSize: 12.5,
    color: '#1AAA94',
    fontWeight: '700',
    marginTop: 4,
  },

  // Engagement
  engagement: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  reachTxt: { fontSize: 13, color: '#222' },
  engRight: { flexDirection: 'row', gap: 16 },
  engTxt: { fontSize: 13, color: '#222' },

  // Divider
  divider: { height: StyleSheet.hairlineWidth * 2, backgroundColor: '#E0E0E0' },

  // Actions
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 8,
  },
  actionItem: { flex: 1, alignItems: 'center', gap: 3, paddingVertical: 4 },
  actionLbl: { fontSize: 11, color: '#555', fontWeight: '500', textAlign: 'center' },
  waCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#25D366',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Reporter section
  reporter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 12,
  },
  repAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  repInitial: { color: '#fff', fontSize: 16, fontWeight: '900' },
  repText: { flex: 1, fontSize: 12.5, lineHeight: 18 },
  repLabel: { color: '#888' },
  repName: { fontWeight: '700', color: '#333', fontSize: 13 },
});
