/**
 * search-contacts.js
 * Ieško naujų kontaktų pagal kriterijus ir išsaugo juos duomenų bazėje.
 * Kriterijai: moteris, amžius 39-49, Kaunas.
 * Paleidimas: node search-contacts.js
 */

require('dotenv').config();
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const DB = require('./db');

// --- PAIEŠKOS URL'AI ---
const SEARCH_URLS = [
    'https://pazintys.draugas.lt/ngrupe.cfm?&lytis=1&amzius=39&amzius2=49&vietove=&vietovep=&miestas=13&ads_id=529',
    'https://pazintys.draugas.lt/pngrupe.cfm?lytis=1&amzius=39&amzius2=49&vietove=&vietovep=&ads_id=1352',
    'https://pazintys.draugas.lt/nagrupe.cfm?lytis=1&amzius=39&amzius2=49&vietove=&vietovep=&ads_id=523',
    'https://pazintys.draugas.lt/tgrupe.cfm?lytis=1&amzius=39&amzius2=49&vietove=&vietovep=&ads_id=527',
    'https://pazintys.draugas.lt/ggrupe.cfm?laikas=1&lytis=1&amzius=39&amzius2=49&ads_id=525',
    'https://pazintys.draugas.lt/foto/paieska/nuotraukos.cfm?megstamiausios=1&ads_id=531',
    // Papildomos Kaunas paieškos
    'https://pazintys.draugas.lt/pazintys/ieskoti/?sex=2&age_from=39&age_to=49&city=13',
    'https://pazintys.draugas.lt/pazintys/ieskoti/?sex=2&age_from=39&age_to=49&city=13&page=2',
    'https://pazintys.draugas.lt/pazintys/ieskoti/?sex=2&age_from=39&age_to=49&city=13&page=3',
];

const USER_EMAIL = process.env.DRAUGAS_EMAIL;
const USER_PASS = process.env.DRAUGAS_PASS;
const COOKIES_PATH = path.join(__dirname, 'cookies.json');

let found = 0;
let saved = 0;
let skipped = 0;

// --- HELPERS ---

async function gotoWithRetry(page, url, retries = 3) {
    for (let i = 1; i <= retries; i++) {
        try {
            console.log(`  → Navigacija (${i}/${retries}): ${url.substring(0, 80)}...`);
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            return;
        } catch (e) {
            if (i === retries) throw e;
            await page.waitForTimeout(2000);
        }
    }
}

async function clearOverlays(page) {
    await page.evaluate(() => {
        ['.didomi-popup-container', '#didomi-host', '#didomi-notice',
            '.didomi-popup-backdrop', '.helpbox', '[id*="didomi"]'
        ].forEach(sel => document.querySelectorAll(sel).forEach(el => el.remove()));
        document.body.style.overflow = 'auto';
        document.body.style.pointerEvents = 'auto';
    }).catch(() => { });
}

async function login(page) {
    console.log('\n[LOGIN] Jungiamasi...');
    await gotoWithRetry(page, 'https://www.draugas.lt/');
    await page.waitForTimeout(2000);

    const isLoggedIn = await page.evaluate(() => {
        const t = document.body.innerText;
        return t.includes('Arturas') || t.includes('Artūras') || t.includes('Koreguoti profilį');
    });

    if (isLoggedIn) {
        console.log('[LOGIN] ✅ Jau prisijungta (cookies).');
        return true;
    }

    // 1. Pirma sutikti su cookie consent mygtuku (jei matomas)
    try {
        const consentBtn = page.locator('button:has-text("SUTINKU"), button:has-text("Sutinku"), #didomi-notice-agree-button').first();
        if (await consentBtn.count() > 0 && await consentBtn.isVisible({ timeout: 3000 })) {
            await consentBtn.click({ force: true });
            console.log('[LOGIN] Cookie sutikimas paspaustas.');
            await page.waitForTimeout(1000);
        }
    } catch (e) { /* nėra consent */ }

    // 2. Pašalinti likusius overlayus per JS
    await page.evaluate(() => {
        document.querySelectorAll('[id*="didomi"], [class*="consent"], [class*="cookie"]')
            .forEach(el => el.remove());
        document.body.style.overflow = 'auto';
        document.body.style.pointerEvents = 'auto';
    });
    await page.waitForTimeout(500);

    try {
        // 3. Užpildyti loginimo formą
        await page.fill('.email.__loginEmail', USER_EMAIL, { force: true });
        await page.fill('.pass.__loginPassword', USER_PASS, { force: true });
        console.log('[LOGIN] Forma užpildyta.');

        // 4. Pažymėti "Įsiminti" checkbox
        try {
            const rememberMe = page.locator('#isiminti, input[name="RememberMe"]').first();
            if (await rememberMe.count() > 0 && !(await rememberMe.isChecked())) {
                await rememberMe.check({ force: true });
                console.log('[LOGIN] "Įsiminti" pažymėta.');
            }
        } catch (e) { /* ignore */ }

        // 5. Playwright click ant rodyklės / submit mygtuko šalia slaptažodžio
        const loginSubmit = page.locator('form:has(.pass.__loginPassword) button[type="submit"], form:has(.pass.__loginPassword) .submit, form:has(.pass.__loginPassword) input[type="submit"], form:has(.pass.__loginPassword) button').first();
        if (await loginSubmit.count() > 0) {
            await loginSubmit.click({ force: true });
            console.log('[LOGIN] Submit mygtukas paspaustas.');
        } else {
            await page.locator('.pass.__loginPassword').press('Enter');
            console.log('[LOGIN] Enter paspaustas (fallback).');
        }

        await page.waitForTimeout(4000);

        const ok = await page.evaluate(() => {
            const t = document.body.innerText;
            return t.includes('Arturas') || t.includes('Artūras') || t.includes('Koreguoti profilį');
        });

        if (ok) {
            console.log('[LOGIN] ✅ Prisijungta sėkmingai!');
            const cookies = await page.context().cookies();
            fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
            console.log(`[LOGIN] Cookies išsaugotos (${cookies.length} vnt.)`);
            return true;
        }
    } catch (e) {
        console.error('[LOGIN] Klaida:', e.message);
    }

    console.error('[LOGIN] ❌ Nepavyko prisijungti!');
    return false;
}

