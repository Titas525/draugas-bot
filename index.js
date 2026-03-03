require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const DB = require('./db');

// --- CONFIGURATION ---
const USER_EMAIL = process.env.DRAUGAS_EMAIL;
const USER_PASS = process.env.DRAUGAS_PASS;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';

const ACTIVITY_LOG_PATH = path.join(__dirname, 'activity.json');
let botStatus = {
  active: false,
  lastUpdate: new Date().toISOString(),
  stats: { profilesVisited: 0, messagesSent: 0, approvals: 0, crashes: 0 },
  logs: []
};

function logActivity(message, type = 'info') {
  const entry = { timestamp: new Date().toISOString(), message, type };
  botStatus.logs.unshift(entry);
  if (botStatus.logs.length > 50) botStatus.logs.pop();
  botStatus.lastUpdate = entry.timestamp;
  try {
    fs.writeFileSync(ACTIVITY_LOG_PATH, JSON.stringify(botStatus, null, 2));
  } catch (e) { console.error('Klaida rašant logą:', e.message); }
  console.log(`[${type.toUpperCase()}] ${message}`);
}

const BLACKLIST = ['Liepa, 44', 'Vaida, 46', 'Jurgita, 43'];

// --- SEARCH URLs ---
const SEARCH_URLS = [
  'https://pazintys.draugas.lt/ngrupe.cfm?&lytis=1&amzius=39&amzius2=49&vietove=&vietovep=&miestas=13&ads_id=529',
  'https://pazintys.draugas.lt/pngrupe.cfm?lytis=1&amzius=39&amzius2=49&vietove=&vietovep=&ads_id=1352',
  'https://pazintys.draugas.lt/nagrupe.cfm?lytis=1&amzius=39&amzius2=49&vietove=&vietovep=&ads_id=523',
  'https://pazintys.draugas.lt/tgrupe.cfm?lytis=1&amzius=39&amzius2=49&vietove=&vietovep=&ads_id=527',
  'https://pazintys.draugas.lt/ggrupe.cfm?laikas=1&lytis=1&amzius=39&amzius2=49&ads_id=525',
  'https://pazintys.draugas.lt/foto/paieska/nuotraukos.cfm?megstamiausios=1&ads_id=531',
];
const GAME_URL = 'https://pazintys.draugas.lt/zaidimas.cfm';

if (!GEMINI_API_KEY) {
  console.error('KLAIDA: GEMINI_API_KEY nerastas .env faile!');
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
console.log(`[GEMINI] Naudojamas modelis: ${GEMINI_MODEL}`);
const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

// --- PERSONA CONFIG ---
const PERSONA_CONTEXT = `
Tavo vardas Artūras. Tavo charakteris: nuoširdus, paprastas, šiek tiek šmaikštus, nevengiantis atvirumo.
Tavo situacija: Gyveni vienas su šunimi (tai tavo geriausias draugas šiuo metu). 
Tavo tikslas: Ieškai moters kompanijos - kartu nueiti į kiną, išgerti kavos, pažiūrėti serialą ar tiesiog pasivaikščioti/paplepėti.
Perspektyva: Pradžiai ieškai kompanijos laisvalaikiui, bet galutinis tikslas - rasti artimą žmogų, su kuriuo būtų galima kurti rimtus santykius/draugystę.

STILIUS:
- Rašyk GLAUSTAI (apie 30% trumpiau nei įprastai). 
- Naudok subtilius EMOJI (po 1-2 žinutėje), kad suteiktum gyvumo, bet neperkrauk.
- Venk "copy-paste" stiliaus. Žinutės turi skambėti kaip gyvo žmogaus, o ne roboto.
`;

// --- JUNK FILTER ---
const JUNK_KEYWORDS = ['Pagalba', 'Turite klausimų', 'helpbox', 'Tapk VIP', 'Tapk patvirtintu', 'VIP paštas', 'Tapk nariu', 'reklamos', 'ads_id'];
function isJunkText(txt) {
  return JUNK_KEYWORDS.some(j => txt.includes(j));
}

// --- HELPERS ---

async function notifyTelegram(message, retries = 2) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('[TELEGRAM LOG] (No credentials):', message);
    return;
  }
  for (let i = 0; i <= retries; i++) {
    try {
      const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message })
      });
      if (response.ok) return;
    } catch (err) {
      if (i === retries) console.error('Telegram galutinė klaida:', err.message);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

async function sendTelegramPhoto(photoUrl, caption, retries = 2) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID || !photoUrl) return;
  for (let i = 0; i <= retries; i++) {
    try {
      const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          photo: photoUrl,
          caption: caption ? caption.substring(0, 1024) : ''
        })
      });
      if (response.ok) {
        console.log('[TELEGRAM] Nuotrauka išsiųsta.');
        return true;
      }
    } catch (err) {
      if (i === retries) console.error('Telegram foto klaida:', err.message);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  return false;
}

async function handleConsent(page) {
  try {
    const consentSelectors = [
      'button:has-text("SUTINKU")',
      'button:has-text("Sutinkame")',
      'button:has-text("Sutinku")',
      '#didomi-notice-agree-button',
      '.didomi-continue-without-agreeing',
      'span:has-text("SUTINKU")'
    ];
    for (let i = 0; i < 2; i++) {
      for (const sel of consentSelectors) {
        const btn = page.locator(sel).first();
        if (await btn.count() > 0 && await btn.isVisible()) {
          await btn.click({ force: true, timeout: 3000 }).catch(() => { });
          console.log(`[BOT] Paspaustas sutikimas: ${sel}`);
          await page.waitForTimeout(1000);
        }
      }
      // Slėpti per JS
      await page.evaluate(() => {
        const overlay = document.querySelector('.didomi-popup-container, #didomi-host');
        if (overlay) overlay.remove();
        document.body.style.overflow = 'auto';
      }).catch(() => { });
    }
  } catch (e) { }
}

