// node parse_hw.js 2>&1 | tee output.txt
'use strict';

const fs = require("fs");
const puppeteer = require('puppeteer');


const url = "https://git.cs.msu.ru/gkuryachiy/prac/-/issues/1";
const out = "result";

const widthWindow       = 1920;
const heightWindow      = 1015;
const widthContentArea  = 1536;
const heightContentArea = 754;

const chromeOptions = {
    product: 'chrome',
//    executablePath: "/usr/bin/google-chrome-stable",
    executablePath: 'google-chrome-stable',
    headless: true,
    ignoreHTTPSErrors: true,
    dumpio: true,
    args: [
        '--no-sandbox',
        '--headless',
        '--hide-scrollbars',
        '--mute-audio',
        `--window-size=${widthWindow},${heightWindow}`
    ]
};


function sleep(ms = 0) {
    return new Promise(r => setTimeout(r, ms));
}

const preparePageForTests = async (page) => {
    const userAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/78.0.3904.87 Safari/537.36";
    await page.setUserAgent(userAgent);

    await page.evaluateOnNewDocument(() => {
        var newProto = navigator.__proto__;
        delete newProto.webdriver;
        navigator.__proto__ = newProto;
    });

    await page.setViewport({
        width: widthContentArea,
        height: heightContentArea
    });
};

// https://stackoverflow.com/questions/51529332/puppeteer-scroll-down-until-you-cant-anymore
async function autoScroll(page){
    await page.evaluate(async () => {
        await new Promise((resolve, reject) => {
            var totalHeight = 0;
            var distance = 100;
            var timer = setInterval(() => {
                var scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;

                if(totalHeight >= scrollHeight){
                    clearInterval(timer);
                    resolve();
                }
            }, 500);
        });
    });
}


const getGitUrls = async (page) => {
    await page.waitForSelector('div#notes');
    let newUrls = await page.evaluate(() => {
        let results = [];
        let items = document.querySelectorAll('.timeline-content > div.timeline-discussion-body > div > div.note-text.md > p');
        items.forEach((item) => {
            let l = item.innerText.split(' ');
            results.push({
                name: l[0] + " " + l[1] + " " + l[2],
                url: l.pop()
            });
        });
        return results;
    });

    return newUrls;
};

const getStudentsRepos = async () => {
    const browser = await puppeteer.launch(chromeOptions);
    console.log(await browser.version());

    const page = await browser.newPage();
    await preparePageForTests(page);
    await page.goto(url, {
        waitUntil: 'networkidle2',
    });

    // Debug
    const html = await page.content();
    fs.writeFileSync(out + '.html', html);
    await page.screenshot({path: out + '.png', fullPage: true});

    await autoScroll(page);

    const urls = await getGitUrls(page);

    await browser.close();

    return urls;
};

const getCommitInfoGitHub = async (browser, commitUrl) => {
    // Parse time and modified files from commit

    const page = await browser.newPage();
    await preparePageForTests(page);
    await page.goto(commitUrl, {
        waitUntil: 'networkidle2',
    });

    // Get commit time
    await page.waitForSelector('#js-repo-pjax-container > div.container-xl.clearfix.new-discussion-timeline.px-3.px-md-4.px-lg-5 > div > div.commit.full-commit.mt-0.px-2.pt-2 > div.commit-meta.p-2.d-flex.flex-wrap > div.flex-self-start.no-wrap.mr-md-4.mr-0 > relative-time', {visible: true});
    var date = await page.evaluate((selector) => {
        return document.querySelector(selector).getAttribute("title");
    }, '#js-repo-pjax-container > div.container-xl.clearfix.new-discussion-timeline.px-3.px-md-4.px-lg-5 > div > div.commit.full-commit.mt-0.px-2.pt-2 > div.commit-meta.p-2.d-flex.flex-wrap > div.flex-self-start.no-wrap.mr-md-4.mr-0 > relative-time');

    console.log("Date was successfully extracted");

    // Get modified files
    await page.waitForSelector('#toc > div.toc-diff-stats > button');
    await page.click('#toc > div.toc-diff-stats > button');
    await page.waitForSelector('#toc > ol');

    console.log("Files names were successfully extracted");

    var modFiles = await page.evaluate((selector) => {
        const list = Array.from(document.querySelectorAll(selector));

        let results = [];
        list.forEach(async (item) => {
            results.push(await item.innerText);
        });

        return results;

    }, '#toc > ol > li > a');

    // await page.close();

    return {
        files: modFiles,
        date: date
    };
};

