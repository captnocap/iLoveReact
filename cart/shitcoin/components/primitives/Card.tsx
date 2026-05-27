// Card — generic card shell.
//
// Slot-based: pass `title` / `subtitle` / `cta` for the common cases, or
// render children directly for full control. The Card is intentionally
// dumb — it does NOT subscribe to sim state. Callers compose Card with
// data hooks at their level.

import { classifiers as C } from '../../../../runtime/classifier';
import './Card.cls';

export type CardMode = 'full' | 'compact' | 'widget' | 'hero';

export interface CardProps {
  title?: any;
  subtitle?: any;
  badge?: any;
  cta?: { label: string; onPress: () => void; disabled?: boolean };
  /** Layout flag, drives the matching classifier variant. */
  mode?: CardMode;
  /** Pass true to omit the header row entirely (useful when caller renders
   *  its own custom header inside `children`). */
  noHeader?: boolean;
  children?: any;
}

export function Card({ title, subtitle, badge, cta, noHeader, children }: CardProps) {
  return (
    <C.CardRoot>
      {!noHeader && (title || subtitle || badge) ? (
        <C.CardHeader>
          <C.CardTitle>{title}</C.CardTitle>
          {subtitle ? <C.CardSubtitle>{subtitle}</C.CardSubtitle> : null}
          {badge ? (
            <C.CardBadge>
              <C.CardBadgeText>{badge}</C.CardBadgeText>
            </C.CardBadge>
          ) : null}
        </C.CardHeader>
      ) : null}
      <C.CardBody>{children}</C.CardBody>
      {cta ? (
        <C.CardCta onPress={cta.disabled ? undefined : cta.onPress}>
          <C.CardCtaText>{cta.label}</C.CardCtaText>
        </C.CardCta>
      ) : null}
    </C.CardRoot>
  );
}

// Re-export the classifier elements for callers that want fine-grained
// slot placement (e.g. when they need a CardDivider mid-body, or want
// to render their own footer row).
export {
  // helpers, surfaced for composition
} from './Card.cls';
