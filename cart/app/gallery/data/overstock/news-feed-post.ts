import type { GalleryDataReference, JsonObject } from '../../types';

export type NewsFeedVisibility = 'public' | 'followers' | 'private';

export type NewsFeedAttachment = {
  kind: 'image' | 'link' | 'poll';
  title: string;
  description?: string;
  accentColor: string;
  backgroundColor: string;
  stats?: string;
};

export type NewsFeedAuthor = {
  id: string;
  displayName: string;
  handle: string;
  avatarInitials: string;
  role?: string;
  verified?: boolean;
};

export type NewsFeedComment = {
  id: string;
  authorName: string;
  authorHandle: string;
  body: string;
  createdAt: string;
  likeCount: number;
  likedByViewer?: boolean;
};

export type NewsFeedPost = {
  id: string;
  authorUserId: string;
  author: NewsFeedAuthor;
  body: string;
  createdAt: string;
  visibility: NewsFeedVisibility;
  topics: string[];
  likeCount: number;
  repostCount: number;
  commentCount: number;
  shareCount: number;
  likedByViewer: boolean;
  repostedByViewer: boolean;
  bookmarkedByViewer: boolean;
  attachment?: NewsFeedAttachment;
  commentsPreview: NewsFeedComment[];
};

export const newsFeedPostSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'NewsFeedPost',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'authorUserId',
      'author',
      'body',
      'createdAt',
      'visibility',
      'topics',
      'likeCount',
      'repostCount',
      'commentCount',
      'shareCount',
      'likedByViewer',
      'repostedByViewer',
      'bookmarkedByViewer',
      'commentsPreview',
    ],
    properties: {
      id: { type: 'string' },
      authorUserId: { type: 'string' },
      author: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'displayName', 'handle', 'avatarInitials'],
        properties: {
          id: { type: 'string' },
          displayName: { type: 'string' },
          handle: { type: 'string' },
          avatarInitials: { type: 'string' },
          role: { type: 'string' },
          verified: { type: 'boolean' },
        },
      },
      body: { type: 'string' },
      createdAt: { type: 'string' },
      visibility: { enum: ['public', 'followers', 'private'] },
      topics: {
        type: 'array',
        items: { type: 'string' },
      },
      likeCount: { type: 'integer', minimum: 0 },
      repostCount: { type: 'integer', minimum: 0 },
      commentCount: { type: 'integer', minimum: 0 },
      shareCount: { type: 'integer', minimum: 0 },
      likedByViewer: { type: 'boolean' },
      repostedByViewer: { type: 'boolean' },
      bookmarkedByViewer: { type: 'boolean' },
      attachment: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'title', 'accentColor', 'backgroundColor'],
        properties: {
          kind: { enum: ['image', 'link', 'poll'] },
          title: { type: 'string' },
          description: { type: 'string' },
          accentColor: { type: 'string' },
          backgroundColor: { type: 'string' },
          stats: { type: 'string' },
        },
      },
      commentsPreview: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'authorName', 'authorHandle', 'body', 'createdAt', 'likeCount'],
          properties: {
            id: { type: 'string' },
            authorName: { type: 'string' },
            authorHandle: { type: 'string' },
            body: { type: 'string' },
            createdAt: { type: 'string' },
            likeCount: { type: 'integer', minimum: 0 },
            likedByViewer: { type: 'boolean' },
          },
        },
      },
    },
  },
};

