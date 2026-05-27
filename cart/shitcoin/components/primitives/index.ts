// Primitive vocabulary — every higher-level component composes from these.
// Visual variance comes from the classifier variants registered in each
// `*.cls.ts`. Structural variance comes from prop flags on the component.

export { Card, type CardMode, type CardProps } from './Card';
export { Page, type PageProps } from './Page';
export { Feed, FeedItem, FeedSlots, type FeedEntry, type FeedProps } from './Feed';
export { Thread, type ThreadProps, type ThreadReplyData } from './Thread';
export { List, ListSlots, type ListItem, type ListProps } from './List';
export { Table, type TableColumn, type TableProps } from './Table';
export { Form, Field, FormSlots, type FieldProps, type FormProps } from './Form';
export { RuleEditor, type RuleEditorProps, type RuleSpecTemplate, type RuleValue } from './RuleEditor';
export { AuditLog, type AuditEntry, type AuditLogProps, type AuditStatus } from './AuditLog';
