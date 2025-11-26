// --- CONFIGURATION ---
const REPO_BASE = window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1);

// Board Physics (1 unit = 1 inch)
const BOARD_WIDTH_INCHES = 46;  // Col 1 to 46
const BOARD_HEIGHT_INCHES = 64; // Row 1 to 64

// --- GLOBAL VARIABLES ---
let PPI = 0; // Pixels Per Inch (Calculated dynamically)
let fileIndex = [];
let pogData = [];
let storeMap = [];
let currentStore = null;
let currentPOG = null;
let currentBay = 1;
let allBays = [];
let html5QrCode = null;
let completedItems = new Set(JSON.parse(localStorage.getItem('harpa_complete') || "[]"));

// --- INIT ---
document.addEventListener('DOMContentLoaded', () => {
    init();
    setupSwipe();
});

async function init() {
    try {
        await loadCSVData();
        document.getElementById('loading-overlay').classList.add('hidden');
        
        const savedStore = localStorage.getItem('harpa_store');
        if (savedStore) {
            loadStoreLogic(savedStore);
        } else {
            document.getElementById('store-modal').classList.remove('hidden');
        }
    } catch (e) {
        console.error("Data Load Error:", e);
        document.getElementById('loading-overlay').innerHTML = `
            <div class="modal-card">
                <h3>⚠️ Data Load Error</h3>
                <p style="color:#666; margin:10px 0;">${e.message}</p>
                <p style="font-size:0.8rem;">Check that CSV files exist in the repo.</p>
            </div>
        `;
    }

    // Event Bindings
    document.getElementById('btn-load-store').onclick = () => 
        loadStoreLogic(document.getElementById('store-input').value.trim());
    
    document.getElementById('store-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') loadStoreLogic(document.getElementById('store-input').value.trim());
    });
    
    document.getElementById('btn-scan-toggle').onclick = startScanner;
    
    document.getElementById('btn-manual-search').onclick = () => 
        handleSearchOrScan(document.getElementById('search-input').value.trim());
    
    document.getElementById('search-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSearchOrScan(document.getElementById('search-input').value.trim());
    });
}

// --- DATA LOADING ---
async function loadCSVData() {
    const ts = Date.now();
    
    const [filesResp, pogsResp, mapsResp] = await Promise.all([
        fetch(`githubfiles.csv?t=${ts}`),
        fetch(`allplanogramdata.csv?t=${ts}`),
        fetch(`Store_POG_Mapping.csv?t=${ts}`)
    ]);
    
    if (!filesResp.ok) throw new Error("githubfiles.csv not found");
    if (!pogsResp.ok) throw new Error("allplanogramdata.csv not found");
    if (!mapsResp.ok) throw new Error("Store_POG_Mapping.csv not found");

    const [files, pogs, maps] = await Promise.all([
        filesResp.text(),
        pogsResp.text(),
        mapsResp.text()
    ]);

    fileIndex = files.split('\n').map(l => l.trim()).filter(l => l);
    pogData = parseCSV(pogs).map(i => ({...i, CleanUPC: normalizeUPC(i.UPC)}));
    storeMap = parseCSV(maps);
    
    console.log(`Loaded: ${fileIndex.length} files, ${pogData.length} products, ${storeMap.length} store mappings`);
}

function parseCSV(text) {
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length === 0) return [];
    
    const headers = parseCSVLine(lines[0]);
    const res = [];
    
    for (let i = 1; i < lines.length; i++) {
        const row = parseCSVLine(lines[i]);
        if (row.length < headers.length) continue;
        
        let obj = {};
        headers.forEach((h, j) => obj[h] = row[j] || "");
        res.push(obj);
    }
    return res;
}

// Handle quoted CSV fields properly
function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current.trim());
    return result;
}

// --- STORE LOGIC ---
function loadStoreLogic(storeNum) {
    if (!storeNum) return;
    
    const map = storeMap.find(s => s.Store === storeNum);
    if (!map) {
        document.getElementById('error-msg').classList.remove('hidden');
        setTimeout(() => document.getElementById('error-msg').classList.add('hidden'), 3000);
        return;
    }
    
    currentStore = storeNum;
    currentPOG = map.POG;
    localStorage.setItem('harpa_store', storeNum);

    // Update UI
    document.getElementById('store-modal').classList.add('hidden');
    document.getElementById('store-display').innerText = `Store: ${storeNum}`;
    document.getElementById('pog-display').innerText = `POG: ${currentPOG}`;

    // Find Bays
    const items = pogData.filter(i => i.POG === currentPOG);
    allBays = [...new Set(items.map(i => parseInt(i.Bay)))].filter(b => !isNaN(b)).sort((a, b) => a - b);
    
    if (allBays.length > 0) {
        loadBay(allBays[0]);
    } else {
        document.getElementById('grid-container').innerHTML = '<div class="empty-state">No items found for this Planogram.</div>';
    }
}

