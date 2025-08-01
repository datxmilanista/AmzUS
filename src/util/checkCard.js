const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const axios = require('axios');
const { inflateRaw } = require('zlib');
const https = require('https');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", 'data.json'), 'utf8'));

let listCards = fs.readFileSync(path.join(__dirname, "..", "data", 'card.txt'), 'utf8').replaceAll("\r", '').split("\n").map(line => line.trim()).filter(line => line.length > 0);
let indexCard = -1;

// Load all accounts and filter only business accounts
const allAccounts = fs.readFileSync(path.join(__dirname, "..", "data", 'acc.txt'), 'utf8').replaceAll("\r", '').split("\n").map(line => line.trim()).filter(line => line.length > 0);
const dataConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", 'data.json'), 'utf8'));
const businessEmails = dataConfig.businessAccounts || [];

// Filter accounts to only include business accounts
let listChild = allAccounts.filter(accountLine => {
    const email = accountLine.split('|')[0];
    return businessEmails.includes(email);
});

console.log(`Loaded ${allAccounts.length} total accounts, ${listChild.length} business accounts available for card checking`);

let indexChild = -1;
let listProxy = fs.readFileSync(path.join(__dirname, "..", "data", 'proxies.txt'), 'utf8').replaceAll("\r", '').split("\n").map(line => line.trim()).filter(line => line.length > 0);

// Set total card count at startup
const totalCards = listCards.length;
global.data.cardTotal = totalCards;

// Update UI counters if console.card is available
if (console.card && typeof console.card.setTotal === 'function') {
    console.card.setTotal(totalCards);
}

// Add a BIN cache to reduce API calls
const binCache = {};
const binCacheFile = path.join(__dirname, "..", "data", 'bin_cache.json');

// Load bin cache if it exists
try {
    if (fs.existsSync(binCacheFile)) {
        const cacheData = fs.readFileSync(binCacheFile, 'utf8');
        Object.assign(binCache, JSON.parse(cacheData));
        console.log(`Loaded ${Object.keys(binCache).length} BIN entries from cache`);
    }
} catch (error) {
    console.log(`Error loading BIN cache: ${error.message}`);
}

// Save cache periodically
setInterval(() => {
    try {
        fs.writeFileSync(binCacheFile, JSON.stringify(binCache), 'utf8');
    } catch (error) {
        console.log(`Error saving BIN cache: ${error.message}`);
    }
}, 30000); // Save every 30 seconds

// Enhanced logging function
function logMessage(message, type = 'info') {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    const formattedMessage = `[${timestamp}] ${message}`;
    
    console.log(formattedMessage);
    
    if (console.app && typeof console.app === 'function') {
        console.app(formattedMessage);
    }
}

// Function to remove locked accounts
function removeLockedAccount(email, reason) {
    try {
        const dataPath = path.join(__dirname, '..', 'data', 'data.json');
        let dataConfig = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
        
        // Remove from businessAccounts
        if (dataConfig.businessAccounts && dataConfig.businessAccounts.includes(email)) {
            dataConfig.businessAccounts = dataConfig.businessAccounts.filter(acc => acc !== email);
            logMessage(`🗑️ Removed ${email} from businessAccounts (${reason})`, 'warning');
        }
        
        // Remove from childCount
        if (dataConfig.childCount && dataConfig.childCount[email]) {
            delete dataConfig.childCount[email];
            logMessage(`🗑️ Removed ${email} from childCount (${reason})`, 'warning');
        }
        
        // Save file
        fs.writeFileSync(dataPath, JSON.stringify(dataConfig, null, 2));
        logMessage(`✅ Account ${email} permanently removed from data.json`, 'success');
        
        // Remove from acc.txt
        const accPath = path.join(__dirname, '..', 'data', 'acc.txt');
        if (fs.existsSync(accPath)) {
            const accounts = fs.readFileSync(accPath, 'utf8')
                .split('\n')
                .filter(line => line.trim() && !line.startsWith(email));
            fs.writeFileSync(accPath, accounts.join('\n'));
        }
        
        // Update global listChild
        listChild = listChild.filter(accountLine => !accountLine.startsWith(email));
        
    } catch (error) {
        console.error(`❌ Error removing account ${email}:`, error.message);
        logMessage(`❌ Error removing account ${email}: ${error.message}`, 'error');
    }
}

// Safe navigation function
async function safeNavigateWithRetry(page, url, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            logMessage(`🌐 Navigation attempt ${attempt}/${maxRetries} to: ${url}`, 'info');
            
            await page.goto(url, { 
                waitUntil: 'domcontentloaded',
                timeout: 30000 
            });
            
            // Wait for page to be ready
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Check if page is valid
            const isValid = await page.evaluate(() => {
                return document.body && document.body.innerText.length > 0;
            });
            
            if (isValid) {
                logMessage(`✅ Navigation successful on attempt ${attempt}`, 'success');
                return { success: true };
            } else {
                throw new Error('Page appears to be empty or invalid');
            }
            
        } catch (error) {
            logMessage(`❌ Navigation attempt ${attempt} failed: ${error.message}`, 'error');
            
            if (attempt < maxRetries) {
                // Wait before retry
                await new Promise(resolve => setTimeout(resolve, 3000));
                
                // Try to refresh page
                try {
                    await page.reload({ timeout: 15000 });
                } catch (reloadError) {
                    logMessage(`⚠️ Page reload failed: ${reloadError.message}`, 'warning');
                }
            } else {
                return { success: false, error: error.message };
            }
        }
    }
}