async function closeHelpBox(page) {
  try {
    const helpClose = page.locator('.helpbox-close, a[title="Uždaryti"]').first();
    if (await helpClose.count() > 0 && await helpClose.isVisible()) {
      await helpClose.click();
      console.log('[BOTA] Uždaryta "Pagalba" juosta.');
      await page.waitForTimeout(500);
    }
  } catch (e) { }
}

async function waitForTelegramApproval(contextInfo) {
  // Fiksuoti laiką PRIEŠ siunčiant pranešimą — tada filtruosime pagal datą
  const sentAt = Math.floor(Date.now() / 1000) - 2; // 2s ankstesnis dėl laikrodžio skirtumo

  await notifyTelegram(contextInfo);

  // Gauti paskutinį update_id kad nereikėtų nuo pradžių
  let lastUpdateId = 0;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?offset=-1&limit=1`);
    const data = await res.json();
    if (data.ok && data.result.length > 0) {
      lastUpdateId = data.result[0].update_id;
    }
  } catch (e) { }

  console.log(`[BOTA] Laukiama Telegram patvirtinimo (OK/NO)... [nuo ${new Date(sentAt * 1000).toLocaleTimeString()}]`);
  const startTime = Date.now();
  const timeout = 15 * 60 * 1000; // 15 min

  while (Date.now() - startTime < timeout) {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=30&limit=10`
      );
      const data = await res.json();
      if (data.ok && data.result.length > 0) {
        for (const update of data.result) {
          lastUpdateId = update.update_id;
          const msg = update.message;
          // Praleisti žinutes atėjusias PRIEŠ pranešimą
          if (!msg || !msg.text || msg.date < sentAt) continue;
          if (msg.chat.id.toString() !== TELEGRAM_CHAT_ID.toString()) continue;

          const text = msg.text.trim().toUpperCase();
          console.log(`[TELEGRAM] Gauta: "${text}"`);
          if (text === 'OK') return true;
          if (text === 'NO' || text === 'STOP' || text === 'NE') {
            await notifyTelegram('❌ Siuntimas atšauktas.');
            return false;
          }
        }
      }
    } catch (e) {
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  await notifyTelegram('⏰ Baigėsi laukimo laikas (15 min). Praleidžiama.');
  return false;
}

async function gotoWithRetry(page, url, options = {}, retries = 3) {
  for (let i = 0; i <= retries; i++) {
    try {
      console.log(`Navigacija į ${url} (bandymas ${i + 1}/${retries + 1})...`);
      return await page.goto(url, { timeout: 60000, waitUntil: 'domcontentloaded', ...options });
    } catch (err) {
      console.error(`Navigacijos klaida ${url}:`, err.message);
      if (i === retries) throw err;
      await page.waitForTimeout(5000);
    }
  }
}

function isBlacklisted(name, info = '') {
  const fullText = `${name} ${info}`.toLowerCase();
  return BLACKLIST.some(item => {
    const parts = item.split(',').map(p => p.trim().toLowerCase());
    return parts.every(p => fullText.includes(p));
  });
}

// --- MESSAGE GENERATION ---

function buildPrompt(profile, dbMessages) {
  let prompt = `${PERSONA_CONTEXT}\n\n`;
  const msgCount = dbMessages.length;

  if (msgCount === 0) {
    // Pirma žinutė — personalizuota pagal pomėgius
    prompt += `SUGALVOK PIRMĄ ŽINUTĘ merginai vardu ${profile.name || 'Narys'}. 
Ji yra iš: ${profile.city || 'Nežinoma'}.
Jos pomėgiai: ${profile.interests || 'Nėra duomenų'}. 
Apie ją: ${profile.bio || 'Nėra duomenų'}. 
Sugalvok ką nors originalaus ir asmenišo pagal jos POMĖGIUS, kad ji norėtų atsakyti.
Nepaminėk savo šuns pirmoje žinutėje - pradėk nuo jos interesų.`;
  } else {
    // Atsakymas - kintanti logika pagal pokalbio stadiją
    const historyText = dbMessages.map(m => {
      const who = m.direction === 'sent' ? 'Artūras' : profile.name;
      return `${who}: ${m.content}`;
    }).join('\n');

    prompt += `ANALIZUOK SUSIRAŠINĖJIMĄ su ${profile.name || 'Narys'} ir PARAŠYK ATSAKYMĄ.
Istorija:
${historyText}

`;
    if (msgCount < 6) {
      prompt += `Pokalbio stadija: PRADŽIA (${msgCount} žinutės). 
Tikslas: Pažinti geriau - klausk apie pomėgius, kasdienybę, kas jai patinka.`;
    } else if (msgCount < 12) {
      prompt += `Pokalbio stadija: VIDURYS (${msgCount} žinučių). 
Tikslas: Jei pokalbis vyksta šiltai, pasiūlyk susitikti Kaune - kavos, pasivaikščioti ar kino.`;
    } else {
      prompt += `Pokalbio stadija: PAŽENGĘS (${msgCount} žinučių). 
Tikslas: Jei dar nesusitarėt susitikti - tiesiogiai pasiūlyk konkrečią vietą ir laiką Kaune.`;
    }
  }

  prompt += `\nParašyk TIK žinutę lietuvių kalba, be kabučių ir paaiškinimų.`;
  return prompt;
}

