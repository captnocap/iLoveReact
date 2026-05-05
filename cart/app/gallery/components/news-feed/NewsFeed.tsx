// NewsFeed — gallery component bound to the `NewsFeedPost` data shape.
//
// Source of truth: cart/app/gallery/data/news-feed-post.ts
//
// Top-level fields on `NewsFeedPost`:
//   id: string
//   authorUserId: string
//   author: NewsFeedAuthor
//   body: string
//   createdAt: string
//   visibility: NewsFeedVisibility
//   topics: string[]
//   likeCount: number
//   repostCount: number
//   commentCount: number
//   shareCount: number
//   likedByViewer: boolean
//   repostedByViewer: boolean
//   bookmarkedByViewer: boolean
//   attachment?: NewsFeedAttachment
//   commentsPreview: NewsFeedComment[]
//
// Available exports from the shape file:
//   newsFeedPostMockData: NewsFeedPost[]    — seeded mock rows for stories
//   newsFeedPostSchema: JsonObject    — JSON schema
//   newsFeedPostReferences: GalleryDataReference[]    — cross-shape links
//
// Rules for filling out this component:
//   - DO NOT invent fields. Only consume `NewsFeedPost` keys
//     listed above. If a field you want is missing, extend the shape
//     file first — never fake it locally.
//   - The story imports `newsFeedPostMockData`
//     and renders against real seeded rows. Do not hand-roll mock
//     props inside the story.
//   - If this component renders a *list* of rows, change the `row`
//     prop to `rows: NewsFeedPost[]` and update the variant
//     accordingly.

import { useMemo, useState } from 'react';
import { Box, Col, Pressable, Row, ScrollView, Text } from '@reactjit/runtime/primitives';
import type { NewsFeedPost } from '../../data/overstock/news-feed-post';
import { FeedComposer, type FeedComposerAuthor } from './FeedComposer';
import { FeedPostCard } from './FeedPostCard';

export type NewsFeedProps = {
  rows: NewsFeedPost[];
  currentAuthor?: FeedComposerAuthor;
};

type FeedTab = 'for-you' | 'following' | 'saved';

const CURRENT_AUTHOR: FeedComposerAuthor = {
  name: 'You',
  handle: '@local',
  initials: 'YU',
};

const COLORS = {
  bg: 'theme:bg',
  panel: 'theme:bg1',
  panelRaised: 'theme:bg2',
  rule: 'theme:rule',
  ruleBright: 'theme:ruleBright',
  ink: 'theme:ink',
  inkDim: 'theme:inkDim',
  inkFaint: 'theme:inkDimmer',
  accent: 'theme:accent',
  success: 'theme:ok',
};

const FEED_TABS: Array<{ id: FeedTab; label: string }> = [
  { id: 'for-you', label: 'For You' },
  { id: 'following', label: 'Following' },
  { id: 'saved', label: 'Saved' },
];

function cloneRows(rows: NewsFeedPost[]): NewsFeedPost[] {
  return rows.map((row) => ({
    ...row,
    author: { ...row.author },
    topics: [...row.topics],
    attachment: row.attachment ? { ...row.attachment } : undefined,
    commentsPreview: row.commentsPreview.map((comment) => ({ ...comment })),
  }));
}

function makeDraftPost(body: string, author: FeedComposerAuthor, index: number): NewsFeedPost {
  return {
    id: `feed_post_local_${index}`,
    authorUserId: 'user_local',
    author: {
      id: 'author_local',
      displayName: author.name,
      handle: author.handle,
      avatarInitials: author.initials,
      role: 'Posting now',
    },
    body,
    createdAt: '2026-04-28T16:02:00Z',
    visibility: 'public',
    topics: ['local', 'draft'],
    likeCount: 0,
    repostCount: 0,
    commentCount: 0,
    shareCount: 0,
    likedByViewer: false,
    repostedByViewer: false,
    bookmarkedByViewer: false,
    commentsPreview: [],
  };
}

function TabButton({ active, label, count, onPress }: { active: boolean; label: string; count: number; onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <Row
        style={{
          height: 34,
          minWidth: 112,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 7,
          paddingLeft: 12,
          paddingRight: 12,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: active ? COLORS.ruleBright : COLORS.rule,
          backgroundColor: active ? COLORS.panelRaised : COLORS.panel,
        }}
      >
        <Text style={{ fontSize: 12, fontWeight: 'bold', color: active ? COLORS.ink : COLORS.inkDim }}>{label}</Text>
        <Text style={{ fontSize: 10, color: active ? COLORS.accent : COLORS.inkFaint }}>{count}</Text>
      </Row>
    </Pressable>
  );
}

function EmptyFeed({ label }: { label: string }) {
  return (
    <Col
      style={{
        minHeight: 180,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: COLORS.rule,
        backgroundColor: COLORS.panel,
      }}
    >
      <Text style={{ fontSize: 15, fontWeight: 'bold', color: COLORS.ink }}>No {label.toLowerCase()} posts</Text>
      <Text style={{ fontSize: 12, color: COLORS.inkFaint }}>New activity will appear here.</Text>
    </Col>
  );
}

