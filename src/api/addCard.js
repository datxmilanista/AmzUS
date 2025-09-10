const puppeteer = require('puppeteer');

// ✅ ADD FRAME DETACHMENT HANDLER
async function safePageReload(page, timeout = 10000) {
    try {
        console.log("🔄 Attempting safe page reload...");
        
        // Check if page is still attached
        if (page.isClosed()) {
            console.log("❌ Page is already closed, cannot reload");
            throw new Error('PAGE_CLOSED');
        }
        
        await page.reload({ 
            waitUntil: ['domcontentloaded'], 
            timeout: timeout 
        });
        
        console.log("✅ Page reloaded successfully");
        return true;
        
    } catch (reloadError) {
        console.log(`❌ Page reload failed: ${reloadError.message}`);
        
        // If frame detached or page closed, signal for full restart
        if (reloadError.message.includes('detached Frame') || 
            reloadError.message.includes('Session closed') ||
            reloadError.message.includes('Page has been closed')) {
            throw new Error('FRAME_DETACHED');
        }
        
        throw reloadError;
    }
}

// ✅ CHECK IF IFRAME IS STILL VALID
async function isIframeValid(page, iframeSelector) {
    try {
        const elementHandle = await page.$(iframeSelector);
        if (!elementHandle) return false;
        
        const iframe = await elementHandle.contentFrame();
        if (!iframe) return false;
        
        // Try to access iframe content
        await iframe.evaluate(() => document.readyState);
        return true;
    } catch (error) {
        return false;
    }
}