async function analyzeAndRespond(profile, pageHistory = []) {
  // Rasti kontaktą DB arba sukurti naują
  let contact = null;
  if (profile.profileUrl) {
    contact = DB.findContactByUrl(profile.profileUrl);
  }
  if (!contact) {
    contact = DB.findContact(profile.name);
  }
  if (!contact && profile.profileUrl) {
    const contactId = DB.upsertContact({
      name: profile.name,
      fullText: profile.fullText,
      city: profile.city,
      bio: profile.bio,
      interests: profile.interests,
      photoUrl: profile.photoUrl,
      profileUrl: profile.profileUrl,
      source: profile.source || 'inbox'
    });
    contact = { id: contactId, ...profile };
  }

  // Iš DB gauti visą pokalbį
  let dbMessages = [];
  if (contact && contact.id) {
    dbMessages = DB.getConversation(contact.id);
  }

  // Jei DB tuščia bet turime puslapio istoriją — naudoti ją ir išsaugoti
  if (dbMessages.length === 0 && pageHistory.length > 0 && contact) {
    for (const msg of pageHistory) {
      const direction = msg.toLowerCase().includes('artūras') || msg.toLowerCase().includes('arturas') ? 'sent' : 'received';
      DB.saveMessage(contact.id, direction, msg);
    }
    dbMessages = DB.getConversation(contact.id);
  }

  const prompt = buildPrompt(profile, dbMessages);

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();

    // Siųsti profilio foto per Telegram
    if (profile.photoUrl) {
      await sendTelegramPhoto(profile.photoUrl, `👤 ${profile.fullText || profile.name}`);
    }

    // Construct rich context for Telegram
    let contextMsg = `🔔 NAUJA ŽINUTĖ (Laukia patvirtinimo)\n\n`;
    contextMsg += `👤 GAVĖJA: ${profile.fullText || profile.name}\n`;
    if (profile.bio) contextMsg += `📝 Apie ją: ${profile.bio.substring(0, 300)}${profile.bio.length > 300 ? '...' : ''}\n`;
    if (profile.interests) contextMsg += `🎯 Pomėgiai: ${profile.interests}\n`;

    if (dbMessages.length > 0) {
      const lastThree = dbMessages.slice(-3).map(m => {
        const who = m.direction === 'sent' ? '🟢 Artūras' : '🔵 ' + profile.name;
        return `${who}: ${m.content}`;
      }).join('\n');
      contextMsg += `\n💬 PASKUTINĖS ŽINUTĖS:\n${lastThree}\n`;
    }

    contextMsg += `\n🤖 SUGENERUOTAS ATSAKYMAS:\n"${text}"\n\n`;
    if (profile.profileUrl) contextMsg += `🔗 Profilis: ${profile.profileUrl}\n`;
    contextMsg += `👉 Rašykite "OK" siuntimui arba "NO" atšaukimui.`;

    const approved = await waitForTelegramApproval(contextMsg);
    if (approved) {
      botStatus.stats.approvals++;
      botStatus.stats.messagesSent++;
      logActivity(`Žinutė patvirtinta: ${profile.fullText || profile.name}`, 'success');
      // Išsaugoti žinutę DB
      if (contact && contact.id) {
        DB.saveMessage(contact.id, 'sent', text);
        DB.updateStatus(contact.id, 'messaged');
      }
    } else {
      logActivity(`Žinutė nepatvirtinta: ${profile.fullText || profile.name}`, 'warn');
    }
    return approved ? text : null;
  } catch (err) {
    botStatus.stats.crashes++;
    logActivity(`Gemini klaida: ${err.message}`, 'error');
    const shortName = (profile.fullText || profile.name || '').split('(')[0].trim();
    const fallback = `Labas, ${shortName}! Kaip tavo diena praėjo? 😊`;
    let fallbackMsg = `⚠️ GEMINI KLAIDA\n\n👤 GAVĖJA: ${profile.fullText || profile.name}\n`;
    if (profile.profileUrl) fallbackMsg += `🔗 Profilis: ${profile.profileUrl}\n`;
    fallbackMsg += `🤖 ŽINUTĖ:\n"${fallback}"\n\n👉 Rašykite "OK" siuntimui.`;
    const contextMsg = fallbackMsg;
    const approved = await waitForTelegramApproval(contextMsg);
    if (approved) {
      botStatus.stats.approvals++;
      botStatus.stats.messagesSent++;
      if (contact && contact.id) {
        DB.saveMessage(contact.id, 'sent', fallback);
        DB.updateStatus(contact.id, 'messaged');
      }
    }
    return approved ? fallback : null;
  }
}

// --- SEND MESSAGE ---

