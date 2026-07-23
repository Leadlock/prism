import React, { useState } from 'react';
import { useCookieConsent } from '../hooks/useCookieConsent';

export default function CookieConsentBanner() {
  const {
    needsBanner,
    consent,
    acceptAll,
    rejectAll,
    saveCustom,
  } = useCookieConsent();

  const [showPrefs, setShowPrefs] = useState(false);

  if (!needsBanner) return null;

  if (showPrefs) {
    return (
      <PreferenceCenter
        onSave={saveCustom}
        onBack={() => setShowPrefs(false)}
        initialChoices={consent?.choices}
      />
    );
  }

  return (
    <div className="cookie-banner-overlay" role="dialog" aria-modal="true" aria-label="Cookie Consent">
      <div className="cookie-banner-box">
        <h2>We use cookies</h2>
        <p>
          We use cookies and similar technologies to improve your experience,
          analyze traffic, and personalize content. You can manage your
          preferences or accept all cookies.
        </p>
        <a href="/privacy-policy" target="_blank" rel="noopener noreferrer">
          Privacy Policy
        </a>
        <div className="cookie-banner-actions">
          <button className="cookie-btn cookie-btn-secondary" onClick={() => setShowPrefs(true)}>
            Manage Preferences
          </button>
          <button className="cookie-btn cookie-btn-secondary" onClick={rejectAll}>
            Reject All
          </button>
          <button className="cookie-btn cookie-btn-primary" onClick={acceptAll}>
            Accept All
          </button>
        </div>
      </div>
    </div>
  );
}

function PreferenceCenter({ onSave, onBack, initialChoices }) {
  const [choices, setChoices] = useState({
    functional: initialChoices?.functional || false,
    analytics: initialChoices?.analytics || false,
    marketing: initialChoices?.marketing || false,
  });

  const toggle = (key) =>
    setChoices((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="cookie-banner-overlay" role="dialog" aria-modal="true" aria-label="Cookie Preferences">
      <div className="cookie-banner-box">
        <h2>Cookie Preferences</h2>

        <div className="cookie-category">
          <label>
            <input type="checkbox" checked disabled />
            Strictly Necessary (always on)
          </label>
        </div>

        <div className="cookie-category">
          <label>
            <input
              type="checkbox"
              checked={choices.functional}
              onChange={() => toggle('functional')}
            />
            Functional Cookies
          </label>
        </div>

        <div className="cookie-category">
          <label>
            <input
              type="checkbox"
              checked={choices.analytics}
              onChange={() => toggle('analytics')}
            />
            Analytics Cookies (Google Analytics)
          </label>
        </div>

        <div className="cookie-category">
          <label>
            <input
              type="checkbox"
              checked={choices.marketing}
              onChange={() => toggle('marketing')}
            />
            Marketing Cookies
          </label>
        </div>

        <div className="cookie-banner-actions">
          <button className="cookie-btn cookie-btn-secondary" onClick={onBack}>
            Back
          </button>
          <button className="cookie-btn cookie-btn-primary" onClick={() => onSave(choices)}>
            Save Preferences
          </button>
        </div>
      </div>
    </div>
  );
}
