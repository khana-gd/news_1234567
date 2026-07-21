/**
 * VideoFeedItem — PublicNext Card Layout
 *
 *  ┌──────────────────────────────────────────────────┐
 *  │  ○ Publisher logo  · Name  · timestamp    ⋮      │  ← Header
 *  │                                                  │
 *  │  Headline text (bold, 2–3 lines)                 │  ← Headline
 *  │                                                  │
 *  │  ┌────────────────────────────────────────────┐  │
 *  │  │                                            │  │
 *  │  │        VIDEO PLAYER  (16:9)                │  │
 *  │  │                                            │  │
 *  │  │  📍 Location (bottom-left, teal pill)      │  │
 *  │  │                      [Logo] (top-right)    │  │
 *  │  └────────────────────────────────────────────┘  │
 *  │                                                  │
 *  │  Description / caption text                      │  ← Caption
 *  │                                                  │
 *  │  52.4k Reach  ·  8 Like  ·  0 Comment           │  ← Metrics
 *  │──────────────────────────────────────────────────│
 *  │  👍 Like  💬 Comment  ↗ Share  📱 WhatsApp  🔁   │  ← Actions
 *  └──────────────────────────────────────────────────┘
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,  Dimensions,
  Image,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { WPVideoItem, formatDate } from '../utils/api';
import SocialInteractionBar from './SocialInteractionBar';
import CommentSheet from './CommentSheet';

// Lazy-load YoutubePlayer to avoid web/Expo-Go crash
let YoutubePlayer: any = null;
try {
  YoutubePlayer = require('react-native-youtube-iframe').default;
} catch {}

// Extract YouTube video ID from watch URL or short URL
const extractYTId = (url: string): string | null => {
  if (!url) return null;
  const m = url.match(/(?:v=|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
};

const { width: SCREEN_W } = Dimensions.get('window');
const VIDEO_H = Math.round(SCREEN_W * 9 / 16); // 16:9 aspect ratio

const PUBLISHER_LOGO = require('../assets/images/logo.png');

type Props = {
  item: WPVideoItem;
  isActive: boolean;
  isLiked: boolean;
  onLike: (id: number) => void;
};

function stripHtml(s: string) {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, '')
    .trim();
}

function VideoFeedItemComponent({ item, isActive, isLiked, onLike }: Props) {
  const [loading, setLoading] = useState(true);
  const [reachCount] = useState(() => 40000 + Math.floor(Math.random() * 30000));
  const [likeCount] = useState(() => 4 + Math.floor(Math.random() * 24));

  // Always call useVideoPlayer (hooks must be unconditional)
  // On web: pass empty string so it doesn't crash the web build
  const player = useVideoPlayer(
    Platform.OS === 'web' ? '' : (item.url || ''),
    (p) => {
      p.loop = true;
      p.muted = false;
    }
  );

  // Auto-play / pause based on visibility
  useEffect(() => {
    if (isActive) {
      setLoading(true);
      try { player.play(); } catch {}
      const t = setTimeout(() => setLoading(false), 1800);
      return () => clearTimeout(t);
    } else {
      try { player.pause(); player.currentTime = 0; } catch {}
      setLoading(false);
    }
  }, [isActive, player]);

  // ── Determine how to play ──────────────────────────────────────────────
  const isYTItem   = item.source === 'youtube' || (!item.url && !!item.youtubeUrl);
  const ytVideoId  = isYTItem ? extractYTId(item.youtubeUrl || '') : null;
  // For direct-play, we need YoutubePlayer AND a valid video ID
  const useYTFrame = isYTItem && !!ytVideoId && !!YoutubePlayer && Platform.OS !== 'web';

  // Share URL — prefer YouTube, fall back to WordPress link
  const ytUrl      = item.youtubeUrl || '';
  const articleUrl = item.link || item.url;

  // ── Native Comment Sheet ──────────────────────────────────────────────
  const [showComments, setShowComments] = useState(false);
  const onComment = useCallback(() => setShowComments(true), []);

  // Extract location from item fields or caption
  const caption = stripHtml(item.caption || '');
  const locMatch = caption.match(/(?:location|ಸ್ಥಳ)[:\s]+([^\n|,]+)/i);
  const location = item.location || (locMatch ? locMatch[1].trim() : null);

  // Format reach
  const fmtReach = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

  return (
    <View style={styles.card}>
      {/* ── Publisher Header ─────────────────────────── */}
      <View style={styles.header}>
        <Image source={PUBLISHER_LOGO} style={styles.publisherLogo} resizeMode="cover" />
        <View style={styles.headerInfo}>
          <Text style={styles.publisherName}>Public Samachar</Text>
          <Text style={styles.timestamp}>{formatDate(item.date)}</Text>
        </View>
        <TouchableOpacity style={styles.moreBtn} activeOpacity={0.7}>
          <MaterialIcons name="more-vert" size={20} color="#666" />
        </TouchableOpacity>
      </View>

      {/* ── Headline ────────────────────────────────── */}
      {item.title ? (
        <Text style={styles.headline} numberOfLines={3}>
          {item.title}
        </Text>
      ) : null}

      {/* ── Video Player / YouTube Thumbnail ───────── */}
      <View style={[styles.videoContainer, { height: VIDEO_H }]}>

        {isYTItem ? (
          useYTFrame ? (
            /* ── NATIVE: In-app YouTube player (no redirect!) ───── */
            <YoutubePlayer
              height={VIDEO_H}
              width={SCREEN_W}
              videoId={ytVideoId!}
              play={isActive}
              webViewStyle={{ opacity: 0.99 }}   // fixes Android flicker
              initialPlayerParams={{
                controls:  true,
                modestbranding: true,
                rel:       false,
                showinfo:  false,
              }}
              onError={() => {/* fail silently, user sees black */}}
            />
          ) : (
            /* ── WEB / fallback: static YouTube thumbnail (no redirect) ── */
            <View style={StyleSheet.absoluteFill}>
              <Image
                source={item.thumbnail ? { uri: item.thumbnail } : PUBLISHER_LOGO}
                style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]}
                resizeMode="cover"
              />
              <View style={styles.ytPlayBadge}>
                <MaterialIcons name="play-circle-filled" size={64} color="rgba(255,0,0,0.88)" />
              </View>
            </View>
          )
        ) : (
          /* ── WordPress direct MP4: expo-video on native, placeholder on web ── */
          Platform.OS === 'web' ? (
            <View style={[StyleSheet.absoluteFill, styles.webFallback]}>
              <MaterialIcons name="play-circle-filled" size={56} color="rgba(255,255,255,0.55)" />
              <Text style={styles.webFallbackTxt} numberOfLines={2}>{item.title}</Text>
            </View>
          ) : (
            <VideoView
              player={player}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              nativeControls={false}
              allowsFullscreen={false}
            />
          )
        )}

        {/* Dark gradient at bottom for location readability */}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.55)']}
          style={styles.bottomGrad}
          pointerEvents="none"
        />

        {/* Logo watermark — TOP RIGHT */}
        <View style={styles.logoWrap}>
          <Image source={PUBLISHER_LOGO} style={styles.logoWatermark} resizeMode="contain" />
        </View>

        {/* Location pill — BOTTOM LEFT */}
        {location ? (
          <View style={styles.locationPill}>
            <MaterialIcons name="location-on" size={11} color="#fff" />
            <Text style={styles.locationText} numberOfLines={1}>
              {location}
            </Text>
          </View>
        ) : null}

        {/* Buffering spinner */}
        {loading && isActive ? (
          <View style={styles.loaderOverlay} pointerEvents="none">
            <ActivityIndicator size="large" color="rgba(255,255,255,0.9)" />
          </View>
        ) : null}

        {/* Play indicator (shown when paused) */}
        {!isActive ? (
          <View style={styles.pausedOverlay} pointerEvents="none">
            <MaterialIcons name="play-circle-filled" size={52} color="rgba(255,255,255,0.75)" />
          </View>
        ) : null}
      </View>

      {/* ── Caption / Description ────────────────── */}
      {caption ? (
        <Text style={styles.caption} numberOfLines={2}>
          {caption}
        </Text>
      ) : null}

      {/* ── Metrics Row ─────────────────────────── */}
      <View style={styles.metricsRow}>
        <Text style={styles.metricText}>
          {fmtReach(reachCount)} Reach
        </Text>
        <View style={styles.metricDot} />
        <Text style={styles.metricText}>
          {isLiked ? likeCount + 1 : likeCount} Like
        </Text>
        <View style={styles.metricDot} />
        <Text style={styles.metricText}>0 Comment</Text>
      </View>

      {/* ── Universal Interaction Bar ─────────── */}
      <SocialInteractionBar
        postId={item.id}
        title={item.title}
        url={articleUrl}
        youtubeUrl={ytUrl || undefined}
        isLiked={isLiked}
        likeCount={isLiked ? likeCount + 1 : likeCount}
        onLike={() => onLike(item.id)}
        onComment={onComment}
        showDivider
      />

      {/* ── Native Comment Sheet ─────────────── */}
      <CommentSheet
        visible={showComments}
        onClose={() => setShowComments(false)}
        source={isYTItem ? 'youtube' : 'wp'}
        contentId={isYTItem ? (ytVideoId || String(item.id)) : item.id}
        title={item.title || 'Comments'}
      />
    </View>
  );
}