async function sendMessage(page, message, profileUrl, contactName) {
  if (!message) {
    console.log('[SEND] Žinutė tuščia, praleidžiama.');
    return false;
  }

  try {
    console.log(`[SEND] Siuntimas ${contactName || ''}: "${message.substring(0, 60)}..."`);

    // 1. Pašalinti overlayus
    const clearOverlays = async () => {
      await page.evaluate(() => {
        ['.didomi-popup-container', '#didomi-host', '#didomi-notice',
          '.didomi-popup-backdrop', '.helpbox', '[id*="didomi"]'
        ].forEach(sel => document.querySelectorAll(sel).forEach(el => el.remove()));
        document.body.style.overflow = 'auto';
        document.body.style.pointerEvents = 'auto';
      }).catch(() => { });
    };

    // 2. Nueiti į profilio puslapį — čia yra įterpta textarea
    if (profileUrl) {
      const narysMatch = profileUrl.match(/narys=(\d+)/);
      const cleanUrl = narysMatch
        ? `https://pazintys.draugas.lt/narys.cfm?narys=${narysMatch[1]}`
        : profileUrl;
      console.log(`[SEND] Profilio puslapis: ${cleanUrl}`);
      await gotoWithRetry(page, cleanUrl);
      await page.waitForTimeout(4000);
      await clearOverlays();
      await closeHelpBox(page);
    }

    console.log(`[SEND] URL: ${page.url()}`);
    try { await page.screenshot({ path: 'before_send.png', timeout: 3000 }); } catch (e) { }

    // 3. Rasti textarea — profilio puslapyje yra "Rašyti komentarą"
    // Textarea gali būti hidden CSS, tad pirma bandome JS inject, paskui fill()
    const textarea = page.locator('textarea').first();
    const taCount = await textarea.count();
    console.log(`[SEND] Textarea skaičius: ${taCount}`);

    if (taCount === 0) {
      console.error('[SEND] ❌ Textarea nerasta puslapyje!');
      try { await page.screenshot({ path: 'send_no_textarea.png', timeout: 3000 }); } catch (e) { }
      await notifyTelegram(`❌ Žinutės laukas nerastas! URL: ${page.url()}`);
      return false;
    }

    // 4. Įvesti žinutę — JS inject (veikia net jei elementas hidden)
    const injected = await page.evaluate((msg) => {
      const ta = document.querySelector('textarea');
      if (!ta) return false;
      // Pabandyti paversti matomą
      ta.style.display = 'block';
      ta.style.visibility = 'visible';
      ta.removeAttribute('hidden');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      if (setter) setter.call(ta, msg); else ta.value = msg;
      ta.dispatchEvent(new Event('focus', { bubbles: true }));
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.dispatchEvent(new Event('change', { bubbles: true }));
      ta.focus();
      return true;
    }, message);

    if (!injected) {
      console.error('[SEND] ❌ Textarea nerasta per JS!');
      await notifyTelegram(`❌ Žinutės laukas nerastas! URL: ${page.url()}`);
      return false;
    }
    console.log('[SEND] ✅ Žinutė įvesta per JS inject');
    await page.waitForTimeout(600);
    try { await page.screenshot({ path: 'thread_open.png', timeout: 3000 }); } catch (e) { }

    // 5. Siųsti — JS click (aplenkia matomumo tikrinimą)
    const sendResult = await page.evaluate(() => {
      const selectors = [
        'button.create-comment',
        'button[type="submit"]',
        'input[type="submit"]',
        '.send-btn',
        'button'
      ];
      for (const sel of selectors) {
        const btn = document.querySelector(sel);
        if (btn) {
          btn.style.display = 'block';
          btn.style.visibility = 'visible';
          btn.click();
          return `clicked: ${btn.className || btn.type}`;
        }
      }
      // Paskutinis: submit forma
      const form = document.querySelector('textarea')?.closest('form');
      if (form) { form.submit(); return 'form-submit'; }
      return null;
    });

    if (!sendResult) {
      await page.keyboard.press('Enter');
      console.log('[SEND] Fallback: Enter');
    } else {
      console.log(`[SEND] ✅ Siųsti: ${sendResult}`);
    }


    await page.waitForTimeout(3000);
    try { await page.screenshot({ path: 'after_send.png', timeout: 5000 }); } catch (e) { }

    return true;

  } catch (err) {
    console.error('[SEND] Klaida:', err.message);
    try { await page.screenshot({ path: 'send_error.png', timeout: 5000 }); } catch (e) { }
    await notifyTelegram(`❌ Siuntimo klaida: ${err.message.substring(0, 200)}`);
    return false;
  }
}



// --- CHECK REPLIES (Stebimas pokalbių atsakymas) ---

