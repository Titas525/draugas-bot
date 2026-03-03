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
STILIUS: Rašyk GLAUSTAI (~30% trumpiau nei įprastai). Naudok vieną emoji. Be kabučių.`;

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
    await notifyTelegram(msg);
    console.log('\n⏳ Laukiama patvirtinimo Telegram (OK/NO)...');
    const start = Date.now();
    const limit = 5 * 60 * 1000; // 5 min
    while (Date.now() - start < limit) {
        await new Promise(r => setTimeout(r, 5000));
        try {
            const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?offset=-1`);
            const data = await r.json();
            const updates = data.result || [];
            if (updates.length > 0) {
                const last = updates[updates.length - 1];
                const txt = last.message?.text?.trim().toUpperCase();
                if (txt === 'OK') { console.log('✅ Patvirtinta!'); return true; }
                if (txt === 'NO') { console.log('❌ Atmesta.'); return false; }
            }
        } catch (e) { /* ignore */ }
    }
    console.log('⏰ Timeout — laikoma kaip atmesta.');
    return false;
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

    // Telegram patvirtinimas
    let approvalMsg = `🔔 NAUJA ŽINUTĖ\n\n👤 ${next.name}\n`;
    if (next.bio) approvalMsg += `📝 ${next.bio.substring(0, 300)}\n`;
    approvalMsg += `\n🤖 ŽINUTĖ:\n"${text}"\n\n`;
    approvalMsg += `🔗 ${next.profileUrl}\n`;
    approvalMsg += `👉 Rašykite "OK" siuntimui arba "NO" atšaukimui.`;

    const approved = await waitForApproval(approvalMsg);
    if (!approved) {
        console.log('Žinutė nepatvirtinta, išeinama.');
        return;
    }

    // Siųsti per Playwright
    console.log('\nPaleidžiama naršyklė...');
    const browser = await chromium.launch({ headless: false });
    const ctx = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 }
    });

    const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf-8'));
    await ctx.addCookies(cookies);
    const page = await ctx.newPage();

    // Navigacija į profilį
    const narysMatch = next.profileUrl.match(/narys=(\d+)/);
    const cleanUrl = narysMatch
        ? `https://pazintys.draugas.lt/narys.cfm?narys=${narysMatch[1]}`
        : next.profileUrl;

    console.log(`Navigacija: ${cleanUrl}`);
    await page.goto(cleanUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    await page.evaluate(() => {
        ['[id*="didomi"]', '.didomi-popup-container', '.helpbox'].forEach(sel =>
            document.querySelectorAll(sel).forEach(el => el.remove())
        );
        document.body.style.overflow = 'auto';
        document.body.style.pointerEvents = 'auto';
    });

    await page.screenshot({ path: 'send_next_before.png' });

    // Įvesti žinutę (JS inject — veikia net jei textarea hidden)
    const ok = await page.evaluate((msg) => {
        const ta = document.querySelector('textarea');
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
    console.log('✅ Žinutė įvesta');
    await page.waitForTimeout(800);

    await page.screenshot({ path: 'send_next_filled.png' });

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
        console.log('Fallback: Enter');
    } else {
        console.log(`✅ Siųsti: ${sendResult}`);
    }

    // Išsaugoti DB IŠKARTO po siuntimo
    DB.saveMessage(next.id, 'sent', text);
    DB.updateStatus(next.id, 'messaged');
    console.log(`\n✅ ${next.name} pažymėtas kaip 'messaged' DB`);
    await notifyTelegram(`✅ Žinutė išsiųsta: ${next.name}`);

    await page.waitForTimeout(3000);
    try { await page.screenshot({ path: 'send_next_after.png', timeout: 3000 }); } catch (e) { console.log('Screenshot timeout (nekritinė)'); }

    console.log('\n🎉 Sėkmingai išsiųsta!');

    await page.waitForTimeout(2000);
    await browser.close();
}

run().catch(e => { console.error('Klaida:', e.message); process.exit(1); });
