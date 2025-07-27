const puppeteer = require('puppeteer');

async function addCard(page, cardInfo) {
    try {
        const timeout = 30 * 1000;
        page.setDefaultTimeout(timeout);

        // Step 1: Click "Add a payment method" with multiple fallback strategies
        try {
            const targetPage = page;
            
            // Try to wait for page to be fully loaded first
            await targetPage.waitForLoadState?.('networkidle', { timeout: 10000 }).catch(() => {});
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Try multiple strategies to find and click the add payment method button
            let clicked = false;
            
            // Strategy 1: Use race locator (original method)
            try {
                await puppeteer.Locator.race([
                    targetPage.locator('::-p-aria(Add a payment method[role=\\"link\\"])'),
                    targetPage.locator('#pp-paEOaP-10'),
                    targetPage.locator('::-p-xpath(//*[@id=\\"pp-paEOaP-10\\"])'),
                    targetPage.locator(':scope >>> #pp-paEOaP-10')
                ])
                    .setTimeout(15000) // Reduced timeout for faster fallback
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
            
            // Strategy 2: Try direct selector search
            if (!clicked) {
                try {
                    const addPaymentButton = await targetPage.waitForSelector('a[href*="payment"], button:has-text("Add a payment method"), a:has-text("Add a payment method")', { timeout: 10000 });
                    if (addPaymentButton) {
                        await addPaymentButton.click();
                        clicked = true;
                        console.log("Used direct selector method");
                    }
                } catch (directError) {
                    console.log("Direct selector failed, trying JavaScript evaluation...");
                }
            }
            
            // Strategy 3: Use page.evaluate to find and click
            if (!clicked) {
                try {
                    const jsClickResult = await targetPage.evaluate(() => {
                        // Look for various patterns of add payment method button
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
        await new Promise(resolve => setTimeout(resolve, 3000)); // Increased wait time

        // Step 2: Click "Add a credit or debit card" with multiple fallback strategies
        try {
            const targetPage = page;
            let creditCardClicked = false;
            
            // Strategy 1: Use race locator (original method)
            try {
                await puppeteer.Locator.race([
                    targetPage.locator('::-p-aria(Add a credit or debit card)'),
                    targetPage.locator('#pp-7diwwq-34 input'),
                    targetPage.locator('::-p-xpath(//*[@id=\\"pp-7diwwq-36\\"]/span/input)'),
                    targetPage.locator(':scope >>> #pp-7diwwq-34 input')
                ])
                    .setTimeout(15000)
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
            
            // Strategy 2: Direct selector approach
            if (!creditCardClicked) {
                try {
                    const creditCardButton = await targetPage.waitForSelector('input[type="radio"][value*="credit"], input[type="radio"][value*="card"], label:has-text("credit"):has(input)', { timeout: 10000 });
                    if (creditCardButton) {
                        await creditCardButton.click();
                        creditCardClicked = true;
                        console.log("Used direct credit card selector");
                    }
                } catch (directError) {
                    console.log("Direct credit card selector failed");
                }
            }
            
            // Strategy 3: JavaScript evaluation
            if (!creditCardClicked) {
                try {
                    const jsResult = await targetPage.evaluate(() => {
                        // Look for credit card radio button or any related elements
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
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Step 3: Enter card number
        try {
            const targetPage = page;
            targetPage.setDefaultTimeout(timeout);

            try {
                await targetPage.waitForSelector('iframe.apx-secure-iframe.pmts-portal-component', { timeout });

                const elementHandle = await targetPage.$('iframe.apx-secure-iframe.pmts-portal-component');
                if (!elementHandle) {
                    console.error('Could not find credit card iframe');
                } else {
                    const iframe = await elementHandle.contentFrame();
                    await iframe.waitForSelector('.a-input-text.a-form-normal.pmts-account-Number');
                    await iframe.locator('.a-input-text.a-form-normal.pmts-account-Number').click({
                        offset: { x: 66.92500305175781, y: 16.899993896484375 }
                    });
                    await iframe.locator('.a-input-text.a-form-normal.pmts-account-Number').fill(cardInfo.number);
                }
            } catch (error) {
                await page.reload({ waitUntil: ['networkidle0', 'domcontentloaded'] });
                await new Promise(resolve => setTimeout(resolve, 5000));
                return await addCard(page, cardInfo);
            }
        } catch (error) {
            console.error('Error entering card number:', error);
            return { success: false, error: error, step: 'enter_card_number' };
        }
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Step 4: Enter cardholder name
        try {
            const targetPage = page;
            targetPage.setDefaultTimeout(timeout);

            try {
                await targetPage.waitForSelector('iframe.apx-secure-iframe.pmts-portal-component', { timeout });

                const elementHandle = await targetPage.$('iframe.apx-secure-iframe.pmts-portal-component');
                if (!elementHandle) {
                    console.error('Could not find credit card iframe');
                } else {
                    const iframe = await elementHandle.contentFrame();
                    await iframe.waitForSelector('.a-input-text.a-form-normal.apx-add-credit-card-account-holder-name-input.mcx-input-fields');
                    
                    await iframe.locator('.a-input-text.a-form-normal.apx-add-credit-card-account-holder-name-input.mcx-input-fields').fill(cardInfo.name);
                }
            } catch (error) {
                console.error('Error interacting with credit card iframe');

                return { success: false, error: error, noChangeThread: true };
            }
        } catch (error) {
            console.error('Error entering cardholder name:', error);
            return { success: false, error: error, step: 'enter_cardholder_name' };
        }
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Step 5: Handle checkbox and month selection
        try {
            const targetPage = page;
            targetPage.setDefaultTimeout(timeout);

            try {
                await targetPage.waitForSelector('iframe.apx-secure-iframe.pmts-portal-component', { timeout });

                const elementHandle = await targetPage.$('iframe.apx-secure-iframe.pmts-portal-component');
                if (!elementHandle) {
                    console.error('Could not find credit card iframe');
                } else {
                    const iframe = await elementHandle.contentFrame();

                    const isChecked = await iframe.evaluate(selector => {
                        const element = document.querySelector(selector);
                        return element ? element.checked : false;
                    }, '.a-checkbox.pmts-update-everywhere-checkbox.a-spacing-base label input');
                    console.log('Checkbox is checked:', isChecked);
                    if (isChecked) {
                        await iframe.locator('.a-checkbox.pmts-update-everywhere-checkbox.a-spacing-base label input').click();
                    }
                    await iframe.locator('.a-button-text.a-declarative').click();
                    
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    await iframe.locator('.a-popover.a-dropdown.a-dropdown-common.a-declarative > :nth-child(2) > :nth-child(1) > :nth-child(1) > :nth-child(' + Number(cardInfo.month) + ') > :nth-child(1)').click();
                }
            } catch (error) {
                console.error('Error interacting with credit card iframe');

                return { success: false, error: error, noChangeThread: true };
            }
        } catch (error) {
            console.error('Error handling checkbox and month selection:', error);
            return { success: false, error: error, step: 'handle_checkbox_month' };
        }
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Step 6: Select year
        try {
            const targetPage = page;
            targetPage.setDefaultTimeout(timeout);

            try {
                await targetPage.waitForSelector('iframe.apx-secure-iframe.pmts-portal-component', { timeout });

                const elementHandle = await targetPage.$('iframe.apx-secure-iframe.pmts-portal-component');
                if (!elementHandle) {
                    console.error('Could not find credit card iframe');
                } else {
                    const iframe = await elementHandle.contentFrame();
                    
                    await iframe.locator('.a-button.a-button-dropdown.pmts-expiry-year.pmts-portal-component .a-button-text.a-declarative').click();
                    await new Promise(resolve => setTimeout(resolve, 2000));

                    const currentYear = Number(new Date().getFullYear());

                    await iframe.locator(`#a-popover-3 > :nth-child(2) > :nth-child(1) > :nth-child(1) > :nth-child(${(Number(cardInfo.year) - currentYear)+1}) > :nth-child(1)`).click();
                }
            } catch (error) {
                console.error('Error interacting with credit card iframe');

                return { success: false, error: error, noChangeThread: true };
            }
        } catch (error) {
            console.error('Error selecting year:', error);
            return { success: false, error: error, step: 'select_year' };
        }
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Step 7: Submit card
        try {
            const targetPage = page;
            targetPage.setDefaultTimeout(timeout);

            try {
                await targetPage.waitForSelector('iframe.apx-secure-iframe.pmts-portal-component', { timeout });

                const elementHandle = await targetPage.$('iframe.apx-secure-iframe.pmts-portal-component');
                if (!elementHandle) {
                    console.error('Could not find credit card iframe');
                } else {
                    const iframe = await elementHandle.contentFrame();
                    await iframe.waitForSelector('.a-button-input');
                    await iframe.locator('.a-button-input').click({
                        offset: { x: 2.125, y: 13.5 }
                    });
                }
            } catch (error) {
                console.error('Error interacting with credit card iframe');

                return { success: false, error: error, noChangeThread: true };
            }
        } catch (error) {
            console.error('Error submitting card:', error);
            return { success: false, error: error, step: 'submit_card' };
        }
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Step 8: Confirm address
        try {
            const targetPage = page;
            targetPage.setDefaultTimeout(timeout);

            try {
                await targetPage.waitForSelector('iframe.apx-secure-iframe.pmts-portal-component', { timeout: 30000 });

                const elementHandle = await targetPage.$('iframe.apx-secure-iframe.pmts-portal-component');
                if (!elementHandle) {
                    console.error('Could not find credit card iframe');
                    return { success: false, error: 'Iframe not found', step: 'confirm_address' };
                } else {
                    const iframe = await elementHandle.contentFrame();
                    await iframe.waitForSelector('span.a-button.a-spacing-base.a-button-primary.pmts-use-selected-address.pmts-button-input input.a-button-input');
                    await iframe.locator('span.a-button.a-spacing-base.a-button-primary.pmts-use-selected-address.pmts-button-input input.a-button-input').click({
                        offset: {
                            x: 51.53749084472656,
                            y: 13.699981689453125,
                        },
                    });
                }
            } catch (error) {
                console.error('Error interacting with credit card iframe during address confirmation:', error);
                return { success: false, error: error, noChangeThread: true, step: 'confirm_address_iframe' };
            }
        } catch (error) {
            console.error('Error confirming address:', error);
            return { success: false, error: error, step: 'confirm_address' };
        }

        return { success: true };
    } catch (error) {
        console.error('Error in addCard function:', error);
        return { success: false, error: error };
    }
}

module.exports = addCard;
