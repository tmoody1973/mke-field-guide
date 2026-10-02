'use client';

import { useEffect, useState } from 'react';
import { shortcutAction } from '@/lib/backstory-review';

const visibleItems = () =>
  [...document.querySelectorAll<HTMLElement>('[data-review-item]')].filter((el) => el.offsetParent !== null);

/** J/K move between items; Y, R and H press that item's Keep, Remove and Hear-it buttons. */
export function ReviewKeyboard() {
  const [help, setHelp] = useState(false);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (event.metaKey || event.ctrlKey || event.altKey || target.isContentEditable) return;
      const action = shortcutAction(event.key.length === 1 ? event.key.toLowerCase() : event.key, target.tagName);
      if (!action) return;
      event.preventDefault();
      if (action === 'help') return setHelp((open) => !open);
      const items = visibleItems();
      const current = target.closest<HTMLElement>('[data-review-item]');
      if (action === 'next' || action === 'prev') {
        const index = current ? items.indexOf(current) : -1;
        const next = items[Math.min(items.length - 1, Math.max(0, index + (action === 'next' ? 1 : -1)))];
        next?.focus();
        next?.scrollIntoView({ block: 'center' });
        return;
      }
      current?.querySelector<HTMLElement>(`[data-action="${action}"]`)?.click();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="text-sm text-ink-muted">
      <p>
        Keyboard: <kbd>J</kbd>/<kbd>K</kbd> next/previous · <kbd>Y</kbd> keep · <kbd>R</kbd> remove · <kbd>H</kbd> hear it · <kbd>?</kbd> help
      </p>
      {help ? (
        <p role="note">
          Press J to jump to the first item. Remove opens three reasons; Tab to the one you mean and press Enter.
          Shortcuts pause while you type in a box.
        </p>
      ) : null}
    </div>
  );
}
