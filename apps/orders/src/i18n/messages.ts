import { enUS, vi as viLocale } from 'date-fns/locale';
import type { Locale } from 'date-fns';
import { fromDateKey } from '../domain/order';

export type Lang = 'vi' | 'en';

export interface Messages {
  appTitle: string;
  colNo: string;
  colName: string;
  colQty: string;
  colMessage: string;
  colCreateDate: string;
  colDelivered: string;
  pickDate: string;
  calendarLabel: string;
  loading: string;
  noOrders: string;
  loadError: string;
  retry: string;
  updateFailed: string;
  deliveredLabel: (no: number, name: string) => string;
}

export const messages: Record<Lang, Messages> = {
  vi: {
    appTitle: 'Quản lý đơn hàng',
    colNo: 'STT',
    colName: 'Tên',
    colQty: 'SL',
    colMessage: 'Ghi chú',
    colCreateDate: 'Ngày tạo',
    colDelivered: 'Đã giao',
    pickDate: 'Chọn ngày',
    calendarLabel: 'Lịch chọn ngày',
    loading: 'Đang tải đơn hàng...',
    noOrders: 'Không có đơn hàng cho ngày này',
    loadError: 'Không thể tải đơn hàng',
    retry: 'Thử lại',
    updateFailed: 'Cập nhật trạng thái giao hàng thất bại',
    deliveredLabel: (no, name) => `Đã giao đơn ${no} - ${name}`,
  },
  en: {
    appTitle: 'Order management',
    colNo: 'No',
    colName: 'Name',
    colQty: 'Qty.',
    colMessage: 'Message',
    colCreateDate: 'CreateDate',
    colDelivered: 'Delivered',
    pickDate: 'Pick date',
    calendarLabel: 'Date calendar',
    loading: 'Loading orders...',
    noOrders: 'No orders for this day',
    loadError: 'Could not load orders',
    retry: 'Retry',
    updateFailed: 'Delivery update failed',
    deliveredLabel: (no, name) => `Delivered order ${no} - ${name}`,
  },
};

/** F20: only exact `vi` / `en` (case-insensitive, trimmed) are valid; anything else is `vi`. */
export function resolveLang(attr: string | null | undefined): Lang {
  const v = attr?.trim().toLowerCase();
  return v === 'en' ? 'en' : 'vi';
}

export function getMessages(lang: Lang): Messages {
  return messages[lang];
}

/** Intl BCP 47 tag per language. */
const intlTag: Record<Lang, string> = { vi: 'vi-VN', en: 'en-US' };

/** F8: selected day for the page header. */
export function formatHeaderDate(dateKey: string, lang: Lang): string {
  return new Intl.DateTimeFormat(intlTag[lang], { dateStyle: 'full' }).format(fromDateKey(dateKey));
}

/** F6: CreateDate, date and time, in the browser's local zone. */
export function formatCreatedAt(iso: string, lang: Lang): string {
  return new Intl.DateTimeFormat(intlTag[lang], { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );
}

/** Locale for react-day-picker. */
export function dateFnsLocale(lang: Lang): Locale {
  return lang === 'en' ? enUS : viLocale;
}
