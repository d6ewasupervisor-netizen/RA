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
let headerCollapsed = false;
let currentItemBox = null; // Currently selected item for the modal

// --- INIT ---
document.addEventListener('DOMContentLoaded', () => {
    init();
    setupSwipe();
    window.addEventListener('resize', () => {
        if (currentPOG && currentBay) renderGrid(currentBay);
    });
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
        handleSearchOrScan(document.getElementById('search-input').value.trim(), false);
    
    document.getElementById('search-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSearchOrScan(document.getElementById('search-input').value.trim(), false);
    });
}

// --- HEADER COLLAPSE/EXPAND ---
function toggleHeader() {
    const header = document.getElementById('main-header');
    const expandBtn = document.getElementById('btn-expand');
    
    headerCollapsed = !headerCollapsed;
    
    if (headerCollapsed) {
        header.classList.add('collapsed');
        expandBtn.classList.remove('hidden');
    } else {
        header.classList.remove('collapsed');
        expandBtn.classList.add('hidden');
    }
    
    // Re-render grid after transition to use new available space
    setTimeout(() => {
        if (currentPOG && currentBay) renderGrid(currentBay);
    }, 350);
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
    
    // Debug: Show first few records and their structure
    if (pogData.length > 0) {
        console.log("CSV Columns found:", Object.keys(pogData[0]));
        console.log("Sample record:", pogData[0]);
        console.log("Sample UPC:", pogData[0].UPC, "-> CleanUPC:", pogData[0].CleanUPC);
    }
}

function parseCSV(text) {
    // Normalize line endings (handle Windows \r\n)
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    
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

// Handle quoted CSV fields properly and strip any remaining \r
function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim().replace(/\r/g, ''));
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current.trim().replace(/\r/g, ''));
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
    const canvas = document.getElementById('main-canvas');
    container.innerHTML = '';

    // Get available space
    const availableWidth = canvas.clientWidth - 10;  // Small margin
    const availableHeight = canvas.clientHeight - 10;

    // Calculate PPI to FIT ENTIRE BOARD on screen
    // Use whichever dimension is more constraining
    const ppiByWidth = availableWidth / BOARD_WIDTH_INCHES;
    const ppiByHeight = availableHeight / BOARD_HEIGHT_INCHES;
    PPI = Math.min(ppiByWidth, ppiByHeight);

    // Set Board Dimensions
    const pxWidth = BOARD_WIDTH_INCHES * PPI;
    const pxHeight = BOARD_HEIGHT_INCHES * PPI;

    container.style.width = `${pxWidth}px`;
    container.style.height = `${pxHeight}px`;
    
    // Visual Grid Dots: 1 inch spacing = PPI
    container.style.backgroundSize = `${PPI}px ${PPI}px`;
    container.style.backgroundImage = `radial-gradient(#333 15%, transparent 16%)`;

    // Place Items
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

        // Peg Coordinate Label
        const pegLabel = document.createElement('div');
        pegLabel.className = 'peg-label';
        pegLabel.innerText = item.Peg || `R${r} C${c}`;
        pegLabel.style.left = `${holeLeftX}px`;
        pegLabel.style.top = `${holeY - 10}px`;
        pegLabel.style.transform = 'translateX(-50%)';
        container.appendChild(pegLabel);

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
        
        // Store full item data for detail modal
        box.dataset.itemData = JSON.stringify(item);

        if (completedItems.has(item.CleanUPC)) {
            box.classList.add('completed');
            doneCount++;
        }

        // Find image in file index that starts with UPC (handle both raw UPC and cleaned UPC)
        let imgFile = fileIndex.find(f => f.startsWith(item.UPC) && /\.(jpg|jpeg|png|gif|webp)$/i.test(f));
        
        // Also try with CleanUPC (no leading zeros) in case filename doesn't have them
        if (!imgFile && item.CleanUPC !== item.UPC) {
            imgFile = fileIndex.find(f => f.startsWith(item.CleanUPC) && /\.(jpg|jpeg|png|gif|webp)$/i.test(f));
        }
        
        box.dataset.imgSrc = imgFile || '';
        
        // Extract description from filename if image exists
        const filenameDesc = extractDescriptionFromFilename(imgFile);
        box.dataset.filenameDesc = filenameDesc || '';
        
        if (imgFile) {
            const img = document.createElement('img');
            img.src = imgFile;
            img.alt = item.UPC;
            img.onerror = () => {
                box.innerHTML = `<span style="font-size:${Math.max(6, PPI * 0.8)}px; text-align:center; padding:2px; word-break:break-all;">${item.UPC}</span>`;
                // Re-add position label after innerHTML replacement
                addPositionLabel(box, item.Position);
            };
            box.appendChild(img);
        } else {
            box.innerHTML = `<span style="font-size:${Math.max(6, PPI * 0.8)}px; text-align:center; padding:2px; word-break:break-all;">${item.UPC}</span>`;
        }

        // Add Position Number Label
        addPositionLabel(box, item.Position);

        // Open detail modal on click
        box.onclick = () => openProductModal(box);
        container.appendChild(box);
    });

    // Update Progress
    updateProgress(items, doneCount);
}

