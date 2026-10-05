'use client';

import { type FormEvent, useState } from 'react';

import { LoadingAnnouncement, LoadingIndicator } from '@/components/ui/LoadingIndicator';
import memberStyles from '@/components/product/MemberUI.module.css';
import styles from './account.module.css';

type AlertFormProps = {
  cryptoOptedIn: boolean;
  stocksOptedIn: boolean;
  paid?: boolean;
  subscriberStatus?: 'active' | 'inactive' | 'none';
  subscriptionEmails?: boolean;
};

export function AlertForm({ cryptoOptedIn, stocksOptedIn, paid = false, subscriberStatus = 'active', subscriptionEmails = false }: AlertFormProps) {
  const [stocks, setStocks] = useState(stocksOptedIn);
  const [crypto, setCrypto] = useState(cryptoOptedIn);
  const [savedPreferences, setSavedPreferences] = useState({ stocks: stocksOptedIn, crypto: cryptoOptedIn });
  const [hasPreferenceRecord, setHasPreferenceRecord] = useState(subscriberStatus !== 'none');
  const [savedEmailStatus, setSavedEmailStatus] = useState(subscriberStatus);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (saving) {
      return;
    }

    setSaving(true);
    setMessage(null);
    setIsError(false);

    try {
      const response = await fetch('/api/account/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cryptoOptedIn: crypto,
          stocksOptedIn: stocks,
        }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? 'Unable to save email alerts.');
      }

      setSavedPreferences({ stocks, crypto });
      setSavedEmailStatus(stocks || crypto ? 'active' : hasPreferenceRecord ? 'inactive' : 'none');
      if (stocks || crypto) setHasPreferenceRecord(true);
      setMessage(paid && !hasPreferenceRecord && !stocks && !crypto ? 'Choices confirmed.' : 'Preferences saved.');
    } catch (error) {
      setIsError(true);
      setMessage(error instanceof Error ? error.message : 'Unable to save email alerts.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <><form className={styles.form} onSubmit={handleSubmit} aria-labelledby="account-emails-heading" aria-busy={saving} data-preference-record={hasPreferenceRecord ? 'existing' : 'missing'}>
      {subscriptionEmails ? <p className={styles.deliveryStatus} data-pro-email-delivery={savedEmailStatus === 'inactive' ? 'paused' : 'enabled'} aria-live="polite">{savedEmailStatus === 'inactive' ? 'Pro briefing emails are paused.' : 'Pro briefing emails are enabled for both markets.'}</p> : null}
      <p className={styles.currentPreferences} aria-live="polite">
        {paid ? (
          !hasPreferenceRecord ? 'No free daily update preferences saved.'
            : `Saved free-update choices: ${savedPreferences.stocks && savedPreferences.crypto ? 'stocks and crypto' : savedPreferences.stocks ? 'stocks' : savedPreferences.crypto ? 'crypto' : 'off'}.`
        ) : savedPreferences.stocks && savedPreferences.crypto
          ? 'Stocks and crypto are on.'
          : savedPreferences.stocks
            ? 'Stocks are on.'
            : savedPreferences.crypto
              ? 'Crypto is on.'
              : 'Email updates are off.'}
      </p>
      <fieldset className={styles.choices} disabled={saving}>
        <legend className={styles.screenReaderOnly}>Markets for email updates</legend>
        <label className={styles.choice}>
          <input type="checkbox" name="stocks" aria-labelledby="stocks-email-label" aria-describedby="stocks-email-description" checked={stocks} onChange={(event) => { setStocks(event.target.checked); setMessage(null); }} />
          <span><strong id="stocks-email-label">Stocks</strong><span id="stocks-email-description">The stock-market score and regime on market days</span></span>
        </label>
        <label className={styles.choice}>
          <input type="checkbox" name="crypto" aria-labelledby="crypto-email-label" aria-describedby="crypto-email-description" checked={crypto} onChange={(event) => { setCrypto(event.target.checked); setMessage(null); }} />
          <span><strong id="crypto-email-label">Crypto</strong><span id="crypto-email-description">The crypto-market score and regime every day, including weekends</span></span>
        </label>
      </fieldset>
      <div className={styles.formActions}>
        <button type="submit" disabled={saving} className={memberStyles.button}>
          {saving ? <LoadingIndicator compact announce={false} label="Saving preferences" /> : 'Save preferences'}
        </button>
        <p className={`${styles.message} ${isError ? styles.error : ''}`} role={isError ? 'alert' : 'status'}>
          {message}
        </p>
      </div>
    </form>
      {saving ? <LoadingAnnouncement label="Saving preferences" /> : null}
    </>
  );
}