export const newsFeedPostMockData: NewsFeedPost[] = [
  {
    id: 'feed_post_001',
    authorUserId: 'user_local',
    author: {
      id: 'author_mira',
      displayName: 'Mira Chen',
      handle: '@mira-builds',
      avatarInitials: 'MC',
      role: 'Product engineer',
      verified: true,
    },
    body:
      'Shipped a compact command composer today. The good part was not the input, it was making every pending action visible before the user commits.',
    createdAt: '2026-04-28T15:04:00Z',
    visibility: 'public',
    topics: ['release', 'ui-systems', 'workflow'],
    likeCount: 128,
    repostCount: 34,
    commentCount: 18,
    shareCount: 9,
    likedByViewer: false,
    repostedByViewer: false,
    bookmarkedByViewer: true,
    attachment: {
      kind: 'image',
      title: 'Composer audit trail',
      description: 'Three command cards stacked with status rails and inline context.',
      accentColor: 'theme:accent',
      backgroundColor: 'theme:bg2',
      stats: '4 panels, 12 pending actions',
    },
    commentsPreview: [
      {
        id: 'comment_001',
        authorName: 'Talia Root',
        authorHandle: '@talia',
        body: 'The pending-action preview is the part every tool keeps hiding.',
        createdAt: '2026-04-28T15:11:00Z',
        likeCount: 11,
      },
      {
        id: 'comment_002',
        authorName: 'Jon Bell',
        authorHandle: '@jonbell',
        body: 'Would love to see this with conflict hints beside the action label.',
        createdAt: '2026-04-28T15:18:00Z',
        likeCount: 7,
        likedByViewer: true,
      },
    ],
  },
  {
    id: 'feed_post_002',
    authorUserId: 'user_skipped_example',
    author: {
      id: 'author_lev',
      displayName: 'Lev Ortiz',
      handle: '@lev-live',
      avatarInitials: 'LO',
      role: 'Design systems',
    },
    body:
      'Status text should answer what changed, who caused it, and what happens next. Anything more belongs behind a disclosure.',
    createdAt: '2026-04-28T13:42:00Z',
    visibility: 'followers',
    topics: ['status', 'copy', 'design-systems'],
    likeCount: 76,
    repostCount: 12,
    commentCount: 9,
    shareCount: 4,
    likedByViewer: true,
    repostedByViewer: false,
    bookmarkedByViewer: false,
    attachment: {
      kind: 'link',
      title: 'Notification contract notes',
      description: 'Severity, source, lifetime, action set, and optional reply state.',
      accentColor: 'theme:ok',
      backgroundColor: 'theme:bg2',
      stats: '5 fields worth keeping',
    },
    commentsPreview: [
      {
        id: 'comment_003',
        authorName: 'Ari Quinn',
        authorHandle: '@ariq',
        body: 'This is a useful bar for system notifications too.',
        createdAt: '2026-04-28T13:51:00Z',
        likeCount: 5,
      },
    ],
  },
  {
    id: 'feed_post_003',
    authorUserId: 'user_local',
    author: {
      id: 'author_sam',
      displayName: 'Sam Park',
      handle: '@sam-systems',
      avatarInitials: 'SP',
      role: 'Infrastructure',
      verified: true,
    },
    body:
      'The feed should make interaction state boring: one clear composer, durable counters, comment affordance, repost affordance, and a place for media without changing layout.',
    createdAt: '2026-04-28T12:16:00Z',
    visibility: 'public',
    topics: ['feeds', 'interaction', 'runtime'],
    likeCount: 214,
    repostCount: 51,
    commentCount: 27,
    shareCount: 13,
    likedByViewer: false,
    repostedByViewer: true,
    bookmarkedByViewer: false,
    attachment: {
      kind: 'poll',
      title: 'Primary feed action',
      description: 'Which action deserves the strongest hover target?',
      accentColor: 'theme:lilac',
      backgroundColor: 'theme:bg2',
      stats: '58 percent chose comment',
    },
    commentsPreview: [
      {
        id: 'comment_004',
        authorName: 'Priya Sen',
        authorHandle: '@priya',
        body: 'Comment first, but only when the thread has enough context.',
        createdAt: '2026-04-28T12:28:00Z',
        likeCount: 13,
      },
      {
        id: 'comment_005',
        authorName: 'Noah Key',
        authorHandle: '@nkey',
        body: 'Bookmarks need to be quiet but impossible to miss.',
        createdAt: '2026-04-28T12:33:00Z',
        likeCount: 8,
      },
    ],
  },
];

export const newsFeedPostReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'Author user',
    targetSource: 'cart/app/gallery/data/user.ts',
    sourceField: 'authorUserId',
    targetField: 'id',
    summary: 'Connects a feed post to the account that authored it when the author is a local user.',
  },
];
