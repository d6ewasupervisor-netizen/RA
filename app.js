// === PEGASUS - Planogram Execution Guide And Store User Support ===
// === CONFIGURATION ===
const REPO_BASE = window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1);

// Board Physics (1 unit = 1 inch)
const BOARD_WIDTH_INCHES = 46;  // Col 1 to 46
const BOARD_HEIGHT_INCHES = 64; // Row 1 to 64

// === GLOBAL VARIABLES ===
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
let completedItems = new Set(JSON.parse(localStorage.getItem('pegasus_complete') || "[]"));
let headerCollapsed = true; // START COLLAPSED
let currentItemBox = null; // Currently selected item for the modal
let largeFontMode = localStorage.getItem('pegasus_largefont') === 'true';

// Multi-match navigation state
let currentMatches = []; // Array of matched items
let currentMatchIndex = 0; // Which match we're currently showing

// Audio context for feedback sounds
let audioContext = null;

// Track bay completion for celebrations
let bayCompletionShown = new Set();
let pogCompleteShown = false;

// === AUDIO FEEDBACK SYSTEM ===
function initAudio() {
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
        console.log("Audio not supported");
    }
}

function playTone(frequency, duration, type = 'sine', volume = 0.3) {
    if (!audioContext) return;
    
    try {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.value = frequency;
        oscillator.type = type;
        gainNode.gain.value = volume;
        
        oscillator.start();
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
        oscillator.stop(audioContext.currentTime + duration);
    } catch (e) {
        console.log("Audio play error:", e);
    }
}

function playFoundSound() {
    // Pleasant ascending chime
    playTone(523, 0.15); // C5
    setTimeout(() => playTone(659, 0.15), 100); // E5
    setTimeout(() => playTone(784, 0.2), 200); // G5
}

function playNotFoundSound() {
    // Flat alert tone
    playTone(300, 0.3, 'square', 0.2);
}

function playDeleteSound() {
    // Warning descending tone
    playTone(600, 0.15);
    setTimeout(() => playTone(400, 0.15), 100);
    setTimeout(() => playTone(250, 0.25), 200);
}

function playCompleteSound() {
    // Quick satisfying click
    playTone(800, 0.08);
    setTimeout(() => playTone(1200, 0.1), 50);
}

function playRowChangeSound() {
    // Subtle notification
    playTone(600, 0.1, 'sine', 0.15);
}

function playCelebrationSound() {
    // Triumphant fanfare
    playTone(523, 0.15); // C5
    setTimeout(() => playTone(659, 0.15), 100); // E5
    setTimeout(() => playTone(784, 0.15), 200); // G5
    setTimeout(() => playTone(1047, 0.3), 300); // C6
}

function playPogCompleteSound() {
    // Big celebration!
    const notes = [523, 659, 784, 1047, 784, 1047, 1319];
    notes.forEach((freq, i) => {
        setTimeout(() => playTone(freq, 0.2), i * 120);
    });
}

// === INIT ===
document.addEventListener('DOMContentLoaded', () => {
    init();
    setupSwipe();
    
    // Initialize audio on first user interaction
    document.addEventListener('click', () => {
        if (!audioContext) initAudio();
    }, { once: true });
    
    window.addEventListener('resize', () => {
        if (currentPOG && currentBay) renderGrid(currentBay);
    });
    
    // Apply large font mode if saved
    if (largeFontMode) {
        document.body.classList.add('large-font-mode');
    }
});

