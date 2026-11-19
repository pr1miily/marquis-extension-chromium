// =============================================================================
// MARQUIS — COMPUTE & CONVERSION ENGINE
// Drives the #calculator tab-pane in the Developer Toolkit.
// Depends on math.js (already loaded as scripts/math.min.js).
// =============================================================================

function initCalculator() {

    // ── Guard: only run when the calculator tab-pane exists ──────────────────
    if (!document.getElementById('calculator')) return;

    if (typeof math !== 'undefined') {
        math.config({ number: 'number', precision: 14 });
    }

    // ══════════════════════════════════════════════════════════════════════════
    // STATE
    // ══════════════════════════════════════════════════════════════════════════
    let currentEngine  = 'standard'; // 'standard' | 'programmer' | 'converter'
    let calcHistory    = [];          // [{eq, result}]
    let stdExpr        = '';          // Standard engine expression string
    let stdResult      = '0';
    let progValue      = 0;           // Programmer engine current integer value
    let progPending    = null;        // { op, a }: bitwise op waiting for its second operand (was a prompt())
    const PROG_OPS = { 'AND': (a,b)=>a&b, 'OR': (a,b)=>a|b, 'XOR': (a,b)=>a^b,
                       'LSH': (a,b)=>a<<b, 'RSH': (a,b)=>a>>b };
    let progBase       = 'DEC';       // 'HEX' | 'DEC' | 'OCT' | 'BIN'
    let historyVisible = false;
    let keyboardBound  = false;

    const HISTORY_KEY = 'marquis_calc_history';

    // ══════════════════════════════════════════════════════════════════════════
    // UNIT CONVERSION DATA
    // ══════════════════════════════════════════════════════════════════════════
    const UNIT_CATEGORIES = {
        Length: {
            units: ['Meter','Kilometer','Centimeter','Millimeter','Mile','Yard','Foot','Inch','Nautical Mile'],
            base: 'Meter',
            factors: { Meter:1, Kilometer:1e3, Centimeter:1e-2, Millimeter:1e-3,
                       Mile:1609.344, Yard:0.9144, Foot:0.3048, Inch:0.0254, 'Nautical Mile':1852 }
        },
        Weight: {
            units: ['Kilogram','Gram','Milligram','Pound','Ounce','Ton (Metric)','Stone','Carat'],
            base: 'Kilogram',
            factors: { Kilogram:1, Gram:1e-3, Milligram:1e-6, Pound:0.45359237,
                       Ounce:0.028349523, 'Ton (Metric)':1000, Stone:6.35029318, Carat:2e-4 }
        },
        Volume: {
            units: ['Liter','Milliliter','Cubic Meter','Gallon (US)','Quart (US)','Pint (US)','Cup (US)','Fluid Oz (US)','Tablespoon','Teaspoon'],
            base: 'Liter',
            factors: { Liter:1, Milliliter:1e-3, 'Cubic Meter':1000,
                       'Gallon (US)':3.785411784, 'Quart (US)':0.946352946,
                       'Pint (US)':0.473176473, 'Cup (US)':0.2365882365,
                       'Fluid Oz (US)':0.0295735296, Tablespoon:0.0147867648, Teaspoon:0.00492892159 }
        },
        Temperature: {
            units: ['Celsius','Fahrenheit','Kelvin'],
            base: null, // special — use conversion fns
            toBase: { Celsius: v=>v, Fahrenheit: v=>(v-32)*5/9, Kelvin: v=>v-273.15 },
            fromBase: { Celsius: v=>v, Fahrenheit: v=>v*9/5+32, Kelvin: v=>v+273.15 }
        },
        Speed: {
            units: ['m/s','km/h','mph','knot','ft/s','Mach'],
            base: 'm/s',
            factors: { 'm/s':1, 'km/h':1/3.6, 'mph':0.44704, 'knot':0.514444, 'ft/s':0.3048, 'Mach':340.29 }
        },
        Time: {
            units: ['Second','Minute','Hour','Day','Week','Month','Year','Millisecond','Microsecond','Nanosecond'],
            base: 'Second',
            factors: { Second:1, Minute:60, Hour:3600, Day:86400, Week:604800,
                       Month:2629800, Year:31557600, Millisecond:1e-3, Microsecond:1e-6, Nanosecond:1e-9 }
        },
        Energy: {
            units: ['Joule','Kilojoule','Calorie','Kilocalorie','Watt-hour','kWh','BTU','Electron Volt','Foot-Pound'],
            base: 'Joule',
            factors: { Joule:1, Kilojoule:1000, Calorie:4.184, Kilocalorie:4184,
                       'Watt-hour':3600, 'kWh':3.6e6, 'BTU':1055.06, 'Electron Volt':1.60218e-19, 'Foot-Pound':1.35582 }
        },
        Power: {
            units: ['Watt','Kilowatt','Megawatt','Horsepower','BTU/hour','Calorie/second'],
            base: 'Watt',
            factors: { Watt:1, Kilowatt:1000, Megawatt:1e6, Horsepower:745.7, 'BTU/hour':0.293071, 'Calorie/second':4.184 }
        },
        Pressure: {
            units: ['Pascal','Kilopascal','Megapascal','Bar','Atmosphere','PSI','mmHg','Torr'],
            base: 'Pascal',
            factors: { Pascal:1, Kilopascal:1000, Megapascal:1e6, Bar:1e5,
                       Atmosphere:101325, PSI:6894.757, mmHg:133.322, Torr:133.322 }
        },
        Data: {
            units: ['Bit','Byte','Kilobyte','Megabyte','Gigabyte','Terabyte','Petabyte','Kibibyte','Mebibyte','Gibibyte'],
            base: 'Byte',
            factors: { Bit:0.125, Byte:1, Kilobyte:1e3, Megabyte:1e6, Gigabyte:1e9,
                       Terabyte:1e12, Petabyte:1e15, Kibibyte:1024, Mebibyte:1048576, Gibibyte:1073741824 }
        },
        Angle: {
            units: ['Degree','Radian','Gradian','Turn','Arc Minute','Arc Second'],
            base: 'Degree',
            factors: { Degree:1, Radian:180/Math.PI, Gradian:0.9, Turn:360,
                       'Arc Minute':1/60, 'Arc Second':1/3600 }
        },
    };

    // ══════════════════════════════════════════════════════════════════════════
    // HISTORY PERSISTENCE
    // ══════════════════════════════════════════════════════════════════════════
    function loadHistory() {
        if (typeof chrome !== 'undefined' && chrome.storage) {
            chrome.storage.local.get([HISTORY_KEY], res => {
                calcHistory = res[HISTORY_KEY] || [];
                renderHistoryTape();
            });
        }
    }

    function saveHistory() {
        if (typeof chrome !== 'undefined' && chrome.storage) {
            chrome.storage.local.set({ [HISTORY_KEY]: calcHistory.slice(0, 100) });
        }
    }

    function pushHistory(eq, result) {
        calcHistory.unshift({ eq, result, ts: Date.now() });
        if (calcHistory.length > 100) calcHistory.pop();
        saveHistory();
        renderHistoryTape();
    }

    function renderHistoryTape() {
        const tape = document.getElementById('calcHistoryTape');
        if (!tape) return;
        if (!calcHistory.length) {
            tape.innerHTML = '<div class="text-center text-muted small py-3 fst-italic">No history yet.</div>';
            return;
        }
        tape.innerHTML = calcHistory.map((h, i) => `
            <div class="history-entry d-flex justify-content-between align-items-center px-3 py-2 border-bottom border-secondary-subtle"
                 style="cursor:pointer;" data-idx="${i}">
                <div>
                    <div class="text-muted small" style="font-size:var(--mq-fs-xs);">${MarquisHtml.esc(h.eq)}</div>
                    <div class="fw-bold text-body font-monospace">${MarquisHtml.esc(h.result)}</div>
                </div>
                <i class="bi bi-arrow-return-left text-secondary" style="font-size:var(--mq-fs-xs);"></i>
            </div>`).join('');

        tape.querySelectorAll('.history-entry').forEach(el => {
            el.addEventListener('click', () => {
                const h = calcHistory[parseInt(el.dataset.idx)];
                if (currentEngine === 'standard') {
                    stdExpr = h.result;
                    stdResult = h.result;
                    renderStandardDisplay();
                }
                toggleHistory(false);
            });
        });
    }

    function toggleHistory(forceState) {
        historyVisible = forceState !== undefined ? forceState : !historyVisible;
        const panel = document.getElementById('calcHistoryPanel');
        if (!panel) return;
        panel.classList.toggle('d-none', !historyVisible);
        // One History button per engine (standard, programmer); both show the shared panel's state.
        document.querySelectorAll('.calc-history-toggle').forEach(btn => {
            btn.classList.toggle('btn-primary', historyVisible);
            btn.classList.toggle('btn-outline-secondary', !historyVisible);
        });
    }

    // ══════════════════════════════════════════════════════════════════════════
    // ENGINE ROUTER
    // ══════════════════════════════════════════════════════════════════════════
    function switchEngine(engine) {
        currentEngine = engine;
        document.getElementById('stdEngine')?.classList.toggle('d-none', engine !== 'standard');
        document.getElementById('progEngine')?.classList.toggle('d-none', engine !== 'programmer');
        document.getElementById('convEngine')?.classList.toggle('d-none', engine !== 'converter');
        document.getElementById('dateEngine')?.classList.toggle('d-none', engine !== 'date');
        document.getElementById('mortgageEngine')?.classList.toggle('d-none', engine !== 'mortgage');
        document.getElementById('healthEngine')?.classList.toggle('d-none', engine !== 'health');
        document.getElementById('tipEngine')?.classList.toggle('d-none', engine !== 'tip');
        document.getElementById('percentEngine')?.classList.toggle('d-none', engine !== 'percentage');

        // Sync selector pill
        const sel = document.getElementById('calcEngineSelect');
        if (sel) sel.value = engine;

        if (engine === 'standard') {
            renderStandardDisplay();
            loadHistory();
        } else if (engine === 'programmer') {
            renderProgDisplays();
        } else if (engine === 'converter') {
            populateConverterUnits();
        } else if (engine === 'date') {
            if (!document.getElementById('dateStart').value) {
                const today = new Date().toISOString().split('T')[0];
                document.getElementById('dateStart').value = today;
                document.getElementById('dateEnd').value = today;
            }
            calculateDate();
        } else if (engine === 'mortgage') {
            calculateMortgage();
        }

        bindKeyboard();
    }

    // ══════════════════════════════════════════════════════════════════════════
    // ── STANDARD ENGINE ───────────────────────────────────────────────────────
    // ══════════════════════════════════════════════════════════════════════════
    function renderStandardDisplay() {
        const display = document.getElementById('stdDisplay');
        const expr    = document.getElementById('stdExprLine');
        if (!display || !expr) return;

        display.textContent = stdResult || '0';
        display.classList.toggle('text-danger', stdResult.startsWith('Error'));
        expr.textContent = stdExpr || '';

        // Shrink font for long numbers
        const len = (stdResult || '0').length;
        display.style.fontSize = len > 15 ? '1.2rem' : len > 10 ? '1.6rem' : '2.2rem';
    }

    function stdInput(val) {
        const ops  = ['+', '-', '*', '/'];
        const last = stdExpr.slice(-1);

        if (val === 'AC') { stdExpr = ''; stdResult = '0'; renderStandardDisplay(); return; }
        if (val === 'CE') {
            // Remove last token
            stdExpr = stdExpr.replace(/(\s*[\+\-\*\/]\s*)?[\d\.]+$/, '').trimEnd();
            if (!stdExpr) stdResult = '0';
            renderStandardDisplay(); return;
        }
        if (val === '=') { stdEvaluate(); return; }
        if (val === '±') {
            // Negate the last number
            stdExpr = stdExpr.replace(/([\d\.]+)$/, n => String(-parseFloat(n)));
            renderStandardDisplay(); return;
        }
        if (val === '%') {
            stdExpr = stdExpr.replace(/([\d\.]+)$/, n => String(parseFloat(n) / 100));
            renderStandardDisplay(); return;
        }
        if (val === '.' && /\d*\.\d*$/.test(stdExpr)) return; // no double dots
        if (ops.includes(val)) {
            if (!stdExpr) { stdExpr = stdResult !== '0' ? stdResult + val : ''; renderStandardDisplay(); return; }
            if (ops.includes(last)) { stdExpr = stdExpr.slice(0, -1) + val; renderStandardDisplay(); return; }
        }
        if (stdExpr === '0' && !ops.includes(val) && val !== '.') stdExpr = '';
        stdExpr += val;
        renderStandardDisplay();
    }

    function stdEvaluate() {
        if (!stdExpr) return;
        try {
            const expr = stdExpr.replace(/×/g, '*').replace(/÷/g, '/');
            const result = typeof math !== 'undefined'
                ? String(math.evaluate(expr))
                : String(Function('"use strict"; return (' + expr + ')')());

            if (!isFinite(Number(result))) throw new Error('Not finite');
            pushHistory(stdExpr + ' =', result);
            stdExpr   = '';
            stdResult = result;
        } catch (e) {
            stdResult = 'Error';
        }
        renderStandardDisplay();
    }

    // ══════════════════════════════════════════════════════════════════════════
    // ── PROGRAMMER ENGINE ─────────────────────────────────────────────────────
    // ══════════════════════════════════════════════════════════════════════════
    function renderProgDisplays() {
        const val = progValue;
        const setEl = (id, txt) => { const e = document.getElementById(id); if (e) e.textContent = txt; };

        setEl('progHex', (val >>> 0).toString(16).toUpperCase().padStart(8, '0'));
        setEl('progDec', val.toString(10));
        setEl('progOct', (val >>> 0).toString(8));
        setEl('progBin', (val >>> 0).toString(2).padStart(32, '0').replace(/(.{8})/g, '$1 ').trim());

        // Active base highlight
        ['HEX','DEC','OCT','BIN'].forEach(b => {
            const row = document.getElementById(`prog${b}Row`);
            if (row) {
                row.classList.toggle('bg-primary', b === progBase);
                row.classList.toggle('bg-opacity-10', b === progBase);
                row.classList.toggle('border-primary', b === progBase);
            }
        });

        // Show which bitwise op is waiting for its second operand
        Object.keys(PROG_OPS).forEach(op => {
            const btn = document.querySelector(`[data-prog="${op}"]`);
            if (btn) { btn.classList.toggle('active', progPending?.op === op); btn.setAttribute('aria-pressed', String(progPending?.op === op)); }
        });

        // Enable/disable hex letter keys
        ['A','B','C','D','E','F'].forEach(c => {
            const btn = document.getElementById(`progKey${c}`);
            if (btn) btn.disabled = progBase !== 'HEX';
        });

        // Enable/disable digit keys by base
        const maxDigit = progBase === 'BIN' ? 1 : progBase === 'OCT' ? 7 : 9;
        for (let d = 2; d <= 9; d++) {
            const btn = document.getElementById(`progKey${d}`);
            if (btn) btn.disabled = d > maxDigit;
        }
    }

    function progSetBase(base) {
        progBase = base;
        renderProgDisplays();
    }

    function progInput(val) {
        const radix = progBase === 'HEX' ? 16 : progBase === 'OCT' ? 8 : progBase === 'BIN' ? 2 : 10;

        if (val === 'AC') { progValue = 0; progPending = null; renderProgDisplays(); return; }
        if (val === 'DEL') {
            const s = progValue.toString(radix).slice(0, -1) || '0';
            progValue = parseInt(s, radix) || 0;
            renderProgDisplays(); return;
        }

        // Bitwise: like a regular calculator, the op keeps the first value; type the second, then = (or Enter).
        // A second op applies the pending one first, so 6 AND 3 OR 8 = chains.
        if (PROG_OPS[val]) {
            if (progPending) progApplyPending();
            progPending = { op: val, a: progValue };
            progValue = 0;
            renderProgDisplays(); return;
        }
        if (val === '=') {
            if (progPending) progApplyPending();
            renderProgDisplays(); return;
        }
        if (val === 'NOT') {
            progValue = ~progValue;
            renderProgDisplays(); return;
        }

        // Digit input
        const current = (progValue >>> 0).toString(radix);
        if (current === '0') {
            progValue = parseInt(val, radix) || 0;
        } else {
            progValue = parseInt(current + val, radix) || 0;
        }
        renderProgDisplays();
    }

    // ══════════════════════════════════════════════════════════════════════════
    // ── UNIT CONVERTER ENGINE ─────────────────────────════════════════════════
    // ══════════════════════════════════════════════════════════════════════════
    function populateConverterUnits() {
        const catSel  = document.getElementById('convCategory');
        const fromSel = document.getElementById('convFromUnit');
        const toSel   = document.getElementById('convToUnit');
        if (!catSel || !fromSel || !toSel) return;

        const cat = catSel.value || Object.keys(UNIT_CATEGORIES)[0];
        const { units } = UNIT_CATEGORIES[cat];

        const options = units.map(u => `<option value="${u}">${u}</option>`).join('');
        fromSel.innerHTML = options;
        toSel.innerHTML   = options;
        // Default 'to' to second unit
        if (units.length > 1) toSel.value = units[1];

        runConversion();
    }

    function runConversion() {
        const catSel   = document.getElementById('convCategory');
        const fromSel  = document.getElementById('convFromUnit');
        const toSel    = document.getElementById('convToUnit');
        const inputEl  = document.getElementById('convInput');
        const outputEl = document.getElementById('convOutput');
        const formulaEl= document.getElementById('convFormula');
        if (!catSel || !fromSel || !toSel || !inputEl || !outputEl) return;

        const cat  = UNIT_CATEGORIES[catSel.value];
        const raw  = parseFloat(inputEl.value);
        const from = fromSel.value;
        const to   = toSel.value;

        if (isNaN(raw)) { outputEl.value = ''; return; }

        let result;
        if (cat.base === null) {
            // Temperature: special path
            const inCelsius = cat.toBase[from](raw);
            result = cat.fromBase[to](inCelsius);
        } else {
            const inBase = raw * cat.factors[from];
            result = inBase / cat.factors[to];
        }

        // Format nicely
        const formatted = Math.abs(result) < 1e-6 || Math.abs(result) > 1e12
            ? result.toExponential(6)
            : parseFloat(result.toPrecision(10)).toString();

        outputEl.value = formatted;
        if (formulaEl) formulaEl.textContent = `${raw} ${from} = ${formatted} ${to}`;
    }

    function swapConvUnits() {
        const fromSel  = document.getElementById('convFromUnit');
        const toSel    = document.getElementById('convToUnit');
        const inputEl  = document.getElementById('convInput');
        const outputEl = document.getElementById('convOutput');
        if (!fromSel || !toSel) return;
        const tmpUnit = fromSel.value;
        fromSel.value = toSel.value;
        toSel.value   = tmpUnit;
        // swap values
        const tmpVal  = inputEl.value;
        inputEl.value = outputEl.value;
        runConversion();
    }

    // ══════════════════════════════════════════════════════════════════════════
    // ── NEW ENGINES (DATE, MORTGAGE, HEALTH) ──────────────────────────────────
    // ══════════════════════════════════════════════════════════════════════════

    function calculateDate() {
        const start = new Date(document.getElementById('dateStart').value);
        const end = new Date(document.getElementById('dateEnd').value);
        
        if (isNaN(start) || isNaN(end)) return;

        const diffTime = Math.abs(end - start);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
        
        document.getElementById('dateResultDays').innerText = `${diffDays} Days`;

        // Verbose calculation (Rough approximation for UI)
        const years = Math.floor(diffDays / 365.25);
        const months = Math.floor((diffDays % 365.25) / 30.44);
        const days = Math.floor((diffDays % 365.25) % 30.44);

        let verbose = [];
        if (years > 0) verbose.push(`${years} Year${years > 1 ? 's' : ''}`);
        if (months > 0) verbose.push(`${months} Month${months > 1 ? 's' : ''}`);
        if (days > 0 || verbose.length === 0) verbose.push(`${days} Day${days !== 1 ? 's' : ''}`);

        document.getElementById('dateResultVerbose').innerText = verbose.join(', ');
    }

    function calculateMortgage() {
        const principal = parseFloat(document.getElementById('mortPrincipal').value);
        const rate = parseFloat(document.getElementById('mortRate').value);
        const years = parseFloat(document.getElementById('mortYears').value);

        const monthlyEl = document.getElementById('mortMonthly');
        const interestEl = document.getElementById('mortInterest');

        if (isNaN(principal) || isNaN(rate) || isNaN(years) || principal <= 0) {
            monthlyEl.innerText = '$0.00';
            interestEl.innerText = '$0.00';
            return;
        }

        const monthlyRate = (rate / 100) / 12;
        const totalPayments = years * 12;

        let monthlyPayment = 0;
        if (monthlyRate === 0) {
            monthlyPayment = principal / totalPayments;
        } else {
            // M = P * (r(1+r)^n) / ((1+r)^n - 1)
            const mathPower = Math.pow(1 + monthlyRate, totalPayments);
            monthlyPayment = principal * ((monthlyRate * mathPower) / (mathPower - 1));
        }

        const totalPaid = monthlyPayment * totalPayments;
        const totalInterest = totalPaid - principal;

        monthlyEl.innerText = '$' + monthlyPayment.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
        interestEl.innerText = '$' + totalInterest.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
    }

    function calculateHealth() {
        const isMetric = document.getElementById('healthMetric').checked;
        const height = parseFloat(document.getElementById('healthHeight').value);
        const weight = parseFloat(document.getElementById('healthWeight').value);

        const resEl = document.getElementById('healthBmiResult');
        const catEl = document.getElementById('healthBmiCategory');

        if (isNaN(height) || isNaN(weight) || height <= 0 || weight <= 0) {
            resEl.innerText = '--';
            catEl.className = 'badge bg-secondary rounded-pill px-3 py-1';
            catEl.innerText = 'Enter details';
            return;
        }

        let bmi = 0;
        if (isMetric) {
            // BMI = kg / (m^2)
            const heightM = height / 100;
            bmi = weight / (heightM * heightM);
        } else {
            // BMI = 703 * (lbs / in^2)
            bmi = 703 * (weight / (height * height));
        }

        resEl.innerText = bmi.toFixed(1);

        // Classify
        catEl.className = 'badge rounded-pill px-3 py-1 ';
        if (bmi < 18.5) {
            catEl.classList.add('bg-info');
            catEl.innerText = 'Underweight';
        } else if (bmi >= 18.5 && bmi <= 24.9) {
            catEl.classList.add('bg-success');
            catEl.innerText = 'Normal weight';
        } else if (bmi >= 25 && bmi <= 29.9) {
            catEl.classList.add('bg-warning', 'text-dark');
            catEl.innerText = 'Overweight';
        } else {
            catEl.classList.add('bg-danger');
            catEl.innerText = 'Obese';
        }
    }

    function calculateTip() {
        const bill = parseFloat(document.getElementById('tipBill').value) || 0;
        const tipPct = parseFloat(document.getElementById('tipPercent').value) || 0;
        const split = parseInt(document.getElementById('tipSplit').value) || 1;

        document.getElementById('tipPercentBadge').innerText = `${tipPct}%`;

        const tipAmount = bill * (tipPct / 100);
        const totalBill = bill + tipAmount;
        const perPerson = totalBill / Math.max(1, split);

        const formatOptions = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
        document.getElementById('tipTotalTip').innerText = '$' + tipAmount.toLocaleString(undefined, formatOptions);
        document.getElementById('tipTotalBill').innerText = '$' + totalBill.toLocaleString(undefined, formatOptions);
        document.getElementById('tipTotalPerPerson').innerText = '$' + perPerson.toLocaleString(undefined, formatOptions);
    }

    function calculatePercentage() {
        // Mode 1: X% of Y
        const p1X = parseFloat(document.getElementById('pct1X').value);
        const p1Y = parseFloat(document.getElementById('pct1Y').value);
        const res1 = document.getElementById('pct1Result');
        res1.innerText = (!isNaN(p1X) && !isNaN(p1Y)) ? ((p1X / 100) * p1Y).toLocaleString(undefined, {maximumFractionDigits: 4}) : '0';

        // Mode 2: X is what % of Y
        const p2X = parseFloat(document.getElementById('pct2X').value);
        const p2Y = parseFloat(document.getElementById('pct2Y').value);
        const res2 = document.getElementById('pct2Result');
        res2.innerText = (!isNaN(p2X) && !isNaN(p2Y) && p2Y !== 0) ? ((p2X / p2Y) * 100).toLocaleString(undefined, {maximumFractionDigits: 2}) + '%' : '0%';

        // Mode 3: % Change
        const p3X = parseFloat(document.getElementById('pct3X').value);
        const p3Y = parseFloat(document.getElementById('pct3Y').value);
        const res3 = document.getElementById('pct3Result');
        if (!isNaN(p3X) && !isNaN(p3Y) && p3X !== 0) {
            const change = ((p3Y - p3X) / p3X) * 100;
            res3.innerText = (change > 0 ? '+' : '') + change.toLocaleString(undefined, {maximumFractionDigits: 2}) + '%';
            res3.className = `text-end fw-bolder fs-5 font-monospace ${change > 0 ? 'text-success' : change < 0 ? 'text-danger' : 'text-primary'}`;
        } else {
            res3.innerText = '0%';
            res3.className = 'text-end fw-bolder fs-5 font-monospace text-primary';
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // KEYBOARD BINDINGS
    // ══════════════════════════════════════════════════════════════════════════
    function bindKeyboard() {
        if (keyboardBound) return;
        keyboardBound = true;

        document.addEventListener('keydown', e => {
            // Only fire when the calculator tab-pane is visible
            const pane = document.getElementById('calculator');
            if (!pane || !pane.classList.contains('active')) return;
            // Don't steal from inputs that belong to other sections
            const tag = document.activeElement?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
                if (!document.activeElement.closest('#calculator')) return;
            }

            if (currentEngine === 'standard') {
                handleStdKey(e);
            } else if (currentEngine === 'programmer') {
                handleProgKey(e);
            }
        });
    }

    function handleStdKey(e) {
        const k = e.key;
        if (/^[0-9]$/.test(k))          { stdInput(k); return; }
        if (k === '.')                   { stdInput('.'); return; }
        if (k === '+')                   { stdInput('+'); return; }
        if (k === '-')                   { stdInput('-'); return; }
        if (k === '*')                   { stdInput('*'); return; }
        if (k === '/')                   { e.preventDefault(); stdInput('/'); return; }
        if (k === 'Enter' || k === '=')  { stdInput('='); return; }
        if (k === 'Backspace')           { stdInput('CE'); return; }
        if (k === 'Escape')              { stdInput('AC'); return; }
        if (k === 'c' || k === 'C') {
            if (e.shiftKey) stdInput('AC'); else stdInput('CE');
        }
    }

    function progApplyPending() {
        const { op, a } = progPending;
        const result = PROG_OPS[op](a, progValue);
        pushHistory(`${a} ${op} ${progValue}`, result);
        progValue = result;
        progPending = null;
    }

    function handleProgKey(e) {
        const k = e.key.toUpperCase();
        if (e.key === 'Enter' || e.key === '=') { progInput('='); return; }
        if (progBase === 'HEX' && /^[A-F]$/.test(k)) { progInput(k); return; }
        if (/^[0-9]$/.test(e.key))  { progInput(e.key); return; }
        if (e.key === 'Backspace')   { progInput('DEL'); return; }
        if (e.key === 'Escape')      { progInput('AC'); return; }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // DOM BOOTSTRAP — wire up events after the HTML renders
    // ══════════════════════════════════════════════════════════════════════════
    function init() {
        // Engine selector
        const sel = document.getElementById('calcEngineSelect');
        sel?.addEventListener('change', e => switchEngine(e.target.value));

        // History toggle
        document.querySelectorAll('.calc-history-toggle')
            .forEach(btn => btn.addEventListener('click', () => toggleHistory()));

        // History clear
        document.getElementById('calcHistoryClear')
            ?.addEventListener('click', () => {
                calcHistory = [];
                saveHistory();
                renderHistoryTape();
            });

        // Dropdown
        document.getElementById('calcEngineSelect')?.addEventListener('change', function(e) {
            const icon = document.getElementById('calcEngineIcon');
            if (!icon) return;
        
            icon.classList.remove('bi-calculator', 'bi-pc-display-horizontal', 'bi-arrow-left-right', 'bi-calendar-date', 'bi-house-heart', 'bi-heart-pulse', 'bi-receipt', 'bi-percent');
        
            if (e.target.value === 'standard') icon.classList.add('bi-calculator');
            else if (e.target.value === 'programmer') icon.classList.add('bi-pc-display-horizontal');
            else if (e.target.value === 'converter') icon.classList.add('bi-arrow-left-right');
            else if (e.target.value === 'date') icon.classList.add('bi-calendar-date');
            else if (e.target.value === 'mortgage') icon.classList.add('bi-house-heart');
            else if (e.target.value === 'health') icon.classList.add('bi-heart-pulse');
            else if (e.target.value === 'tip') icon.classList.add('bi-receipt');
            else if (e.target.value === 'percentage') icon.classList.add('bi-percent');
        });

        // ── NEW ENGINES events ────────────────────────────────────────────────
        document.getElementById('dateStart')?.addEventListener('input', calculateDate);
        document.getElementById('dateEnd')?.addEventListener('input', calculateDate);

        ['mortPrincipal', 'mortRate', 'mortYears'].forEach(id => {
            document.getElementById(id)?.addEventListener('input', calculateMortgage);
        });

        ['healthHeight', 'healthWeight'].forEach(id => {
            document.getElementById(id)?.addEventListener('input', calculateHealth);
        });

        document.getElementsByName('healthUnit').forEach(radio => {
            radio.addEventListener('change', (e) => {
                const isMetric = e.target.value === 'metric';
                document.getElementById('healthHeightLabel').innerText = isMetric ? 'Height (cm)' : 'Height (in)';
                document.getElementById('healthWeightLabel').innerText = isMetric ? 'Weight (kg)' : 'Weight (lbs)';
                calculateHealth();
            });
        });

        ['tipBill', 'tipPercent', 'tipSplit'].forEach(id => {
            document.getElementById(id)?.addEventListener('input', calculateTip);
        });

        ['pct1X', 'pct1Y', 'pct2X', 'pct2Y', 'pct3X', 'pct3Y'].forEach(id => {
            document.getElementById(id)?.addEventListener('input', calculatePercentage);
        });

        // ── STANDARD buttons ──────────────────────────────────────────────────
        document.querySelectorAll('[data-std]').forEach(btn => {
            btn.addEventListener('click', () => stdInput(btn.dataset.std));
        });

        // ── PROGRAMMER buttons ────────────────────────────────────────────────
        document.querySelectorAll('[data-prog]').forEach(btn => {
            btn.addEventListener('click', () => progInput(btn.dataset.prog));
        });
        document.querySelectorAll('[data-base]').forEach(btn => {
            btn.addEventListener('click', () => progSetBase(btn.dataset.base));
        });

        // ── CONVERTER events ──────────────────────────────────────────────────
        document.getElementById('convCategory')
            ?.addEventListener('change', populateConverterUnits);
        document.getElementById('convFromUnit')
            ?.addEventListener('change', runConversion);
        document.getElementById('convToUnit')
            ?.addEventListener('change', runConversion);
        document.getElementById('convInput')
            ?.addEventListener('input', runConversion);
        document.getElementById('convSwap')
            ?.addEventListener('click', swapConvUnits);

        // Boot: default to Standard, load history
        loadHistory();
        switchEngine('standard');
    }

    // ── Wait for the tab-pane to be in DOM (it always is for Marquis.html) ───
    init();
}

// ─── Lazy-load entry point ────────────────────────────────────────────────────
document.addEventListener('marquis:sectionReady', (e) => {
    if (e.detail.sectionId === 'toolkitSection') initCalculator();
});

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('calculator')) initCalculator();
});