async function checkReplies(page) {
  console.log('--- TIKRINAMI ATSAKYMAI ---');

  // Gauti iš DB kontaktus kuriems mes rašėme pirmi ir jie atsakė (paskutinė žinutė jų)
  const contactsToCheck = DB.getContactsAwaitingReply();
  console.log(`[REPLY] Laukia atsakymų: ${contactsToCheck.length} kontaktai.`);

  if (contactsToCheck.length === 0) return;

  // Atidaryti inbox žinučių sąrašą
  try {
    await gotoWithRetry(page, 'https://pazintys.draugas.lt/zinutes/thread/list');
    await page.waitForTimeout(4000);
    await handleConsent(page);
    await closeHelpBox(page);
  } catch (e) {
    console.error('[REPLY] Nepavyko atidaryti inbox:', e.message);
    return;
  }

  // Surinkti visus pokalbių thread'us iš puslapio
  const threads = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a[href*="thread"], a.usermenu, .thread-item a, .conversation-link'))
      .map(a => ({ name: a.innerText.trim(), href: a.href }))
      .filter(t => t.name.length > 1 && t.href.includes('pazintys.draugas.lt'));
  });

  for (const contact of contactsToCheck) {
    try {
      const contactName = contact.name.split('(')[0].trim();
      console.log(`[REPLY] Tikrinamas: ${contactName} (profileUrl: ${contact.profileUrl})`);

      // Rasti šio kontakto thread'ą
      let threadUrl = null;

      // 1. Ieškoti pagal vardą threads sąraše
      const matchThread = threads.find(t =>
        t.name.toLowerCase().includes(contactName.toLowerCase()) ||
        contactName.toLowerCase().includes(t.name.split('(')[0].trim().toLowerCase())
      );
      if (matchThread) threadUrl = matchThread.href;

      // 2. Jei nerastas — nueiti į profilio puslapį ir rasti thread nuorodą
      if (!threadUrl && contact.profileUrl) {
        await gotoWithRetry(page, contact.profileUrl);
        await page.waitForTimeout(2000);
        await handleConsent(page);
        const threadLink = await page.evaluate(() => {
          const a = document.querySelector('a[href*="thread"], a[href*="zinutes"]');
          return a ? a.href : null;
        });
        if (threadLink) threadUrl = threadLink;
      }

      if (!threadUrl) {
        console.log(`[REPLY] Nerasta thread URL: ${contactName}`);
        continue;
      }

      // Atidaryti pokalbį
      await gotoWithRetry(page, threadUrl);
      await page.waitForTimeout(3000);
      await handleConsent(page);
      await closeHelpBox(page);
      try { await page.screenshot({ path: `thread_reply_${contactName}.png`, timeout: 5000 }); } catch (e) { }

      // Nuskaityti žinutes iš puslapio
      const pageMessages = await page.evaluate((junk) => {
        const isJunk = (t) => junk.some(j => t.includes(j));
        // Bandyti skirtingus selektorius
        const sentMsgs = Array.from(document.querySelectorAll('.message-sent, .sent, .my-message, [class*="sent"]'));
        const recvMsgs = Array.from(document.querySelectorAll('.message-received, .received, .their-message, [class*="received"]'));

        if (sentMsgs.length > 0 || recvMsgs.length > 0) {
          const result = [];
          const all = Array.from(document.querySelectorAll('.message, .msg, .chat-item, .thread-message')).slice(-20);
          for (const el of all) {
            const isSent = el.classList.contains('sent') || el.classList.contains('message-sent') || el.querySelector('.sent');
            const txt = el.innerText.trim();
            if (txt.length > 0 && !isJunk(txt)) result.push({ dir: isSent ? 'sent' : 'received', text: txt });
          }
          return result;
        }

        // Fallback: visi tekstai
        const allMsgs = Array.from(document.querySelectorAll('p, .text, .content'))
          .filter(el => el.innerText.trim().length > 5 && !isJunk(el.innerText.trim()))
          .slice(-20);
        return allMsgs.map(el => ({ dir: 'unknown', text: el.innerText.trim() }));
      }, JUNK_KEYWORDS);

      // Rasti naujas žinutes (kurių nėra DB)
      const dbMessages = DB.getConversation(contact.id);
      const dbContents = new Set(dbMessages.map(m => m.content.substring(0, 50)));

      let hasNewReceived = false;
      for (const msg of pageMessages) {
        const snippet = msg.text.substring(0, 50);
        if (!dbContents.has(snippet)) {
          // Nauja žinutė — išsaugoti
          const direction = msg.dir === 'sent' ? 'sent' : 'received';
          DB.saveMessage(contact.id, direction, msg.text);
          if (direction === 'received') hasNewReceived = true;
          console.log(`[REPLY] Nauja žinutė (${direction}): ${msg.text.substring(0, 60)}...`);
        }
      }

      if (!hasNewReceived) {
        console.log(`[REPLY] Nėra naujų žinučių nuo: ${contactName}`);
        continue;
      }

      // Atnaujinti statusą
      DB.updateStatus(contact.id, 'active');

      // Generuoti atsakymą
      const updatedMessages = DB.getConversation(contact.id);
      const profileData = {
        name: contact.name,
        fullText: contact.fullText || contact.name,
        city: contact.city || 'Kaunas',
        bio: contact.bio || '',
        interests: contact.interests || '',
        photoUrl: contact.photoUrl || '',
        profileUrl: contact.profileUrl || ''
      };

      const reply = await analyzeAndRespond(profileData, [], { id: contact.id, ...contact });
      if (reply) {
        const sent = await sendMessage(page, reply, contact.profileUrl, contact.name);
        if (!sent) {
          await notifyTelegram(`⚠️ Atsakymas patvirtintas, bet NEIŠSIŲSTAS: ${contact.name}`);
        } else {
          DB.saveMessage(contact.id, 'sent', reply);
        }
      }

      // Grįžti į thread sąrašą
      await gotoWithRetry(page, 'https://pazintys.draugas.lt/zinutes/thread/list');
      await page.waitForTimeout(2000);

    } catch (e) {
      console.error(`[REPLY] Klaida su ${contact.name}:`, e.message);
    }
  }

  console.log('[REPLY] Atsakymų tikrinimas baigtas.');
}

// --- PROCESS INBOX ---

async function processInbox(page) {
  console.log('--- TIKRINAMAS INBOX ---');
  const inboxUrl = 'https://pazintys.draugas.lt/zinutes/thread/list';
  try {
    await gotoWithRetry(page, 'https://pazintys.draugas.lt/');
    await page.waitForTimeout(3000);
    await gotoWithRetry(page, inboxUrl);
    await page.waitForTimeout(5000);
    await closeHelpBox(page);

    try { await page.screenshot({ path: 'inbox_debug.png', timeout: 5000 }); } catch (e) { }

    const threads = await page.evaluate(() => {
      const threadLinks = Array.from(document.querySelectorAll('a.usermenu'));
      const results = [];
      const usedNames = new Set();
      for (const el of threadLinks) {
        const text = el.innerText.trim();
        const namePart = text.split('(')[0].trim();
        const words = namePart.split(/\s+/);
        const name = words[words.length - 1];

        if (name && name.length > 2 && !usedNames.has(name) && !name.match(/\d/)) {
          const parent = el.closest('div, li, tr') || el;
          const lastMsgSentByMe = parent.innerHTML.includes('◄') || parent.innerHTML.includes('arrow') || !!parent.querySelector('.replied');
          const href = el.href || '';
          const imgEl = parent ? parent.querySelector('img') : null;
          let photoUrl = imgEl ? (imgEl.src || '') : '';
          if (photoUrl && !photoUrl.includes('pazintys.draugas.lt') && !photoUrl.includes('/foto/')) {
            photoUrl = '';
          }
          results.push({ name, fullText: text, lastMsgSentByMe, href, photoUrl });
          usedNames.add(name);
        }
      }
      return results;
    });

    console.log(`Rasta potencialių pokalbių: ${threads.length}`);

    for (const thread of threads) {
      if (isBlacklisted(thread.name, thread.fullText)) continue;
      if (!thread.lastMsgSentByMe) {
        console.log(`[BOTA] Atsakoma: ${thread.name} (${thread.fullText})`);
        try {
          if (thread.href && thread.href.includes('threadId')) {
            await gotoWithRetry(page, thread.href);
          } else {
            await page.locator('a.usermenu').filter({ hasText: thread.name }).first().click({ timeout: 15000 });
          }
          await page.waitForTimeout(3000);
          await closeHelpBox(page);
          try { await page.screenshot({ path: `thread_${thread.name}.png`, timeout: 5000 }); } catch (e) { }

          const history = await page.evaluate((junkList) => {
            const isJunk = (txt) => junkList.some(j => txt.includes(j));
            const msgs = Array.from(document.querySelectorAll('.message-text, .msg-content, .text-content, .message-bubble, .msg_text, .chat-message, .view-message'));
            if (msgs.length > 0) return msgs.slice(-15).map(m => m.innerText.trim()).filter(t => t.length > 0 && !isJunk(t));
            const blocks = Array.from(document.querySelectorAll('div, span')).filter(el => {
              const txt = el.innerText.trim();
              return txt.length > 5 && txt.length < 500 && !isJunk(txt);
            });
            return blocks.slice(-20).map(m => m.innerText.trim());
          }, JUNK_KEYWORDS);

          console.log(`[BOTA] Istorijos ilgis su ${thread.name}: ${history.length}`);

          // Upsert contact into DB 
          const contactId = DB.upsertContact({
            name: thread.name,
            fullText: thread.fullText,
            photoUrl: thread.photoUrl,
            profileUrl: thread.href || `inbox:${thread.name}`,
            source: 'inbox',
            status: 'active'
          });

          const profileData = {
            name: thread.name,
            fullText: thread.fullText,
            photoUrl: thread.photoUrl,
            profileUrl: thread.href || `inbox:${thread.name}`,
            source: 'inbox'
          };

          const reply = await analyzeAndRespond(profileData, history);
          if (reply) {
            const sent = await sendMessage(page, reply, profileData.profileUrl, thread.name);
            if (!sent) {
              await notifyTelegram(`⚠️ Žinutė patvirtinta, bet NEIŠSIŲSTA kontaktui: ${thread.fullText}`);
            }
          }
          await gotoWithRetry(page, inboxUrl);
          await page.waitForTimeout(2000);
        } catch (e) {
          console.error(`[BOTA] Klaida su ${thread.name}:`, e.message);
          await gotoWithRetry(page, inboxUrl);
        }
      }
    }
  } catch (err) {
    console.error('Klaida Inbox:', err.message);
  }
}

