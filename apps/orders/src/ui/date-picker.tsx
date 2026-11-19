import { useId, useState } from 'react';
import { DayPicker } from 'react-day-picker';
import { fromDateKey, toDateKey } from '../domain/order';
import { dateFnsLocale, getMessages, type Lang } from '../i18n/messages';

export interface DatePickerProps {
  /** Selected day as YYYY-MM-DD. */
  selectedDate: string;
  onSelect: (dateKey: string) => void;
  lang: Lang;
}

export function DatePicker({ selectedDate, onSelect, lang }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const calendarId = useId();
  const selected = fromDateKey(selectedDate);

  return (
    <div className="relative inline-block">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={calendarId}
        onClick={() => setOpen((o) => !o)}
        className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium hover:bg-gray-50"
      >
        {getMessages(lang).pickDate}
      </button>
      {open && (
        <div
          id={calendarId}
          role="dialog"
          aria-label={getMessages(lang).calendarLabel}
          className="absolute right-0 z-10 mt-1 rounded-md border border-gray-200 bg-white p-2 shadow-lg"
        >
          <DayPicker
            mode="single"
            required
            locale={dateFnsLocale(lang)}
            selected={selected}
            defaultMonth={selected}
            onSelect={(day) => {
              onSelect(toDateKey(day));
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
