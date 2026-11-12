/**
 * Скрипт сверки поиска БКРС с эталоном bkrs.info.
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
const DATA_BKRS_DIR = path.join(ROOT_DIR, 'data/bkrs');

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

    // Кэш для файлов JSON, чтобы не читать с диска повторно
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
        console: {
            log: () => {},
            warn: () => {},
            error: () => {}
        },
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

// 2. Извлечение заголовков слов (headwords) из результата поиска
function extractHeadwords(res) {
    if (!res || res.type === 'empty') {
        return [];
    }

    // Режим предложения / синтаксического разбора
    if (res.sentence && Array.isArray(res.sentence.words)) {
        return res.sentence.words.map(w => w.word);
    }

    // Русский запрос (БРуКС + БКРС)
    if (res.isCyrillic) {
        const words = [];
        if (res.dabruks && Array.isArray(res.dabruks)) {
            for (const d of res.dabruks) {
                if (Array.isArray(d.zhWords)) {
                    words.push(...d.zhWords);
                }
            }
        }
        if (res.inZhWords && Array.isArray(res.inZhWords)) {
            words.push(...res.inZhWords.map(w => w.word));
        }
        if (words.length === 0 && res.dabkrs && Array.isArray(res.dabkrs.exact)) {
            words.push(...res.dabkrs.exact.map(w => w.word));
        }
        return Array.from(new Set(words));
    }

    // Китайский или пиньинь-запрос
    const words = [];
    if (res.dabkrs) {
        if (Array.isArray(res.dabkrs.exact)) {
            words.push(...res.dabkrs.exact.map(w => w.word));
        }
        if (Array.isArray(res.dabkrs.compounds)) {
            words.push(...res.dabkrs.compounds.map(w => w.word));
        }
    }
    return Array.from(new Set(words));
}

// 3. Сравнение фактической выдачи с эталоном
function compareResults(actualHeadwords, expectedEntry) {
    if (!expectedEntry || (expectedEntry.count === 0 && (!expectedEntry.headwords || expectedEntry.headwords.length === 0))) {
        return {
            status: 'PENDING',
            extra: [],
            missing: [],
            reordered: [],
            countDiff: 0,
            actualCount: actualHeadwords.length,
            expectedCount: 0
        };
    }

    const expWords = expectedEntry.headwords || [];
    const expCount = typeof expectedEntry.count === 'number' ? expectedEntry.count : expWords.length;
    const actCount = actualHeadwords.length;

    const extra = actualHeadwords.filter(w => !expWords.includes(w));
    const missing = expWords.filter(w => !actualHeadwords.includes(w));

    // Проверка порядка общих элементов
    const commonInExpected = expWords.filter(w => actualHeadwords.includes(w));
    const commonInActual = actualHeadwords.filter(w => expWords.includes(w));

    let isReordered = false;
    const reordered = [];
    for (let i = 0; i < commonInExpected.length; i++) {
        if (commonInExpected[i] !== commonInActual[i]) {
            isReordered = true;
            reordered.push({
                word: commonInActual[i],
                actualIndex: i,
                expectedIndex: commonInExpected.indexOf(commonInActual[i])
            });
        }
    }

    const countDiff = actCount - expCount;
    const isMatch = extra.length === 0 && missing.length === 0 && !isReordered && countDiff === 0;

    return {
        status: isMatch ? 'MATCH' : 'MISMATCH',
        extra,
        missing,
        reordered,
        countDiff,
        actualCount: actCount,
        expectedCount: expCount
    };
}

// 4. Главная функция
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

    console.log('Инициализация базы данных и поискового движка БКРС...');
    const BkrsDB = loadBkrsEngine();

    // Предзагрузка основных словарей
    await Promise.all([
        BkrsDB.loadCoreWords ? BkrsDB.loadCoreWords() : Promise.resolve(),
        BkrsDB.loadSingleChars ? BkrsDB.loadSingleChars() : Promise.resolve(),
        BkrsDB.loadExamples ? BkrsDB.loadExamples() : Promise.resolve()
    ]);
    if (BkrsDB.buildPinyinIndex) BkrsDB.buildPinyinIndex();

    console.log('Движок готов к работе.\n');

    const queriesData = JSON.parse(fs.readFileSync(QUERIES_PATH, 'utf8'));
    const expectedData = JSON.parse(fs.readFileSync(EXPECTED_PATH, 'utf8'));

    const queriesToRun = singleQuery
        ? [{ id: 0, category: 'single', query: singleQuery, note: 'ручной запрос' }]
        : queriesData;

    const actualDump = {};
    const stats = {
        total: 0,
        match: 0,
        mismatch: 0,
        pending: 0
    };

    console.log('=== СВЕРКА ПОИСКА БКРС С ЭТАЛОНОМ BKRS.INFO ===\n');

    for (const qItem of queriesToRun) {
        stats.total++;
        const q = qItem.query;
        const res = await BkrsDB.search(q);
        const actualHeadwords = extractHeadwords(res);

        actualDump[q] = {
            count: actualHeadwords.length,
            headwords: actualHeadwords
        };

        const expectedEntry = expectedData[q] || null;
        const comp = compareResults(actualHeadwords, expectedEntry);

        if (comp.status === 'MATCH') {
            stats.match++;
            console.log(`[PASS] "${q}" (${qItem.category}): полное совпадение (${comp.actualCount} слов)`);
        } else if (comp.status === 'PENDING') {
            stats.pending++;
            const preview = actualHeadwords.slice(0, 5).join(', ') + (actualHeadwords.length > 5 ? '...' : '');
            console.log(`[PENDING] "${q}" (${qItem.category}): ожидается эталон bkrs.info · Найдено у нас: ${comp.actualCount} [${preview}]`);
        } else {
            stats.mismatch++;
            console.log(`[FAIL] "${q}" (${qItem.category}): расхождение с эталоном!`);
            console.log(`       Количество: факт ${comp.actualCount} vs эталон ${comp.expectedCount} (разница: ${comp.countDiff >= 0 ? '+' : ''}${comp.countDiff})`);
            if (comp.extra.length > 0) {
                console.log(`       Лишнее (${comp.extra.length}):`, comp.extra.slice(0, 10).join(', ') + (comp.extra.length > 10 ? '...' : ''));
            }
            if (comp.missing.length > 0) {
                console.log(`       Пропущенное (${comp.missing.length}):`, comp.missing.slice(0, 10).join(', ') + (comp.missing.length > 10 ? '...' : ''));
            }
            if (comp.reordered.length > 0) {
                console.log(`       Другой порядок (${comp.reordered.length} позиций)`);
            }
        }
    }

    console.log('\n----------------------------------------------');
    console.log(`ИТОГИ СВЕРКИ:`);
    console.log(`Всего запросов: ${stats.total}`);
    console.log(`Совпадений (MATCH): ${stats.match}`);
    console.log(`Расхождений (MISMATCH): ${stats.mismatch}`);
    console.log(`Ожидают заполнения человеком (PENDING): ${stats.pending}`);
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
    extractHeadwords,
    compareResults
};
