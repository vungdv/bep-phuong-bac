import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DatePicker } from './date-picker';

function setup(lang: 'vi' | 'en' = 'en', selectedDate = '2026-11-20') {
  const onSelect = vi.fn();
  const user = userEvent.setup();
  render(<DatePicker selectedDate={selectedDate} onSelect={onSelect} lang={lang} />);
  const button = screen.getByRole('button', { name: lang === 'en' ? 'Pick date' : 'Chọn ngày' });
  return { onSelect, user, button };
}

describe('DatePicker', () => {
  it('is closed by default and not in the DOM', () => {
    const { button } = setup();
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelector('.rdp-root, [role="grid"]')).toBeNull();
    expect(screen.queryByRole('grid')).toBeNull();
  });

  it('opens on click with aria wiring and the selected day highlighted', async () => {
    const { button, user } = setup();
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const id = button.getAttribute('aria-controls')!;
    const calendar = document.getElementById(id);
    expect(calendar).not.toBeNull();
    const selected = calendar!.querySelectorAll('[aria-selected="true"]');
    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveTextContent('20');
  });

  it('closes on a second click without calling onSelect', async () => {
    const { button, user, onSelect } = setup();
    await user.click(button);
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('grid')).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('picks a day: calls onSelect with its key and closes', async () => {
    const { button, user, onSelect } = setup();
    await user.click(button);
    const grid = screen.getByRole('grid');
    await user.click(within(grid).getByRole('button', { name: /November 15th, 2026/ }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('2026-11-15');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('grid')).toBeNull();
  });

  it('re-picking the already-selected day still calls onSelect and closes', async () => {
    const { button, user, onSelect } = setup();
    await user.click(button);
    await user.click(screen.getByRole('button', { name: /November 20th, 2026/ }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('2026-11-20');
    expect(screen.queryByRole('grid')).toBeNull();
  });

  it('allows picking a day in a future month', async () => {
    const { button, user, onSelect } = setup();
    await user.click(button);
    await user.click(screen.getByRole('button', { name: /next month/i }));
    await user.click(screen.getByRole('button', { name: /December 3rd, 2026/ }));
    expect(onSelect).toHaveBeenCalledWith('2026-12-03');
  });

  it('allows picking a day in a past month', async () => {
    const { button, user, onSelect } = setup();
    await user.click(button);
    await user.click(screen.getByRole('button', { name: /previous month/i }));
    await user.click(screen.getByRole('button', { name: /October 5th, 2026/ }));
    expect(onSelect).toHaveBeenCalledWith('2026-10-05');
  });

  it('uses the Vietnamese label and locale', async () => {
    const { button, user } = setup('vi');
    expect(button).toHaveTextContent('Chọn ngày');
    await user.click(button);
    expect(screen.getByRole('dialog', { name: 'Lịch chọn ngày' })).toBeInTheDocument();
    expect(screen.getByText(/Tháng Mười Một 2026/)).toBeInTheDocument();
  });
});
