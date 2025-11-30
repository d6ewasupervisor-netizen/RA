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
let deleteData = []; // Items to be deleted
let currentStore = null;
let currentPOG = null;
let currentBay = 1;
let allBays = [];
let html5QrCode = null;
let completedItems = new Set(JSON.parse(localStorage.getItem('harpa_complete') || "[]"));
let headerCollapsed = false;
let currentItemBox = null; // Currently selected item for the modal

// Multi-match navigation state
let currentMatches = []; // Array of matched items
let currentMatchIndex = 0; // Which match we're currently showing

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
    
    document.getElementById('btn-manual-search').onclick = () => {
        const input = document.getElementById('search-input');
        handleSearchOrScan(input.value.trim(), false);
        input.value = ''; // Clear input after search
    };
    
    document.getElementById('search-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const input = document.getElementById('search-input');
            handleSearchOrScan(input.value.trim(), false);
            input.value = ''; // Clear input after search
        }
    });
}

// --- HEADER COLLAPSE/EXPAND ---
function toggleHeader() {
    const header = document.getElementById('main-header');
    const floatingBtns = document.getElementById('floating-btns');
    
    headerCollapsed = !headerCollapsed;
    
    if (headerCollapsed) {
        header.classList.add('collapsed');
        floatingBtns.classList.remove('hidden');
    } else {
        header.classList.remove('collapsed');
        floatingBtns.classList.add('hidden');
    }
    
    // Re-render grid after transition to use new available space
    setTimeout(() => {
        if (currentPOG && currentBay) renderGrid(currentBay);
    }, 350);
}

