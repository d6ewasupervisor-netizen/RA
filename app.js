// STATE MANAGEMENT
const state = {
    storeMapping: [],
    allData: [],
    githubFiles: [],
    pogData: [],
    currentStore: null,
    currentPOG: null,
    currentBay: 1,
    totalBays: 1,
    completedUPCs: JSON.parse(localStorage.getItem('harpa_completed_upcs')) || [],
    ppu: 0 // Pixels Per Unit (Inch)
};

const CONFIG = {
    boardWidthInches: 48, // Standard 4ft section
    boardHeightInches: 72, // Approximate usable height
    cols: 46,
    rows: 64
};

// DOM ELEMENTS
const els = {
    workspace: document.getElementById('workspace'),
    pegboard: document.getElementById('pegboard'),
    modalStore: document.getElementById('modal-store'),
    modalPdf: document.getElementById('modal-pdf'),
    modalScanner: document.getElementById('modal-scanner'),
    pdfFrame: document.getElementById('pdf-frame'),
    dispStore: document.getElementById('disp-store'),
    dispPog: document.getElementById('disp-pog'),
    dispBay: document.getElementById('disp-bay'),
    progressFill: document.getElementById('progress-fill'),
    scannerDebug: document.getElementById('scanner-debug'),
    inputStore: document.getElementById('input-store-login'),
    swipeOverlay: document.getElementById('swipe-overlay')
};

// 1. INITIALIZATION
window.addEventListener('DOMContentLoaded', () => {
    calculatePPU();
    loadCSVData();
    setupEventListeners();
});

function calculatePPU() {
    // Fit 48 inches into screen width
    const screenWidth = window.innerWidth;
    state.ppu = (screenWidth - 4) / CONFIG.boardWidthInches; // -4 for borders
    
    // Set background grid size based on PPU (1 inch squares)
    els.pegboard.style.backgroundSize = `${state.ppu}px ${state.ppu}px`;
    els.pegboard.style.width = `${state.ppu * CONFIG.boardWidthInches}px`;
    els.pegboard.style.height = `${state.ppu * CONFIG.boardHeightInches}px`;
}

async function loadCSVData() {
    try {
        const [mappingRes, dataRes, filesRes] = await Promise.all([
            fetch('Store_POG_Mapping.csv'),
            fetch('allplanogramdata.csv'),
            fetch('githubfiles.csv')
        ]);

        state.storeMapping = parseCSV(await mappingRes.text());
        state.allData = parseCSV(await dataRes.text());
        
        // Normalize github files list for easier search
        const rawFiles = parseCSV(await filesRes.text());
        // Assuming githubfiles.csv has a column 'Filename'
        state.githubFiles = rawFiles.map(row => Object.values(row)[0]); 

    } catch (e) {
        alert("Error loading data files. Ensure CSVs are in root.");
        console.error(e);
    }
}

function parseCSV(text) {
    const lines = text.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim());
    return lines.slice(1).map(line => {
        const values = line.split(',');
        let obj = {};
        headers.forEach((h, i) => obj[h] = values[i] ? values[i].trim() : '');
        return obj;
    });
}

// 2. STORE LOGIC
document.getElementById('btn-load-store').addEventListener('click', () => {
    const storeNum = els.inputStore.value.trim();
    const mapEntry = state.storeMapping.find(r => r.Store === storeNum);
    
    if (mapEntry) {
        state.currentStore = storeNum;
        state.currentPOG = mapEntry.POG;
        loadPOG(state.currentPOG);
        els.modalStore.classList.remove('active');
        updateHeader();
    } else {
        document.getElementById('login-error').innerText = "Store not found.";
    }
});

document.getElementById('btn-switch-store').addEventListener('click', () => {
    els.modalStore.classList.add('active');
});

function loadPOG(pogID) {
    // Filter Master Data
    state.pogData = state.allData.filter(item => item.POG === pogID);
    
    if (state.pogData.length === 0) {
        alert("No items found for this POG ID.");
        return;
    }

    // Calculate Bays
    const bays = [...new Set(state.pogData.map(i => parseInt(i.Bay)))];
    state.totalBays = Math.max(...bays);
    state.currentBay = 1;
    
    renderBay(state.currentBay);
}