async function checkCard() {
    try {
        !data.childCount ? data.childCount = {} : "";
        !global.temp ? global.temp = {} : "";
        !global.temp.checkCard ? global.temp.checkCard = {} : "";
        
        // Validation
        if (listCards.length === 0) {
            logMessage("❌ No cards found in card.txt", 'error');
            return;
        }
        
        if (listChild.length === 0) {
            logMessage("❌ No business accounts available", 'error');
            return;
        }
        
        if (listProxy.length === 0) {
            logMessage("❌ No proxies found in proxies.txt", 'error');
            return;
        }
        
        logMessage(`Starting card check with ${totalCards} cards`, 'info');
        
        for (let i in listProxy) {
            let [host, port, user, pass] = listProxy[i].split(':');
            let proxy = {
                host: host,
                port: port,
                user: user,
                pass: pass
            };
            initThread(proxy, i);
        }
        
    } catch (error) {
        console.error("Error in checkCard:", error);
        logMessage(`❌ Error in checkCard: ${error.message}`, 'error');
    }
}

async function initThread(proxy, index) {
    indexChild++;
    if (indexChild >= listChild.length) {
        logMessage("All children checked, exiting...", 'info');
        return;
    }
    
    let [email, pass, secret] = listChild[indexChild].split("|");
    const maxCardsLimit = global.data.settings.maxCards || 80;
    const currentCardCount = data.childCount[email] || 0;
    
    if (currentCardCount >= maxCardsLimit) {
        logMessage(`Max cards reached for ${email} (${currentCardCount}/${maxCardsLimit}), skipping...`, 'warning');
        initThread(proxy, index); // Try next account
        return;
    }
    
    logMessage(`Using account ${email} with ${currentCardCount}/${maxCardsLimit} cards`, 'info');
    
    let browser = null;
    try {
        browser = await puppeteer.launch({
            headless: !global.data.settings.showBrowser,
            protocolTimeout: 120000,
            args: [
                `--proxy-server=http://${proxy.host}:${proxy.port}`,
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-web-security',
                '--ignore-certificate-errors',
                '--disable-infobars',
                '--window-size=700,700',
                '--disable-dev-shm-usage',
                '--disable-extensions',
                '--disable-gpu',
                '--disable-save-password-bubble',
                '--disable-autofill-keyboard-accessory-view',
                '--disable-autofill-keyboard-accessory',
                '--disable-translate',
                '--disable-blink-features=AutomationControlled',
                '--disable-features=VizDisplayCompositor',
                '--no-first-run'
            ],
            ignoreDefaultArgs: ['--enable-automation'],
            defaultViewport: { width: 700, height: 700 }
        });

        const page = await browser.newPage();
        await page.authenticate({ username: proxy.user, password: proxy.pass });
        
        let form = {
            email,
            pass,
            code: secret,
            proxy: {
                host: proxy.host,
                port: proxy.port,
                username: proxy.user,
                password: proxy.pass
            }
        };

        try {
            await require(path.join(__dirname, "..", "api", "login.js"))(page, form);
            logMessage(`✅ Login successful for ${email}`, 'success');
        } catch (loginError) {
            logMessage(`Login failed for ${email}: ${loginError.message}`, 'error');
            
            // Handle specific login errors
            if (loginError.message.includes('ACCOUNT_LOCKED')) {
                removeLockedAccount(email, 'ACCOUNT_LOCKED');
                await browser.close();
                return initThread(proxy, index);
            }
            
            if (loginError.message.includes('detached Frame')) {
                logMessage(`Detached frame error for ${email}, retrying...`, 'warning');
                await browser.close();
                return initThread(proxy, index);
            }
            
            await browser.close();
            initThread(proxy, index);
            return;
        }

        await new Promise(resolve => setTimeout(resolve, 1500));
        
        // Check for account status issues
        if (page.url().includes('account-status.amazon.com')) {
            logMessage("Login failed, account status issue!", 'error');
            console.log("Login failed, account status issue!");
            await browser.close();
            initThread(proxy, index);
            return;
        }
        
        let linkNow = page.url();

        // Ensure we're on the main Amazon page after login
        if (!linkNow.includes('amazon.com') || linkNow.includes('/ap/') || linkNow.includes('/gp/')) {
            logMessage(`Redirecting to Amazon homepage from: ${linkNow}`, 'info');
            const navResult = await safeNavigateWithRetry(page, 'https://www.amazon.com');
            if (!navResult.success) {
                logMessage(`Failed to navigate to homepage: ${navResult.error}`, 'error');
                await browser.close();
                return initThread(proxy, index);
            }
            linkNow = page.url();
        }

        // Check the address book
        try {
            await require(path.join(__dirname, "..", "api", "addAddress.js")).gotoBook(page);
            if (!(await require(path.join(__dirname, "..", "api", "addAddress.js")).checkBook(page))) {
                await require(path.join(__dirname, "..", "api", "addAddress.js")).addAddress(page);
            }
            
            const homeNavResult = await safeNavigateWithRetry(page, linkNow);
            if (!homeNavResult.success) {
                logMessage(`Failed to return to homepage: ${homeNavResult.error}`, 'warning');
            }
        } catch (addressError) {
            logMessage(`Address book error: ${addressError.message}`, 'warning');
        }

        let res = await require(path.join(__dirname, "..", "api", "goPayment.js"))(page);

        if (res.error) {
            logMessage(res.error, 'error');
            console.log(res.error);
            await browser.close();
            initThread(proxy, index);
            return;
        }
        
        thread(page, browser, email, index, proxy);
        
    } catch (error) {
        logMessage(`Error in initThread: ${error.message}`, 'error');
        if (browser) {
            try {
                await browser.close();
            } catch (closeError) {
                logMessage(`Error closing browser: ${closeError.message}`, 'warning');
            }
        }
        return initThread(proxy, index);
    }
}