// --- PROFILIO ANALIZĖ ---

async function visitProfile(page, profileUrl, sourceUrl) {
    found++;
    try {
        await gotoWithRetry(page, profileUrl);
        await page.waitForTimeout(1500);
        await clearOverlays(page);

        const profile = await page.evaluate(() => {
            const name = document.querySelector('h1')?.innerText.trim() || '';
            const allText = document.body.innerText;

            // Miestas
            let city = '';
            const cityMatch = allText.match(/Miestas:\s*([^\n]+)/i) ||
                allText.match(/Vietovė:\s*([^\n]+)/i) ||
                allText.match(/Miestas\s+([^\n]+)/i);
            if (cityMatch) city = cityMatch[1].trim().split('\n')[0].trim();

            // Fallback iš vardo pvz "Giedrė (45 m., Kaunas)"
            if (!city) {
                const nm = name.match(/\(.*?,\s*(\w+)\)/);
                if (nm) city = nm[1];
            }

            // Amžius
            let age = '';
            const ageMatch = name.match(/(\d+)\s*m\./) || allText.match(/Amžius:\s*(\d+)/i);
            if (ageMatch) age = ageMatch[1];

            // Bio ir pomėgiai
            const bioEl = document.querySelector('.nario-informacija, .profile-info, .about-me, .apie-save');
            const bio = bioEl ? bioEl.innerText.trim() : allText.substring(0, 500);

            const interests = Array.from(document.querySelectorAll('.pomegis, .hobby, .interest, .pomegiai'))
                .map(el => el.innerText.trim()).filter(Boolean).join(', ');

            // Nuotrauka
            const photoImg = document.querySelector('.nario-foto img, .profile-photo img, img.user-photo, .main-photo img');
            const photoUrl = photoImg ? photoImg.src : '';

            // Narys ID
            const narysMatch = window.location.href.match(/narys=(\d+)/);
            const narysId = narysMatch ? narysMatch[1] : null;
            const cleanProfileUrl = narysId
                ? `https://pazintys.draugas.lt/narys.cfm?narys=${narysId}`
                : window.location.href;

            return { name, city, age, bio, interests, photoUrl, cleanProfileUrl, narysId };
        });

        if (!profile.name) {
            console.log(`  ⚠️  Vardas nerastas: ${profileUrl}`);
            return null;
        }

        // Kaunas filtras
        const isKaunas = profile.city.toLowerCase().includes('kaunas') ||
            profile.name.toLowerCase().includes('kaunas') ||
            profileUrl.toLowerCase().includes('miestas=13');

        if (!isKaunas) {
            console.log(`  ⏭️  Ne Kaunas (${profile.city || '?'}): ${profile.name}`);
            skipped++;
            return null;
        }

        // Amžiaus filtras (39-49)
        const ageNum = parseInt(profile.age);
        if (profile.age && (ageNum < 39 || ageNum > 49)) {
            console.log(`  ⏭️  Netinkamas amžius (${profile.age}): ${profile.name}`);
            skipped++;
            return null;
        }

        // Patikrinti ar jau yra DB
        const existing = DB.findContactByUrl(profile.cleanProfileUrl);
        if (existing) {
            console.log(`  ♻️  Jau DB: ${profile.name} (${profile.city})`);
            skipped++;
            return null;
        }

        // Išsaugoti į DB
        const contactId = DB.upsertContact({
            name: profile.name,
            fullText: profile.name,
            city: profile.city || 'Kaunas',
            bio: profile.bio,
            interests: profile.interests,
            photoUrl: profile.photoUrl,
            profileUrl: profile.cleanProfileUrl,
            source: sourceUrl,
            status: 'new'
        });

        saved++;
        console.log(`  ✅ Išsaugotas: ${profile.name} (${profile.city}, ${profile.age} m.) — ID: ${contactId}`);
        return { ...profile, id: contactId };

    } catch (e) {
        console.error(`  ❌ Klaida: ${profileUrl} — ${e.message}`);
        return null;
    }
}