async function init() {
    try {
        await loadCSVData();
        document.getElementById('loading-overlay').classList.add('hidden');
        
        const savedStore = localStorage.getItem('pegasus_store');
        if (savedStore) {
            loadStoreLogic(savedStore);
            // Start with header collapsed and floating buttons visible
            const header = document.getElementById('main-header');
            const floatingBtns = document.getElementById('floating-btns');
            header.classList.add('collapsed');
            floatingBtns.classList.remove('hidden');
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

// === HEADER COLLAPSE/EXPAND ===
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

// === FONT SIZE TOGGLE ===
function toggleFontSize() {
    largeFontMode = !largeFontMode;
    localStorage.setItem('pegasus_largefont', largeFontMode);
    
    if (largeFontMode) {
        document.body.classList.add('large-font-mode');
        showToast('Large text mode ON - some labels may overlap', 2000);
    } else {
        document.body.classList.remove('large-font-mode');
        showToast('Large text mode OFF', 1500);
    }
    
    // Re-render to apply changes
    if (currentPOG && currentBay) {
        setTimeout(() => renderGrid(currentBay), 100);
    }
}

// Generic toast helper
function showToast(message, duration = 2000) {
    const toast = document.getElementById('row-toast');
    const text = document.getElementById('row-toast-text');
    text.innerText = message;
    toast.classList.remove('hidden');
    
    setTimeout(() => {
        toast.classList.add('hidden');
    }, duration);
}

// === CSV DATA LOADING ===
async function loadCSVData() {
    const [fileRes, pogRes, storeRes] = await Promise.all([
        fetch(REPO_BASE + 'githubfiles.csv'),
        fetch(REPO_BASE + 'allplanogramdata.csv'),
        fetch(REPO_BASE + 'Store_POG_Mapping.csv')
    ]);
    
    if (!fileRes.ok) throw new Error("githubfiles.csv not found");
    if (!pogRes.ok) throw new Error("allplanogramdata.csv not found");
    if (!storeRes.ok) throw new Error("Store_POG_Mapping.csv not found");
    
    fileIndex = parseCSV(await fileRes.text());
    pogData = parseCSV(await pogRes.text());
    storeMap = parseCSV(await storeRes.text());
    
    // Precompute CleanUPC for faster lookups
    pogData.forEach(item => {
        item.CleanUPC = normalizeUPC(item.UPC);
    });
    
    // Try to load deletes (optional file)
    try {
        const deleteRes = await fetch(REPO_BASE + 'Deletes.csv');
        if (deleteRes.ok) {
            deleteData = parseCSV(await deleteRes.text());
            deleteData.forEach(item => {
                item.CleanUPC = normalizeUPC(item.UPC);
            });
            console.log(`Loaded ${deleteData.length} delete items`);
        }
    } catch (e) {
        console.log("No Deletes.csv found (optional)");
    }
    
    console.log(`Loaded: ${fileIndex.length} files, ${pogData.length} items, ${storeMap.length} stores`);
}

function parseCSV(text) {
    // Remove any carriage returns throughout
    text = text.replace(/\r/g, '');
    const lines = text.trim().split('\n');
    if (lines.length < 2) return [];
    
    // Parse header
    const headers = parseCSVLine(lines[0]);
    
    // Parse data rows
    return lines.slice(1).map(line => {
        const values = parseCSVLine(line);
        const obj = {};
        headers.forEach((h, i) => {
            obj[h.trim()] = (values[i] || '').trim();
        });
        return obj;
    }).filter(row => Object.values(row).some(v => v)); // Filter out empty rows
}

function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++; // Skip next quote
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current);
    return result;
}

// === STORE LOGIC ===
function loadStoreLogic(storeNum) {
    if (!storeNum) return;
    
    const map = storeMap.find(s => s.Store === storeNum);
    if (!map) {
        document.getElementById('error-msg').classList.remove('hidden');
        setTimeout(() => document.getElementById('error-msg').classList.add('hidden'), 3000);
        return;
    }
    
    // Check if this is a different store than before - if so, clear progress
    const previousStore = localStorage.getItem('pegasus_store');
    if (previousStore && previousStore !== storeNum) {
        completedItems.clear();
        localStorage.removeItem('pegasus_complete');
        bayCompletionShown.clear();
        pogCompleteShown = false;
    }
    
    currentStore = storeNum;
    currentPOG = map.POG;
    localStorage.setItem('pegasus_store', storeNum);

    // Update UI
    document.getElementById('store-modal').classList.add('hidden');
    document.getElementById('store-display').innerText = `Store: ${storeNum}`;
    document.getElementById('pog-display').innerText = `POG: ${currentPOG}`;

    // Compute unique bays for this POG
    const items = pogData.filter(i => i.POG === currentPOG);
    const baySet = new Set(items.map(i => parseInt(i.Bay)).filter(b => !isNaN(b)));
    allBays = [...baySet].sort((a, b) => a - b);
    console.log(`Store ${storeNum} → POG ${currentPOG}: ${items.length} items across bays:`, allBays);
    
    if (allBays.length > 0) {
        currentBay = allBays[0];
        renderGrid(currentBay);
        
        // Collapse header and show floating buttons after loading
        const header = document.getElementById('main-header');
        const floatingBtns = document.getElementById('floating-btns');
        headerCollapsed = true;
        header.classList.add('collapsed');
        floatingBtns.classList.remove('hidden');
    }
}

function resetStore() {
    currentStore = null;
    currentPOG = null;
    completedItems.clear();
    localStorage.removeItem('pegasus_complete');
    localStorage.removeItem('pegasus_store');
    bayCompletionShown.clear();
    pogCompleteShown = false;
    document.getElementById('store-input').value = '';
    document.getElementById('store-modal').classList.remove('hidden');
    document.getElementById('grid-container').innerHTML = '';
    
    // Expand header when resetting
    const header = document.getElementById('main-header');
    const floatingBtns = document.getElementById('floating-btns');
    headerCollapsed = false;
    header.classList.remove('collapsed');
    floatingBtns.classList.add('hidden');
}

function startOver() {
    if (!confirm('Are you sure you want to reset all items to unset?')) return;
    
    completedItems.clear();
    localStorage.removeItem('pegasus_complete');
    bayCompletionShown.clear();
    pogCompleteShown = false;
    
    // Re-render current bay
    if (currentPOG && currentBay) {
        renderGrid(currentBay);
    }
    
    showToast('Progress reset!', 1500);
}

// === GRID RENDERING ===
function renderGrid(bayIndex) {
    currentBay = bayIndex;
    document.getElementById('bay-indicator').innerText = `Bay ${bayIndex}`;

    const items = pogData.filter(i => i.POG === currentPOG && parseInt(i.Bay) === bayIndex);
    const container = document.getElementById('grid-container');
    container.innerHTML = '';
    
    // Calculate PPI based on available space
    const main = document.getElementById('main-canvas');
    const availableW = main.clientWidth - 20;
    const availableH = main.clientHeight - 20;
    
    const ppiW = availableW / BOARD_WIDTH_INCHES;
    const ppiH = availableH / BOARD_HEIGHT_INCHES;
    PPI = Math.min(ppiW, ppiH);
    
    const boardW = BOARD_WIDTH_INCHES * PPI;
    const boardH = BOARD_HEIGHT_INCHES * PPI;
    
    container.style.width = boardW + 'px';
    container.style.height = boardH + 'px';

    // Build lookup for repeated UPCs (facings)
    const upcCounts = {};
    const upcPositions = {};
    items.forEach(item => {
        const upc = item.CleanUPC;
        if (!upcCounts[upc]) {
            upcCounts[upc] = 0;
            upcPositions[upc] = [];
        }
        upcCounts[upc]++;
        upcPositions[upc].push(parseInt(item.Position) || 0);
    });

    // Draw each product
    items.forEach(item => {
        drawProduct(container, item, upcCounts, upcPositions);
    });
    
    // Update progress
    const done = items.filter(i => completedItems.has(i.CleanUPC)).length;
    updateProgress(items, done);
    
    // Check for bay completion celebration
    checkBayCompletion(items, done);
}

function drawProduct(container, item, upcCounts, upcPositions) {
    // Parse peg location
    const pegMatch = item.Peg ? item.Peg.match(/R(\d+)\s*C(\d+)/) : null;
    if (!pegMatch) {
        console.warn("Invalid Peg format:", item.Peg);
        return;
    }
    
    const row = parseInt(pegMatch[1]);
    const col = parseInt(pegMatch[2]);
    
    // Use peg formula: holeX = (c-1)*PPI + PPI/2
    const holeX = (col - 1) * PPI + PPI / 2;
    const holeY = (row - 1) * PPI + PPI / 2;
    
    // Product dimensions
    const widthInches = parseFloat(item.Width) || 2;
    const heightInches = parseFloat(item.Height) || 3;
    const pxW = widthInches * PPI;
    const pxH = heightInches * PPI;
    
    // Center on frog at holeY + PPI*0.5
    const centerY = holeY + PPI * 0.5;
    const left = holeX - pxW / 2;
    const top = centerY - pxH / 2;
    
    const box = document.createElement('div');
    box.className = 'product-box';
    box.style.left = left + 'px';
    box.style.top = top + 'px';
    box.style.width = pxW + 'px';
    box.style.height = pxH + 'px';
    
    // Find product image
    const rawUPC = item.UPC || '';
    const cleanUPC = item.CleanUPC;
    const fileMatch = fileIndex.find(f => {
        const filename = f.filename || f.Filename || '';
        return filename.startsWith(rawUPC + '_') || filename.startsWith(cleanUPC + '_');
    });
    
    let filenameDesc = '';
    if (fileMatch) {
        const filename = fileMatch.filename || fileMatch.Filename;
        box.style.backgroundImage = `url('${REPO_BASE}${filename}')`;
        box.classList.add('has-image');
        filenameDesc = extractDescriptionFromFilename(filename);
    } else {
        box.classList.add('no-image');
    }
    
    // Store data for modal
    box.dataset.upc = cleanUPC;
    box.dataset.itemData = JSON.stringify(item);
    box.dataset.imgSrc = fileMatch ? REPO_BASE + (fileMatch.filename || fileMatch.Filename) : '';
    box.dataset.filenameDesc = filenameDesc;
    
    // Check if completed
    if (completedItems.has(cleanUPC)) {
        box.classList.add('completed');
    }
    
    // Check for repeated UPC (facings)
    const upcCount = upcCounts[cleanUPC] || 1;
    if (upcCount > 1) {
        box.classList.add('repeated-upc');
        const positions = upcPositions[cleanUPC].sort((a, b) => a - b);
        const facingIndex = positions.indexOf(parseInt(item.Position) || 0) + 1;
        
        // Add facing badge
        const facingBadge = document.createElement('div');
        facingBadge.className = 'facing-badge';
        facingBadge.innerText = `${facingIndex}/${upcCount}`;
        box.appendChild(facingBadge);
        
        // Store facing info for modal
        box.dataset.facingInfo = `${facingIndex} of ${upcCount}`;
    }
    
    // Add position label
    addPositionLabel(box, item.Position);
    
    // Click to open detail
    box.onclick = () => openProductModal(box);
    
    container.appendChild(box);
}

// Helper function to add position label to product box
function addPositionLabel(box, position) {
    if (!position) return;
    
    const label = document.createElement('div');
    label.className = 'position-label';
    label.innerText = position;
    box.appendChild(label);
}

// Extract description from filename (e.g., "1311406600_Ace_Black_Pick_Comb.png" -> "Ace Black Pick Comb")
function extractDescriptionFromFilename(filename) {
    if (!filename) return '';
    
    // Remove extension
    let name = filename.replace(/\.[^/.]+$/, '');
    
    // Remove UPC prefix (numbers followed by underscore)
    name = name.replace(/^\d+_/, '');
    
    // Replace underscores with spaces
    name = name.replace(/_/g, ' ');
    
    return name.trim();
}

function updateProgress(items, done) {
    const total = items.length;
    const pct = total > 0 ? (done / total) * 100 : 0;
    document.getElementById('progress-fill').style.width = pct + '%';
    document.getElementById('progress-count').innerText = `${done}/${total}`;
}

// === BAY NAVIGATION ===
function changeBay(delta, showOverlay = true) {
    const idx = allBays.indexOf(currentBay);
    const newIdx = idx + delta;
    if (newIdx < 0 || newIdx >= allBays.length) return;
    
    currentBay = allBays[newIdx];
    
    if (showOverlay) {
        showBayOverlay(currentBay);
    }
    
    renderGrid(currentBay);
}

function loadBay(bayIndex, showOverlay = false) {
    if (!allBays.includes(bayIndex)) return;
    
    currentBay = bayIndex;
    
    if (showOverlay) {
        showBayOverlay(currentBay);
    }
    
    renderGrid(currentBay);
}

function showBayOverlay(bayNum) {
    const overlay = document.getElementById('bay-overlay');
    const numEl = document.getElementById('bay-overlay-number');
    
    numEl.innerText = bayNum;
    overlay.classList.remove('hidden');
    
    // Vibrate if supported
    if (navigator.vibrate) {
        navigator.vibrate(50);
    }
    
    // Remove after animation
    setTimeout(() => {
        overlay.classList.add('hidden');
    }, 1200);
}

// === SWIPE NAVIGATION ===
function setupSwipe() {
    const main = document.getElementById('main-canvas');
    let touchStartX = 0;
    let touchStartY = 0;
    let swipeDirection = null;
    let holdTimer = null;
    const SWIPE_THRESHOLD = 60;
    const HOLD_DURATION = 400;
    
    main.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        swipeDirection = null;
        if (holdTimer) clearTimeout(holdTimer);
    }, { passive: true });
    
    main.addEventListener('touchmove', (e) => {
        const deltaX = e.touches[0].clientX - touchStartX;
        const deltaY = e.touches[0].clientY - touchStartY;
        
        // Check if horizontal swipe exceeds threshold
        if (Math.abs(deltaX) > SWIPE_THRESHOLD && Math.abs(deltaX) > Math.abs(deltaY)) {
            const newDirection = deltaX > 0 ? 'right' : 'left';
            
            // Start hold timer if direction changed or no timer running
            if (newDirection !== swipeDirection) {
                swipeDirection = newDirection;
                if (holdTimer) clearTimeout(holdTimer);
                
                holdTimer = setTimeout(() => {
                    if (swipeDirection === 'left') {
                        changeBay(1, true);
                    } else if (swipeDirection === 'right') {
                        changeBay(-1, true);
                    }
                    swipeDirection = null; // Prevent repeat
                }, HOLD_DURATION);
            }
        }
    }, { passive: true });
    
    main.addEventListener('touchend', () => {
        if (holdTimer) clearTimeout(holdTimer);
        swipeDirection = null;
    });
    
    main.addEventListener('touchcancel', () => {
        if (holdTimer) clearTimeout(holdTimer);
        swipeDirection = null;
    });
}

