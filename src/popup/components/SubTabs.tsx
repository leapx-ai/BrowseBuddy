import React from 'react';

/*
 * In-module secondary tabs: view modes in ViewModule, delete types in
 * DeleteModule, time ranges in StatsModule. Those three used to each render
 * their own copy of the same .segmented markup; written once here so the
 * structure, the sliding indicator and the keyboard behaviour cannot drift
 * between copies (same reason ToggleRow exists on the options page).
 *
 * The visual tier is deliberate: the bottom dock owns the filled-capsule
 * gesture, these are the lighter underline tabs beneath it.
 */
interface SubTabsProps<T extends string> {
  items: { id: T; label: string }[];
  activeId: T;
  onChange: (id: T) => void;
  /* aria-label for the tablist - callers pass the parent tab's name. */
  label: string;
}

function SubTabs<T extends string>({ items, activeId, onChange, label }: SubTabsProps<T>) {
  const activeIndex = Math.max(0, items.findIndex((i) => i.id === activeId));

  // Same arrow-key + roving-tabindex contract as the main Navigation bar.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    let next = -1;
    if (e.key === 'ArrowRight') next = (activeIndex + 1) % items.length;
    else if (e.key === 'ArrowLeft') next = (activeIndex - 1 + items.length) % items.length;
    else return;
    e.preventDefault();
    onChange(items[next].id);
    const buttons = e.currentTarget.querySelectorAll<HTMLButtonElement>('.subtabs-item');
    buttons[next]?.focus();
  };

  return (
    <div
      className="subtabs"
      role="tablist"
      aria-label={label}
      onKeyDown={handleKeyDown}
      // --tab-count / --active-index position the sliding underline (see
      // .subtabs-indicator). Inline because a per-state value cannot live in a
      // stylesheet - same precedent as the favicon colour.
      style={
        {
          '--tab-count': items.length,
          '--active-index': activeIndex,
        } as React.CSSProperties
      }
    >
      {items.map((item) => (
        <button
          key={item.id}
          role="tab"
          className={`subtabs-item ${item.id === activeId ? 'active' : ''}`}
          aria-selected={item.id === activeId}
          tabIndex={item.id === activeId ? 0 : -1}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
      <span className="subtabs-indicator" aria-hidden="true" />
    </div>
  );
}

export default SubTabs;
