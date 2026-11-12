/**
 * Скрипт поблочной сверки поиска БКРС с эталоном bkrs.info.
 *
 * Блоки:
 *   - main: главная словарная статья / прямой перевод БРуКС / слова предложения / омофоны пиньиня
 *   - starting: производные слова («начинающиеся:» / в китайских словах)
 *   - sats: сателлиты и специализированные контексты
 *   - examples: двуязычные примеры предложений
 *
 * Запуск:
 *   node tests/bkrs_parity/run_parity.js
 *   node tests/bkrs_parity/run_parity.js --query "学习"
 *   node tests/bkrs_parity/run_parity.js --dump-actual actual.json
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT_DIR = path.resolve(__dirname, '../..');
const QUERIES_PATH = path.join(__dirname, 'queries.json');
const EXPECTED_PATH = path.join(__dirname, 'expected.json');
const INDEX_HTML_PATH = path.join(ROOT_DIR, 'index.html');

// 1. Инициализация движка BkrsDB в изолированном контексте Node.js
function loadBkrsEngine() {
    const content = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
    const lines = content.split('\n');

    let startLine = -1;
    let endLine = -1;

    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('const BkrsSearchEngine = window.BkrsSearchEngine = {')) {
            startLine = i;
        }
        if (startLine !== -1 && lines[i].includes('function renderColoredPinyin(')) {
            endLine = i;
            break;
        }
    }

    if (startLine === -1 || endLine === -1) {
        throw new Error('Не удалось найти границы BkrsSearchEngine и BkrsDB в index.html');
    }

    const engineCode = lines.slice(startLine, endLine).join('\n');
    const fileCache = new Map();

    const sandbox = {
        window: {},
        fetch: async (url) => {
            const rel = url.replace(/^[\\\/]/, '');
            const fullPath = path.resolve(ROOT_DIR, rel);

            if (fileCache.has(fullPath)) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => fileCache.get(fullPath)
                };
            }

            if (fs.existsSync(fullPath)) {
                try {
                    const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
                    fileCache.set(fullPath, parsed);
                    return {
                        ok: true,
                        status: 200,
                        json: async () => parsed
                    };
                } catch (e) {
                    return { ok: false, status: 500 };
                }
            }
            return { ok: false, status: 404 };
        },
        console: { log: () => {}, warn: () => {}, error: () => {} },
        Set,
        Map,
        Promise,
        Array,
        Object,
        Math,
        RegExp,
        String,
        Number,
        Boolean,
        Buffer
    };

    const ctx = vm.createContext(sandbox);
    vm.runInContext(engineCode, ctx);

    if (!sandbox.window.BkrsDB) {
        throw new Error('Объект BkrsDB не был создан в песочнице');
    }

    return sandbox.window.BkrsDB;
}

// 2. Извлечение структурированных блоков выдачи
function extractBlocks(res) {
    if (!res || res.type === 'empty') {
        return { main: [], starting: [], sats: [], examples: [] };
    }

    // Режим синтаксического разбора предложения
    if (res.sentence && Array.isArray(res.sentence.words)) {
        return {
            main: res.sentence.words.map(w => w.word),
            starting: [],
            sats: [],
            examples: (res.sentence.examples || []).map(e => e.ch)
        };
    }

    // Русский запрос
    if (res.isCyrillic) {
        const main = [];
        if (res.dabruks && Array.isArray(res.dabruks)) {
            for (const d of res.dabruks) {
                if (Array.isArray(d.zhWords)) main.push(...d.zhWords);
            }
        }
        const starting = [];
        if (res.inZhWords && Array.isArray(res.inZhWords)) {
            starting.push(...res.inZhWords.map(w => w.word));
        }

        return {
            main: Array.from(new Set(main)),
            starting: Array.from(new Set(starting)),
            sats: res.satellites || [],
            examples: (res.examples || []).map(e => e.ch)
        };
    }

    // Китайский или пиньинь-запрос
    const main = [];
    const starting = [];
    if (res.dabkrs) {
        if (Array.isArray(res.dabkrs.exact)) {
            main.push(...res.dabkrs.exact.map(w => w.word));
        }
        if (Array.isArray(res.dabkrs.compounds)) {
            starting.push(...res.dabkrs.compounds.map(w => w.word));
        }
    }

    return {
        main: Array.from(new Set(main)),
        starting: Array.from(new Set(starting)),
        sats: res.satellites || [],
        examples: (res.examples || []).map(e => e.ch)
    };
}

// 3. Поблочное сравнение фактической выдачи с эталоном
function compareBlocks(actual, expected) {
    if (!expected || expected.verified !== true) {
        return {
            status: 'PENDING',
            details: 'Ожидает верификации эталона с bkrs.info'
        };
    }

    const expMain = expected.main || [];
    const actMain = actual.main || [];

    const extraMain = actMain.filter(w => !expMain.includes(w));
    const missingMain = expMain.filter(w => !actMain.includes(w));

    // Проверка порядка общих слов в main
    const commonExp = expMain.filter(w => actMain.includes(w));
    const commonAct = actMain.filter(w => expMain.includes(w));
    let isReorderedMain = false;
    for (let i = 0; i < commonExp.length; i++) {
        if (commonExp[i] !== commonAct[i]) {
            isReorderedMain = true;
            break;
        }
    }

    const mainMatched = extraMain.length === 0 && missingMain.length === 0 && !isReorderedMain;

    // Сравнение блока starting («начинающиеся / производные»)
    const expStarting = expected.starting || [];
    const actStarting = actual.starting || [];
    const startingDiff = actStarting.length - expStarting.length;

    let status = 'MATCH';
    if (!mainMatched) {
        status = 'MISMATCH';
    } else if (expStarting.length > 0 && actStarting.length === 0) {
        // Главная статья совпала, но производные слова полностью отсутствуют
        status = 'PARTIAL';
    }

    return {
        status,
        mainMatched,
        main: {
            actual: actMain,
            expected: expMain,
            extra: extraMain,
            missing: missingMain,
            isReordered: isReorderedMain
        },
        starting: {
            actualCount: actStarting.length,
            expectedCount: expStarting.length,
            diff: startingDiff
        }
    };
}

async function main() {
    const args = process.argv.slice(2);
    let singleQuery = null;
    let dumpActualPath = null;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--query' && args[i + 1]) {
            singleQuery = args[i + 1];
            i++;
        } else if (args[i] === '--dump-actual' && args[i + 1]) {
            dumpActualPath = args[i + 1];
            i++;
        } else if (!args[i].startsWith('--') && !singleQuery) {
            singleQuery = args[i];
        }
    }

    const BkrsDB = loadBkrsEngine();
    await Promise.all([
        BkrsDB.loadCoreWords ? BkrsDB.loadCoreWords() : Promise.resolve(),
        BkrsDB.loadSingleChars ? BkrsDB.loadSingleChars() : Promise.resolve(),
        BkrsDB.loadExamples ? BkrsDB.loadExamples() : Promise.resolve()
    ]);
    if (BkrsDB.buildPinyinIndex) BkrsDB.buildPinyinIndex();

    const queriesData = JSON.parse(fs.readFileSync(QUERIES_PATH, 'utf8'));
    const expectedData = JSON.parse(fs.readFileSync(EXPECTED_PATH, 'utf8'));

    const queriesToRun = singleQuery
        ? [{ id: 0, category: 'single', query: singleQuery, note: 'ручной запрос' }]
        : queriesData;

    const stats = { total: 0, match: 0, partial: 0, mismatch: 0, pending: 0 };
    const actualDump = {};

    console.log('=== ПОБЛОЧНАЯ СВЕРКА ПОИСКА БКРС С ЭТАЛОНОМ BKRS.INFO ===\n');

    for (const qItem of queriesToRun) {
        stats.total++;
        const q = qItem.query;
        const res = await BkrsDB.search(q);
        const actualBlocks = extractBlocks(res);

        actualDump[q] = actualBlocks;
        const comp = compareBlocks(actualBlocks, expectedData[q]);

        if (comp.status === 'MATCH') {
            stats.match++;
            console.log(`[PASS] "${q}" (${qItem.category}): полное совпадение блока [main: ${comp.main.actual.join(', ') || 'пусто'}]`);
        } else if (comp.status === 'PARTIAL') {
            stats.partial++;
            console.log(`[PARTIAL] "${q}" (${qItem.category}): блок [main] совпал (${comp.main.actual.join(', ')}), но [starting] отличается: факт ${comp.starting.actualCount} vs эталон ${comp.starting.expectedCount}`);
        } else if (comp.status === 'PENDING') {
            stats.pending++;
            console.log(`[PENDING] "${q}" (${qItem.category}): ожидает эталона`);
        } else {
            stats.mismatch++;
            console.log(`[FAIL] "${q}" (${qItem.category}): расхождение в блоке [main]!`);
            console.log(`       Факт [main]:    ${comp.main.actual.join(', ') || 'пусто'}`);
            console.log(`       Эталон [main]:  ${comp.main.expected.join(', ') || 'пусто'}`);
            if (comp.main.extra.length > 0) {
                console.log(`       Лишнее:         ${comp.main.extra.join(', ')}`);
            }
            if (comp.main.missing.length > 0) {
                console.log(`       Пропущенное:    ${comp.main.missing.join(', ')}`);
            }
            if (comp.main.isReordered) {
                console.log(`       Порядок слов отличается`);
            }
        }
    }

    console.log('\n----------------------------------------------');
    console.log(`ИТОГИ ПОБЛОЧНОЙ СВЕРКИ:`);
    console.log(`Всего запросов: ${stats.total}`);
    console.log(`Совпадений (MATCH): ${stats.match}`);
    console.log(`Частичных совпадений (PARTIAL): ${stats.partial}`);
    console.log(`Реальных расхождений (MISMATCH): ${stats.mismatch}`);
    console.log(`Ожидают заполнения (PENDING): ${stats.pending}`);
    console.log('----------------------------------------------\n');

    if (dumpActualPath) {
        const outPath = path.resolve(process.cwd(), dumpActualPath);
        fs.writeFileSync(outPath, JSON.stringify(actualDump, null, 2) + '\n', 'utf8');
        console.log(`Фактические результаты сохранены в: ${outPath}`);
    }
}

if (require.main === module) {
    main().catch(err => {
        console.error('Ошибка выполнения сверки:', err);
        process.exit(1);
    });
}

module.exports = {
    loadBkrsEngine,
    extractBlocks,
    compareBlocks
};