// === UPC NORMALIZATION ===
function normalizeUPC(upc) {
    if (!upc) return "";
    
    // Convert to string, trim whitespace, remove any \r characters
    let cleaned = upc.toString().trim().replace(/\r/g, '');
    
    // Fix common barcode scanner OCR misreads BEFORE removing non-numeric
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

// === BARCODE SCANNER ===
let isProcessingScan = false;

function startScanner() {
    if (html5QrCode) return; // Already running
    
    const modal = document.getElementById('scanner-modal');
    modal.classList.remove('hidden');
    isProcessingScan = false;
    
    // Initialize audio on scanner start (user interaction)
    if (!audioContext) initAudio();
    
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
        qrbox: { width: 280, height: 150 }
    };
    
    html5QrCode.start(
        { facingMode: "environment" }, 
        scanConfig,
        (decodedText) => {
            if (isProcessingScan) return;
            isProcessingScan = true;
            
            console.log(`📷 RAW SCAN: "${decodedText}"`);
            const cleaned = normalizeUPC(decodedText);
            console.log(`🔧 CLEANED UPC: "${cleaned}"`);
            
            stopScanner();
            
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
    modal.classList.add('hidden');
    
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

// === SEARCH / SCAN HANDLING ===
function handleSearchOrScan(input, fromScanner = false) {
    if (!input) return false;
    
    // Hide any existing multi-match bar
    hideMultiMatchBar();
    
    const clean = normalizeUPC(input);
    const cleanNoCheckDigit = clean.length > 1 ? clean.slice(0, -1) : clean;
    
    document.getElementById('scan-result').innerText = `Searching: ${cleanNoCheckDigit}`;
    console.log(`=== SEARCH DEBUG ===`);
    console.log(`Raw input: "${input}"`);
    console.log(`Cleaned: "${clean}"`);
    console.log(`Without check digit: "${cleanNoCheckDigit}"`);
    console.log(`Current POG: "${currentPOG}"`);
    console.log(`From scanner: ${fromScanner}`);

    // FIRST: Check if this is a DELETE item
    const deleteMatch = checkForDelete(clean, cleanNoCheckDigit);
    if (deleteMatch) {
        playDeleteSound();
        showDeleteOverlay(deleteMatch.UPC || cleanNoCheckDigit, deleteMatch.Product || 'Unknown Item');
        document.getElementById('scan-result').innerText = `🗑️ DELETE: ${deleteMatch.Product || cleanNoCheckDigit}`;
        return true;
    }

    // Get items in current POG
    const itemsInPOG = pogData.filter(i => i.POG === currentPOG);
    
    if (itemsInPOG.length === 0) {
        playNotFoundSound();
        showNotFoundOverlay();
        document.getElementById('scan-result').innerText = `POG "${currentPOG}" has no items`;
        return false;
    }

    // Find ALL matches
    let matches = findAllMatches(itemsInPOG, clean, cleanNoCheckDigit, fromScanner);
    
    if (matches.length === 0) {
        playNotFoundSound();
        showNotFoundOverlay();
        document.getElementById('scan-result').innerText = `"${cleanNoCheckDigit}" not found`;
        return false;
    }

    console.log(`✓ Found ${matches.length} match(es):`, matches);
    playFoundSound();
    
    // Store matches for navigation
    currentMatches = matches;
    currentMatchIndex = 0;
    
    // Show the first match
    showMatchAtIndex(0, true);
    
    return true;
}

function findAllMatches(itemsInPOG, clean, cleanNoCheckDigit, fromScanner) {
    let matches = [];
    
    // For manual search with short input (4 digits or less), do fuzzy search
    if (!fromScanner && clean.length <= 4) {
        matches = itemsInPOG.filter(i => 
            i.CleanUPC.endsWith(clean) || i.CleanUPC.endsWith(cleanNoCheckDigit)
        );
        console.log(`Fuzzy search for "${clean}" found ${matches.length} matches`);
    } else {
        // Exact matching strategies
        let exactMatches = itemsInPOG.filter(i => i.CleanUPC === clean);
        
        if (exactMatches.length === 0) {
            exactMatches = itemsInPOG.filter(i => i.CleanUPC === cleanNoCheckDigit);
        }
        
        if (exactMatches.length === 0) {
            exactMatches = itemsInPOG.filter(i => i.CleanUPC.slice(0, -1) === clean);
        }
        
        matches = exactMatches;
    }
    
    // Sort by Bay then Position
    matches.sort((a, b) => {
        const bayDiff = parseInt(a.Bay) - parseInt(b.Bay);
        if (bayDiff !== 0) return bayDiff;
        return (parseInt(a.Position) || 0) - (parseInt(b.Position) || 0);
    });
    
    return matches;
}

function showMatchAtIndex(index, showOverlay = false) {
    if (index < 0 || index >= currentMatches.length) return;
    
    currentMatchIndex = index;
    const match = currentMatches[index];
    
    let resultText = `✓ Bay ${match.Bay}, Pos ${match.Position}, ${match.Peg}`;
    if (currentMatches.length > 1) {
        resultText += ` (${index + 1} of ${currentMatches.length})`;
    }
    document.getElementById('scan-result').innerText = resultText;
    
    if (currentMatches.length > 1) {
        showMultiMatchBar();
    } else {
        hideMultiMatchBar();
    }
    
    // Collapse header
    if (!headerCollapsed) {
        const header = document.getElementById('main-header');
        const floatingBtns = document.getElementById('floating-btns');
        headerCollapsed = true;
        header.classList.add('collapsed');
        floatingBtns.classList.remove('hidden');
    }
    
    if (showOverlay) {
        showFoundOverlay(match);
        setTimeout(() => {
            navigateToMatch(match);
        }, 2500);
    } else {
        navigateToMatch(match);
    }
}

function navigateToMatch(match) {
    const matchedUPC = match.CleanUPC;
    const itemBay = parseInt(match.Bay);
    
    if (itemBay !== currentBay) {
        loadBay(itemBay, false);
        setTimeout(() => highlightItem(matchedUPC), 300);
    } else {
        renderGrid(currentBay);
        setTimeout(() => highlightItem(matchedUPC), 100);
    }
}

function showNextMatch() {
    if (currentMatches.length === 0) return;
    const nextIndex = (currentMatchIndex + 1) % currentMatches.length;
    showMatchAtIndex(nextIndex, false);
}

function showPrevMatch() {
    if (currentMatches.length === 0) return;
    const prevIndex = (currentMatchIndex - 1 + currentMatches.length) % currentMatches.length;
    showMatchAtIndex(prevIndex, false);
}

function showMultiMatchBar() {
    const bar = document.getElementById('multi-match-bar');
    const indicator = document.getElementById('match-indicator');
    
    indicator.innerText = `${currentMatchIndex + 1} of ${currentMatches.length}`;
    bar.classList.remove('hidden');
}

function hideMultiMatchBar() {
    document.getElementById('multi-match-bar').classList.add('hidden');
    currentMatches = [];
    currentMatchIndex = 0;
}

function showFoundOverlay(match) {
    const overlay = document.getElementById('found-overlay');
    document.getElementById('found-overlay-bay').innerText = `Bay ${match.Bay}`;
    document.getElementById('found-overlay-position').innerText = `Position ${match.Position || '--'}`;
    document.getElementById('found-overlay-peg').innerText = match.Peg || 'R-- C--';
    
    overlay.classList.remove('hidden');
    
    setTimeout(() => {
        overlay.classList.add('hidden');
    }, 3000);
}

function showNotFoundOverlay() {
    const overlay = document.getElementById('notfound-overlay');
    overlay.classList.remove('hidden');
    
    setTimeout(() => {
        overlay.classList.add('hidden');
    }, 3000);
}

function highlightItem(upc) {
    const boxes = document.querySelectorAll('.product-box');
    boxes.forEach(box => {
        box.classList.remove('highlight');
        if (box.dataset.upc === upc) {
            box.classList.add('highlight');
            setTimeout(() => box.classList.remove('highlight'), 4000);
        }
    });
}

// === DELETE CHECKING ===
function checkForDelete(cleanUPC, cleanNoCheckDigit) {
    if (!deleteData || deleteData.length === 0) return null;
    
    const deletesInPOG = deleteData.filter(d => d.POG === currentPOG);
    if (deletesInPOG.length === 0) return null;
    
    let match = deletesInPOG.find(d => d.CleanUPC === cleanUPC);
    
    if (!match) {
        match = deletesInPOG.find(d => d.CleanUPC === cleanNoCheckDigit);
    }
    
    if (!match) {
        match = deletesInPOG.find(d => d.CleanUPC.slice(0, -1) === cleanUPC);
    }
    
    return match;
}

function showDeleteOverlay(upc, description) {
    const overlay = document.getElementById('delete-overlay');
    document.getElementById('delete-overlay-upc').innerText = upc;
    document.getElementById('delete-overlay-desc').innerText = description;
    overlay.classList.remove('hidden');
    
    setTimeout(() => {
        overlay.classList.add('hidden');
    }, 4000);
}

// === PRODUCT DETAIL MODAL ===
function openProductModal(box) {
    currentItemBox = box;
    
    const item = JSON.parse(box.dataset.itemData);
    const imgSrc = box.dataset.imgSrc;
    const filenameDesc = box.dataset.filenameDesc;
    const facingInfo = box.dataset.facingInfo;
    
    document.getElementById('detail-peg').innerText = item.Peg || `R-- C--`;
    document.getElementById('detail-position').innerText = item.Position || '--';
    document.getElementById('detail-upc').innerText = item.UPC || '--';
    document.getElementById('detail-desc').innerText = filenameDesc || item.ProductDescription || item.Description || '--';
    document.getElementById('detail-size').innerText = `${item.Width} × ${item.Height}`;
    
    // Show facing info if present
    const facingRow = document.getElementById('detail-facing-row');
    const facingEl = document.getElementById('detail-facing');
    if (facingInfo) {
        facingEl.innerText = facingInfo;
        facingRow.classList.remove('hidden');
    } else {
        facingRow.classList.add('hidden');
    }
    
    const detailImg = document.getElementById('detail-image');
    if (imgSrc) {
        detailImg.src = imgSrc;
        detailImg.style.display = 'block';
    } else {
        detailImg.src = '';
        detailImg.style.display = 'none';
    }
    
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
    
    // Get current row for row change detection
    const currentPegMatch = currentItem.Peg ? currentItem.Peg.match(/R(\d+)/) : null;
    const currentRow = currentPegMatch ? parseInt(currentPegMatch[1]) : 0;
    
    if (isCompleted) {
        // Unset
        completedItems.delete(upc);
        currentItemBox.classList.remove('completed');
        localStorage.setItem('pegasus_complete', JSON.stringify([...completedItems]));
        
        const items = pogData.filter(i => i.POG === currentPOG && parseInt(i.Bay) === currentBay);
        const done = items.filter(i => completedItems.has(i.CleanUPC)).length;
        updateProgress(items, done);
        
        document.getElementById('product-modal').classList.add('hidden');
        currentItemBox = null;
    } else {
        // Set complete
        playCompleteSound();
        completedItems.add(upc);
        currentItemBox.classList.add('completed');
        localStorage.setItem('pegasus_complete', JSON.stringify([...completedItems]));
        
        const items = pogData.filter(i => i.POG === currentPOG && parseInt(i.Bay) === currentBay);
        const done = items.filter(i => completedItems.has(i.CleanUPC)).length;
        updateProgress(items, done);
        
        // Find next item
        const nextPosition = currentPosition + 1;
        const nextBox = findProductBoxByPosition(nextPosition);
        
        if (nextBox) {
            // Check for row change
            const nextItem = JSON.parse(nextBox.dataset.itemData);
            const nextPegMatch = nextItem.Peg ? nextItem.Peg.match(/R(\d+)/) : null;
            const nextRow = nextPegMatch ? parseInt(nextPegMatch[1]) : 0;
            
            if (nextRow > currentRow) {
                playRowChangeSound();
                showRowChangeToast(nextRow);
            }
            
            currentItemBox = null;
            openProductModal(nextBox);
        } else {
            document.getElementById('product-modal').classList.add('hidden');
            currentItemBox = null;
            
            // Check for bay completion
            checkBayCompletion(items, done);
        }
    }
}

function showRowChangeToast(row) {
    const toast = document.getElementById('row-toast');
    const text = document.getElementById('row-toast-text');
    text.innerText = `⬇️ Moving to Row ${row}`;
    toast.classList.remove('hidden');
    
    setTimeout(() => {
        toast.classList.add('hidden');
    }, 2000);
}

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

function skipToNextUnset() {
    if (!currentItemBox) {
        closeProductModal();
        return;
    }
    
    const currentItem = JSON.parse(currentItemBox.dataset.itemData);
    const currentPosition = parseInt(currentItem.Position) || 0;
    
    const items = pogData.filter(i => i.POG === currentPOG && parseInt(i.Bay) === currentBay);
    const sortedItems = items.sort((a, b) => (parseInt(a.Position) || 0) - (parseInt(b.Position) || 0));
    
    let nextUnsetBox = null;
    
    for (const item of sortedItems) {
        const pos = parseInt(item.Position) || 0;
        if (pos > currentPosition && !completedItems.has(item.CleanUPC)) {
            nextUnsetBox = findProductBoxByPosition(pos);
            if (nextUnsetBox) break;
        }
    }
    
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
        closeProductModal();
    }
}

// === CELEBRATION SYSTEM ===
function checkBayCompletion(items, done) {
    const total = items.length;
    if (total === 0) return;
    
    const bayKey = `${currentPOG}-${currentBay}`;
    
    // Check bay completion
    if (done === total && !bayCompletionShown.has(bayKey)) {
        bayCompletionShown.add(bayKey);
        playCelebrationSound();
        showBayCompleteCelebration();
        
        // Check if entire POG is complete
        setTimeout(() => checkPogCompletion(), 3500);
    }
}

function showBayCompleteCelebration() {
    const overlay = document.getElementById('bay-complete-overlay');
    document.getElementById('bay-complete-text').innerText = `Bay ${currentBay} is done!`;
    overlay.classList.remove('hidden');
    
    setTimeout(() => {
        overlay.classList.add('hidden');
    }, 3500);
}

function checkPogCompletion() {
    if (pogCompleteShown) return;
    
    const allItems = pogData.filter(i => i.POG === currentPOG);
    const allDone = allItems.filter(i => completedItems.has(i.CleanUPC)).length;
    
    if (allDone === allItems.length && allItems.length > 0) {
        pogCompleteShown = true;
        playPogCompleteSound();
        showPogCompleteCelebration(allItems.length);
    }
}

function showPogCompleteCelebration(totalItems) {
    const overlay = document.getElementById('pog-complete-overlay');
    document.getElementById('pog-complete-text').innerText = `All ${totalItems} items complete!`;
    overlay.classList.remove('hidden');
    
    // Start confetti
    startConfetti();
    
    setTimeout(() => {
        overlay.classList.add('hidden');
        stopConfetti();
    }, 5000);
}

// Simple confetti animation
let confettiAnimation = null;
function startConfetti() {
    const canvas = document.getElementById('confetti-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    
    const pieces = [];
    const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#ffd700'];
    
    for (let i = 0; i < 150; i++) {
        pieces.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height - canvas.height,
            size: Math.random() * 10 + 5,
            color: colors[Math.floor(Math.random() * colors.length)],
            speedY: Math.random() * 3 + 2,
            speedX: Math.random() * 2 - 1,
            rotation: Math.random() * 360
        });
    }
    
    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        pieces.forEach(p => {
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rotation * Math.PI / 180);
            ctx.fillStyle = p.color;
            ctx.fillRect(-p.size/2, -p.size/2, p.size, p.size * 0.6);
            ctx.restore();
            
            p.y += p.speedY;
            p.x += p.speedX;
            p.rotation += 5;
            
            if (p.y > canvas.height) {
                p.y = -p.size;
                p.x = Math.random() * canvas.width;
            }
        });
        
        confettiAnimation = requestAnimationFrame(animate);
    }
    
    animate();
}

