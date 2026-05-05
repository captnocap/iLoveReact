import { Box, Col, Pressable, Row, Text, TextInput } from '@reactjit/runtime/primitives';
import { Icon } from '@reactjit/runtime/icons/Icon';
import {
  BadgeCheck,
  Bookmark,
  Forward,
  Heart,
  MessageSquare,
  MoreHorizontal,
  Repeat2,
  Send,
} from '@reactjit/runtime/icons/icons';
import type { NewsFeedAttachment, NewsFeedPost } from '../../data/overstock/news-feed-post';
import { FeedActionButton } from './FeedActionButton';

export type FeedPostCardProps = {
  post: NewsFeedPost;
  commentDraft?: string;
  commentOpen?: boolean;
  onLike: (id: string) => void;
  onRepost: (id: string) => void;
  onComment: (id: string) => void;
  onShare: (id: string) => void;
  onBookmark: (id: string) => void;
  onCommentDraftChange: (id: string, value: string) => void;
  onSubmitComment: (id: string) => void;
};

const COLORS = {
  card: 'theme:bg1',
  cardRaised: 'theme:bg2',
  cardSubtle: 'theme:bg',
  rule: 'theme:rule',
  ruleBright: 'theme:ruleBright',
  ink: 'theme:ink',
  inkDim: 'theme:inkDim',
  inkFaint: 'theme:inkDimmer',
  accent: 'theme:accent',
  repost: 'theme:ok',
  comment: 'theme:blue',
  share: 'theme:lilac',
};

function formatRelativeTime(iso: string): string {
  if (iso.includes('15:')) return '26m';
  if (iso.includes('13:')) return '2h';
  if (iso.includes('12:')) return '3h';
  return 'now';
}

function readInputValue(value: any): string {
  if (typeof value === 'string') return value;
  if (typeof value?.text === 'string') return value.text;
  if (typeof value?.value === 'string') return value.value;
  if (typeof value?.target?.value === 'string') return value.target.value;
  return value == null ? '' : String(value);
}

function TopicChip({ label }: { label: string }) {
  return (
    <Box
      style={{
        paddingLeft: 7,
        paddingRight: 7,
        paddingTop: 3,
        paddingBottom: 3,
        borderRadius: 5,
        borderWidth: 1,
        borderColor: COLORS.rule,
        backgroundColor: COLORS.cardRaised,
      }}
    >
      <Text style={{ fontSize: 10, fontWeight: 'bold', color: COLORS.inkDim }}>#{label}</Text>
    </Box>
  );
}

function VisibilityBadge({ value }: { value: NewsFeedPost['visibility'] }) {
  const label = value === 'followers' ? 'Followers' : value === 'private' ? 'Private' : 'Public';
  return (
    <Box
      style={{
        paddingLeft: 7,
        paddingRight: 7,
        paddingTop: 3,
        paddingBottom: 3,
        borderRadius: 5,
        backgroundColor: COLORS.cardRaised,
        borderWidth: 1,
        borderColor: value === 'public' ? 'theme:ok' : COLORS.rule,
      }}
    >
      <Text style={{ fontSize: 10, fontWeight: 'bold', color: value === 'public' ? 'theme:tool' : COLORS.inkDim }}>
        {label}
      </Text>
    </Box>
  );
}

