'use client';

import { type FormEvent, useState } from 'react';

type AlertFormProps = {
  cryptoOptedIn: boolean;
  stocksOptedIn: boolean;
};

export function AlertForm({ cryptoOptedIn, stocksOptedIn }: AlertFormProps) {
  const [stocks, setStocks] = useState(stocksOptedIn);
  const [crypto, setCrypto] = useState(cryptoOptedIn);
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

      setMessage(stocks || crypto ? 'Email alerts saved.' : 'Email alerts are off.');
    } catch (error) {
      setIsError(true);
      setMessage(error instanceof Error ? error.message : 'Unable to save email alerts.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="mt-4 space-y-3" onSubmit={handleSubmit}>
      <label className="flex min-h-11 items-center gap-3 text-sm text-zinc-200">
        <input
          type="checkbox"
          name="stocks"
          checked={stocks}
          onChange={(event) => setStocks(event.target.checked)}
          className="h-4 w-4 accent-white"
        />
        Stocks
      </label>
      <label className="flex min-h-11 items-center gap-3 text-sm text-zinc-200">
        <input
          type="checkbox"
          name="crypto"
          checked={crypto}
          onChange={(event) => setCrypto(event.target.checked)}
          className="h-4 w-4 accent-white"
        />
        Crypto
      </label>
      <button
        type="submit"
        disabled={saving}
        className="inline-flex h-12 w-full items-center justify-center bg-white px-5 text-sm font-semibold text-black disabled:opacity-60 sm:w-auto"
      >
        {saving ? 'Saving' : 'Save alerts'}
      </button>
      {message ? (
        <p className={`text-sm ${isError ? 'text-rose-300' : 'text-emerald-300'}`} aria-live="polite">
          {message}
        </p>
      ) : null}
    </form>
  );
}
