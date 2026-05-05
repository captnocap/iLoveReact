import { classifiers as S } from '@reactjit/core';
import { BadgeCheck, MoreHorizontal } from '@reactjit/runtime/icons/icons';
import type { NewsFeedPost } from '../../data/overstock/news-feed-post';
import type { SocialImageItem } from './socialImageGalleryShared';
import { formatSocialTimestamp, visibilityLabel } from './socialImageGalleryShared';

export type SocialImageAuthorProps = {
  post: NewsFeedPost;
  activeImage?: SocialImageItem;
};

export function SocialImageAuthor({ post, activeImage }: SocialImageAuthorProps) {
  return (
    <S.StackX5>
      <S.SocialGalleryAuthorRow>
        <S.SocialGalleryAvatar>
          <S.SocialGalleryAvatarText>{post.author.avatarInitials}</S.SocialGalleryAvatarText>
        </S.SocialGalleryAvatar>

        <S.StackX2 style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 }}>
          <S.InlineX3 style={{ flexWrap: 'wrap' }}>
            <S.SocialGalleryAuthorName>{post.author.displayName}</S.SocialGalleryAuthorName>
            {post.author.verified ? <S.SocialGalleryIconBlue icon={BadgeCheck} /> : null}
          </S.InlineX3>
          <S.InlineX3 style={{ flexWrap: 'wrap' }}>
            <S.SocialGalleryHandle>{post.author.handle}</S.SocialGalleryHandle>
            <S.SocialGalleryMetaText>{formatSocialTimestamp(post.createdAt)}</S.SocialGalleryMetaText>
            <S.SocialGalleryMetaText>{visibilityLabel(post.visibility)}</S.SocialGalleryMetaText>
          </S.InlineX3>
          {post.author.role ? <S.SocialGalleryMetaText>{post.author.role}</S.SocialGalleryMetaText> : null}
        </S.StackX2>

        <S.SocialGalleryActionButton style={{ minWidth: 30, paddingLeft: 6, paddingRight: 6 }}>
          <S.SocialGalleryIcon icon={MoreHorizontal} />
        </S.SocialGalleryActionButton>
      </S.SocialGalleryAuthorRow>

      {activeImage ? (
        <S.SocialGalleryTopicRow>
          <S.SocialGalleryTopic>
            <S.SocialGalleryTopicText>{activeImage.location}</S.SocialGalleryTopicText>
          </S.SocialGalleryTopic>
          <S.SocialGalleryTopic>
            <S.SocialGalleryTopicText>{activeImage.aspectLabel}</S.SocialGalleryTopicText>
          </S.SocialGalleryTopic>
          {post.topics.map((topic) => (
            <S.SocialGalleryTopic key={topic}>
              <S.SocialGalleryTopicText>{`#${topic}`}</S.SocialGalleryTopicText>
            </S.SocialGalleryTopic>
          ))}
        </S.SocialGalleryTopicRow>
      ) : null}
    </S.StackX5>
  );
}
