export const CONFIG = {
  // Browser settings
  headless: false,
  slowMo: 1000,
  timeout: 60000,
  
  // Scraping settings
  maxReviews: 100,
  scrollDelay: 2000,
  clickDelay: 1000,
  
  // Export settings
  exportFormats: ['json', 'csv'],
  outputDir: './output',
  
  // Rate limiting
  requestDelay: 2000,
  maxRetries: 3,
  
  // Selectors (may need updates based on Google's changes)
  selectors: {
    reviewsContainer: '[data-async-context*="reviews"]',
    reviewItems: '[data-review-id]',
    reviewText: '[data-expandable-section]',
    reviewRating: '[role="img"][aria-label*="star"]',
    reviewAuthor: '[data-value="Name"]',
    reviewDate: '[data-value="Date"]',
    moreButton: '[aria-label*="more reviews"]',
    showMoreButton: '[jsaction*="review.expandReview"]'
  }
};