async function thread(page, browser, email, index, proxy) {
    global.temp.checkCard[index] = {};
    
    if (indexCard >= listCards.length) {
        // Check if we have cards to verify
        const hasCardsToVerify = Object.keys(global.temp.checkCard[index]).length > 0;
        
        if (!hasCardsToVerify) {
            logMessage("Closing browser...", 'info');
            console.log("Closing browser...");
            await browser.close();
            clearInterval(saveData);
            logMessage("All cards checked, exiting...", 'info');
            return;
        }
        
        logMessage(`All cards added, proceeding to check wallet for ${email}`, 'info');
        console.log(`All cards added, proceeding to check wallet for ${email}`);
        
        // Update remaining cards count
        updateRemainingCardCount();
        
        // Wait for specified delay before checking wallet
        await new Promise(resolve => setTimeout(resolve, global.data.settings.checkAfter || 30000));
        
        logMessage(`Checking wallets for ${email} at thread ${index}`, 'info');
        console.log(`Checking wallets for ${email} at thread ${index}`);
        
        // Check wallet and then exit properly
        await checkWallet(page, browser, email, index, proxy);
        
        // Close browser after wallet check
        logMessage("Closing browser...", 'info');
        console.log("Closing browser...");
        await browser.close();
        logMessage("All cards checked, exiting...", 'info');
        return;
    }

    logMessage(`Checking cards for ${email} at thread ${index}`, 'info');
    console.log(`Checking cards for ${email} at thread ${index}`);
    
    const maxCardsPerAccount = global.data.settings.maxCards || 80;
    if (data.childCount[email] >= maxCardsPerAccount - 5) {
        logMessage(`Max cards reached for ${email}, skipping...`, 'warning');
        console.log(`Max cards reached for ${email}, skipping...`);
        initThread(proxy, index);
        return;
    }
    
    for (let i = 0; i < 5; i++) {
        indexCard++;
        let card = listCards[indexCard];
        if (indexCard >= listCards.length) {
            logMessage("All cards added !", 'info');
            break;
        }
        
        let [number, month, year, cvc] = card.split('|');
        year = year.length == 2 ? '20' + year : year;
        month = month.length == 1 ? '0' + month : month;
        let form = {
            number,
            month,
            year,
            name: 'Saint David',
            cvc
        };
        
        console.log(`Card: ${card}`);
        let res = await require(path.join(__dirname, "..", "api", "addCard.js"))(page, form);
        let attempts = 1;
        const maxAttempts = 3;
        
        while (!res.success && attempts < maxAttempts) {
            logMessage(`Retry attempt ${attempts}/${maxAttempts} for card: ${card}. Error: ${res.error || 'Unknown'}`, 'warning');
            console.log(`Retry attempt ${attempts}/${maxAttempts} for card: ${card}. Error: ${res.error || 'Unknown'}`);
            attempts++;
            
            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Try to navigate back to payment page
            try {
                let refreshRes = await require(path.join(__dirname, "..", "api", "goPayment.js"))(page);
                if (refreshRes.error) {
                    console.log("Failed to navigate to payment page, doing page reload instead");
                    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
                }
            } catch (navError) {
                console.log("Navigation error, doing page reload:", navError.message);
                await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
            }
            
            // Wait for page to stabilize
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Retry adding card
            res = await require(path.join(__dirname, "..", "api", "addCard.js"))(page, form);
        }
        
        if (!res.success) {
            logMessage(`Failed to add card ${card} after ${maxAttempts} attempts. Error: ${res.error || 'Unknown error'}`, 'error');
            console.log(`Failed to add card ${card} after ${maxAttempts} attempts. Error: ${res.error || 'Unknown error'}`);
            continue; // Skip to the next card in the loop
        }

        // Wait for card info with multiple fallback selectors
        let cardInfoSelector = null;
        try {
            console.log('Trying primary card selector...');
            await page.waitForSelector('.a-size-base-plus.pmts-instrument-number-tail span', { timeout: 10000 });
            cardInfoSelector = '.a-size-base-plus.pmts-instrument-number-tail span';
            console.log('✅ Primary selector found');
        } catch (error) {
            console.log('❌ Primary card selector failed, trying fallbacks...');
            try {
                console.log('Trying fallback 1: .pmts-instrument-number span');
                await page.waitForSelector('.pmts-instrument-number span', { timeout: 10000 });
                cardInfoSelector = '.pmts-instrument-number span';
                console.log('✅ Fallback 1 found');
            } catch (error2) {
                try {
                    console.log('Trying fallback 2: [class*="instrument-number"]');
                    await page.waitForSelector('[class*="instrument-number"]', { timeout: 10000 });
                    cardInfoSelector = '[class*="instrument-number"]';
                    console.log('✅ Fallback 2 found');
                } catch (error3) {
                    console.log('❌ All card selectors failed, trying page navigation...');
                    const walletNavResult = await safeNavigateWithRetry(page, 'https://www.amazon.com/cpe/yourpayments/wallet');
                    if (walletNavResult.success) {
                        await page.waitForSelector('[data-testid="pmts-credit-card-instrument"]', { timeout: 15000 });
                        cardInfoSelector = '[data-testid="pmts-credit-card-instrument"]';
                        console.log('✅ Direct wallet navigation successful');
                    } else {
                        logMessage('Failed to find card selector, skipping...', 'error');
                        continue;
                    }
                }
            }
        }
 
        let cardInfo = await page.evaluate((selector) => {
            let card = document.querySelector(selector);
            
            // Try multiple selectors for card number
            if (!card) {
                const cardSelectors = [
                    '.a-size-base-plus.pmts-instrument-number-tail span',
                    '.pmts-instrument-number span',
                    '[class*="instrument-number"] span',
                    '.pmts-instrument-display-number'
                ];
                
                for (const sel of cardSelectors) {
                    card = document.querySelector(sel);
                    if (card) break;
                }
            }

            let link = document.querySelector('.a-row.apx-wallet-payment-method-details-section.pmts-portal-component .a-fixed-left-grid-col.a-col-left img');
            let name = document.querySelector('.a-row.apx-wallet-payment-method-details-section.pmts-portal-component .a-size-medium.apx-wallet-details-header.a-text-bold');
            
            return {
                number: card ? card.innerText : '',
                link: link ? link.src : '',
                name: name ? name.innerText : ''
            };
        }, cardInfoSelector);

        // Check if we got valid card info
        if (!cardInfo.number) {
            logMessage(`No card number found for ${card}, skipping...`, 'warning');
            console.log(`No card number found for ${card}, skipping...`);
            continue;
        }

        let fourNum = cardInfo.number.split('•••• ')[1];
        if (!fourNum) {
            console.log(`Could not extract last 4 digits from ${cardInfo.number}, using full number`);
            fourNum = cardInfo.number.replace(/\D/g, '').slice(-4);
        }
        
        global.temp.checkCard[index][fourNum] = {
            img: cardInfo.link,
            name: cardInfo.name,
            card: form
        }

        data.childCount[email] = data.childCount[email] ? data.childCount[email] + 1 : 1;
        await new Promise(resolve => setTimeout(resolve, randomInt(1000, 2000)));
    }

    // Update remaining cards count after each batch
    updateRemainingCardCount();

    logMessage(`Checked cards for ${email} at thread ${index} after ${(global.data.settings.checkAfter || 30000) / 1000} seconds`, 'info');
    console.log(`Checked cards for ${email} at thread ${index} after ${(global.data.settings.checkAfter || 30000) / 1000} seconds`);

    // Wait for specified delay before checking wallet
    await new Promise(resolve => setTimeout(resolve, global.data.settings.checkAfter || 30000));

    logMessage(`Checking wallets for ${email} at thread ${index}`, 'info');
    console.log(`Checking wallets for ${email} at thread ${index}`);

    // Start wallet verification process
    checkWallet(page, browser, email, index, proxy);
}

