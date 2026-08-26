export const CARD_FLAG_KEY = 'QK-IsCard';
export const CARDHOLDER_NAME_KEY = 'Cardholder Name';
export const OTP_FIELD_KEY = 'otp';

export interface EntryField { key: string; value: string; protected: boolean }
export interface AttachmentMeta { name: string; size: number }
export interface EntryView {
  id: string; title: string; username: string; url: string;
  password: string; fields: EntryField[]; expired: boolean;
  created: number | null; expires: number | null; isCard: boolean;
  hasTotp: boolean; totpPeriod: number | null; attachments: AttachmentMeta[]
}
export interface EntrySummary {
  id: string; title: string; username: string; url: string; expired: boolean;
  isCard: boolean; hasTotp: boolean; totpPeriod: number | null; hasAttachments: boolean;
}
export interface TreeNode {
  groupId: string; name: string;
  entries: EntrySummary[];
  children: TreeNode[]
}
