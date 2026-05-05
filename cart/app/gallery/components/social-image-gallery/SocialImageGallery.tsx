import { useMemo, useState } from 'react';
import { classifiers as S } from '@reactjit/core';
import type { NewsFeedPost } from '../../data/overstock/news-feed-post';
import { useGalleryTheme } from '../../gallery-theme';
import { SocialImageActions } from './SocialImageActions';
import { SocialImageAuthor } from './SocialImageAuthor';
import { SocialImageComments } from './SocialImageComments';
import { SocialImageStage } from './SocialImageStage';
import {
  DEFAULT_SOCIAL_IMAGE_POST,
  type SocialImageItem,
  makeSocialImageSet,
} from './socialImageGalleryShared';

export type SocialImageGalleryProps = {
  post?: NewsFeedPost;
  images?: SocialImageItem[];
  initialIndex?: number;
};

function adjustedCount(base: number, initial: boolean, current: boolean): number {
  return Math.max(0, base + (current ? 1 : 0) - (initial ? 1 : 0));
}

export function SocialImageGallery({
  post = DEFAULT_SOCIAL_IMAGE_POST,
  images,
  initialIndex = 0,
}: SocialImageGalleryProps) {
  const { activeThemeId } = useGalleryTheme();
  const galleryImages = useMemo(() => images || makeSocialImageSet(post), [activeThemeId, images, post]);
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);
  const [liked, setLiked] = useState(post.likedByViewer);
  const [reposted, setReposted] = useState(post.repostedByViewer);
  const [bookmarked, setBookmarked] = useState(post.bookmarkedByViewer);
  const [shareBump, setShareBump] = useState(0);

  const imageCount = galleryImages.length;
  const safeIndex = imageCount === 0 ? 0 : Math.min(Math.max(selectedIndex, 0), imageCount - 1);
  const activeImage = galleryImages[safeIndex];

  const interactionState = {
    liked,
    reposted,
    bookmarked,
    likeCount: adjustedCount(post.likeCount, post.likedByViewer, liked),
    repostCount: adjustedCount(post.repostCount, post.repostedByViewer, reposted),
    commentCount: post.commentCount,
    shareCount: post.shareCount + shareBump,
  };

  const selectPrevious = () => {
    if (imageCount <= 1) return;
    setSelectedIndex((index) => (index <= 0 ? imageCount - 1 : index - 1));
  };

  const selectNext = () => {
    if (imageCount <= 1) return;
    setSelectedIndex((index) => (index >= imageCount - 1 ? 0 : index + 1));
  };

  return (
    <S.SocialGalleryShell>
      <S.SocialGalleryMain>
        <S.SocialGalleryViewerPane>
          <SocialImageStage
            images={galleryImages}
            selectedIndex={safeIndex}
            onSelect={setSelectedIndex}
            onPrevious={selectPrevious}
            onNext={selectNext}
          />
        </S.SocialGalleryViewerPane>

        <S.SocialGalleryMetaPanel>
          <S.SocialGalleryMetaScroll>
            <S.SocialGalleryMetaInner>
              <SocialImageAuthor post={post} activeImage={activeImage} />

              <S.SocialGalleryCaptionBlock>
                <S.SocialGalleryCaption>{post.body}</S.SocialGalleryCaption>
                {activeImage ? <S.SocialGalleryMetaText>{activeImage.caption}</S.SocialGalleryMetaText> : null}
              </S.SocialGalleryCaptionBlock>

              <SocialImageActions
                state={interactionState}
                onLike={() => setLiked((value) => !value)}
                onRepost={() => setReposted((value) => !value)}
                onComment={() => undefined}
                onShare={() => setShareBump((value) => value + 1)}
                onBookmark={() => setBookmarked((value) => !value)}
              />

              <SocialImageComments post={post} commentCount={interactionState.commentCount} />
            </S.SocialGalleryMetaInner>
          </S.SocialGalleryMetaScroll>
        </S.SocialGalleryMetaPanel>
      </S.SocialGalleryMain>
    </S.SocialGalleryShell>
  );
}