function resetStore() {
    localStorage.removeItem('harpa_store');
    location.reload();
}

// --- BAY LOGIC ---
function changeBay(dir) {
    const idx = allBays.indexOf(currentBay);
    if (idx === -1) return;
    
    let newIdx = idx + dir;
    newIdx = Math.max(0, Math.min(newIdx, allBays.length - 1));
    
    if (allBays[newIdx] !== currentBay) {
        loadBay(allBays[newIdx]);
    }
}

function loadBay(bayNum) {
    currentBay = bayNum;
    const bayIndex = allBays.indexOf(bayNum) + 1;
    document.getElementById('bay-indicator').innerText = `Bay ${bayIndex} of ${allBays.length}`;
    renderGrid(bayNum);
}

// --- PHYSICS & RENDERING ---
function renderGrid(bayNum) {
    const container = document.getElementById('grid-container');
    container.innerHTML = '';

    // 1. Calculate PPI (Pixels Per Inch) to Fit Screen
    const screenWidth = document.getElementById('main-canvas').clientWidth;
    PPI = (screenWidth - 20) / BOARD_WIDTH_INCHES;

    // 2. Set Board Dimensions (FIX: was BOARD_H_HOLES, now BOARD_HEIGHT_INCHES)
    const pxWidth = BOARD_WIDTH_INCHES * PPI;
    const pxHeight = BOARD_HEIGHT_INCHES * PPI;

    container.style.width = `${pxWidth}px`;
    container.style.height = `${pxHeight}px`;
    
    // Visual Grid Dots: 1 inch spacing = PPI
    container.style.backgroundSize = `${PPI}px ${PPI}px`;
    container.style.backgroundImage = `radial-gradient(#333 15%, transparent 16%)`;

    // 3. Place Items
    const items = pogData.filter(i => i.POG === currentPOG && parseInt(i.Bay) === bayNum);
    let doneCount = 0;

    items.forEach(item => {
        const { r, c } = getCoords(item.Peg);
        
        // Parse Dimensions (remove " in" suffix)
        const h = parseFloat((item.Height || "6").replace(/\s*in/i, '')) || 6;
        const w = parseFloat((item.Width || "3").replace(/\s*in/i, '')) || 3;

        // --- FROG LOGIC ---
        // Hole (c, r) is the Left Leg.
        // Hole Center X = (c - 1) * PPI + (PPI/2)
        // Hole Center Y = (r - 1) * PPI + (PPI/2)
        const holeLeftX = ((c - 1) * PPI) + (PPI / 2);
        const holeY = ((r - 1) * PPI) + (PPI / 2);

        // Visual Red Dot (Frog Left Leg)
        const dot = document.createElement('div');
        dot.className = 'frog-dot';
        dot.style.left = `${holeLeftX}px`;
        dot.style.top = `${holeY}px`;
        container.appendChild(dot);

        // Frog spans C and C+1. Center is +0.5 inch from Left Leg.
        const frogCenterX = holeLeftX + (PPI / 2);
        
        // Product is centered horizontally on Frog Center
        const boxLeft = frogCenterX - ((w * PPI) / 2);
        
        // Product hangs DOWN from the hole row
        const boxTop = holeY + (PPI * 0.5);

        // Render Box
        const box = document.createElement('div');
        box.className = 'product-box';
        box.style.width = `${w * PPI}px`;
        box.style.height = `${h * PPI}px`;
        box.style.left = `${boxLeft}px`;
        box.style.top = `${boxTop}px`;
        box.dataset.upc = item.CleanUPC;

        if (completedItems.has(item.CleanUPC)) {
            box.classList.add('completed');
            doneCount++;
        }

        // Find image in file index that starts with UPC
        const imgFile = fileIndex.find(f => f.startsWith(item.UPC) && /\.(jpg|jpeg|png|gif|webp)$/i.test(f));
        if (imgFile) {
            const img = document.createElement('img');
            img.src = imgFile;
            img.alt = item.UPC;
            img.onerror = () => {
                box.innerHTML = `<span style="font-size:8px; text-align:center; padding:2px;">${item.UPC}</span>`;
            };
            box.appendChild(img);
        } else {
            box.innerHTML = `<span style="font-size:8px; text-align:center; padding:2px;">${item.UPC}</span>`;
        }

        box.onclick = () => toggleComplete(item.CleanUPC, box);
        container.appendChild(box);
    });

    // Update Progress
    updateProgress(items, doneCount);
}

function updateProgress(items, doneCount) {
    const total = items.length;
    const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;
    document.getElementById('progress-fill').style.width = `${pct}%`;
    document.getElementById('progress-count').innerText = `${doneCount}/${total}`;
}

