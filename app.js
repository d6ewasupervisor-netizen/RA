// CONFIGURATION
const REPO_BASE = window.location.href.substring(0, window.location.href.lastIndexOf('/')) + "/";
const SCALE = 14; // Pixels per inch (Matches CSS background-size)
const BOARD_W_HOLES = 48; // 4ft section standard
const BOARD_H_HOLES = 72; // 6ft high standard (Adjusts dynamically)

// GLOBAL STATE
let fileIndex = [];
let pogData = [];
let storeMap = [];
let currentStore = null;
let currentPOG = null;
let currentBay = null;
let html5QrCode = null;
let completedItems = new Set(JSON.parse(localStorage.getItem('harpa_complete') || "[]"));

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    init();
});

async function init() {
    try {
        // 1. Fetch Data
        await loadCSVData();
        document.getElementById('loading-overlay').classList.add('hidden');

        // 2. Check for saved session
        const savedStore = localStorage.getItem('harpa_store');
        if (savedStore) {
            loadStoreLogic(savedStore);
        } else {
            document.getElementById('store-modal').classList.remove('hidden');
        }
    } catch (error) {
        alert("Error loading data. Ensure CSV files are in the repo root.\n" + error.message);
    }

    // 3. Bind Event Listeners
    document.getElementById('btn-load-store').addEventListener('click', () => {
        const val = document.getElementById('store-input').value.trim();
        if (val) loadStoreLogic(val);
    });

    document.getElementById('btn-scan-toggle').addEventListener('click', startScanner);
    document.getElementById('search-input').addEventListener('input', handleSearch);
}

// --- DATA LOADING ---
async function loadCSVData() {
    const [filesReq, pogReq, mapReq] = await Promise.all([
        fetch('githubfiles.csv'),
        fetch('allplanogramdata.csv'),
        fetch('Store_POG_Mapping.csv')
    ]);

    if (!filesReq.ok || !pogReq.ok || !mapReq.ok) throw new Error("Failed to fetch CSV files");

    const filesText = await filesReq.text();
    const pogText = await pogReq.text();
    const mapText = await mapReq.text();

    fileIndex = filesText.split('\n').map(l => l.trim());
    pogData = parseCSV(pogText);
    storeMap = parseCSV(mapText);
}

function parseCSV(text) {
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    const headers = lines[0].split(',').map(h => h.trim());
    const result = [];

    for (let i = 1; i < lines.length; i++) {
        // Handle commas inside quotes? Simple split for now based on your data
        const row = lines[i].split(',');
        if (row.length < headers.length) continue;

        let obj = {};
        headers.forEach((h, idx) => {
            obj[h] = row[idx] ? row[idx].trim() : "";
        });
        result.push(obj);
    }
    return result;
}

// --- STORE LOGIC ---
function loadStoreLogic(storeNum) {
    // Find POG for Store
    const mapping = storeMap.find(s => s.Store === storeNum);
    
    if (!mapping) {
        document.getElementById('error-msg').classList.remove('hidden');
        return;
    }

    currentStore = storeNum;
    currentPOG = mapping.POG; // e.g., "8386824"

    localStorage.setItem('harpa_store', storeNum);

    // UI Updates
    document.getElementById('store-modal').classList.add('hidden');
    document.getElementById('store-display').textContent = `Store #${storeNum}`;
    document.getElementById('pog-display').textContent = `POG: ${currentPOG}`;
    document.getElementById('error-msg').classList.add('hidden');

    renderBayNavigation();
}

function resetStore() {
    localStorage.removeItem('harpa_store');
    location.reload();
}

