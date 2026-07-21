/**
 * ReporterLeaderboard — "Reporter of the Week" community leaderboard
 *
 * Aggregates comment_count from the last ~50 posts by author, ranks them,
 * and shows a top-3 podium + expandable full ranking. Zero backend change —
 * uses the existing api.getPosts() endpoint and does everything on-device.
 *
 * Cached in AsyncStorage for 30 min so it doesn't refetch on every focus.
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator,
} from 'react-native';
import { MaterialIcons, Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, Post } from '../utils/api';
import { BRAND } from '../constants/theme';
import { showToast } from './Toast';

const CACHE_KEY = 'reporter_leaderboard_v1';
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min

export interface RankedReporter {
  name: string;
  totalComments: number;
  articleCount: number;
  latestTitle: string;
  latestId: number;
  featuredImage: string | null;
}

// ── Ranking algorithm ─────────────────────────────────────────────────────────
function rankReporters(posts: Post[], daysWindow = 7): RankedReporter[] {
  const now = Date.now();
  const cutoff = now - daysWindow * 24 * 60 * 60 * 1000;

  const byAuthor = new Map<string, RankedReporter>();
  for (const p of posts) {
    if (!p.author || !p.author.trim()) continue;
    const t = new Date(p.date).getTime();
    if (!Number.isFinite(t) || t < cutoff) continue;

    const existing = byAuthor.get(p.author);
    if (existing) {
      existing.totalComments += p.comment_count;
      existing.articleCount += 1;
      // Keep the latest article we've seen
      if (t > new Date(existing.latestTitle).getTime()) {
        existing.latestTitle = p.title;
        existing.latestId = p.id;
        existing.featuredImage = p.featured_image;
      }
    } else {
      byAuthor.set(p.author, {
        name: p.author,
        totalComments: p.comment_count,
        articleCount: 1,
        latestTitle: p.title,
        latestId: p.id,
        featuredImage: p.featured_image,
      });
    }
  }

  const ranked = Array.from(byAuthor.values()).sort((a, b) => {
    if (b.totalComments !== a.totalComments) return b.totalComments - a.totalComments;
    return b.articleCount - a.articleCount;
  });
  return ranked;
}

// ── Helper: color for rank badges ─────────────────────────────────────────────
const RANK_STYLE: Record<number, { bg: string; border: string; label: string }> = {
  1: { bg: '#FFF4D6', border: '#F5B301', label: '🥇' },
  2: { bg: '#EAECEE', border: '#9E9E9E', label: '🥈' },
  3: { bg: '#F9DFC7', border: '#B7621F', label: '🥉' },
};

// ── Reporter avatar (initials) ────────────────────────────────────────────────
function ReporterAvatar({ name, size = 44 }: { name: string; size?: number }) {
  const initials = (name || '?').trim().charAt(0).toUpperCase();
  const palette = [BRAND.primary, '#7B4FE8', '#E91E8C', '#FF7043', '#2E7D8C'];
  const color = palette[initials.charCodeAt(0) % palette.length];
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }]}>
      <Text style={[styles.avatarInitials, { fontSize: size * 0.42 }]}>{initials}</Text>
    </View>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Main leaderboard section
// ═════════════════════════════════════════════════════════════════════════════
export default function ReporterLeaderboard({
  isKn,
  followed,
  onFollow,
  onOpenArticle,
}: {
  isKn: boolean;
  followed: string[];
  onFollow: (name: string) => void;
  onOpenArticle: (postId: number) => void;
}) {
  const [ranked, setRanked] = useState<RankedReporter[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    // Try cache first
    if (!force) {
      try {
        const raw = await AsyncStorage.getItem(CACHE_KEY);
        if (raw) {
          const cached = JSON.parse(raw);
          if (cached.ts && Date.now() - cached.ts < CACHE_TTL_MS && Array.isArray(cached.data)) {
            setRanked(cached.data);
            setLoading(false);
            return;
          }
        }
      } catch {}
    }

    try {
      // Pull enough posts to have a meaningful rolling window
      const resp = await api.getPosts(1, 50);
      const list = rankReporters(resp.posts, 7);
      setRanked(list);
      AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data: list })).catch(() => {});
    } catch {
      setRanked([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading && ranked.length === 0) {
    return (
      <View style={styles.section}>
        <SectionHeader isKn={isKn} onRefresh={() => load(true)} />
        <View style={styles.loadingBox}>
          <ActivityIndicator color={BRAND.primary} />
          <Text style={styles.loadingText}>
            {isKn ? 'ರ್ಯಾಂಕಿಂಗ್ ಲೆಕ್ಕಾಚಾರ...' : 'Calculating rankings...'}
          </Text>
        </View>
      </View>
    );
  }

  // ── No data state ──────────────────────────────────────────────────────────
  if (ranked.length === 0) {
    return (
      <View style={styles.section}>
        <SectionHeader isKn={isKn} onRefresh={() => load(true)} />
        <View style={styles.emptyBox}>
          <MaterialIcons name="emoji-events" size={40} color="#DADADA" />
          <Text style={styles.emptyText}>
            {isKn
              ? 'ಈ ವಾರ ಇನ್ನೂ ಸಾಕಷ್ಟು ಸುದ್ದಿ ಇಲ್ಲ'
              : 'Not enough activity this week yet'}
          </Text>
        </View>
      </View>
    );
  }

  const top3 = ranked.slice(0, 3);
  const rest  = ranked.slice(3, 10);

  return (
    <View style={styles.section}>
      <SectionHeader isKn={isKn} onRefresh={() => load(true)} />

      {/* Top-3 Podium */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.podiumRow}
      >
        {top3.map((r, idx) => {
          const rank = idx + 1;
          const style = RANK_STYLE[rank];
          const isFollowed = followed.includes(r.name);
          return (
            <TouchableOpacity
              key={r.name}
              testID={`podium-card-${rank}`}
              style={[styles.podiumCard, { borderColor: style.border, backgroundColor: style.bg }]}
              onPress={() => onOpenArticle(r.latestId)}
              activeOpacity={0.9}
            >
              <View style={styles.podiumRankPill}>
                <Text style={styles.podiumRankTxt}>{style.label} #{rank}</Text>
              </View>
              <ReporterAvatar name={r.name} size={56} />
              <Text style={styles.podiumName} numberOfLines={1}>{r.name}</Text>
              <View style={styles.podiumStatsRow}>
                <View style={styles.podiumStat}>
                  <MaterialIcons name="chat-bubble-outline" size={12} color="#555" />
                  <Text style={styles.podiumStatTxt}>{r.totalComments}</Text>
                </View>
                <View style={styles.podiumStat}>
                  <MaterialIcons name="article" size={12} color="#555" />
                  <Text style={styles.podiumStatTxt}>{r.articleCount}</Text>
                </View>
              </View>
              <TouchableOpacity
                testID={`podium-follow-${rank}`}
                style={[styles.podiumFollowBtn, isFollowed && styles.podiumFollowBtnActive]}
                onPress={(e) => {
                  e.stopPropagation();
                  onFollow(r.name);
                }}
              >
                <Ionicons
                  name={isFollowed ? 'checkmark' : 'add'}
                  size={13}
                  color={isFollowed ? '#fff' : BRAND.primary}
                />
                <Text style={[styles.podiumFollowTxt, isFollowed && styles.podiumFollowTxtActive]}>
                  {isFollowed
                    ? (isKn ? 'ಅನುಸರಿಸಲಾಗಿದೆ' : 'Following')
                    : (isKn ? 'ಅನುಸರಿಸಿ' : 'Follow')}
                </Text>
              </TouchableOpacity>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* See all button */}
      {rest.length > 0 && (
        <TouchableOpacity
          testID="leaderboard-expand-btn"
          style={styles.expandBtn}
          onPress={() => setExpanded(x => !x)}
          activeOpacity={0.8}
        >
          <Text style={styles.expandBtnTxt}>
            {expanded
              ? (isKn ? 'ಮುಚ್ಚಿ' : 'Hide rankings')
              : (isKn ? `ಎಲ್ಲಾ ${ranked.length} ವರದಿಗಾರರನ್ನು ನೋಡಿ` : `See all ${ranked.length} rankings`)}
          </Text>
          <MaterialIcons
            name={expanded ? 'expand-less' : 'expand-more'}
            size={18}
            color={BRAND.primary}
          />
        </TouchableOpacity>
      )}

      {/* Expanded list rows 4-10 */}
      {expanded && (
        <View style={styles.expandedList}>
          {rest.map((r, i) => {
            const rank = i + 4;
            const isFollowed = followed.includes(r.name);
            return (
              <View
                key={r.name}
                style={styles.listRow}
                testID={`leaderboard-row-${rank}`}
              >
                <View style={styles.listRankPill}>
                  <Text style={styles.listRankTxt}>#{rank}</Text>
                </View>
                <ReporterAvatar name={r.name} size={38} />
                <View style={styles.listInfo}>
                  <Text style={styles.listName} numberOfLines={1}>{r.name}</Text>
                  <Text style={styles.listSub}>
                    {r.totalComments} {isKn ? 'ಪ್ರತಿಕ್ರಿಯೆಗಳು' : 'comments'} · {r.articleCount} {isKn ? 'ಲೇಖನಗಳು' : 'articles'}
                  </Text>
                </View>
                <TouchableOpacity
                  testID={`list-follow-${rank}`}
                  style={[styles.listFollowBtn, isFollowed && styles.listFollowBtnActive]}
                  onPress={() => onFollow(r.name)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons
                    name={isFollowed ? 'person-remove-outline' : 'person-add-outline'}
                    size={14}
                    color={isFollowed ? '#fff' : BRAND.primary}
                  />
                </TouchableOpacity>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

// ── Section header ────────────────────────────────────────────────────────────
function SectionHeader({ isKn, onRefresh }: { isKn: boolean; onRefresh: () => void }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.titleRow}>
        <MaterialIcons name="emoji-events" size={20} color={BRAND.gold} />
        <View style={{ flex: 1 }}>
          <Text style={styles.sectionTitle}>
            {isKn ? 'ವಾರದ ವರದಿಗಾರ' : 'Reporter of the Week'}
          </Text>
          <Text style={styles.sectionSub}>
            {isKn ? 'ಕಳೆದ 7 ದಿನಗಳ ರ್ಯಾಂಕಿಂಗ್' : 'Ranked by community engagement (last 7 days)'}
          </Text>
        </View>
        <TouchableOpacity
          testID="leaderboard-refresh-btn"
          style={styles.refreshBtn}
          onPress={() => {
            onRefresh();
            showToast(isKn ? 'ರ್ಯಾಂಕಿಂಗ್ ರಿಫ್ರೆಶ್...' : 'Refreshing rankings...', 'info', 1500);
          }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialIcons name="refresh" size={18} color={BRAND.primary} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderRadius: 16,
    marginHorizontal: 12,
    marginTop: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.9)',
    overflow: 'hidden',
  },
  sectionHeader: { paddingHorizontal: 14, paddingTop: 14, paddingBottom: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { fontSize: 15, fontWeight: '900', color: '#111' },
  sectionSub: { fontSize: 11, color: '#888', marginTop: 1 },
  refreshBtn: { padding: 6 },

  // Loading / empty
  loadingBox: { alignItems: 'center', paddingVertical: 24, gap: 8 },
  loadingText: { color: '#888', fontSize: 12 },
  emptyBox: { alignItems: 'center', paddingVertical: 24, gap: 8 },
  emptyText: { color: '#999', fontSize: 12, textAlign: 'center' },

  // Podium
  podiumRow: { paddingHorizontal: 12, paddingBottom: 12, gap: 10 },
  podiumCard: {
    width: 148,
    borderWidth: 2,
    borderRadius: 14,
    padding: 12,
    alignItems: 'center',
    gap: 6,
  },
  podiumRankPill: {
    backgroundColor: 'rgba(255,255,255,0.8)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  podiumRankTxt: { fontSize: 11, fontWeight: '800', color: '#333' },
  podiumName: { fontSize: 13, fontWeight: '800', color: '#111', textAlign: 'center', marginTop: 2, width: '100%' },
  podiumStatsRow: { flexDirection: 'row', gap: 10, marginTop: 2 },
  podiumStat: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  podiumStatTxt: { fontSize: 11, color: '#555', fontWeight: '700' },
  podiumFollowBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1, borderColor: BRAND.primary,
    backgroundColor: '#fff',
    marginTop: 4,
  },
  podiumFollowBtnActive: { backgroundColor: BRAND.primary, borderColor: BRAND.primary },
  podiumFollowTxt: { fontSize: 11, fontWeight: '700', color: BRAND.primary },
  podiumFollowTxtActive: { color: '#fff' },

  // Expand button
  expandBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
  },
  expandBtnTxt: { color: BRAND.primary, fontSize: 12, fontWeight: '700' },

  // Expanded list
  expandedList: {
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 12,
    gap: 8,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 8,
    backgroundColor: 'rgba(255,255,255,0.7)',
    borderRadius: 10,
  },
  listRankPill: {
    minWidth: 30,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: '#F0F0F0',
    alignItems: 'center',
  },
  listRankTxt: { fontSize: 11, fontWeight: '800', color: '#666' },
  listInfo: { flex: 1 },
  listName: { fontSize: 13, fontWeight: '700', color: '#111' },
  listSub: { fontSize: 10, color: '#999', marginTop: 1 },
  listFollowBtn: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: BRAND.primary,
    backgroundColor: '#fff',
  },
  listFollowBtnActive: { backgroundColor: BRAND.primary, borderColor: BRAND.primary },

  // Avatar
  avatar: { alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' },
  avatarInitials: { color: '#fff', fontWeight: '900' },
});