// --- SEARCH NEW CONTACTS ---

async function searchNewContacts(page) {
  console.log('--- IEŠKOMA NAUJŲ KONTAKTŲ ---');

  for (const searchUrl of SEARCH_URLS) {
    console.log(`\n[PAIEŠKA] ${searchUrl}`);
    try {
      await gotoWithRetry(page, searchUrl);
      await page.waitForTimeout(5000);
      await closeHelpBox(page);

      const profileLinks = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('.nario-foto, a[href*="narys.cfm"], .member-item, .user-item'));
        const seen = new Set();
        return items.map(item => {
          const anchor = (item instanceof HTMLAnchorElement) ? item : item.querySelector('a[href*="narys.cfm"]');
          const link = anchor ? anchor.href : null;
          const nameText = item.innerText.trim();
          const imgEl = item.querySelector('img');
          const photoUrl = imgEl ? imgEl.src : '';
          return { link, nameText, photoUrl };
        }).filter(p => {
          if (!p.link || p.nameText.length < 2 || seen.has(p.link)) return false;
          seen.add(p.link);
          return true;
        }).slice(0, 10);
      });

      console.log(`[PAIEŠKA] Rasta profilių: ${profileLinks.length}`);

      for (const p of profileLinks) {
        if (isBlacklisted(p.nameText)) {
          logActivity(`Praleidžiamas juodajame sąraše: ${p.nameText}`, 'warn');
          continue;
        }

        // Patikrinti ar jau kontaktuotas
        const existing = DB.findContactByUrl(p.link);
        if (existing && existing.status !== 'new') {
          console.log(`[PAIEŠKA] Jau kontaktuotas: ${p.nameText}, praleidžiama.`);
          continue;
        }

        botStatus.stats.profilesVisited++;
        try {
          await gotoWithRetry(page, p.link);
          await page.waitForTimeout(3000);
          await closeHelpBox(page);

          const profile = await page.evaluate(() => {
            const name = document.querySelector('h1')?.innerText.trim() || 'Narys';
            const bio = document.querySelector('.nario-informacija, .profile-info, .about-me')?.innerText.trim() || '';
            const interests = Array.from(document.querySelectorAll('.pomegis, .hobby, .interest')).map(el => el.innerText.trim()).join(', ');
            const allText = document.body.innerText;
            let city = '';
            const cityMatch = allText.match(/Miestas:\s*([^\n]+)/i) || allText.match(/Vietov\u0117:\s*([^\n]+)/i);
            if (cityMatch) city = cityMatch[1].trim();
            const nameMatch = name.match(/\(.*?,\s*(\w+)\)/);
            if (!city && nameMatch) city = nameMatch[1];
            const photoImg = document.querySelector('.nario-foto img, .profile-photo img, img.user-photo');
            const photoUrl = photoImg ? photoImg.src : '';
            // Narys ID i\u0161 URL
            const narysMath = window.location.href.match(/narys=(\d+)/);
            const narysId = narysMath ? narysMath[1] : null;
            const profileUrl = narysId ? `https://pazintys.draugas.lt/narys.cfm?narys=${narysId}` : window.location.href;
            return { name, bio, interests, city, photoUrl, profileUrl, narysId };
          });

          // Tik Kaunas kontaktai
          const isKaunas = profile.city && profile.city.toLowerCase().includes('kaunas');
          const nameHasKaunas = p.nameText.toLowerCase().includes('kaunas');

          if (!isKaunas && !nameHasKaunas) {
            console.log(`[PAIEŠKA] Ne Kaunas (${profile.city || 'nežinoma'}): ${profile.name}, praleidžiama.`);
            continue;
          }

          logActivity(`Kaunas kontaktas: ${profile.name} (${profile.city})`, 'info');

          // Išsaugoti DB
          // Profilio URL i\u0161 narys evaluate
          const cleanProfileUrl = profile.profileUrl || p.link;
          const fullText = profile.name; // naudosime tik var\u0111

          const contactId = DB.upsertContact({
            name: profile.name,
            fullText: profile.name,
            city: profile.city || 'Kaunas',
            bio: profile.bio,
            interests: profile.interests,
            photoUrl: profile.photoUrl || p.photoUrl,
            profileUrl: cleanProfileUrl,
            source: searchUrl,
            status: 'new'
          });

          // Patikrinti ar jau siuntėme žinutę
          if (contactId && DB.isContacted(contactId)) {
            console.log(`[PAIEŠKA] Jau siuntėme žinutę: ${profile.name}`);
            continue;
          }

          const profileData = {
            name: profile.name,
            fullText: profile.name,
            city: profile.city || 'Kaunas',
            bio: profile.bio,
            interests: profile.interests,
            photoUrl: profile.photoUrl || p.photoUrl,
            profileUrl: cleanProfileUrl,
            source: searchUrl
          };

          const reply = await analyzeAndRespond(profileData);
          if (reply) {
            const sent = await sendMessage(page, reply, profileData.profileUrl, profile.name);
            if (sent) {
              logActivity(`✅ Pirma žinutė išsiųsta: ${profile.name}`, 'success');
            } else {
              await notifyTelegram(`⚠️ Žinutė patvirtinta, bet NEIŠSIŲSTA: ${profile.name}`);
            }
          }
          await page.waitForTimeout(3000);
        } catch (e) {
          console.error(`[PAIEŠKA] Klaida su profiliu ${p.nameText}:`, e.message);
        }
      }
    } catch (e) {
      console.error(`[PAIEŠKA] Klaida su URL ${searchUrl}:`, e.message);
    }
  }
}

