/**
 * CommentSheet — Native in-app comment bottom sheet
 *
 * Supports three sources:
 *  • source='ps'      : fetches & posts to Cloudflare D1 (Public Samachar videos)
 *  • source='youtube' : fetches YouTube commentThreads via backend (read-only)
 *  • source='wp'      : fetches WordPress comments + allows posting
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  FlatList,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Image,
  Dimensions,
} from 'react-native';
import { MaterialIcons, Ionicons } from '@expo/vector-icons';
import { formatDate } from '../utils/api';
import { showToast } from './Toast';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';
const { height: SCREEN_H } = Dimensions.get('window');

export interface CommentItem {
  id: string | number;
  author: string;
  author_image: string;
  text: string;
  date: string;
  like_count?: number;
  reply_count?: number;
}

export interface CommentSheetProps {
  visible: boolean;
  onClose: () => void;
  source: 'youtube' | 'wp' | 'ps';
  contentId: string | number;
  title: string;
}

export default function CommentSheet({
  visible,
  onClose,
  source,
  contentId,
  title,
}: CommentSheetProps) {
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [authorName, setAuthorName] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [inputError, setInputError] = useState('');

  useEffect(() => {
    if (visible && contentId) {
      fetchComments();
    } else {
      setComments([]);
      setErrorMsg('');
      setInputError('');
    }
  }, [visible, contentId]);

  const fetchComments = useCallback(async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      let url: string;
      if (source === 'ps') {
        // Use new dedicated D1 comments endpoint
        url = `${BACKEND_URL}/api/cf/comments/${contentId}`;
      } else {
        url = `${BACKEND_URL}/api/comments?source=${source}&id=${contentId}`;
      }
      const res = await fetch(url);
      const data = await res.json();
      setComments(data.comments || []);
      if (data.scope_error) {
        setErrorMsg('__SCOPE_ERROR__');
      } else if (data.error) {
        setErrorMsg(data.error);
      }
    } catch {
      setErrorMsg('Failed to load comments. Check your connection.');
    }
    setLoading(false);
  }, [source, contentId]);

  const postComment = async () => {
    if ((source === 'wp' || source === 'ps') && !authorName.trim()) {
      setInputError('Please enter your name.');
      return;
    }
    if (!commentText.trim()) {
      setInputError('Please write a comment.');
      return;
    }
    setInputError('');
    setPosting(true);
    try {
      if (source === 'youtube') {
        // Post YouTube comment via commentThreads.insert
        const res = await fetch(`${BACKEND_URL}/api/yt-comment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ video_id: contentId, text: commentText.trim() }),
        });
        const data = await res.json();
        if (data.success) {
          const newComment: CommentItem = {
            id: data.comment_id || Date.now(),
            author: data.author || 'You',
            author_image: '',
            text: commentText.trim(),
            date: new Date().toISOString(),
            like_count: 0,
          };
          setComments(prev => [newComment, ...prev]);
          setCommentText('');
          showToast('Comment posted to YouTube!', 'success');
        } else {
          showToast(data.detail || 'Failed to post comment', 'error');
        }
      } else if (source === 'ps') {
        // Post to Cloudflare D1 using new dedicated endpoint
        const res = await fetch(`${BACKEND_URL}/api/cf/comments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            video_id: contentId,
            content: commentText.trim(),
            author_name: authorName.trim() || 'Anonymous',
          }),
        });
        const data = await res.json();
        if (data.success) {
          const newComment: CommentItem = {
            id: data.comment_id || Date.now(),
            author: authorName.trim() || 'Anonymous',
            author_image: '',
            text: commentText.trim(),
            date: new Date().toISOString(),
            like_count: 0,
          };
          setComments(prev => [newComment, ...prev]);
          setCommentText('');
        } else {
          showToast(data.detail || 'Failed to post comment', 'error');
        }
      } else {
        // Post WordPress comment
        const res = await fetch(`${BACKEND_URL}/api/comment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source,
            id: contentId,
            content: commentText.trim(),
            author_name: authorName.trim(),
            author_email: `${authorName.toLowerCase().replace(/\s+/g, '.')}@reader.publicsamachar.com`,
          }),
        });
        const data = await res.json();
        if (data.success) {
          const newComment: CommentItem = {
            id: data.comment_id || Date.now(),
            author: authorName.trim(),
            author_image: '',
            text: commentText.trim(),
            date: new Date().toISOString(),
            like_count: 0,
          };
          setComments(prev => [newComment, ...prev]);
          setCommentText('');
          showToast('Comment pending approval.', 'success');
        } else {
          showToast(data.detail || 'Failed to post comment', 'error');
        }
      }
    } catch {
      showToast('Failed to post comment. Try again.', 'error');
    }
    setPosting(false);
  };

  const renderComment = ({ item }: { item: CommentItem }) => (
    <View style={s.commentItem}>
      <View style={s.commentAvatarWrap}>
        {item.author_image ? (
          <Image source={{ uri: item.author_image }} style={s.avatarImg} />
        ) : (
          <View style={s.avatarFallback}>
            <Text style={s.avatarInitial}>
              {(item.author || 'A')[0].toUpperCase()}
            </Text>
          </View>
        )}
      </View>
      <View style={s.commentBody}>
        <View style={s.commentMeta}>
          <Text style={s.commentAuthor}>{item.author}</Text>
          <Text style={s.commentDate}>{formatDate(item.date)}</Text>
        </View>
        <Text style={s.commentText}>{item.text}</Text>
        {(item.like_count || 0) > 0 && (
          <View style={s.commentStats}>
            <MaterialIcons name="thumb-up" size={11} color="#999" />
            <Text style={s.commentStatText}>{item.like_count}</Text>
          </View>
        )}
      </View>
    </View>
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={s.overlay}>
        <TouchableOpacity style={s.dismissArea} activeOpacity={1} onPress={onClose} />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={[s.sheet, { maxHeight: SCREEN_H * 0.78 }]}
        >
          {/* Drag handle */}
          <View style={s.handle} />

          {/* Header */}
          <View style={s.header}>
            <MaterialIcons name="chat-bubble-outline" size={20} color="#1AAA94" />
            <Text style={s.headerTitle} numberOfLines={1}>
              {comments.length > 0 ? `Comments (${comments.length})` : 'Comments'}
            </Text>
            <TouchableOpacity onPress={onClose} style={s.closeBtn}>
              <MaterialIcons name="close" size={22} color="#555" />
            </TouchableOpacity>
          </View>

          {/* Source badge */}
          <View style={s.sourceBadge}>
            {source === 'youtube' ? (
              <>
                <Ionicons name="logo-youtube" size={13} color="#FF0000" />
                <Text style={s.sourceBadgeText}>YouTube · Comments</Text>
              </>
            ) : (
              <>
                <MaterialIcons name="public" size={13} color="#1AAA94" />
                <Text style={[s.sourceBadgeText, { color: '#1AAA94' }]}>
                  Public Samachar · Website comments
                </Text>
              </>
            )}
          </View>

          {/* Body */}
          {loading ? (
            <View style={s.centered}>
              <ActivityIndicator size="large" color="#1AAA94" />
              <Text style={s.loadingText}>Loading comments...</Text>
            </View>
          ) : errorMsg === '__SCOPE_ERROR__' ? (
            /* ── YouTube scope upgrade needed ─────────────────────────── */
            <View style={s.centered}>
              <Ionicons name="logo-youtube" size={52} color="#FF4444" style={{ marginBottom: 4 }} />
              <Text style={s.scopeTitle}>YouTube Comments Upgrade Needed</Text>
              <Text style={s.scopeBody}>
                The current YouTube connection only has{'\n'}
                <Text style={{ fontWeight: '700' }}>upload-only</Text> permissions.{'\n\n'}
                To enable reading & writing YouTube comments, the admin must re-link the YouTube account with{' '}
                <Text style={{ fontWeight: '700' }}>read permission</Text> enabled.
              </Text>
              <View style={s.scopeStepBox}>
                <Text style={s.scopeStep}>1. Go to Google Cloud Console</Text>
                <Text style={s.scopeStep}>2. Add scope: youtube.readonly</Text>
                <Text style={s.scopeStep}>3. Re-authenticate the YouTube account</Text>
              </View>
            </View>
          ) : errorMsg ? (
            <View style={s.centered}>
              <MaterialIcons name="error-outline" size={44} color="#ccc" />
              <Text style={s.errorText}>{errorMsg}</Text>
              <TouchableOpacity style={s.retryBtn} onPress={fetchComments}>
                <Text style={s.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : comments.length === 0 ? (
            <View style={s.centered}>
              <Ionicons name="chatbubble-outline" size={52} color="#E0E0E0" />
              <Text style={s.emptyTitle}>No comments yet</Text>
              {(source === 'wp' || source === 'ps') && (
                <Text style={s.emptySubText}>Be the first to share your thoughts!</Text>
              )}
            </View>
          ) : (
            <FlatList
              data={comments}
              renderItem={renderComment}
              keyExtractor={item => String(item.id)}
              style={s.list}
              contentContainerStyle={{ paddingBottom: 8 }}
              showsVerticalScrollIndicator={false}
            />
          )}

          {/* Comment input — always visible at the bottom for wp/ps/youtube */}
          {errorMsg !== '__SCOPE_ERROR__' && (
            <View style={s.inputArea}>
              {(source === 'wp' || source === 'ps') && (
                <TextInput
                  style={s.nameInput}
                  value={authorName}
                  onChangeText={t => { setAuthorName(t); if (inputError) setInputError(''); }}
                  placeholder="Your name"
                  placeholderTextColor="#bbb"
                  maxLength={50}
                />
              )}
              <View style={s.inputRow}>
                <TextInput
                  style={s.textInput}
                  value={commentText}
                  onChangeText={t => { setCommentText(t); if (inputError) setInputError(''); }}
                  placeholder={source === 'youtube' ? 'Write a YouTube comment...' : 'Write a comment...'}
                  placeholderTextColor="#bbb"
                  multiline
                  maxLength={500}
                />
                <TouchableOpacity
                  style={[s.postBtn, posting && s.postBtnDisabled]}
                  onPress={postComment}
                  disabled={posting}
                >
                  {posting ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <MaterialIcons name="send" size={15} color="#fff" />
                      <Text style={s.postBtnText}>Post</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
              {inputError ? (
                <Text style={s.inputErrorText}>{inputError}</Text>
              ) : null}
            </View>
          )}
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  dismissArea: { flex: 1 },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    minHeight: 300,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 20,
  },
  handle: {
    width: 44,
    height: 4,
    backgroundColor: '#E0E0E0',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    gap: 8,
  },
  headerTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '800',
    color: '#1AAA94',
  },
  closeBtn: { padding: 4 },
  sourceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 16,
    paddingVertical: 7,
    backgroundColor: '#F9F9F9',
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  sourceBadgeText: { fontSize: 11, color: '#888', fontWeight: '600' },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    paddingHorizontal: 24,
    gap: 10,
    minHeight: 160,
  },
  loadingText: { fontSize: 13, color: '#999', marginTop: 8 },
  errorText: { fontSize: 13, color: '#888', textAlign: 'center', lineHeight: 19 },
  retryBtn: {
    backgroundColor: '#E6F7F3',
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 8,
    marginTop: 4,
  },
  retryText: { color: '#1AAA94', fontWeight: '700', fontSize: 13 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#555' },
  emptySubText: { fontSize: 13, color: '#aaa', textAlign: 'center' },
  // YouTube scope upgrade styles
  scopeTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#CC0000',
    textAlign: 'center',
    marginBottom: 8,
  },
  scopeBody: {
    fontSize: 13,
    color: '#555',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 14,
  },
  scopeStepBox: {
    backgroundColor: '#FFF3E0',
    borderRadius: 10,
    padding: 12,
    width: '100%',
    gap: 4,
  },
  scopeStep: {
    fontSize: 12,
    color: '#E65100',
    fontWeight: '600',
  },
  list: { flex: 1, paddingHorizontal: 12, paddingTop: 8 },
  commentItem: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F5F5F5',
  },
  commentAvatarWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
    marginTop: 2,
  },
  avatarImg: { width: 36, height: 36, borderRadius: 18 },
  avatarFallback: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#E6F7F3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontSize: 14, fontWeight: '800', color: '#1AAA94' },
  commentBody: { flex: 1 },
  commentMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 3,
  },
  commentAuthor: { fontSize: 13, fontWeight: '700', color: '#222' },
  commentDate: { fontSize: 10, color: '#bbb' },
  commentText: { fontSize: 13, color: '#333', lineHeight: 18 },
  commentStats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 5,
  },
  commentStatText: { fontSize: 11, color: '#999' },
  inputArea: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    gap: 6,
    backgroundColor: '#fff',
  },
  nameInput: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 8,
    padding: 8,
    fontSize: 13,
    color: '#333',
    backgroundColor: '#FAFAFA',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  textInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 10,
    padding: 10,
    fontSize: 13,
    color: '#333',
    backgroundColor: '#FAFAFA',
    maxHeight: 90,
    minHeight: 42,
  },
  postBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    height: 42,
    minWidth: 78,
    paddingHorizontal: 16,
    borderRadius: 21,
    backgroundColor: '#1AAA94',
  },
  postBtnDisabled: { backgroundColor: '#90A4AE' },
  postBtnText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  inputErrorText: { color: '#D32F2F', fontSize: 12, fontWeight: '600', paddingLeft: 4 },
});
