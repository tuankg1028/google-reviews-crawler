import fs from 'fs/promises';
import path from 'path';
import { logger } from './logger.js';

export async function exportData(data, filename, format, outputDir = './output') {
  try {
    // Ensure output directory exists
    await fs.mkdir(outputDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fullFilename = `${filename}-${timestamp}`;

    switch (format.toLowerCase()) {
      case 'json':
        await exportToJSON(data, fullFilename, outputDir);
        break;
      case 'csv':
        await exportToCSV(data, fullFilename, outputDir);
        break;
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  } catch (error) {
    logger.error(`Export failed for format ${format}:`, error.message);
    throw error;
  }
}

async function exportToJSON(data, filename, outputDir) {
  const filepath = path.join(outputDir, `${filename}.json`);
  const jsonData = {
    exportedAt: new Date().toISOString(),
    totalReviews: data.length,
    reviews: data
  };
  
  await fs.writeFile(filepath, JSON.stringify(jsonData, null, 2), 'utf8');
  logger.info(`Exported ${data.length} reviews to ${filepath}`);
}

async function exportToCSV(data, filename, outputDir) {
  const filepath = path.join(outputDir, `${filename}.csv`);
  
  if (data.length === 0) {
    await fs.writeFile(filepath, 'No reviews found', 'utf8');
    return;
  }

  // CSV Headers
  const headers = ['id', 'author', 'rating', 'date', 'helpful', 'text', 'extractedAt'];
  const csvRows = [headers.join(',')];

  // CSV Data
  data.forEach(review => {
    const row = headers.map(header => {
      const value = review[header] || '';
      // Escape quotes and wrap in quotes if contains comma, quote, or newline
      if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\n'))) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    });
    csvRows.push(row.join(','));
  });

  await fs.writeFile(filepath, csvRows.join('\n'), 'utf8');
  logger.info(`Exported ${data.length} reviews to ${filepath}`);
}