// --- NAVIGATION ---
function renderBayNavigation() {
    // Filter POG Data for current POG
    const currentItems = pogData.filter(i => i.POG === currentPOG);
    
    if (currentItems.length === 0) {
        alert("No items found for POG: " + currentPOG);
        return;
    }

    // Extract unique bays
    // Convert to numbers for sorting, then back to string if needed
    const bays = [...new Set(currentItems.map(i => parseInt(i.Bay)))].sort((a, b) => a - b);

    const container = document.getElementById('bay-nav');
    container.innerHTML = '';

    bays.forEach((bay, index) => {
        const btn = document.createElement('button');
        btn.className = 'bay-btn';
        btn.innerText = `Bay ${bay}`;
        btn.onclick = () => loadBay(bay);
        container.appendChild(btn);

        // Auto-load first bay
        if (index === 0) loadBay(bay);
    });
}

function loadBay(bayNum) {
    currentBay = bayNum;

    // Update Buttons
    document.querySelectorAll('.bay-btn').forEach(btn => {
        btn.classList.toggle('active', btn.innerText === `Bay ${bayNum}`);
    });

    renderGrid(bayNum);
}

// --- GRID RENDERING (THE FROG BOARD) ---
function renderGrid(bayNum) {
    const container = document.getElementById('grid-view-container');
    container.innerHTML = '';

    // Get items for this bay
    const items = pogData.filter(i => i.POG === currentPOG && parseInt(i.Bay) === bayNum);
    
    if (items.length === 0) {
        container.innerHTML = '<div style="padding:20px; color:white;">No items in this bay.</div>';
        return;
    }

    // Dynamic Board Height based on lowest product
    let maxRow = 72;
    items.forEach(i => {
        const r = getCoords(i.Peg).r;
        if (r > maxRow) maxRow = r;
    });
    const boardHeightPixels = (maxRow + 10) * SCALE; // Buffer
    const boardWidthPixels = BOARD_W_HOLES * SCALE; // 46 holes wide approx 4ft

    container.style.width = `${boardWidthPixels}px`;
    container.style.height = `${boardHeightPixels}px`;

    let completeCount = 0;

    items.forEach(item => {
        const { r, c } = getCoords(item.Peg);
        // Parse dimensions (remove ' in')
        const h = parseFloat(item.Height.replace(' in', '')) || 6;
        const w = parseFloat(item.Width.replace(' in', '')) || 3;

        // Calculate Pixels
        const widthPx = w * SCALE;
        const heightPx = h * SCALE;
        
        // Position: 
        // R/C from CSV corresponds to the HOLE index (1-based).
        // Frog (Red Dot) is at (C, R).
        // Product hangs from Frog. We center Product horizontally on Frog.
        const topPx = (r - 1) * SCALE; 
        const leftPx = ((c - 1) * SCALE) - (widthPx / 2) + (SCALE / 2);

        // Create Frog
        const frog = document.createElement('div');
        frog.className = 'frog-dot';
        frog.style.top = `${(r - 1) * SCALE + (SCALE/2)}px`;
        frog.style.left = `${(c - 1) * SCALE + (SCALE/2)}px`;
        container.appendChild(frog);

        // Create Product
        const box = document.createElement('div');
        box.className = 'product-box';
        box.style.width = `${widthPx}px`;
        box.style.height = `${heightPx}px`;
        box.style.top = `${topPx}px`;
        box.style.left = `${leftPx}px`;
        box.dataset.upc = item.UPC;
        box.dataset.desc = item.ProductDescription;

        if (completedItems.has(item.UPC)) {
            box.classList.add('completed');
            completeCount++;
        }

        // Image
        const imgName = fileIndex.find(f => f.startsWith(item.UPC));
        if (imgName) {
            const img = document.createElement('img');
            img.src = imgName;
            img.loading = "lazy";
            box.appendChild(img);
        } else {
            box.innerHTML = `<span style="font-size:10px; text-align:center; padding:2px;">${item.UPC}<br>${item.ProductDescription}</span>`;
        }

        // Click Event
        box.onclick = () => toggleComplete(item.UPC, box);

        container.appendChild(box);
    });

    // Update Progress Bar
    updateProgress(completeCount, items.length);
}