async function checkWallet(page, browser, email, index, proxy) {
    logMessage(`Starting wallet check for ${email}`, 'info');
    console.log(`Starting wallet check for ${email}`);
    
    // Safe reload with timeout handling
    let reloadSuccess = false;
    let reloadAttempts = 0;
    const maxReloadAttempts = 3;
    
    while (!reloadSuccess && reloadAttempts < maxReloadAttempts) {
        try {
            reloadAttempts++;
            logMessage(`Wallet reload attempt ${reloadAttempts}/${maxReloadAttempts} for ${email}`, 'info');
            console.log(`Wallet reload attempt ${reloadAttempts}/${maxReloadAttempts} for ${email}`);
            
            // Use Promise.race to handle timeout
            await Promise.race([
                page.reload({ 
                    waitUntil: 'domcontentloaded',
                    timeout: 30000
                }),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Reload timeout after 30s')), 30000)
                )
            ]);
            
            reloadSuccess = true;
            logMessage(`✅ Wallet page reloaded successfully for ${email}`, 'success');
            console.log(`✅ Wallet page reloaded successfully for ${email}`);
            
        } catch (reloadError) {
            logMessage(`❌ Reload attempt ${reloadAttempts} failed: ${reloadError.message}`, 'error');
            console.log(`❌ Reload attempt ${reloadAttempts} failed: ${reloadError.message}`);
            
            if (reloadAttempts < maxReloadAttempts) {
                // Try alternative navigation
                try {
                    console.log(`Trying alternative navigation to wallet page...`);
                    const navResult = await safeNavigateWithRetry(page, 'https://www.amazon.com/cpe/yourpayments/wallet');
                    if (navResult.success) {
                        reloadSuccess = true;
                        logMessage(`✅ Alternative navigation successful for ${email}`, 'success');
                        console.log(`✅ Alternative navigation successful for ${email}`);
                    } else {
                        logMessage(`❌ Alternative navigation failed: ${navResult.error}`, 'error');
                        if (reloadAttempts < maxReloadAttempts) {
                            await new Promise(resolve => setTimeout(resolve, 3000));
                        }
                    }
                } catch (navError) {
                    logMessage(`❌ Alternative navigation failed: ${navError.message}`, 'error');
                    if (reloadAttempts < maxReloadAttempts) {
                        await new Promise(resolve => setTimeout(resolve, 3000));
                    }
                }
            }
        }
    }
    
    if (!reloadSuccess) {
        logMessage(`❌ Failed to reload wallet page for ${email} after ${maxReloadAttempts} attempts`, 'error');
        console.log(`❌ Failed to reload wallet page for ${email}, continuing with next thread`);
        
        // Close browser and continue with next thread
        try {
            await browser.close();
        } catch (closeError) {
            console.log(`Error closing browser: ${closeError.message}`);
        }
        
        // Start new thread with same proxy
        return initThread(proxy, index);
    }

    // Wait for wallet container with timeout protection
    let walletContainerFound = false;
    try {
        await Promise.race([
            page.waitForSelector('.a-scroller.apx-wallet-desktop-payment-method-selectable-tab-css.a-scroller-vertical', { 
                timeout: 15000 
            }).then(() => { walletContainerFound = true; }),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Wallet container timeout')), 15000)
            )
        ]);
    } catch (containerError) {
        logMessage(`❌ Wallet container not found: ${containerError.message}`, 'error');
        console.log(`❌ Wallet container not found for ${email}`);
        
        // Try alternative wallet check
        return checkWalletAlternative(page, browser, email, index, proxy);
    }

    if (!walletContainerFound) {
        logMessage(`❌ Wallet container not found for ${email}`, 'error');
        console.log(`❌ Wallet container not found for ${email}`);
        return checkWalletAlternative(page, browser, email, index, proxy);
    }

    // Continue with existing wallet checking logic...
    try {
        // Get the number of payment methods in the wallet
        let length = await page.evaluate(async () => {
            let wallet = document.querySelector('.a-scroller.apx-wallet-desktop-payment-method-selectable-tab-css.a-scroller-vertical');
            return wallet && wallet.childNodes[0] ? wallet.childNodes[0].childNodes.length : 0;
        });

        logMessage(`Found ${length} payment methods in wallet for ${email}`, 'info');
        console.log(`Found ${length} payment methods in wallet for ${email}`);

        // Iterate through each payment method in the wallet
        let indexCard = 0;
        while (indexCard <= length + 1) {
            let wallet = await page.evaluate((i) => {
                let container = document.querySelector('.a-scroller.apx-wallet-desktop-payment-method-selectable-tab-css.a-scroller-vertical');
                if (!container || !container.childNodes[0] || !container.childNodes[0].childNodes[i]) return false;
                
                let wallet = container.childNodes[0].childNodes[i];
                if (wallet && wallet.nodeName && wallet.nodeName.toLowerCase() == 'div') {
                    wallet.click();
                    return true;
                }
                return false;
            }, indexCard);

            // Skip non-div elements
            if (!wallet) {
                indexCard++;
                continue;
            }
            
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            let cardInfo = await page.evaluate(() => {
                let card = document.querySelector('.a-size-base-plus.pmts-instrument-number-tail span');
                let link = document.querySelector('.a-row.apx-wallet-payment-method-details-section.pmts-portal-component .a-fixed-left-grid-col.a-col-left img');
                let name = document.querySelector('.a-row.apx-wallet-payment-method-details-section.pmts-portal-component .a-size-medium.apx-wallet-details-header.a-text-bold');

                return {
                    number: card ? card.innerText : '',
                    link: link ? link.src : '',
                    name: name ? name.innerText : ''
                };
            });

            let fourNum = cardInfo.number.split('•••• ')[1];

            const cardRemoved = await removeCardSafe(page);
            
            if (cardRemoved.reload) {
                // Safe reload after card removal
                try {
                    await Promise.race([
                        page.reload({ 
                            waitUntil: 'domcontentloaded',
                            timeout: 30000 
                        }),
                        new Promise((_, reject) => 
                            setTimeout(() => reject(new Error('Reload timeout')), 30000)
                        )
                    ]);
                    await new Promise(resolve => setTimeout(resolve, randomInt(1000, 1500)));
                } catch (reloadError) {
                    console.log(`Reload after card removal failed: ${reloadError.message}`);
                    // Continue without reload
                }
            }
            
            if (!cardRemoved.success) {
                console.log(`Failed to remove card ${fourNum || 'unknown'}, continuing to next card`);
                indexCard++;
                continue;
            }
            
            if (!global.temp.checkCard[index][fourNum]) {
                indexCard++;
                continue;
            }
            
            let cardBin = await getCardInfo(global.temp.checkCard[index][fourNum].card.number);
            if (!cardBin.success) {
                console.log(cardBin.error);
            }
            
            saveRemainingCards();

            if (global.temp.checkCard[index][fourNum].img != cardInfo.link || global.temp.checkCard[index][fourNum].name != cardInfo.name) {
                console.card.live(`LIVE|${global.temp.checkCard[index][fourNum].card.number}|${global.temp.checkCard[index][fourNum].card.month}|${global.temp.checkCard[index][fourNum].card.year}|${global.temp.checkCard[index][fourNum].card.cvc}|- Info Bank: ${cardBin.scheme}|${cardBin.type}|${cardBin.cardTier}|${cardBin.a2}|${cardBin.country}|${cardBin.issuer}`);
            } else {
                console.card.die(`DIE|${global.temp.checkCard[index][fourNum].card.number}|${global.temp.checkCard[index][fourNum].card.month}|${global.temp.checkCard[index][fourNum].card.year}|${global.temp.checkCard[index][fourNum].card.cvc}|- Info Bank: ${cardBin.scheme}|${cardBin.type}|${cardBin.cardTier}|${cardBin.a2}|${cardBin.country}|${cardBin.issuer}`);
            }
        }
        
        return thread(page, browser, email, index, proxy);
        
    } catch (error) {
        logMessage(`Error in checkWallet: ${error.message}`, 'error');
        console.log(`Error in checkWallet: ${error.message}`);
        return thread(page, browser, email, index, proxy);
    }
}