// 3. RENDERING
function renderBay(bayNum) {
    els.pegboard.innerHTML = ''; // Clear board
    const bayItems = state.pogData.filter(i => parseInt(i.Bay) === bayNum);
    
    // Update UI
    els.dispBay.innerText = `Bay ${bayNum} of ${state.totalBays}`;
    updateProgress();

    bayItems.forEach(item => {
        createProductElement(item);
    });
}

function createProductElement(item) {
    // Parse Coordinate "R02 C03"
    const parts = item.Peg.split(' ');
    const row = parseInt(parts[0].replace('R', ''));
    const col = parseInt(parts[1].replace('C', ''));

    // Coordinates
    const topPx = row * state.ppu;
    // "Product hangs centered between Col C and C+1". Center of C is col * ppu. Center of gap is (col + 0.5) * ppu
    const leftPx = (col + 0.5) * state.ppu; 

    // Container
    const el = document.createElement('div');
    el.className = 'product-item';
    el.dataset.upc = item.UPC;
    
    // Position
    el.style.top = `${topPx}px`;
    el.style.left = `${leftPx}px`;
    
    // Logic: If we assume the item hangs DOWN from the peg, no calc needed.
    // But we need to center the image visually horizontally on the peg hole gap.
    // We apply a transform to center the element itself.
    el.style.transform = 'translateX(-50%)';

    // The Red Frog Dot (The actual peg hole is at col integer, but user puts peg in hole C and C+1)
    // The prompt says: "Red Dot rendered at exact (Row, Col) coordinate"
    // Since container is centered at (col+0.5), we need to offset the dot to be at (col).
    const dot = document.createElement('div');
    dot.className = 'frog-dot';
    // Dot needs to be at (col * ppu). Container is at (col+0.5 * ppu).
    // Difference is -0.5 * ppu.
    dot.style.left = 'calc(50% - ' + (state.ppu * 0.5) + 'px)';
    dot.style.top = '0px';

    // Image
    const img = document.createElement('img');
    img.className = 'product-img';
    img.style.width = `${(item.Width || 3) * state.ppu}px`; // Default 3 inches if missing
    img.style.height = `${(item.Height || 4) * state.ppu}px`; // Default 4 inches
    
    // Image source resolution
    const fileName = findImageFile(item.UPC);
    img.src = fileName ? fileName : `https://via.placeholder.com/50?text=${item.UPC}`;
    
    // Click to Toggle Complete
    el.onclick = () => toggleComplete(item.UPC, el);

    // Check completion state
    if (state.completedUPCs.includes(item.UPC)) {
        el.classList.add('completed');
    }

    el.appendChild(dot);
    el.appendChild(img);
    els.pegboard.appendChild(el);
}

function findImageFile(upc) {
    // Look in githubfiles for exact match or match with leading zero logic
    // For MVP, assuming filename starts with UPC
    return state.githubFiles.find(f => f.includes(upc));
}

function toggleComplete(upc, el) {
    if (state.completedUPCs.includes(upc)) {
        state.completedUPCs = state.completedUPCs.filter(u => u !== upc);
        el.classList.remove('completed');
    } else {
        state.completedUPCs.push(upc);
        el.classList.add('completed');
    }
    localStorage.setItem('harpa_completed_upcs', JSON.stringify(state.completedUPCs));
    updateProgress();
}

function updateProgress() {
    const bayItems = state.pogData.filter(i => parseInt(i.Bay) === state.currentBay);
    const total = bayItems.length;
    if(total === 0) return;
    
    const completed = bayItems.filter(i => state.completedUPCs.includes(i.UPC)).length;
    const pct = (completed / total) * 100;
    els.progressFill.style.width = `${pct}%`;
}

function updateHeader() {
    els.dispStore.innerText = `Store: ${state.currentStore}`;
    els.dispPog.innerText = `POG: ${state.currentPOG}`;
}

