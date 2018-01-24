// 1e1 - 2.71828183E0+bankin-challenge at gmail.com
/* mutable configuration */

const URL = 'https://web.bankin.com/challenge/index.html?start={start}'; // the entry point

const URL_PARAMETER_START = { // config of the URL paramater ?start=
    min: 0,         // first value
    step: 50,       // step
    max: 100100,    // max value (watchdog)
}

const PAGE_CONFIG = {
    nbPageReload: 3,        // number of times the page is reloaded if there is a network error
    loadTimeout: 10123,     // max milliseconds allowed for loading the dom
    scriptTimeout: 30123,   // max milliseconds allowed for onload execution script
    mutableSelector: 'tr, iframe',          // selector of the elements that the scrapper is looking for
    reloadButtonSelector: '#btnGenerate',   // selector of the reload button
}

const NB_PARALLEL_PROCESS = 32; // number of parallel process


/* --------------------------------------------------------------------------
 * 
 * CUSTOM PARSER SPECIFIC TO THE TARGET
 *
 * -------------------------------------------------------------------------- */


/**
 * return the transaction list from the frame
 * a TR have to be EXACTLY
 * account | transaction | amountAndCurrency
 * @param {Frame} frame - the frame to parse
 * @return {Array<Object>} transaction list found into the frame
 */
async function getTransactionList(frame) {
    return await frame.evaluate(() => {
        const transactionList = [];
        const tdList = Array.from(document.getElementsByTagName('td'));
        const amountAndCurrencyPattern = /(\D*)(\d[\.\,\s\d]*)(\D*)/;
        
        // iterate from the end of the list
        while (0 !== tdList.length) {
            const amountAndCurrency = tdList.pop().textContent;
            const [, leftCurrency, amount, rightCurrency] = amountAndCurrency.match(amountAndCurrencyPattern);
            const transaction = {
                currency: (leftCurrency + rightCurrency).trim(),
                amount: amount.trim(),
                transaction: tdList.pop().textContent.trim(),
                account: tdList.pop().textContent.trim(),
            }

            // you can add checkings to filter the transaction
            
            transactionList.push(transaction);
        }

        return transactionList;
    });
}



/* --------------------------------------------------------------------------
 * 
 * CORE CONFIG
 *
 * -------------------------------------------------------------------------- */


String.prototype.format = function(opts) { return this.replace(/\{([^\}]+)\}/g, (match, name) => opts[name]) }


/* -------------------------------------------------------------------------- */


const PUPPETEER_ARGS = {
    ignoreHTTPSErrors: true,
    headless: true,
    devtools: false,
    args: [
        // see https://peter.sh/experiments/chromium-command-line-switches/
        '--0',
        '--aggressive',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-extensions',
        '--enable-fast-unload',
        '--no-default-browser-check',
        '--no-experiments ',
        '--no-first-run',
        '--no-pings',
        '--no-referrers',
    ],
};

const PUPPETEER = require('puppeteer');
const BROWSER_PROMISE = PUPPETEER.launch(PUPPETEER_ARGS);

const GOTO_OPTIONS = { 
    waitUntil: 'domcontentloaded', 
    timeout: PAGE_CONFIG.loadTimeout,
};

const WAIT_FOR_SELECTOR_OPTIONS = {
    timeout: PAGE_CONFIG.scriptTimeout,
}

var TRANSACTION_LIST = []; // the final result


/* --------------------------------------------------------------------------
 * 
 * CORE WORKFLOW
 *
 * -------------------------------------------------------------------------- */


/**
 * append the transaction list from the frame to the global transaction list
 */
function appendTransactionList(transactionList) {
    TRANSACTION_LIST = TRANSACTION_LIST.concat(transactionList);
}


/**
 * iterate on each frames of the page until a frame contains a transaction list
 * @param {Page} page - the page to parse
 * @return {integer} length of the transaction list found on the page
 */
async function parseAnyFrame(page) {
    const frames = page.frames();
    
    for (let index = 0; index < frames.length; ++index) {
        const frame = frames[index];
        const transactionList = await getTransactionList(frame);
        const transactionListLength = transactionList.length;
        
        // stop now if the extractor worked
        if (0 !== transactionListLength) {
            appendTransactionList(transactionList);

            return transactionListLength;
        }
    };
    
    return 0;
}


