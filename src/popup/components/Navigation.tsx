import React from 'react';
import { getMessage } from '../../utils/i18n';
import type { TabType } from '../App';

interface NavigationProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
}

const Navigation: React.FC<NavigationProps> = ({ activeTab, onTabChange }) => {
  // Ordered by task frequency, least destructive first.
  const tabs: { id: TabType; label: string; icon: React.ReactNode }[] = [
    {
      id: 'view',
      label: getMessage('navView'),
      icon: (
        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      ),
    },
    {
      id: 'stats',
      label: getMessage('navStats'),
      icon: (
        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 3v18h18" />
          <path d="M18 17V9M13 17V5M8 17v-3" />
        </svg>
      ),
    },
    {
      id: 'delete',
      label: getMessage('navDelete'),
      icon: (
        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
        </svg>
      ),
    },
    {
      id: 'privacy',
      label: getMessage('navPrivacy'),
      icon: (
        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
      ),
    },
  ];

  const activeIndex = Math.max(0, tabs.findIndex((t) => t.id === activeTab));

  /*
   * Arrow keys move between tabs (and activate them, matching what a click
   * does). Roving tabindex keeps one tab stop for the whole bar: Tab lands on
   * the active tab, the arrows do the rest.
   */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    let next = -1;
    if (e.key === 'ArrowRight') next = (activeIndex + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (activeIndex - 1 + tabs.length) % tabs.length;
    else return;
    e.preventDefault();
    onTabChange(tabs[next].id);
    const items = e.currentTarget.querySelectorAll<HTMLButtonElement>('.nav-item');
    items[next]?.focus();
  };

  return (
    <nav
      className="nav"
      role="tablist"
      aria-label={getMessage('navMain')}
      onKeyDown={handleKeyDown}
      // --active-index positions the sliding capsule (see .nav-indicator).
      style={{ '--active-index': activeIndex } as React.CSSProperties}
    >
      <span className="nav-indicator" aria-hidden="true" />
      {tabs.map((tab) => (
        <button
          key={tab.id}
          id={`tab-${tab.id}`}
          role="tab"
          className={`nav-item ${activeTab === tab.id ? 'active' : ''}`}
          aria-selected={activeTab === tab.id}
          aria-controls={`panel-${tab.id}`}
          tabIndex={activeTab === tab.id ? 0 : -1}
          onClick={() => onTabChange(tab.id)}
        >
          {tab.icon}
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
  );
};

export default Navigation;
