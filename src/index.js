import { GoogleReviewsCrawler } from './reviewsCrawler.js';
import { logger } from './utils/logger.js';

async function main() {
  const url = process.argv[2] || 'https://www.google.com/search?sca_esv=d40b899f92a74c39&sxsrf=AE3TifNrlup83SMU3zWZWVSkt0xlddGSsw:1752452344550&si=AMgyJEsVtO7Zu9YEyquic0WJtZiamUti8WlVIiHVse8gMEYClRrI4tv4jo4et7LkHR221tG4OsHFgFWRUyeHQBWaGfMgsgW1Ni_OhayPdDLGL78__ZKKtoErM8n1r7W1ps6Bi4r4bvqz&q=Sula+Vineyards+Reviews&sa=X&ved=2ahUKEwjMhe7bibuOAxVyxzgGHSryDW0Q0bkNegQIKBAE&biw=1280&bih=585&dpr=1.5';
  
  if (!url) {
    logger.error('Please provide a Google Reviews URL as an argument');
    process.exit(1);
  }

  const crawler = new GoogleReviewsCrawler({
    maxReviews: parseInt(process.env.MAX_REVIEWS) || 100,
    headless: process.env.HEADLESS === 'true',
    exportFormats: (process.env.EXPORT_FORMATS || 'json,csv').split(',')
  });

  try {
    logger.info('Starting Google Reviews crawling...');
    logger.info(`Target URL: ${url}`);
    
    const reviews = await crawler.crawlReviews(url);
    
    if (reviews.length > 0) {
      await crawler.exportReviews('sula-vineyards-reviews');
      
      // Log summary
      logger.info('\\n=== CRAWLING SUMMARY ===');
      logger.info(`Total reviews collected: ${reviews.length}`);
      logger.info(`Average rating: ${(reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / reviews.filter(r => r.rating).length).toFixed(1)}`);
      logger.info(`Reviews with text: ${reviews.filter(r => r.text).length}`);
      logger.info('========================\\n');
    } else {
      logger.warn('No reviews were collected. Please check the URL and selectors.');
    }

  } catch (error) {
    logger.error('Crawling failed:', error.message);
    if (process.env.DEBUG) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    await crawler.close();
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

main().catch(error => {
  logger.error('Unhandled error:', error.message);
  process.exit(1);
});