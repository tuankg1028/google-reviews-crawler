# Google Reviews Crawler

A Playwright-based crawler for collecting Google Reviews data.

## Features

- 🚀 **Automated scrolling** to load all available reviews
- 📊 **Multiple export formats** (JSON, CSV)
- 🔍 **Smart selector detection** for Google's changing DOM structure
- 📝 **Comprehensive logging** with configurable levels
- ⚡ **Rate limiting** and error handling
- 🎯 **Configurable** maximum review limits

## Installation

```bash
npm install
npm run install-browsers
```

## Usage

### Basic Usage
```bash
npm start "https://www.google.com/search?q=YourBusiness+Reviews"
```

### With Custom Configuration
```bash
MAX_REVIEWS=200 HEADLESS=true npm start "https://www.google.com/search?q=YourBusiness+Reviews"
```

### Environment Variables

Copy `.env.example` to `.env` and customize:

```bash
cp .env.example .env
```

Available options:
- `HEADLESS`: Run browser in headless mode (true/false)
- `MAX_REVIEWS`: Maximum number of reviews to collect
- `EXPORT_FORMATS`: Export formats (json,csv)
- `LOG_LEVEL`: Logging level (info, debug, warn, error)
- `DEBUG`: Enable debug output (true/false)

## Output

Reviews are exported to the `./output` directory with timestamps:
- `google-reviews-YYYY-MM-DDTHH-mm-ss.json`
- `google-reviews-YYYY-MM-DDTHH-mm-ss.csv`

## Review Data Structure

Each review contains:
```json
{
  "id": "unique-review-id",
  "author": "Reviewer Name",
  "rating": 5,
  "date": "1 month ago",
  "text": "Review text content...",
  "helpful": "2 people found this helpful",
  "extractedAt": "2024-01-01T12:00:00.000Z"
}
```

## Important Notes

⚠️ **Legal Compliance**: Ensure you comply with Google's Terms of Service and applicable laws when using this tool.

⚠️ **Rate Limiting**: The tool includes built-in delays to avoid overwhelming Google's servers.

⚠️ **Selectors**: Google frequently updates their DOM structure. You may need to update selectors in `src/config.js`.

## Troubleshooting

### Common Issues

1. **No reviews found**: Check if the URL contains actual reviews
2. **Selector errors**: Google may have updated their HTML structure
3. **Rate limiting**: Increase delays in config if getting blocked

### Debug Mode

Enable debug logging:
```bash
DEBUG=true LOG_LEVEL=debug npm start "your-url"
```

## Project Structure

```
src/
├── index.js              # Main entry point
├── reviewsCrawler.js     # Core crawler logic
├── config.js             # Configuration settings
└── utils/
    ├── exporter.js       # Data export utilities
    └── logger.js         # Logging utilities
```

## License

MIT License - see LICENSE file for details.