/**
 * send-next.js — siunčia žinutę kitam nekontaktuotam kontaktui iš DB
 * Paleidimas: node send-next.js
 */
require('dotenv').config();
const { chromium } = require('playwright');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
const DB = require('./db');

const COOKIES_PATH = path.join(__dirname, 'cookies.json');
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

const PERSONA_CONTEXT = `Tavo vardas Artūras. Tavo charakteris: nuoširdus, paprastas, šiek tiek šmaikštus.
Tavo situacija: Gyveni vienas su šunimi. Ieškai moters kompanijos Kaune.
Tavo tikslas: Ieškai kompanijos - kartu nueiti į kiną, išgerti kavos, pasivaikščioti.
PIRMOS ŽINUTĖS STRUKTŪRA:
1. Trumpas pasisveikinimas
2. INTRIGUOJANTIS klausimas remiantis jos profilio informacija (akys, išvaizda, pomėgiai, miestas — kas nors konkretus apie JĄ, pvz. "ar tikrai tavo akys žalios?" arba "iš kur toks interesas į X?")
3. Viena frazė apie šunį ir kavą (lengvai, be spaudimo)
STILIUS: Glaustai (2-3 sakiniai). Vienas emoji. Be kabučių.`;

async function notifyTelegram(msg) {
    try {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: msg })
        });
    } catch (e) { console.error('Telegram klaida:', e.message); }
}