// Helper function to extract description from image filename
function extractDescriptionFromFilename(filename) {
    if (!filename) return null;
    // Remove file extension
    const noExt = filename.replace(/\.(jpg|jpeg|png|gif|webp)$/i, '');
    // Remove UPC (leading digits) and separator (space or underscore)
    const desc = noExt.replace(/^\d+[\s_]?/, '');
    // Replace underscores with spaces and clean up
    return desc.replace(/_/g, ' ').trim() || null;
}

// Helper function to add position label
function addPositionLabel(box, position) {
    if (!position) return;
    const posLabel = document.createElement('div');
    posLabel.className = 'position-label';
    posLabel.innerText = position;
    box.appendChild(posLabel);
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
    
    // Convert to string, trim whitespace, remove any \r characters
    let cleaned = upc.toString().trim().replace(/\r/g, '');
    
    // Remove any non-numeric characters (some scanners add extra chars)
    cleaned = cleaned.replace(/[^0-9]/g, '');
    
    // Strip ALL leading zeros
    cleaned = cleaned.replace(/^0+/, '');
    
    // If the entire UPC was zeros, keep at least one digit
    if (cleaned === '') cleaned = '0';
    
    return cleaned;
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
let isProcessingScan = false; // Prevent multiple rapid scans

function startScanner() {
    const modal = document.getElementById('scanner-modal');
    modal.classList.remove('hidden');
    isProcessingScan = false;
    
    html5QrCode = new Html5Qrcode("reader");
    html5QrCode.start(
        { facingMode: "environment" }, 
        { fps: 10, qrbox: 250 },
        (decodedText) => {
            // Prevent multiple scans while processing
            if (isProcessingScan) return;
            isProcessingScan = true;
            
            // IMMEDIATELY close the scanner first
            stopScanner();
            
            // Then process the scan after a brief delay to let camera close
            setTimeout(() => {
                handleSearchOrScan(decodedText, true);
            }, 100);
        },
        (err) => { /* Ignore scan errors */ }
    ).catch(e => {
        alert("Camera Error: " + e);
        stopScanner();
    });
}

function stopScanner() {
    const modal = document.getElementById('scanner-modal');
    modal.classList.add('hidden'); // Hide immediately
    
    if (html5QrCode) {
        html5QrCode.stop().then(() => {
            html5QrCode.clear();
            html5QrCode = null;
            isProcessingScan = false;
        }).catch(() => {
            html5QrCode = null;
            isProcessingScan = false;
        });
    } else {
        isProcessingScan = false;
    }
}

function handleSearchOrScan(input, fromScanner = false) {
    if (!input) return false;
    
    const clean = normalizeUPC(input);
    // Also prepare version without check digit (last digit of UPC-A is check digit)
    const cleanNoCheckDigit = clean.length > 1 ? clean.slice(0, -1) : clean;
    
    // Display for debugging - show the version without check digit since that's what we're matching
    document.getElementById('scan-result').innerText = `Searching: ${cleanNoCheckDigit}`;
    console.log(`=== SEARCH DEBUG ===`);
    console.log(`Raw input: "${input}"`);
    console.log(`Cleaned (no leading zeros): "${clean}"`);
    console.log(`Without check digit: "${cleanNoCheckDigit}"`);
    console.log(`Current POG: "${currentPOG}"`);

    // First check if we have items for this POG
    const itemsInPOG = pogData.filter(i => i.POG === currentPOG);
    console.log(`Items in POG "${currentPOG}": ${itemsInPOG.length}`);
    
    if (itemsInPOG.length === 0) {
        const allPOGs = [...new Set(pogData.map(i => i.POG))];
        console.log(`POG not found! Available POGs:`, allPOGs.slice(0, 10));
        document.getElementById('scan-result').innerText = `POG "${currentPOG}" has no items`;
        return false;
    }

    // Try multiple matching strategies:
    // 1. Exact match (rare - data usually doesn't have check digit)
    // 2. Without trailing check digit (most common - scanner adds check digit, data doesn't have it)
    // 3. Data has check digit but scan doesn't
    
    let match = itemsInPOG.find(i => i.CleanUPC === clean);
    
    if (!match) {
        // Try without the check digit (most common case)
        match = itemsInPOG.find(i => i.CleanUPC === cleanNoCheckDigit);
        if (match) {
            console.log(`Matched by removing check digit: "${clean}" → "${cleanNoCheckDigit}"`);
        }
    }
    
    if (!match) {
        // Try matching where data has check digit but scan doesn't
        match = itemsInPOG.find(i => i.CleanUPC.slice(0, -1) === clean);
        if (match) {
            console.log(`Matched by ignoring data's check digit`);
        }
    }
    
    if (!match) {
        document.getElementById('scan-result').innerText = `"${cleanNoCheckDigit}" not found`;
        console.log(`UPC "${clean}" not found (also tried "${cleanNoCheckDigit}")`);
        console.log(`Sample CleanUPCs:`, itemsInPOG.slice(0, 10).map(i => i.CleanUPC));
        return false;
    }

    console.log(`✓ Found match:`, match);
    document.getElementById('scan-result').innerText = `✓ Bay ${match.Bay}, ${match.Peg}`;

    // Use the matched item's CleanUPC for highlighting
    const matchedUPC = match.CleanUPC;

    // Check if we need to change bays
    const itemBay = parseInt(match.Bay);
    if (itemBay !== currentBay) {
        loadBay(itemBay);
        setTimeout(() => highlightItem(matchedUPC), 400);
    } else {
        highlightItem(matchedUPC);
    }
    
    return true; // Found
}

function highlightItem(upc) {
    // Remove any existing highlight
    document.querySelectorAll('.product-box.highlight').forEach(el => el.classList.remove('highlight'));
    
    const box = document.querySelector(`.product-box[data-upc="${upc}"]`);
    if (box) {
        box.classList.add('highlight');
        
        // Keep flashing for 5 seconds, then stop (but stay visible)
        setTimeout(() => box.classList.remove('highlight'), 5000);
    }
}

// --- PRODUCT DETAIL MODAL ---
function openProductModal(box) {
    currentItemBox = box;
    
    const item = JSON.parse(box.dataset.itemData);
    const imgSrc = box.dataset.imgSrc;
    const filenameDesc = box.dataset.filenameDesc;
    
    // Populate modal - use filename description if available, otherwise fall back to CSV
    document.getElementById('detail-peg').innerText = item.Peg || `R-- C--`;
    document.getElementById('detail-position').innerText = item.Position || '--';
    document.getElementById('detail-upc').innerText = item.UPC || '--';
    document.getElementById('detail-desc').innerText = filenameDesc || item.ProductDescription || item.Description || '--';
    document.getElementById('detail-size').innerText = `${item.Width} × ${item.Height}`;
    
    const detailImg = document.getElementById('detail-image');
    if (imgSrc) {
        detailImg.src = imgSrc;
        detailImg.style.display = 'block';
    } else {
        detailImg.src = '';
        detailImg.style.display = 'none';
    }
    
    // Update button state based on completion
    const isCompleted = box.classList.contains('completed');
    const setBtn = document.getElementById('btn-set-item');
    if (isCompleted) {
        setBtn.innerText = '↩ UNSET';
        setBtn.style.background = '#666';
    } else {
        setBtn.innerText = '✓ SET COMPLETE';
        setBtn.style.background = '';
    }
    
    document.getElementById('product-modal').classList.remove('hidden');
}

function closeProductModal(event) {
    // If called from overlay click, only close if clicking the overlay itself
    if (event && event.target.id !== 'product-modal') return;
    
    document.getElementById('product-modal').classList.add('hidden');
    currentItemBox = null;
}

function setItemComplete() {
    if (!currentItemBox) return;
    
    const upc = currentItemBox.dataset.upc;
    const isCompleted = currentItemBox.classList.contains('completed');
    const currentItem = JSON.parse(currentItemBox.dataset.itemData);
    const currentPosition = parseInt(currentItem.Position) || 0;
    
    if (isCompleted) {
        // Unset - remove from completed
        completedItems.delete(upc);
        currentItemBox.classList.remove('completed');
        localStorage.setItem('harpa_complete', JSON.stringify([...completedItems]));
        
        // Update progress
        const items = pogData.filter(i => i.POG === currentPOG && parseInt(i.Bay) === currentBay);
        const done = items.filter(i => completedItems.has(i.CleanUPC)).length;
        updateProgress(items, done);
        
        // Just close the modal when unsetting
        document.getElementById('product-modal').classList.add('hidden');
        currentItemBox = null;
    } else {
        // Set complete
        completedItems.add(upc);
        currentItemBox.classList.add('completed');
        localStorage.setItem('harpa_complete', JSON.stringify([...completedItems]));
        
        // Update progress
        const items = pogData.filter(i => i.POG === currentPOG && parseInt(i.Bay) === currentBay);
        const done = items.filter(i => completedItems.has(i.CleanUPC)).length;
        updateProgress(items, done);
        
        // Find next item by position number
        const nextPosition = currentPosition + 1;
        const nextBox = findProductBoxByPosition(nextPosition);
        
        if (nextBox) {
            // Auto-advance to next item
            currentItemBox = null;
            openProductModal(nextBox);
        } else {
            // No next item, close modal
            document.getElementById('product-modal').classList.add('hidden');
            currentItemBox = null;
        }
    }
}

// Helper function to find product box by position number
function findProductBoxByPosition(position) {
    const boxes = document.querySelectorAll('.product-box');
    for (const box of boxes) {
        try {
            const itemData = JSON.parse(box.dataset.itemData);
            if (parseInt(itemData.Position) === position) {
                return box;
            }
        } catch (e) {
            continue;
        }
    }
    return null;
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
