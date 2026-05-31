import 'dotenv/config';
import db from '../services/database.js';
import telegramService from '../services/telegram.js';

async function run() {
  console.log('🤖 Starting manual publication CLI script...');
  
  // Accept POST_ID from environment variable or first command line argument
  const postId = process.env.POST_ID || process.argv[2];

  if (!postId) {
    console.error('❌ Error: No POST_ID provided. Specify it as an argument or in environment variables.');
    console.error('Example: node scripts/publish-article.js post_1780257369206');
    process.exit(1);
  }

  db.log('CLI-Publish', `Running publication sequence for post: ${postId}`);

  try {
    const post = db.getPost(postId);
    if (!post) {
      console.error(`❌ Error: Post with ID "${postId}" not found in database.json.`);
      process.exit(1);
    }

    if (post.status === 'published') {
      console.log(`⚠️ Warning: Post "${post.title}" is already published.`);
      process.exit(0);
    }

    console.log(`Publishing post "${post.title}"...`);
    const success = await telegramService.publishPost(postId);

    if (success) {
      db.log('CLI-Publish', `Successfully published post: ${postId}`);
      console.log('🎉 Post published to Telegram channel successfully!');
      process.exit(0);
    } else {
      db.log('CLI-Publish', `Failed to publish post: ${postId}`, 'error');
      console.error('❌ Error: Publication failed. Check logs.');
      process.exit(1);
    }
  } catch (error) {
    db.log('CLI-Publish', `Publication script failed for ${postId}: ${error.message}`, 'error');
    console.error('❌ Error executing script:', error);
    process.exit(1);
  }
}

run();