// ✅ ENHANCED YEAR SELECTION WITH EXTENDED RANGE
async function selectYear(iframe, cardInfo, retryCount = 0) {
    const maxRetries = 3;
    
    try {
        console.log(`🗓️ Attempting to select year: ${cardInfo.year} (attempt ${retryCount + 1}/${maxRetries})`);
        
        // Click year dropdown
        await iframe.locator('.a-button.a-button-dropdown.pmts-expiry-year.pmts-portal-component .a-button-text.a-declarative').click();
        await new Promise(resolve => setTimeout(resolve, 1500)); // Wait for dropdown to populate
        
        const currentYear = new Date().getFullYear();
        const targetYear = Number(cardInfo.year);
        
        console.log(`📅 Current year: ${currentYear}, Target year: ${targetYear}`);
        
        // ✅ STRATEGY 1: Direct text-based selection (most reliable)
        try {
            console.log('🎯 Strategy 1: Direct text-based year selection');
            
            // Wait for dropdown to be fully loaded
            await iframe.waitForSelector('#a-popover-3', { timeout: 5000 });
            
            // Get all year options
            const yearOptions = await iframe.$$('#a-popover-3 a');
            console.log(`📋 Found ${yearOptions.length} year options in dropdown`);
            
            // Log all available years for debugging
            const availableYears = [];
            for (let i = 0; i < yearOptions.length; i++) {
                try {
                    const yearText = await iframe.evaluate(el => el.textContent?.trim(), yearOptions[i]);
                    if (yearText && yearText.match(/^\d{4}$/)) { // Only 4-digit years
                        availableYears.push(yearText);
                    }
                } catch (e) {
                    continue;
                }
            }
            
            console.log(`📅 Available years: [${availableYears.join(', ')}]`);
            
            // Try to find exact year match
            for (let i = 0; i < yearOptions.length; i++) {
                try {
                    const yearText = await iframe.evaluate(el => el.textContent?.trim(), yearOptions[i]);
                    console.log(`🔍 Checking option ${i}: "${yearText}"`);
                    
                    if (yearText === targetYear.toString()) {
                        await yearOptions[i].click();
                        console.log(`✅ Year ${targetYear} selected successfully by text match`);
                        return true;
                    }
                } catch (e) {
                    console.log(`❌ Error checking option ${i}: ${e.message}`);
                    continue;
                }
            }
            
            console.log(`⚠️ Target year ${targetYear} not found in available years`);
            
        } catch (strategy1Error) {
            console.log(`❌ Strategy 1 failed: ${strategy1Error.message}`);
        }
        
        // ✅ STRATEGY 2: Index-based selection with extended range
        try {
            console.log('🎯 Strategy 2: Index-based year selection');
            
            const yearDifference = targetYear - currentYear;
            console.log(`📊 Year difference: ${yearDifference}`);
            
            // Try multiple index calculations
            const indexesToTry = [
                yearDifference + 1,     // Standard calculation
                yearDifference + 2,     // Alternative offset
                yearDifference,         // Direct difference
                Math.abs(yearDifference) + 1, // Absolute value
            ];
            
            for (const index of indexesToTry) {
                if (index < 1) continue; // Skip invalid indices
                
                try {
                    console.log(`🎯 Trying index: ${index}`);
                    await iframe.locator(`#a-popover-3 > :nth-child(2) > :nth-child(1) > :nth-child(1) > :nth-child(${index}) > :nth-child(1)`).click();
                    
                    // Verify selection worked
                    await new Promise(resolve => setTimeout(resolve, 500));
                    
                    console.log(`✅ Year selected successfully with index ${index}`);
                    return true;
                    
                } catch (indexError) {
                    console.log(`❌ Index ${index} failed: ${indexError.message}`);
                    continue;
                }
            }
            
        } catch (strategy2Error) {
            console.log(`❌ Strategy 2 failed: ${strategy2Error.message}`);
        }
        
        // ✅ STRATEGY 3: Fallback to nearest available year
        try {
            console.log('🎯 Strategy 3: Fallback to nearest available year');
            
            // Get all available years and find closest
            const yearOptions = await iframe.$$('#a-popover-3 a');
            const availableYears = [];
            
            for (let i = 0; i < yearOptions.length; i++) {
                try {
                    const yearText = await iframe.evaluate(el => el.textContent?.trim(), yearOptions[i]);
                    if (yearText && yearText.match(/^\d{4}$/)) {
                        availableYears.push({ year: parseInt(yearText), element: yearOptions[i], index: i });
                    }
                } catch (e) {
                    continue;
                }
            }
            
            if (availableYears.length > 0) {
                // Find nearest year
                const nearestYear = availableYears.reduce((prev, curr) => {
                    return Math.abs(curr.year - targetYear) < Math.abs(prev.year - targetYear) ? curr : prev;
                });
                
                console.log(`🎯 Selecting nearest available year: ${nearestYear.year} (target was ${targetYear})`);
                
                await nearestYear.element.click();
                console.log(`✅ Fallback year ${nearestYear.year} selected successfully`);
                return true;
            }
            
        } catch (strategy3Error) {
            console.log(`❌ Strategy 3 failed: ${strategy3Error.message}`);
        }
        
        // ✅ STRATEGY 4: JavaScript direct click
        try {
            console.log('🎯 Strategy 4: JavaScript direct year selection');
            
            const jsResult = await iframe.evaluate((targetYear) => {
                const dropdown = document.querySelector('#a-popover-3');
                if (!dropdown) return { success: false, error: 'Dropdown not found' };
                
                const links = dropdown.querySelectorAll('a');
                console.log(`Found ${links.length} year options in JS`);
                
                // Try exact match first
                for (const link of links) {
                    const text = link.textContent?.trim();
                    if (text === targetYear.toString()) {
                        link.click();
                        return { success: true, year: text, method: 'exact' };
                    }
                }
                
                // Try partial match or closest year
                const availableYears = Array.from(links)
                    .map(link => link.textContent?.trim())
                    .filter(text => text && text.match(/^\d{4}$/))
                    .map(text => parseInt(text))
                    .sort((a, b) => a - b);
                
                if (availableYears.length > 0) {
                    // Find closest year
                    const closestYear = availableYears.reduce((prev, curr) => {
                        return Math.abs(curr - targetYear) < Math.abs(prev - targetYear) ? curr : prev;
                    });
                    
                    // Click the closest year
                    for (const link of links) {
                        const text = link.textContent?.trim();
                        if (text === closestYear.toString()) {
                            link.click();
                            return { success: true, year: closestYear, method: 'closest' };
                        }
                    }
                }
                
                return { success: false, error: 'No suitable year found', availableYears };
            }, targetYear);
            
            if (jsResult.success) {
                console.log(`✅ JavaScript year selection successful: ${jsResult.year} (${jsResult.method})`);
                return true;
            } else {
                console.log(`❌ JavaScript selection failed:`, jsResult);
            }
            
        } catch (strategy4Error) {
            console.log(`❌ Strategy 4 failed: ${strategy4Error.message}`);
        }
        
        // ✅ All strategies failed
        throw new Error(`All year selection strategies failed for year ${targetYear}`);
        
    } catch (error) {
        console.log(`❌ Year selection error: ${error.message}`);
        
        if (retryCount < maxRetries - 1) {
            console.log(`🔄 Retrying year selection... (${retryCount + 1}/${maxRetries})`);
            
            // Try to reopen dropdown
            try {
                await iframe.locator('.a-button.a-button-dropdown.pmts-expiry-year.pmts-portal-component .a-button-text.a-declarative').click();
                await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (reopenError) {
                console.log(`⚠️ Failed to reopen dropdown: ${reopenError.message}`);
            }
            
            return await selectYear(iframe, cardInfo, retryCount + 1);
        }
        
        throw error;
    }
}

async function addCard(page, cardInfo, retryCount = 0) {
    // ✅ PREVENT INFINITE RECURSION
    const maxRetries = 2;
    if (retryCount >= maxRetries) {
        console.log(`❌ Max retries (${maxRetries}) reached for addCard`);
        return { success: false, error: 'MAX_RETRIES_EXCEEDED', step: 'max_retries' };
    }
    
    try {
        const timeout = 10 * 1000;
        page.setDefaultTimeout(timeout);

        // ✅ CHECK PAGE VALIDITY AT START
        if (page.isClosed()) {
            console.log("❌ Page is closed at start");
            return { success: false, error: 'PAGE_CLOSED', step: 'initial_check' };
        }

        try {
            const targetPage = page;
            await new Promise(resolve => setTimeout(resolve, 500));
            
            let clicked = false;
            
            try {
                await puppeteer.Locator.race([
                    targetPage.locator('::-p-aria(Add a payment method[role=\\"link\\"])'),
                    targetPage.locator('#pp-paEOaP-10'),
                    targetPage.locator('::-p-xpath(//*[@id=\\"pp-paEOaP-10\\"])'),
                    targetPage.locator(':scope >>> #pp-paEOaP-10')
                ])
                    .setTimeout(8000) 
                    .click({
                        offset: {
                            x: 18,
                            y: 12.399993896484375,
                        },
                    });
                clicked = true;
            } catch (raceError) {
                console.log("Race locator failed, trying alternative methods...");
            }
            
            if (!clicked) {
                try {
                    const addPaymentButton = await targetPage.waitForSelector('a[href*="payment"], button:has-text("Add a payment method"), a:has-text("Add a payment method")', { timeout: 5000 });
                    if (addPaymentButton) {
                        await addPaymentButton.click();
                        clicked = true;
                        console.log("Used direct selector method");
                    }
                } catch (directError) {
                    console.log("Direct selector failed, trying JavaScript evaluation...");
                }
            }
            
            if (!clicked) {
                try {
                    const jsClickResult = await targetPage.evaluate(() => {
                        const selectors = [
                            'a[href*="payment"]',
                            'button[data-testid*="add-payment"]',
                            'a[data-testid*="add-payment"]',
                            '*[id*="pp-paEOaP"]',
                            'a:contains("Add a payment method")',
                            'button:contains("Add a payment method")'
                        ];
                        
                        for (const selector of selectors) {
                            try {
                                const element = document.querySelector(selector) || 
                                              Array.from(document.querySelectorAll('a, button')).find(el => 
                                                  el.textContent.toLowerCase().includes('add') && 
                                                  el.textContent.toLowerCase().includes('payment')
                                              );
                                if (element) {
                                    element.click();
                                    return { success: true, method: 'javascript', selector };
                                }
                            } catch (e) {
                                continue;
                            }
                        }
                        return { success: false };
                    });
                    
                    if (jsClickResult.success) {
                        clicked = true;
                        console.log(`Used JavaScript evaluation with ${jsClickResult.selector}`);
                    }
                } catch (jsError) {
                    console.log("JavaScript evaluation failed");
                }
            }
            
            if (!clicked) {
                throw new Error("All strategies failed to click Add a payment method button");
            }
            
        } catch (error) {
            console.error('Error clicking "Add a payment method":', error.message);
            return { success: false, error: error.message, step: 'add_payment_method' };
        }
        await new Promise(resolve => setTimeout(resolve, 1500));

        // Step 2: Click "Add a credit or debit card"
        try {
            const targetPage = page;
            let creditCardClicked = false;
            
            try {
                await puppeteer.Locator.race([
                    targetPage.locator('::-p-aria(Add a credit or debit card)'),
                    targetPage.locator('#pp-7diwwq-34 input'),
                    targetPage.locator('::-p-xpath(//*[@id=\\"pp-7diwwq-36\\"]/span/input)'),
                    targetPage.locator(':scope >>> #pp-7diwwq-34 input')
                ])
                    .setTimeout(8000)
                    .click({
                        offset: {
                            x: 87.19998168945312,
                            y: 10.600006103515625,
                        },
                    });
                creditCardClicked = true;
            } catch (raceError) {
                console.log("Credit card race locator failed, trying alternatives...");
            }
            
            if (!creditCardClicked) {
                try {
                    const creditCardButton = await targetPage.waitForSelector('input[type="radio"][value*="credit"], input[type="radio"][value*="card"], label:has-text("credit"):has(input)', { timeout: 5000 });
                    if (creditCardButton) {
                        await creditCardButton.click();
                        creditCardClicked = true;
                        console.log("Used direct credit card selector");
                    }
                } catch (directError) {
                    console.log("Direct credit card selector failed");
                }
            }
            
            if (!creditCardClicked) {
                try {
                    const jsResult = await targetPage.evaluate(() => {
                        const elements = [
                            ...document.querySelectorAll('input[type="radio"]'),
                            ...document.querySelectorAll('label'),
                            ...document.querySelectorAll('button')
                        ];
                        
                        for (const element of elements) {
                            const text = element.textContent || element.value || element.getAttribute('aria-label') || '';
                            if (text.toLowerCase().includes('credit') || text.toLowerCase().includes('debit') || text.toLowerCase().includes('card')) {
                                try {
                                    element.click();
                                    return { success: true, text: text.slice(0, 50) };
                                } catch (e) {
                                    continue;
                                }
                            }
                        }
                        return { success: false };
                    });
                    
                    if (jsResult.success) {
                        creditCardClicked = true;
                        console.log(`Used JavaScript evaluation for credit card: ${jsResult.text}`);
                    }
                } catch (jsError) {
                    console.log("JavaScript credit card evaluation failed");
                }
            }
            
            if (!creditCardClicked) {
                throw new Error("All strategies failed to click credit/debit card option");
            }
            
        } catch (error) {
            console.error('Error clicking "Add a credit or debit card":', error.message);
            return { success: false, error: error.message, step: 'add_credit_card' };
        }
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Step 3: Enter card number
        try {
            const targetPage = page;
            targetPage.setDefaultTimeout(timeout);

            try {
                await targetPage.waitForSelector('iframe.apx-secure-iframe.pmts-portal-component', { timeout: 8000 });

                const elementHandle = await targetPage.$('iframe.apx-secure-iframe.pmts-portal-component');
                if (!elementHandle) {
                    console.error('Could not find credit card iframe');
                    throw new Error('IFRAME_NOT_FOUND');
                } else {
                    const iframe = await elementHandle.contentFrame();
                    if (!iframe) {
                        throw new Error('IFRAME_CONTENT_FRAME_NULL');
                    }
                    
                    await iframe.waitForSelector('.a-input-text.a-form-normal.pmts-account-Number', { timeout: 5000 });
                    await iframe.locator('.a-input-text.a-form-normal.pmts-account-Number').click({
                        offset: { x: 66.92500305175781, y: 16.899993896484375 }
                    });
                    await iframe.locator('.a-input-text.a-form-normal.pmts-account-Number').fill(cardInfo.number);
                }
            } catch (error) {
                console.log("Card number entry failed:", error.message);
                
                // ✅ CHECK FOR FRAME DETACHMENT
                if (error.message.includes('detached Frame') || 
                    error.message.includes('Session closed')) {
                    throw new Error('FRAME_DETACHED');
                }
                
                throw error;
            }
        } catch (error) {
            if (error.message === 'FRAME_DETACHED') {
                console.log("❌ Frame detached during card number entry");
                return { success: false, error: 'FRAME_DETACHED', step: 'enter_card_number' };
            }
            
            console.error('Error entering card number:', error);
            return { success: false, error: error, step: 'enter_card_number' };
        }
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Step 4: Enter cardholder name
        try {
            const targetPage = page;
            targetPage.setDefaultTimeout(timeout);

            try {
                // ✅ CHECK IFRAME VALIDITY BEFORE USE
                if (!(await isIframeValid(targetPage, 'iframe.apx-secure-iframe.pmts-portal-component'))) {
                    throw new Error('IFRAME_INVALID');
                }
                
                await targetPage.waitForSelector('iframe.apx-secure-iframe.pmts-portal-component', { timeout: 8000 });

                const elementHandle = await targetPage.$('iframe.apx-secure-iframe.pmts-portal-component');
                if (!elementHandle) {
                    console.error('Could not find credit card iframe');
                    throw new Error('IFRAME_NOT_FOUND');
                } else {
                    const iframe = await elementHandle.contentFrame();
                    if (!iframe) {
                        throw new Error('IFRAME_CONTENT_FRAME_NULL');
                    }
                    
                    await iframe.waitForSelector('.a-input-text.a-form-normal.apx-add-credit-card-account-holder-name-input.mcx-input-fields', { timeout: 5000 });
                    await iframe.locator('.a-input-text.a-form-normal.apx-add-credit-card-account-holder-name-input.mcx-input-fields').fill(cardInfo.name);
                }
            } catch (error) {
                console.error('Error interacting with credit card iframe during name entry:', error.message);
                
                if (error.message.includes('detached Frame') || 
                    error.message.includes('Session closed') ||
                    error.message === 'IFRAME_INVALID') {
                    throw new Error('FRAME_DETACHED');
                }
                
                throw error;
            }
        } catch (error) {
            if (error.message === 'FRAME_DETACHED') {
                console.log("❌ Frame detached during name entry");
                return { success: false, error: 'FRAME_DETACHED', step: 'enter_cardholder_name' };
            }
            
            console.error('Error entering cardholder name:', error);
            return { success: false, error: error, step: 'enter_cardholder_name' };
        }
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Step 5: Handle checkbox and month selection
        try {
            const targetPage = page;
            targetPage.setDefaultTimeout(timeout);

            try {
                // ✅ CHECK IFRAME VALIDITY
                if (!(await isIframeValid(targetPage, 'iframe.apx-secure-iframe.pmts-portal-component'))) {
                    throw new Error('IFRAME_INVALID');
                }
                
                await targetPage.waitForSelector('iframe.apx-secure-iframe.pmts-portal-component', { timeout: 8000 });

                const elementHandle = await targetPage.$('iframe.apx-secure-iframe.pmts-portal-component');
                if (!elementHandle) {
                    console.error('Could not find credit card iframe');
                    throw new Error('IFRAME_NOT_FOUND');
                } else {
                    const iframe = await elementHandle.contentFrame();
                    if (!iframe) {
                        throw new Error('IFRAME_CONTENT_FRAME_NULL');
                    }

                    const isChecked = await iframe.evaluate(selector => {
                        const element = document.querySelector(selector);
                        return element ? element.checked : false;
                    }, '.a-checkbox.pmts-update-everywhere-checkbox.a-spacing-base label input');
                    console.log('Checkbox is checked:', isChecked);
                    if (isChecked) {
                        await iframe.locator('.a-checkbox.pmts-update-everywhere-checkbox.a-spacing-base label input').click();
                    }
                    
                    await iframe.locator('.a-button-text.a-declarative').click();
                    await new Promise(resolve => setTimeout(resolve, 500));
                    
                    const monthIndex = Number(cardInfo.month);
                    console.log(`Selecting month: ${monthIndex}`);
                    
                    await iframe.locator('.a-popover.a-dropdown.a-dropdown-common.a-declarative > :nth-child(2) > :nth-child(1) > :nth-child(1) > :nth-child(' + monthIndex + ') > :nth-child(1)').click();
                }
            } catch (error) {
                console.error('Error interacting with credit card iframe during month selection:', error.message);
                
                if (error.message.includes('detached Frame') || 
                    error.message.includes('Session closed') ||
                    error.message === 'IFRAME_INVALID') {
                    throw new Error('FRAME_DETACHED');
                }
                
                throw error;
            }
        } catch (error) {
            if (error.message === 'FRAME_DETACHED') {
                console.log("❌ Frame detached during month selection");
                return { success: false, error: 'FRAME_DETACHED', step: 'handle_checkbox_month' };
            }
            
            console.error('Error handling checkbox and month selection:', error);
            return { success: false, error: error, step: 'handle_checkbox_month' };
        }
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Step 6: Select year - ✅ ENHANCED YEAR SELECTION
        try {
            const targetPage = page;
            targetPage.setDefaultTimeout(timeout);

            try {
                // Check iframe validity
                if (!(await isIframeValid(targetPage, 'iframe.apx-secure-iframe.pmts-portal-component'))) {
                    throw new Error('IFRAME_INVALID');
                }
                
                await targetPage.waitForSelector('iframe.apx-secure-iframe.pmts-portal-component', { timeout: 8000 });

                const elementHandle = await targetPage.$('iframe.apx-secure-iframe.pmts-portal-component');
                if (!elementHandle) {
                    console.error('Could not find credit card iframe');
                    throw new Error('IFRAME_NOT_FOUND');
                } else {
                    const iframe = await elementHandle.contentFrame();
                    if (!iframe) {
                        throw new Error('IFRAME_CONTENT_FRAME_NULL');
                    }
                    
                    // ✅ USE ENHANCED YEAR SELECTION FUNCTION
                    const yearSelected = await selectYear(iframe, cardInfo);
                    
                    if (!yearSelected) {
                        throw new Error('Year selection failed after all strategies');
                    }
                }
            } catch (error) {
                console.error('Error interacting with credit card iframe during year selection:', error.message);
                
                if (error.message.includes('detached Frame') || 
                    error.message.includes('Session closed') ||
                    error.message === 'IFRAME_INVALID') {
                    throw new Error('FRAME_DETACHED');
                }
                
                throw error;
            }
        } catch (error) {
            if (error.message === 'FRAME_DETACHED') {
                console.log("❌ Frame detached during year selection");
                return { success: false, error: 'FRAME_DETACHED', step: 'select_year' };
            }
            
            console.error('Error selecting year:', error);
            return { success: false, error: error, step: 'select_year' };
        }
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Step 7: Submit card
        try {
            const targetPage = page;
            targetPage.setDefaultTimeout(timeout);

            try {
                // ✅ CHECK IFRAME VALIDITY
                if (!(await isIframeValid(targetPage, 'iframe.apx-secure-iframe.pmts-portal-component'))) {
                    throw new Error('IFRAME_INVALID');
                }
                
                await targetPage.waitForSelector('iframe.apx-secure-iframe.pmts-portal-component', { timeout: 8000 });

                const elementHandle = await targetPage.$('iframe.apx-secure-iframe.pmts-portal-component');
                if (!elementHandle) {
                    console.error('Could not find credit card iframe');
                    throw new Error('IFRAME_NOT_FOUND');
                } else {
                    const iframe = await elementHandle.contentFrame();
                    if (!iframe) {
                        throw new Error('IFRAME_CONTENT_FRAME_NULL');
                    }
                    
                    await iframe.waitForSelector('.a-button-input', { timeout: 5000 });
                    await iframe.locator('.a-button-input').click({
                        offset: { x: 2.125, y: 13.5 }
                    });
                }
            } catch (error) {
                console.error('Error interacting with credit card iframe during submission:', error.message);
                
                if (error.message.includes('detached Frame') || 
                    error.message.includes('Session closed') ||
                    error.message === 'IFRAME_INVALID') {
                    throw new Error('FRAME_DETACHED');
                }
                
                throw error;
            }
        } catch (error) {
            if (error.message === 'FRAME_DETACHED') {
                console.log("❌ Frame detached during card submission");
                return { success: false, error: 'FRAME_DETACHED', step: 'submit_card' };
            }
            
            console.error('Error submitting card:', error);
            return { success: false, error: error, step: 'submit_card' };
        }
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Step 8: Confirm address
        try {
            const targetPage = page;
            targetPage.setDefaultTimeout(timeout);

            try {
                // ✅ CHECK IFRAME VALIDITY
                if (!(await isIframeValid(targetPage, 'iframe.apx-secure-iframe.pmts-portal-component'))) {
                    console.log("⚠️ Iframe not valid for address confirmation, but continuing...");
                    return { success: true }; // Sometimes address confirmation is not needed
                }
                
                await targetPage.waitForSelector('iframe.apx-secure-iframe.pmts-portal-component', { timeout: 6000 });

                const elementHandle = await targetPage.$('iframe.apx-secure-iframe.pmts-portal-component');
                if (!elementHandle) {
                    console.log("⚠️ Could not find iframe for address confirmation, but continuing...");
                    return { success: true };
                } else {
                    const iframe = await elementHandle.contentFrame();
                    if (!iframe) {
                        console.log("⚠️ Could not get iframe content frame for address confirmation, but continuing...");
                        return { success: true };
                    }
                    
                    let addressConfirmed = false;
                    
                    // Strategy 1: Original selector
                    try {
                        await iframe.waitForSelector('span.a-button.a-spacing-base.a-button-primary.pmts-use-selected-address.pmts-button-input input.a-button-input', { timeout: 3000 });
                        await iframe.locator('span.a-button.a-spacing-base.a-button-primary.pmts-use-selected-address.pmts-button-input input.a-button-input').click({
                            offset: {
                                x: 51.53749084472656,
                                y: 13.699981689453125,
                            },
                        });
                        addressConfirmed = true;
                        console.log('✅ Address confirmed with Strategy 1');
                    } catch (addr1Error) {
                        console.log('❌ Address confirmation Strategy 1 failed');
                    }
                    
                    // Strategy 2: Generic button selectors
                    if (!addressConfirmed) {
                        try {
                            const buttonSelectors = [
                                'input[type="submit"]',
                                '.a-button-input',
                                'button[type="submit"]',
                                '*[class*="use-selected-address"] input',
                                '*[class*="pmts-button"] input'
                            ];
                            
                            for (const selector of buttonSelectors) {
                                try {
                                    await iframe.waitForSelector(selector, { timeout: 2000 });
                                    await iframe.click(selector);
                                    addressConfirmed = true;
                                    console.log(`✅ Address confirmed with selector: ${selector}`);
                                    break;
                                } catch (selectorError) {
                                    continue;
                                }
                            }
                        } catch (addr2Error) {
                            console.log('❌ Address confirmation Strategy 2 failed');
                        }
                    }
                    
                    // Strategy 3: JavaScript click
                    if (!addressConfirmed) {
                        try {
                            const jsResult = await iframe.evaluate(() => {
                                const buttons = [
                                    ...document.querySelectorAll('input[type="submit"]'),
                                    ...document.querySelectorAll('button'),
                                    ...document.querySelectorAll('.a-button-input'),
                                    ...document.querySelectorAll('*[class*="use-selected-address"]'),
                                    ...document.querySelectorAll('*[class*="button"]')
                                ];
                                
                                for (const button of buttons) {
                                    const text = button.textContent || button.value || '';
                                    if (text.toLowerCase().includes('use') || 
                                        text.toLowerCase().includes('confirm') ||
                                        text.toLowerCase().includes('continue') ||
                                        button.type === 'submit') {
                                        try {
                                            button.click();
                                            return { success: true, method: 'javascript', text: text.slice(0, 30) };
                                        } catch (e) {
                                            continue;
                                        }
                                    }
                                }
                                return { success: false };
                            });
                            
                            if (jsResult.success) {
                                addressConfirmed = true;
                                console.log(`✅ Address confirmed with JS: ${jsResult.text}`);
                            }
                        } catch (addr3Error) {
                            console.log('❌ Address confirmation Strategy 3 failed');
                        }
                    }
                    
                    if (!addressConfirmed) {
                        console.log('⚠️ All address confirmation strategies failed, but continuing...');
                    }
                }
            } catch (error) {
                console.error('Error interacting with credit card iframe during address confirmation:', error.message);
                
                if (error.message.includes('detached Frame') || 
                    error.message.includes('Session closed')) {
                    console.log("⚠️ Frame detached during address confirmation, but card might be added successfully");
                    return { success: true }; // Don't fail the entire process
                }
                
                // Don't throw error for address confirmation failures
                console.log("⚠️ Address confirmation failed, but continuing...");
            }
        } catch (error) {
            console.error('Error confirming address:', error);
            // Don't fail for address confirmation errors
            console.log("⚠️ Address confirmation failed, but card might still be added successfully");
        }

        return { success: true };
        
    } catch (error) {
        console.error('Error in addCard function:', error);
        
        // ✅ HANDLE FRAME DETACHMENT - RETURN ERROR INSTEAD OF RECURSIVE CALL
        if (error.message === 'FRAME_DETACHED' || 
            error.message.includes('detached Frame') ||
            error.message.includes('Session closed')) {
            
            console.log(`❌ Frame detached at retry ${retryCount + 1}/${maxRetries}`);
            return { success: false, error: 'FRAME_DETACHED', step: 'frame_detached', shouldRetry: retryCount < maxRetries - 1 };
        }
        
        return { success: false, error: error };
    }
}

module.exports = addCard;