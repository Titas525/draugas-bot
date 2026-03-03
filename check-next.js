require('dotenv').config();
const DB = require('./db');
const contacts = DB.getContactsByStatus('new');
const next = contacts.find(c => !DB.isContacted(c.id));
if (!next) { console.log('Nėra naujų kontaktų!'); process.exit(0); }
console.log('Vardas:', next.name);
console.log('Miestas:', next.city);
console.log('Bio:', (next.bio || '').substring(0, 300));
console.log('Pomėgiai:', next.interests || 'nėra');
console.log('URL:', next.profileUrl);
console.log('ID:', next.id);
