/**
 * SocialInteractionBar — Universal 5-icon social bar
 *
 *  ─────────────────────────────────────────────────────────
 *  │ 👍 Like │ 💬 Comment │ ↗ Share │ 💚 WhatsApp │ 🔁 Re-post │
 *  ─────────────────────────────────────────────────────────
 *
 *  Used on: Video feed · Article detail · News cards · Trending cards
 *
 *  Props
 *  ─────
 *  postId      — used to namespace the like state (string | number)
 *  title       — post headline
 *  url         — canonical post URL (WordPress article link)
 *  youtubeUrl? — if set, share uses YouTube URL instead of article URL
 *  isLiked?    — controlled liked state  (default false)
 *  likeCount?  — number to show instead of "Like" label
 *  onLike?     — fired when user taps Like
 *  onComment?  — custom handler; default = Linking.openURL(url)
 *  compact?    — icons only (no labels); for small cards (default false)
 *  showDivider?— thin top divider line (default true)
 *  style?      — extra styles for the root container
 */

import React, { useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Share,
  Linking,
  ViewStyle,
} from 'react-native';
import { MaterialIcons, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

export type SocialInteractionBarProps = {
  postId:       number | string;
  title:        string;
  url:          string;
  youtubeUrl?:  string;
  isLiked?:     boolean;
  likeCount?:   number;
  onLike?:      () => void;
  onComment?:   () => void;
  compact?:     boolean;
  showDivider?: boolean;
  style?:       ViewStyle;
};

export function SocialInteractionBar({
  title,
  url,
  youtubeUrl,
  isLiked    = false,
  likeCount,
  onLike,
  onComment,
  compact    = false,
  showDivider = true,
  style,
}: SocialInteractionBarProps) {
  // WhatsApp uses the exact format specified by the user
  const waMsg   = youtubeUrl
    ? `${title} - Watch on Public Samachar: ${youtubeUrl}`
    : `${title} - Read on Public Samachar: ${url}`;

  const shareMsg = youtubeUrl
    ? `${title} - Watch on Public Samachar: ${youtubeUrl}`
    : `${title}\n\nRead on Public Samachar: ${url}`;

  const handleLike = useCallback(() => {
    onLike?.();
  }, [onLike]);

  const handleComment = useCallback(() => {
    if (onComment) { onComment(); return; }
    if (url) Linking.openURL(url).catch(() => {});
  }, [onComment, url]);

  const handleShare = useCallback(async () => {
    try { await Share.share({ message: shareMsg, title }); } catch {}
  }, [shareMsg, title]);

  const handleWhatsApp = useCallback(() => {
    const enc = encodeURIComponent(waMsg);
    Linking.openURL(`whatsapp://send?text=${enc}`).catch(() =>
      Linking.openURL(`https://api.whatsapp.com/send?text=${enc}`)
    );
  }, [waMsg]);

  const handleRepost = useCallback(async () => {
    try {
      const prefix  = youtubeUrl ? '📺' : '📰';
      const repostMsg = youtubeUrl
        ? `${prefix} ${title} - Watch on Public Samachar: ${youtubeUrl}`
        : `${prefix} ${title}\n\n${url}\n\nvia Public Samachar`;
      await Share.share({ message: repostMsg });
    } catch {}
  }, [title, url, youtubeUrl]);

  const iconSz  = compact ? 20 : 22;
  const likeClr = isLiked ? '#E91E63' : '#555';

  return (
    <View style={[styles.wrapper, style]}>
      {showDivider && <View style={styles.divider} />}

      <View style={[styles.bar, compact && styles.barCompact]}>

        {/* ── Like ─────────────────────────────────────────────── */}
        <TouchableOpacity
          style={[styles.item, compact && styles.itemCompact]}
          onPress={handleLike}
          activeOpacity={0.7}
        >
          <MaterialIcons
            name={isLiked ? 'favorite' : 'favorite-border'}
            size={iconSz}
            color={likeClr}
          />
          {!compact && (
            <Text style={[styles.label, { color: likeClr }]}>
              {likeCount !== undefined ? String(likeCount) : 'Like'}
            </Text>
          )}
        </TouchableOpacity>

        {/* ── Comment ──────────────────────────────────────────── */}
        <TouchableOpacity
          style={[styles.item, compact && styles.itemCompact]}
          onPress={handleComment}
          activeOpacity={0.7}
        >
          <MaterialIcons name="chat-bubble-outline" size={iconSz} color="#555" />
          {!compact && <Text style={styles.label}>Comment</Text>}
        </TouchableOpacity>

        {/* ── Share ────────────────────────────────────────────── */}
        <TouchableOpacity
          style={[styles.item, compact && styles.itemCompact]}
          onPress={handleShare}
          activeOpacity={0.7}
        >
          <MaterialIcons name="share" size={iconSz} color="#555" />
          {!compact && <Text style={styles.label}>Share</Text>}
        </TouchableOpacity>

        {/* ── WhatsApp ─────────────────────────────────────────── */}
        <TouchableOpacity
          style={[styles.item, compact && styles.itemCompact]}
          onPress={handleWhatsApp}
          activeOpacity={0.7}
        >
          <Ionicons
            name="logo-whatsapp"
            size={compact ? 21 : 23}
            color="#25D366"
          />
          {!compact && (
            <Text style={[styles.label, { color: '#25D366' }]}>WhatsApp</Text>
          )}
        </TouchableOpacity>

        {/* ── Re-post ──────────────────────────────────────────── */}
        <TouchableOpacity
          style={[styles.item, compact && styles.itemCompact]}
          onPress={handleRepost}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons
            name="repeat"
            size={compact ? 21 : 23}
            color="#555"
          />
          {!compact && <Text style={styles.label}>Re-post</Text>}
        </TouchableOpacity>

      </View>
    </View>
  );
}

export default SocialInteractionBar;

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: '#fff',
  },

  divider: {
    height: 1,
    backgroundColor: '#f0f0f0',
  },

  // ── Full bar (with labels) ──────────────────────────────────
  bar: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-around',
    paddingVertical:   8,
    paddingHorizontal: 4,
  },

  // ── Compact bar (icons only) ────────────────────────────────
  barCompact: {
    paddingVertical:   6,
    paddingHorizontal: 8,
    justifyContent:    'flex-start',
    gap: 4,
  },

  item: {
    flex:           1,
    alignItems:     'center',
    justifyContent: 'center',
    paddingVertical: 6,
    gap:             3,
    minHeight:       44,
  },

  itemCompact: {
    flex:            0,
    paddingHorizontal: 8,
    minHeight:       36,
    paddingVertical:  4,
  },

  label: {
    fontSize:   11,
    color:      '#555',
    fontWeight: '600',
  },
});