// 4. SCANNER & SEARCH
let html5QrcodeScanner = null;

document.getElementById('btn-scan').addEventListener('click', () => {
    els.modalScanner.classList.add('active');
    startScanner();
});

function startScanner() {
    html5QrcodeScanner = new Html5QrcodeScanner(
        "reader", { fps: 10, qrbox: 250 });
    html5QrcodeScanner.render(onScanSuccess, onScanFailure);
}

function stopScanner() {
    if (html5QrcodeScanner) {
        html5QrcodeScanner.clear().then(() => {
            els.modalScanner.classList.remove('active');
        }).catch(error => console.error(error));
    } else {
        els.modalScanner.classList.remove('active');
    }
}

function onScanSuccess(decodedText) {
    // Strip leading zeros
    let cleanUPC = decodedText.replace(/^0+/, '');
    els.scannerDebug.innerText = `Last Scanned: ${cleanUPC}`;
    
    stopScanner(); // Close camera on success
    handleSearch(cleanUPC);
}

function onScanFailure(error) {
    // console.warn(`Code scan error = ${error}`);
}

// Manual Search
document.getElementById('btn-manual-go').addEventListener('click', () => {
    const input = document.getElementById('input-manual').value.trim();
    const cleanUPC = input.replace(/^0+/, '');
    handleSearch(cleanUPC);
});

function handleSearch(upc) {
    const item = state.pogData.find(i => i.UPC === upc);
    
    if (!item) {
        alert(`UPC ${upc} not found in this Planogram.`);
        return;
    }

    // If in different bay, switch
    if (parseInt(item.Bay) !== state.currentBay) {
        state.currentBay = parseInt(item.Bay);
        renderBay(state.currentBay);
    }

    // Highlight logic
    const targetEl = document.querySelector(`.product-item[data-upc="${upc}"]`);
    if (targetEl) {
        targetEl.scrollIntoView({behavior: "smooth", block: "center"});
        targetEl.classList.add('highlight');
        setTimeout(() => targetEl.classList.remove('highlight'), 3000);
        
        // Auto-mark complete on scan? (Optional, usually desired)
        if (!state.completedUPCs.includes(upc)) {
            toggleComplete(upc, targetEl);
        }
    }
}

// 5. NAVIGATION & PDF
document.getElementById('nav-prev').addEventListener('click', () => changeBay(-1));
document.getElementById('nav-next').addEventListener('click', () => changeBay(1));

function changeBay(dir) {
    const newBay = state.currentBay + dir;
    if (newBay > 0 && newBay <= state.totalBays) {
        state.currentBay = newBay;
        showSwipeOverlay(newBay);
        renderBay(state.currentBay);
    }
}

function showSwipeOverlay(num) {
    els.swipeOverlay.innerText = num;
    els.swipeOverlay.classList.remove('hidden');
    setTimeout(() => els.swipeOverlay.classList.add('hidden'), 500);
}

// PDF
document.getElementById('btn-pdf').addEventListener('click', () => {
    const pdfFile = state.githubFiles.find(f => f.includes(state.currentPOG) && f.endsWith('.pdf'));
    if (pdfFile) {
        els.pdfFrame.src = pdfFile;
        els.modalPdf.classList.add('active');
    } else {
        alert("PDF Hard Copy not found for this POG.");
    }
});

window.closeModal = (id) => {
    document.getElementById(id).classList.remove('active');
};

// 6. GESTURES (SWIPE)
function setupEventListeners() {
    let touchstartX = 0;
    let touchendX = 0;
    
    els.workspace.addEventListener('touchstart', e => {
        touchstartX = e.changedTouches[0].screenX;
    });

    els.workspace.addEventListener('touchend', e => {
        touchendX = e.changedTouches[0].screenX;
        handleGesture();
    });

    function handleGesture() {
        if (touchendX < touchstartX - 50) changeBay(1); // Swipe Left -> Next Bay
        if (touchendX > touchstartX + 50) changeBay(-1); // Swipe Right -> Prev Bay
    }
}
