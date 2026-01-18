import { NextRequest, NextResponse } from 'next/server';
import puppeteer from 'puppeteer';

async function getBrowser() {
  return puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--single-process',
    ],
  });
}

interface TweetData {
  authorName: string;
  authorHandle: string;
  authorAvatar: string | null;
  text: string;
  date: string;
  images: string[];
}

interface ArticleData {
  title: string;
  authorName: string;
  authorHandle: string;
  authorAvatar: string | null;
  content: { type: 'text' | 'image'; value: string }[];
  date: string;
  debug?: {
    hasArticle: boolean;
    hasMain: boolean;
    bodyText: string;
  };
}

function isValidTwitterUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const validHosts = ['twitter.com', 'www.twitter.com', 'x.com', 'www.x.com'];
    if (!validHosts.includes(parsed.hostname)) {
      return false;
    }
    // Match tweet or article URLs
    const isTweet = parsed.pathname.match(/^\/\w+\/status\/\d+/);
    const isArticle = parsed.pathname.match(/^\/i\/article\/\d+/);
    return isTweet !== null || isArticle !== null;
  } catch {
    return false;
  }
}

function extractTweetId(url: string): string | null {
  const match = url.match(/status\/(\d+)/);
  return match ? match[1] : null;
}

function extractArticleId(url: string): string | null {
  const match = url.match(/article\/(\d+)/);
  return match ? match[1] : null;
}

function isArticleUrl(url: string): boolean {
  return url.includes('/i/article/');
}

