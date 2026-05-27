// Thread — head post + replies. Headless via render-props.

import { classifiers as C } from '../../../../runtime/classifier';
import './Thread.cls';

export interface ThreadReplyData {
  key: string | number;
  author: string;
  body: any;
  isQuote?: boolean;
}

export interface ThreadProps {
  title: string;
  meta?: string;
  body?: any;
  replies?: ThreadReplyData[];
}

export function Thread({ title, meta, body, replies }: ThreadProps) {
  return (
    <C.ThreadRoot>
      <C.ThreadHead>
        <C.ThreadTitle>{title}</C.ThreadTitle>
        {meta ? <C.ThreadMeta>{meta}</C.ThreadMeta> : null}
        {body ? <C.ThreadBody>{body}</C.ThreadBody> : null}
      </C.ThreadHead>
      {replies && replies.length > 0 ? (
        <C.ThreadReplies>
          {replies.map((r) => (
            <C.ThreadReply key={r.key}>
              <C.ThreadReplyAuthor>{r.author}</C.ThreadReplyAuthor>
              <C.ThreadReplyBody>{r.body}</C.ThreadReplyBody>
            </C.ThreadReply>
          ))}
        </C.ThreadReplies>
      ) : null}
    </C.ThreadRoot>
  );
}
