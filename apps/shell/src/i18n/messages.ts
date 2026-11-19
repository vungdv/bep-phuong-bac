const vi = {
  'outlet.loading': 'Đang tải…',
  'outlet.notFound.title': 'Không tìm thấy trang',
  'outlet.notFound.body': 'Không có ứng dụng nào cho đường dẫn "{hash}".',
  'outlet.goHome': 'Về trang chủ',
  'outlet.error.title': 'Không thể tải ứng dụng',
  'outlet.error.body': 'Đã xảy ra lỗi khi tải ứng dụng. Vui lòng thử lại.',
  'outlet.retry': 'Thử lại',
  'outlet.noApps': 'Chưa có ứng dụng nào được đăng ký.',
  'outlet.routes.heading': 'Các ứng dụng',
  'outlet.globalError.title': 'Không thể khởi động ứng dụng',
} as const;

export type MessageKey = keyof typeof vi;
type Table = Readonly<Record<MessageKey, string>>;

const en: Table = {
  'outlet.loading': 'Loading…',
  'outlet.notFound.title': 'Page not found',
  'outlet.notFound.body': 'No app matches the path "{hash}".',
  'outlet.goHome': 'Go home',
  'outlet.error.title': 'Could not load the app',
  'outlet.error.body': 'Something went wrong while loading the app. Please try again.',
  'outlet.retry': 'Retry',
  'outlet.noApps': 'No apps registered.',
  'outlet.routes.heading': 'Apps',
  'outlet.globalError.title': 'Could not start the app',
};

export const messages: Readonly<Record<string, Table>> = { vi, en };

export type Translate = (key: MessageKey, params?: Readonly<Record<string, string>>) => string;

export interface TranslatorOptions {
  readonly lang: string;
  readonly fallback: string;
  readonly warn?: (message: string) => void;
  readonly tables?: Readonly<Record<string, Readonly<Partial<Record<MessageKey, string>>>>>;
}

function interpolate(template: string, params?: Readonly<Record<string, string>>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => params[name] ?? whole);
}

/** lang -> fallback -> key, warning on each miss. */
export function createTranslator(options: TranslatorOptions): Translate {
  const { lang, fallback, tables = messages } = options;
  const warn = options.warn ?? ((m: string) => console.warn(m));
  return (key, params) => {
    const own = tables[lang]?.[key];
    if (own !== undefined) return interpolate(own, params);
    warn(`[i18n] missing "${key}" for "${lang}"`);
    const fb = tables[fallback]?.[key];
    if (fb !== undefined) return interpolate(fb, params);
    warn(`[i18n] missing "${key}" for fallback "${fallback}"`);
    return interpolate(key, params);
  };
}