async function fetchTweetData(tweetId: string): Promise<TweetData> {
  const syndicationUrl = `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&token=0`;

  const response = await fetch(syndicationUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch tweet: ${response.status}`);
  }

  const data = await response.json();

  const images: string[] = [];
  if (data.mediaDetails) {
    for (const media of data.mediaDetails) {
      if (media.type === 'photo' && media.media_url_https) {
        images.push(`${media.media_url_https}?format=jpg&name=large`);
      }
    }
  }

  if (data.photos) {
    for (const photo of data.photos) {
      if (photo.url && !images.some(img => img.includes(photo.url.split('?')[0]))) {
        images.push(photo.url);
      }
    }
  }

  return {
    authorName: data.user?.name || 'Unknown',
    authorHandle: `@${data.user?.screen_name || 'unknown'}`,
    authorAvatar: data.user?.profile_image_url_https?.replace('_normal', '_400x400') || null,
    text: data.text || '',
    date: data.created_at || '',
    images,
  };
}

interface AuthCookies {
  authToken?: string;
  csrfToken?: string;
}

async function scrapeArticle(articleUrl: string, auth?: AuthCookies): Promise<ArticleData> {
  const browser = await getBrowser();

  try {
    const page = await browser.newPage();

    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1200, height: 800 });

    // Set auth cookies if provided
    if (auth?.authToken || auth?.csrfToken) {
      const cookies = [];
      if (auth.authToken) {
        cookies.push({
          name: 'auth_token',
          value: auth.authToken,
          domain: '.x.com',
          path: '/',
          httpOnly: true,
          secure: true,
        });
      }
      if (auth.csrfToken) {
        cookies.push({
          name: 'ct0',
          value: auth.csrfToken,
          domain: '.x.com',
          path: '/',
          secure: true,
        });
      }
      await page.setCookie(...cookies);
    }

    await page.goto(articleUrl, {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });

    // Wait for page to load - try multiple selectors
    await page.waitForSelector('article, [data-testid="article"], main', { timeout: 20000 }).catch(() => {});

    // Scroll down to load all content
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        let totalHeight = 0;
        const distance = 500;
        const timer = setInterval(() => {
          window.scrollBy(0, distance);
          totalHeight += distance;
          if (totalHeight >= document.body.scrollHeight || totalHeight > 10000) {
            clearInterval(timer);
            window.scrollTo(0, 0);
            resolve();
          }
        }, 100);
      });
    });

    // Give more time for dynamic content
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Debug: log page title and URL
    const pageTitle = await page.title();
    const pageUrl = page.url();
    console.log('Page loaded:', pageUrl, 'Title:', pageTitle);

    const articleData = await page.evaluate(() => {
      // Get author info
      let authorName = '';
      let authorHandle = '';
      let authorAvatar = '';

      // Try to find author info from profile images
      const avatarImg = document.querySelector('img[src*="profile_images"]');
      if (avatarImg) {
        authorAvatar = (avatarImg as HTMLImageElement).src.replace('_normal', '_400x400');
      }

      // Look for author name/handle
      const userLinks = document.querySelectorAll('a[href*="/"]');
      for (const link of Array.from(userLinks)) {
        const href = (link as HTMLAnchorElement).href;
        if (href.match(/x\.com\/\w+$/) && !href.includes('/i/')) {
          const text = link.textContent?.trim() || '';
          if (text.startsWith('@')) {
            authorHandle = text;
          } else if (text && !authorName && text.length < 50) {
            authorName = text;
          }
          if (authorName && authorHandle) break;
        }
      }

      // Get title - try multiple selectors
      let title = '';
      const titleSelectors = ['h1', '[data-testid="article-title"]', 'article h1', 'main h1'];
      for (const sel of titleSelectors) {
        const el = document.querySelector(sel);
        if (el && el.textContent?.trim()) {
          title = el.textContent.trim();
          break;
        }
      }

      // Get article content - try multiple container selectors
      const content: { type: 'text' | 'image'; value: string }[] = [];

      const containerSelectors = [
        'article',
        '[data-testid="article"]',
        'main',
        '[role="main"]',
        'body'
      ];

      let container = null;
      for (const sel of containerSelectors) {
        container = document.querySelector(sel);
        if (container) break;
      }

      if (container) {
        // Patterns to skip (UI elements)
        const skipPatterns = [
          /^To view keyboard/i,
          /^View keyboard/i,
          /^Log in$/i,
          /^Sign up$/i,
          /^@\w+$/,
          /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+$/,
          /^·$/,
          /^More from/i,
          /^Follow$/i,
          /^Repost$/i,
          /^Quote$/i,
          /^Like$/i,
          /^Bookmark$/i,
          /^Share$/i,
          /^Copy link$/i,
        ];

        // Get all elements in document order
        const allElements = container.querySelectorAll('h1, h2, h3, h4, p, div, span, img');
        const seenTexts = new Set<string>();
        const seenImages = new Set<string>();
        let foundFirstContent = false;
        let reachedFooter = false;
        let headerImageCount = 0;
        let skippedAfterTitle = 0;

        for (const el of Array.from(allElements)) {
          if (reachedFooter) break;

          const tagName = el.tagName;

          // Handle images
          if (tagName === 'IMG') {
            const src = (el as HTMLImageElement).src;
            if (src &&
                !src.includes('profile_images') &&
                !src.includes('emoji') &&
                !src.includes('icon') &&
                !src.includes('svg') &&
                !seenImages.has(src) &&
                (src.includes('pbs.twimg.com') || src.includes('ton.twimg.com'))) {
              seenImages.add(src);

              // Skip initial header images (before content starts)
              if (!foundFirstContent) {
                headerImageCount++;
                // Allow only first header image as potential hero image
                if (headerImageCount === 1) {
                  content.push({ type: 'image', value: src });
                }
              } else {
                content.push({ type: 'image', value: src });
              }
            }
            continue;
          }

          // Get text content
          const text = el.textContent?.trim();
          if (!text || text.length < 3) continue;
          if (seenTexts.has(text)) continue;
          if (skipPatterns.some(p => p.test(text))) continue;
          if (text === authorName || text === authorHandle || text === title) continue;

          // Check if we've reached the footer
          if (text.startsWith('More from') || (foundFirstContent && text === authorName)) {
            reachedFooter = true;
            break;
          }

          // Check if this is a heading (by tag or by style)
          const isHeadingTag = tagName === 'H1' || tagName === 'H2' || tagName === 'H3' || tagName === 'H4';
          const computedStyle = window.getComputedStyle(el);
          const fontWeight = parseInt(computedStyle.fontWeight) || 400;
          const fontSize = parseFloat(computedStyle.fontSize) || 16;
          const isStyledAsHeading = fontWeight >= 600 && fontSize >= 20 && text.length < 150;

          // Skip until we find the first real content (paragraph with substantial text)
          if (!foundFirstContent) {
            if (text.length > 40) {
              foundFirstContent = true;
              // Skip first 2 short lines after title (usually "Click to Subscribe" and follower count)
              skippedAfterTitle = 0;
            } else if (isHeadingTag || isStyledAsHeading) {
              foundFirstContent = true;
              skippedAfterTitle = 0;
            } else {
              // Skip first 6 short lines after title (subscribe button, follower count, etc.)
              skippedAfterTitle++;
              if (skippedAfterTitle <= 6) {
                continue;
              }
            }
          }

          // Only add if this element doesn't contain other block elements (leaf node)
          const hasBlockChildren = el.querySelector('p, div, h1, h2, h3, h4');
          if (hasBlockChildren && tagName === 'DIV') continue;

          seenTexts.add(text);

          if (isHeadingTag || isStyledAsHeading) {
            content.push({ type: 'text', value: '## ' + text });
          } else {
            content.push({ type: 'text', value: text });
          }
        }

        // Remove last line (usually footer)
        if (content.length > 1) {
          content.splice(-1);
        }

        // Filter out UI elements
        let foundRealParagraph = false;
        const filteredContent = content.filter(item => {
          if (item.type === 'image') return true;
          const text = item.value;
          const rawText = text.startsWith('## ') ? text.slice(3) : text;

          // Filter out specific UI patterns anywhere
          if (/^Subscribe$/i.test(rawText)) return false;
          if (/^Click to Subscribe/i.test(rawText)) return false;
          if (/^Click to Follow/i.test(rawText)) return false;

          // Skip short items (< 10 chars) only at the beginning before first real paragraph
          if (!foundRealParagraph) {
            if (rawText.length >= 50) {
              foundRealParagraph = true;
            } else if (rawText.length < 10) {
              return false; // Skip short items before content starts
            }
          }

          return true;
        });
        content.length = 0;
        content.push(...filteredContent);
      }

      // Get date if available
      const timeEl = document.querySelector('time');
      const date = timeEl?.getAttribute('datetime') || '';

      // Debug info
      console.log('Found title:', title);
      console.log('Found content items:', content.length);
      console.log('Content preview:', content.slice(0, 5));

      return {
        title,
        authorName,
        authorHandle,
        authorAvatar,
        content,
        date,
        debug: {
          hasArticle: !!document.querySelector('article'),
          hasMain: !!document.querySelector('main'),
          bodyText: document.body?.innerText?.substring(0, 800) || '',
          contentCount: content.length
        }
      };
    });

    console.log('Scraped data:', JSON.stringify(articleData.debug, null, 2));

    // Save debug screenshot
    await page.screenshot({ path: '/tmp/twitter-article-debug.png', fullPage: true });
    console.log('Debug screenshot saved to /tmp/twitter-article-debug.png');

    await browser.close();
    return articleData;
  } catch (error) {
    await browser.close();
    throw error;
  }
}

function formatDate(dateString: string): string {
  if (!dateString) return '';
  try {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return dateString;
  }
}

function cleanTweetText(text: string): string {
  return text.replace(/https?:\/\/t\.co\/\w+/g, '').trim();
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/\n/g, '<br>');
}

function generateTweetHTML(tweetData: TweetData): string {
  const cleanedText = cleanTweetText(tweetData.text);

  const imagesHtml = tweetData.images
    .map(url => `<img src="${url}" class="tweet-image" alt="Tweet image" />`)
    .join('\n');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      padding: 40px;
      background: white;
      color: #0f1419;
      line-height: 1.5;
    }
    .container { max-width: 600px; margin: 0 auto; }
    .header { display: flex; align-items: center; margin-bottom: 16px; }
    .avatar { width: 48px; height: 48px; border-radius: 50%; margin-right: 12px; object-fit: cover; }
    .author-info { display: flex; flex-direction: column; }
    .author-name { font-weight: 700; font-size: 15px; color: #0f1419; }
    .author-handle { font-size: 14px; color: #536471; }
    .tweet-text { font-size: 17px; line-height: 1.5; margin-bottom: 16px; white-space: pre-wrap; word-wrap: break-word; }
    .tweet-image { max-width: 100%; border-radius: 16px; margin-bottom: 12px; display: block; }
    .tweet-date { font-size: 14px; color: #536471; margin-top: 16px; padding-top: 16px; border-top: 1px solid #eff3f4; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      ${tweetData.authorAvatar ? `<img src="${tweetData.authorAvatar}" class="avatar" alt="Avatar" />` : ''}
      <div class="author-info">
        <span class="author-name">${escapeHtml(tweetData.authorName)}</span>
        <span class="author-handle">${escapeHtml(tweetData.authorHandle)}</span>
      </div>
    </div>
    ${cleanedText ? `<div class="tweet-text">${escapeHtml(cleanedText)}</div>` : ''}
    ${imagesHtml}
    ${tweetData.date ? `<div class="tweet-date">${formatDate(tweetData.date)}</div>` : ''}
  </div>
</body>
</html>`;
}

function generateArticleHTML(articleData: ArticleData): string {
  const contentHtml = articleData.content
    .map(item => {
      if (item.type === 'image') {
        return `<img src="${item.value}" style="max-width: 100%; border-radius: 12px; margin: 20px 0; display: block;" alt="Article image" />`;
      } else {
        const isHeading = item.value.startsWith('## ');
        const text = isHeading ? item.value.slice(3) : item.value;
        if (isHeading) {
          return `<h2 style="font-size: 22px; font-weight: 700; margin: 28px 0 14px 0; color: #0f1419; line-height: 1.3;">${escapeHtml(text)}</h2>`;
        } else {
          return `<p style="font-size: 16px; line-height: 1.7; margin-bottom: 16px; color: #0f1419; font-weight: 400;">${escapeHtml(text)}</p>`;
        }
      }
    })
    .join('\n');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      padding: 40px;
      background: white;
      color: #0f1419;
      line-height: 1.6;
    }
    .container { max-width: 680px; margin: 0 auto; }
    .header { display: flex; align-items: center; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #eff3f4; }
    .avatar { width: 48px; height: 48px; border-radius: 50%; margin-right: 12px; object-fit: cover; }
    .author-info { display: flex; flex-direction: column; }
    .author-name { font-weight: 700; font-size: 15px; color: #0f1419; }
    .author-handle { font-size: 14px; color: #536471; }
    .article-title { font-size: 32px; font-weight: 800; margin-bottom: 24px; line-height: 1.2; color: #0f1419; }
    .article-date { font-size: 14px; color: #536471; margin-top: 24px; padding-top: 16px; border-top: 1px solid #eff3f4; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      ${articleData.authorAvatar ? `<img src="${articleData.authorAvatar}" class="avatar" alt="Avatar" />` : ''}
      <div class="author-info">
        <span class="author-name">${escapeHtml(articleData.authorName || 'Unknown')}</span>
        <span class="author-handle">${escapeHtml(articleData.authorHandle || '')}</span>
      </div>
    </div>
    ${articleData.title ? `<h1 class="article-title">${escapeHtml(articleData.title)}</h1>` : ''}
    ${contentHtml}
    ${articleData.date ? `<div class="article-date">${formatDate(articleData.date)}</div>` : ''}
  </div>
</body>
</html>`;
}

async function generatePDF(html: string): Promise<Buffer> {
  const browser = await getBrowser();

  try {
    const page = await browser.newPage();

    await page.setContent(html, {
      waitUntil: 'networkidle0',
      timeout: 30000,
    });

    // Wait for images to load
    await page.evaluate(() => {
      return Promise.all(
        Array.from(document.images)
          .filter(img => !img.complete)
          .map(img => new Promise(resolve => {
            img.onload = img.onerror = resolve;
          }))
      );
    });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '20px',
        right: '20px',
        bottom: '20px',
        left: '20px',
      },
    });

    await browser.close();
    return Buffer.from(pdfBuffer);
  } catch (error) {
    await browser.close();
    throw error;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url, authToken, csrfToken } = body;

    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    if (!isValidTwitterUrl(url)) {
      return NextResponse.json(
        { error: 'Invalid Twitter/X URL. Please provide a valid tweet or article URL.' },
        { status: 400 }
      );
    }

    let html: string;
    let fileId: string;

    if (isArticleUrl(url)) {
      // Handle article
      const articleId = extractArticleId(url);
      if (!articleId) {
        return NextResponse.json(
          { error: 'Could not extract article ID from URL.' },
          { status: 400 }
        );
      }

      // Articles require authentication
      if (!authToken) {
        return NextResponse.json(
          { error: 'Articles require authentication. Please provide at least the auth_token cookie.' },
          { status: 400 }
        );
      }

      const articleData = await scrapeArticle(url, { authToken, csrfToken });

      if (!articleData.title && articleData.content.length === 0) {
        return NextResponse.json(
          { error: 'Could not extract article content. The article may be private or deleted.' },
          { status: 400 }
        );
      }

      html = generateArticleHTML(articleData);
      fileId = `article-${articleId}`;
    } else {
      // Handle tweet
      const tweetId = extractTweetId(url);
      if (!tweetId) {
        return NextResponse.json(
          { error: 'Could not extract tweet ID from URL.' },
          { status: 400 }
        );
      }

      const tweetData = await fetchTweetData(tweetId);

      if (!tweetData.text && tweetData.images.length === 0) {
        return NextResponse.json(
          { error: 'Could not extract tweet content. The tweet may be private or deleted.' },
          { status: 400 }
        );
      }

      html = generateTweetHTML(tweetData);
      fileId = `tweet-${tweetId}`;
    }

    const pdfBuffer = await generatePDF(html);

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileId}.pdf"`,
      },
    });
  } catch (error) {
    console.error('PDF conversion error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `Failed to convert to PDF: ${errorMessage}` },
      { status: 500 }
    );
  }
}
