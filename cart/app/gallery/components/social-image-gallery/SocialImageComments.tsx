import { classifiers as S } from '@reactjit/core';
import { Heart, SendHorizontal } from '@reactjit/runtime/icons/icons';
import type { NewsFeedComment, NewsFeedPost } from '../../data/overstock/news-feed-post';
import { formatSocialCount, formatSocialTimestamp, initialsFromName } from './socialImageGalleryShared';

export type SocialImageCommentsProps = {
  post: NewsFeedPost;
  commentCount: number;
  onComposerPress?: () => void;
};

function CommentRow({ comment }: { comment: NewsFeedComment }) {
  return (
    <S.SocialGalleryCommentRow>
      <S.SocialGalleryCommentAvatar>
        <S.SocialGalleryAvatarText>{initialsFromName(comment.authorName)}</S.SocialGalleryAvatarText>
      </S.SocialGalleryCommentAvatar>

      <S.SocialGalleryCommentBody>
        <S.InlineX3 style={{ flexWrap: 'wrap' }}>
          <S.SocialGalleryAuthorName>{comment.authorName}</S.SocialGalleryAuthorName>
          <S.SocialGalleryHandle>{comment.authorHandle}</S.SocialGalleryHandle>
          <S.SocialGalleryMetaText>{formatSocialTimestamp(comment.createdAt)}</S.SocialGalleryMetaText>
        </S.InlineX3>
        <S.SocialGalleryMetaText>{comment.body}</S.SocialGalleryMetaText>
      </S.SocialGalleryCommentBody>

      <S.InlineX2 style={{ flexShrink: 0 }}>
        {comment.likedByViewer ? (
          <S.SocialGalleryIconAccent icon={Heart} />
        ) : (
          <S.SocialGalleryIcon icon={Heart} />
        )}
        <S.SocialGalleryCount>{formatSocialCount(comment.likeCount)}</S.SocialGalleryCount>
      </S.InlineX2>
    </S.SocialGalleryCommentRow>
  );
}

export function SocialImageComments({
  post,
  commentCount,
  onComposerPress,
}: SocialImageCommentsProps) {
  return (
    <S.SocialGalleryCommentList>
      <S.InlineX5Between>
        <S.SocialGalleryImageTitle>Comments</S.SocialGalleryImageTitle>
        <S.SocialGalleryMetaText>{`${formatSocialCount(commentCount)} total`}</S.SocialGalleryMetaText>
      </S.InlineX5Between>

      {post.commentsPreview.map((comment) => (
        <CommentRow key={comment.id} comment={comment} />
      ))}

      <S.SocialGalleryComposer onPress={onComposerPress}>
        <S.SocialGalleryCommentAvatar>
          <S.SocialGalleryAvatarText>YO</S.SocialGalleryAvatarText>
        </S.SocialGalleryCommentAvatar>
        <S.SocialGalleryMetaText style={{ flexGrow: 1 }}>Add a comment</S.SocialGalleryMetaText>
        <S.SocialGalleryIconBlue icon={SendHorizontal} />
      </S.SocialGalleryComposer>
    </S.SocialGalleryCommentList>
  );
}
