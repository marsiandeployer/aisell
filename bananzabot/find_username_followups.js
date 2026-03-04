const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'user_data');

function findLeadUsername(userId) {
  // Get all bot directories
  const botDirs = fs.existsSync(DATA_DIR)
    ? fs.readdirSync(DATA_DIR, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && entry.name.startsWith('bot_'))
        .map(entry => entry.name)
    : [];

  // Check profile and chat files in bot directories
  for (const botName of botDirs) {
    const botDir = path.join(DATA_DIR, botName);

    // Check profile file
    const profilePath = path.join(botDir, `${userId}.json`);
    if (fs.existsSync(profilePath)) {
      try {
        const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
        if (profile.username) {
          return profile.username.startsWith('@') ? profile.username : '@' + profile.username;
        }
      } catch (e) {}
    }

    // Check chat file
    const chatPath = path.join(botDir, `chat_${userId}.json`);
    if (fs.existsSync(chatPath)) {
      try {
        const chatData = JSON.parse(fs.readFileSync(chatPath, 'utf8'));
        if (Array.isArray(chatData)) {
          for (const entry of chatData) {
            if (entry && entry.userInfo && entry.userInfo.username) {
              const un = entry.userInfo.username;
              return un.startsWith('@') ? un : '@' + un;
            }
          }
        }
      } catch (e) {}
    }
  }

  return null;
}

const data = JSON.parse(fs.readFileSync('user_data/crm_followups.json', 'utf8'));
const userIds = Object.keys(data);

// Find users with username AND followupText
const withUsernameAndFollowup = userIds.filter(uid => {
  const user = data[uid];
  // Check if has followupText
  if (!user.followupText || !user.followupText.trim()) return false;

  // Check for username in bot directories
  const username = findLeadUsername(uid);
  return username !== null;
});

console.log('Users with username AND followupText:', withUsernameAndFollowup.length);
console.log('');

// Show first 10
withUsernameAndFollowup.slice(0, 10).forEach(uid => {
  const username = findLeadUsername(uid);
  console.log('User ID:', uid);
  console.log('Username:', username);
  console.log('Status:', data[uid].status);
  console.log('Sent:', data[uid].lastSentAt ? 'YES' : 'NO');
  console.log('Follow-up preview:', data[uid].followupText.substring(0, 150) + '...');
  console.log('');
});

console.log('Total users with username and ready follow-up:', withUsernameAndFollowup.length);