function getCoords(pegStr) {
    // Format "R02 C03"
    if (!pegStr) return { r: 1, c: 1 };
    const match = pegStr.match(/R(\d+)\s*C(\d+)/);
    if (match) {
        return { r: parseInt(match[1]), c: parseInt(match[2]) };
    }
    return { r: 1, c: 1 };
}

// --- LOGIC & UTILS ---
function toggleComplete(upc, el) {
    if (completedItems.has(upc)) {
        completedItems.delete(upc);
        el.classList.remove('completed');
    } else {
        completedItems.add(upc);
        el.classList.add('completed');
    }
    localStorage.setItem('harpa_complete', JSON.stringify([...completedItems]));
    
    // Recalculate progress
    const total = pogData.filter(i => i.POG === currentPOG && parseInt(i.Bay) === currentBay).length;
    const done = pogData.filter(i => i.POG === currentPOG && parseInt(i.Bay) === currentBay && completedItems.has(i.UPC)).length;
    updateProgress(done, total);
}

function updateProgress(done, total) {
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    document.getElementById('progress-bar').style.width = `${pct}%`;
    document.getElementById('progress-count').innerText = `${done} / ${total}`;
}

function loadProgress() {
    const saved = localStorage.getItem('harpa_complete');
    if(saved) completedItems = new Set(JSON.parse(saved));
}

// --- SCANNER ---
function startScanner() {
    const modal = document.getElementById('scanner-modal');
    modal.classList.remove('hidden');

    html5QrCode = new Html5Qrcode("reader");
    html5QrCode.start(
        { facingMode: "environment" }, 
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
            // Success
            stopScanner();
            handleScanMatch(decodedText);
        },
        (errorMessage) => {
            // scanning...
        }
    ).catch(err => {
        alert("Camera failed to start. Ensure you are on HTTPS and allowed camera access.");
        modal.classList.add('hidden');
    });
}

function stopScanner() {
    if(html5QrCode) {
        html5QrCode.stop().then(() => {
            document.getElementById('scanner-modal').classList.add('hidden');
            html5QrCode.clear();
        }).catch(err => console.log(err));
    } else {
        document.getElementById('scanner-modal').classList.add('hidden');
    }
}

function handleScanMatch(upc) {
    const box = document.querySelector(`.product-box[data-upc="${upc}"]`);
    if(box) {
        box.scrollIntoView({ behavior: "smooth", block: "center" });
        box.style.border = "3px solid red";
        box.style.zIndex = "100";
        setTimeout(() => {
            box.style.border = "1px solid #999";
            box.style.zIndex = "2";
            toggleComplete(upc, box);
        }, 1500);
    } else {
        alert("UPC " + upc + " not found in this Bay.");
    }
}

function handleSearch(e) {
    const term = e.target.value.toLowerCase();
    const boxes = document.querySelectorAll('.product-box');
    boxes.forEach(box => {
        const upc = box.dataset.upc.toLowerCase();
        const desc = box.dataset.desc.toLowerCase();
        if(upc.includes(term) || desc.includes(term)) {
            box.style.opacity = "1";
            box.style.border = "2px solid blue";
        } else {
            box.style.opacity = "0.1";
            box.style.border = "1px solid #999";
        }
    });
}

// --- PDF ---
function openPDF() {
    if (!currentPOG) return alert("Load a store first.");
    const pdfFile = fileIndex.find(f => f.includes(currentPOG) && f.endsWith('.pdf'));
    
    if(pdfFile) {
        document.getElementById('pdf-frame').src = pdfFile;
        document.getElementById('pdf-modal').classList.remove('hidden');
    } else {
        alert("PDF not found for POG " + currentPOG);
    }
}

function closePDF() {
    document.getElementById('pdf-modal').classList.add('hidden');
    document.getElementById('pdf-frame').src = "";
}