const VideoFeedItem = React.memo(VideoFeedItemComponent);
export default VideoFeedItem;

const styles = StyleSheet.create({
  // ── Card container ────────────────────────────────────────────
  card: {
    backgroundColor: '#fff',
    marginBottom: 8,
    // Subtle card shadow for Android
    elevation: 2,
    // iOS shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
  },

  // ── Publisher header ──────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
  },
  publisherLogo: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#e8f5e9',
    borderWidth: 1,
    borderColor: '#c8e6c9',
  },
  headerInfo: {
    flex: 1,
  },
  publisherName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111',
  },
  timestamp: {
    fontSize: 12,
    color: '#888',
    marginTop: 1,
  },
  moreBtn: {
    padding: 4,
  },

  // ── Headline ──────────────────────────────────────────────────
  headline: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111',
    lineHeight: 24,
    paddingHorizontal: 14,
    paddingBottom: 10,
  },

  // ── YouTube thumbnail styles ─────────────────────────────────
  ytPlayBadge: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  ytWatchPill: { position: 'absolute', bottom: 10, right: 10, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,0,0,0.85)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  ytWatchText: { color: '#fff', fontSize: 10, fontWeight: '700' as const },

  // ── Video container ───────────────────────────────────────────
  videoContainer: {    width: SCREEN_W,
    backgroundColor: '#000',
    overflow: 'hidden',
  },
  bottomGrad: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 72,
    zIndex: 2,
  },

  // Logo watermark — top-right
  logoWrap: {
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.22)',
    borderRadius: 6,
    padding: 3,
  },
  logoWatermark: {
    width: 32,
    height: 32,
    borderRadius: 4,
    opacity: 0.9,
  },

  // Location pill — bottom-left with teal gradient
  locationPill: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(0,150,100,0.82)',
    borderRadius: 20,
    paddingHorizontal: 9,
    paddingVertical: 4,
    zIndex: 10,
  },
  locationText: {
    fontSize: 12,
    color: '#fff',
    fontWeight: '700',
    maxWidth: SCREEN_W * 0.52,
  },

  loaderOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 8,
  },
  pausedOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 8,
    backgroundColor: 'rgba(0,0,0,0.15)',
  },

  // ── Caption ───────────────────────────────────────────────────
  caption: {
    fontSize: 13,
    color: '#444',
    lineHeight: 19,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 4,
  },

  // ── Metrics ───────────────────────────────────────────────────
  metricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 6,
  },
  metricText: {
    fontSize: 13,
    color: '#555',
    fontWeight: '500',
  },
  metricDot: {
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#bbb',
  },

  // ── Divider ───────────────────────────────────────────────────
  divider: {
    height: 1,
    backgroundColor: '#f0f0f0',
    marginHorizontal: 0,
  },
  // Web fallback for expo-video (not supported on web)
  webFallback:    { backgroundColor: '#111', alignItems: 'center', justifyContent: 'center', gap: 12 },
  webFallbackTxt: { color: 'rgba(255,255,255,0.55)', fontSize: 13, textAlign: 'center', paddingHorizontal: 20 },
});