// --- GAME PAGE (LIKE PROFILES) ---

async function playGame(page) {
  console.log('--- ŽAIDIMAS (LIKE) ---');
  try {
    await gotoWithRetry(page, GAME_URL);
    await page.waitForTimeout(5000);
    await closeHelpBox(page);

    // Žaisti iki 20 profilių
    for (let i = 0; i < 20; i++) {
      try {
        const profileInfo = await page.evaluate(() => {
          const name = document.querySelector('.game-name, .profile-name, h2, h3')?.innerText.trim() || '';
          const city = document.body.innerText.match(/Kaunas/i) ? 'Kaunas' : '';
          const imgEl = document.querySelector('.game-photo img, .profile-photo img, img');
          const photoUrl = imgEl ? imgEl.src : '';
          return { name, city, photoUrl };
        });

        if (profileInfo.city.toLowerCase().includes('kaunas')) {
          // Like Kaunas profiles
          const likeBtn = page.locator('button:has-text("Patinka"), .like-btn, .game-like, a:has-text("Patinka")').first();
          if (await likeBtn.count() > 0) {
            await likeBtn.click();
            console.log(`[ŽAIDIMAS] ❤️ LIKE: ${profileInfo.name}`);
          }
        } else {
          // Skip non-Kaunas
          const skipBtn = page.locator('button:has-text("Praleisti"), .skip-btn, .game-skip, a:has-text("Nepatinka"), button:has-text("Kitas")').first();
          if (await skipBtn.count() > 0) {
            await skipBtn.click();
            console.log(`[ŽAIDIMAS] ⏭️ SKIP: ${profileInfo.name} (ne Kaunas)`);
          }
        }
        await page.waitForTimeout(2000);
      } catch (e) {
        console.log(`[ŽAIDIMAS] Žaidimas baigtas arba klaida: ${e.message}`);
        break;
      }
    }
  } catch (err) {
    console.error('[ŽAIDIMAS] Klaida:', err.message);
  }
}

// --- MAIN ---