async function removeCardSafe(page) {
    try {
        console.log("Starting safe card removal...");
        
        // Set reasonable timeout
        const originalTimeout = page.getDefaultTimeout();
        page.setDefaultTimeout(30000); // 30 seconds max
        
        // Check if the remove link exists with timeout protection
        await new Promise(resolve => setTimeout(resolve, randomInt(1000, 1500)));
        
        const removeLinkExists = await Promise.race([
            page.evaluate(() => {
                return !!document.querySelector('.a-row.apx-wallet-payment-method-details-section.pmts-portal-component .a-link-normal');
            }),
            new Promise((resolve) => setTimeout(() => resolve(false), 5000))
        ]);
        
        if (!removeLinkExists) {
            console.log("Remove link not found, requesting page reload...");
            page.setDefaultTimeout(originalTimeout);
            return {success: false, reload: true};
        }
        
        // Wait and click remove link with timeout protection
        try {
            await Promise.race([
                page.waitForSelector('.a-row.apx-wallet-payment-method-details-section.pmts-portal-component .a-link-normal', {timeout: 10000}),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Remove link timeout')), 10000))
            ]);
            
            await new Promise(resolve => setTimeout(resolve, randomInt(1000, 1500)));
            
            await Promise.race([
                page.click('.a-row.apx-wallet-payment-method-details-section.pmts-portal-component .a-link-normal'),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Click timeout')), 5000))
            ]);
            
        } catch (clickError) {
            console.log(`Remove link click failed: ${clickError.message}`);
            page.setDefaultTimeout(originalTimeout);
            return {success: false};
        }

        // Wait for remove button with timeout protection
        const removeButtonExists = await Promise.race([
            page.waitForSelector('.a-popover.a-popover-modal.a-declarative[aria-hidden="false"] .a-popover-wrapper .apx-remove-link-button', {timeout: 10000})
                .then(() => true)
                .catch(() => false),
            new Promise((resolve) => setTimeout(() => resolve(false), 10000))
        ]);
            
        if (!removeButtonExists) {
            console.log("Remove button not found");
            page.setDefaultTimeout(originalTimeout);
            return {success: false};
        }
        
        await new Promise(resolve => setTimeout(resolve, randomInt(1000, 1500)));
        
        // Click remove button with timeout protection
        try {
            await Promise.race([
                page.click('.a-popover.a-popover-modal.a-declarative[aria-hidden="false"] .a-popover-wrapper .apx-remove-link-button'),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Remove button timeout')), 5000))
            ]);
        } catch (removeClickError) {
            console.log(`Remove button click failed: ${removeClickError.message}`);
            page.setDefaultTimeout(originalTimeout);
            return {success: false};
        }

        // Handle default payment method confirmation
        await Promise.race([
            page.waitForSelector('.a-popover.a-popover-modal.a-declarative[aria-hidden="false"] .apx-remove-link-button[value="Remove without selecting"]', {timeout: 3000}),
            new Promise((resolve) => setTimeout(() => resolve(null), 3000))
        ]);
        
        let defaultElement = await Promise.race([
            page.evaluate(() => {
                const element = document.querySelector('.a-popover.a-popover-modal.a-declarative[aria-hidden="false"] .apx-remove-link-button[value="Remove without selecting"]');
                if (element) {
                    element.click();
                    return true;
                }
                return false;
            }),
            new Promise((resolve) => setTimeout(() => resolve(false), 3000))
        ]);
        
        if (defaultElement) {
            page.setDefaultTimeout(originalTimeout);
            return {success: true};
        }

        // Wait for final confirmation button
        const confirmButtonExists = await Promise.race([
            page.waitForSelector('.a-popover.a-popover-modal.a-declarative[aria-hidden="false"] .a-popover-wrapper span.a-button.a-button-primary.pmts-delete-instrument.apx-remove-button-desktop.pmts-button-input input.a-button-input', {timeout: 10000})
                .then(() => true)
                .catch(() => false),
            new Promise((resolve) => setTimeout(() => resolve(false), 10000))
        ]);
            
        if (!confirmButtonExists) {
            console.log("Final confirm button not found");
            page.setDefaultTimeout(originalTimeout);
            return {success: false};
        }
        
        await new Promise(resolve => setTimeout(resolve, randomInt(1000, 1500)));
        
        // Final confirmation click
        try {
            await Promise.race([
                page.click('.a-popover.a-popover-modal.a-declarative[aria-hidden="false"] .a-popover-wrapper span.a-button.a-button-primary.pmts-delete-instrument.apx-remove-button-desktop.pmts-button-input input.a-button-input'),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Confirm click timeout')), 5000))
            ]);
        } catch (confirmError) {
            console.log(`Final confirm click failed: ${confirmError.message}`);
            page.setDefaultTimeout(originalTimeout);
            return {success: false};
        }

        await new Promise(resolve => setTimeout(resolve, randomInt(2000, 3000)));
        page.setDefaultTimeout(originalTimeout);
        
        console.log("✅ Card removed successfully");
        return {success: true};
        
    } catch (error) {
        console.log(`Error in removeCardSafe: ${error.message}`);
        try {
            page.setDefaultTimeout(30000); // Fallback timeout
        } catch (timeoutError) {
            // Ignore timeout restoration errors
        }
        return {success: false};
    }
}

