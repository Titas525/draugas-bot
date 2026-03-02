const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'draugas.db');
const db = new Database(DB_PATH);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

// --- SCHEMA ---
db.exec(`
  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    fullText TEXT,
    city TEXT,
    bio TEXT,
    interests TEXT,
    photoUrl TEXT,
    profileUrl TEXT UNIQUE,
    source TEXT,
    status TEXT DEFAULT 'new',
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contactId INTEGER NOT NULL,
    direction TEXT NOT NULL,
    content TEXT NOT NULL,
    approved INTEGER DEFAULT 1,
    sentAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (contactId) REFERENCES contacts(id)
  );

  CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts(name);
  CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(status);
  CREATE INDEX IF NOT EXISTS idx_messages_contact ON messages(contactId);
`);

// --- PREPARED STATEMENTS ---
const stmts = {
    upsertContact: db.prepare(`
    INSERT INTO contacts (name, fullText, city, bio, interests, photoUrl, profileUrl, source, status, updatedAt)
    VALUES (@name, @fullText, @city, @bio, @interests, @photoUrl, @profileUrl, @source, @status, datetime('now'))
    ON CONFLICT(profileUrl) DO UPDATE SET
      fullText = COALESCE(@fullText, fullText),
      city = COALESCE(@city, city),
      bio = COALESCE(@bio, bio),
      interests = COALESCE(@interests, interests),
      photoUrl = COALESCE(@photoUrl, photoUrl),
      updatedAt = datetime('now')
  `),

    findContactByName: db.prepare(`SELECT * FROM contacts WHERE name = ? LIMIT 1`),

    findContactByUrl: db.prepare(`SELECT * FROM contacts WHERE profileUrl = ? LIMIT 1`),

    findContactByNameLike: db.prepare(`SELECT * FROM contacts WHERE name LIKE ? LIMIT 1`),

    getContactsByStatus: db.prepare(`SELECT * FROM contacts WHERE status = ? ORDER BY updatedAt DESC`),

    updateContactStatus: db.prepare(`UPDATE contacts SET status = @status, updatedAt = datetime('now') WHERE id = @id`),

    saveMessage: db.prepare(`
    INSERT INTO messages (contactId, direction, content, approved)
    VALUES (@contactId, @direction, @content, @approved)
  `),

    getConversation: db.prepare(`
    SELECT * FROM messages WHERE contactId = ? ORDER BY sentAt ASC
  `),

    getLastMessages: db.prepare(`
    SELECT * FROM messages WHERE contactId = ? ORDER BY sentAt DESC LIMIT ?
  `),

    isContacted: db.prepare(`
    SELECT COUNT(*) as count FROM messages WHERE contactId = ? AND direction = 'sent'
  `),

    getAllContacts: db.prepare(`SELECT * FROM contacts ORDER BY updatedAt DESC`),

    getStats: db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM contacts) as totalContacts,
      (SELECT COUNT(*) FROM contacts WHERE status = 'messaged') as messaged,
      (SELECT COUNT(*) FROM contacts WHERE status = 'active') as active,
      (SELECT COUNT(*) FROM messages WHERE direction = 'sent') as sentMessages,
      (SELECT COUNT(*) FROM messages WHERE direction = 'received') as receivedMessages
  `),

    getContactsAwaitingReply: db.prepare(`
    SELECT c.* FROM contacts c
    WHERE (
      SELECT COUNT(*) FROM messages WHERE contactId = c.id AND direction = 'sent'
    ) > 0
    AND (
      SELECT direction FROM messages WHERE contactId = c.id ORDER BY sentAt DESC LIMIT 1
    ) = 'received'
    ORDER BY c.updatedAt DESC
  `),

    getLastMessageInfo: db.prepare(`
    SELECT direction, content, sentAt FROM messages WHERE contactId = ? ORDER BY sentAt DESC LIMIT 1
  `)
};

// --- EXPORTED FUNCTIONS ---

function upsertContact(data) {
    const params = {
        name: data.name || '',
        fullText: data.fullText || null,
        city: data.city || null,
        bio: data.bio || null,
        interests: data.interests || null,
        photoUrl: data.photoUrl || null,
        profileUrl: data.profileUrl || null,
        source: data.source || null,
        status: data.status || 'new'
    };
    try {
        const result = stmts.upsertContact.run(params);
        return result.lastInsertRowid || stmts.findContactByUrl.get(params.profileUrl)?.id;
    } catch (err) {
        console.error('[DB] upsertContact klaida:', err.message);
        return null;
    }
}

function findContact(name) {
    let contact = stmts.findContactByName.get(name);
    if (!contact) {
        contact = stmts.findContactByNameLike.get(`%${name}%`);
    }
    return contact || null;
}

function findContactByUrl(url) {
    return stmts.findContactByUrl.get(url) || null;
}

function updateStatus(contactId, status) {
    stmts.updateContactStatus.run({ id: contactId, status });
}

function saveMessage(contactId, direction, content, approved = true) {
    try {
        stmts.saveMessage.run({
            contactId,
            direction,
            content,
            approved: approved ? 1 : 0
        });
    } catch (err) {
        console.error('[DB] saveMessage klaida:', err.message);
    }
}

function getConversation(contactId) {
    return stmts.getConversation.all(contactId);
}

function getLastMessages(contactId, limit = 10) {
    return stmts.getLastMessages.all(contactId, limit).reverse();
}

function isContacted(contactId) {
    const row = stmts.isContacted.get(contactId);
    return row && row.count > 0;
}

function getContactsByStatus(status) {
    return stmts.getContactsByStatus.all(status);
}

function getAllContacts() {
    return stmts.getAllContacts.all();
}

function getStats() {
    return stmts.getStats.get();
}

function getContactsAwaitingReply() {
    return stmts.getContactsAwaitingReply.all();
}

function getLastMessageInfo(contactId) {
    return stmts.getLastMessageInfo.get(contactId) || null;
}

module.exports = {
    db,
    upsertContact,
    findContact,
    findContactByUrl,
    updateStatus,
    saveMessage,
    getConversation,
    getLastMessages,
    isContacted,
    getContactsByStatus,
    getContactsAwaitingReply,
    getLastMessageInfo,
    getAllContacts,
    getStats
};