function AttachmentPreview({ attachment }: { attachment: NewsFeedAttachment }) {
  return (
    <Row
      style={{
        minHeight: 112,
        borderRadius: 7,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: COLORS.rule,
        backgroundColor: attachment.backgroundColor,
      }}
    >
      <Box style={{ width: 8, alignSelf: 'stretch', backgroundColor: attachment.accentColor }} />
      <Col style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, padding: 13, gap: 8, justifyContent: 'space-between' }}>
        <Col style={{ gap: 6 }}>
          <Row style={{ gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
            <Text
              style={{
                fontSize: 9,
                fontWeight: 'bold',
                color: attachment.accentColor,
                textTransform: 'uppercase',
              }}
            >
              {attachment.kind}
            </Text>
            {attachment.stats ? <Text style={{ fontSize: 10, color: COLORS.inkFaint }}>{attachment.stats}</Text> : null}
          </Row>
          <Text style={{ fontSize: 15, fontWeight: 'bold', color: COLORS.ink }}>{attachment.title}</Text>
          {attachment.description ? (
            <Text style={{ fontSize: 12, lineHeight: 17, color: COLORS.inkDim }}>{attachment.description}</Text>
          ) : null}
        </Col>
        <Row style={{ gap: 5, alignItems: 'center' }}>
          <Box style={{ width: 34, height: 4, borderRadius: 2, backgroundColor: attachment.accentColor }} />
          <Box style={{ width: 64, height: 4, borderRadius: 2, backgroundColor: 'theme:inkGhost' }} />
          <Box style={{ width: 22, height: 4, borderRadius: 2, backgroundColor: 'theme:inkGhost' }} />
        </Row>
      </Col>
    </Row>
  );
}

function CommentPreview({ comment }: { comment: NewsFeedPost['commentsPreview'][number] }) {
  return (
    <Row style={{ gap: 8, alignItems: 'flex-start' }}>
      <Box
        style={{
          width: 24,
          height: 24,
          borderRadius: 6,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: COLORS.cardRaised,
          borderWidth: 1,
          borderColor: COLORS.rule,
        }}
      >
        <Text style={{ fontSize: 9, fontWeight: 'bold', color: COLORS.inkDim }}>
          {comment.authorName.split(' ').map((part) => part[0]).join('').slice(0, 2)}
        </Text>
      </Box>
      <Col style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, gap: 3 }}>
        <Row style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <Text style={{ fontSize: 11, fontWeight: 'bold', color: COLORS.ink }}>{comment.authorName}</Text>
          <Text style={{ fontSize: 10, color: COLORS.inkFaint }}>{comment.authorHandle}</Text>
          <Text style={{ fontSize: 10, color: COLORS.inkFaint }}>{formatRelativeTime(comment.createdAt)}</Text>
        </Row>
        <Text style={{ fontSize: 11, lineHeight: 16, color: COLORS.inkDim }}>{comment.body}</Text>
      </Col>
      <Row style={{ gap: 4, alignItems: 'center' }}>
        <Icon icon={Heart} size={11} color={comment.likedByViewer ? COLORS.accent : COLORS.inkFaint} strokeWidth={2.1} />
        <Text style={{ fontSize: 9, color: COLORS.inkFaint }}>{comment.likeCount}</Text>
      </Row>
    </Row>
  );
}