function stopConfetti() {
    if (confettiAnimation) {
        cancelAnimationFrame(confettiAnimation);
        confettiAnimation = null;
    }
    const canvas = document.getElementById('confetti-canvas');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

// === MINI-MAP ===
function openMinimap() {
    const modal = document.getElementById('minimap-modal');
    const container = document.getElementById('minimap-bays');
    container.innerHTML = '';
    
    // Calculate overall progress
    const allItems = pogData.filter(i => i.POG === currentPOG);
    const allDone = allItems.filter(i => completedItems.has(i.CleanUPC)).length;
    const allPct = allItems.length > 0 ? Math.round((allDone / allItems.length) * 100) : 0;
    
    document.getElementById('minimap-total-progress').innerText = `${allDone}/${allItems.length} items`;
    document.getElementById('minimap-percent').innerText = `${allPct}%`;
    
    // Create bay cards
    allBays.forEach(bayNum => {
        const bayItems = pogData.filter(i => i.POG === currentPOG && parseInt(i.Bay) === bayNum);
        const bayDone = bayItems.filter(i => completedItems.has(i.CleanUPC)).length;
        const bayPct = bayItems.length > 0 ? Math.round((bayDone / bayItems.length) * 100) : 0;
        
        const card = document.createElement('div');
        card.className = 'minimap-bay';
        
        if (bayNum === currentBay) card.classList.add('current');
        if (bayPct === 100) card.classList.add('complete');
        else if (bayPct > 0) card.classList.add('in-progress');
        
        card.innerHTML = `
            <div class="minimap-bay-number">${bayNum}</div>
            <div class="minimap-bay-progress">${bayDone}/${bayItems.length}</div>
        `;
        
        card.onclick = () => {
            closeMinimap();
            loadBay(bayNum, true);
        };
        
        container.appendChild(card);
    });
    
    modal.classList.remove('hidden');
}

function closeMinimap(event) {
    if (event && event.target.id !== 'minimap-modal') return;
    document.getElementById('minimap-modal').classList.add('hidden');
}

// === PDF VIEWER ===
function openPDF() {
    const pdfName = `pog_${currentPOG}.pdf`;
    document.getElementById('pdf-frame').src = REPO_BASE + pdfName;
    document.getElementById('pdf-modal').classList.remove('hidden');
}

function closePDF() {
    document.getElementById('pdf-modal').classList.add('hidden');
    document.getElementById('pdf-frame').src = '';
}