export function NewsFeed({ rows, currentAuthor = CURRENT_AUTHOR }: NewsFeedProps) {
  const [posts, setPosts] = useState<NewsFeedPost[]>(() => cloneRows(rows));
  const [activeTab, setActiveTab] = useState<FeedTab>('for-you');
  const [draft, setDraft] = useState('');
  const [localPostIndex, setLocalPostIndex] = useState(1);
  const [activeCommentPostId, setActiveCommentPostId] = useState<string | null>(null);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});

  const counts = useMemo(
    () => ({
      'for-you': posts.length,
      following: posts.filter((post) => post.visibility === 'followers' || post.author.verified).length,
      saved: posts.filter((post) => post.bookmarkedByViewer).length,
    }),
    [posts]
  );

  const visiblePosts = useMemo(() => {
    if (activeTab === 'following') return posts.filter((post) => post.visibility === 'followers' || post.author.verified);
    if (activeTab === 'saved') return posts.filter((post) => post.bookmarkedByViewer);
    return posts;
  }, [activeTab, posts]);

  const updatePost = (id: string, nextPost: (post: NewsFeedPost) => NewsFeedPost) => {
    setPosts((current) => current.map((post) => (post.id === id ? nextPost(post) : post)));
  };

  const submitDraft = () => {
    const body = draft.trim();
    if (!body) return;
    setPosts((current) => [makeDraftPost(body, currentAuthor, localPostIndex), ...current]);
    setLocalPostIndex((value) => value + 1);
    setDraft('');
    setActiveTab('for-you');
  };

  const submitComment = (postId: string) => {
    const body = (commentDrafts[postId] || '').trim();
    if (!body) return;
    updatePost(postId, (post) => ({
      ...post,
      commentCount: post.commentCount + 1,
      commentsPreview: [
        {
          id: `comment_local_${post.commentCount + 1}`,
          authorName: currentAuthor.name,
          authorHandle: currentAuthor.handle,
          body,
          createdAt: 'now',
          likeCount: 0,
        },
        ...post.commentsPreview,
      ],
    }));
    setCommentDrafts((current) => ({ ...current, [postId]: '' }));
  };

  return (
    <Col
      style={{
        width: '100%',
        height: '100%',
        minHeight: 0,
        backgroundColor: COLORS.bg,
        borderRadius: 8,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: COLORS.ruleBright,
      }}
    >
      <Row
        style={{
          paddingLeft: 18,
          paddingRight: 18,
          paddingTop: 14,
          paddingBottom: 14,
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          borderBottomWidth: 1,
          borderBottomColor: COLORS.rule,
          backgroundColor: COLORS.panel,
        }}
      >
        <Col style={{ gap: 3 }}>
          <Text style={{ fontSize: 20, fontWeight: 'bold', color: COLORS.ink }}>News Feed</Text>
        </Col>
        <Row style={{ gap: 8, alignItems: 'center' }}>
          <Box style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.success }} />
          <Text style={{ fontSize: 11, fontWeight: 'bold', color: COLORS.inkDim }}>{posts.length} posts</Text>
        </Row>
      </Row>

      <Row style={{ gap: 8, padding: 12, borderBottomWidth: 1, borderBottomColor: COLORS.rule, flexWrap: 'wrap' }}>
        {FEED_TABS.map((tab) => (
          <TabButton
            key={tab.id}
            active={activeTab === tab.id}
            label={tab.label}
            count={counts[tab.id]}
            onPress={() => setActiveTab(tab.id)}
          />
        ))}
      </Row>

      <ScrollView showScrollbar={true} style={{ flexGrow: 1, flexBasis: 0, minHeight: 0 }}>
        <Col style={{ width: '100%', maxWidth: 720, alignSelf: 'center', gap: 12, padding: 14 }}>
          <FeedComposer author={currentAuthor} value={draft} onChange={setDraft} onSubmit={submitDraft} />
          {visiblePosts.length > 0 ? (
            visiblePosts.map((post) => (
              <FeedPostCard
                key={post.id}
                post={post}
                commentOpen={activeCommentPostId === post.id}
                commentDraft={commentDrafts[post.id] || ''}
                onLike={(id) =>
                  updatePost(id, (target) => ({
                    ...target,
                    likedByViewer: !target.likedByViewer,
                    likeCount: Math.max(0, target.likeCount + (target.likedByViewer ? -1 : 1)),
                  }))
                }
                onRepost={(id) =>
                  updatePost(id, (target) => ({
                    ...target,
                    repostedByViewer: !target.repostedByViewer,
                    repostCount: Math.max(0, target.repostCount + (target.repostedByViewer ? -1 : 1)),
                  }))
                }
                onComment={(id) => setActiveCommentPostId((current) => (current === id ? null : id))}
                onShare={(id) => updatePost(id, (target) => ({ ...target, shareCount: target.shareCount + 1 }))}
                onBookmark={(id) =>
                  updatePost(id, (target) => ({
                    ...target,
                    bookmarkedByViewer: !target.bookmarkedByViewer,
                  }))
                }
                onCommentDraftChange={(id, value) => setCommentDrafts((current) => ({ ...current, [id]: value }))}
                onSubmitComment={submitComment}
              />
            ))
          ) : (
            <EmptyFeed label={FEED_TABS.find((tab) => tab.id === activeTab)?.label || 'Feed'} />
          )}
        </Col>
      </ScrollView>
    </Col>
  );
}