// --- DATA LOADING ---
async function loadCSVData() {
    const ts = Date.now();
    
    const [filesResp, pogsResp, mapsResp, deletesResp] = await Promise.all([
        fetch(`githubfiles.csv?t=${ts}`),
        fetch(`allplanogramdata.csv?t=${ts}`),
        fetch(`Store_POG_Mapping.csv?t=${ts}`),
        fetch(`Deletes.csv?t=${ts}`).catch(() => null) // Optional file
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
    
    // Load deletes data if file exists
    if (deletesResp && deletesResp.ok) {
        const deletesText = await deletesResp.text();
        deleteData = parseCSV(deletesText).map(i => ({...i, CleanUPC: normalizeUPC(i.UPC)}));
        console.log(`Loaded: ${deleteData.length} delete items`);
    } else {
        deleteData = [];
        console.log("Deletes.csv not found - skipping delete checks");
    }
    
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
    
    // Check if this is a different store than before - if so, clear progress
    const previousStore = localStorage.getItem('harpa_store');
    if (previousStore && previousStore !== storeNum) {
        completedItems.clear();
        localStorage.removeItem('harpa_complete');
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
    // Clear completed items when changing stores
    completedItems.clear();
    localStorage.removeItem('harpa_complete');
    localStorage.removeItem('harpa_store');
    location.reload();
}

function startOver() {
    // Show confirmation
    if (!confirm('Are you sure you want to reset all items to unset? This will clear all progress for this store.')) {
        return;
    }
    
    // Clear all completed items
    completedItems.clear();
    localStorage.removeItem('harpa_complete');
    
    // Re-render current bay to update visual state
    renderGrid(currentBay);
}

// --- BAY LOGIC ---
function changeBay(dir) {
    const idx = allBays.indexOf(currentBay);
    if (idx === -1) return;
    
    let newIdx = idx + dir;
    newIdx = Math.max(0, Math.min(newIdx, allBays.length - 1));
    
    if (allBays[newIdx] !== currentBay) {
        loadBay(allBays[newIdx], true); // true = show overlay
    }
}

function loadBay(bayNum, showOverlay = false) {
    currentBay = bayNum;
    const bayIndex = allBays.indexOf(bayNum) + 1;
    document.getElementById('bay-indicator').innerText = `Bay ${bayIndex} of ${allBays.length}`;
    renderGrid(bayNum);
    
    // Show bay change overlay if navigating between bays
    if (showOverlay) {
        showBayOverlay(bayIndex);
    }
}

function showBayOverlay(bayIndex) {
    const overlay = document.getElementById('bay-overlay');
    const bayNumber = document.getElementById('bay-overlay-number');
    
    bayNumber.innerText = bayIndex;
    overlay.classList.remove('hidden');
    
    // Remove after animation
    setTimeout(() => {
        overlay.classList.add('hidden');
    }, 1200);
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
    
    // Fix common barcode scanner OCR misreads BEFORE removing non-numeric
    // These characters look similar and scanners often confuse them
    cleaned = cleaned
        .replace(/[OoQq]/g, '0')  // O, o, Q, q → 0
        .replace(/[IilL|]/g, '1') // I, i, l, L, | → 1
        .replace(/[Ss\$]/g, '5')  // S, s, $ → 5
        .replace(/[Bb]/g, '8')    // B, b → 8
        .replace(/[Zz]/g, '2')    // Z, z → 2
        .replace(/[Gg]/g, '6')    // G, g → 6
        .replace(/[Tt]/g, '7');   // T, t → 7
    
    // Remove any remaining non-numeric characters
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
    
    // Configure scanner for better barcode recognition
    let html5Config = {};
    try {
        if (typeof Html5QrcodeSupportedFormats !== 'undefined') {
            html5Config.formatsToSupport = [
                Html5QrcodeSupportedFormats.UPC_A,
                Html5QrcodeSupportedFormats.UPC_E,
                Html5QrcodeSupportedFormats.EAN_13,
                Html5QrcodeSupportedFormats.EAN_8,
                Html5QrcodeSupportedFormats.CODE_128,
                Html5QrcodeSupportedFormats.CODE_39
            ];
        }
    } catch(e) {
        console.log("Using default barcode formats");
    }
    
    html5QrCode = new Html5Qrcode("reader", html5Config);
    
    const scanConfig = {
        fps: 10,
        qrbox: { width: 280, height: 150 } // Wider box for barcodes
    };
    
    html5QrCode.start(
        { facingMode: "environment" }, 
        scanConfig,
        (decodedText) => {
            // Prevent multiple scans while processing
            if (isProcessingScan) return;
            isProcessingScan = true;
            
            // Log raw scan for debugging
            console.log(`📷 RAW SCAN: "${decodedText}"`);
            const cleaned = normalizeUPC(decodedText);
            console.log(`🔧 CLEANED UPC: "${cleaned}"`);
            
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
    
    // Hide any existing multi-match bar
    hideMultiMatchBar();
    
    const clean = normalizeUPC(input);
    // Also prepare version without check digit (last digit of UPC-A is check digit)
    const cleanNoCheckDigit = clean.length > 1 ? clean.slice(0, -1) : clean;
    
    // Display for debugging
    document.getElementById('scan-result').innerText = `Searching: ${cleanNoCheckDigit}`;
    console.log(`=== SEARCH DEBUG ===`);
    console.log(`Raw input: "${input}"`);
    console.log(`Cleaned (no leading zeros): "${clean}"`);
    console.log(`Without check digit: "${cleanNoCheckDigit}"`);
    console.log(`Current POG: "${currentPOG}"`);
    console.log(`From scanner: ${fromScanner}`);

    // FIRST: Check if this is a DELETE item for this POG
    const deleteMatch = checkForDelete(clean, cleanNoCheckDigit);
    if (deleteMatch) {
        showDeleteOverlay(deleteMatch.UPC || cleanNoCheckDigit, deleteMatch.Product || 'Unknown Item');
        document.getElementById('scan-result').innerText = `🗑️ DELETE: ${deleteMatch.Product || cleanNoCheckDigit}`;
        return true; // Handled as delete
    }

    // Get items in current POG
    const itemsInPOG = pogData.filter(i => i.POG === currentPOG);
    console.log(`Items in POG "${currentPOG}": ${itemsInPOG.length}`);
    
    if (itemsInPOG.length === 0) {
        showNotFoundOverlay();
        document.getElementById('scan-result').innerText = `POG "${currentPOG}" has no items`;
        return false;
    }

    // Find ALL matches using multiple strategies
    let matches = findAllMatches(itemsInPOG, clean, cleanNoCheckDigit, fromScanner);
    
    if (matches.length === 0) {
        showNotFoundOverlay();
        document.getElementById('scan-result').innerText = `"${cleanNoCheckDigit}" not found`;
        console.log(`UPC "${clean}" not found (also tried "${cleanNoCheckDigit}")`);
        return false;
    }

    console.log(`✓ Found ${matches.length} match(es):`, matches);
    
    // Store matches for navigation
    currentMatches = matches;
    currentMatchIndex = 0;
    
    // Show the first match
    showMatchAtIndex(0, true); // true = show overlay
    
    return true;
}

// Find all matching items in the POG
function findAllMatches(itemsInPOG, clean, cleanNoCheckDigit, fromScanner) {
    let matches = [];
    
    // For manual search with short input (4 digits or less), do fuzzy search
    if (!fromScanner && clean.length <= 4) {
        // Fuzzy search: find items where UPC ends with these digits
        matches = itemsInPOG.filter(i => 
            i.CleanUPC.endsWith(clean) || i.CleanUPC.endsWith(cleanNoCheckDigit)
        );
        console.log(`Fuzzy search for "${clean}" found ${matches.length} matches`);
    } else {
        // Exact matching strategies - find ALL matches (same UPC can appear multiple times)
        
        // Strategy 1: Exact match
        let exactMatches = itemsInPOG.filter(i => i.CleanUPC === clean);
        
        // Strategy 2: Without check digit
        if (exactMatches.length === 0) {
            exactMatches = itemsInPOG.filter(i => i.CleanUPC === cleanNoCheckDigit);
        }
        
        // Strategy 3: Data has check digit but scan doesn't
        if (exactMatches.length === 0) {
            exactMatches = itemsInPOG.filter(i => i.CleanUPC.slice(0, -1) === clean);
        }
        
        matches = exactMatches;
    }
    
    // Sort by Bay then Position for consistent ordering
    matches.sort((a, b) => {
        const bayDiff = parseInt(a.Bay) - parseInt(b.Bay);
        if (bayDiff !== 0) return bayDiff;
        return (parseInt(a.Position) || 0) - (parseInt(b.Position) || 0);
    });
    
    return matches;
}

// Show a specific match by index
function showMatchAtIndex(index, showOverlay = false) {
    if (index < 0 || index >= currentMatches.length) return;
    
    currentMatchIndex = index;
    const match = currentMatches[index];
    
    // Update scan result
    let resultText = `✓ Bay ${match.Bay}, Pos ${match.Position}, ${match.Peg}`;
    if (currentMatches.length > 1) {
        resultText += ` (${index + 1} of ${currentMatches.length})`;
    }
    document.getElementById('scan-result').innerText = resultText;
    
    // Show/hide multi-match navigation bar
    if (currentMatches.length > 1) {
        showMultiMatchBar();
    } else {
        hideMultiMatchBar();
    }
    
    // Collapse header to show full bay (zoom out effect)
    if (!headerCollapsed) {
        const header = document.getElementById('main-header');
        const floatingBtns = document.getElementById('floating-btns');
        headerCollapsed = true;
        header.classList.add('collapsed');
        floatingBtns.classList.remove('hidden');
    }
    
    // Show overlay if requested (first time finding item)
    if (showOverlay) {
        showFoundOverlay(match);
        
        // After overlay fades, navigate to item
        setTimeout(() => {
            navigateToMatch(match);
        }, 2500);
    } else {
        // Navigate immediately
        navigateToMatch(match);
    }
}

// Navigate to a specific match's bay and highlight it
function navigateToMatch(match) {
    const matchedUPC = match.CleanUPC;
    const itemBay = parseInt(match.Bay);
    
    if (itemBay !== currentBay) {
        // Load the new bay (without overlay since we're navigating between matches)
        loadBay(itemBay, false);
        setTimeout(() => highlightItem(matchedUPC), 300);
    } else {
        renderGrid(currentBay);
        setTimeout(() => highlightItem(matchedUPC), 100);
    }
}

// Show next match
function showNextMatch() {
    if (currentMatches.length === 0) return;
    const nextIndex = (currentMatchIndex + 1) % currentMatches.length;
    showMatchAtIndex(nextIndex, false);
}

// Show previous match
function showPrevMatch() {
    if (currentMatches.length === 0) return;
    const prevIndex = (currentMatchIndex - 1 + currentMatches.length) % currentMatches.length;
    showMatchAtIndex(prevIndex, false);
}

// Show/hide multi-match navigation bar
function showMultiMatchBar() {
    const bar = document.getElementById('multi-match-bar');
    const indicator = document.getElementById('match-indicator');
    const prevBtn = document.getElementById('btn-prev-match');
    const nextBtn = document.getElementById('btn-next-match');
    
    indicator.innerText = `${currentMatchIndex + 1} of ${currentMatches.length}`;
    
    // Update button states
    prevBtn.disabled = currentMatches.length <= 1;
    nextBtn.disabled = currentMatches.length <= 1;
    
    bar.classList.remove('hidden');
}

function hideMultiMatchBar() {
    document.getElementById('multi-match-bar').classList.add('hidden');
    currentMatches = [];
    currentMatchIndex = 0;
}

// Show "Item Found" overlay
function showFoundOverlay(match) {
    const overlay = document.getElementById('found-overlay');
    const bayEl = document.getElementById('found-overlay-bay');
    const posEl = document.getElementById('found-overlay-position');
    const pegEl = document.getElementById('found-overlay-peg');
    
    bayEl.innerText = `Bay ${match.Bay}`;
    posEl.innerText = `Position ${match.Position || '--'}`;
    pegEl.innerText = match.Peg || 'R-- C--';
    
    overlay.classList.remove('hidden');
    
    // Remove after animation (3 seconds based on CSS)
    setTimeout(() => {
        overlay.classList.add('hidden');
    }, 3000);
}

// Show "Item Not Found" overlay
function showNotFoundOverlay() {
    const overlay = document.getElementById('notfound-overlay');
    overlay.classList.remove('hidden');
    
    // Remove after animation (3 seconds based on CSS)
    setTimeout(() => {
        overlay.classList.add('hidden');
    }, 3000);
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

// Check if scanned UPC is in the delete list for current POG
function checkForDelete(cleanUPC, cleanNoCheckDigit) {
    if (!deleteData || deleteData.length === 0) return null;
    
    // Filter to current POG
    const deletesInPOG = deleteData.filter(d => d.POG === currentPOG);
    if (deletesInPOG.length === 0) return null;
    
    // Try exact match
    let match = deletesInPOG.find(d => d.CleanUPC === cleanUPC);
    
    // Try without check digit
    if (!match) {
        match = deletesInPOG.find(d => d.CleanUPC === cleanNoCheckDigit);
    }
    
    // Try where delete data has check digit but scan doesn't
    if (!match) {
        match = deletesInPOG.find(d => d.CleanUPC.slice(0, -1) === cleanUPC);
    }
    
    if (match) {
        console.log(`🗑️ DELETE ITEM FOUND:`, match);
    }
    
    return match;
}

// Show the DELETE overlay
function showDeleteOverlay(upc, description) {
    const overlay = document.getElementById('delete-overlay');
    const upcEl = document.getElementById('delete-overlay-upc');
    const descEl = document.getElementById('delete-overlay-desc');
    
    upcEl.innerText = upc;
    descEl.innerText = description;
    overlay.classList.remove('hidden');
    
    // Remove after animation (4 seconds based on CSS)
    setTimeout(() => {
        overlay.classList.add('hidden');
    }, 4000);
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

// Skip to next unset item in the bay
function skipToNextUnset() {
    if (!currentItemBox) {
        closeProductModal();
        return;
    }
    
    const currentItem = JSON.parse(currentItemBox.dataset.itemData);
    const currentPosition = parseInt(currentItem.Position) || 0;
    
    // Get all items in current bay sorted by position
    const items = pogData.filter(i => i.POG === currentPOG && parseInt(i.Bay) === currentBay);
    const sortedItems = items.sort((a, b) => (parseInt(a.Position) || 0) - (parseInt(b.Position) || 0));
    
    // Find next unset item after current position
    let nextUnsetBox = null;
    
    // First, look for items after current position
    for (const item of sortedItems) {
        const pos = parseInt(item.Position) || 0;
        if (pos > currentPosition && !completedItems.has(item.CleanUPC)) {
            nextUnsetBox = findProductBoxByPosition(pos);
            if (nextUnsetBox) break;
        }
    }
    
    // If nothing found after, wrap around to beginning
    if (!nextUnsetBox) {
        for (const item of sortedItems) {
            const pos = parseInt(item.Position) || 0;
            if (pos !== currentPosition && !completedItems.has(item.CleanUPC)) {
                nextUnsetBox = findProductBoxByPosition(pos);
                if (nextUnsetBox) break;
            }
        }
    }
    
    if (nextUnsetBox) {
        currentItemBox = null;
        openProductModal(nextUnsetBox);
    } else {
        // All items are set, close modal
        document.getElementById('product-modal').classList.add('hidden');
        currentItemBox = null;
    }
}

// --- SWIPE NAVIGATION (Swipe + Hold) ---
function setupSwipe() {
    let xDown = null;
    let swipeDirection = 0;
    let holdTimer = null;
    let swipeTriggered = false;
    const canvas = document.getElementById('main-canvas');
    const HOLD_DURATION = 400; // ms to hold after swipe
    const SWIPE_THRESHOLD = 60; // px minimum swipe distance
    
    canvas.addEventListener('touchstart', (evt) => {
        xDown = evt.touches[0].clientX;
        swipeDirection = 0;
        swipeTriggered = false;
        clearTimeout(holdTimer);
    }, { passive: true });

    canvas.addEventListener('touchmove', (evt) => {
        if (!xDown || swipeTriggered) return;
        
        const xCurrent = evt.touches[0].clientX;
        const xDiff = xDown - xCurrent;
        
        // Check if swipe threshold reached
        if (Math.abs(xDiff) > SWIPE_THRESHOLD) {
            const newDirection = xDiff > 0 ? 1 : -1;
            
            // If direction changed or just started, reset timer
            if (newDirection !== swipeDirection) {
                swipeDirection = newDirection;
                clearTimeout(holdTimer);
                
                // Start hold timer
                holdTimer = setTimeout(() => {
                    if (swipeDirection !== 0 && !swipeTriggered) {
                        swipeTriggered = true;
                        // Vibrate if available
                        if (navigator.vibrate) navigator.vibrate(50);
                        changeBay(swipeDirection);
                    }
                }, HOLD_DURATION);
            }
        }
    }, { passive: true });

    canvas.addEventListener('touchend', () => {
        xDown = null;
        swipeDirection = 0;
        clearTimeout(holdTimer);
    }, { passive: true });
    
    canvas.addEventListener('touchcancel', () => {
        xDown = null;
        swipeDirection = 0;
        clearTimeout(holdTimer);
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