// --- PAGRINDINIS ---

async function run() {
    console.log('╔═══════════════════════════════════════╗');
    console.log('║   DRAUGAS.LT — KONTAKTŲ PAIEŠKA      ║');
    console.log('║   Kriterijai: moteris, 39-49m, Kaunas ║');
    console.log('╚═══════════════════════════════════════╝\n');

    const browser = await chromium.launch({
        headless: false,
        args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
    });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 }
    });

    // Įkelti cookies
    if (fs.existsSync(COOKIES_PATH)) {
        try {
            const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf-8'));
            if (Array.isArray(cookies) && cookies.length > 0) {
                await context.addCookies(cookies);
                console.log(`[COOKIES] Įkelti ${cookies.length} slapukai.\n`);
            }
        } catch (e) { }
    }

    const page = await context.newPage();

    // Prisijungti
    const loggedIn = await login(page);
    if (!loggedIn) {
        await browser.close();
        process.exit(1);
    }

    const allNewProfiles = [];

    // Eiti per kiekvieną paieškos URL
    for (const searchUrl of SEARCH_URLS) {
        console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`[PAIEŠKA] ${searchUrl}`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

        try {
            await gotoWithRetry(page, searchUrl);
            await page.waitForTimeout(3000);
            await clearOverlays(page);

            // Surinkti profilio nuorodas
            const profileLinks = await page.evaluate(() => {
                const seen = new Set();
                const items = Array.from(document.querySelectorAll(
                    '.nario-foto, a[href*="narys.cfm"], .member-item, .user-item, ' +
                    '.fotoprofilis, .profile-card, [class*="member"], [class*="profile"]'
                ));
                return items.map(item => {
                    const anchor = (item instanceof HTMLAnchorElement) ? item :
                        item.querySelector('a[href*="narys.cfm"]');
                    if (!anchor || !anchor.href || !anchor.href.includes('narys.cfm')) return null;
                    if (seen.has(anchor.href)) return null;
                    seen.add(anchor.href);
                    const img = item.querySelector('img');
                    return {
                        link: anchor.href,
                        nameText: item.innerText.trim().split('\n')[0],
                        photoUrl: img ? img.src : ''
                    };
                }).filter(Boolean).slice(0, 20);
            });

            console.log(`[PAIEŠKA] Rasta ${profileLinks.length} profilių.\n`);

            for (const p of profileLinks) {
                // Greitas Kaunas filtras iš URL (miestas=13)
                const isKaunasUrl = searchUrl.includes('miestas=13') || searchUrl.includes('city=13');

                const result = await visitProfile(page, p.link, searchUrl);
                if (result) allNewProfiles.push(result);

                // Trumpa pauzė tarp profilių
                await page.waitForTimeout(500);
            }

        } catch (e) {
            console.error(`[PAIEŠKA] Klaida su URL ${searchUrl}: ${e.message}`);
        }

        // Pauzė tarp paieškų
        await page.waitForTimeout(2000);
    }

    await browser.close();

    // Galutinė statistika
    console.log('\n╔═══════════════════════════════════════╗');
    console.log('║         PAIEŠKOS REZULTATAI           ║');
    console.log('╠═══════════════════════════════════════╣');
    console.log(`║  Aptikta profilių:   ${String(found).padStart(5)}             ║`);
    console.log(`║  Išsaugota naujų:    ${String(saved).padStart(5)}             ║`);
    console.log(`║  Praleista:          ${String(skipped).padStart(5)}             ║`);
    console.log('╚═══════════════════════════════════════╝\n');

    if (allNewProfiles.length > 0) {
        console.log('=== NAUJI KONTAKTAI ===');
        for (const p of allNewProfiles) {
            console.log(`  • ${p.name} (${p.city}) — ${p.cleanProfileUrl}`);
        }
    }

    const dbStats = DB.getStats();
    console.log(`\n[DB] Iš viso kontaktų: ${dbStats.totalContacts}`);
    console.log(`[DB] Jau kontaktuota:  ${dbStats.messaged}`);
}

run().catch(err => {
    console.error('Kritinė klaida:', err.message);
    process.exit(1);
});