const getStudentCommitsGitHub = async (browser, name, baseUrl) => {
    let baseUrlCorr = baseUrl.replace(/\/*.git$/, '');
    let commitsUrl = baseUrlCorr + "/commits/master";

    console.log("commitsUrl: ", commitsUrl);

    var page = await browser.newPage();
    await preparePageForTests(page);
    await page.goto(commitsUrl, {
        waitUntil: 'networkidle2', // TODO, change it!
    });

    // Debug
    console.log("Name: ", name);
    await page.screenshot({path: name + '.png', fullPage: true});

    var enable = true;
    var commitShortInfo = []
    while (enable) {

        const csi = await page.evaluate((selector) => {
            const list = Array.from(document.querySelectorAll(selector));

            let results = [];
            list.forEach(async (item) => {
                results.push({
                    commitText: await item.innerText,
                    commitHash: await item.getAttribute('href').split('/').pop()    
                });
            });

            return results;

        }, 'div.flex-auto.min-width-0 > p > a:first-child');

        commitShortInfo.push(...csi);

        console.log("Ncommits: ", commitShortInfo.length);

        // Go to the next page with commits
        try {
            // find button "Older" with href
            const href = await page.evaluate((selector) => {
                console.log("InnerText: ", document.querySelector(selector).innerText);
                if (document.querySelector(selector).innerText == "Older") {
                    return document.querySelector(selector).getAttribute("href");
                } else {
                    return "";
                }

            }, '#js-repo-pjax-container > div.container-xl.clearfix.new-discussion-timeline.px-3.px-md-4.px-lg-5 > div > div.paginate-container > div > a');

            if (!href) {
                enable = false;
            } else {
                enable = true;
                // page = await browser.newPage();
                // await preparePageForTests(page);
                await page.goto(href, {
                    waitUntil: 'networkidle2',
                });
            }

        } catch(err) {
            enable = false;
        }
    }

    let commitsInfo = [];
    var errorCommits = 0;
    for (let i = 0; i < commitShortInfo.length; i++) {
        const commitUrl = baseUrlCorr + "/commit/" + commitShortInfo[i].commitHash;

        console.log("getStudentCommitsGitHub BEFORE: ", commitUrl); // debug, remove after test
        try {
            let commitInfo = await getCommitInfoGitHub(browser, commitUrl);

            console.log("getStudentCommitsGitHub AFTER: ", commitUrl, " | ", commitInfo.date, " | ", commitShortInfo[i].commitText, " | ", JSON.stringify(commitInfo.files));
        
            commitsInfo.push({
                url:  commitUrl,
                text: commitShortInfo[i].commitText,
                files: commitInfo.files,
                date: commitInfo.date
            });
        } catch(err) {
            console.log("getStudentCommitsGitHub ERROR: ", err);
            errorCommits += 1;
            continue;
        }
    }

    console.log("Results for: ", name, ". TOTAL: ", commitsInfo.length + errorCommits, ", SUCCESS: ", commitsInfo.length, ", ERROR: ", errorCommits);

    // await page.close();

    return commitsInfo;
};

const getCommitInfoGitlab = async (browser, commitUrl) => {
    // Parse time and modified files from commit
    const page = await browser.newPage();
    await preparePageForTests(page);
    await page.goto(commitUrl, {
        waitUntil: 'networkidle2',
    });

    // Get commit time
    // attribute -> data-original-title="Oct 01, 2020 5:52pm GMT+0300"
    // attribute -> datetime="2020-10-01T14:52:53Z"
    await page.waitForSelector('#content-body > div.container-fluid.container-limited.limit-container-width > div.page-content-header.js-commit-box > div.header-main-content > time', {visible: true});
    var date = await page.evaluate((selector) => {
        return document.querySelector(selector).getAttribute("data-original-title");
    }, '#content-body > div.container-fluid.container-limited.limit-container-width > div.page-content-header.js-commit-box > div.header-main-content > time');

    // #content-body > div.container-fluid.container-limited.limit-container-width > div.page-content-header.js-commit-box > div.header-main-content > time

    console.log("Date was successfully extracted");

    // Get modified files
    await page.waitForSelector('#content-body > div.container-fluid.container-limited.limit-container-width > div.content-block.oneline-block.files-changed.diff-files-changed.js-diff-files-changed > div > div.commit-stat-summary.dropdown > button');
    await page.click('#content-body > div.container-fluid.container-limited.limit-container-width > div.content-block.oneline-block.files-changed.diff-files-changed.js-diff-files-changed > div > div.commit-stat-summary.dropdown > button');
    await page.waitForSelector('#content-body > div.container-fluid.container-limited.limit-container-width > div.content-block.oneline-block.files-changed.diff-files-changed.js-diff-files-changed > div > div.commit-stat-summary.dropdown.show > div.dropdown-menu.diff-file-changes.show > div.dropdown-content > ul');

    console.log("Files names were successfully extracted");

    // https://medium.com/@migueloop/a-useful-puppeteer-examples-tutorial-set-bf5716aeda96
    var modFiles = await page.evaluate((selector) => {
        const list = Array.from(document.querySelectorAll(selector));

        let results = [];
        list.forEach(async (item) => {
            results.push(await item.getAttribute('title'));
        });

        return results;

    }, '#content-body > div.container-fluid.container-limited.limit-container-width > div.content-block.oneline-block.files-changed.diff-files-changed.js-diff-files-changed > div > div.commit-stat-summary.dropdown.show > div.dropdown-menu.diff-file-changes.show > div.dropdown-content > ul > li > a');

    // await page.close();

    return {
        files: modFiles,
        date: date
    };
};

const getStudentCommitsGitlab = async (browser, name, baseUrl) => {
    let baseUrlCorr = baseUrl.replace(/\/*.git$/, '');
    let commitsUrl = baseUrlCorr + "/-/commits/master";

    console.log("commitsUrl: ", commitsUrl);

    const page = await browser.newPage();
    await preparePageForTests(page);
    await page.goto(commitsUrl, {
        waitUntil: 'networkidle2',
    });

    await autoScroll(page);

    // Debug
    console.log("Name: ", name);
    await page.screenshot({path: name + '.png', fullPage: true});

    var commitShortInfo = await page.evaluate((selector) => {
        const list = Array.from(document.querySelectorAll(selector));

        let results = [];
        list.forEach(async (item) => {
            console.log("!!!: ", item.innerText); // debug, remove after test
            results.push({
                commitText: await item.innerText,
                commitHash: await item.getAttribute('href').split('/').pop()    
            });
        });

        return results;

    }, 'div.commit-detail.flex-list > div.commit-content.qa-commit-content > a:first-child');

    let commitsInfo = [];
    var errorCommits = 0;
    for (let i = 0; i < commitShortInfo.length; i++) {
        const commitUrl = baseUrlCorr + "/-/commit/" + commitShortInfo[i].commitHash;

        console.log("getStudentCommitsGitlab BEFORE: ", commitUrl); // debug, remove after test
        try {
            let commitInfo = await getCommitInfoGitlab(browser, commitUrl);

            console.log("getStudentCommitsGitlab AFTER: ", commitUrl, " | ", commitInfo.date, " | ", commitShortInfo[i].commitText, " | ", JSON.stringify(commitInfo.files));
            
            commitsInfo.push({
                url:  commitUrl,
                text: commitShortInfo[i].commitText,
                files: commitInfo.files,
                date: commitInfo.date
            });

        } catch(err) {
            console.log("getStudentCommitsGitlab ERROR: ", err);
            errorCommits += 1;
            continue;
        }
    }

    console.log("Results for: ", name, ". TOTAL: ", commitsInfo.length + errorCommits, ", SUCCESS: ", commitsInfo.length, ", ERROR: ", errorCommits);

    // await page.close();

    return commitsInfo;
};

const getStudentsStatistics = async (students_repos) => {
    let results = []; // {"name": "Name", "url": "Repo URL", "commits": [{"date": "date_str", "files": ["filename_1", ..., "filename_N"]}, ..., {...}]}

    for (const item of students_repos) {
        const browser = await puppeteer.launch(chromeOptions);
        console.log(await browser.version());

        try {
            

            console.log("Name: ", item.name);
            
            let commits = [];
            let commitsInfo = [];
            
            // TODO
            // add scrolling and goto older commits 
            // one page contains not all commits

            if (item.url.includes("github")) {
                commitsInfo = await getStudentCommitsGitHub(browser, item.name, item.url);
            } else {
                commitsInfo = await getStudentCommitsGitlab(browser, item.name, item.url);
            }

            results.push({
                name: item.name,
                url: item.url,
                commits: commitsInfo,
                ncommits: commitsInfo.length
            });
        } catch(err) {
            console.log("Error: ", err.message);
        }

        await browser.close();
    }

    return results;
};

async function run () {
    // Get repo urls
    const studentsRepos = await getStudentsRepos();
    console.log("Number of students: " + studentsRepos.length);
    console.log(studentsRepos);

    // NOTE!
    // remove after test
    const debugStudentsRepos = [
        {
            name: 'Бодров Антон Олегович',
            url: 'https://github.com/jan2801/pythonprac.git'
        },
        {
            name: 'Стрельников Алексей Олегович',
            url: 'https://git.cs.msu.ru/s02180538/pythonprac.git'
        },
        {
            name: 'Коваленко Анастасия Павловна',
            url: 'https://git.cs.msu.ru/s02180445/pythonprac'
        },
        {
            name: 'Карпенков Роман Андреевич',
            url: 'https://git.cs.msu.ru/s90180038/pythonprac'
        },
        {
            name: 'Александров Алексей Владимирович',
            url: 'https://git.cs.msu.ru/s02180607/pythonprac'
        },
        {
            name: 'Любимов Артем Максимович',
            url: 'https://git.cs.msu.ru/s02180666/pyrhonprac'
        },
        {
            name: 'Танкаев Иван Рустамович',
            url: 'https://github.com/TheGhost8/pythonprac'
        },
        {
            name: 'Литвинюк Сергей Павлович',
            url: 'https://git.cs.msu.ru/s02180027/pythonprac'
        },
        {
            name: 'Чернышов Михаил Михайлович',
            url: 'https://github.com/Disfavour/pythonprac'
        },
        {
            name: 'Плужникова Дарья Руслановна',
            url: 'https://git.cs.msu.ru/s02180501/pythonprac'
        },
        {
            name: 'Ветрова Екатерина Александровна',
            url: 'https://git.cs.msu.ru/s02180389/pythonprac'
        },
        {
            name: 'Беляева Ольга Константиновна',
            url: 'https://git.cs.msu.ru/s02180374/pythonprac.git'
        },
        {
            name: 'Ларин Андрей Викторович',
            url: 'https://github.com/hakenlaken/pythonprac.git'
        },
        {
            name: 'Абрамов Алексей Владимирович',
            url: 'https://git.cs.msu.ru/s02180360/pythonprac'
        },
        {
            name: 'Костин Родион Николаевич',
            url: 'https://git.cs.msu.ru/s02170133/pythonprac'
        },
        {
            name: 'Коблова Елизавета Сергеевна',
            url: 'https://git.cs.msu.ru/s02170124/pythonprac'
        },
    ];

    console.log(debugStudentsRepos);

    // Get statistics
    const studentsStat = await getStudentsStatistics(debugStudentsRepos);
    console.log(JSON.stringify(studentsStat));
}

run();