export function FeedPostCard({
  post,
  commentDraft = '',
  commentOpen = false,
  onLike,
  onRepost,
  onComment,
  onShare,
  onBookmark,
  onCommentDraftChange,
  onSubmitComment,
}: FeedPostCardProps) {
  return (
    <Col
      style={{
        width: '100%',
        gap: 12,
        padding: 14,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: COLORS.rule,
        backgroundColor: COLORS.card,
      }}
    >
      <Row style={{ gap: 10, alignItems: 'flex-start' }}>
        <Box
          style={{
            width: 42,
            height: 42,
            borderRadius: 9,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: COLORS.cardRaised,
            borderWidth: 1,
            borderColor: COLORS.ruleBright,
          }}
        >
          <Text style={{ fontSize: 13, fontWeight: 'bold', color: COLORS.ink }}>{post.author.avatarInitials}</Text>
        </Box>
        <Col style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, gap: 3 }}>
          <Row style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <Text style={{ fontSize: 14, fontWeight: 'bold', color: COLORS.ink }}>{post.author.displayName}</Text>
            {post.author.verified ? <Icon icon={BadgeCheck} size={14} color={COLORS.comment} strokeWidth={2.1} /> : null}
            <Text style={{ fontSize: 11, color: COLORS.inkFaint }}>{post.author.handle}</Text>
            <Text style={{ fontSize: 11, color: COLORS.inkFaint }}>{formatRelativeTime(post.createdAt)}</Text>
          </Row>
          {post.author.role ? <Text style={{ fontSize: 10, color: COLORS.inkFaint }}>{post.author.role}</Text> : null}
        </Col>
        <Pressable>
          <Box style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}>
            <Icon icon={MoreHorizontal} size={17} color={COLORS.inkFaint} strokeWidth={2.1} />
          </Box>
        </Pressable>
      </Row>

      <Text style={{ fontSize: 14, lineHeight: 20, color: COLORS.ink }}>{post.body}</Text>

      <Row style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <VisibilityBadge value={post.visibility} />
        {post.topics.map((topic) => (
          <TopicChip key={topic} label={topic} />
        ))}
      </Row>

      {post.attachment ? <AttachmentPreview attachment={post.attachment} /> : null}

      <Row
        style={{
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 8,
          paddingTop: 2,
          paddingBottom: 2,
          borderTopWidth: 1,
          borderTopColor: COLORS.rule,
          borderBottomWidth: 1,
          borderBottomColor: COLORS.rule,
          flexWrap: 'wrap',
        }}
      >
        <Row style={{ gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
          <FeedActionButton icon={Heart} label="Like" count={post.likeCount} active={post.likedByViewer} color={COLORS.accent} onPress={() => onLike(post.id)} />
          <FeedActionButton icon={Repeat2} label="Repost" count={post.repostCount} active={post.repostedByViewer} color={COLORS.repost} onPress={() => onRepost(post.id)} />
          <FeedActionButton icon={MessageSquare} label="Comment" count={post.commentCount} active={commentOpen} color={COLORS.comment} onPress={() => onComment(post.id)} />
          <FeedActionButton icon={Forward} label="Share" count={post.shareCount} color={COLORS.share} onPress={() => onShare(post.id)} />
        </Row>
        <Pressable onPress={() => onBookmark(post.id)}>
          <Box
            style={{
              width: 32,
              height: 30,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 6,
              backgroundColor: post.bookmarkedByViewer ? 'theme:paperInk' : 'theme:transparent',
            }}
          >
            <Icon icon={Bookmark} size={16} color={post.bookmarkedByViewer ? COLORS.share : COLORS.inkFaint} strokeWidth={2.15} />
          </Box>
        </Pressable>
      </Row>

      {commentOpen ? (
        <Row style={{ gap: 8, alignItems: 'center' }}>
          <TextInput
            value={commentDraft}
            onChange={(next: any) => onCommentDraftChange(post.id, readInputValue(next))}
            placeholder="Write a comment"
            style={{
              flexGrow: 1,
              flexBasis: 0,
              minWidth: 0,
              height: 32,
              paddingLeft: 9,
              paddingRight: 9,
              borderRadius: 6,
              borderWidth: 1,
              borderColor: COLORS.rule,
              backgroundColor: COLORS.cardSubtle,
              color: COLORS.ink,
              fontSize: 12,
            }}
          />
          <Pressable onPress={() => onSubmitComment(post.id)}>
            <Box
              style={{
                width: 34,
                height: 32,
                borderRadius: 6,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: commentDraft.trim().length > 0 ? COLORS.comment : COLORS.cardRaised,
                borderWidth: 1,
                borderColor: commentDraft.trim().length > 0 ? COLORS.comment : COLORS.rule,
              }}
            >
              <Icon icon={Send} size={14} color={COLORS.ink} strokeWidth={2.2} />
            </Box>
          </Pressable>
        </Row>
      ) : null}

      {post.commentsPreview.length > 0 ? (
        <Col style={{ gap: 10 }}>
          {post.commentsPreview.slice(0, 2).map((comment) => (
            <CommentPreview key={comment.id} comment={comment} />
          ))}
        </Col>
      ) : null}
    </Col>
  );
}
