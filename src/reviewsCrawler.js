import { chromium } from 'playwright';
import { CONFIG } from './config.js';
import { exportData } from './utils/exporter.js';
import { logger } from './utils/logger.js';

export class GoogleReviewsCrawler {
  constructor(options = {}) {
    this.config = { ...CONFIG, ...options };
    this.browser = null;
    this.page = null;
    this.reviews = [];
  }

  async initialize() {
    try {
      logger.info('Launching browser...');
      this.browser = await chromium.launch({
        headless: this.config.headless,
        slowMo: this.config.slowMo,
      });

      this.page = await this.browser.newPage({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 }
      });

      // Set additional headers to avoid detection
      await this.page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
      });

      logger.info('Browser initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize browser:', error.message);
      throw error;
    }
  }

  async navigateToReviews(url) {
    try {
      logger.info(`Navigating to: ${url}`);
      await this.page.goto(url, { 
        waitUntil: 'networkidle',
        timeout: this.config.timeout 
      });

      // Check what type of Google page we're on
      const pageType = await this.detectPageType();
      logger.info(`Detected page type: ${pageType}`);

      // Handle different page types
      if (pageType === 'search') {
        await this.handleSearchPage();
      } else if (pageType === 'maps') {
        await this.handleMapsPage();
      } else {
        // Try fallback selectors for any Google page with reviews
        await this.waitForReviewsWithFallback();
      }

      logger.info('Successfully navigated to reviews page');
    } catch (error) {
      logger.error('Failed to navigate to reviews:', error.message);
      throw error;
    }
  }

  async detectPageType() {
    return await this.page.evaluate(() => {
      if (window.location.href.includes('/search?')) {
        return 'search';
      }
      if (window.location.href.includes('maps.google.com') || window.location.href.includes('/maps/')) {
        return 'maps';
      }
      if (document.querySelector('[data-async-context*="reviews"], .review-dialog-list')) {
        return 'business';
      }
      return 'unknown';
    });
  }

  async handleSearchPage() {
    // Look for business links in search results that might have reviews
    try {
      const businessLink = await this.page.$('a[href*="maps.google.com"], a[href*="/maps/place/"]');
      if (businessLink) {
        logger.info('Found business link in search results, navigating to Maps page...');
        await businessLink.click();
        await this.page.waitForLoadState('networkidle');
        await this.handleMapsPage();
        return;
      }
      
      // Look for reviews section directly in search results
      await this.page.waitForSelector('.review, [data-attrid="kc:/business/rating"], .f7_rlf', { timeout: 10_000 });
    } catch (error) {
      throw new Error('No reviews found on search results page. Try using a Google Maps business URL instead.');
    }
  }

  async handleMapsPage() {
    // Wait for Google Maps to load and then look for reviews
    await this.page.waitForSelector('[data-value="Reviews"], button:has-text("Reviews"), [aria-label*="reviews"]', { timeout: 30_000 });
    
    // Click on reviews tab if it exists
    try {
      const reviewsTab = await this.page.$('[data-value="Reviews"], button:has-text("Reviews")');
      if (reviewsTab) {
        await reviewsTab.click();
        await this.page.waitForTimeout(2000);
      }
    } catch (e) {
      // Reviews tab might already be active
    }
    
    // Wait for review content to load
    await this.waitForReviewsWithFallback();
  }

  async waitForReviewsWithFallback() {
    const selectors = [
      '[data-async-context*="reviews"]',
      '.review-dialog-list',
      '[jsaction*="reviews"]',
      '.review',
      '[data-review-id]',
      '.review-item',
      '[role="article"]',
      '.f7_rlf', // Search results reviews
      '[data-attrid="kc:/business/rating"]' // Knowledge panel reviews
    ];

    for (const selector of selectors) {
      try {
        await this.page.waitForSelector(selector, { timeout: 10_000 });
        logger.info(`Found reviews using selector: ${selector}`);
        return;
      } catch (e) {
        continue;
      }
    }
    
    throw new Error('Could not find any review elements on the page');
  }

  async scrollToLoadAllReviews() {
    logger.info('Loading all reviews by scrolling...');
    let previousReviewCount = 0;
    let currentReviewCount = 0;
    let stagnantCount = 0;

    while (this.reviews.length < this.config.maxReviews) {
      // Scroll down to trigger loading more reviews
      await this.page.evaluate(() => {
        const reviewsContainer = document.querySelector('[data-async-context*="reviews"], .review-dialog-list, [jsaction*="reviews"]');
        if (reviewsContainer) {
          reviewsContainer.scrollTop = reviewsContainer.scrollHeight;
        } else {
          window.scrollTo(0, document.body.scrollHeight);
        }
      });

      // Wait for new content to load
      await this.page.waitForTimeout(this.config.scrollDelay);

      // Check if new reviews loaded
      const reviewElements = await this.page.$$('[data-review-id], .review-item, [jsaction*="review"]');
      currentReviewCount = reviewElements.length;

      if (currentReviewCount === previousReviewCount) {
        stagnantCount++;
        if (stagnantCount >= 3) {
          logger.info(`No new reviews loaded after ${stagnantCount} attempts. Stopping scroll.`);
          break;
        }
      } else {
        stagnantCount = 0;
      }

      previousReviewCount = currentReviewCount;
      logger.info(`Loaded ${currentReviewCount} review elements`);

      // Try to click "More reviews" or "Show more" buttons if they exist
      try {
        const moreButton = await this.page.$('[aria-label*="more reviews"], [aria-label*="More reviews"], button:has-text("More")');
        if (moreButton) {
          await moreButton.click();
          await this.page.waitForTimeout(this.config.clickDelay);
        }
      } catch (e) {
        // Button not found or not clickable, continue
      }
    }
  }

  async extractReviewData() {
    logger.info('Extracting review data...');
    
    const reviews = await this.page.evaluate(() => {
      // Try multiple selector strategies for different page types
      const selectors = [
        '[data-review-id]',
        '.review-item', 
        '[jsaction*="review"]',
        '.review',
        '[role="article"]',
        '.f7_rlf', // Search results reviews
        '.g-blk', // Alternative search result reviews
      ];
      
      let reviewElements = [];
      for (const selector of selectors) {
        reviewElements = document.querySelectorAll(selector);
        if (reviewElements.length > 0) {
          console.log(`Found ${reviewElements.length} reviews using selector: ${selector}`);
          break;
        }
      }

      const extractedReviews = [];

      reviewElements.forEach((element, index) => {
        try {
          // Extract review text - try multiple selectors
          const textSelectors = [
            '[data-expandable-section]',
            '.review-snippet',
            '.review-text',
            '[jsaction*="expandReview"]',
            '.Jtu6Td', // Search results review text
            '.DUwDvf', // Alternative review text
            '.review-full-text'
          ];
          
          let text = '';
          for (const sel of textSelectors) {
            const textElement = element.querySelector(sel);
            if (textElement) {
              text = textElement.textContent.trim();
              break;
            }
          }

          // Extract rating - try multiple selectors
          const ratingSelectors = [
            '[role="img"][aria-label*="star"]',
            '.review-rating',
            '[aria-label*="stars"]',
            '.z3HNkc', // Search results rating
            '[data-value="Rating"]'
          ];
          
          let rating = null;
          for (const sel of ratingSelectors) {
            const ratingElement = element.querySelector(sel);
            if (ratingElement) {
              const ariaLabel = ratingElement.getAttribute('aria-label') || ratingElement.textContent || '';
              const ratingMatch = ariaLabel.match(/(\d+(?:\.\d+)?)/);
              rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;
              if (rating) break;
            }
          }

          // Extract author name - try multiple selectors
          const authorSelectors = [
            '[data-value="Name"]',
            '.review-author',
            '.author-name',
            '.TSUbDb', // Search results author
            '.X5PpBb' // Alternative author
          ];
          
          let author = 'Anonymous';
          for (const sel of authorSelectors) {
            const authorElement = element.querySelector(sel);
            if (authorElement) {
              author = authorElement.textContent.trim();
              break;
            }
          }

          // Extract date - try multiple selectors
          const dateSelectors = [
            '[data-value="Date"]',
            '.review-date',
            '.date',
            '.dehysf', // Search results date
            '.p2TkOb' // Alternative date
          ];
          
          let date = '';
          for (const sel of dateSelectors) {
            const dateElement = element.querySelector(sel);
            if (dateElement) {
              date = dateElement.textContent.trim();
              break;
            }
          }

          // Extract helpful count if available
          const helpfulElement = element.querySelector('[aria-label*="helpful"], .helpful-count');
          const helpful = helpfulElement ? helpfulElement.textContent.trim() : null;

          if (text || rating) {
            extractedReviews.push({
              id: element.getAttribute('data-review-id') || `review-${index}`,
              text,
              rating,
              author,
              date,
              helpful,
              extractedAt: new Date().toISOString()
            });
          }
        } catch (error) {
          console.warn('Error extracting review:', error);
        }
      });

      return extractedReviews;
    });

    this.reviews = reviews.filter(review => review.text || review.rating);
    logger.info(`Extracted ${this.reviews.length} reviews`);
    return this.reviews;
  }

  async expandAllReviews() {
    logger.info('Expanding truncated reviews...');
    
    try {
      const expandButtons = await this.page.$$('[jsaction*="expandReview"], [aria-label*="more"], button:has-text("More")');
      
      for (const button of expandButtons) {
        try {
          await button.click();
          await this.page.waitForTimeout(500);
        } catch (e) {
          // Button might not be clickable anymore
        }
      }
      
      logger.info(`Attempted to expand ${expandButtons.length} reviews`);
    } catch (error) {
      logger.warn('Error expanding reviews:', error.message);
    }
  }

  async crawlReviews(url, maxRetries = 3) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.info(`Crawling attempt ${attempt}/${maxRetries}`);
        
        if (attempt > 1) {
          // Reset browser on retry
          await this.close();
          await this.initialize();
        } else {
          await this.initialize();
        }
        
        await this.navigateToReviews(url);
        await this.scrollToLoadAllReviews();
        await this.expandAllReviews();
        await this.extractReviewData();
        
        logger.info(`Successfully crawled ${this.reviews.length} reviews`);
        return this.reviews;
      } catch (error) {
        lastError = error;
        logger.warn(`Attempt ${attempt} failed: ${error.message}`);
        
        if (attempt < maxRetries) {
          logger.info(`Retrying in 3 seconds...`);
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }
    }
    
    logger.error('All crawling attempts failed:', lastError.message);
    throw lastError;
  }

  async exportReviews(filename = 'google-reviews') {
    if (this.reviews.length === 0) {
      logger.warn('No reviews to export');
      return;
    }

    for (const format of this.config.exportFormats) {
      await exportData(this.reviews, filename, format, this.config.outputDir);
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      logger.info('Browser closed');
    }
  }
}