// Helper: Convert "R02 C03" to integers
function getCoords(pegStr) {
    if (!pegStr) return { r: 1, c: 1 };
    const m = pegStr.match(/R(\d+)\s*C(\d+)/i);
    if (m) return { r: parseInt(m[1]), c: parseInt(m[2]) };
    return { r: 1, c: 1 };
}

// --- UPC LOGIC ---
function normalizeUPC(upc) {
    if (!upc) return "";
    // Remove leading zeros for matching
    return upc.toString().trim().replace(/^0+/, '');
}

function toggleComplete(upc, el) {
    if (completedItems.has(upc)) {
        completedItems.delete(upc);
        el.classList.remove('completed');
    } else {
        completedItems.add(upc);
        el.classList.add('completed');
    }
    localStorage.setItem('harpa_complete', JSON.stringify([...completedItems]));
    
    // Update progress
    const items = pogData.filter(i => i.POG === currentPOG && parseInt(i.Bay) === currentBay);
    const done = items.filter(i => completedItems.has(i.CleanUPC)).length;
    updateProgress(items, done);
}

// --- SCANNER & SEARCH ---
function startScanner() {
    const modal = document.getElementById('scanner-modal');
    modal.classList.remove('hidden');
    
    html5QrCode = new Html5Qrcode("reader");
    html5QrCode.start(
        { facingMode: "environment" }, 
        { fps: 10, qrbox: 250 },
        (decodedText) => {
            handleSearchOrScan(decodedText);
        },
        (err) => { /* Ignore scan errors */ }
    ).catch(e => {
        alert("Camera Error: " + e);
        stopScanner();
    });
}

function stopScanner() {
    if (html5QrCode) {
        html5QrCode.stop().then(() => {
            document.getElementById('scanner-modal').classList.add('hidden');
            html5QrCode.clear();
            html5QrCode = null;
        }).catch(() => {
            document.getElementById('scanner-modal').classList.add('hidden');
        });
    } else {
        document.getElementById('scanner-modal').classList.add('hidden');
    }
}

function handleSearchOrScan(input) {
    if (!input) return;
    
    const clean = normalizeUPC(input);
    
    // Display for debugging
    document.getElementById('scan-result').innerText = `${input} → ${clean}`;

    // Search GLOBALLY (All Bays in current POG)
    const match = pogData.find(i => i.POG === currentPOG && i.CleanUPC === clean);
    
    if (!match) {
        document.getElementById('scan-result').innerText = `${input} → NOT FOUND`;
        return;
    }

    // Check if we need to change bays
    const itemBay = parseInt(match.Bay);
    if (itemBay !== currentBay) {
        loadBay(itemBay);
        setTimeout(() => highlightItem(clean), 400);
    } else {
        highlightItem(clean);
    }
}

function highlightItem(upc) {
    const box = document.querySelector(`.product-box[data-upc="${upc}"]`);
    if (box) {
        box.scrollIntoView({ behavior: "smooth", block: "center" });
        box.classList.add('highlight');
        
        // Auto-mark complete when scanning
        if (!box.classList.contains('completed')) {
            toggleComplete(upc, box);
        }
        
        setTimeout(() => box.classList.remove('highlight'), 1500);
    }
}

// --- SWIPE NAVIGATION ---
function setupSwipe() {
    let xDown = null;
    const canvas = document.getElementById('main-canvas');
    
    canvas.addEventListener('touchstart', (evt) => {
        xDown = evt.touches[0].clientX;
    }, { passive: true });

    canvas.addEventListener('touchend', (evt) => {
        if (!xDown) return;
        
        const xUp = evt.changedTouches[0].clientX;
        const xDiff = xDown - xUp;
        
        if (Math.abs(xDiff) > 50) {
            if (xDiff > 0) changeBay(1);  // Left swipe -> Next
            else changeBay(-1);            // Right swipe -> Prev
        }
        xDown = null;
    }, { passive: true });
}

// --- PDF VIEWER ---
function openPDF() {
    if (!currentPOG) {
        alert("Select a store first");
        return;
    }
    
    const pdf = fileIndex.find(f => f.includes(currentPOG) && f.toLowerCase().endsWith('.pdf'));
    if (pdf) {
        document.getElementById('pdf-frame').src = pdf;
        document.getElementById('pdf-modal').classList.remove('hidden');
    } else {
        alert("PDF not found for this planogram.");
    }
}

function closePDF() {
    document.getElementById('pdf-modal').classList.add('hidden');
    document.getElementById('pdf-frame').src = "";
}

// --- UTILITY ---
function clearAllProgress() {
    if (confirm("Clear ALL progress for this planogram?")) {
        completedItems.clear();
        localStorage.removeItem('harpa_complete');
        loadBay(currentBay);
    }
}
