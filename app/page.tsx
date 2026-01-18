'use client';

import { useState } from 'react';

export default function Home() {
  const [url, setUrl] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [csrfToken, setCsrfToken] = useState('');
  const [showAuth, setShowAuth] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isArticleUrl = url.includes('/i/article/');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/convert', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url,
          authToken: authToken || undefined,
          csrfToken: csrfToken || undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to convert');
      }

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = isArticleUrl ? 'article.pdf' : 'tweet.pdf';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(downloadUrl);
      document.body.removeChild(a);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <img
            src="/merkle-labs-logo.png"
            alt="Merkle Labs"
            className="h-16 w-auto mb-4"
          />
          <h1 className="text-3xl font-bold text-center text-gray-800">
            Tweets to PDF
          </h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="url"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              Twitter/X URL
            </label>
            <input
              type="url"
              id="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://x.com/username/status/123456789"
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition text-gray-900"
            />
          </div>

          {isArticleUrl && (
            <div className="p-3 bg-yellow-50 border border-yellow-200 text-yellow-800 rounded-lg text-sm">
              Articles require authentication. Please provide your auth cookies below.
            </div>
          )}

          <div>
            <button
              type="button"
              onClick={() => setShowAuth(!showAuth)}
              className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
            >
              <svg
                className={`w-4 h-4 transition-transform ${showAuth ? 'rotate-90' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              {showAuth ? 'Hide' : 'Show'} authentication (for articles)
            </button>

            {showAuth && (
              <div className="mt-3 space-y-3 p-4 bg-gray-50 rounded-lg">
                <p className="text-xs text-gray-600 mb-2">
                  To get these values: Open X/Twitter in browser → F12 → Application → Cookies → x.com
                </p>
                <div>
                  <label htmlFor="authToken" className="block text-sm font-medium text-gray-700 mb-1">
                    auth_token cookie
                  </label>
                  <input
                    type="password"
                    id="authToken"
                    value={authToken}
                    onChange={(e) => setAuthToken(e.target.value)}
                    placeholder="Your auth_token value"
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-gray-900"
                  />
                </div>
                <div>
                  <label htmlFor="csrfToken" className="block text-sm font-medium text-gray-700 mb-1">
                    ct0 cookie (optional)
                  </label>
                  <input
                    type="password"
                    id="csrfToken"
                    value={csrfToken}
                    onChange={(e) => setCsrfToken(e.target.value)}
                    placeholder="Your ct0 value"
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-gray-900"
                  />
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="p-3 bg-red-100 border border-red-400 text-red-700 rounded-lg text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 px-4 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white font-medium rounded-lg transition duration-200"
          >
            {loading ? (
              <span className="flex items-center justify-center">
                <svg
                  className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  ></circle>
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
                Converting...
              </span>
            ) : (
              'Convert to PDF'
            )}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-500">
          Supports tweets and articles. Articles require auth cookies.
        </p>
      </div>
    </main>
  );
}