/**
 * load the URL into the page container, 
 * navigate on the page for extracting the transaction list
 * @param {Page} page - the page container
 * @param {string} url - the targeted URL
 * @param {integer} processIndex - the processIndex
 * @return {Array<integer>} 0:length of the transaction list found on the page (-1 is an error), 1: processIndex
 */
async function parsePage(page, url, processIndex) {
    let nbRetry = PAGE_CONFIG.nbPageReload;
    let nbTransaction = -1; // -1 = error while requesting the URL

    const parse = async () => {
        // stop retrying
        nbRetry = -1;

        // click on the reload button if exsits
        page.click(PAGE_CONFIG.reloadButtonSelector).catch(()=>null);
        
        // trigger on %mutableSelector%
        await page.waitForSelector(PAGE_CONFIG.mutableSelector, WAIT_FOR_SELECTOR_OPTIONS).catch(()=>null);

        // extract the transaction list
        nbTransaction = await parseAnyFrame(page);
    }

    // retry goto(URL) x nbRetry, otherwise it fails
    do {
        try {
            await page.goto(url, GOTO_OPTIONS).then(parse, ()=>--nbRetry);
        } catch(ignore) {}
    } while (0 < nbRetry);
    
    return [nbTransaction, processIndex];
}


/**
 * initialize a new page container from a promise
 * @param {Promise<Page>} pagePromise - the page promise
 * @return {Page} page container
 */
async function prepareNewPage(pagePromise) {
    const page = await pagePromise;
    
    // dismiss blocking dialog window if exists
    page.on('dialog', async dialog => {
        await dialog.dismiss();
    });
    
    return page;
}


/**
 * setup a list a page containers
 * @param {Browser} browser - the browser
 * @return {Array<Page>} array of page container
 */
async function preparePageList(browser) {
    const pagePromises = [];
    const pages = [];

    // start page containers
    for (let i = 0; i < NB_PARALLEL_PROCESS; ++i) {
        pagePromises.push(browser.newPage());
    }
    
    // waiting for the page containers are ready
    for (let i = 0; i < pagePromises.length; ++i) {
        pages[i] = await prepareNewPage(pagePromises[i]);
    }

    return pages;
}


/**
 * manage the parallel work
 * @throws Error("network") if a scrapper fails due to a network issue
 * @param {Promise<Browser>} browserPromise - the browser promise
 */
async function run(browserPromise) {
    const browser = await browserPromise;

    const pages = await preparePageList(browser); // pool of thread-pages
    const parserPromises = []; // pool of jobs to run in a page
    const pageSize = URL_PARAMETER_START.step;
    const urlParameterStartMax = URL_PARAMETER_START.max;

    let nbTransactionOnTheLastPage; // length of the transaction list found on the last page
    let processIndex; // index of the thread-page in parserPromises[]
    let urlParameterStart = URL_PARAMETER_START.min; // value of the "start" URL parameter

    // start a new "parsePage" on the thread-page at processIndex
    const startParserAt = (pid) => {
        const page = pages[pid];
        const url = URL.format({start: urlParameterStart});
        const parserPromise = parsePage(page, url, pid);

        parserPromises[pid] = parserPromise;
        urlParameterStart += pageSize;
    }
    
    // first load into the empty thread-pages
    for (processIndex = 0; processIndex < pages.length; ++processIndex) {
        startParserAt(processIndex);
    }

    // reload scrapper who terminated into an existing thread-pages
    do {
        [nbTransactionOnTheLastPage, processIndex] = await Promise.race(parserPromises);
        
        startParserAt(processIndex);
    } while(pageSize === nbTransactionOnTheLastPage && urlParameterStartMax > urlParameterStart);
    
    // last startParserAt(page) is useless
    parserPromises.slice(processIndex, 1);

    // shutdown
    await Promise.all(parserPromises);

    // the loop stops because the script can not execute page.goto several times
    if (-1 === nbTransactionOnTheLastPage) {
        TRANSACTION_LIST = null;
        throw new Error("An network error occured during the scrapping");
    }

    await browser.close();
}



/* -------------------------------------------------------------------------- */


(async function() {
    await run(BROWSER_PROMISE);

    const theFinalResultForTheChallenge = JSON.stringify(TRANSACTION_LIST);

    console.log(theFinalResultForTheChallenge);

    // be carefull it floods the JSON response
    //console.debug(TRANSACTION_LIST.length + " transactions");
})()

// this is sparta! 