async function waitForApproval(msg) {
    const sentAt = Math.floor(Date.now() / 1000) - 2;
    await notifyTelegram(msg);

    let lastUpdateId = 0;
    try {
        const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?offset=-1&limit=1`);
        const data = await r.json();
        if (data.ok && data.result.length > 0) {
            lastUpdateId = data.result[0].update_id;
        }
    } catch (e) { /* ignore */ }

    console.log('\n⏳ Laukiama patvirtinimo Telegram (OK/NO)...');
    const start = Date.now();
    const limit = 5 * 60 * 1000; // 5 min

    while (Date.now() - start < limit) {
        try {
            const r = await fetch(
                `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=30&limit=10`
            );
            const data = await r.json();
            if (data.ok && data.result.length > 0) {
                for (const update of data.result) {
                    lastUpdateId = update.update_id;
                    const message = update.message;
                    if (!message || !message.text || message.date < sentAt) continue;
                    const txt = message.text.trim().toUpperCase();
                    if (txt === 'OK') { console.log('✅ Patvirtinta!'); return true; }
                    if (txt === 'NO' || txt === 'NE' || txt === 'STOP') { console.log('❌ Atmesta.'); return false; }
                }
            }
        } catch (e) { /* ignore */ }
    }
    console.log('⏰ Timeout — laikoma kaip atmesta.');
    return false;
}

function clearOverlays(page) {
    return page.evaluate(() => {
        ['.didomi-popup-container', '#didomi-host', '#didomi-notice',
            '.didomi-popup-backdrop', '.helpbox', '[id*="didomi"]'
        ].forEach(sel => document.querySelectorAll(sel).forEach(el => el.remove()));
        document.body.style.overflow = 'auto';
        document.body.style.pointerEvents = 'auto';
    }).catch(() => { });
}

async function run() {
    // Rasti kitą nekontaktuotą kontaktą
    const contacts = DB.getContactsByStatus('new');
    const next = contacts.find(c => !DB.isContacted(c.id));

    if (!next) {
        console.log('Nėra naujų nekontaktuotų kontaktų DB!');
        return;
    }

    console.log(`\n=== SIUNČIAMA: ${next.name} ===`);
    console.log(`Profilis: ${next.profileUrl}`);
    console.log(`Bio: ${(next.bio || '').substring(0, 200)}`);

    // Generuoti žinutę
    const prompt = `${PERSONA_CONTEXT}

SUGALVOK PIRMĄ ŽINUTĘ merginai vardu ${next.name}.
Ji yra iš: ${next.city || 'Kaunas'}.
Jos informacija: ${(next.bio || 'nėra').substring(0, 500)}.
Pomėgiai: ${next.interests || 'nėra duomenų'}.

Parašyk TIK žinutę lietuvių kalba, be kabučių ir paaiškinimų.`;

    console.log('\nGeneruojama žinutė...');
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    console.log(`\nŽinutė: "${text}"`);

    // ── Naršyklė atidaroma PRIEŠ Telegram, kad perskaitytume pokalbio kontekstą ──
    console.log('\nPaleidžiama naršyklė...');
    const browser = await chromium.launch({ headless: false });
    const ctx = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 }
    });

    const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf-8'));
    await ctx.addCookies(cookies);
    const page = await ctx.newPage();

    // ── 1. Profilio puslapis → spausti "Rašyti žinutę" (__callNewMessage) ──────
    const narysMatch = next.profileUrl.match(/narys=(\d+)/);
    const cleanUrl = narysMatch
        ? `https://pazintys.draugas.lt/narys.cfm?narys=${narysMatch[1]}`
        : next.profileUrl;

    console.log(`\nNavigacija į profilį: ${cleanUrl}`);
    await page.goto(cleanUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    await clearOverlays(page);

    // Spausti "Rašyti žinutę" (__callNewMessage)
    // Jei yra thread → navigatuoja į thread?write=true
    // Jei naujas kontaktas → lieka profilyje (parodo formą vietoje)
    await page.evaluate(() => {
        const btn = document.querySelector('.__callNewMessage, .button-new-message, .button-write-message');
        if (btn) btn.click();
    });
    await page.waitForTimeout(3000);
    await clearOverlays(page);

    let currentUrl = page.url();
    const navigatedToThread = currentUrl.includes('message/list') && (currentUrl.includes('threadid') || currentUrl.includes('threadId'));
    console.log(`URL po click: ${currentUrl}`);
    console.log(`Naviguota į thread: ${navigatedToThread}`);

    // Jei nukrypome į netinkamą puslapį (ne thread, ne profilis) — grįžtame
    if (!navigatedToThread && !currentUrl.includes(cleanUrl.split('?')[0].split('/').pop())) {
        console.log('Netinkamas URL po click — grįžtame į profilį');
        await page.goto(cleanUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000);
        await clearOverlays(page);
        currentUrl = page.url();
    }

    // ── 2. Perskaityti paskutines 3 žinutes (tik jei thread) ─────────────────
    const lastMessages = [];
    if (navigatedToThread) {
        const msgs = await page.evaluate(() => {
            const groups = Array.from(document.querySelectorAll('.message-group'));
            return groups.slice(-3).map(g => {
                const isMine = g.classList.contains('message-group-right');
                const content = g.querySelector('.message-content')?.innerText?.trim() || '';
                return { who: isMine ? 'Artūras' : 'Ji', text: content.substring(0, 150) };
            }).filter(m => m.text);
        });
        lastMessages.push(...msgs);
        if (lastMessages.length > 0) console.log('Paskutinės žinutės:', lastMessages);
    }

    // ── 3. Telegram patvirtinimas (su pokalbio kontekstu) ─────────────────────
    let approvalMsg = `🔔 NAUJA ŽINUTĖ\n\n👤 ${next.name}\n`;
    if (next.bio) approvalMsg += `📝 ${next.bio.substring(0, 200)}\n`;

    if (lastMessages.length > 0) {
        approvalMsg += `\n💬 Pokalbio istorija:\n`;
        for (const m of lastMessages) {
            approvalMsg += `  ${m.who === 'Artūras' ? '👤' : '👩'} ${m.who}: ${m.text}\n`;
        }
    }

    approvalMsg += `\n🤖 SIŪLOMA ŽINUTĖ:\n"${text}"\n\n`;
    approvalMsg += `🔗 ${next.profileUrl}\n`;
    approvalMsg += `👉 Rašykite "OK" siuntimui arba "NO" atšaukimui.`;

    const approved = await waitForApproval(approvalMsg);
    if (!approved) {
        console.log('Žinutė nepatvirtinta, išeinama.');
        await browser.close();
        return;
    }

    // ── 4. Siųsti ─────────────────────────────────────────────────────────────
    let sent = false;

    if (navigatedToThread) {
        // Thread puslapis — textarea matoma
        const ta = page.locator('textarea[placeholder="Parašyk žinutę..."], textarea').first();
        await ta.fill(text);
        console.log('✅ Žinutė įvesta (thread textarea)');
        await page.waitForTimeout(500);

        try { await page.screenshot({ path: 'send_next_filled.png', timeout: 5000 }); } catch (e) { }

        await page.click('button.send-message, button.button.send-message');
        console.log('✅ Siųsti mygtukas paspaustas (button.send-message)');
        sent = true;

    } else {
        // Profilio puslapis — naujas kontaktas, textarea hidden, JS inject
        try { await page.screenshot({ path: 'send_next_before.png', timeout: 5000 }); } catch (e) { }

        const ok = await page.evaluate((msg) => {
            const ta = document.querySelector('#ui_text, textarea.ui-text.__smileTarget, textarea.__smileTarget, textarea');
            if (!ta) return false;
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
        }, text);

        if (!ok) {
            console.error('[KLAIDA] Textarea nerasta!');
            await notifyTelegram('❌ Textarea nerasta!');
            await browser.close();
            return;
        }
        console.log('✅ Žinutė įvesta (profilio textarea JS inject)');
        await page.waitForTimeout(800);

        try { await page.screenshot({ path: 'send_next_filled.png', timeout: 5000 }); } catch (e) { }

        const clicked = await page.evaluate(() => {
            const btn = document.querySelector('button.create-comment');
            if (!btn) return false;
            btn.style.display = 'block';
            btn.style.visibility = 'visible';
            btn.click();
            return true;
        });
        if (!clicked) {
            console.error('[KLAIDA] button.create-comment nerasta!');
            await notifyTelegram('❌ Send mygtukas nerastas!');
            await browser.close();
            return;
        }
        console.log('✅ Siųsti mygtukas paspaustas (button.create-comment JS click)');
        sent = true;
    }

    // ── 5. Patikrinti ar žinutė atsirado pokalbio lange ──────────────────────
    await page.waitForTimeout(3000);
    try { await page.screenshot({ path: 'send_next_after.png', timeout: 5000 }); } catch (e) { }

    // Ieškoti žinutės teksto puslapyje (pirmi 40 simbolių)
    const textSnippet = text.substring(0, 40);
    const confirmed = await page.evaluate((snippet) => {
        return document.body.innerText.includes(snippet);
    }, textSnippet);

    if (sent && confirmed) {
        DB.saveMessage(next.id, 'sent', text);
        DB.updateStatus(next.id, 'messaged');
        console.log(`\n✅ Žinutė patvirtinta pokalbio lange!`);
        console.log(`✅ ${next.name} pažymėtas kaip 'messaged' DB`);
        await notifyTelegram(`✅ Žinutė išsiųsta ir patvirtinta: ${next.name}`);
        console.log('\n🎉 Sėkmingai išsiųsta!');
    } else if (sent && !confirmed) {
        console.error(`\n❌ Žinutė NERASTA pokalbio lange! DB nepažymėta.`);
        await notifyTelegram(`❌ ${next.name}: žinutė nepasirodė pokalbio lange. Patikrinkite rankiniu būdu.`);
    }

    await page.waitForTimeout(2000);
    await browser.close();
}

run().catch(e => { console.error('Klaida:', e.message); process.exit(1); });