async function checkWalletAlternative(page, browser, email, index, proxy) {
    logMessage(`Using alternative wallet check for ${email}`, 'info');
    console.log(`Using alternative wallet check for ${email}`);
    
    try {
        // Try direct navigation to wallet
        const navResult = await safeNavigateWithRetry(page, 'https://www.amazon.com/cpe/yourpayments/wallet?ref_=ya_d_c_pmt_mpo');
        if (!navResult.success) {
            throw new Error(`Navigation failed: ${navResult.error}`);
        }
        
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Simple wallet check - just count cards and continue
        const cardCount = await page.evaluate(() => {
            const cards = document.querySelectorAll('[data-testid="pmts-credit-card-instrument"], .pmts-instrument-row');
            return cards.length;
        });
        
        logMessage(`Alternative wallet check found ${cardCount} cards for ${email}`, 'info');
        console.log(`Alternative wallet check found ${cardCount} cards for ${email}`);
        
        // Continue with next thread instead of detailed wallet check
        return thread(page, browser, email, index, proxy);
        
    } catch (error) {
        logMessage(`Alternative wallet check failed: ${error.message}`, 'error');
        console.log(`Alternative wallet check failed for ${email}`);
        
        // Close browser and continue
        try {
            await browser.close();
        } catch (closeError) {
            console.log(`Error closing browser: ${closeError.message}`);
        }
        
        return initThread(proxy, index);
    }
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function getCardInfo(cardNumber) {
    try {
        // Check cache first (first 6-8 digits are the BIN)
        const bin = cardNumber.substring(0, 8);
        const binKey = bin.substring(0, 6); // Use first 6 digits as key
        
        if (binCache[binKey]) {
            console.log(`Using cached BIN data for ${binKey}***`);
            return {
                success: true,
                scheme: binCache[binKey].scheme,
                type: binCache[binKey].type,
                cardTier: binCache[binKey].cardTier,
                a2: binCache[binKey].a2,
                country: binCache[binKey].country,
                issuer: binCache[binKey].issuer
            };
        }
        
        // Direct API call without proxy
        let res = (await axios.get(`https://data.handyapi.com/bin/${cardNumber}`)).data;
        
        if (res.Status === "SUCCESS") {
            // Cache the result
            binCache[binKey] = {
                scheme: res.Scheme,
                type: res.Type,
                cardTier: res.CardTier,
                a2: res.Country.A2,
                country: res.Country.Name,
                issuer: res.Issuer
            };
            
            return {
                success: true,
                ...binCache[binKey]
            };
        }
        
        return { success: false, error: res.Status };
    } catch (error) {
        // Error handling
        if (error.message && error.message.includes('redirects exceeded')) {
            console.log(`Redirect limit exceeded for card ${cardNumber}.`);
        } else {
            console.log(`BIN lookup failed: ${error.message}`);
        }
        
        return { 
            success: false, 
            error: error.message,
            scheme: 'Unknown',
            type: 'Unknown',
            cardTier: 'Unknown',
            a2: 'Unknown',
            country: 'Unknown',
            issuer: 'Unknown'
        };
    }
}

var saveData = setInterval(() => {
    fs.writeFileSync(path.join(__dirname, "..", "data", 'data.json'), JSON.stringify(data, null, 2), 'utf8');
}, 5000);

// Function to save the remaining unscanned cards
function saveRemainingCards() {
    const remainingCards = listCards.slice(indexCard + 1);
    const saveDir = global.data.dirSave || path.join(__dirname, "..", "results");
    
    // Ensure save directory exists
    if (!fs.existsSync(saveDir)) {
        fs.mkdirSync(saveDir, { recursive: true });
    }
    
    fs.writeFileSync(path.join(saveDir, 'remaining_cards.txt'), remainingCards.join('\n'), 'utf8');
    
    // Update the remaining cards count in UI
    updateRemainingCardCount();
}

// Helper function to update the remaining count in UI
function updateRemainingCardCount() {
    const remaining = Math.max(0, totalCards - (indexCard + 1));
    
    // Update UI if console.card is available
    if (console.card && typeof console.card.setRemaining === 'function') {
        console.card.setRemaining(remaining);
    }
    
    return remaining;
}

// Function để thêm business account vào data.json
function addBusinessAccount(email) {
    try {
        const dataPath = path.join(__dirname, '..', 'data', 'data.json');
        let dataConfig = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
        
        // Khởi tạo businessAccounts nếu chưa có
        if (!dataConfig.businessAccounts) {
            dataConfig.businessAccounts = [];
        }
        
        // Kiểm tra email đã tồn tại chưa
        if (!dataConfig.businessAccounts.includes(email)) {
            dataConfig.businessAccounts.push(email);
            
            // Khởi tạo childCount cho account mới
            if (!dataConfig.childCount) {
                dataConfig.childCount = {};
            }
            if (!dataConfig.childCount[email]) {
                dataConfig.childCount[email] = 0;
            }
            
            // Lưu lại file
            fs.writeFileSync(dataPath, JSON.stringify(dataConfig, null, 2), 'utf8');
            
            // Cập nhật global data
            global.data = dataConfig;
            
            logMessage(`✅ Added ${email} to business accounts in data.json`, 'success');
            console.log(`✅ Business account added to data.json: ${email}`);
            
            return true;
        } else {
            logMessage(`⚠️ ${email} already exists in business accounts`, 'warning');
            return false;
        }
        
    } catch (error) {
        console.error(`❌ Error adding business account ${email}:`, error.message);
        logMessage(`❌ Error adding business account ${email}: ${error.message}`, 'error');
        return false;
    }
}

// Function để lấy tất cả business accounts từ data.json
function getBusinessAccounts() {
    try {
        const dataPath = path.join(__dirname, '..', 'data', 'data.json');
        const dataConfig = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
        return dataConfig.businessAccounts || [];
    } catch (error) {
        console.error('Error reading business accounts:', error.message);
        return [];
    }
}

// Function để sync business accounts với listChild
function syncBusinessAccounts() {
    try {
        // Đọc lại data.json
        const dataPath = path.join(__dirname, '..', 'data', 'data.json');
        const dataConfig = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
        const businessEmails = dataConfig.businessAccounts || [];
        
        // Cập nhật listChild với business accounts mới
        const allAccounts = fs.readFileSync(path.join(__dirname, "..", "data", 'acc.txt'), 'utf8')
            .replaceAll("\r", '').split("\n")
            .map(line => line.trim())
            .filter(line => line.length > 0);
        
        listChild = allAccounts.filter(accountLine => {
            const email = accountLine.split('|')[0];
            return businessEmails.includes(email);
        });
        
        logMessage(`🔄 Synced business accounts: ${listChild.length} accounts available`, 'info');
        console.log(`Synced business accounts: ${listChild.length} accounts available`);
        
        return listChild.length;
        
    } catch (error) {
        console.error('Error syncing business accounts:', error.message);
        logMessage(`❌ Error syncing business accounts: ${error.message}`, 'error');
        return 0;
    }
}

// Export with proper structure
module.exports = {
    checkCard,
    addBusinessAccount,
    getBusinessAccounts,
    syncBusinessAccounts,
    removeLockedAccount,
    safeNavigateWithRetry,
    updateRemainingCardCount
};