async function run() {
  // Patikrinti ar jau veikia kitas egzempliorius
  const LOCK_PATH = path.join(__dirname, 'bot.lock');
  if (fs.existsSync(LOCK_PATH)) {
    const lockAge = Date.now() - fs.statSync(LOCK_PATH).mtimeMs;
    if (lockAge < 10 * 60 * 1000) { // 10 min
      console.error('[BOT] Jau veikia kitas botas (bot.lock). Stabdoma.');
      process.exit(0);
    }
  }
  fs.writeFileSync(LOCK_PATH, String(process.pid));
  process.on('exit', () => { try { fs.unlinkSync(LOCK_PATH); } catch (e) { } });
  process.on('SIGINT', () => { try { fs.unlinkSync(LOCK_PATH); } catch (e) { } process.exit(0); });

  botStatus.active = true;
  logActivity('Botas pradeda darbą...', 'info');
  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 }
  });

  // Įkelti išsaugotus slapukus (cookies) jei yra
  const COOKIES_PATH = path.join(__dirname, 'cookies.json');
  if (fs.existsSync(COOKIES_PATH)) {
    try {
      const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf-8'));
      if (Array.isArray(cookies) && cookies.length > 0) {
        await context.addCookies(cookies);
        console.log(`[COOKIES] Įkelti ${cookies.length} slapukai.`);
      }
    } catch (e) {
      console.log('[COOKIES] Nepavyko įkelti slapukų:', e.message);
    }
  }

  const page = await context.newPage();
  page.on('console', msg => { if (msg.type() === 'log') console.log(`[PAGE] ${msg.text()}`); });

  try {
    // --- LOGIN SEQUENCE ---
    console.log('Jungiamasi prie draugas.lt...');
    await gotoWithRetry(page, 'https://www.draugas.lt/');

    // Pašalinti consent overlayus
    await handleConsent(page);
    await page.waitForTimeout(1000);

    let isLoggedIn = await page.evaluate(() => {
      const text = document.body.innerText;
      return text.includes('Arturas') ||
        text.includes('Art\u016bras') ||
        text.includes('Koreguoti profil\u012f') ||
        !!document.querySelector('.__logout') ||
        !!document.querySelector('a[href*="atsijungti"]') ||
        !!document.querySelector('.user-avatar');
    });

    console.log('[LOGIN] Ar prisijungta:', isLoggedIn);

    if (!isLoggedIn) {
      console.log('Prisijungiama su duomenimis...');
      try {
        // Nuo pabaigos: visiškai pašalinti overlayus per JS
        await page.evaluate(() => {
          const selectors = [
            '.didomi-popup-container',
            '#didomi-host',
            '#didomi-notice',
            '.didomi-popup-backdrop',
            '.cookie-consent',
            '[class*="consent"]',
            '[class*="cookie"]',
            '[id*="didomi"]'
          ];
          for (const sel of selectors) {
            document.querySelectorAll(sel).forEach(el => el.remove());
          }
          document.body.style.overflow = 'auto';
          document.body.style.pointerEvents = 'auto';
        });
        await page.waitForTimeout(500);

        // Pabandyti SUTINKU dar kartą po JS šalinimo
        const sutinkuBtn = page.locator('button:has-text("SUTINKU")').first();
        if (await sutinkuBtn.count() > 0 && await sutinkuBtn.isVisible()) {
          await sutinkuBtn.click({ force: true }).catch(() => { });
          await page.waitForTimeout(1000);
        }

        // Įvesti kredencialus
        await page.fill('.email.__loginEmail', USER_EMAIL);
        await page.fill('.pass.__loginPassword', USER_PASS);
        await page.waitForTimeout(500);

        // Spausti pateikimo mygtuką (rožinė rodyklė)
        const submitBtn = page.locator('.submit, .btn-submit, button[type="submit"], input[type="submit"]').first();
        if (await submitBtn.count() > 0) {
          await submitBtn.click({ force: true });
        } else {
          await page.keyboard.press('Enter');
        }

        // Palaukti prisijungimo
        await page.waitForFunction(
          () => document.body.innerText.includes('Arturas') ||
            document.body.innerText.includes('Art\u016bras') ||
            document.body.innerText.includes('Koreguoti profil\u012f') ||
            !!document.querySelector('a[href*="atsijungti"]'),
          { timeout: 20000 }
        ).catch(() => { });

        isLoggedIn = await page.evaluate(() => {
          const t = document.body.innerText;
          return t.includes('Arturas') || t.includes('Art\u016bras') || t.includes('Koreguoti profil\u012f') || !!document.querySelector('a[href*="atsijungti"]');
        });
      } catch (e) {
        console.log('[LOGIN] Klaida:', e.message);
        isLoggedIn = await page.evaluate(() => {
          const t = document.body.innerText;
          return t.includes('Arturas') || t.includes('Art\u016bras') || t.includes('Koreguoti profil\u012f');
        });
      }

      if (!isLoggedIn) {
        console.error('Login nepavyko galutinai.');
        await page.screenshot({ path: 'login_error_final.png' });
        return;
      }
    }

    console.log('✅ Prisijungta sėkmingai!\n');

    // Išsaugoti naujovinius slapukus po prisijungimo
    try {
      const allCookies = await context.cookies();
      fs.writeFileSync(COOKIES_PATH, JSON.stringify(allCookies, null, 2));
      console.log(`[COOKIES] Išsaugoti ${allCookies.length} slapukai.`);
    } catch (e) { console.log('[COOKIES] Nepavyko išsaugoti:', e.message); }

    await notifyTelegram('🤖 Botas sėkmingai prisijungė!');

    // 1. Patikrinti atsakymus į mūsų žinutes
    await checkReplies(page);

    // 2. Ieškoti naujų kontaktų puslapiuose
    await searchNewContacts(page);

    // 3. Žaidimas - like Kaunas profiliai
    await playGame(page);

    // Statistika
    const stats = DB.getStats();
    await notifyTelegram(`📊 SESIJOS STATISTIKA:\n• Kontaktai DB: ${stats.totalContacts}\n• Siųsta žinučių: ${stats.sentMessages}\n• Gauta žinučių: ${stats.receivedMessages}\n• Aktyvūs pokalbiai: ${stats.active}\n• Šioje sesijoje: ${botStatus.stats.messagesSent} siųsta, ${botStatus.stats.profilesVisited} peržiūrėta`);

  } catch (error) {
    botStatus.stats.crashes++;
    logActivity(`Kritinė klaida: ${error.message}`, 'error');
    await notifyTelegram(`[BOTA CRASH] ${error.message}`);
  } finally {
    botStatus.active = false;
    logActivity('Darbas baigtas.', 'info');
    await browser.close();
  }
}

// --- CONTINUOUS LOOP ---
const LOOP_DELAY_MINUTES = 35;

async function main() {
  let cycle = 1;
  while (true) {
    console.log(`\n=== CIKLAS ${cycle} ===`);
    try {
      await run();
    } catch (e) {
      console.error(`[MAIN] Kritinė klaida cikle ${cycle}:`, e.message);
    }
    console.log(`[MAIN] Ciklas ${cycle} baigtas. Laukiama ${LOOP_DELAY_MINUTES} min prieš kitą ciklą...`);
    // Update activity heartbeat
    try {
      const act = JSON.parse(fs.readFileSync(ACTIVITY_LOG_PATH, 'utf8'));
      act.active = false;
      act.lastUpdate = new Date().toISOString();
      act.nextCycle = new Date(Date.now() + LOOP_DELAY_MINUTES * 60 * 1000).toISOString();
      fs.writeFileSync(ACTIVITY_LOG_PATH, JSON.stringify(act, null, 2));
    } catch (_) { }
    await new Promise(r => setTimeout(r, LOOP_DELAY_MINUTES * 60 * 1000));
    cycle++;
  }
}

main();
